import type { DatabaseSync } from 'node:sqlite'

export interface Migration {
  version: number
  name: string
  sql: string
}

export interface MigrationResult {
  from: number
  to: number
  applied: string[]
}

export class DatabaseNewerThanAppError extends Error {
  constructor(
    readonly databaseVersion: number,
    readonly appVersion: number
  ) {
    super(`La base tiene el esquema ${databaseVersion} y la aplicación solo conoce hasta ${appVersion}`)
    this.name = 'DatabaseNewerThanAppError'
  }
}

export function currentSchemaVersion(db: DatabaseSync): number {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    INTEGER PRIMARY KEY,
      name       TEXT    NOT NULL,
      applied_at TEXT    NOT NULL
    )
  `)
  const row = db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get() as { version: number | null }
  return row.version ?? 0
}

export function pendingMigrations(db: DatabaseSync, migrations: Migration[]): Migration[] {
  const current = currentSchemaVersion(db)
  const latest = Math.max(0, ...migrations.map((m) => m.version))
  if (current > latest) throw new DatabaseNewerThanAppError(current, latest)
  return migrations.filter((m) => m.version > current).sort((a, b) => a.version - b.version)
}

/** Aplica cada migración pendiente en su propia transacción (RF-ALM-004). */
export function migrate(db: DatabaseSync, migrations: Migration[]): MigrationResult {
  const from = currentSchemaVersion(db)
  const applied: string[] = []
  const record = db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)')

  for (const migration of pendingMigrations(db, migrations)) {
    db.exec('BEGIN IMMEDIATE')
    try {
      db.exec(migration.sql)
      record.run(migration.version, migration.name, new Date().toISOString())
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
    applied.push(`${migration.version}_${migration.name}`)
  }

  return { from, to: currentSchemaVersion(db), applied }
}
