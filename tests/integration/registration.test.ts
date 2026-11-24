import { afterEach, describe, expect, it } from 'vitest'
import type { RegistrationInput } from '../../src/shared/registration'
import { seededApp } from './helpers'

let app: ReturnType<typeof seededApp>

afterEach(() => app?.cleanup())

/** Sesión con la campaña de lectura elegida y una entrada de registro válida. */
function prepare() {
  app = seededApp()
  const start = app.sessions.start()
  if (!start.ok) throw new Error('no inició')
  const campaignId = app.campaignId('DEMO-LECTURA')
  const detail = app.catalog.getDetail(campaignId)!
  app.sessions.selectCampaign(start.sessionId, { id: campaignId, configVersion: detail.configVersion })
  const consents = app.consents.listActive()
  const input: RegistrationInput = {
    sessionId: start.sessionId,
    campaignId,
    selections: { scenarioId: detail.scenarios[0]!.id, characterIds: [detail.characters[1]!.id], frameId: null },
    participant: { firstNames: ' María  José ', lastNames: 'Quispe Mamani', dni: '12345678' },
    consents: consents.map((c) => ({ versionId: c.id, accepted: true }))
  }
  return { sessionId: start.sessionId, detail, consents, input }
}

function participations() {
  return app.db.prepare('SELECT * FROM participations').all() as Record<string, unknown>[]
}

describe('registro de participación (RF-REG-004, RF-REG-005, RF-CON-003)', () => {
  it('guarda la participación, las selecciones y la evidencia de cada consentimiento', () => {
    const { input, detail, consents } = prepare()
    const result = app.registration.register(input)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const [row] = participations()
    expect(row).toMatchObject({
      id: result.participationId,
      first_names: 'María José',
      last_names: 'Quispe Mamani',
      document_type: 'DNI',
      document_number: '12345678',
      status: 'registered',
      campaign_config_version: 1
    })
    expect(row!['confirmed_at']).toBeTruthy()
    expect(JSON.parse(row!['selections_json'] as string)).toEqual({
      scenarioId: detail.scenarios[0]!.id,
      characterIds: [detail.characters[1]!.id],
      frameId: detail.frames[0]!.id
    })

    const evidence = app.db
      .prepare(
        `SELECT cv.type, cv.version, cv.body_sha256, c.accepted, c.recorded_at
         FROM consents c JOIN consent_versions cv ON cv.id = c.consent_version_id
         WHERE c.participation_id = ? ORDER BY cv.type`
      )
      .all(result.participationId) as { type: string; version: string; body_sha256: string; accepted: number }[]
    expect(evidence.map((e) => [e.type, e.version, e.accepted])).toEqual([
      ['image_use', expect.stringMatching(/^1.0-totem-/), 1],
      ['terms_data', expect.stringMatching(/^1.0-totem-/), 1]
    ])
    expect(evidence.every((e) => /^[0-9a-f]{64}$/.test(e.body_sha256))).toBe(true)
    expect(consents).toHaveLength(2)
  })

  it('el identificador no contiene datos del participante y la bitácora no guarda datos personales (RF-REG-006)', () => {
    const { input } = prepare()
    const result = app.registration.register(input)
    if (!result.ok) throw new Error('falló')
    expect(result.participationId).toMatch(/^[0-9a-f-]{36}$/)
    expect(result.participationId).not.toContain('12345678')
    const audit = JSON.stringify(app.db.prepare('SELECT * FROM audit_events').all())
    expect(audit).not.toContain('12345678')
    expect(audit).not.toContain('Quispe')
  })

  it('sin un consentimiento obligatorio no guarda nada (RN-002)', () => {
    const { input } = prepare()
    input.consents[0]!.accepted = false
    expect(app.registration.register(input)).toEqual({ ok: false, error: 'consent_missing' })
    input.consents = [input.consents[1]!]
    expect(app.registration.register(input)).toEqual({ ok: false, error: 'consent_missing' })
    expect(participations()).toEqual([])
  })

  it('rechaza una versión de texto que ya no está vigente', () => {
    const { input } = prepare()
    app.db.prepare("UPDATE consent_versions SET status = 'retired' WHERE type = 'terms_data'").run()
    expect(app.registration.register(input)).toEqual({ ok: false, error: 'consent_outdated' })
  })

  it('devuelve los errores de cada campo con datos inválidos', () => {
    const { input } = prepare()
    input.participant = { firstNames: 'Ana1', lastNames: '', dni: '123' }
    const result = app.registration.register(input)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toBe('invalid_data')
      expect(Object.keys(result.fields ?? {}).sort()).toEqual(['dni', 'firstNames', 'lastNames'])
    }
    expect(participations()).toEqual([])
  })

  it.each([
    ['escenario de otra campaña', (i: RegistrationInput, other: string) => (i.selections.scenarioId = other)],
    ['sin personaje obligatorio', (i: RegistrationInput) => (i.selections.characterIds = [])],
    ['personaje repetido', (i: RegistrationInput) => (i.selections.characterIds = [i.selections.characterIds[0]!, i.selections.characterIds[0]!])],
    ['marco distinto del automático', (i: RegistrationInput, other: string) => (i.selections.frameId = other)]
  ])('rechaza una selección inválida: %s', (_name, mutate) => {
    const { input } = prepare()
    const otherScenario = app.catalog.getDetail(app.campaignId('DEMO-BICENTENARIO'))!.scenarios[0]!.id
    mutate(input, otherScenario)
    expect(app.registration.register(input)).toEqual({ ok: false, error: 'invalid_selection' })
  })

  it('acepta hasta tres personajes en el orden elegido y rechaza más que las posiciones configuradas', () => {
    const { input, detail } = prepare()
    expect(detail.characterSlots).toHaveLength(3)
    const [a, b, c] = detail.characters.map((ch) => ch.id)
    input.selections.characterIds = [c!, a!, b!]
    const result = app.registration.register(input)
    expect(result.ok).toBe(true)
    const [row] = participations()
    expect(JSON.parse(row!['selections_json'] as string).characterIds).toEqual([c, a, b])
  })

  it('rechaza un personaje que no pertenece al escenario elegido', () => {
    const { input, detail } = prepare()
    const parque = detail.scenarios.find((s) => s.name === 'Parque')!
    const bibliotecaria = detail.characters.find((c) => c.name === 'Bibliotecaria')!
    input.selections = { scenarioId: parque.id, characterIds: [bibliotecaria.id], frameId: null }
    expect(app.registration.register(input)).toEqual({ ok: false, error: 'invalid_selection' })
  })

  it('rechaza más personajes que las posiciones configuradas', () => {
    const { input, detail } = prepare()
    app.db
      .prepare('UPDATE campaigns SET config_json = json_set(config_json, ?, json(?)) WHERE id = ?')
      .run('$.characterSlots', JSON.stringify([{ x: 0, y: 0, scale: 0.3 }]), input.campaignId)
    input.selections.characterIds = detail.characters.slice(0, 2).map((ch) => ch.id)
    expect(app.registration.register(input)).toEqual({ ok: false, error: 'invalid_selection' })
  })

  it('rechaza una sesión inexistente, otra campaña o un segundo registro', () => {
    const { input } = prepare()
    expect(app.registration.register({ ...input, sessionId: '00000000-0000-4000-8000-000000000000' })).toEqual({
      ok: false,
      error: 'session_invalid'
    })
    expect(app.registration.register({ ...input, campaignId: app.campaignId('DEMO-BICENTENARIO') })).toEqual({
      ok: false,
      error: 'campaign_unavailable'
    })
    expect(app.registration.register(input).ok).toBe(true)
    expect(app.registration.register(input)).toEqual({ ok: false, error: 'session_invalid' })
  })

  it('termina el registro aunque la campaña se desactive durante la sesión (RF-EXP-007)', () => {
    const { input } = prepare()
    app.db.prepare("UPDATE campaigns SET status = 'inactive' WHERE id = ?").run(input.campaignId)
    expect(app.registration.register(input).ok).toBe(true)
  })

  it('una participación abandonada queda cancelada con fecha de finalización', () => {
    const { input, sessionId } = prepare()
    expect(app.registration.register(input).ok).toBe(true)
    app.sessions.end(sessionId, 'timeout')
    const [row] = participations()
    expect(row).toMatchObject({ status: 'cancelled' })
    expect(row!['finished_at']).toBeTruthy()
  })
})
