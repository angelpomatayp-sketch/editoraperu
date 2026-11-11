import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'
import { afterEach, describe, expect, it } from 'vitest'
import { detectPhotoHole } from '../../src/infra/imaging/photoHole'
import { OUTPUT } from '../../src/shared/composition'
import { DEFAULT_SETTINGS } from '../../src/shared/settings'
import { seededApp } from './helpers'

let app: ReturnType<typeof seededApp>

afterEach(() => app?.cleanup())

/**
 * Captura simulada como la de una cámara: fondo verde de croma y una "persona" roja de 300 x 500
 * en el centro.
 */
async function cameraJpeg(width = 1280, height = 720): Promise<Uint8Array> {
  const person = Math.min(300, width / 3)
  const personHeight = Math.min(500, (height * 2) / 3)
  const buffer = await sharp({ create: { width, height, channels: 3, background: '#00b140' } })
    .composite([
      {
        input: { create: { width: Math.round(person), height: Math.round(personHeight), channels: 3, background: '#c81e28' } },
        left: Math.round((width - person) / 2),
        top: Math.round((height - personHeight) / 2)
      }
    ])
    .jpeg({ quality: 95 })
    .toBuffer()
  return new Uint8Array(buffer)
}

async function pixelAt(file: string, left: number, top: number): Promise<number[]> {
  return [...(await sharp(file).extract({ left, top, width: 1, height: 1 }).raw().toBuffer())]
}

function photos() {
  return app.db.prepare('SELECT kind, status, file_path, width, height FROM photos ORDER BY created_at, kind').all() as {
    kind: string
    status: string
    file_path: string | null
    width: number
    height: number
  }[]
}

function participationStatus(id: string) {
  return (app.db.prepare('SELECT status FROM participations WHERE id = ?').get(id) as { status: string }).status
}

describe('captura y composición (8.7, 8.8)', () => {
  it('guarda el original, compone la imagen final y actualiza los estados', async () => {
    // Encuadre «llenar la zona»: los puntos medidos caen sobre la captura.
    app = seededApp({
      settings: { ...DEFAULT_SETTINGS, background: { method: 'chroma' }, capture: { ...DEFAULT_SETTINGS.capture, framingPercent: 100 } }
    })
    const { sessionId, participationId } = app.registerParticipant()

    expect(await app.capture.saveCapture(sessionId, await cameraJpeg())).toEqual({ ok: true })
    expect(participationStatus(participationId)).toBe('captured')

    const composed = await app.capture.compose(sessionId)
    expect(composed.ok).toBe(true)
    if (!composed.ok) return
    expect(composed.imageDataUrl.startsWith('data:image/jpeg;base64,')).toBe(true)
    expect(composed.retakesLeft).toBe(DEFAULT_SETTINGS.capture.maxRetakes)
    expect(participationStatus(participationId)).toBe('composed')

    const [original, final] = photos()
    expect(original).toMatchObject({ kind: 'original', status: 'captured', width: 1280, height: 720 })
    expect(final).toMatchObject({ kind: 'final', status: 'composed', width: OUTPUT.width, height: OUTPUT.height })

    // Los nombres de archivo son identificadores aleatorios, sin datos del participante (RF-CMP-005).
    for (const p of [original!, final!]) {
      expect(p.file_path).toMatch(/^photos\/(originals|finals)\/[0-9a-f-]{36}\.jpg$/)
      expect(existsSync(join(app.paths.root, p.file_path!))).toBe(true)
    }

    const finalFile = join(app.paths.root, final!.file_path!)
    const meta = await sharp(finalFile).metadata()
    expect([meta.width, meta.height, meta.format]).toEqual([OUTPUT.width, OUTPUT.height, 'jpeg'])

    // La persona queda en el centro de su zona (x 130–951, y 384–1661 en la imagen final).
    const [pr, pg] = await pixelAt(finalFile, 1080, 2044)
    expect(pr).toBeGreaterThan(150)
    expect(pg).toBeLessThan(80)

    // Donde la captura tenía fondo verde se ve el escenario (Biblioteca, tonos marrones), no verde.
    const [sr, sg] = await pixelAt(finalFile, 400, 1200)
    expect(sr).toBeGreaterThanOrEqual(sg!)

    // El logotipo de la campaña queda arriba a la izquierda, sobre el marco.
    expect((await pixelAt(finalFile, 270, 290))[0]).toBeGreaterThan(200)

    expect(readdirSync(app.paths.tmp)).toEqual([])
  })

  it('con el croma desactivado la captura se usa completa, con su fondo', async () => {
    app = seededApp({
      settings: { ...DEFAULT_SETTINGS, background: { method: 'none' }, capture: { ...DEFAULT_SETTINGS.capture, framingPercent: 100 } }
    })
    const { sessionId } = app.registerParticipant()
    await app.capture.saveCapture(sessionId, await cameraJpeg())
    await app.capture.compose(sessionId)
    const final = photos().find((p) => p.kind === 'final')!
    const [r, g] = await pixelAt(join(app.paths.root, final.file_path!), 400, 1200)
    expect(g).toBeGreaterThan(120)
    expect(r).toBeLessThan(60)
  })

  it('compone con tres personajes en sus posiciones', async () => {
    app = seededApp()
    const { sessionId } = app.registerParticipant('DEMO-LECTURA', (input) => {
      const detail = app.catalog.getDetail(input.campaignId)!
      input.selections.characterIds = detail.characters.map((c) => c.id)
    })
    await app.capture.saveCapture(sessionId, await cameraJpeg())
    const result = await app.capture.compose(sessionId)
    expect(result.ok).toBe(true)
    const events = app.db
      .prepare("SELECT detail_json FROM audit_events WHERE action = 'composition.compose' AND result = 'ok'")
      .get() as { detail_json: string }
    // Escenario, persona, 3 personajes, marco y logotipo.
    expect(JSON.parse(events.detail_json).layers).toBe(7)
  })

  it('respeta la ubicación elegida por el participante, dentro de los límites de la campaña', async () => {
    app = seededApp()
    const { sessionId } = app.registerParticipant('DEMO-LECTURA', (input) => {
      const detail = app.catalog.getDetail(input.campaignId)!
      input.selections.characterIds = detail.characters.slice(0, 2).map((c) => c.id)
    })
    await app.capture.saveCapture(sessionId, await cameraJpeg())
    // El primero se mueve; el segundo pide un tamaño y una posición fuera de los límites.
    expect((await app.capture.compose(sessionId, [{ x: 0.5, y: 0.1, scale: 0.3 }, { x: 5, y: -3, scale: 9 }])).ok).toBe(true)
    const detail = app.db
      .prepare("SELECT detail_json FROM audit_events WHERE action = 'composition.compose' AND result = 'ok'")
      .get() as { detail_json: string }
    const [first, second] = JSON.parse(detail.detail_json).characters as { left: number; top: number; width: number }[]
    expect(first).toEqual({ left: Math.round(0.5 * OUTPUT.width), top: Math.round(0.1 * OUTPUT.height), width: Math.round(0.3 * OUTPUT.width) })
    // Tamaño máximo de la campaña (70 %) y al menos la mitad del personaje dentro de la imagen.
    expect(second!.width).toBe(Math.round(0.7 * OUTPUT.width))
    expect(second!.left + second!.width / 2).toBeLessThanOrEqual(OUTPUT.width + 1)
    expect(second!.top).toBeLessThan(0)
  })

  it('si la campaña no permite mover personajes, usa las posiciones configuradas', async () => {
    app = seededApp()
    const code = 'DEMO-LECTURA'
    const row = app.db.prepare('SELECT config_json FROM campaigns WHERE code = ?').get(code) as { config_json: string }
    const config = { ...JSON.parse(row.config_json), freePlacement: { enabled: false, minScale: 0.1, maxScale: 0.7 } }
    app.db.prepare('UPDATE campaigns SET config_json = ? WHERE code = ?').run(JSON.stringify(config), code)
    const { sessionId } = app.registerParticipant(code)
    await app.capture.saveCapture(sessionId, await cameraJpeg())
    await app.capture.compose(sessionId, [{ x: 0.5, y: 0.1, scale: 0.3 }])
    const detail = app.db
      .prepare("SELECT detail_json FROM audit_events WHERE action = 'composition.compose' AND result = 'ok'")
      .get() as { detail_json: string }
    const [first] = JSON.parse(detail.detail_json).characters as { left: number }[]
    expect(first!.left).toBe(Math.round(config.characterSlots[0].x * OUTPUT.width))
  })

  it('con encuadre 0 % la captura entra completa, apoyada abajo, y el escenario se ve arriba', async () => {
    app = seededApp({
      settings: { ...DEFAULT_SETTINGS, background: { method: 'none' }, capture: { ...DEFAULT_SETTINGS.capture, framingPercent: 0 } }
    })
    const { sessionId } = app.registerParticipant()
    await app.capture.saveCapture(sessionId, await cameraJpeg(1280, 720))
    await app.capture.compose(sessionId)
    const final = photos().find((p) => p.kind === 'final')!
    // Zona de la persona del escenario de prueba: x 0.12–0.88, y 0.2–0.865 (en 1080×1920).
    // Un poco por encima del pie, para no medir sobre el borde del marco de la campaña.
    const zoneBottom = Math.round(0.865 * OUTPUT.height) - 80
    const zoneTop = Math.round(0.2 * OUTPUT.height) + 10
    const [r, g] = await pixelAt(join(app.paths.root, final.file_path!), 1080, zoneBottom)
    expect(g).toBeGreaterThan(120) // la captura (verde) llega al pie de la zona
    expect(r).toBeLessThan(60)
    const [, gTop] = await pixelAt(join(app.paths.root, final.file_path!), 1080, zoneTop)
    expect(gTop).toBeLessThan(120) // arriba de la captura se ve el escenario, no la cámara
  })

  it('con un escenario con zona transparente, la foto va ahí por debajo del escenario, sin zoom y con la zona rellena', async () => {
    // Aunque el método configurado sea croma, en la zona transparente va la foto con su fondo; con el
    // encuadre por defecto (0 %) entra completa, sin zoom, y el resto de la zona se rellena desenfocado.
    app = seededApp({ settings: { ...DEFAULT_SETTINGS, background: { method: 'chroma' } } })
    const campaignId = app.campaignId('DEMO-BICENTENARIO')
    const scenarioId = app.catalog.getDetail(campaignId)!.scenarios[0]!.id
    // Portada azul con un hueco transparente (x 270–810, y 576–1056) y un titular blanco opaco dentro del hueco.
    const hole = { left: 270, top: 576, width: 540, height: 480 }
    const base = await sharp({ create: { width: 1080, height: 1920, channels: 4, background: '#1e3cc8' } }).raw().toBuffer()
    for (let y = hole.top; y < hole.top + hole.height; y++) {
      for (let x = hole.left; x < hole.left + hole.width; x++) {
        const i = (y * 1080 + x) * 4
        const headline = y >= 980 && y < 1050
        base[i] = headline ? 255 : 0
        base[i + 1] = headline ? 255 : 0
        base[i + 2] = headline ? 255 : 0
        base[i + 3] = headline ? 255 : 0
      }
    }
    const file = 'resources/portada-prueba.png'
    await sharp(base, { raw: { width: 1080, height: 1920, channels: 4 } }).png().toFile(join(app.paths.content, file))
    const detected = await detectPhotoHole(join(app.paths.content, file))
    expect(detected!.x).toBeCloseTo(0.25, 1)
    expect(detected!.width).toBeCloseTo(0.5, 1)
    app.db
      .prepare("UPDATE resources SET file_path = ?, format = 'png', width = 1080, height = 1920, photo_hole_json = ?, photo_hole_checked = 1 WHERE id = ?")
      .run(file, JSON.stringify(detected), scenarioId)

    const { sessionId, detail } = app.registerParticipant('DEMO-BICENTENARIO')
    expect(detail.scenarios[0]!.photoHole).toEqual(detected)
    await app.capture.saveCapture(sessionId, await cameraJpeg(1280, 720))
    expect((await app.capture.compose(sessionId)).ok).toBe(true)
    const final = join(app.paths.root, photos().find((p) => p.kind === 'final')!.file_path!)

    const [r1, g1, b1] = await pixelAt(final, 600, 1200)
    expect(g1).toBeGreaterThan(100) // relleno desenfocado de la cámara: la zona no queda vacía
    expect(r1).toBeLessThan(80)
    expect(b1).toBeLessThan(120)
    const [r2, g2] = await pixelAt(final, 1080, 1800)
    expect(r2).toBeGreaterThan(150) // la persona, completa
    expect(g2).toBeLessThan(80)
    const [r3, g3, b3] = await pixelAt(final, 1080, 2040)
    expect(Math.min(r3!, g3!, b3!)).toBeGreaterThan(220) // el titular del escenario queda encima de la foto
    const [r4, , b4] = await pixelAt(final, 1080, 2800)
    expect(b4).toBeGreaterThan(150) // fuera de la zona, la portada
    expect(r4).toBeLessThan(80)
  })

  it('no captura sin una participación registrada (RN-002)', async () => {
    app = seededApp()
    const start = app.sessions.start()
    if (!start.ok) throw new Error('no inició')
    const result = await app.capture.saveCapture(start.sessionId, await cameraJpeg())
    expect(result).toMatchObject({ ok: false, error: 'not_registered' })
    expect(photos()).toEqual([])
  })

  it('rechaza imágenes inválidas y cancela al superar los intentos (RF-CAP-007)', async () => {
    app = seededApp()
    const { sessionId } = app.registerParticipant()
    const max = DEFAULT_SETTINGS.capture.maxAttempts
    for (let i = 1; i <= max; i++) {
      const result = await app.capture.saveCapture(sessionId, new Uint8Array([0xff, 0xd8, 0xff, 0x00, 1, 2, 3]))
      expect(result).toEqual({ ok: false, error: 'invalid_image', attemptsLeft: max - i })
    }
    expect(await app.capture.saveCapture(sessionId, await cameraJpeg())).toMatchObject({ error: 'too_many_attempts' })
    expect(photos()).toEqual([])
  })

  it('rechaza una captura de resolución insuficiente', async () => {
    app = seededApp()
    const { sessionId } = app.registerParticipant()
    expect(await app.capture.saveCapture(sessionId, await cameraJpeg(200, 150))).toMatchObject({ error: 'invalid_image' })
  })

  it('no captura sin espacio en disco (RF-ALM-002)', async () => {
    app = seededApp({ hasDiskSpace: () => false })
    const { sessionId } = app.registerParticipant()
    expect(await app.capture.saveCapture(sessionId, await cameraJpeg())).toMatchObject({ error: 'insufficient_disk' })
  })

  it('no genera una composición incompleta si falta un recurso (RF-CMP-006)', async () => {
    app = seededApp()
    const { sessionId } = app.registerParticipant()
    await app.capture.saveCapture(sessionId, await cameraJpeg())
    for (const file of readdirSync(join(app.contentDir, 'resources/dev-seed/demo-lectura'))) {
      if (file.startsWith('marco')) {
        const { rmSync } = await import('node:fs')
        rmSync(join(app.contentDir, 'resources/dev-seed/demo-lectura', file))
      }
    }
    expect(await app.capture.compose(sessionId)).toMatchObject({ ok: false, error: 'resource_missing' })
    expect(photos().filter((p) => p.kind === 'final')).toEqual([])
    expect(readdirSync(app.paths.finals)).toEqual([])
  })

  it('un error de composición se puede reintentar sin volver a capturar (12.7)', async () => {
    let calls = 0
    let root = ''
    app = seededApp({
      compositor: {
        // Falla la primera vez; la segunda genera una imagen válida.
        compose: async (_plan, _original, outputPath) => {
          calls++
          if (calls === 1) throw new Error('fallo simulado')
          await sharp({ create: { width: 1080, height: 1920, channels: 3, background: '#000' } })
            .jpeg()
            .toFile(join(root, outputPath))
          return { filePath: outputPath, format: 'jpeg', width: 1080, height: 1920, sizeBytes: 1 }
        }
      }
    })
    root = app.paths.root
    const { sessionId } = app.registerParticipant()
    await app.capture.saveCapture(sessionId, await cameraJpeg())
    expect(await app.capture.compose(sessionId)).toEqual({
      ok: false,
      error: 'composition_failed',
      attemptsLeft: DEFAULT_SETTINGS.capture.maxAttempts - 1
    })
    expect((await app.capture.compose(sessionId)).ok).toBe(true)
    expect(photos().filter((p) => p.kind === 'original')).toHaveLength(1)
  })

  it('repetir descarta la foto anterior hasta el límite configurado (RF-CAP-006)', async () => {
    app = seededApp({ settings: { ...DEFAULT_SETTINGS, capture: { ...DEFAULT_SETTINGS.capture, maxRetakes: 1 } } })
    const { sessionId, participationId } = app.registerParticipant()
    await app.capture.saveCapture(sessionId, await cameraJpeg())
    expect((await app.capture.compose(sessionId)).ok).toBe(true)

    expect(app.capture.retake(sessionId)).toEqual({ ok: true, retakesLeft: 0 })
    expect(participationStatus(participationId)).toBe('registered')
    expect(photos().map((p) => [p.kind, p.status, p.file_path])).toEqual([
      ['original', 'deleted', null],
      ['final', 'deleted', null]
    ])
    expect(readdirSync(app.paths.originals)).toEqual([])
    expect(readdirSync(app.paths.finals)).toEqual([])

    await app.capture.saveCapture(sessionId, await cameraJpeg())
    const second = await app.capture.compose(sessionId)
    expect(second).toMatchObject({ ok: true, retakesLeft: 0 })
    expect(app.capture.retake(sessionId)).toEqual({ ok: false, error: 'limit_reached' })
  })

  it('al completar la sesión la participación queda completada', async () => {
    app = seededApp()
    const { sessionId, participationId } = app.registerParticipant()
    await app.capture.saveCapture(sessionId, await cameraJpeg())
    await app.capture.compose(sessionId)
    app.sessions.end(sessionId, 'completed')
    expect(participationStatus(participationId)).toBe('completed')
  })

  it('compone la campaña sin personaje y con marco elegido', async () => {
    app = seededApp()
    const { sessionId } = app.registerParticipant('DEMO-BICENTENARIO', (input) => {
      input.selections.characterIds = []
    })
    await app.capture.saveCapture(sessionId, await cameraJpeg(720, 1280))
    expect((await app.capture.compose(sessionId)).ok).toBe(true)
  })
})
