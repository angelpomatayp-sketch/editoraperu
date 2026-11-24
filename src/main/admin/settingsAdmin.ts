import type { PublicationSettingsView } from '../../shared/admin'
import type { CameraControls } from '../../shared/cameraControls'
import type { BackgroundMethod, ChromaSettings } from '../../shared/chroma'
import type { ConnectivityState } from '../../shared/publication'
import type { Settings } from '../../shared/settings'
import type { AuditLog } from '../../core/audit/auditLog'
import type { ConnectivityMonitor } from '../../core/network/connectivityMonitor'
import type { SettingsService } from '../../core/settings/settingsService'
import { AdminError } from './contentAdmin'

interface BackgroundView {
  method: BackgroundMethod
  chroma: ChromaSettings
  cameraControls: CameraControls
  cameraControlsEnabled: boolean
  matchSceneTone: boolean
}

export interface SecretAccess {
  has: () => boolean
  set: (value: string) => void
}

/**
 * Parámetros técnicos administrables: servicio de publicación y calibración del croma.
 * La clave del servicio se guarda cifrada y nunca vuelve a mostrarse (RF-CFG-002).
 */
export class SettingsAdmin {
  constructor(
    private readonly settings: SettingsService,
    private readonly secret: SecretAccess,
    private readonly connectivity: ConnectivityMonitor,
    private readonly audit: AuditLog,
    private readonly devOverride: () => string | null,
    /** URL del servicio incluido en el instalador; su clave nunca se expone al panel. */
    private readonly builtInUrl: string | null = null
  ) {}

  getPublication(): PublicationSettingsView {
    return {
      baseUrl: this.settings.get().publication.baseUrl,
      secretConfigured: this.secret.has(),
      devOverride: this.devOverride(),
      builtInUrl: this.builtInUrl
    }
  }

  savePublication(baseUrl: string, secret: string, actorId: string): PublicationSettingsView {
    if (secret && secret.length < 32) throw new AdminError('invalid_secret', 'La clave debe tener al menos 32 caracteres')
    const current = this.settings.get()
    const result = this.settings.update({ ...current, publication: { ...current.publication, baseUrl } }, actorId)
    if (!result.ok) throw new AdminError('invalid_settings', result.errors.join('; '))
    if (secret) this.secret.set(secret)
    this.audit.record({
      level: 'info',
      category: 'config',
      action: 'publication.configure',
      result: 'ok',
      actor: { type: 'user', id: actorId },
      detail: { baseUrl, secretChanged: Boolean(secret) }
    })
    return this.getPublication()
  }

  async testPublication(): Promise<ConnectivityState> {
    return this.connectivity.check()
  }

  /** Parámetros generales validados (RF-CFG-001, RF-CFG-003). */
  getGeneral(): Settings {
    return this.settings.get()
  }

  saveGeneral(next: Settings, actorId: string): Settings {
    const current = this.settings.get()
    // La URL del servicio, el fondo de la foto y la pantalla principal se administran en sus propias pantallas.
    const result = this.settings.update(
      {
        ...next,
        publication: { ...next.publication, baseUrl: current.publication.baseUrl },
        chroma: current.chroma,
        background: current.background,
        attract: current.attract,
        capture: {
          ...next.capture, cameraControls: current.capture.cameraControls,
          cameraControlsEnabled: current.capture.cameraControlsEnabled, matchSceneTone: current.capture.matchSceneTone
        }
      },
      actorId
    )
    if (!result.ok) throw new AdminError('invalid_settings', result.errors.join('; '))
    return result.settings
  }

  /** Método para quitar el fondo, calibración del croma y ajustes de imagen de la cámara. */
  getBackground(): BackgroundView {
    const { background, chroma, capture } = this.settings.get()
    return {
      method: background.method, chroma, cameraControls: capture.cameraControls,
      cameraControlsEnabled: capture.cameraControlsEnabled, matchSceneTone: capture.matchSceneTone
    }
  }

  saveBackground(input: BackgroundView, actorId: string): BackgroundView {
    const current = this.settings.get()
    const result = this.settings.update(
      {
        ...current, background: { method: input.method }, chroma: input.chroma,
        capture: { ...current.capture, cameraControls: input.cameraControls,
          cameraControlsEnabled: input.cameraControlsEnabled, matchSceneTone: input.matchSceneTone }
      },
      actorId
    )
    if (!result.ok) throw new AdminError('invalid_settings', result.errors.join('; '))
    this.audit.record({
      level: 'info',
      category: 'config',
      action: 'background.configure',
      result: 'ok',
      actor: { type: 'user', id: actorId },
      detail: { method: input.method, cameraControls: input.cameraControls,
        cameraControlsEnabled: input.cameraControlsEnabled, matchSceneTone: input.matchSceneTone }
    })
    return this.getBackground()
  }
}
