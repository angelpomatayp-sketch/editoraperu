import { DEFAULT_SETTINGS, settingsSchema, type Settings } from '../../shared/settings'
import type { AuditLog } from '../audit/auditLog'

export interface SettingsRepository {
  read(key: string): string | null
  write(key: string, valueJson: string, updatedBy: string): void
}

export type SettingsUpdateResult = { ok: true; settings: Settings } | { ok: false; errors: string[] }

const SETTINGS_KEY = 'app'

/**
 * Completa la configuración guardada con los valores por defecto, sección por sección,
 * para que una actualización que agrega parámetros no invalide la configuración existente.
 */
export function mergeWithDefaults(stored: unknown): unknown {
  if (stored === null || typeof stored !== 'object' || Array.isArray(stored)) return stored
  const source = stored as Record<string, unknown>
  const merged: Record<string, unknown> = { ...DEFAULT_SETTINGS, ...source }
  for (const [key, defaults] of Object.entries(DEFAULT_SETTINGS)) {
    const value = source[key]
    if (typeof defaults === 'object' && value !== null && typeof value === 'object' && !Array.isArray(value)) {
      merged[key] = { ...defaults, ...value }
    }
  }
  return merged
}

function formatIssues(error: { issues: { path: PropertyKey[]; message: string }[] }): string[] {
  return error.issues.map((issue) => `${issue.path.map(String).join('.') || '(raíz)'}: ${issue.message}`)
}

/** Parámetros generales validados (RF-CFG-001, RF-CFG-003). */
export class SettingsService {
  private current: Settings = DEFAULT_SETTINGS

  constructor(
    private readonly repository: SettingsRepository,
    private readonly audit: AuditLog
  ) {}

  /** Carga la configuración. Si la guardada no es válida, usa los valores por defecto sin sobrescribirla. */
  load(): { settings: Settings; warnings: string[] } {
    const raw = this.repository.read(SETTINGS_KEY)
    if (raw === null) {
      this.repository.write(SETTINGS_KEY, JSON.stringify(DEFAULT_SETTINGS), 'system')
      this.current = DEFAULT_SETTINGS
      return { settings: this.current, warnings: [] }
    }

    let parsedJson: unknown
    try {
      parsedJson = JSON.parse(raw)
    } catch {
      return this.fallback(['La configuración guardada no es JSON válido'])
    }

    const parsed = settingsSchema.safeParse(mergeWithDefaults(parsedJson))
    if (!parsed.success) return this.fallback(formatIssues(parsed.error))

    this.current = parsed.data
    return { settings: this.current, warnings: [] }
  }

  get(): Settings {
    return this.current
  }

  /** Valida y aplica una configuración completa. No se aplica nada si un valor es inválido. */
  update(next: unknown, actorId: string): SettingsUpdateResult {
    const parsed = settingsSchema.safeParse(next)
    if (!parsed.success) {
      const errors = formatIssues(parsed.error)
      this.audit.record({
        level: 'warn',
        category: 'config',
        action: 'settings.update',
        result: 'fail',
        actor: { type: 'user', id: actorId },
        detail: { errors }
      })
      return { ok: false, errors }
    }

    this.repository.write(SETTINGS_KEY, JSON.stringify(parsed.data), actorId)
    this.current = parsed.data
    this.audit.record({
      level: 'info',
      category: 'config',
      action: 'settings.update',
      result: 'ok',
      actor: { type: 'user', id: actorId }
    })
    return { ok: true, settings: parsed.data }
  }

  private fallback(errors: string[]): { settings: Settings; warnings: string[] } {
    this.current = DEFAULT_SETTINGS
    this.audit.record({
      level: 'error',
      category: 'config',
      action: 'settings.load',
      result: 'fail',
      detail: { errors }
    })
    return { settings: this.current, warnings: ['Configuración inválida: se usan valores por defecto'] }
  }
}
