import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { AuditLog } from '../../src/core/audit/auditLog'
import { AttractService, DEFAULT_IMAGE_SECONDS } from '../../src/core/media/attractService'
import { MIGRATIONS } from '../../src/infra/db/migrations'
import { migrate } from '../../src/infra/db/migrator'
import { SqliteAuditRepository } from '../../src/infra/db/repositories/auditRepository'
import { SqliteMediaRepository } from '../../src/infra/db/repositories/mediaRepository'
import { contentUrl } from '../../src/infra/storage/contentPaths'
import { cleanTempDir } from '../../src/infra/storage/tempCleanup'

const NOW = new Date('2026-10-05T15:00:00Z')
const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function setup() {
  const db = new DatabaseSync(':memory:')
  migrate(db, MIGRATIONS)
  const audit = new AuditLog(new SqliteAuditRepository(db), { log: () => {} })
  const existing = new Set<string>()
  const service = new AttractService(new SqliteMediaRepository(db), (p) => existing.has(p), contentUrl, audit, () => NOW)
  const insert = db.prepare(
    `INSERT INTO media_items (id, type, name, file_path, display_seconds, sort_order, status, starts_at, ends_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'x', 'x')`
  )
  const add = (
    id: string,
    opts: { type?: string; order?: number; status?: string; starts?: string; ends?: string; seconds?: number; file?: boolean } = {}
  ) => {
    const path = `media/${id}.png`
    if (opts.file !== false) existing.add(path)
    insert.run(id, opts.type ?? 'image', id, path, opts.seconds ?? null, opts.order ?? 0, opts.status ?? 'active', opts.starts ?? null, opts.ends ?? null)
  }
  const skipped = () =>
    db.prepare("SELECT entity_id, detail_json FROM audit_events WHERE action = 'attract.media_skipped'").all()
  return { service, add, skipped }
}

describe('contenido de atracción (RF-ATR-001, RF-ATR-003, RF-ATR-004)', () => {
  it('devuelve solo piezas activas y vigentes, en el orden configurado', () => {
    const { service, add } = setup()
    add('b', { order: 2, seconds: 5 })
    add('a', { order: 1 })
    add('inactiva', { status: 'inactive' })
    add('futura', { starts: '2026-10-06T00:00:00Z' })
    add('vencida', { ends: '2026-10-05T14:59:59Z' })
    add('vigente', { order: 3, starts: '2026-10-01T00:00:00Z', ends: '2026-10-31T00:00:00Z', type: 'video' })

    expect(service.list()).toEqual([
      { id: 'a', type: 'image', url: 'totem-media://content/media/a.png', displaySeconds: DEFAULT_IMAGE_SECONDS },
      { id: 'b', type: 'image', url: 'totem-media://content/media/b.png', displaySeconds: 5 },
      { id: 'vigente', type: 'video', url: 'totem-media://content/media/vigente.png', displaySeconds: DEFAULT_IMAGE_SECONDS }
    ])
  })

  it('omite archivos inexistentes y lo registra una sola vez', () => {
    const { service, add, skipped } = setup()
    add('ok')
    add('falta', { file: false })
    expect(service.list().map((i) => i.id)).toEqual(['ok'])
    service.list()
    expect(skipped()).toEqual([{ entity_id: 'falta', detail_json: JSON.stringify({ reason: 'missing_file', name: 'falta' }) }])
  })

  it('registra una sola vez los errores de reproducción', () => {
    const { service, skipped } = setup()
    service.reportPlaybackError('x')
    service.reportPlaybackError('x')
    expect(skipped()).toHaveLength(1)
  })
})

describe('temporales (RF-ALM-003)', () => {
  it('elimina archivos y carpetas abandonados', () => {
    const dir = mkdtempSync(join(tmpdir(), 'totem-tmp-'))
    dirs.push(dir)
    writeFileSync(join(dir, 'captura.part'), 'x')
    mkdirSync(join(dir, 'sesion'))
    writeFileSync(join(dir, 'sesion', 'a.jpg'), 'x')
    expect(cleanTempDir(dir).removed.sort()).toEqual(['captura.part', 'sesion'])
    expect(cleanTempDir(dir)).toEqual({ removed: [], failed: [] })
  })
})
