import { afterEach, describe, expect, it } from 'vitest'
import { autoFrameId, charactersForScenario, needsCharacterStep, needsFrameStep } from '../../src/shared/campaign'
import { seededApp } from './helpers'

let app: ReturnType<typeof seededApp>

afterEach(() => app?.cleanup())

describe('campañas disponibles (RN-001, RF-EXP-001)', () => {
  it('muestra solo campañas activas, vigentes y con recursos válidos', () => {
    app = seededApp()
    const names = app.catalog.listAvailable().map((c) => c.name)
    expect(names).toEqual(['Lectura en familia', 'Perú Bicentenario'])

    const unavailable = app.db
      .prepare("SELECT detail_json FROM audit_events WHERE action = 'campaign.unavailable'")
      .all() as { detail_json: string }[]
    expect(unavailable).toHaveLength(1)
    expect(JSON.parse(unavailable[0]!.detail_json).code).toBe('DEMO-INCOMPLETA')
  })

  it('la tarjeta usa la imagen de presentación o, sin ella, la del primer escenario', () => {
    app = seededApp()
    app.db.prepare('UPDATE campaigns SET image_path = NULL').run()
    const id = app.campaignId('DEMO-LECTURA')
    const card = app.catalog.listAvailable().find((c) => c.id === id)!
    expect(card.imageUrl).toBe(app.catalog.getDetail(id)!.scenarios[0]!.imageUrl)
  })

  it('oculta una campaña inactiva o fuera de vigencia', () => {
    app = seededApp({ now: () => new Date('2026-10-05T15:00:00Z') })
    app.db.prepare("UPDATE campaigns SET status = 'inactive' WHERE code = 'DEMO-LECTURA'").run()
    app.db.prepare("UPDATE campaigns SET ends_at = '2026-10-01T00:00:00Z' WHERE code = 'DEMO-BICENTENARIO'").run()
    expect(app.catalog.listAvailable()).toEqual([])
  })

  it('oculta una campaña si se desactiva un recurso obligatorio', () => {
    app = seededApp()
    app.db
      .prepare(
        `UPDATE resources SET status = 'inactive' WHERE id IN (
           SELECT resource_id FROM campaign_resources cr JOIN campaigns c ON c.id = cr.campaign_id
           WHERE c.code = 'DEMO-LECTURA' AND cr.is_required = 1)`
      )
      .run()
    expect(app.catalog.listAvailable().map((c) => c.name)).toEqual(['Perú Bicentenario'])
  })
})

describe('detalle de selección (RF-EXP-003 a RF-EXP-005)', () => {
  it('personaje obligatorio y marco único automático', () => {
    app = seededApp()
    const detail = app.catalog.getDetail(app.campaignId('DEMO-LECTURA'))!
    expect(detail.scenarios.map((s) => s.name)).toEqual(['Biblioteca', 'Parque'])
    expect(detail.characters.map((s) => s.name)).toEqual(['Lector', 'Lectora', 'Bibliotecaria'])
    expect(detail.characterSlots).toHaveLength(3)
    expect(detail.overlays.map((o) => o.name)).toEqual(['Logo Editora Perú'])
    expect(detail.characterMode).toBe('required')
    expect(needsCharacterStep(detail, detail.scenarios[0]!.id)).toBe(true)
    expect(needsFrameStep(detail)).toBe(false)
    expect(autoFrameId(detail)).toBe(detail.frames[0]!.id)
    expect(detail.scenarios[0]!.imageUrl).toMatch(/^totem-media:\/\/content\/resources\/dev-seed\//)
  })

  it('sin personaje y con varios marcos para elegir', () => {
    app = seededApp()
    const detail = app.catalog.getDetail(app.campaignId('DEMO-BICENTENARIO'))!
    expect(detail.characters).toEqual([])
    expect(needsCharacterStep(detail, detail.scenarios[0]!.id)).toBe(false)
    expect(needsFrameStep(detail)).toBe(true)
    expect(detail.frames).toHaveLength(2)
  })

  it('cada escenario ofrece sus propios personajes (RF-EXP-004)', () => {
    app = seededApp()
    const detail = app.catalog.getDetail(app.campaignId('DEMO-LECTURA'))!
    const [biblioteca, parque] = detail.scenarios
    expect(charactersForScenario(detail, biblioteca!.id).map((c) => c.name)).toEqual(['Lector', 'Lectora', 'Bibliotecaria'])
    expect(charactersForScenario(detail, parque!.id).map((c) => c.name)).toEqual(['Lector', 'Lectora'])
  })

  it('con personaje obligatorio, un escenario sin personajes no se ofrece', () => {
    app = seededApp()
    const id = app.campaignId('DEMO-LECTURA')
    const parque = app.catalog.getDetail(id)!.scenarios.find((s) => s.name === 'Parque')!
    app.db.prepare('DELETE FROM scenario_characters WHERE scenario_id = ?').run(parque.id)
    expect(app.catalog.getDetail(id)!.scenarios.map((s) => s.name)).toEqual(['Biblioteca'])
  })

  it('no entrega el detalle de una campaña no disponible', () => {
    app = seededApp()
    expect(app.catalog.getDetail(app.campaignId('DEMO-INCOMPLETA'))).toBeNull()
    expect(app.catalog.getDetail('no-existe')).toBeNull()
  })

  it('una campaña desactivada se puede terminar si la sesión ya la eligió (RF-EXP-007)', () => {
    app = seededApp()
    const id = app.campaignId('DEMO-LECTURA')
    app.db.prepare("UPDATE campaigns SET status = 'inactive' WHERE id = ?").run(id)
    expect(app.catalog.getDetail(id)).toBeNull()
    expect(app.catalog.getDetail(id, { allowInactive: true })).not.toBeNull()
  })
})
