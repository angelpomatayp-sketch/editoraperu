import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import sharp from 'sharp'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { BackgroundRemoval } from '../../src/core/capture/captureService'
import { SharpCompositor } from '../../src/infra/imaging/sharpCompositor'
import type { PlannedLayer } from '../../src/shared/compositionPlan'
import { DEFAULT_CHROMA } from '../../src/shared/chroma'

let root: string
const width = 128, height = 192
beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'totem-photo-quality-'))
  // Detalle fino y color, sin verde: detecta pérdidas que una imagen de color plano oculta.
  const rgb = Buffer.alloc(width * height * 3)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 3
    const stripe = (x + y) % 3
    rgb[i] = 150 + stripe * 30
    rgb[i + 1] = 70 + stripe * 10
    rgb[i + 2] = 100 + stripe * 15
  }
  await sharp(rgb, { raw: { width, height, channels: 3 } }).jpeg({ quality: 95, chromaSubsampling: '4:4:4' }).toFile(join(root, 'original.jpg'))
  await sharp({ create: { width, height, channels: 3, background: '#14395c' } }).png().toFile(join(root, 'scene.png'))
})
afterEach(() => {
  const local = relative(tmpdir(), root)
  if (!local.startsWith('totem-photo-quality-') || local.includes('..') || /[/\\]/.test(local)) throw new Error('Directorio de prueba inesperado')
  rmSync(root, { recursive: true, force: true })
})

function compositor() {
  return new SharpCompositor({
    dataRoot: root, contentDir: root, output: { width, height, jpegQuality: 95 },
    segmenter: { independentMatte: true, matte: async (_rgb, w, h) => Buffer.alloc(w * h, 255) }
  })
}
function plan(scene: boolean): PlannedLayer[] {
  return [
    ...(scene ? [{ kind: 'fill' as const, order: 0, resource: {
      id: 'scene', type: 'scenario' as const, src: 'scene.png', width, height, layerOrder: 0, posX: 0, posY: 0, scale: 1
    } }] : []),
    { kind: 'photo', order: 10, left: 0, top: 0, width, height }
  ]
}
async function pixels(file: string | Buffer) {
  return sharp(file).removeAlpha().raw().toBuffer()
}

describe('conservación del detalle y color hasta el JPEG final', () => {
  it.each([
    { name: 'sin escenario', scene: false, removal: null },
    { name: 'con escenario sin recorte', scene: true, removal: null },
    { name: 'con escenario y recorte automático neutro', scene: true, removal: { method: 'segmentation', guide: null } },
    { name: 'con escenario y croma neutro', scene: true, removal: { method: 'chroma', chroma: DEFAULT_CHROMA } }
  ] satisfies { name: string; scene: boolean; removal: BackgroundRemoval }[])('$name: solo una codificación JPEG en la composición', async ({ scene, removal }) => {
    const originalBefore = readFileSync(join(root, 'original.jpg'))
    const expected = await sharp(originalBefore).jpeg({ quality: 95, chromaSubsampling: '4:4:4' }).toBuffer()
    await compositor().compose(plan(scene), 'original.jpg', 'final.jpg', removal, 0)
    const final = join(root, 'final.jpg')
    expect(await pixels(final)).toEqual(await pixels(expected))
    expect(await sharp(final).metadata()).toMatchObject({ width, height, format: 'jpeg', chromaSubsampling: '4:4:4' })
    expect(readFileSync(join(root, 'original.jpg'))).toEqual(originalBefore)
  })

  it('la adaptación de color solo se aplica si se activa y no modifica el original', async () => {
    const originalBefore = readFileSync(join(root, 'original.jpg'))
    const cmp = compositor()
    await cmp.compose(plan(true), 'original.jpg', 'neutral.jpg', { method: 'segmentation', guide: null, matchSceneTone: false }, 0)
    await cmp.compose(plan(true), 'original.jpg', 'toned.jpg', { method: 'segmentation', guide: null, matchSceneTone: true }, 0)
    expect(await pixels(join(root, 'toned.jpg'))).not.toEqual(await pixels(join(root, 'neutral.jpg')))
    expect(readFileSync(join(root, 'original.jpg'))).toEqual(originalBefore)
  })
})
