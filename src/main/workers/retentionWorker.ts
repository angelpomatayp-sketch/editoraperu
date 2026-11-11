import type { SettingsService } from '../../core/settings/settingsService'
import type { Maintenance } from '../admin/maintenance'

const INTERVAL_MS = 6 * 3600 * 1000

/**
 * Aplica la política de conservación al iniciar y cada 6 horas, solo si está activada (RF-FOT-005).
 * Mientras no se apruebe PD-002 permanece desactivada y no elimina nada (RN-009).
 */
export function startRetentionWorker(maintenance: Maintenance, settings: SettingsService): () => void {
  const tick = () => {
    if (!settings.get().retention.enabled) return
    try {
      maintenance.runRetention({ type: 'system' })
    } catch {
      // El error queda en la bitácora del proceso principal; se reintenta en el siguiente ciclo.
    }
  }
  tick()
  const timer = setInterval(tick, INTERVAL_MS)
  return () => clearInterval(timer)
}
