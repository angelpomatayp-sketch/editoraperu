import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'
import { afterEach, describe, expect, it } from 'vitest'
import { PublicationError, type PublicationClient } from '../../src/core/publication/publicationClient'
import type {
  AuditRow,
  DeletionResult,
  ExportResult,
  MaintenanceStatus,
  Page,
  ParticipationDetail,
  ParticipationPage,
  SummaryRow
} from '../../src/shared/admin'
import type { Settings } from '../../src/shared/settings'
import { adminApp } from './adminHelpers'

let t: ReturnType<typeof adminApp>
afterEach(() => t?.cleanup())

const errorCode = (promise: Promise<unknown>) => promise.then(() => 'ok', (e: { code: string }) => e.code)

/** Servicio de publicación simulado que puede fallar y recuerda las eliminaciones. */
class FakeClient implements PublicationClient {
  removed: string[] = []
  fail = false
  async upload(photoId: string) {
    if (this.fail) throw new PublicationError('network', 'sin conexión')
    return { token: `TOKEN${photoId.replace(/-/g, '')}`, url: `https://fotos.example/f/${photoId}`, expiresAt: '2099-01-01T00:00:00Z' }
  }
  async health() {
    return true
  }
  async remove(photoId: string) {
    this.removed.push(photoId)
  }
}

/** Participación completa: registrada, capturada, compuesta y publicada. */
async function fullParticipation(client: FakeClient) {
  t.publicationClient.current = client
  const { sessionId, participationId } = t.app.registerParticipant()
  const jpeg = await sharp({ create: { width: 640, height: 480, channels: 3, background: '#00b140' } }).jpeg().toBuffer()
  await t.app.capture.saveCapture(sessionId, new Uint8Array(jpeg))
  await t.app.capture.compose(sessionId)
  await t.publication.publish(sessionId)
  t.app.sessions.end(sessionId, 'completed')
  return participationId
}

/** Usuarios de contenido y de soporte ya con su contraseña definitiva. */
async function roles(admin: string) {
  for (const [username, role] of [
    ['contenido', 'content'],
    ['soporte', 'operator']
  ] as const) {
    await t.call(admin, 'users.create', { username, displayName: username, role, password: 'temporal2026' })
    await t.call(t.login(username, 'temporal2026'), 'session.changePassword', { current: 'temporal2026', next: `${username}2026x` })
  }
  return { content: t.login('contenido', 'contenido2026x'), operator: t.login('soporte', 'soporte2026x') }
}

describe('participaciones (8.16)', () => {
  it('lista con filtros y oculta los datos personales según el rol (RF-PAR-001, RN-008)', async () => {
    t = adminApp()
    const admin = t.admin()
    const { content } = await roles(admin)
    await fullParticipation(new FakeClient())
    t.app.registerParticipant('DEMO-BICENTENARIO', (i) => (i.selections.characterIds = []))

    const all = await t.call<ParticipationPage>(admin, 'participations.list', {})
    expect(all.total).toBe(2)
    expect(all.personal).toBe(true)
    expect(all.items.map((p) => p.fullName)).toEqual(['Ana Quispe', 'Ana Quispe'])

    const published = await t.call<ParticipationPage>(admin, 'participations.list', { photoStatus: 'published' })
    expect(published.items.map((p) => [p.campaignName, p.status])).toEqual([['Lectura en familia', 'completed']])
    const bicentenario = await t.call<ParticipationPage>(admin, 'participations.list', { campaignId: t.app.campaignId('DEMO-BICENTENARIO') })
    expect(bicentenario.items.map((p) => p.photoStatus)).toEqual(['none'])

    const limited = await t.call<ParticipationPage>(content, 'participations.list', {})
    expect(limited.personal).toBe(false)
    expect(limited.items.every((p) => p.fullName === null && p.dni === null)).toBe(true)
  })

  it('la búsqueda por DNI queda limitada a roles autorizados (RF-PAR-002)', async () => {
    t = adminApp()
    const admin = t.admin()
    const { content } = await roles(admin)
    t.app.registerParticipant()
    expect((await t.call<ParticipationPage>(admin, 'participations.list', { dni: '12345678' })).total).toBe(1)
    expect((await t.call<ParticipationPage>(admin, 'participations.list', { dni: '87654321' })).total).toBe(0)
    expect(await errorCode(t.call(content, 'participations.list', { dni: '12345678' }))).toBe('forbidden')
  })

  it('el detalle muestra selecciones, consentimientos y fotos sin el token completo (RF-PAR-003)', async () => {
    t = adminApp()
    const admin = t.admin()
    const id = await fullParticipation(new FakeClient())
    const detail = await t.call<ParticipationDetail>(admin, 'participations.get', { id })
    expect(detail.selections).toEqual({ scenario: 'Biblioteca', characters: ['Lector'], frame: 'Marco Lectura' })
    expect(detail.consents.map((c) => [c.type, c.version, c.accepted])).toEqual([
      ['image_use', '0.1-prueba', true],
      ['terms_data', '0.1-prueba', true]
    ])
    const final = detail.photos.find((p) => p.kind === 'final')!
    expect(final.status).toBe('published')
    expect(final.tokenHint).toMatch(/^TOKEN.…$/)
    expect(JSON.stringify(detail)).not.toMatch(/TOKEN[0-9a-f]{20}/)
  })

  it('ver una fotografía exige permiso de datos personales y queda registrado (RF-FOT-001)', async () => {
    t = adminApp()
    const admin = t.admin()
    const { content } = await roles(admin)
    const id = await fullParticipation(new FakeClient())
    const photoId = (await t.call<ParticipationDetail>(admin, 'participations.get', { id })).photos[0]!.id
    expect(await t.call<string>(admin, 'participations.photo', { photoId })).toMatch(/^data:image\/jpeg;base64,/)
    expect(await errorCode(t.call(content, 'participations.photo', { photoId }))).toBe('forbidden')
    expect(t.app.db.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE action = 'photo.view'").get()).toEqual({ n: 1 })
  })

  it('la solicitud de eliminación borra fotos locales y publicadas y anonimiza (RF-PAR-005)', async () => {
    t = adminApp()
    const admin = t.admin()
    const client = new FakeClient()
    const id = await fullParticipation(client)
    const { operator } = await roles(admin)
    expect(await errorCode(t.call(operator, 'participations.delete', { id, reason: 'Solicitud 001' }))).toBe('forbidden')

    const result = await t.call<DeletionResult>(admin, 'participations.delete', { id, reason: 'Solicitud 001' })
    expect(result).toEqual({ localPhotosDeleted: 2, remoteDeleted: 1, remotePending: 0 })
    expect(client.removed).toHaveLength(1)
    expect(readdirSync(t.app.paths.originals)).toEqual([])
    expect(readdirSync(t.app.paths.finals)).toEqual([])
    const row = t.app.db.prepare('SELECT first_names, last_names, document_number, status FROM participations WHERE id = ?').get(id)
    expect(row).toEqual({ first_names: null, last_names: null, document_number: null, status: 'anonymized' })
    expect(JSON.stringify(t.app.db.prepare('SELECT * FROM participations').all())).not.toContain('12345678')
    // La evidencia del consentimiento se conserva.
    expect((t.app.db.prepare('SELECT COUNT(*) AS n FROM consents WHERE participation_id = ?').get(id) as { n: number }).n).toBe(2)
  })
})

describe('fotografías (8.17)', () => {
  it('reintento manual de una publicación fallida (RF-FOT-003)', async () => {
    t = adminApp()
    const admin = t.admin()
    const client = new FakeClient()
    client.fail = true
    const id = await fullParticipation(client)
    const detail = await t.call<ParticipationDetail>(admin, 'participations.get', { id })
    const final = detail.photos.find((p) => p.kind === 'final')!
    expect(final.status).toBe('pending')

    client.fail = false
    expect(await t.call(admin, 'publication.retry', { photoId: final.id })).toEqual({ published: true })
    expect(await errorCode(t.call(admin, 'publication.retry', { photoId: final.id }))).toBe('not_retryable')
  })
})

describe('reportes (8.18)', () => {
  it('exporta CSV con columnas según el rol y registra la exportación (RF-REP-001 a RF-REP-003)', async () => {
    t = adminApp()
    const admin = t.admin()
    const { content } = await roles(admin)
    await fullParticipation(new FakeClient())

    const file = join(t.files, 'admin.csv')
    t.nextSave(file)
    const r = await t.call<ExportResult>(admin, 'reports.participations', { dni: '12345678' })
    expect(r).toEqual({ saved: true, rows: 1, fileName: 'admin.csv' })
    const csv = readFileSync(file, 'utf8')
    expect(csv.charCodeAt(0)).toBe(0xfeff)
    expect(csv).toContain('"Nombres","Apellidos","DNI"')
    expect(csv).toContain('"12345678"')

    const limitedFile = join(t.files, 'contenido.csv')
    t.nextSave(limitedFile)
    await t.call(content, 'reports.participations', {})
    const limited = readFileSync(limitedFile, 'utf8')
    expect(limited).not.toContain('DNI')
    expect(limited).not.toContain('12345678')

    const exports = t.app.db.prepare("SELECT actor_id, detail_json FROM audit_events WHERE category = 'export'").all() as { detail_json: string }[]
    expect(exports).toHaveLength(2)
    // Los filtros quedan registrados, pero sin el DNI buscado.
    expect(exports[0]!.detail_json).not.toContain('12345678')

    t.nextSave(null)
    expect(await t.call(admin, 'reports.participations', {})).toEqual({ saved: false, rows: 1, fileName: null })
  })

  it('resume por campaña, día y estado de publicación (RF-REP-004)', async () => {
    t = adminApp()
    const admin = t.admin()
    await fullParticipation(new FakeClient())
    const { sessionId } = t.app.registerParticipant()
    t.app.sessions.end(sessionId, 'cancelled')
    const summary = await t.call<SummaryRow[]>(admin, 'reports.summary', {})
    expect(summary).toHaveLength(1)
    expect(summary[0]).toMatchObject({ campaignName: 'Lectura en familia', participations: 2, completed: 1, cancelled: 1, published: 1 })
  })
})

describe('bitácora (8.19)', () => {
  it('el rol de contenido ve solo la bitácora de contenido; la completa exige permiso (RF-BIT-004)', async () => {
    t = adminApp()
    const admin = t.admin()
    const { content } = await roles(admin)
    await t.call(content, 'campaigns.create', { name: 'Para la bitácora' })

    const full = await t.call<Page<AuditRow> & { categories: string[] }>(admin, 'audit.list', {})
    expect(full.categories).toEqual(expect.arrayContaining(['auth', 'content']))
    const limited = await t.call<Page<AuditRow> & { categories: string[] }>(content, 'audit.list', {})
    expect(limited.items.every((r) => r.category === 'content')).toBe(true)
    expect(limited.items.some((r) => r.action === 'campaign.create' && r.actor === 'contenido')).toBe(true)
    expect(await errorCode(t.call(content, 'reports.audit', {}))).toBe('forbidden')

    const failures = await t.call<Page<AuditRow>>(admin, 'audit.list', { category: 'auth', result: 'ok' })
    expect(failures.items.every((r) => r.category === 'auth' && r.result === 'ok')).toBe(true)
  })
})

describe('configuración y mantenimiento (8.20, 8.22)', () => {
  it('valida la configuración general antes de aplicarla (RF-CFG-003)', async () => {
    t = adminApp()
    const admin = t.admin()
    const settings = await t.call<Settings>(admin, 'settings.getGeneral')
    const invalid = { ...settings, storage: { minFreeMegabytes: 5000, warnFreeMegabytes: 1000 } }
    expect(await errorCode(t.call(admin, 'settings.saveGeneral', invalid))).toBe('invalid_input')
    const saved = await t.call<Settings>(admin, 'settings.saveGeneral', { ...settings, download: { qrDisplaySeconds: 120 } })
    expect(saved.download.qrDisplaySeconds).toBe(120)
  })

  it('exporta y restaura la configuración; un archivo inválido no cambia nada (RF-CFG-004)', async () => {
    t = adminApp()
    const admin = t.admin()
    const file = join(t.files, 'config.json')
    t.nextSave(file)
    await t.call(admin, 'settings.exportConfig')
    const exported = JSON.parse(readFileSync(file, 'utf8'))
    exported.capture.countdownSeconds = 5
    writeFileSync(file, JSON.stringify(exported))
    t.pickRaw(file)
    expect((await t.call<Settings>(admin, 'settings.importConfig')).capture.countdownSeconds).toBe(5)

    writeFileSync(file, JSON.stringify({ capture: { countdownSeconds: 99 } }))
    t.pickRaw(file)
    expect(await errorCode(t.call(admin, 'settings.importConfig'))).toBe('invalid_file')
    expect(t.settings.get().capture.countdownSeconds).toBe(5)
  })

  it('crea un respaldo con la base, el contenido y la configuración, sin claves (RF-ALM-005)', async () => {
    t = adminApp()
    const admin = t.admin()
    const { operator } = await roles(admin)
    await fullParticipation(new FakeClient())
    t.nextSave(t.files)
    const r = await t.call<{ saved: boolean; folder: string }>(operator, 'maintenance.backup', { includePhotos: false })
    expect(r.saved).toBe(true)
    expect(readdirSync(r.folder).sort()).toEqual(['configuracion.json', 'content', 'manifiesto.json', 'totem.sqlite'])
    expect(readFileSync(join(r.folder, 'configuracion.json'), 'utf8')).not.toMatch(/secret/i)

    t.advance(2)
    t.nextSave(t.files)
    const withPhotos = await t.call<{ folder: string }>(admin, 'maintenance.backup', { includePhotos: true })
    expect(existsSync(join(withPhotos.folder, 'photos', 'finals'))).toBe(true)
    expect((await t.call<MaintenanceStatus>(admin, 'maintenance.status')).lastBackupAt).toBeTruthy()
  })

  it('la conservación está desactivada por defecto y, activada, elimina y anonimiza lo antiguo (RF-FOT-005, RN-009)', async () => {
    t = adminApp()
    const admin = t.admin()
    const id = await fullParticipation(new FakeClient())
    expect(await errorCode(t.call(admin, 'maintenance.runRetention'))).toBe('retention_disabled')

    const settings = await t.call<Settings>(admin, 'settings.getGeneral')
    await t.call(admin, 'settings.saveGeneral', { ...settings, retention: { enabled: true, photoDays: 30, personalDataDays: 365 } })
    expect((await t.call<MaintenanceStatus>(admin, 'maintenance.status')).retentionPreview).toEqual({ photos: 0, participations: 0 })

    t.app.db.prepare("UPDATE participations SET started_at = '2025-01-01T00:00:00Z' WHERE id = ?").run(id)
    expect((await t.call<MaintenanceStatus>(admin, 'maintenance.status')).retentionPreview).toEqual({ photos: 2, participations: 1 })
    expect(await t.call(admin, 'maintenance.runRetention')).toEqual({ photos: 2, participations: 1 })
    expect(readdirSync(t.app.paths.finals)).toEqual([])
    expect(t.app.db.prepare('SELECT status, document_number FROM participations WHERE id = ?').get(id)).toEqual({ status: 'anonymized', document_number: null })
  })
})
