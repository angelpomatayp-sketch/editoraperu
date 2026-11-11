import type { DatabaseSync, StatementSync } from 'node:sqlite'
import type { AuditRecord, AuditRepository } from '../../../core/audit/auditLog'

export class SqliteAuditRepository implements AuditRepository {
  private readonly insert: StatementSync

  constructor(db: DatabaseSync) {
    this.insert = db.prepare(`
      INSERT INTO audit_events
        (occurred_at, level, category, action, result, actor_type, actor_id, entity_type, entity_id, detail_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
  }

  add(r: AuditRecord): void {
    this.insert.run(
      r.occurredAt,
      r.level,
      r.category,
      r.action,
      r.result,
      r.actorType,
      r.actorId,
      r.entityType,
      r.entityId,
      r.detailJson
    )
  }
}
