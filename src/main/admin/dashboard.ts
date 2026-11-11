import type { DatabaseSync } from 'node:sqlite'
import type { DashboardData } from '../../shared/admin'
import type { ConnectivityState } from '../../shared/publication'
import type { Settings } from '../../shared/settings'

export interface DashboardDeps {
  db: DatabaseSync
  availableCampaigns: () => number
  connectivity: () => ConnectivityState
  freeDiskMb: () => number | null
  settings: () => Settings
  now?: () => Date
}

/** Inicio del día de hoy en la zona horaria indicada, como instante UTC en ISO 8601. */
export function startOfDayIso(now: Date, timeZone: string): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
      .formatToParts(now)
      .map((p) => [p.type, p.value])
  )
  const asUtc = Date.UTC(+parts.year!, +parts.month! - 1, +parts.day!, +parts.hour!, +parts.minute!, +parts.second!)
  const offsetMs = asUtc - Math.floor(now.getTime() / 1000) * 1000
  return new Date(Date.UTC(+parts.year!, +parts.month! - 1, +parts.day!) - offsetMs).toISOString()
}

/**
 * Resumen y estado técnico (8.12). Los totales indican su período y los estados se expresan con
 * texto además del color (RF-DSH-001 a RF-DSH-003).
 */
export function buildDashboard(deps: DashboardDeps): DashboardData {
  const now = deps.now?.() ?? new Date()
  const settings = deps.settings()
  const today = startOfDayIso(now, settings.timezone)
  const dayAgo = new Date(now.getTime() - 24 * 3600 * 1000).toISOString()
  const count = (sql: string, ...params: string[]) => (deps.db.prepare(sql).get(...params) as { n: number }).n

  const data: Omit<DashboardData, 'alerts'> = {
    generatedAt: now.toISOString(),
    participationsToday: count('SELECT COUNT(*) AS n FROM participations WHERE started_at >= ?', today),
    completedToday: count("SELECT COUNT(*) AS n FROM participations WHERE status = 'completed' AND finished_at >= ?", today),
    participationsTotal: count('SELECT COUNT(*) AS n FROM participations'),
    activeCampaigns: count("SELECT COUNT(*) AS n FROM campaigns WHERE status = 'active'"),
    availableCampaigns: deps.availableCampaigns(),
    connectivity: deps.connectivity(),
    pendingPublications: count("SELECT COUNT(*) AS n FROM publication_queue WHERE status IN ('pending', 'in_progress')"),
    failedPublications: count("SELECT COUNT(*) AS n FROM publication_queue WHERE status = 'failed'"),
    freeDiskMb: deps.freeDiskMb(),
    warnFreeMb: settings.storage.warnFreeMegabytes,
    errorsLast24h: count("SELECT COUNT(*) AS n FROM audit_events WHERE level = 'error' AND occurred_at >= ?", dayAgo),
    lastCameraProblemAt:
      (deps.db.prepare("SELECT MAX(occurred_at) AS at FROM audit_events WHERE action = 'camera.unavailable'").get() as { at: string | null }).at
  }

  const alerts: string[] = []
  if (data.availableCampaigns === 0) alerts.push('No hay campañas disponibles para el público.')
  if (data.freeDiskMb !== null && data.freeDiskMb < settings.storage.minFreeMegabytes) {
    alerts.push('Espacio en disco insuficiente: no se inician nuevas participaciones.')
  } else if (data.freeDiskMb !== null && data.freeDiskMb < data.warnFreeMb) alerts.push('Espacio en disco bajo.')
  if (data.connectivity === 'offline') alerts.push('Sin acceso al servicio de publicación: los QR no se pueden generar.')
  if (data.connectivity === 'not_configured') alerts.push('La publicación por QR no está configurada.')
  if (data.failedPublications > 0) alerts.push(`${data.failedPublications} publicación(es) fallidas tras agotar los reintentos.`)
  if (data.lastCameraProblemAt && data.lastCameraProblemAt >= dayAgo) alerts.push('Hubo un problema con la cámara en las últimas 24 horas.')
  if (data.errorsLast24h > 0) alerts.push(`${data.errorsLast24h} error(es) registrados en las últimas 24 horas.`)

  return { ...data, alerts }
}
