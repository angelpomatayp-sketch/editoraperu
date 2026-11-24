import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'
import { afterEach, describe, expect, it } from 'vitest'
import type { AdminAttract, AdminCampaign, AdminMedia, AdminUserRow, DashboardData, LoginResult } from '../../src/shared/admin'
import type { Settings } from '../../src/shared/settings'
import { charactersForScenario } from '../../src/shared/campaign'
import { adminApp } from './adminHelpers'

let t: ReturnType<typeof adminApp>
afterEach(() => t?.cleanup())

const errorCode = (promise: Promise<unknown>) => promise.then(() => 'ok', (e: { code: string }) => e.code)

describe('acceso administrativo (8.11)', () => {
  it('pide la cuenta inicial solo mientras no hay usuarios (RF-USR-002)', () => {
    t = adminApp()
    expect(t.api.status()).toEqual({ setupRequired: true })
    expect(t.api.login({ username: 'admin', password: 'x' })).toEqual({ ok: false, error: 'setup_required' })
    t.admin()
    expect(t.api.status()).toEqual({ setupRequired: false })
    expect(t.api.setup({ username: 'otro', displayName: 'Otro', password: 'editora2026' }).ok).toBe(false)
  })

  it('rechaza contraseñas débiles en la configuración inicial', () => {
    t = adminApp()
    expect(t.api.setup({ username: 'admin', displayName: 'Adm', password: 'corta' })).toMatchObject({ ok: false, error: 'invalid_input' })
  })

  it('bloquea temporalmente tras intentos fallidos y no registra la contraseña (RF-AUT-003)', () => {
    t = adminApp()
    t.admin()
    for (let i = 0; i < 5; i++) expect(t.api.login({ username: 'admin', password: 'mala-clave-1' })).toEqual({ ok: false, error: 'invalid_credentials' })
    expect(t.api.login({ username: 'admin', password: 'editora2026' })).toMatchObject({ ok: false, error: 'locked' })
    t.advance(301)
    expect(t.api.login({ username: 'admin', password: 'editora2026' }).ok).toBe(true)
    const audit = JSON.stringify(t.app.db.prepare('SELECT * FROM audit_events').all())
    expect(audit).not.toContain('mala-clave-1')
    expect(audit).not.toContain('editora2026')
  })

  it('un usuario inexistente recibe el mismo mensaje que una contraseña incorrecta', () => {
    t = adminApp()
    t.admin()
    expect(t.api.login({ username: 'nadie', password: 'editora2026' })).toEqual({ ok: false, error: 'invalid_credentials' })
  })

  it('la sesión expira por inactividad (RF-AUT-005)', async () => {
    t = adminApp()
    const token = t.admin()
    expect((await t.api.invoke(token, 'session.me', {})).ok).toBe(true)
    t.advance(301)
    expect(await t.api.invoke(token, 'session.me', {})).toMatchObject({ ok: false, error: 'session_expired' })
  })

  it('cambia la propia contraseña verificando la actual (RF-AUT-004)', async () => {
    t = adminApp()
    const token = t.admin()
    expect(await errorCode(t.call(token, 'session.changePassword', { current: 'otra', next: 'nueva2026clave' }))).toBe('wrong_password')
    await t.call(token, 'session.changePassword', { current: 'editora2026', next: 'nueva2026clave' })
    expect(t.api.login({ username: 'admin', password: 'editora2026' }).ok).toBe(false)
    expect(t.api.login({ username: 'admin', password: 'nueva2026clave' }).ok).toBe(true)
  })
})

describe('roles y permisos (RF-AUT-006, sección 14)', () => {
  it('cada rol accede solo a sus funciones; el proceso principal lo verifica', async () => {
    t = adminApp()
    const admin = t.admin()
    await t.call(admin, 'users.create', { username: 'contenido', displayName: 'Contenido', role: 'content', password: 'temporal2026' })
    await t.call(admin, 'users.create', { username: 'soporte', displayName: 'Soporte', role: 'operator', password: 'temporal2026' })

    const content = t.login('contenido', 'temporal2026')
    // Con contraseña temporal solo puede cambiarla.
    expect(await errorCode(t.call(content, 'campaigns.list'))).toBe('password_change_required')
    await t.call(content, 'session.changePassword', { current: 'temporal2026', next: 'contenido2026' })
    expect(await errorCode(t.call(content, 'campaigns.list'))).toBe('ok')
    expect(await errorCode(t.call(content, 'users.list'))).toBe('forbidden')
    expect(await errorCode(t.call(content, 'system.quit'))).toBe('forbidden')

    const operator = t.login('soporte', 'temporal2026')
    await t.call(operator, 'session.changePassword', { current: 'temporal2026', next: 'soporte2026x' })
    expect(await errorCode(t.call(operator, 'campaigns.list'))).toBe('forbidden')
    expect(await errorCode(t.call(operator, 'settings.getBackground'))).toBe('ok')
    await t.call(operator, 'system.quit')
    expect(t.quitBy()).toBeTruthy()
  })

  it('rechaza tokens inválidos, operaciones desconocidas y datos inválidos', async () => {
    t = adminApp()
    const token = t.admin()
    expect(await t.api.invoke('token-falso', 'campaigns.list', {})).toMatchObject({ error: 'session_expired' })
    expect(await t.api.invoke(token, 'borrar.todo', {})).toMatchObject({ error: 'unknown_method' })
    expect(await t.api.invoke(token, 'campaigns.create', { name: '' })).toMatchObject({ error: 'invalid_input' })
  })
})

describe('campañas y recursos (8.13, 8.14)', () => {
  it('arma una campaña completa desde cero, la valida y la publica', async () => {
    t = adminApp()
    const token = t.admin()
    let campaign = await t.call<AdminCampaign>(token, 'campaigns.create', { name: 'Feria del Libro 2026' })
    expect(campaign.code).toMatch(/^FERIA-DEL-LIBRO-2026-[0-9A-F]{4}$/)
    expect(campaign.status).toBe('draft')
    expect(campaign.problems).toContain('Agregue al menos un escenario activo o habilite «Usar fondo real de la cámara» en Datos.')
    expect(await errorCode(t.call(token, 'campaigns.setStatus', { id: campaign.id, status: 'active' }))).toBe('invalid_campaign')

    await t.nextFile('machu_picchu.jpg', { width: 1080, height: 1920, format: 'jpeg' })
    campaign = await t.call<AdminCampaign>(token, 'resources.add', { campaignId: campaign.id, type: 'scenario' })
    const scenario = campaign.resources.find((r) => r.type === 'scenario')!
    expect(scenario).toMatchObject({ name: 'machu picchu', width: 1080, height: 1920, active: true })
    expect(campaign.problems).toEqual(['La campaña exige personaje: agregue al menos un personaje activo o, si no usará personajes, en «Datos» cambie «Personajes» a «No se usa».'])

    // Un personaje sin transparencia se rechaza (RF-REC-002).
    await t.nextFile('nina.jpg', { format: 'jpeg' })
    expect(await errorCode(t.call(token, 'resources.add', { campaignId: campaign.id, type: 'character', scenarioIds: [scenario.id] }))).toBe('invalid_file')

    await t.nextFile('nina.png', { alpha: true })
    campaign = await t.call<AdminCampaign>(token, 'resources.add', { campaignId: campaign.id, type: 'character', scenarioIds: [scenario.id] })
    const nina = campaign.resources.find((r) => r.type === 'character')!
    expect(nina.scenarioIds).toEqual([scenario.id])
    expect(nina.animationUrl).toBeNull()
    expect(nina.contentBounds).toMatchObject({ x: 0, y: 0, width: 1, height: 1 })
    expect(nina.anchorX).toBeCloseTo(0.5)
    campaign = await t.call<AdminCampaign>(token, 'resources.updateMotion', {
      campaignId: campaign.id,
      resourceId: nina.id,
      entryDirection: 'left',
      anchorX: 0.45,
      anchorY: 0.98
    })
    expect(campaign.resources.find((r) => r.id === nina.id)!.entryDirection).toBe('left')
    expect(campaign.resources.find((r) => r.id === nina.id)!.anchorX).toBe(0.45)
    expect(campaign.problems).toEqual([])

    // La animación es opcional y solo admite WebM; el PNG sigue siendo la pose de la foto final.
    const animation = join(t.files, 'nina.webm')
    writeFileSync(animation, Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01, 0x42, 0xf7, 0x81]))
    t.pickRaw(animation)
    campaign = await t.call<AdminCampaign>(token, 'resources.setAnimation', { campaignId: campaign.id, resourceId: nina.id })
    expect(campaign.resources.find((r) => r.id === nina.id)?.animationUrl).toMatch(/^totem-media:\/\/content\//)

    await t.nextFile('logo.png', { width: 400, height: 400, alpha: true })
    campaign = await t.call<AdminCampaign>(token, 'resources.add', { campaignId: campaign.id, type: 'logo' })

    campaign = await t.call<AdminCampaign>(token, 'campaigns.setStatus', { id: campaign.id, status: 'active' })
    expect(campaign.status).toBe('active')

    // Aparece al público con su escenario y su personaje.
    const available = t.app.catalog.listAvailable().find((c) => c.id === campaign.id)
    expect(available?.name).toBe('Feria del Libro 2026')
    const detail = t.app.catalog.getDetail(campaign.id)!
    expect(charactersForScenario(detail, scenario.id).map((c) => c.id)).toEqual([nina.id])
    expect(charactersForScenario(detail, scenario.id)[0]?.animationUrl).toMatch(/^totem-media:\/\/content\//)
    expect(detail.overlays).toHaveLength(1)
  })

  it('valida los archivos: tipo real, tamaño mínimo y cancelación del diálogo (RF-REC-001)', async () => {
    t = adminApp()
    const token = t.admin()
    const campaign = await t.call<AdminCampaign>(token, 'campaigns.create', { name: 'Prueba' })
    t.pickRaw(join(__dirname, 'admin.test.ts'))
    expect(await errorCode(t.call(token, 'resources.add', { campaignId: campaign.id, type: 'scenario' }))).toBe('invalid_file')
    await t.nextFile('mini.png', { width: 100, height: 100 })
    expect(await errorCode(t.call(token, 'resources.add', { campaignId: campaign.id, type: 'scenario' }))).toBe('invalid_file')
    t.pickRaw(null)
    expect(await t.call(token, 'resources.add', { campaignId: campaign.id, type: 'scenario' })).toBeNull()
  })

  it('acepta un GIF transparente como personaje y genera automáticamente su pose PNG', async () => {
    t = adminApp()
    const token = t.admin()
    const campaign = await t.call<AdminCampaign>(token, 'campaigns.create', { name: 'Personaje GIF' })
    await t.nextGif('hombre-caminando-y-posando.gif')
    const updated = await t.call<AdminCampaign>(token, 'resources.add', { campaignId: campaign.id, type: 'character' })
    const character = updated.resources.find((resource) => resource.type === 'character')!
    expect(character.name).toBe('hombre caminando y posando')
    expect(character.imageUrl).toMatch(/\.png$/)
    expect(character.animationUrl).toMatch(/\.gif$/)
    expect(character.animationDurationMs).toBe(1200)
    expect(character.contentBounds.width).toBeLessThan(1)
  })

  it('guarda la ubicación y aumenta la versión de configuración (RF-CMP-003)', async () => {
    t = adminApp()
    const token = t.admin()
    let campaign = await t.call<AdminCampaign>(token, 'campaigns.create', { name: 'Ubicación' })
    await t.nextFile('logo.png', { width: 400, height: 400, alpha: true })
    campaign = await t.call<AdminCampaign>(token, 'resources.add', { campaignId: campaign.id, type: 'logo' })
    const logo = campaign.resources[0]!
    const before = (t.app.db.prepare('SELECT config_version FROM campaigns WHERE id = ?').get(campaign.id) as { config_version: number }).config_version

    campaign = await t.call<AdminCampaign>(token, 'campaigns.saveLayout', {
      id: campaign.id,
      photo: { x: 0.1, y: 0.2, width: 0.8, height: 0.7, layer: 10 },
      characterSlots: [
        { x: 0, y: 0.5, scale: 0.3 },
        { x: 0.7, y: 0.5, scale: 0.3 },
        { x: 0.4, y: 0.1, scale: 0.2 }
      ],
      characterAnimation: { enabled: true, entryDurationMs: 1200, prepareDurationMs: 500, staggerMs: 80, tiltDegrees: 1.2 },
      overlays: [{ resourceId: logo.id, x: 0.8, y: 0.02, scale: 0.12 }]
    })
    expect(campaign.photo).toMatchObject({ x: 0.1, width: 0.8 })
    expect(campaign.characterSlots).toHaveLength(3)
    expect(campaign.characterAnimation.entryDurationMs).toBe(1200)
    expect(campaign.resources[0]).toMatchObject({ x: 0.8, y: 0.02, scale: 0.12 })
    const after = (t.app.db.prepare('SELECT config_version FROM campaigns WHERE id = ?').get(campaign.id) as { config_version: number }).config_version
    expect(after).toBe(before + 1)

    expect(
      await errorCode(
        t.call(token, 'campaigns.saveLayout', { id: campaign.id, photo: { x: 0.5, y: 0, width: 0.8, height: 0.5 }, characterSlots: [{ x: 0, y: 0, scale: 0.2 }], overlays: [] })
      )
    ).toBe('invalid_input')
  })

  it('guarda, conserva y restablece el ajuste de video sin cambiar la zona del participante', async () => {
    t = adminApp()
    const token = t.admin()
    const id = t.app.campaignId('DEMO-LECTURA')
    const initial = await t.call<AdminCampaign>(token, 'campaigns.get', { id })
    const character = initial.resources.find(r => r.type === 'character')!
    const layout = { id, photo: initial.photo, characterSlots: initial.characterSlots, overlays: [] }
    const transforms = { [character.id]: { scale: 0.75, x: -0.06, y: 0.03 } }
    await t.call(token, 'campaigns.saveLayout', { ...layout, characterVideoTransforms: transforms })
    let result = await t.call<AdminCampaign>(token, 'campaigns.get', { id })
    expect(result.characterVideoTransforms).toEqual(transforms)
    expect(result.photo).toEqual(initial.photo)
    expect(result.characterSlots).toEqual(initial.characterSlots)
    result = await t.call<AdminCampaign>(token, 'campaigns.saveLayout', layout)
    expect(result.characterVideoTransforms).toEqual(transforms)
    result = await t.call<AdminCampaign>(token, 'campaigns.saveLayout', { ...layout, characterVideoTransforms: {} })
    expect(result.characterVideoTransforms).toEqual({})
  })

  it('reemplaza solo el escenario conservando personajes, ajustes y fotografías ya generadas', async () => {
    t = adminApp()
    const token = t.admin()
    const { sessionId } = t.app.registerParticipant()
    const id = t.app.campaignId('DEMO-LECTURA')
    let campaign = await t.call<AdminCampaign>(token, 'campaigns.get', { id })
    const scenario = campaign.resources.find(r => r.type === 'scenario')!
    const characters = campaign.resources.filter(r => r.type === 'character')
    const transforms = { [characters[0]!.id]: { scale: 0.8, x: 0.02, y: -0.03 } }
    campaign = await t.call<AdminCampaign>(token, 'campaigns.saveLayout', {
      id, photo: campaign.photo, characterSlots: campaign.characterSlots, overlays: [], characterVideoTransforms: transforms
    })
    const camera = await sharp({ create: { width: 3840, height: 2160, channels: 3, background: '#993333' } }).jpeg().toBuffer()
    expect(await t.app.capture.saveCapture(sessionId, camera)).toEqual({ ok: true })
    expect((await t.app.capture.compose(sessionId)).ok).toBe(true)
    const photos = t.app.db.prepare('SELECT * FROM photos ORDER BY id').all() as { file_path: string }[]
    const bytes = photos.map(p => readFileSync(join(t.app.paths.root, p.file_path)))
    const old = t.app.db.prepare('SELECT * FROM resources WHERE id = ?').get(scenario.id) as { file_path: string }
    const placements = t.app.db.prepare('SELECT * FROM campaign_resources WHERE campaign_id = ? ORDER BY resource_id').all(id)
    const version = (t.app.db.prepare('SELECT config_version FROM campaigns WHERE id = ?').get(id) as { config_version: number }).config_version
    await t.nextFile('nuevo-escenario.jpg', { width: 1080, height: 1920, format: 'jpeg' })
    const result = await t.call<AdminCampaign>(token, 'resources.replaceScenarioImage', { campaignId: id, resourceId: scenario.id })
    expect(result.resources.find(r => r.id === scenario.id)).toMatchObject({ id: scenario.id, name: scenario.name, width: 1080, height: 1920, active: scenario.active })
    expect(result.resources.find(r => r.id === scenario.id)!.imageUrl).not.toBe(scenario.imageUrl)
    expect(result.resources.filter(r => r.type === 'character')).toEqual(characters)
    expect(result.characterVideoTransforms).toEqual(transforms)
    expect(result.photo).toEqual(campaign.photo)
    expect(result.characterSlots).toEqual(campaign.characterSlots)
    expect(t.app.db.prepare('SELECT * FROM campaign_resources WHERE campaign_id = ? ORDER BY resource_id').all(id)).toEqual(placements)
    expect(t.app.db.prepare('SELECT * FROM photos ORDER BY id').all()).toEqual(photos)
    photos.forEach((p, i) => expect(readFileSync(join(t.app.paths.root, p.file_path))).toEqual(bytes[i]))
    expect(existsSync(join(t.app.contentDir, old.file_path))).toBe(true)
    expect((t.app.db.prepare('SELECT config_version FROM campaigns WHERE id = ?').get(id) as { config_version: number }).config_version).toBe(version + 1)
    expect(t.app.catalog.getDetail(id)!.scenarios.find(s => s.id === scenario.id)).toMatchObject({ width: 1080, height: 1920 })
  })

  it('cancelar o elegir una imagen inválida no altera el escenario ni sus asociaciones', async () => {
    t = adminApp()
    const token = t.admin()
    const id = t.app.campaignId('DEMO-LECTURA')
    const before = await t.call<AdminCampaign>(token, 'campaigns.get', { id })
    const scenario = before.resources.find(r => r.type === 'scenario')!
    const payload = { campaignId: id, resourceId: scenario.id }
    t.pickRaw(null)
    expect(await t.call(token, 'resources.replaceScenarioImage', payload)).toBeNull()
    t.pickRaw(join(__dirname, 'admin.test.ts'))
    expect(await errorCode(t.call(token, 'resources.replaceScenarioImage', payload))).toBe('invalid_file')
    expect(await t.call(token, 'campaigns.get', { id })).toEqual(before)
    const character = before.resources.find(r => r.type === 'character')!
    expect(await errorCode(t.call(token, 'resources.replaceScenarioImage', { campaignId: id, resourceId: character.id }))).toBe('invalid_input')
  })

  it('recalcula y limpia la zona transparente al reemplazar la imagen del escenario', async () => {
    t = adminApp()
    const token = t.admin()
    const id = t.app.campaignId('DEMO-LECTURA')
    const campaign = await t.call<AdminCampaign>(token, 'campaigns.get', { id })
    const scenario = campaign.resources.find(r => r.type === 'scenario')!
    const file = join(t.files, 'escenario-con-hueco.png')
    await sharp({ create: { width: 600, height: 1000, channels: 4, background: '#334455' } })
      .composite([{ input: { create: { width: 300, height: 600, channels: 4, background: '#000000' } }, left: 150, top: 200, blend: 'dest-out' }])
      .png().toFile(file)
    t.pickRaw(file)
    let result = await t.call<AdminCampaign>(token, 'resources.replaceScenarioImage', { campaignId: id, resourceId: scenario.id })
    expect(result.resources.find(r => r.id === scenario.id)!.photoHole).not.toBeNull()
    await t.nextFile('escenario-opaco.png')
    result = await t.call<AdminCampaign>(token, 'resources.replaceScenarioImage', { campaignId: id, resourceId: scenario.id })
    expect(result.resources.find(r => r.id === scenario.id)!.photoHole).toBeNull()
  })

  it('un recurso usado en participaciones se archiva; uno sin usar se elimina con su archivo (RF-REC-006)', async () => {
    t = adminApp()
    const token = t.admin()
    t.app.registerParticipant()
    const lectura = t.app.campaignId('DEMO-LECTURA')
    let campaign = await t.call<AdminCampaign>(token, 'campaigns.get', { id: lectura })
    const used = campaign.resources.find((r) => r.name === 'Biblioteca')!
    const result = await t.call<{ campaign: AdminCampaign; archived: boolean }>(token, 'resources.remove', { campaignId: lectura, resourceId: used.id })
    expect(result.archived).toBe(true)
    expect(result.campaign.resources.some((r) => r.id === used.id)).toBe(false)

    await t.nextFile('extra.png', { width: 1080, height: 1920 })
    campaign = await t.call<AdminCampaign>(token, 'resources.add', { campaignId: lectura, type: 'scenario' })
    const extra = campaign.resources.find((r) => r.name === 'extra')!
    const file = readdirSync(join(t.app.contentDir, 'campaigns', lectura))[0]!
    const removed = await t.call<{ campaign: AdminCampaign; archived: boolean }>(token, 'resources.remove', { campaignId: lectura, resourceId: extra.id })
    expect(removed.archived).toBe(false)
    expect(existsSync(join(t.app.contentDir, 'campaigns', lectura, file))).toBe(false)
  })

  it('una campaña con participaciones nunca se elimina: se archiva (RF-CAM-006)', async () => {
    t = adminApp()
    const token = t.admin()
    t.app.registerParticipant()
    const campaign = await t.call<AdminCampaign>(token, 'campaigns.setStatus', { id: t.app.campaignId('DEMO-LECTURA'), status: 'archived' })
    expect(campaign.status).toBe('archived')
    expect(campaign.participations).toBe(1)
    expect(t.app.catalog.listAvailable().map((c) => c.name)).toEqual(['Perú Bicentenario'])
  })

  it('reordena recursos y asigna personajes a varios escenarios', async () => {
    t = adminApp()
    const token = t.admin()
    const id = t.app.campaignId('DEMO-LECTURA')
    let campaign = await t.call<AdminCampaign>(token, 'campaigns.get', { id })
    const [biblioteca, parque] = campaign.resources.filter((r) => r.type === 'scenario')
    campaign = await t.call<AdminCampaign>(token, 'resources.move', { campaignId: id, resourceId: parque!.id, direction: 'up' })
    expect(campaign.resources.filter((r) => r.type === 'scenario').map((r) => r.name)).toEqual(['Parque', 'Biblioteca'])

    const biblio = campaign.resources.find((r) => r.name === 'Bibliotecaria')!
    campaign = await t.call<AdminCampaign>(token, 'resources.update', {
      campaignId: id,
      resourceId: biblio.id,
      name: 'Bibliotecaria',
      active: true,
      scenarioIds: [biblioteca!.id, parque!.id]
    })
    expect(campaign.resources.find((r) => r.id === biblio.id)!.scenarioIds.sort()).toEqual([biblioteca!.id, parque!.id].sort())
    expect(charactersForScenario(t.app.catalog.getDetail(id)!, parque!.id).map((c) => c.name)).toContain('Bibliotecaria')
  })
})

describe('contenido de atracción (8.15)', () => {
  it('agrega, ordena, edita y elimina', async () => {
    t = adminApp()
    const token = t.admin()
    await t.nextFile('promo.jpg', { width: 1080, height: 1920, format: 'jpeg' })
    let media = (await t.call<AdminMedia[]>(token, 'media.add'))!
    expect(media.at(-1)).toMatchObject({ name: 'promo', type: 'image', displaySeconds: 8, active: true })
    const promo = media.at(-1)!

    media = await t.call<AdminMedia[]>(token, 'media.move', { id: promo.id, direction: 'up' })
    media = await t.call<AdminMedia[]>(token, 'media.update', { id: promo.id, name: 'Promoción', active: false, displaySeconds: 12 })
    expect(media.find((m) => m.id === promo.id)).toMatchObject({ name: 'Promoción', active: false, displaySeconds: 12 })

    media = await t.call<AdminMedia[]>(token, 'media.remove', { id: promo.id })
    expect(media.some((m) => m.id === promo.id)).toBe(false)
  })

  it('pantalla principal: textos, imagen de fondo y conservación al guardar otros parámetros', async () => {
    t = adminApp()
    const token = t.admin()
    let attract = await t.call<AdminAttract>(token, 'attract.get')
    expect(attract).toMatchObject({ mode: 'institutional', slogan: 'Grandes historias también las escribes tú', backgroundUrl: null })

    await t.nextFile('fondo.png', { width: 1080, height: 1920, format: 'png' })
    attract = await t.call<AdminAttract>(token, 'attract.setImage', { kind: 'background' })
    expect(attract.backgroundPath).toMatch(/^institutional\//)
    expect(attract.backgroundUrl).not.toBeNull()
    const firstFile = join(t.app.contentDir, attract.backgroundPath)

    const { logoUrl: _l, backgroundUrl: _b, logoPath: _lp, backgroundPath: _bp, ...texts } = attract
    attract = await t.call<AdminAttract>(token, 'attract.save', { ...texts, showTexts: false, cta: 'Toque para empezar' })
    expect(attract).toMatchObject({ showTexts: false, cta: 'Toque para empezar' })

    // Guardar los parámetros generales no pisa la pantalla principal.
    const general = await t.call<Settings>(token, 'settings.getGeneral')
    await t.call(token, 'settings.saveGeneral', { ...general, attract: { ...general.attract, cta: 'Otro texto' } })
    expect((await t.call<AdminAttract>(token, 'attract.get')).cta).toBe('Toque para empezar')

    // Reemplazar la imagen elimina el archivo anterior.
    await t.nextFile('fondo2.png', { width: 1080, height: 1920, format: 'png' })
    await t.call(token, 'attract.setImage', { kind: 'background' })
    expect(existsSync(firstFile)).toBe(false)
  })
})

describe('usuarios (8.23)', () => {
  it('protege al último administrador y a la propia cuenta', async () => {
    t = adminApp()
    const token = t.admin()
    const [me] = await t.call<AdminUserRow[]>(token, 'users.list')
    expect(await errorCode(t.call(token, 'users.update', { id: me!.id, displayName: 'Yo', role: 'sysadmin', active: false }))).toBe('self')
    expect(await errorCode(t.call(token, 'users.update', { id: me!.id, displayName: 'Yo', role: 'content', active: true }))).toBe('last_admin')
    expect(await errorCode(t.call(token, 'users.create', { username: 'admin', displayName: 'Duplicado', role: 'content', password: 'temporal2026' }))).toBe('duplicate')
  })

  it('desactivar cierra sus sesiones y restablecer exige cambiar la contraseña', async () => {
    t = adminApp()
    const token = t.admin()
    const list = await t.call<AdminUserRow[]>(token, 'users.create', { username: 'ana', displayName: 'Ana', role: 'content', password: 'temporal2026' })
    const ana = list.find((u) => u.username === 'ana')!
    const anaToken = t.login('ana', 'temporal2026')

    await t.call(token, 'users.update', { id: ana.id, displayName: 'Ana', role: 'content', active: false })
    expect(await t.api.invoke(anaToken, 'session.me', {})).toMatchObject({ error: 'session_expired' })
    expect((t.api.login({ username: 'ana', password: 'temporal2026' }) as LoginResult).ok).toBe(false)

    await t.call(token, 'users.update', { id: ana.id, displayName: 'Ana', role: 'content', active: true })
    const reset = await t.call<AdminUserRow[]>(token, 'users.resetPassword', { id: ana.id, password: 'otraclave2026' })
    expect(reset.find((u) => u.id === ana.id)!.mustChangePassword).toBe(true)
    expect(t.login('ana', 'otraclave2026')).toBeTruthy()
  })
})

describe('resumen y sistema (8.12, RF-CFG-002)', () => {
  it('muestra totales del día y alertas con texto', async () => {
    t = adminApp()
    const token = t.admin()
    t.app.registerParticipant()
    const data = await t.call<DashboardData>(token, 'dashboard.get')
    expect(data).toMatchObject({ participationsToday: 1, participationsTotal: 1, availableCampaigns: 2, connectivity: 'not_configured' })
    expect(data.alerts).toContain('La publicación por QR no está configurada.')
  })

  it('guarda la URL y la clave del servicio sin devolverla nunca', async () => {
    t = adminApp()
    const token = t.admin()
    expect(await errorCode(t.call(token, 'settings.savePublication', { baseUrl: 'https://fotos.example.pe', secret: 'corta' }))).toBe('invalid_secret')
    const view = await t.call<object>(token, 'settings.savePublication', { baseUrl: 'https://fotos.example.pe', secret: 'x'.repeat(40) })
    expect(view).toEqual({ baseUrl: 'https://fotos.example.pe', secretConfigured: true, devOverride: null, builtInUrl: null })
    expect(JSON.stringify(view)).not.toContain('xxxx')
    expect(t.secret.value).toBe('x'.repeat(40))
    expect(t.settings.get().publication.baseUrl).toBe('https://fotos.example.pe')
    expect(JSON.stringify(t.app.db.prepare('SELECT * FROM audit_events').all())).not.toContain('xxxx')
  })

  it('guarda la calibración del croma validada', async () => {
    t = adminApp()
    const token = t.admin()
    const saved = await t.call<{ method: string; chroma: { keyColor: string } }>(token, 'settings.saveBackground', {
      method: 'chroma',
      chroma: { keyColor: '#10a050', similarity: 0.2, smoothness: 0.1, spill: 0.5 }
    })
    expect(saved).toMatchObject({ method: 'chroma', chroma: { keyColor: '#10a050' } })
    expect(t.settings.get().background.method).toBe('chroma')
    expect(t.settings.get().chroma.keyColor).toBe('#10a050')
    expect(
      await errorCode(t.call(token, 'settings.saveBackground', { method: 'chroma', chroma: { keyColor: 'verde', similarity: 0.2, smoothness: 0.1, spill: 0.5 } }))
    ).toBe('invalid_input')
    expect(await errorCode(t.call(token, 'settings.saveBackground', { method: 'magia', chroma: t.settings.get().chroma }))).toBe('invalid_input')
  })

  it('guarda controles y color por separado sin que Configuración general los sobrescriba', async () => {
    t = adminApp()
    const token = t.admin()
    const oldGeneral = await t.call<Settings>(token, 'settings.getGeneral')
    const input = {
      method: 'segmentation', chroma: oldGeneral.chroma,
      cameraControls: { focusMode: 'manual', focusDistance: 20 }, cameraControlsEnabled: true, matchSceneTone: true
    }
    expect(await t.call(token, 'settings.saveBackground', input)).toMatchObject(input)
    await t.call(token, 'settings.saveGeneral', oldGeneral)
    expect(await t.call(token, 'settings.getBackground')).toMatchObject(input)
    await t.call(token, 'settings.saveBackground', { ...input, cameraControlsEnabled: false, matchSceneTone: false })
    expect(t.settings.get().capture).toMatchObject({ cameraControls: input.cameraControls, cameraControlsEnabled: false, matchSceneTone: false })
  })
})
