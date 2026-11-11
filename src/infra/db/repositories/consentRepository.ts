import type { DatabaseSync } from 'node:sqlite'
import type { ConsentRepository } from '../../../core/consents/consentRepository'
import type { ConsentText } from '../../../shared/registration'

export class SqliteConsentRepository implements ConsentRepository {
  constructor(private readonly db: DatabaseSync) {}

  listActive(): ConsentText[] {
    const rows = this.db
      .prepare(
        `SELECT id, type, version, title, body, is_required
         FROM consent_versions
         WHERE status = 'active'
         ORDER BY is_required DESC, activated_at, type`
      )
      .all() as {
      id: string
      type: string
      version: string
      title: string
      body: string
      is_required: number
    }[]
    return rows.map((r) => ({
      id: r.id,
      type: r.type,
      version: r.version,
      title: r.title,
      body: r.body,
      isRequired: r.is_required === 1
    }))
  }
}
