import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PublicationError } from '../../src/core/publication/publicationClient'
import { HttpPublicationClient } from '../../src/infra/publication/httpPublicationClient'
import { signRequest } from '../../src/infra/publication/signature'

/**
 * Prueba de integración del servicio PHP real (publicador/) con el cliente del tótem.
 * Usa el PHP de XAMPP; si no está disponible, la prueba se omite.
 */
const PHP = process.env['PHP_BIN'] ?? (existsSync('C:\\xampp\\php\\php.exe') ? 'C:\\xampp\\php\\php.exe' : 'php')
const hasPhp = spawnSync(PHP, ['-v']).status === 0
const ROOT = resolve(__dirname, '../..')
const SECRET = 'clave-de-prueba-de-al-menos-treinta-y-dos-caracteres'

let server: ChildProcess
let dir: string
let baseUrl: string
let env: NodeJS.ProcessEnv

function freePort(): Promise<number> {
  return new Promise((done) => {
    const srv = createServer().listen(0, '127.0.0.1', () => {
      const { port } = srv.address() as { port: number }
      srv.close(() => done(port))
    })
  })
}

async function photoJpeg(): Promise<Uint8Array> {
  return new Uint8Array(await sharp({ create: { width: 108, height: 192, channels: 3, background: '#d62828' } }).jpeg().toBuffer())
}

describe.skipIf(!hasPhp)('servicio de publicación PHP (8.10, sección 20.4)', () => {
  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'publicador-'))
    const port = await freePort()
    baseUrl = `http://127.0.0.1:${port}`
    const config = join(dir, 'config.php')
    const q = (v: string) => `'${v.replace(/\\/g, '\\\\')}'`
    writeFileSync(
      config,
      `<?php return [
        'base_url' => ${q(baseUrl)}, 'secret' => ${q(SECRET)},
        'db_dsn' => ${q(`sqlite:${join(dir, 'db.sqlite')}`)}, 'db_user' => null, 'db_password' => null,
        'storage_dir' => ${q(join(dir, 'photos'))}, 'ttl_hours' => 72, 'max_bytes' => 5000000,
        'rate_limit_per_minute' => 1000, 'max_clock_skew' => 300, 'timezone' => 'America/Lima' ];`
    )
    env = { ...process.env, PUBLICADOR_CONFIG: config }
    server = spawn(PHP, ['-S', `127.0.0.1:${port}`, '-t', join(ROOT, 'publicador/public'), join(ROOT, 'publicador/public/index.php')], {
      env,
      stdio: 'ignore'
    })
    for (let i = 0; i < 50; i++) {
      try {
        if ((await fetch(`${baseUrl}/api/v1/health`)).ok) return
      } catch {
        // Aún no inicia.
      }
      await new Promise((r) => setTimeout(r, 100))
    }
    throw new Error('El servicio PHP no inició')
  })

  afterAll(() => {
    server?.kill()
    rmSync(dir, { recursive: true, force: true })
  })

  it('responde la comprobación de disponibilidad', async () => {
    expect(await new HttpPublicationClient(baseUrl, SECRET).health()).toBe(true)
  })

  it('publica, entrega la página, la imagen y la descarga, y es idempotente (RF-QR-005, RF-QR-009)', async () => {
    const client = new HttpPublicationClient(baseUrl, SECRET)
    const id = '11111111-1111-4111-8111-111111111111'
    const first = await client.upload(id, await photoJpeg())
    expect(first.url).toBe(`${baseUrl}/f/${first.token}`)
    expect(first.token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(Date.parse(first.expiresAt)).toBeGreaterThan(Date.now())

    const again = await client.upload(id, await photoJpeg())
    expect(again).toEqual(first)
    expect(readdirSync(join(dir, 'photos'))).toHaveLength(1)

    const page = await fetch(first.url)
    expect(page.status).toBe(200)
    const html = await page.text()
    expect(html).toContain(`/f/${first.token}/image`)
    expect(html).toContain('Descargar fotografía')
    expect(page.headers.get('x-robots-tag')).toContain('noindex')

    const image = await fetch(`${first.url}/image`)
    expect(image.headers.get('content-type')).toBe('image/jpeg')
    const download = await fetch(`${first.url}/download`)
    expect(download.headers.get('content-disposition')).toContain('attachment')
    expect((await download.arrayBuffer()).byteLength).toBeGreaterThan(100)
  })

  it('no revela nada ante tokens inválidos o inexistentes (CA-007)', async () => {
    for (const path of ['/f/abc', `/f/${'A'.repeat(43)}`, '/f/../app/config.php', '/', '/storage/db.sqlite']) {
      const response = await fetch(`${baseUrl}${path}`)
      expect(response.status).toBe(404)
      expect(await response.text()).toContain('Enlace no disponible')
    }
  })

  it('rechaza cargas sin firma válida o que no son JPEG', async () => {
    const wrong = new HttpPublicationClient(baseUrl, 'otra-clave-distinta-de-al-menos-treinta-y-dos')
    await expect(wrong.upload('22222222-2222-4222-8222-222222222222', await photoJpeg())).rejects.toMatchObject({
      kind: 'rejected'
    } satisfies Partial<PublicationError>)

    const client = new HttpPublicationClient(baseUrl, SECRET)
    await expect(client.upload('33333333-3333-4333-8333-333333333333', new TextEncoder().encode('<?php phpinfo();'))).rejects.toMatchObject({
      kind: 'rejected'
    })

    // Firma de una solicitud antigua: fuera de la ventana de reloj.
    const body = await photoJpeg()
    const old = String(Math.floor(Date.now() / 1000) - 3600)
    const response = await fetch(`${baseUrl}/api/v1/photos`, {
      method: 'POST',
      body,
      headers: {
        'X-Idempotency-Key': '44444444-4444-4444-8444-444444444444',
        'X-Totem-Timestamp': old,
        'X-Totem-Signature': signRequest(SECRET, 'POST', '/api/v1/photos', old, body)
      }
    })
    expect(response.status).toBe(401)
  })

  it('un enlace vencido deja de entregar la foto y el cron la elimina (RF-QR-006)', async () => {
    const client = new HttpPublicationClient(baseUrl, SECRET)
    const id = '55555555-5555-4555-8555-555555555555'
    const published = await client.upload(id, await photoJpeg())
    const db = new DatabaseSync(join(dir, 'db.sqlite'))
    db.prepare("UPDATE photos SET expires_at = '2000-01-01T00:00:00Z' WHERE id = ?").run(id)
    db.close()

    expect((await fetch(published.url)).status).toBe(404)
    expect((await fetch(`${published.url}/download`)).status).toBe(404)

    const before = readdirSync(join(dir, 'photos')).length
    const cron = spawnSync(PHP, [join(ROOT, 'publicador/cron/expire.php')], { env, encoding: 'utf8' })
    expect(cron.stdout).toContain('eliminadas: 1')
    expect(readdirSync(join(dir, 'photos'))).toHaveLength(before - 1)
  })

  it('permite la eliminación anticipada firmada (RF-PAR-005)', async () => {
    const client = new HttpPublicationClient(baseUrl, SECRET)
    const id = '66666666-6666-4666-8666-666666666666'
    const published = await client.upload(id, await photoJpeg())
    const path = `/api/v1/photos/${id}`
    const ts = String(Math.floor(Date.now() / 1000))
    const response = await fetch(`${baseUrl}${path}`, {
      method: 'DELETE',
      headers: { 'X-Totem-Timestamp': ts, 'X-Totem-Signature': signRequest(SECRET, 'DELETE', path, ts, new Uint8Array()) }
    })
    expect(response.status).toBe(204)
    expect((await fetch(published.url)).status).toBe(404)
  })

  it('la limpieza de respaldo elimina archivos vencidos con tráfico sin depender del cron', async () => {
    const client = new HttpPublicationClient(baseUrl, SECRET)
    const id = '77777777-7777-4777-8777-777777777777'
    const published = await client.upload(id, await photoJpeg())
    const db = new DatabaseSync(join(dir, 'db.sqlite'))
    db.prepare("UPDATE photos SET expires_at = '2000-01-01T00:00:00Z' WHERE id = ?").run(id)
    db.close()
    writeFileSync(join(dir, '.publicador-cleanup.lock'), '0')
    const reset = spawnSync(PHP, ['-r', `touch($argv[1], 1);`, join(dir, '.publicador-cleanup.lock')])
    expect(reset.status).toBe(0)
    const before = readdirSync(join(dir, 'photos')).length
    expect((await fetch(`${baseUrl}/api/v1/health`)).ok).toBe(true)
    expect(readdirSync(join(dir, 'photos'))).toHaveLength(before - 1)
    expect((await fetch(published.url)).status).toBe(404)
  })
})
