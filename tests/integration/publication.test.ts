import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import sharp from 'sharp'
import { afterEach, describe, expect, it } from 'vitest'
import { AuditLog } from '../../src/core/audit/auditLog'
import { ConnectivityMonitor } from '../../src/core/network/connectivityMonitor'
import { PublicationError, type PublicationClient, type PublishedPhoto } from '../../src/core/publication/publicationClient'
import { PublicationService } from '../../src/core/publication/publicationService'
import { SqliteAuditRepository } from '../../src/infra/db/repositories/auditRepository'
import { SqlitePublicationRepository } from '../../src/infra/db/repositories/publicationRepository'
import { DEFAULT_SETTINGS } from '../../src/shared/settings'
import { seededApp } from './helpers'

let app: ReturnType<typeof seededApp>
afterEach(() => app?.cleanup())

/** Servicio simulado: falla las primeras `failures` cargas y recuerda cada intento. */
class FakeClient implements PublicationClient {
  uploads: string[] = []
  online = true
  constructor(private failures = 0) {}

  async upload(photoId: string, jpeg: Uint8Array): Promise<PublishedPhoto> {
    this.uploads.push(photoId)
    expect(jpeg[0]).toBe(0xff)
    if (this.failures > 0) {
      this.failures--
      throw new PublicationError('network', 'sin conexión')
    }
    return { token: `tok-${photoId}`, url: `https://fotos.example/f/tok-${photoId}`, expiresAt: '2099-01-01T00:00:00Z' }
  }

  async health(): Promise<boolean> {
    return this.online
  }

  async remove(): Promise<void> {}
}

async function composedSession() {
  const { sessionId, participationId } = app.registerParticipant()
  const jpeg = await sharp({ create: { width: 3840, height: 2160, channels: 3, background: '#00b140' } }).jpeg().toBuffer()
  await app.capture.saveCapture(sessionId, new Uint8Array(jpeg))
  const composed = await app.capture.compose(sessionId)
  if (!composed.ok) throw new Error('no compuso')
  return { sessionId, participationId }
}

function setup(client: PublicationClient | null, clock = { now: new Date('2026-10-05T15:00:00Z') }) {
  const audit = new AuditLog(new SqliteAuditRepository(app.db), { log: () => {} })
  const service = new PublicationService({
    sessions: app.sessions,
    repository: new SqlitePublicationRepository(app.db),
    readFile: (filePath) => readFile(join(app.paths.root, filePath)),
    client: () => client,
    qr: async (url) => `data:qr,${url}`,
    settings: () => ({ ...DEFAULT_SETTINGS, publication: { ...DEFAULT_SETTINGS.publication, maxRetries: 2, retryIntervalSeconds: 60 } }),
    audit,
    now: () => clock.now
  })
  return { service, clock }
}

function finalPhoto() {
  return app.db
    .prepare("SELECT id, status, public_token, public_url, expires_at FROM photos WHERE kind = 'final' AND status <> 'deleted'")
    .get() as { id: string; status: string; public_token: string | null; public_url: string | null; expires_at: string | null }
}

function queue() {
  return app.db.prepare('SELECT status, attempts, last_error FROM publication_queue').all()
}

describe('publicación y QR (8.10)', () => {
  it('publica la foto final y devuelve el QR con la URL pública', async () => {
    app = seededApp()
    const client = new FakeClient()
    const { service } = setup(client)
    const { sessionId } = await composedSession()

    const result = await service.publish(sessionId)
    const photo = finalPhoto()
    expect(result).toEqual({ ok: true, qrDataUrl: `data:qr,${photo.public_url}`, expiresAt: '2099-01-01T00:00:00Z' })
    expect(photo).toMatchObject({ status: 'published', public_token: `tok-${photo.id}` })
    expect(queue()).toEqual([{ status: 'done', attempts: 1, last_error: null }])
  })

  it('el QR no contiene datos personales (RF-QR-003, RN-004)', async () => {
    app = seededApp()
    const { service } = setup(new FakeClient())
    const { sessionId } = await composedSession()
    const result = await service.publish(sessionId)
    expect(result.ok && result.qrDataUrl).not.toMatch(/12345678|Ana|Quispe/)
  })

  it('sin conexión no muestra QR, deja la foto pendiente y la reintenta después (RF-QR-008, RF-QR-009)', async () => {
    app = seededApp()
    const client = new FakeClient(1)
    const { service, clock } = setup(client)
    const { sessionId } = await composedSession()

    expect(await service.publish(sessionId)).toEqual({ ok: false, reason: 'offline' })
    expect(finalPhoto().status).toBe('pending')
    expect(queue()).toEqual([{ status: 'pending', attempts: 1, last_error: 'network' }])

    // Antes del intervalo configurado no se reintenta.
    expect(await service.processQueue()).toEqual({ published: 0, failed: 0 })
    clock.now = new Date('2026-10-05T15:01:01Z')
    expect(await service.processQueue()).toEqual({ published: 1, failed: 0 })
    expect(finalPhoto().status).toBe('published')
    // Siempre con el mismo identificador: el servicio no duplica la publicación.
    expect(new Set(client.uploads).size).toBe(1)
  })

  it('al recuperar la conexión se publica de inmediato, sin esperar el intervalo (RF-QR-009)', async () => {
    app = seededApp()
    const client = new FakeClient(1)
    const { service } = setup(client)
    const { sessionId } = await composedSession()
    expect((await service.publish(sessionId)).ok).toBe(false)
    // Con el intervalo sin cumplir, el reintento normal espera…
    expect(await service.processQueue()).toEqual({ published: 0, failed: 0 })
    // …pero al recuperar la conexión se publica enseguida.
    expect(await service.processQueue({ immediately: true })).toEqual({ published: 1, failed: 0 })
    expect(finalPhoto().status).toBe('published')
  })

  it('al agotar los reintentos la publicación queda fallida', async () => {
    app = seededApp()
    const { service, clock } = setup(new FakeClient(10))
    const { sessionId } = await composedSession()
    await service.publish(sessionId)
    for (let i = 1; i <= 3; i++) {
      clock.now = new Date(clock.now.getTime() + 61_000)
      await service.processQueue()
    }
    expect(finalPhoto().status).toBe('failed')
    expect(queue()).toEqual([{ status: 'failed', attempts: 3, last_error: 'network' }])
  })

  it('sin servicio configurado no muestra QR y deja la foto en cola', async () => {
    app = seededApp()
    const { service } = setup(null)
    const { sessionId } = await composedSession()
    expect(await service.publish(sessionId)).toEqual({ ok: false, reason: 'not_configured' })
    expect(finalPhoto().status).toBe('pending')
  })

  it('una publicación ya hecha se reutiliza sin volver a cargarla', async () => {
    app = seededApp()
    const client = new FakeClient()
    const { service } = setup(client)
    const { sessionId } = await composedSession()
    await service.publish(sessionId)
    expect((await service.publish(sessionId)).ok).toBe(true)
    expect(client.uploads).toHaveLength(1)
  })

  it('tras un cierre inesperado, lo que quedó en curso vuelve a la cola (RF-RED-003)', async () => {
    app = seededApp()
    const { service } = setup(new FakeClient())
    const { participationId } = await composedSession()
    const photoId = finalPhoto().id
    app.db.prepare(
      `INSERT INTO publication_queue (id, photo_id, idempotency_key, status, attempts, next_attempt_at, created_at, updated_at)
       VALUES ('q1', ?, ?, 'in_progress', 0, '2000-01-01', 'x', 'x')`
    ).run(photoId, photoId)
    expect(service.recoverInterrupted()).toBe(1)
    expect(await service.processQueue()).toEqual({ published: 1, failed: 0 })
    expect(participationId).toBeTruthy()
  })

  it('sin sesión o sin foto compuesta no publica', async () => {
    app = seededApp()
    const { service } = setup(new FakeClient())
    expect(await service.publish('00000000-0000-4000-8000-000000000000')).toEqual({ ok: false, reason: 'session_invalid' })
    const { sessionId } = app.registerParticipant()
    expect(await service.publish(sessionId)).toEqual({ ok: false, reason: 'no_photo' })
  })
})

describe('conectividad (RF-RED-001)', () => {
  it('distingue servicio accesible, sin acceso y sin configurar, y avisa al recuperar la conexión', async () => {
    app = seededApp()
    const audit = new AuditLog(new SqliteAuditRepository(app.db), { log: () => {} })
    const client = new FakeClient()
    let configured: PublicationClient | null = null
    let recovered = 0
    const monitor = new ConnectivityMonitor(() => configured, audit, () => recovered++)

    expect(await monitor.check()).toBe('not_configured')
    configured = client
    client.online = false
    expect(await monitor.check()).toBe('offline')
    client.online = true
    expect(await monitor.check()).toBe('online')
    expect(await monitor.check()).toBe('online')
    expect(recovered).toBe(1)

    const transitions = app.db
      .prepare("SELECT detail_json FROM audit_events WHERE action = 'connectivity' ORDER BY id")
      .all() as { detail_json: string }[]
    expect(transitions.map((t) => JSON.parse(t.detail_json).to)).toEqual(['not_configured', 'offline', 'online'])
  })
})
