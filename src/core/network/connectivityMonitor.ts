import type { ConnectivityState } from '../../shared/publication'
import type { AuditLog } from '../audit/auditLog'
import type { PublicationClient } from '../publication/publicationClient'

/**
 * Comprueba el acceso real al servicio de publicación, no solo que haya una red conectada
 * (RF-RED-001). Registra los cambios de estado y avisa al recuperar la conexión, para reintentar
 * las publicaciones pendientes (RF-QR-009).
 */
export class ConnectivityMonitor {
  private current: ConnectivityState = 'unknown'

  constructor(
    private readonly client: () => PublicationClient | null,
    private readonly audit: AuditLog,
    private readonly onOnline: () => void
  ) {}

  get state(): ConnectivityState {
    return this.current
  }

  async check(): Promise<ConnectivityState> {
    const client = this.client()
    const next: ConnectivityState = !client ? 'not_configured' : (await client.health()) ? 'online' : 'offline'
    if (next !== this.current) {
      const previous = this.current
      this.current = next
      this.audit.record({
        level: next === 'offline' ? 'warn' : 'info',
        category: 'network',
        action: 'connectivity',
        result: next === 'online' ? 'ok' : next === 'offline' ? 'fail' : 'skipped',
        detail: { from: previous, to: next }
      })
      if (next === 'online') this.onOnline()
    }
    return next
  }
}
