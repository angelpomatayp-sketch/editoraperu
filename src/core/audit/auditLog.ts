import type { Logger, LogLevel } from '../logging'
import { sanitize } from './sanitize'

export type AuditCategory =
  | 'system'
  | 'kiosk'
  | 'session'
  | 'camera'
  | 'composition'
  | 'storage'
  | 'publication'
  | 'network'
  | 'auth'
  | 'content'
  | 'export'
  | 'config'

export type AuditResult = 'ok' | 'fail' | 'denied' | 'skipped'

export interface AuditActor {
  type: 'system' | 'user' | 'component'
  id?: string
}

export interface AuditEvent {
  level: LogLevel
  category: AuditCategory
  action: string
  result: AuditResult
  actor?: AuditActor
  entity?: { type: string; id: string }
  detail?: Record<string, unknown>
}

export interface AuditRecord {
  occurredAt: string
  level: LogLevel
  category: AuditCategory
  action: string
  result: AuditResult
  actorType: AuditActor['type']
  actorId: string | null
  entityType: string | null
  entityId: string | null
  detailJson: string | null
}

export interface AuditRepository {
  add(record: AuditRecord): void
}

/**
 * Bitácora de eventos (RF-BIT-001 a RF-BIT-003).
 * Persiste en base de datos y replica en el registro técnico; si la base no está
 * disponible, el evento queda al menos en el archivo de diagnóstico (12.3).
 */
export class AuditLog {
  constructor(
    private readonly repository: AuditRepository | null,
    private readonly logger: Logger,
    private readonly now: () => Date = () => new Date()
  ) {}

  record(event: AuditEvent): void {
    const detail = event.detail ? (sanitize(event.detail) as Record<string, unknown>) : undefined
    const record: AuditRecord = {
      occurredAt: this.now().toISOString(),
      level: event.level,
      category: event.category,
      action: event.action,
      result: event.result,
      actorType: event.actor?.type ?? 'system',
      actorId: event.actor?.id ?? null,
      entityType: event.entity?.type ?? null,
      entityId: event.entity?.id ?? null,
      detailJson: detail ? JSON.stringify(detail) : null
    }

    this.logger.log(event.level, `${event.category}.${event.action}`, {
      result: event.result,
      ...(event.entity ? { entity: event.entity } : {}),
      ...(detail ? { detail } : {})
    })

    if (!this.repository) return
    try {
      this.repository.add(record)
    } catch (error) {
      this.logger.log('error', 'audit.persist_failed', { error: sanitize(error) })
    }
  }
}
