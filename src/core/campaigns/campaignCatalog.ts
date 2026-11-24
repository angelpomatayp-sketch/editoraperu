import {
  CAMERA_SCENARIO_ID,
  CAMERA_SCENARIO_NAME,
  campaignConfigSchema,
  type CampaignConfig,
  type CampaignDetail,
  type CampaignSummary,
  type CharacterOption,
  type OverlayOption,
  type ResourceOption
} from '../../shared/campaign'
import type { AuditLog } from '../audit/auditLog'
import type { FractionRect } from '../../shared/compositionPlan'

export interface CampaignRecord {
  id: string
  code: string
  name: string
  description: string | null
  imagePath: string | null
  status: 'draft' | 'active' | 'inactive' | 'archived'
  startsAt: string | null
  endsAt: string | null
  configJson: string
  configVersion: number
}

export interface CampaignResourceRecord {
  resourceId: string
  type: 'scenario' | 'character' | 'frame' | 'logo' | 'other'
  name: string
  filePath: string
  animationPath?: string | null
  animationDurationMs?: number | null
  animationBackground?: 'alpha' | 'chroma' | 'segmentation'
  entryDirection?: 'auto' | 'left' | 'right'
  contentBounds?: FractionRect
  anchorX?: number
  anchorY?: number
  status: 'active' | 'inactive' | 'archived'
  isRequired: boolean
  sortOrder: number
  width: number
  height: number
  layerOrder: number
  posX: number
  posY: number
  scale: number
  /** Escenarios: zona transparente donde va la foto, si la imagen la trae. */
  photoHole?: FractionRect | null
}

/** Personaje asignado a un escenario de la campaña. */
export interface ScenarioCharacterLink {
  scenarioId: string
  characterId: string
  sortOrder: number
}

export interface CampaignRepository {
  /** Campañas activas dentro de su vigencia en el instante indicado. */
  listActiveInPeriod(nowIso: string): CampaignRecord[]
  getById(id: string): CampaignRecord | null
  listResources(campaignId: string): CampaignResourceRecord[]
  listScenarioCharacters(campaignId: string): ScenarioCharacterLink[]
}

export interface CampaignEvaluation {
  config: CampaignConfig | null
  problems: string[]
  usable: (type: CampaignResourceRecord['type']) => CampaignResourceRecord[]
  /** Escenarios que se pueden ofrecer: con la campaña exigiendo personaje, solo los que tienen alguno. */
  scenarios: CampaignResourceRecord[]
  /** Personajes disponibles para un escenario, en su orden. */
  charactersFor: (scenarioId: string) => CampaignResourceRecord[]
}

/**
 * Comprueba que la configuración y los recursos de una campaña permitan usarla (RN-001, RF-CAM-003).
 * Devuelve los problemas encontrados; una lista vacía indica que la campaña es válida.
 * Los personajes pertenecen a cada escenario (RF-EXP-004); una campaña sin asignaciones por
 * escenario ofrece todos sus personajes con cualquier escenario.
 */
export function evaluateCampaign(
  campaign: CampaignRecord,
  resources: CampaignResourceRecord[],
  fileExists: (relativePath: string) => boolean,
  links: ScenarioCharacterLink[] = []
): CampaignEvaluation {
  const problems: string[] = []
  let config: CampaignConfig | null = null
  try {
    const parsed = campaignConfigSchema.safeParse(JSON.parse(campaign.configJson))
    if (parsed.success) config = parsed.data
    else problems.push('config_invalid')
  } catch {
    problems.push('config_invalid')
  }

  const isUsable = (r: CampaignResourceRecord) => r.status === 'active' && fileExists(r.filePath)
  for (const resource of resources) {
    if (resource.isRequired && !isUsable(resource)) problems.push(`required_resource_unavailable:${resource.resourceId}`)
  }
  const usable = (type: CampaignResourceRecord['type']) =>
    resources.filter((r) => r.type === type && isUsable(r)).sort((a, b) => a.sortOrder - b.sortOrder)

  const characters = usable('character')
  const charactersFor = (scenarioId: string): CampaignResourceRecord[] => {
    if (links.length === 0) return characters
    return links
      .filter((l) => l.scenarioId === scenarioId)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((l) => characters.find((c) => c.resourceId === l.characterId))
      .filter((c): c is CampaignResourceRecord => c !== undefined)
  }

  const allScenarios = usable('scenario')
  const scenarios =
    config?.characterMode === 'required' ? allScenarios.filter((s) => charactersFor(s.resourceId).length > 0) : allScenarios

  if (allScenarios.length === 0 && !config?.allowCameraBackground) problems.push('no_scenarios')
  else if (config?.characterMode === 'required' && scenarios.length === 0 && (!config.allowCameraBackground || characters.length === 0)) problems.push('no_characters')
  if (config?.frameMode === 'required' && usable('frame').length === 0) problems.push('no_frames')

  return { config, problems, usable, scenarios, charactersFor }
}

/** Campañas visibles para el público y su detalle de selección (RF-EXP-001 a RF-EXP-005). */
export class CampaignCatalog {
  private readonly reported = new Set<string>()

  constructor(
    private readonly repository: CampaignRepository,
    private readonly fileExists: (relativePath: string) => boolean,
    private readonly toUrl: (relativePath: string) => string,
    private readonly audit: AuditLog,
    private readonly now: () => Date = () => new Date()
  ) {}

  listAvailable(): CampaignSummary[] {
    const result: CampaignSummary[] = []
    for (const campaign of this.repository.listActiveInPeriod(this.now().toISOString())) {
      const evaluation = this.evaluate(campaign)
      if (evaluation.problems.length > 0) {
        this.reportUnavailable(campaign, evaluation.problems)
        continue
      }
      result.push(this.summary(campaign, evaluation))
    }
    return result
  }

  /**
   * Detalle para la selección. Con `allowInactive`, una sesión que ya eligió la campaña puede
   * terminar aunque se haya desactivado después, si sus recursos siguen disponibles (RF-EXP-007).
   */
  getDetail(campaignId: string, options: { allowInactive?: boolean } = {}): (CampaignDetail & { configVersion: number }) | null {
    const campaign = this.repository.getById(campaignId)
    if (!campaign) return null
    if (!options.allowInactive && !this.isActiveInPeriod(campaign)) return null

    const evaluation = this.evaluate(campaign)
    if (evaluation.problems.length > 0 || !evaluation.config) {
      this.reportUnavailable(campaign, evaluation.problems)
      return null
    }

    const option = (r: CampaignResourceRecord): ResourceOption => ({
      id: r.resourceId,
      name: r.name,
      imageUrl: this.toUrl(r.filePath),
      width: r.width,
      height: r.height,
      layer: r.layerOrder,
      ...(r.type === 'scenario' ? { photoHole: r.photoHole ?? null } : {})
    })
    const optionsOf = (type: CampaignResourceRecord['type']) => evaluation.usable(type).map(option)
    const cameraScenario: ResourceOption = {
      id: CAMERA_SCENARIO_ID,
      name: CAMERA_SCENARIO_NAME,
      imageUrl: '',
      width: 1080,
      height: 1920,
      layer: 0,
      photoHole: null
    }
    const scenarios = [
      ...(evaluation.config.allowCameraBackground ? [cameraScenario] : []),
      ...evaluation.scenarios.map(option)
    ]
    // Cada personaje indica los escenarios con los que se ofrece.
    const characters: CharacterOption[] = evaluation.usable('character')
      .map((r) => ({
        ...option(r),
        animationUrl: r.animationPath && this.fileExists(r.animationPath) ? this.toUrl(r.animationPath) : null,
        animationDurationMs: r.animationDurationMs ?? null,
        animationBackground: r.animationBackground ?? 'alpha',
        entryDirection: r.entryDirection ?? 'auto',
        contentBounds: r.contentBounds ?? { x: 0, y: 0, width: 1, height: 1 },
        anchorX: r.anchorX ?? 0.5,
        anchorY: r.anchorY ?? 1,
        scenarioIds: scenarios
          .filter((s) => s.id === CAMERA_SCENARIO_ID || evaluation.charactersFor(s.id).some((c) => c.resourceId === r.resourceId))
          .map((s) => s.id)
      }))
      .filter((c) => c.scenarioIds.length > 0)
    const overlays: OverlayOption[] = [...evaluation.usable('logo'), ...evaluation.usable('other')].map((r) => ({
      ...option(r),
      x: r.posX,
      y: r.posY,
      scale: r.scale
    }))
    const { config } = evaluation

    return {
      ...this.summary(campaign, evaluation),
      configVersion: campaign.configVersion,
      photo: config.photo,
      scenarios,
      allowCameraBackground: config.allowCameraBackground,
      characterMode: config.characterMode,
      characters: config.characterMode === 'none' ? [] : characters,
      characterSlots: config.characterSlots,
      characterVideoTransforms: config.characterVideoTransforms,
      freePlacement: config.freePlacement,
      characterAnimation: config.characterAnimation,
      frameMode: config.frameMode,
      frames: config.frameMode === 'none' ? [] : optionsOf('frame'),
      overlays
    }
  }

  private evaluate(campaign: CampaignRecord): CampaignEvaluation {
    return evaluateCampaign(
      campaign,
      this.repository.listResources(campaign.id),
      this.fileExists,
      this.repository.listScenarioCharacters(campaign.id)
    )
  }

  private isActiveInPeriod(campaign: CampaignRecord): boolean {
    const now = this.now().toISOString()
    return (
      campaign.status === 'active' &&
      (campaign.startsAt === null || campaign.startsAt <= now) &&
      (campaign.endsAt === null || campaign.endsAt > now)
    )
  }

  /**
   * Tarjeta de la campaña: su imagen de presentación si se cargó; si no, la del primer escenario
   * (en el orden del panel), para que la tarjeta muestre la experiencia sin pasos adicionales.
   */
  private summary(campaign: CampaignRecord, evaluation: CampaignEvaluation): CampaignSummary {
    const hasImage = campaign.imagePath !== null && this.fileExists(campaign.imagePath)
    const firstScenario = evaluation.scenarios[0]
    return {
      id: campaign.id,
      name: campaign.name,
      description: campaign.description,
      imageUrl: hasImage ? this.toUrl(campaign.imagePath!) : firstScenario ? this.toUrl(firstScenario.filePath) : null
    }
  }

  /** Una campaña activa pero incompleta no se muestra; se registra una vez por cada conjunto de problemas. */
  private reportUnavailable(campaign: CampaignRecord, problems: string[]): void {
    const key = `${campaign.id}:${problems.join(',')}`
    if (this.reported.has(key)) return
    this.reported.add(key)
    this.audit.record({
      level: 'warn',
      category: 'content',
      action: 'campaign.unavailable',
      result: 'skipped',
      entity: { type: 'campaign', id: campaign.id },
      detail: { code: campaign.code, problems }
    })
  }
}
