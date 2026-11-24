import { DatabaseSync } from 'node:sqlite'
import { expect, it } from 'vitest'
import { migrate } from '../../src/infra/db/migrator'
import { MIGRATIONS } from '../../src/infra/db/migrations'
import { ensureDefaultConsents } from '../../src/main/defaults/consents'

it('versiona los avisos sin modificar texto/hash anteriores y no duplica al reiniciar', () => {
  const db = new DatabaseSync(':memory:')
  try {
    migrate(db, MIGRATIONS)
    ensureDefaultConsents(db)
    const before = db.prepare('SELECT id, body, body_sha256 FROM consent_versions ORDER BY type').all()
    ensureDefaultConsents(db)
    expect(db.prepare('SELECT id, body, body_sha256 FROM consent_versions ORDER BY type').all()).toEqual(before)
    ensureDefaultConsents(db, { enabled: true, photoDays: 14, personalDataDays: 60 })
    expect(db.prepare("SELECT COUNT(*) AS n FROM consent_versions WHERE status = 'active'").get()).toMatchObject({ n: 2 })
    for (const row of before) expect(db.prepare('SELECT id, body, body_sha256 FROM consent_versions WHERE id = ?').get(row.id)).toEqual(row)
    expect(db.prepare("SELECT body FROM consent_versions WHERE type = 'terms_data' AND status = 'active'").get()!.body).toContain('14 días')
  } finally { db.close() }
})

it('retira la versión de prueba sin borrar sus datos y respeta un aviso institucional existente', () => {
  const db = new DatabaseSync(':memory:')
  try {
    migrate(db, MIGRATIONS)
    ensureDefaultConsents(db)
    db.prepare("UPDATE consent_versions SET version = '0.1-prueba' WHERE type = 'terms_data'").run()
    db.prepare("UPDATE consent_versions SET version = 'institucional-aprobado' WHERE type = 'image_use'").run()
    ensureDefaultConsents(db)
    expect(db.prepare("SELECT status FROM consent_versions WHERE version = '0.1-prueba'").get()).toMatchObject({ status: 'retired' })
    expect(db.prepare("SELECT version FROM consent_versions WHERE type = 'image_use' AND status = 'active'").get()).toMatchObject({ version: 'institucional-aprobado' })
  } finally { db.close() }
})
