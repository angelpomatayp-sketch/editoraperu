import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { AuditLog } from '../../src/core/audit/auditLog'
import { SessionService, type StartCheck } from '../../src/core/session/sessionService'
import { MIGRATIONS } from '../../src/infra/db/migrations'
import { migrate } from '../../src/infra/db/migrator'
import { SqliteAuditRepository } from '../../src/infra/db/repositories/auditRepository'

function setup(check: StartCheck = { ok: true }) {
  const db = new DatabaseSync(':memory:')
  migrate(db, MIGRATIONS)
  const audit = new AuditLog(new SqliteAuditRepository(db), { log: () => {} })
  let clock = new Date('2026-10-05T15:00:00Z')
  const service = new SessionService(audit, () => check, () => clock)
  const events = () =>
    db.prepare('SELECT action, result, entity_id, detail_json FROM audit_events ORDER BY id').all() as {
      action: string
      result: string
      entity_id: string | null
      detail_json: string | null
    }[]
  const advance = (seconds: number) => {
    clock = new Date(clock.getTime() + seconds * 1000)
  }
  return { service, events, advance }
}

describe('sesión pública (RF-SES-001)', () => {
  it('crea una sesión con identificador aleatorio y la registra', () => {
    const { service, events } = setup()
    const result = service.start()
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.sessionId).toMatch(/^[0-9a-f-]{36}$/)
    expect(service.currentId()).toBe(result.sessionId)
    expect(events()).toEqual([{ action: 'start', result: 'ok', entity_id: result.sessionId, detail_json: null }])
  })

  it('cada sesión tiene un identificador distinto', () => {
    const { service } = setup()
    const a = service.start()
    const b = service.start()
    expect(a.ok && b.ok && a.sessionId !== b.sessionId).toBe(true)
  })

  it('registra el motivo y la duración al terminar', () => {
    const { service, events, advance } = setup()
    const result = service.start()
    if (!result.ok) throw new Error('no inició')
    advance(42)
    expect(service.end(result.sessionId, 'timeout')).toBe(true)
    expect(service.currentId()).toBeNull()
    const end = events().at(-1)!
    expect(end.action).toBe('end')
    expect(JSON.parse(end.detail_json!)).toEqual({ reason: 'timeout', durationSeconds: 42 })
  })

  it('ignora el cierre de una sesión que no es la activa', () => {
    const { service } = setup()
    service.start()
    expect(service.end('00000000-0000-4000-8000-000000000000', 'cancelled')).toBe(false)
    expect(service.currentId()).not.toBeNull()
  })

  it('una nueva sesión cierra la anterior como reemplazada', () => {
    const { service, events } = setup()
    service.start()
    service.start()
    const superseded = events().find((e) => e.action === 'end')!
    expect(JSON.parse(superseded.detail_json!).reason).toBe('superseded')
  })

  it('no inicia sin espacio suficiente en disco (RF-ALM-002)', () => {
    const { service, events } = setup({ ok: false, reason: 'insufficient_disk' })
    expect(service.start()).toEqual({ ok: false, reason: 'insufficient_disk' })
    expect(service.currentId()).toBeNull()
    expect(events()[0]).toMatchObject({ action: 'start', result: 'denied' })
  })
})
