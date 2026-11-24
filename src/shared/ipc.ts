import type { AdminResult, AdminStatus, LoginResult, SetupResult } from './admin'
import type { PublicAttract } from './attract'
import type { CameraControls } from './cameraControls'
import type { CampaignDetail, CampaignList, CharacterSlot } from './campaign'
import type { FramePlacement } from './compositionPlan'
import type { CameraProblem, CapturedFrame, ComposeResult, PersonGuide, RetakeResult, SaveCaptureResult } from './capture'
import type { BackgroundMethod, ChromaSettings } from './chroma'
import type { PublishResult } from './publication'
import type { ConsentText, RegistrationInput, RegistrationResult } from './registration'

/** Canales IPC permitidos entre la interfaz y el proceso principal. */
export const IPC = {
  getStatus: 'app:get-status',
  getPublicSettings: 'settings:get-public',
  listAttractMedia: 'attract:list',
  reportMediaError: 'attract:media-error',
  startSession: 'session:start',
  endSession: 'session:end',
  listCampaigns: 'experience:list-campaigns',
  selectCampaign: 'experience:select-campaign',
  listConsents: 'consent:list-active',
  register: 'participation:register',
  saveCapture: 'capture:save',
  compose: 'capture:compose',
  retake: 'capture:retake',
  reportCameraProblem: 'camera:report-problem',
  publish: 'publication:publish',
  reservedGesture: 'kiosk:reserved-gesture',
  confirmQuit: 'kiosk:confirm-quit',
  adminStatus: 'admin:status',
  adminSetup: 'admin:setup',
  adminLogin: 'admin:login',
  admin: 'admin:invoke'
} as const

export type StartupFailure = 'storage_unavailable' | 'database_unavailable' | 'database_corrupt' | 'database_newer'

export interface AppStatus {
  state: 'ready' | 'unavailable'
  version: string
  isDev: boolean
  /** Diagnóstico técnico: solo se envía en desarrollo, nunca al público en producción. */
  diagnostics?: {
    failure?: StartupFailure
    warnings: string[]
    dataRoot: string
    schemaVersion?: number
    freeDiskMb?: number
    startedAt: string
  }
}

/** Parámetros que la interfaz pública necesita; nunca incluye secretos. */
export interface PublicSettings {
  session: {
    inactivityWarningSeconds: number
    inactivityCancelSeconds: number
  }
  capture: {
    countdownSeconds: number
    soundEnabled: boolean
    mirror: boolean
    cameraLabel: string
    /** Encuadre de la cámara en la zona de la persona (0 = imagen completa, 100 = llenar). */
    framingPercent: number
    /** Encuadre automático de la persona (con recorte automático del fondo). */
    autoFraming: boolean
    /** Altura visual y apoyo similares al primer personaje seleccionado (solo recorte automático). */
    matchCharacterSize: boolean
    /** Cámara montada girada: grados para enderezar la imagen (0, 90, 180 o 270). */
    rotation: number
    /** Aviso grande «Ubíquese aquí» hasta que alguien se ubique. */
    positionHint: boolean
    cameraControlsEnabled: boolean
    cameraControls: CameraControls
    maxRetakes: number
  }
  chroma: ChromaSettings
  background: { method: BackgroundMethod }
  /** Pantalla principal. */
  attract: PublicAttract
  download: {
    /** Segundos que permanece visible la pantalla del QR (RF-QR-010). */
    qrDisplaySeconds: number
  }
  timezone: string
  /** Inactividad máxima del panel administrativo (RF-AUT-005). */
  adminSessionTimeoutSeconds: number
}

export interface AttractMediaItem {
  id: string
  type: 'image' | 'video'
  /** URL del protocolo interno `totem-media:`. */
  url: string
  /** Duración en pantalla de las imágenes; los videos se reproducen completos. */
  displaySeconds: number
}

export type SessionEndReason = 'completed' | 'cancelled' | 'timeout'

export type StartSessionResult =
  | { ok: true; sessionId: string }
  | { ok: false; reason: 'insufficient_disk' | 'unavailable' }

/** API expuesta por el preload en `window.totem`. */
export interface TotemApi {
  getStatus(): Promise<AppStatus>
  getPublicSettings(): Promise<PublicSettings>
  listAttractMedia(): Promise<AttractMediaItem[]>
  reportMediaError(id: string): Promise<void>
  startSession(): Promise<StartSessionResult>
  endSession(sessionId: string, reason: SessionEndReason): Promise<void>
  listCampaigns(sessionId: string): Promise<CampaignList>
  /** Elige la campaña para la sesión y devuelve sus opciones; `null` si ya no está disponible. */
  selectCampaign(sessionId: string, campaignId: string): Promise<CampaignDetail | null>
  listConsents(): Promise<ConsentText[]>
  register(input: RegistrationInput): Promise<RegistrationResult>
  /**
   * Envía el cuadro original sin comprimir (se guarda como JPEG en el proceso principal) y, con el
   * recorte automático, la silueta guía de la persona.
   */
  saveCapture(sessionId: string, frame: CapturedFrame, guide: PersonGuide | null): Promise<SaveCaptureResult>
  /** Compone la foto; `placements` es la ubicación de cada personaje elegida por el participante (`null`, la configurada). */
  compose(sessionId: string, placements: (CharacterSlot | null)[], frame?: FramePlacement | null): Promise<ComposeResult>
  retake(sessionId: string): Promise<RetakeResult>
  reportCameraProblem(problem: CameraProblem): Promise<void>
  /** Publica la fotografía final y devuelve el QR; nunca un QR inválido (8.10). */
  publish(sessionId: string): Promise<PublishResult>
  /** Registra la acción reservada; la interfaz abre el acceso administrativo (RF-KIO-003). */
  reservedGesture(): Promise<void>
  confirmQuit(confirmed: true): Promise<void>
  adminStatus(): Promise<AdminStatus>
  adminSetup(payload: { username: string; displayName: string; password: string }): Promise<SetupResult>
  adminLogin(payload: { username: string; password: string }): Promise<LoginResult>
  /** Operación del panel; el proceso principal valida token, permiso y datos. */
  admin(token: string, method: string, payload?: unknown): Promise<AdminResult<unknown>>
}
