import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { AuditLog } from '../../src/core/audit/auditLog'
import type { Logger } from '../../src/core/logging'
import { SettingsService } from '../../src/core/settings/settingsService'
import { MIGRATIONS } from '../../src/infra/db/migrations'
import { migrate } from '../../src/infra/db/migrator'
import { SqliteAuditRepository } from '../../src/infra/db/repositories/auditRepository'
import { SqliteSettingsRepository } from '../../src/infra/db/repositories/settingsRepository'
import { DEFAULT_SETTINGS, settingsSchema } from '../../src/shared/settings'

const silentLogger: Logger = { log: () => {} }

function setup() {
  const db = new DatabaseSync(':memory:')
  migrate(db, MIGRATIONS)
  const repository = new SqliteSettingsRepository(db)
  const audit = new AuditLog(new SqliteAuditRepository(db), silentLogger)
  return { db, repository, service: new SettingsService(repository, audit) }
}

function auditActions(db: DatabaseSync) {
  return db.prepare('SELECT action, result FROM audit_events ORDER BY id').all()
}

describe('configuración (RF-CFG-001, RF-CFG-003)', () => {
  it('los valores por defecto son válidos', () => {
    expect(settingsSchema.safeParse(DEFAULT_SETTINGS).success).toBe(true)
  })

  it('en el primer arranque guarda los valores por defecto', () => {
    const { service, repository } = setup()
    expect(service.load()).toEqual({ settings: DEFAULT_SETTINGS, warnings: [] })
    expect(JSON.parse(repository.read('app')!)).toEqual(DEFAULT_SETTINGS)
  })

  it('completa con valores por defecto los parámetros nuevos de una actualización', () => {
    const { service, repository } = setup()
    repository.write('app', JSON.stringify({ capture: { countdownSeconds: 5 } }), 'test')
    const { settings, warnings } = service.load()
    expect(warnings).toEqual([])
    expect(settings.capture).toEqual({ ...DEFAULT_SETTINGS.capture, countdownSeconds: 5 })
    expect(settings.session).toEqual(DEFAULT_SETTINGS.session)
  })

  it('ante una configuración guardada inválida usa los valores por defecto sin sobrescribirla', () => {
    const { service, repository, db } = setup()
    const invalid = JSON.stringify({ capture: { countdownSeconds: 99 } })
    repository.write('app', invalid, 'test')
    const { settings, warnings } = service.load()
    expect(settings).toEqual(DEFAULT_SETTINGS)
    expect(warnings).toHaveLength(1)
    expect(repository.read('app')).toBe(invalid)
    expect(auditActions(db)).toEqual([{ action: 'settings.load', result: 'fail' }])
  })

  it('rechaza una actualización inválida sin aplicar ningún cambio', () => {
    const { service, db } = setup()
    service.load()
    const result = service.update(
      { ...DEFAULT_SETTINGS, storage: { minFreeMegabytes: 5000, warnFreeMegabytes: 1000 } },
      'user-1'
    )
    expect(result.ok).toBe(false)
    expect(service.get()).toEqual(DEFAULT_SETTINGS)
    expect(auditActions(db)).toEqual([{ action: 'settings.update', result: 'fail' }])
  })

  it('aplica y registra una actualización válida', () => {
    const { service, repository, db } = setup()
    service.load()
    const next = { ...DEFAULT_SETTINGS, download: { qrDisplaySeconds: 120 } }
    expect(service.update(next, 'user-1')).toEqual({ ok: true, settings: next })
    expect(JSON.parse(repository.read('app')!)).toEqual(next)
    expect(auditActions(db)).toEqual([{ action: 'settings.update', result: 'ok' }])
  })
})
