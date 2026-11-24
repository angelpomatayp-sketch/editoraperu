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
  it('actualiza a captura neutra sin borrar la calibración ni modificar el encuadre guardados', () => {
    const { service, repository, db } = setup()
    try {
      const { cameraControlsEnabled: _enabled, matchSceneTone: _tone, ...oldCapture } = DEFAULT_SETTINGS.capture
      const controls = { focusMode: 'manual', focusDistance: 20, brightness: 128 }
      repository.write('app', JSON.stringify({ ...DEFAULT_SETTINGS, capture: {
        ...oldCapture, cameraControls: controls, rotation: 90, framingPercent: 12
      } }), 'test')
      const { settings, warnings } = service.load()
      expect(warnings).toEqual([])
      expect(settings.capture).toMatchObject({
        cameraControlsEnabled: false, matchSceneTone: false, cameraControls: controls, rotation: 90, framingPercent: 12
      })
      expect(service.update({ ...settings, capture: { ...settings.capture, cameraControlsEnabled: true, matchSceneTone: true } }, 'test').ok).toBe(true)
      expect(service.load().settings.capture).toMatchObject({ cameraControlsEnabled: true, matchSceneTone: true, cameraControls: controls })
    } finally { db.close() }
  })
  it('aplica 7/30 días una sola vez al actualizar sin tocar la cuenta de captura', () => {
    const db = new DatabaseSync(':memory:')
    try {
      migrate(db, MIGRATIONS.filter(m => m.version < 10))
      const repo = new SqliteSettingsRepository(db)
      repo.write('app', JSON.stringify({ ...DEFAULT_SETTINGS, capture: { ...DEFAULT_SETTINGS.capture, countdownSeconds: 15 }, retention: { enabled: false, photoDays: 30, personalDataDays: 365 } }), 'test')
      migrate(db, MIGRATIONS)
      const current = JSON.parse(repo.read('app')!)
      expect(current.capture.countdownSeconds).toBe(15)
      expect(current.retention).toEqual({ enabled: true, photoDays: 7, personalDataDays: 30 })
      repo.write('app', JSON.stringify({ ...current, retention: { enabled: false, photoDays: 14, personalDataDays: 60 } }), 'test')
      migrate(db, MIGRATIONS)
      expect(JSON.parse(repo.read('app')!).retention).toEqual({ enabled: false, photoDays: 14, personalDataDays: 60 })
    } finally { db.close() }
  })
  it('migra la cuenta existente a 10 s una sola vez y permite modificarla después', () => {
    const db = new DatabaseSync(':memory:')
    migrate(db, MIGRATIONS.filter(m => m.version < 9))
    const repo = new SqliteSettingsRepository(db)
    repo.write('app', JSON.stringify({ ...DEFAULT_SETTINGS, capture: { ...DEFAULT_SETTINGS.capture, countdownSeconds: 7 } }), 'test')
    migrate(db, MIGRATIONS)
    expect(JSON.parse(repo.read('app')!).capture.countdownSeconds).toBe(10)
    repo.write('app', JSON.stringify({ ...DEFAULT_SETTINGS, capture: { ...DEFAULT_SETTINGS.capture, countdownSeconds: 15 } }), 'test')
    migrate(db, MIGRATIONS)
    expect(JSON.parse(repo.read('app')!).capture.countdownSeconds).toBe(15)
    db.close()
  })
  it('los valores por defecto son válidos', () => {
    expect(settingsSchema.safeParse(DEFAULT_SETTINGS).success).toBe(true)
  })

  it('actualizar conserva el encuadre anterior y permite guardar el ajuste al personaje', () => {
    const { service, repository, db } = setup()
    try {
      const { matchCharacterSize: _newOption, ...oldCapture } = DEFAULT_SETTINGS.capture
      const previous = { ...DEFAULT_SETTINGS, capture: { ...oldCapture, autoFraming: true, framingPercent: 23 } }
      repository.write('app', JSON.stringify(previous), 'test')
      const { settings, warnings } = service.load()
      expect(warnings).toEqual([])
      expect(settings.capture).toMatchObject({ autoFraming: true, framingPercent: 23, matchCharacterSize: false })
      expect(settingsSchema.parse(previous).capture.matchCharacterSize).toBe(false)
      expect(service.update({ ...settings, capture: { ...settings.capture, matchCharacterSize: true } }, 'test').ok).toBe(true)
      expect(service.load().settings.capture.matchCharacterSize).toBe(true)
    } finally { db.close() }
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
