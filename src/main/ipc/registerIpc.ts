import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { ipcMain } from 'electron'
import { contentUrl } from '../../infra/storage/contentPaths'
import { z } from 'zod'
import {
  IPC,
  type AppStatus,
  type AttractMediaItem,
  type PublicSettings,
  type StartSessionResult
} from '../../shared/ipc'
import { MAX_CHARACTERS, type CampaignDetail, type CampaignList } from '../../shared/campaign'
import { MAX_GUIDE_SIDE, type ComposeResult, type RetakeResult, type SaveCaptureResult } from '../../shared/capture'
import type { PublishResult } from '../../shared/publication'
import { registrationInputSchema, type ConsentText, type RegistrationResult } from '../../shared/registration'
import { DEFAULT_SETTINGS } from '../../shared/settings'
import { encodeFrame } from '../../infra/imaging/frameEncoder'
import { freeDiskMegabytes } from '../../infra/storage/paths'
import type { BootstrapOutcome } from '../bootstrap'
import type { AdminApi } from '../admin/adminApi'
import type { AdminResult, AdminStatus, LoginResult } from '../../shared/admin'
import { controlledQuit } from '../kiosk/kioskGuard'

export interface IpcOptions {
  outcome: BootstrapOutcome
  isDev: boolean
  version: string
  admin: AdminApi | null
}

const endSessionArgs = z.tuple([z.uuid(), z.enum(['completed', 'cancelled', 'timeout'])])
const mediaErrorArgs = z.tuple([z.string().min(1).max(64)])
const sessionArgs = z.tuple([z.uuid()])
const selectCampaignArgs = z.tuple([z.uuid(), z.string().min(1).max(64)])
const guideSchema = z
  .object({
    width: z.number().int().positive().max(MAX_GUIDE_SIDE),
    height: z.number().int().positive().max(MAX_GUIDE_SIDE),
    alpha: z.instanceof(Uint8Array)
  })
  .refine((g) => g.alpha.byteLength === g.width * g.height)
const saveCaptureArgs = z.tuple([
  z.uuid(),
  z.object({ width: z.number().int().positive(), height: z.number().int().positive(), rgba: z.instanceof(Uint8Array) }),
  // Una guía inválida no impide la foto: se recorta solo con el modelo fino.
  guideSchema.nullable().catch(null)
])
/** Ubicación elegida por el participante; el servicio la vuelve a limitar según la campaña. */
const placementSchema = z.object({ x: z.number().finite(), y: z.number().finite(), scale: z.number().finite().positive() })
const rectSchema = z.object({ x: z.number().finite(), y: z.number().finite(), width: z.number().finite(), height: z.number().finite() })
/** Encuadre de la cámara que mostraba la vista previa; el compositor lo vuelve a validar. */
const framePlacementSchema = z.object({ crop: rectSchema, box: rectSchema })
const composeArgs = z.tuple([
  z.uuid(),
  z.array(placementSchema.nullable()).max(MAX_CHARACTERS).catch([]),
  framePlacementSchema.nullable().optional().catch(null)
])
const cameraProblemArgs = z.tuple([z.enum(['not_found', 'permission_denied', 'in_use', 'failed', 'disconnected', 'resolution_unsupported'])])

export function registerIpc({ outcome, isDev, version, admin }: IpcOptions): void {
  const context = outcome.ok ? outcome.context : null

  ipcMain.handle(IPC.getStatus, (): AppStatus => {
    const status: AppStatus = { state: outcome.ok ? 'ready' : 'unavailable', version, isDev }
    if (!isDev) return status

    const dataRoot = outcome.ok ? outcome.context.paths.root : outcome.paths.root
    let freeDiskMb: number | undefined
    try {
      freeDiskMb = freeDiskMegabytes(dataRoot)
    } catch {
      freeDiskMb = undefined
    }
    status.diagnostics = outcome.ok
      ? {
          warnings: outcome.warnings,
          dataRoot,
          schemaVersion: outcome.context.schemaVersion,
          freeDiskMb,
          startedAt: outcome.startedAt
        }
      : { failure: outcome.failure, warnings: [], dataRoot, freeDiskMb, startedAt: outcome.startedAt }
    return status
  })

  ipcMain.handle(IPC.getPublicSettings, (): PublicSettings => {
    const { session, capture, chroma, background, attract, download, timezone, admin: adminSettings } = context?.settings.get() ?? DEFAULT_SETTINGS
    const { logoPath, backgroundPath, ...attractTexts } = attract
    // Solo se publican las imágenes que existen; si falta alguna, la pantalla usa su versión sin imagen.
    const urlOf = (path: string) => (path && context && existsSync(join(context.paths.content, path)) ? contentUrl(path) : null)
    return {
      adminSessionTimeoutSeconds: adminSettings.sessionTimeoutSeconds,
      session: { ...session },
      chroma: { ...chroma },
      background: { method: background.method },
      attract: { ...attractTexts, tiles: attract.tiles.map((t) => ({ ...t })), logoUrl: urlOf(logoPath), backgroundUrl: urlOf(backgroundPath) },
      download: { qrDisplaySeconds: download.qrDisplaySeconds },
      timezone,
      capture: {
        countdownSeconds: capture.countdownSeconds,
        soundEnabled: capture.soundEnabled,
        mirror: capture.mirror,
        cameraLabel: capture.cameraLabel,
        framingPercent: capture.framingPercent,
        autoFraming: capture.autoFraming,
        matchCharacterSize: capture.matchCharacterSize,
        rotation: capture.rotation,
        positionHint: capture.positionHint,
        cameraControlsEnabled: capture.cameraControlsEnabled,
        cameraControls: capture.cameraControls,
        maxRetakes: capture.maxRetakes
      }
    }
  })

  ipcMain.handle(IPC.listAttractMedia, (): AttractMediaItem[] => context?.attract.list() ?? [])

  ipcMain.handle(IPC.reportMediaError, (_event, ...args: unknown[]) => {
    const parsed = mediaErrorArgs.safeParse(args)
    if (parsed.success) context?.attract.reportPlaybackError(parsed.data[0])
  })

  ipcMain.handle(
    IPC.startSession,
    (): StartSessionResult => context?.sessions.start() ?? { ok: false, reason: 'unavailable' }
  )

  ipcMain.handle(IPC.endSession, (_event, ...args: unknown[]) => {
    const parsed = endSessionArgs.safeParse(args)
    if (parsed.success) context?.sessions.end(parsed.data[0], parsed.data[1])
  })

  ipcMain.handle(IPC.listCampaigns, (_event, ...args: unknown[]): CampaignList => {
    const empty: CampaignList = { campaigns: [], skipSingleCampaign: false }
    const parsed = sessionArgs.safeParse(args)
    if (!context || !parsed.success || !context.sessions.get(parsed.data[0])) return empty
    return {
      campaigns: context.campaigns.listAvailable(),
      skipSingleCampaign: context.settings.get().experience.skipSingleCampaign
    }
  })

  ipcMain.handle(IPC.selectCampaign, (_event, ...args: unknown[]): CampaignDetail | null => {
    const parsed = selectCampaignArgs.safeParse(args)
    if (!context || !parsed.success) return null
    const [sessionId, campaignId] = parsed.data
    if (!context.sessions.get(sessionId)) return null
    const detail = context.campaigns.getDetail(campaignId)
    if (!detail) return null
    const { configVersion, ...publicDetail } = detail
    return context.sessions.selectCampaign(sessionId, { id: campaignId, configVersion }) ? publicDetail : null
  })

  ipcMain.handle(IPC.listConsents, (): ConsentText[] => context?.consents.listActive() ?? [])

  ipcMain.handle(IPC.register, (_event, input: unknown): RegistrationResult => {
    const parsed = registrationInputSchema.safeParse(input)
    if (!context) return { ok: false, error: 'storage_error' }
    if (!parsed.success) return { ok: false, error: 'invalid_data' }
    return context.registration.register(parsed.data)
  })

  ipcMain.handle(IPC.saveCapture, async (_event, ...args: unknown[]): Promise<SaveCaptureResult> => {
    const parsed = saveCaptureArgs.safeParse(args)
    if (!context || !parsed.success) return { ok: false, error: 'invalid_image', attemptsLeft: 0 }
    // Un cuadro inválido llega vacío al servicio, que lo registra y lo cuenta como intento fallido.
    const jpeg = await encodeFrame(parsed.data[1]).catch(() => new Uint8Array(0))
    return context.capture.saveCapture(parsed.data[0], jpeg, parsed.data[2])
  })

  ipcMain.handle(IPC.compose, async (_event, ...args: unknown[]): Promise<ComposeResult> => {
    const parsed = composeArgs.safeParse(args)
    if (!context || !parsed.success) return { ok: false, error: 'session_invalid', attemptsLeft: 0 }
    return context.capture.compose(parsed.data[0], parsed.data[1], parsed.data[2] ?? null)
  })

  ipcMain.handle(IPC.retake, (_event, ...args: unknown[]): RetakeResult => {
    const parsed = sessionArgs.safeParse(args)
    if (!context || !parsed.success) return { ok: false, error: 'session_invalid' }
    return context.capture.retake(parsed.data[0])
  })

  ipcMain.handle(IPC.publish, async (_event, ...args: unknown[]): Promise<PublishResult> => {
    const parsed = sessionArgs.safeParse(args)
    if (!context || !parsed.success) return { ok: false, reason: 'session_invalid' }
    return context.publication.publish(parsed.data[0])
  })

  ipcMain.handle(IPC.reportCameraProblem, (_event, ...args: unknown[]) => {
    const parsed = cameraProblemArgs.safeParse(args)
    if (!parsed.success) return
    context?.audit.record({
      level: 'error',
      category: 'camera',
      action: 'camera.unavailable',
      result: 'fail',
      detail: { problem: parsed.data[0] }
    })
  })

  ipcMain.handle(IPC.reservedGesture, () => {
    context?.audit.record({ level: 'info', category: 'kiosk', action: 'reserved_gesture', result: 'ok' })
  })

  // Cierre público solicitado por el operador del tótem: no necesita una sesión administrativa.
  ipcMain.handle(IPC.confirmQuit, (_event, confirmed: unknown) => {
    if (confirmed !== true) return
    controlledQuit(context?.audit)
  })

  // Módulo administrativo (8.11 a 8.23): toda operación se valida en AdminApi.
  ipcMain.handle(IPC.adminStatus, (): AdminStatus => admin?.status() ?? { setupRequired: false })
  ipcMain.handle(IPC.adminSetup, (_event, payload: unknown) => admin?.setup(payload) ?? { ok: false, error: 'invalid_credentials' })
  ipcMain.handle(IPC.adminLogin, (_event, payload: unknown): LoginResult => admin?.login(payload) ?? { ok: false, error: 'invalid_credentials' })
  ipcMain.handle(IPC.admin, (_event, token: unknown, method: unknown, payload: unknown): Promise<AdminResult<unknown>> =>
    admin ? admin.invoke(token, method, payload) : Promise.resolve({ ok: false, error: 'unavailable', message: 'Servicio no disponible' })
  )
}
