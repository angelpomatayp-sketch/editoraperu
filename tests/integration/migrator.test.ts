import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { checkIntegrity } from '../../src/infra/db/connection'
import { MIGRATIONS } from '../../src/infra/db/migrations'
import { DatabaseNewerThanAppError, migrate, type Migration } from '../../src/infra/db/migrator'

function memoryDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON')
  return db
}

describe('migraciones (RF-ALM-004)', () => {
  it('crea el esquema inicial completo', () => {
    const db = memoryDb()
    const result = migrate(db, MIGRATIONS)
    expect(result).toMatchObject({ from: 0, to: 7, applied: ['1_initial', '2_scenario_characters', '3_scenario_photo_hole', '4_character_animation', '5_character_motion', '6_animation_duration', '7_video_background'] })

    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as {
      name: string
    }[]).map((t) => t.name)
    expect(tables).toEqual(
      expect.arrayContaining([
        'audit_events',
        'campaign_resources',
        'campaigns',
        'consent_versions',
        'consents',
        'media_items',
        'participations',
        'photos',
        'publication_queue',
        'resources',
        'scenario_characters',
        'settings',
        'users'
      ])
    )
    expect(checkIntegrity(db)).toEqual([])
  })

  it('es idempotente: una segunda ejecución no aplica nada', () => {
    const db = memoryDb()
    migrate(db, MIGRATIONS)
    expect(migrate(db, MIGRATIONS).applied).toEqual([])
  })

  it('revierte una migración fallida sin dejar cambios parciales', () => {
    const db = memoryDb()
    const broken: Migration[] = [
      ...MIGRATIONS,
      { version: 99, name: 'broken', sql: 'CREATE TABLE temp_ok (a); INSERT INTO tabla_inexistente VALUES (1);' }
    ]
    expect(() => migrate(db, broken)).toThrow()
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'temp_ok'").get()).toBeUndefined()
    expect(migrate(db, MIGRATIONS).to).toBe(7)
  })

  it('rechaza una base creada por una versión más nueva de la aplicación', () => {
    const db = memoryDb()
    migrate(db, [...MIGRATIONS, { version: 99, name: 'future', sql: 'SELECT 1' }])
    expect(() => migrate(db, MIGRATIONS)).toThrow(DatabaseNewerThanAppError)
  })

  it('aplica claves foráneas', () => {
    const db = memoryDb()
    migrate(db, MIGRATIONS)
    const now = new Date().toISOString()
    expect(() =>
      db
        .prepare(
          `INSERT INTO participations (id, campaign_id, campaign_config_version, status, started_at, created_at, updated_at)
           VALUES ('p1', 'no-existe', 1, 'registered', ?, ?, ?)`
        )
        .run(now, now, now)
    ).toThrow(/FOREIGN KEY/)
  })
})
