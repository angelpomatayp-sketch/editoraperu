import { randomUUID } from 'node:crypto'
import { CAMERA_PHOTO_REGION, CAMERA_SCENARIO_ID, type CampaignConfig, type CharacterSlot, type Selections } from '../../shared/campaign'
import type { ComposeResult, PersonGuide, RetakeResult, SaveCaptureResult } from '../../shared/capture'
import { OUTPUT } from '../../shared/composition'
import type { ChromaSettings } from '../../shared/chroma'
import {
  buildCompositionPlan,
  photoRegionFor,
  placeCharacters,
  planResources,
  sanitizePlacement,
  type CompositionInputs,
  type FramePlacement,
  type LayerResource,
  type PlannedLayer
} from '../../shared/compositionPlan'
import type { Settings } from '../../shared/settings'
import type { AuditLog } from '../audit/auditLog'
import type { SessionService } from '../session/sessionService'

export interface StoredImage {
  /** Ruta relativa a la carpeta de datos. */
  filePath: string
  format: string
  width: number
  height: number
  sizeBytes: number
}

export class InvalidImageError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidImageError'
  }
}

export class InsufficientResolutionError extends InvalidImageError {
  constructor(readonly width: number, readonly height: number) {
    super(`Se requiere una captura original 4K; se recibió ${width} × ${height}`)
    this.name = 'InsufficientResolutionError'
  }
}

export interface PhotoFiles {
  /** Valida y guarda la captura original. Lanza `InvalidImageError` si no es una imagen válida. */
  saveOriginal(photoId: string, jpeg: Uint8Array): Promise<StoredImage>
  /** Ruta relativa donde se guardará la composición final. */
  finalPath(photoId: string): string
  readAsDataUrl(filePath: string): Promise<string>
  remove(filePath: string): void
}

/** Cómo quitar el fondo de la captura antes de ubicar a la persona sobre el escenario. */
export type BackgroundRemoval =
  | { method: 'chroma'; chroma: ChromaSettings; matchSceneTone?: boolean }
  | { method: 'segmentation'; guide: PersonGuide | null; matchSceneTone?: boolean }
  | null

export interface Compositor {
  /** Genera la imagen final; no deja archivos parciales si falla (12.7). */
  /** `framing`: encuadre de la cámara en la zona de la persona, de 0 (imagen completa) a 1 (llenar la zona). */
  compose(
    plan: PlannedLayer[],
    originalPath: string,
    outputPath: string,
    removal: BackgroundRemoval,
    framing?: number,
    /** Encuadre de la vista previa (automático); tiene prioridad sobre `framing`. */
    frame?: FramePlacement | null,
    /**
     * Zona transparente de un escenario: lo que la imagen no cubre se rellena con la misma foto
     * ampliada y desenfocada, para no dejar huecos sin forzar zoom.
     */
    backdrop?: boolean
  ): Promise<StoredImage>
}

export interface ParticipationForCapture {
  id: string
  status: string
  campaignId: string
  selections: Selections
  config: CampaignConfig
  resources: LayerResource[]
}

export interface CaptureRepository {
  loadParticipation(participationId: string): ParticipationForCapture | null
  insertPhoto(photo: { id: string; participationId: string; kind: 'original' | 'final'; status: 'captured' | 'composed' } & StoredImage): void
  markPhotoDeleted(photoId: string): void
  setParticipationStatus(participationId: string, status: 'registered' | 'captured' | 'composed'): void
}

export interface CaptureDeps {
  sessions: SessionService
  repository: CaptureRepository
  files: PhotoFiles
  compositor: Compositor
  settings: () => Settings
  /** Hay espacio suficiente para guardar archivos (RF-ALM-002). */
  hasDiskSpace: () => boolean
  contentFileExists: (relativePath: string) => boolean
  audit: AuditLog
  newId?: () => string
}

interface CaptureState {
  sessionId: string
  failures: number
  retakes: number
  /** La silueta guía solo vive en memoria: sirve para componer esta captura y se descarta con ella. */
  original: (StoredImage & { id: string; guide: PersonGuide | null }) | null
  final: StoredImage & { id: string } | null
}

/**
 * Arma las entradas de composición a partir de las selecciones guardadas en la participación y, si
 * la campaña lo permite, de la ubicación de los personajes elegida por el participante.
 */
export function compositionInputs(p: ParticipationForCapture, placements: (CharacterSlot | null)[] = []): CompositionInputs | null {
  const byId = (id: string | null) => (id === null ? null : (p.resources.find((r) => r.id === id) ?? null))
  const cameraBackground = p.selections.scenarioId === CAMERA_SCENARIO_ID
  const scenario = cameraBackground ? null : byId(p.selections.scenarioId)
  if (!cameraBackground && !scenario) return null
  const characters = p.selections.characterIds.map(byId)
  const frame = byId(p.selections.frameId)
  if (characters.some((c) => c === null) || (p.selections.frameId && !frame)) return null
  const { region, fillsHole } = cameraBackground
    ? { region: CAMERA_PHOTO_REGION, fillsHole: false }
    : photoRegionFor(p.config.photo, scenario ?? undefined, OUTPUT)
  return {
    photoRegion: region,
    fillsHole,
    scenario,
    characters: placeCharacters(characters as LayerResource[], p.config.characterSlots, {
      placements,
      videoTransforms: p.config.characterVideoTransforms,
      limits: p.config.freePlacement,
      output: OUTPUT
    }),
    frame,
    overlays: p.resources.filter((r) => r.type === 'logo' || r.type === 'other')
  }
}

/**
 * Captura, composición y repetición (8.7 a 8.9). Solo una sesión con participación registrada
 * puede capturar (RN-002). Los fallos se cuentan para cancelar de forma segura al superar el
 * límite configurado (RF-CAP-007).
 */
export class CaptureService {
  private state: CaptureState | null = null
  private readonly newId: () => string

  constructor(private readonly deps: CaptureDeps) {
    this.newId = deps.newId ?? randomUUID
  }

  async saveCapture(sessionId: string, jpeg: Uint8Array, guide: PersonGuide | null = null): Promise<SaveCaptureResult> {
    const checked = this.check(sessionId)
    if (!checked.ok) return { ok: false, error: checked.error, attemptsLeft: this.attemptsLeft() }
    const { state, participationId } = checked
    if (state.original) return { ok: false, error: 'already_captured', attemptsLeft: this.attemptsLeft() }
    if (!this.deps.hasDiskSpace()) {
      this.record('warn', 'capture.save', 'denied', { reason: 'insufficient_disk' })
      return { ok: false, error: 'insufficient_disk', attemptsLeft: this.attemptsLeft() }
    }

    const photoId = this.newId()
    let stored: StoredImage
    try {
      stored = await this.deps.files.saveOriginal(photoId, jpeg)
    } catch (error) {
      state.failures++
      const reason = error instanceof InsufficientResolutionError ? 'resolution_unsupported'
        : error instanceof InvalidImageError ? 'invalid_image' : 'storage_error'
      this.record('error', 'capture.save', 'fail', { reason, error,
        ...(error instanceof InsufficientResolutionError ? { width: error.width, height: error.height } : {}) })
      return { ok: false, error: reason, attemptsLeft: this.attemptsLeft() }
    }

    this.deps.repository.insertPhoto({ id: photoId, participationId, kind: 'original', status: 'captured', ...stored })
    this.deps.repository.setParticipationStatus(participationId, 'captured')
    state.original = { id: photoId, ...stored, guide }
    this.record('info', 'capture.save', 'ok', { width: stored.width, height: stored.height, guide: guide !== null }, photoId)
    return { ok: true }
  }

  async compose(sessionId: string, placements: (CharacterSlot | null)[] = [], frame: FramePlacement | null = null): Promise<ComposeResult> {
    const checked = this.check(sessionId)
    if (!checked.ok) {
      const error = checked.error === 'too_many_attempts' ? 'too_many_attempts' : 'session_invalid'
      return { ok: false, error, attemptsLeft: this.attemptsLeft() }
    }
    const { state, participationId } = checked
    if (!state.original) return { ok: false, error: 'no_capture', attemptsLeft: this.attemptsLeft() }

    const participation = this.deps.repository.loadParticipation(participationId)
    const inputs = participation ? compositionInputs(participation, placements) : null
    if (!inputs) return this.composeFailure(state, 'resource_missing', { reason: 'selection_not_found' })

    const plan = buildCompositionPlan(inputs, OUTPUT)
    const missing = planResources(plan).filter((r) => !this.deps.contentFileExists(r.src))
    if (missing.length > 0) return this.composeFailure(state, 'resource_missing', { missing: missing.map((r) => r.id) })

    const finalId = this.newId()
    let stored: StoredImage
    try {
      const started = Date.now()
      const { chroma, background, capture } = this.deps.settings()
      // En la zona transparente de un escenario va la foto con su fondo, con el mismo encuadre de siempre.
      const removal: BackgroundRemoval = !inputs.scenario || inputs.fillsHole
        ? null
        : background.method === 'chroma'
          ? { method: 'chroma', chroma, matchSceneTone: capture.matchSceneTone }
          : background.method === 'segmentation'
            ? { method: 'segmentation', guide: state.original.guide, matchSceneTone: capture.matchSceneTone }
            : null
      const framing = capture.framingPercent / 100
      // El encuadre automático solo aplica con recorte automático y si está activado.
      const automaticEnabled = capture.autoFraming || (capture.matchCharacterSize && inputs.characters.length > 0)
      const autoFrame = removal?.method === 'segmentation' && automaticEnabled && frame ? sanitizePlacement(frame) : null
      stored = await this.deps.compositor.compose(
        plan,
        state.original.filePath,
        this.deps.files.finalPath(finalId),
        removal,
        framing,
        autoFrame,
        inputs.fillsHole === true
      )
      const characters = plan.flatMap((l) => (l.kind === 'placed' && l.resource.type === 'character' ? [{ left: l.left, top: l.top, width: l.width }] : []))
      this.record('info', 'composition.compose', 'ok', { layers: plan.length, characters, milliseconds: Date.now() - started }, finalId)
    } catch (error) {
      return this.composeFailure(state, 'composition_failed', { error })
    }

    if (state.final) this.discard(state.final)
    this.deps.repository.insertPhoto({ id: finalId, participationId, kind: 'final', status: 'composed', ...stored })
    this.deps.repository.setParticipationStatus(participationId, 'composed')
    state.final = { id: finalId, ...stored }
    return { ok: true, imageDataUrl: await this.deps.files.readAsDataUrl(stored.filePath), retakesLeft: this.retakesLeft() }
  }

  /** Descarta la foto actual para tomar otra, dentro del límite configurado (RF-CAP-006). */
  retake(sessionId: string): RetakeResult {
    const checked = this.check(sessionId)
    if (!checked.ok) return { ok: false, error: 'session_invalid' }
    const { state, participationId } = checked
    if (this.retakesLeft() <= 0) return { ok: false, error: 'limit_reached' }

    if (state.original) this.discard(state.original)
    if (state.final) this.discard(state.final)
    state.original = null
    state.final = null
    state.retakes++
    this.deps.repository.setParticipationStatus(participationId, 'registered')
    this.record('info', 'capture.retake', 'ok', { retakes: state.retakes })
    return { ok: true, retakesLeft: this.retakesLeft() }
  }

  private check(
    sessionId: string
  ):
    | { ok: true; state: CaptureState; participationId: string }
    | { ok: false; error: 'session_invalid' | 'not_registered' | 'too_many_attempts' } {
    const session = this.deps.sessions.get(sessionId)
    if (!session) return { ok: false, error: 'session_invalid' }
    if (!session.participationId) return { ok: false, error: 'not_registered' }
    if (this.state?.sessionId !== sessionId) {
      this.state = { sessionId, failures: 0, retakes: 0, original: null, final: null }
    }
    if (this.attemptsLeft() <= 0) return { ok: false, error: 'too_many_attempts' }
    return { ok: true, state: this.state, participationId: session.participationId }
  }

  private composeFailure(state: CaptureState, error: 'resource_missing' | 'composition_failed', detail: Record<string, unknown>): ComposeResult {
    state.failures++
    this.record('error', 'composition.compose', 'fail', { reason: error, ...detail })
    return { ok: false, error, attemptsLeft: this.attemptsLeft() }
  }

  /** Las capturas descartadas se eliminan; solo queda constancia técnica (PD-003 pendiente). */
  private discard(photo: { id: string; filePath: string }): void {
    this.deps.files.remove(photo.filePath)
    this.deps.repository.markPhotoDeleted(photo.id)
  }

  private attemptsLeft(): number {
    return Math.max(0, this.deps.settings().capture.maxAttempts - (this.state?.failures ?? 0))
  }

  private retakesLeft(): number {
    return Math.max(0, this.deps.settings().capture.maxRetakes - (this.state?.retakes ?? 0))
  }

  private record(
    level: 'info' | 'warn' | 'error',
    action: string,
    result: 'ok' | 'fail' | 'denied',
    detail: Record<string, unknown>,
    photoId?: string
  ): void {
    this.deps.audit.record({
      level,
      category: action.startsWith('composition') ? 'composition' : 'camera',
      action,
      result,
      ...(photoId ? { entity: { type: 'photo', id: photoId } } : {}),
      detail
    })
  }
}
