import { join } from 'node:path'
import sharp from 'sharp'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Compositor } from '../../src/core/capture/captureService'
import { SharpCompositor } from '../../src/infra/imaging/sharpCompositor'
import { CAMERA_SCENARIO_ID } from '../../src/shared/campaign'
import { autoFrame, type FramePlacement } from '../../src/shared/compositionPlan'
import { DEFAULT_SETTINGS } from '../../src/shared/settings'
import { seededApp } from './helpers'

let app: ReturnType<typeof seededApp> | undefined
afterEach(() => { app?.cleanup(); app = undefined })

describe('encuadre mostrado y fotografía final', () => {
  it.each([
    { name: 'ajuste al personaje sin encuadre general', match: true, auto: false, method: 'segmentation', mode: 'normal', applies: true },
    { name: 'opción desactivada', match: false, auto: false, method: 'segmentation', mode: 'normal', applies: false },
    { name: 'encuadre general anterior', match: false, auto: true, method: 'segmentation', mode: 'normal', applies: true },
    { name: 'sin personaje', match: true, auto: false, method: 'segmentation', mode: 'no_character', applies: false },
    { name: 'fondo verde', match: true, auto: true, method: 'chroma', mode: 'normal', applies: false },
    { name: 'sin recorte', match: true, auto: true, method: 'none', mode: 'normal', applies: false },
    { name: 'fondo real de la cámara', match: true, auto: true, method: 'segmentation', mode: 'camera', applies: false },
    { name: 'escenario con hueco', match: true, auto: true, method: 'segmentation', mode: 'hole', applies: false }
  ] as const)('$name', async ({ match, auto, method, mode, applies }) => {
    const compose = vi.fn<Compositor['compose']>(async (_plan, _original, path) => {
      await sharp({ create: { width: 100, height: 200, channels: 3, background: '#000000' } }).jpeg().toFile(join(app!.paths.root, path))
      return { filePath: path, width: 100, height: 200, format: 'jpeg', sizeBytes: 1 }
    })
    app = seededApp({
      settings: { ...DEFAULT_SETTINGS, background: { method }, capture: { ...DEFAULT_SETTINGS.capture, matchCharacterSize: match, autoFraming: auto } },
      compositor: { compose }
    })
    const campaignId = app.campaignId('DEMO-LECTURA')
    if (mode === 'camera' || mode === 'no_character') {
      const row = app.db.prepare('SELECT config_json FROM campaigns WHERE id = ?').get(campaignId) as { config_json: string }
      const change = mode === 'camera' ? { allowCameraBackground: true } : { characterMode: 'optional' }
      app.db.prepare('UPDATE campaigns SET config_json = ? WHERE id = ?').run(JSON.stringify({ ...JSON.parse(row.config_json), ...change }), campaignId)
    }
    if (mode === 'hole') {
      const scenarioId = app.catalog.getDetail(campaignId)!.scenarios[0]!.id
      app.db.prepare('UPDATE resources SET photo_hole_json = ?, photo_hole_checked = 1 WHERE id = ?')
        .run(JSON.stringify({ x: 0.1, y: 0.1, width: 0.8, height: 0.7 }), scenarioId)
    }
    const { sessionId } = app.registerParticipant('DEMO-LECTURA', (input) => {
      if (mode === 'camera') input.selections.scenarioId = CAMERA_SCENARIO_ID
      if (mode === 'no_character') input.selections.characterIds = []
    })
    const jpeg = await sharp({ create: { width: 2160, height: 3840, channels: 3, background: '#aa4422' } }).jpeg().toBuffer()
    const placement = autoFrame({ x: 0.3, y: 0.1, width: 0.4, height: 0.8 }, 720, 1280, 1000, 2000, { height: 0.5, baseline: 0.8 })!
    expect(placement).not.toBeNull()
    expect((await app.capture.saveCapture(sessionId, jpeg)).ok).toBe(true)
    expect((await app.capture.compose(sessionId, [], placement)).ok).toBe(true)
    expect(compose.mock.calls[0]![5]).toEqual(applies ? placement : null)
    const removal = compose.mock.calls[0]![3]
    if (mode === 'camera' || mode === 'hole' || method === 'none') expect(removal).toBeNull()
    else expect(removal).toMatchObject({ method, matchSceneTone: false })
    if (applies) {
      expect(app.capture.retake(sessionId).ok).toBe(true)
      expect((await app.capture.saveCapture(sessionId, jpeg)).ok).toBe(true)
      expect((await app.capture.compose(sessionId, [], null)).ok).toBe(true)
      expect(compose.mock.calls[1]![5]).toBeNull()
    }
  })

  it('Sharp conserva la altura, el apoyo y las proporciones calculados en la vista previa', async () => {
    app = seededApp()
    const original = 'photos/originals/persona-sintetica.png'
    await sharp({ create: { width: 1000, height: 2000, channels: 3, background: '#00aa00' } })
      .composite([{ input: { create: { width: 200, height: 1600, channels: 3, background: '#cc2222' } }, left: 400, top: 200 }])
      .png().toFile(join(app.paths.root, original))
    const placement: FramePlacement = autoFrame({ x: 0.4, y: 0.1, width: 0.2, height: 0.8 }, 1000, 2000, 600, 1000, { height: 0.45, baseline: 0.8 })!
    for (const factor of [1, 2]) {
      const width = 600 * factor
      const height = 1000 * factor
      const compositor = new SharpCompositor({
        dataRoot: app.paths.root, contentDir: app.contentDir, output: { width, height, jpegQuality: 95 },
        segmenter: {
          independentMatte: true,
          matte: async (rgb, w, h) => Buffer.from(Array.from({ length: w * h }, (_, i) => rgb[i * 3]! > rgb[i * 3 + 1]! * 2 ? 255 : 0))
        }
      })
      const result = await compositor.compose([{ kind: 'photo', order: 10, left: 0, top: 0, width, height }], original, `photos/finals/ajuste-${factor}.jpg`, { method: 'segmentation', guide: null }, 0, placement)
      const pixels = await sharp(join(app.paths.root, result.filePath)).raw().toBuffer()
      let minX = width, minY = height, maxX = 0, maxY = 0
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 3
        if (pixels[i]! < 80 || pixels[i]! <= pixels[i + 1]! * 2) continue
        minX = Math.min(minX, x); maxX = Math.max(maxX, x)
        minY = Math.min(minY, y); maxY = Math.max(maxY, y)
      }
      const tolerance = 4 * factor
      expect(Math.abs((maxY + 1 - minY) - height * 0.45)).toBeLessThanOrEqual(tolerance)
      expect(Math.abs((maxY + 1) - height * 0.8)).toBeLessThanOrEqual(tolerance)
      expect(Math.abs((maxX + 1 + minX) / 2 - width / 2)).toBeLessThanOrEqual(tolerance)
      expect(Math.abs((maxX + 1 - minX) - height * 0.45 / 8)).toBeLessThanOrEqual(tolerance)
    }
  })
})
