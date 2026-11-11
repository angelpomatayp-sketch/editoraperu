import { describe, expect, it } from 'vitest'
import { largestTransparentRect } from '../../src/infra/imaging/photoHole'
import { OUTPUT } from '../../src/shared/composition'
import { parsePhotoHole, photoRegionFor, scenarioBox } from '../../src/shared/compositionPlan'
import { DEFAULT_PHOTO_REGION } from '../../src/shared/campaign'

/** Canal alfa de prueba: opaco salvo los rectángulos indicados [x, y, ancho, alto]. */
function alphaWith(width: number, height: number, holes: [number, number, number, number][]): Uint8Array {
  const alpha = new Uint8Array(width * height).fill(255)
  for (const [hx, hy, hw, hh] of holes) {
    for (let y = hy; y < hy + hh; y++) for (let x = hx; x < hx + hw; x++) alpha[y * width + x] = 0
  }
  return alpha
}

describe('zona transparente de un escenario', () => {
  it('encuentra el rectángulo del hueco, con un píxel de margen', () => {
    const rect = largestTransparentRect(alphaWith(100, 200, [[20, 60, 50, 40]]), 100, 200)
    expect(rect).toEqual({ x: 0.19, y: 0.295, width: 0.52, height: 0.21 })
  })

  it('con varios huecos usa el más grande', () => {
    const rect = largestTransparentRect(alphaWith(100, 200, [[5, 5, 10, 10], [30, 100, 60, 60]]), 100, 200)
    expect(rect!.x).toBeCloseTo(0.29)
    expect(rect!.y).toBeCloseTo(0.495)
  })

  it('une las partes del hueco que un titular opaco separó', () => {
    // Hueco de 20–70 × 60–110 cortado por una franja opaca en y 100–104: quedan dos partes.
    const rect = largestTransparentRect(alphaWith(100, 200, [[20, 60, 50, 40], [20, 104, 50, 6]]), 100, 200)
    expect(rect).toEqual({ x: 0.19, y: 0.295, width: 0.52, height: 0.26 })
  })

  it('no une transparencias lejanas al hueco', () => {
    const rect = largestTransparentRect(alphaWith(100, 200, [[20, 60, 50, 40], [80, 180, 10, 10]]), 100, 200)
    expect(rect).toEqual({ x: 0.19, y: 0.295, width: 0.52, height: 0.21 })
  })

  it('ignora transparencias pequeñas y las imágenes opacas', () => {
    expect(largestTransparentRect(alphaWith(100, 200, [[10, 10, 5, 5]]), 100, 200)).toBeNull()
    expect(largestTransparentRect(alphaWith(100, 200, []), 100, 200)).toBeNull()
  })

  it('con hueco, la foto va en él y debajo del escenario; sin hueco, la zona de la campaña', () => {
    const hole = { x: 0.2, y: 0.3, width: 0.5, height: 0.25 }
    const vertical = { layerOrder: 0, width: 1080, height: 1920 }
    expect(photoRegionFor(DEFAULT_PHOTO_REGION, { ...vertical, photoHole: hole }, OUTPUT)).toEqual({ region: { ...hole, layer: -1 }, fillsHole: true })
    expect(photoRegionFor(DEFAULT_PHOTO_REGION, { ...vertical, photoHole: null }, OUTPUT)).toEqual({ region: DEFAULT_PHOTO_REGION, fillsHole: false })
    expect(photoRegionFor(DEFAULT_PHOTO_REGION, undefined, OUTPUT).fillsHole).toBe(false)
  })

  it('un escenario de otra proporción se muestra completo y el hueco se ubica donde queda', () => {
    // 1024 × 1536 (2:3) en 2160 × 3840: ancho completo, alto 3240 px, franjas de 300 px arriba y abajo.
    const box = scenarioBox({ width: 1024, height: 1536 }, OUTPUT)!
    expect(box.x).toBe(0)
    expect(box.width).toBe(1)
    expect(box.y * OUTPUT.height).toBeCloseTo(300)
    expect(box.height * OUTPUT.height).toBeCloseTo(3240)
    const { region } = photoRegionFor(DEFAULT_PHOTO_REGION, { layerOrder: 0, width: 1024, height: 1536, photoHole: { x: 0, y: 0.5, width: 1, height: 0.5 } }, OUTPUT)
    expect(region.y * OUTPUT.height).toBeCloseTo(300 + 1620)
    expect(region.height * OUTPUT.height).toBeCloseTo(1620)
  })

  it('con la misma proporción (o casi) el escenario cubre toda la imagen', () => {
    expect(scenarioBox({ width: 1080, height: 1920 }, OUTPUT)).toBeNull()
    expect(scenarioBox({ width: 941, height: 1672 }, OUTPUT)).toBeNull()
  })

  it('una zona guardada inválida se trata como «sin zona»', () => {
    expect(parsePhotoHole('{"x":0.1,"y":0.1,"width":0.5,"height":0.5}')).toEqual({ x: 0.1, y: 0.1, width: 0.5, height: 0.5 })
    expect(parsePhotoHole('{"x":0.8,"y":0,"width":0.5,"height":0.5}')).toBeNull()
    expect(parsePhotoHole('no es json')).toBeNull()
    expect(parsePhotoHole(null)).toBeNull()
  })
})
