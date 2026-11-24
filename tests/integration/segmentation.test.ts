import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import sharp from 'sharp'
import { afterEach, describe, expect, it } from 'vitest'
import { guidedMatte } from '../../src/infra/imaging/guidedMatte'
import { ModnetSegmenter } from '../../src/infra/imaging/modnetSegmenter'
import { SharpCompositor } from '../../src/infra/imaging/sharpCompositor'
import { OUTPUT } from '../../src/shared/composition'
import { DEFAULT_SETTINGS } from '../../src/shared/settings'
import { seededApp } from './helpers'

/** El modelo se descarga con `npm run models`; sin él, estas pruebas se omiten. */
const MODEL = resolve(__dirname, '../../resources/models/modnet.onnx')
const hasModel = existsSync(MODEL)

let app: ReturnType<typeof seededApp> | undefined
afterEach(() => {
  app?.cleanup()
  app = undefined
})

/** Captura simulada: "persona" (óvalo de piel con torso) sobre una pared clara, sin fondo verde. */
async function portrait(): Promise<Uint8Array> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="3840" height="2160" viewBox="0 0 1280 720">
    <rect width="1280" height="720" fill="#d9d4cc"/>
    <ellipse cx="640" cy="300" rx="120" ry="150" fill="#c58c6a"/>
    <rect x="460" y="430" width="360" height="290" rx="120" fill="#26324a"/>
  </svg>`
  return new Uint8Array(await sharp(Buffer.from(svg)).jpeg({ quality: 95 }).toBuffer())
}

describe.skipIf(!hasModel)('recorte automático con MODNet (modelo local)', () => {
  it('devuelve una máscara de un canal del tamaño de la imagen', async () => {
    const segmenter = new ModnetSegmenter(MODEL)
    const { data, info } = await sharp(Buffer.from(await portrait())).resize(400, 600, { fit: 'cover' }).raw().toBuffer({ resolveWithObject: true })
    const started = Date.now()
    const matte = await segmenter.matte(data, info.width, info.height)
    expect(matte.length).toBe(400 * 600)
    // Valores en 0..255 y con variación: hay zonas de persona y de fondo.
    let min = 255
    let max = 0
    for (const v of matte) {
      if (v < min) min = v
      if (v > max) max = v
    }
    expect(max).toBeGreaterThan(min)
    expect(Date.now() - started).toBeLessThan(15_000)
  })

  it('la composición recorta a la persona sin fondo verde y la ubica sobre el escenario', async () => {
    app = seededApp({ settings: { ...DEFAULT_SETTINGS, background: { method: 'segmentation' } } })
    const segmenter = new ModnetSegmenter(MODEL)
    const warnings: string[] = []
    const compositor = new SharpCompositor({
      dataRoot: app.paths.root,
      contentDir: app.contentDir,
      output: OUTPUT,
      segmenter,
      onWarning: (m) => warnings.push(m)
    })
    const layer = { kind: 'photo' as const, order: 10, left: 130, top: 384, width: 821, height: 1277 }
    const { sessionId } = app.registerParticipant()
    await app.capture.saveCapture(sessionId, await portrait())
    const original = (app.db.prepare("SELECT file_path FROM photos WHERE kind = 'original'").get() as { file_path: string }).file_path

    const result = await compositor.compose([layer], original, 'photos/finals/prueba.jpg', { method: 'segmentation', guide: null })
    expect(result).toMatchObject({ width: OUTPUT.width, height: OUTPUT.height })
    expect(warnings).toEqual([])
  })
})

describe('respaldo del recorte automático', () => {
  it('si el modelo falla, la foto se compone completa y queda registrado', async () => {
    app = seededApp({ settings: { ...DEFAULT_SETTINGS, background: { method: 'segmentation' } } })
    const warnings: string[] = []
    const compositor = new SharpCompositor({
      dataRoot: app.paths.root,
      contentDir: app.contentDir,
      output: OUTPUT,
      segmenter: { matte: async () => Promise.reject(new Error('modelo dañado')) },
      onWarning: (m) => warnings.push(m)
    })
    const { sessionId } = app.registerParticipant()
    await app.capture.saveCapture(sessionId, await portrait())
    const original = (app.db.prepare("SELECT file_path FROM photos WHERE kind = 'original'").get() as { file_path: string }).file_path
    const layer = { kind: 'photo' as const, order: 10, left: 0, top: 0, width: 540, height: 960 }
    await compositor.compose([layer], original, 'photos/finals/respaldo.jpg', { method: 'segmentation', guide: null })
    expect(warnings).toEqual(['segmentation_failed'])
    expect(existsSync(join(app.paths.root, 'photos/finals/respaldo.jpg'))).toBe(true)
  })
})

describe('recorte guiado por la silueta de la vista previa', () => {
  // Zona de 200×100: la guía marca a la persona en la mitad izquierda.
  const width = 200
  const height = 100
  const guide = { width, height, alpha: new Uint8Array(width * height) }
  for (let y = 0; y < height; y++) for (let x = 0; x < 100; x++) guide.alpha[y * width + x] = 255
  const at = (buffer: Buffer, x: number, y: number) => buffer[y * width + x]!

  it('rellena los huecos del modelo fino dentro de la silueta (cara con poca luz)', async () => {
    const fine = Buffer.alloc(width * height, 0)
    const alpha = await guidedMatte(fine, guide, width, height)
    expect(at(alpha, 40, 50)).toBe(255)
  })

  it('descarta lo que el modelo fino ve fuera de la silueta (objetos del fondo)', async () => {
    const fine = Buffer.alloc(width * height, 255)
    const alpha = await guidedMatte(fine, guide, width, height)
    expect(at(alpha, 180, 50)).toBe(0)
  })

  it('en el borde conserva el detalle del modelo fino', async () => {
    const fine = Buffer.alloc(width * height, 0)
    for (let y = 0; y < height; y++) fine[y * width + 101] = 200
    const alpha = await guidedMatte(fine, guide, width, height)
    expect(at(alpha, 101, 50)).toBeGreaterThan(100)
    expect(at(alpha, 101, 50)).toBeLessThan(255)
  })
})
