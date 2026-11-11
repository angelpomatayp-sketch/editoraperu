import { randomBytes, randomUUID } from 'node:crypto'
import { existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type { AdminCampaign, AdminInput, AdminMedia, AdminResource, CampaignListItem } from '../../shared/admin'
import { campaignConfigSchema, DEFAULT_CHARACTER_ANIMATION, DEFAULT_FREE_PLACEMENT, DEFAULT_PHOTO_REGION, type CampaignConfig } from '../../shared/campaign'
import type { AuditLog } from '../../core/audit/auditLog'
import { evaluateCampaign, type CampaignRecord, type CampaignResourceRecord } from '../../core/campaigns/campaignCatalog'
import type { AdminContentRepository, CampaignRow, ResourceRow } from '../../infra/db/repositories/adminContentRepository'
import { importCharacter, importCharacterAnimation, importImage, importMedia, ImportError, type ImportedCharacter, type ImportedFile } from '../../infra/imaging/resourceImport'
import { detectPhotoHole } from '../../infra/imaging/photoHole'
import { analyzeCharacter } from '../../infra/imaging/characterAnalysis'
import { repairGreenScreenPose } from '../../infra/imaging/characterVideo'
import { parsePhotoHole, type FractionRect } from '../../shared/compositionPlan'
import type { ModnetSegmenter } from '../../infra/imaging/modnetSegmenter'

export class AdminError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message)
    this.name = 'AdminError'
  }
}

export type FileKind = 'image' | 'character' | 'media' | 'animation'

export interface ContentAdminDeps {
  repo: AdminContentRepository
  contentDir: string
  toUrl: (relativePath: string) => string
  /** Diálogo para elegir un archivo; `null` si se canceló. */
  pickFile: (kind: FileKind) => Promise<string | null>
  audit: AuditLog
  segmenter?: ModnetSegmenter | null
  now?: () => Date
}

const LAYER: Record<'scenario' | 'character' | 'frame' | 'logo', number> = { scenario: 0, character: 20, frame: 30, logo: 40 }
const TYPE_LABEL: Record<string, string> = { scenario: 'escenario', character: 'personaje', frame: 'marco', logo: 'logotipo', other: 'elemento' }

const DEFAULT_CONFIG: CampaignConfig = {
  characterMode: 'required',
  frameMode: 'optional',
  allowCameraBackground: false,
  photo: { x: 0.12, y: 0.2, width: 0.76, height: 0.665, layer: DEFAULT_PHOTO_REGION.layer },
  characterSlots: [
    { x: -0.02, y: 0.45, scale: 0.36 },
    { x: 0.66, y: 0.45, scale: 0.36 }
  ],
  freePlacement: DEFAULT_FREE_PLACEMENT,
  characterAnimation: DEFAULT_CHARACTER_ANIMATION
}

function parseConfig(json: string): CampaignConfig {
  try {
    const parsed = campaignConfigSchema.safeParse(JSON.parse(json))
    if (parsed.success) return parsed.data
  } catch {
    // Configuración dañada: se muestra la de por defecto y se puede guardar de nuevo.
  }
  return DEFAULT_CONFIG
}

function toRecord(row: CampaignRow): CampaignRecord {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description,
    imagePath: row.image_path,
    status: row.status,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    configJson: row.config_json,
    configVersion: row.config_version
  }
}

/**
 * Administración de campañas, recursos gráficos y contenido de atracción (8.13 a 8.15).
 * Las campañas con participaciones nunca se eliminan físicamente (RF-CAM-006) y un recurso usado
 * se archiva en lugar de eliminarse (RF-REC-006).
 */
export class ContentAdmin {
  private readonly now: () => Date

  constructor(private readonly deps: ContentAdminDeps) {
    this.now = deps.now ?? (() => new Date())
  }

  // ----- Campañas -----

  listCampaigns(): CampaignListItem[] {
    return this.deps.repo.listCampaigns().map((row) => ({
      id: row.id,
      code: row.code,
      name: row.name,
      status: row.status,
      startsAt: row.starts_at,
      endsAt: row.ends_at,
      scenarios: row.scenarios,
      participations: row.participations,
      problems: this.problems(row)
    }))
  }

  getCampaign(id: string): AdminCampaign {
    const row = this.campaign(id)
    const config = parseConfig(row.config_json)
    const links = this.deps.repo.scenarioLinks(id)
    const resources: AdminResource[] = this.deps.repo.listResources(id).map((r) => ({
      id: r.id,
      type: r.type,
      name: r.name,
      imageUrl: this.deps.toUrl(r.file_path),
      animationUrl: r.animation_path && this.exists(r.animation_path) ? this.deps.toUrl(r.animation_path) : null,
      animationDurationMs: r.animation_duration_ms,
      animationBackground: r.animation_background,
      width: r.width,
      height: r.height,
      active: r.status === 'active',
      sortOrder: r.sort_order,
      layer: r.layer_order,
      x: r.pos_x,
      y: r.pos_y,
      scale: r.scale,
      scenarioIds: r.type === 'character' ? links.filter((l) => l.character_id === r.id).map((l) => l.scenario_id) : [],
      photoHole: r.type === 'scenario' ? parsePhotoHole(r.photo_hole_json) : null,
      entryDirection: r.entry_direction,
      contentBounds: parsePhotoHole(r.content_bounds_json) ?? { x: 0, y: 0, width: 1, height: 1 },
      anchorX: r.anchor_x,
      anchorY: r.anchor_y
    }))
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      description: row.description ?? '',
      status: row.status,
      startsAt: row.starts_at,
      endsAt: row.ends_at,
      imageUrl: row.image_path && this.exists(row.image_path) ? this.deps.toUrl(row.image_path) : null,
      characterMode: config.characterMode,
      frameMode: config.frameMode,
      allowCameraBackground: config.allowCameraBackground,
      photo: config.photo,
      characterSlots: config.characterSlots,
      freePlacement: config.freePlacement,
      characterAnimation: config.characterAnimation,
      resources,
      problems: this.problems(row),
      participations: this.deps.repo.countParticipations(id)
    }
  }

  createCampaign(name: string, actorId: string): AdminCampaign {
    const id = randomUUID()
    const slug = name
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .toUpperCase()
      .slice(0, 24)
    const code = `${slug || 'CAMPANA'}-${randomBytes(2).toString('hex').toUpperCase()}`
    this.deps.repo.insertCampaign({ id, code, name, configJson: JSON.stringify(DEFAULT_CONFIG) }, this.iso())
    this.record('campaign.create', id, actorId, { code })
    return this.getCampaign(id)
  }

  updateCampaign(input: AdminInput<'campaigns.update'>, actorId: string): AdminCampaign {
    const row = this.campaign(input.id)
    if (input.startsAt && input.endsAt && input.endsAt <= input.startsAt) {
      throw new AdminError('invalid_dates', 'La fecha de fin debe ser posterior a la de inicio')
    }
    const config = {
      ...parseConfig(row.config_json),
      characterMode: input.characterMode,
      frameMode: input.frameMode,
      allowCameraBackground: input.allowCameraBackground
    }
    this.deps.repo.updateCampaign(
      input.id,
      { name: input.name, description: input.description, startsAt: input.startsAt ?? null, endsAt: input.endsAt ?? null, configJson: JSON.stringify(config) },
      this.iso()
    )
    this.record('campaign.update', input.id, actorId)
    return this.getCampaign(input.id)
  }

  /** Activar exige una configuración válida (RF-CAM-002, RF-CAM-003). */
  setStatus(id: string, status: 'active' | 'inactive' | 'archived', actorId: string): AdminCampaign {
    const row = this.campaign(id)
    if (status === 'active') {
      const problems = this.problems(row)
      if (problems.length > 0) throw new AdminError('invalid_campaign', `No se puede activar: ${problems.join(' ')}`)
    }
    this.deps.repo.setCampaignStatus(id, status, this.iso())
    this.record(`campaign.${status === 'active' ? 'activate' : status === 'archived' ? 'archive' : 'deactivate'}`, id, actorId)
    return this.getCampaign(id)
  }

  async setImage(id: string, actorId: string): Promise<AdminCampaign | null> {
    this.campaign(id)
    const imported = await this.importFrom('image', (path) => importImage(path, this.deps.contentDir, `campaigns/${id}`))
    if (!imported) return null
    this.deps.repo.setCampaignImage(id, imported.filePath, this.iso())
    this.record('campaign.image', id, actorId)
    return this.getCampaign(id)
  }

  /** Ubicación de la persona, posiciones de personajes y elementos superpuestos (RF-CMP-003, RF-REC-004). */
  saveLayout(input: AdminInput<'campaigns.saveLayout'>, actorId: string): AdminCampaign {
    const row = this.campaign(input.id)
    const current = parseConfig(row.config_json)
    const config = campaignConfigSchema.parse({
      ...current,
      photo: input.photo,
      characterSlots: input.characterSlots,
      freePlacement: input.freePlacement ?? current.freePlacement,
      characterAnimation: input.characterAnimation ?? current.characterAnimation
    })
    const resources = this.deps.repo.listResources(input.id)
    this.deps.repo.transaction(() => {
      this.deps.repo.updateCampaign(
        input.id,
        { name: row.name, description: row.description ?? '', startsAt: row.starts_at, endsAt: row.ends_at, configJson: JSON.stringify(config) },
        this.iso()
      )
      for (const overlay of input.overlays) {
        if (resources.some((r) => r.id === overlay.resourceId)) {
          this.deps.repo.setPlacement(input.id, overlay.resourceId, overlay.x, overlay.y, overlay.scale)
        }
      }
    })
    this.record('campaign.layout', input.id, actorId)
    return this.getCampaign(input.id)
  }

  // ----- Recursos -----

  async addResource(input: AdminInput<'resources.add'>, actorId: string): Promise<AdminCampaign | null> {
    this.campaign(input.campaignId)
    let characterAsset: ImportedCharacter | null = null
    let imported: ImportedFile | null
    if (input.type === 'character') {
      characterAsset = await this.importFrom('character', (path) => importCharacter(path, this.deps.contentDir, `campaigns/${input.campaignId}`, this.deps.segmenter ?? null))
      if (!characterAsset) return null
      imported = characterAsset.image
    } else {
      imported = await this.importFrom('image', (path) =>
        importImage(path, this.deps.contentDir, `campaigns/${input.campaignId}`, { requireAlpha: input.type === 'frame' })
      )
      if (!imported) return null
    }
    // Un escenario con zona transparente lleva la foto del participante en esa zona.
    const photoHole = input.type === 'scenario' ? await this.findPhotoHole(imported.filePath) : undefined
    const characterAnalysis = input.type === 'character' ? await this.findCharacterAnalysis(imported.filePath) : undefined

    const id = randomUUID()
    const sortOrder = this.deps.repo.nextSortOrder(input.campaignId)
    const place = input.type === 'logo' ? { x: 0.05, y: 0.035, scale: 0.15 } : { x: 0, y: 0, scale: 1 }
    this.deps.repo.transaction(() => {
      this.deps.repo.insertResource(
        {
          id,
          campaignId: input.campaignId,
          type: input.type,
          name: imported.name,
          filePath: imported.filePath,
          format: imported.format,
          width: imported.width,
          height: imported.height,
          sizeBytes: imported.sizeBytes,
          layerOrder: LAYER[input.type],
          ...place,
          // Los logotipos se aplican siempre a la composición.
          required: input.type === 'logo',
          sortOrder,
          photoHole,
          characterAnalysis
        },
        this.iso()
      )
      if (characterAsset?.animation) {
        this.deps.repo.setCharacterAnimation(
          id,
          characterAsset.animation.filePath,
          characterAsset.animation.format,
          characterAsset.animation.sizeBytes,
          characterAsset.animation.durationMs,
          characterAsset.animation.background,
          this.iso()
        )
      }
      if (input.type === 'character') this.deps.repo.setCharacterScenarios(input.campaignId, id, this.validScenarios(input.campaignId, input.scenarioIds ?? []))
    })
    this.record('resource.add', id, actorId, { campaignId: input.campaignId, type: input.type, width: imported.width, height: imported.height, photoHole: photoHole ?? null, animationFormat: characterAsset?.animation?.format ?? null })
    return this.getCampaign(input.campaignId)
  }

  /**
   * Revisa los escenarios subidos antes de existir la detección de zona transparente. Se ejecuta al
   * iniciar, en segundo plano; un archivo que no se puede leer queda sin zona (usa la de la campaña).
   */
  async checkPendingPhotoHoles(): Promise<number> {
    let checked = 0
    for (const scenario of this.deps.repo.listUncheckedScenarios()) {
      this.deps.repo.setPhotoHole(scenario.id, await this.findPhotoHole(scenario.file_path))
      checked++
    }
    return checked
  }

  async checkPendingCharacterAnalysis(): Promise<number> {
    let checked = 0
    for (const character of this.deps.repo.listUncheckedCharacters()) {
      const analysis = await this.findCharacterAnalysis(character.file_path)
      this.deps.repo.setCharacterAnalysis(character.id, analysis.bounds, analysis.anchorX, analysis.anchorY)
      checked++
    }
    return checked
  }

  /** Corrige automáticamente poses antiguas de croma que usaron un verde distinto al configurado. */
  async repairChromaCharacterPoses(): Promise<number> {
    let repaired = 0
    for (const character of this.deps.repo.listChromaCharacterPoses()) {
      try {
        if (await repairGreenScreenPose(
          join(this.deps.contentDir, character.file_path),
          join(this.deps.contentDir, character.animation_path)
        )) repaired++
      } catch {
        // Un recurso dañado no debe impedir el arranque ni la revisión de los demás.
      }
    }
    return repaired
  }

  private async findPhotoHole(relativePath: string): Promise<FractionRect | null> {
    try {
      return await detectPhotoHole(join(this.deps.contentDir, relativePath))
    } catch {
      return null
    }
  }

  private async findCharacterAnalysis(relativePath: string) {
    try {
      return await analyzeCharacter(join(this.deps.contentDir, relativePath))
    } catch {
      return { bounds: { x: 0, y: 0, width: 1, height: 1 }, anchorX: 0.5, anchorY: 1 }
    }
  }

  updateResource(input: AdminInput<'resources.update'>, actorId: string): AdminCampaign {
    const resource = this.resource(input.campaignId, input.resourceId)
    this.deps.repo.transaction(() => {
      this.deps.repo.updateResource(resource.id, input.name, input.active ? 'active' : 'inactive', this.iso())
      if (resource.type === 'character' && input.scenarioIds) {
        this.deps.repo.setCharacterScenarios(input.campaignId, resource.id, this.validScenarios(input.campaignId, input.scenarioIds))
      }
    })
    this.record('resource.update', resource.id, actorId, { active: input.active })
    return this.getCampaign(input.campaignId)
  }

  /** Adjunta o reemplaza el WebM transparente de un personaje; la imagen principal queda como pose final. */
  async setCharacterAnimation(input: AdminInput<'resources.setAnimation'>, actorId: string): Promise<AdminCampaign | null> {
    const resource = this.resource(input.campaignId, input.resourceId)
    if (resource.type !== 'character') throw new AdminError('invalid_resource', 'Solo los personajes pueden tener animación')
    const imported = await this.importFrom('animation', (path) =>
      importCharacterAnimation(path, this.deps.contentDir, `campaigns/${input.campaignId}/animations`)
    )
    if (!imported) return null
    const previous = resource.animation_path
    this.deps.repo.setCharacterAnimation(resource.id, imported.filePath, imported.format, imported.sizeBytes, null, 'alpha', this.iso())
    if (previous && previous !== imported.filePath) rmSync(join(this.deps.contentDir, previous), { force: true })
    this.record('resource.animation', resource.id, actorId, { format: imported.format, sizeBytes: imported.sizeBytes })
    return this.getCampaign(input.campaignId)
  }

  clearCharacterAnimation(input: AdminInput<'resources.clearAnimation'>, actorId: string): AdminCampaign {
    const resource = this.resource(input.campaignId, input.resourceId)
    if (resource.type !== 'character') throw new AdminError('invalid_resource', 'Solo los personajes pueden tener animación')
    this.deps.repo.setCharacterAnimation(resource.id, null, null, null, null, 'alpha', this.iso())
    if (resource.animation_path) rmSync(join(this.deps.contentDir, resource.animation_path), { force: true })
    this.record('resource.animation.clear', resource.id, actorId)
    return this.getCampaign(input.campaignId)
  }

  updateCharacterMotion(input: AdminInput<'resources.updateMotion'>, actorId: string): AdminCampaign {
    const resource = this.resource(input.campaignId, input.resourceId)
    if (resource.type !== 'character') throw new AdminError('invalid_resource', 'Solo los personajes tienen ajustes de movimiento')
    this.deps.repo.setCharacterMotion(resource.id, input.entryDirection, input.anchorX, input.anchorY, this.iso())
    this.record('resource.motion', resource.id, actorId, { entryDirection: input.entryDirection, anchorX: input.anchorX, anchorY: input.anchorY })
    return this.getCampaign(input.campaignId)
  }

  /** Cambia el orden dentro de su tipo (RF-REC-004). */
  moveResource(campaignId: string, resourceId: string, direction: 'up' | 'down', actorId: string): AdminCampaign {
    const resource = this.resource(campaignId, resourceId)
    const siblings = this.deps.repo.listResources(campaignId).filter((r) => r.type === resource.type)
    const index = siblings.findIndex((r) => r.id === resourceId)
    const other = siblings[direction === 'up' ? index - 1 : index + 1]
    if (other) {
      this.deps.repo.transaction(() => {
        this.deps.repo.setSortOrder(campaignId, resource.id, other.sort_order)
        this.deps.repo.setSortOrder(campaignId, other.id, resource.sort_order)
      })
      this.record('resource.move', resourceId, actorId, { direction })
    }
    return this.getCampaign(campaignId)
  }

  /** Elimina un recurso no usado; si alguna participación lo usó, lo archiva (RF-REC-006). */
  removeResource(campaignId: string, resourceId: string, actorId: string): { campaign: AdminCampaign; archived: boolean } {
    const resource = this.resource(campaignId, resourceId)
    const archived = this.deps.repo.isResourceReferenced(resourceId)
    if (archived) {
      this.deps.repo.archiveResource(resourceId, this.iso())
    } else {
      this.deps.repo.transaction(() => this.deps.repo.deleteResource(campaignId, resourceId))
      rmSync(join(this.deps.contentDir, resource.file_path), { force: true })
      if (resource.animation_path) rmSync(join(this.deps.contentDir, resource.animation_path), { force: true })
    }
    this.record(archived ? 'resource.archive' : 'resource.delete', resourceId, actorId, { type: resource.type })
    return { campaign: this.getCampaign(campaignId), archived }
  }

  // ----- Contenido de atracción (8.15) -----

  listMedia(): AdminMedia[] {
    return this.deps.repo.listMedia().map((m) => ({
      id: m.id,
      type: m.type,
      name: m.name,
      url: this.deps.toUrl(m.file_path),
      active: m.status === 'active',
      displaySeconds: m.display_seconds,
      sortOrder: m.sort_order,
      fileMissing: !this.exists(m.file_path)
    }))
  }

  async addMedia(actorId: string): Promise<AdminMedia[] | null> {
    const imported = await this.importFrom('media', (path) => importMedia(path, this.deps.contentDir, 'media/uploads'))
    if (!imported) return null
    const id = randomUUID()
    this.deps.repo.insertMedia(
      { id, type: imported.type, name: imported.name, filePath: imported.filePath, displaySeconds: imported.type === 'image' ? 8 : null },
      this.iso()
    )
    this.record('media.add', id, actorId, { type: imported.type, sizeBytes: imported.sizeBytes })
    return this.listMedia()
  }

  updateMedia(input: AdminInput<'media.update'>, actorId: string): AdminMedia[] {
    const media = this.media(input.id)
    this.deps.repo.updateMedia(
      media.id,
      { name: input.name, status: input.active ? 'active' : 'inactive', displaySeconds: media.type === 'image' ? (input.displaySeconds ?? 8) : null },
      this.iso()
    )
    this.record('media.update', media.id, actorId, { active: input.active })
    return this.listMedia()
  }

  moveMedia(id: string, direction: 'up' | 'down', actorId: string): AdminMedia[] {
    const list = this.deps.repo.listMedia()
    const index = list.findIndex((m) => m.id === id)
    const other = list[direction === 'up' ? index - 1 : index + 1]
    const current = list[index]
    if (current && other) {
      this.deps.repo.transaction(() => {
        this.deps.repo.setMediaSortOrder(current.id, other.sort_order)
        this.deps.repo.setMediaSortOrder(other.id, current.sort_order)
      })
      this.record('media.move', id, actorId, { direction })
    }
    return this.listMedia()
  }

  removeMedia(id: string, actorId: string): AdminMedia[] {
    const media = this.media(id)
    this.deps.repo.deleteMedia(id)
    rmSync(join(this.deps.contentDir, media.file_path), { force: true })
    this.record('media.delete', id, actorId)
    return this.listMedia()
  }

  // ----- Apoyo -----

  /** Problemas que impiden usar la campaña, en lenguaje claro (RF-CAM-003). */
  private problems(row: CampaignRow): string[] {
    const resources: CampaignResourceRecord[] = this.deps.repo.listResources(row.id).map((r: ResourceRow) => ({
      resourceId: r.id,
      type: r.type,
      name: r.name,
      filePath: r.file_path,
      animationPath: r.animation_path,
      animationDurationMs: r.animation_duration_ms,
      animationBackground: r.animation_background,
      entryDirection: r.entry_direction,
      contentBounds: parsePhotoHole(r.content_bounds_json) ?? { x: 0, y: 0, width: 1, height: 1 },
      anchorX: r.anchor_x,
      anchorY: r.anchor_y,
      status: r.status,
      isRequired: r.is_required === 1,
      sortOrder: r.sort_order,
      width: r.width,
      height: r.height,
      layerOrder: r.layer_order,
      posX: r.pos_x,
      posY: r.pos_y,
      scale: r.scale
    }))
    const links = this.deps.repo.scenarioLinks(row.id).map((l, i) => ({ scenarioId: l.scenario_id, characterId: l.character_id, sortOrder: i }))
    const { problems } = evaluateCampaign(toRecord(row), resources, (p) => this.exists(p), links)
    return problems.map((code) => {
      if (code === 'no_scenarios') return 'Agregue al menos un escenario activo o habilite «Usar fondo real de la cámara» en Datos.'
      if (code === 'no_characters') return 'La campaña exige personaje: agregue al menos un personaje activo o, si no usará personajes, en «Datos» cambie «Personajes» a «No se usa».'
      if (code === 'no_frames') return 'La campaña exige marco: agregue al menos un marco activo.'
      if (code === 'config_invalid') return 'La configuración de la campaña no es válida; vuelva a guardarla.'
      if (code.startsWith('required_resource_unavailable:')) {
        const r = resources.find((x) => x.resourceId === code.split(':')[1])
        return `El ${TYPE_LABEL[r?.type ?? 'other']} obligatorio "${r?.name ?? '?'}" está inactivo o le falta el archivo.`
      }
      return code
    })
  }

  private async importFrom<T>(kind: FileKind, run: (path: string) => Promise<T> | T): Promise<T | null> {
    const path = await this.deps.pickFile(kind)
    if (!path) return null
    try {
      return await run(path)
    } catch (error) {
      if (error instanceof ImportError) throw new AdminError('invalid_file', error.message)
      throw error
    }
  }

  private validScenarios(campaignId: string, scenarioIds: string[]): string[] {
    const scenarios = new Set(this.deps.repo.listResources(campaignId).filter((r) => r.type === 'scenario').map((r) => r.id))
    return [...new Set(scenarioIds)].filter((id) => scenarios.has(id))
  }

  private campaign(id: string): CampaignRow {
    const row = this.deps.repo.getCampaign(id)
    if (!row) throw new AdminError('not_found', 'La campaña no existe')
    return row
  }

  private resource(campaignId: string, resourceId: string): ResourceRow {
    const resource = this.deps.repo.listResources(campaignId).find((r) => r.id === resourceId)
    if (!resource) throw new AdminError('not_found', 'El recurso no existe')
    return resource
  }

  private media(id: string) {
    const media = this.deps.repo.getMedia(id)
    if (!media) throw new AdminError('not_found', 'El contenido no existe')
    return media
  }

  private exists(relativePath: string): boolean {
    return existsSync(join(this.deps.contentDir, relativePath))
  }

  private iso(): string {
    return this.now().toISOString()
  }

  private record(action: string, entityId: string, actorId: string, detail?: Record<string, unknown>): void {
    this.deps.audit.record({
      level: 'info',
      category: 'content',
      action,
      result: 'ok',
      actor: { type: 'user', id: actorId },
      entity: { type: action.split('.')[0]!, id: entityId },
      ...(detail ? { detail } : {})
    })
  }
}
