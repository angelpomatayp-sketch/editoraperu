import { describe, expect, it } from 'vitest'
import { measurePerson } from '../../src/shared/personMeasure'

const W = 64
const H = 128
function mask(rects: { x: number; y: number; w: number; h: number }[], noise: [number, number][] = []): Float32Array {
  const values = new Float32Array(W * H)
  for (const r of rects) for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) values[y * W + x] = 0.9
  for (const [x, y] of noise) values[y * W + x] = 0.9
  return values
}

describe('medición de la persona', () => {
  it('mide el cuerpo completo e ignora motas aisladas', () => {
    const m = measurePerson(mask([{ x: 24, y: 10, w: 16, h: 100 }], [[2, 2], [60, 5], [3, 120]]), W, H)!
    expect(m.box.y).toBeCloseTo(10 / 128)
    expect(m.box.height).toBeCloseTo(100 / 128)
    expect(m.box.x).toBeCloseTo(24 / 64)
    expect(m.clippedTop).toBe(false)
    expect(m.clippedBottom).toBe(false)
  })
  it('tolera huecos pequeños entre partes del cuerpo', () => {
    const m = measurePerson(mask([{ x: 24, y: 10, w: 16, h: 40 }, { x: 26, y: 54, w: 12, h: 56 }]), W, H)!
    expect(m.box.height).toBeCloseTo(100 / 128)
  })
  it('avisa cuando la silueta toca los bordes', () => {
    const m = measurePerson(mask([{ x: 24, y: 0, w: 16, h: 128 }]), W, H)!
    expect(m.clippedTop).toBe(true)
    expect(m.clippedBottom).toBe(true)
  })
  it('sin persona devuelve null', () => {
    expect(measurePerson(mask([], [[1, 1], [40, 60]]), W, H)).toBeNull()
    expect(measurePerson(new Float32Array(0), 0, 0)).toBeNull()
  })
})
