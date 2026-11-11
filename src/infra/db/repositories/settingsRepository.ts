import type { DatabaseSync } from 'node:sqlite'
import type { SettingsRepository } from '../../../core/settings/settingsService'

export class SqliteSettingsRepository implements SettingsRepository {
  constructor(private readonly db: DatabaseSync) {}

  read(key: string): string | null {
    const row = this.db.prepare('SELECT value_json FROM settings WHERE key = ?').get(key) as
      | { value_json: string }
      | undefined
    return row?.value_json ?? null
  }

  write(key: string, valueJson: string, updatedBy: string): void {
    this.db
      .prepare(
        `INSERT INTO settings (key, value_json, updated_at, updated_by) VALUES (?, ?, ?, ?)
         ON CONFLICT (key) DO UPDATE SET
           value_json = excluded.value_json, updated_at = excluded.updated_at, updated_by = excluded.updated_by`
      )
      .run(key, valueJson, new Date().toISOString(), updatedBy)
  }
}
