import { describe, expect, it } from 'vitest'
import { blendPlacement, PersonBoxSmoother } from '../../src/shared/framingSmoother'

const box = { x: 0.4, y: 0.1, width: 0.2, height: 0.8 }

describe('suavizado de la altura en tiempo real', () => {
  it('la banda muerta evita el rebote por ruido de la máscara', () => {
    const smoother = new PersonBoxSmoother()
    smoother.update(box, 0)
    let out = box
    for (let i = 1; i <= 40; i++) out = smoother.update({ ...box, height: box.height * (1 + (i % 2 ? 0.01 : -0.01)) }, i * 33)
    expect(out.height).toBeCloseTo(0.8, 5)
  })
  it('rechaza un salto súbito y lo acepta solo si se sostiene', () => {
    const smoother = new PersonBoxSmoother()
    smoother.update(box, 0)
    const jump = { ...box, height: 0.4 }
    for (let i = 1; i <= 10; i++) smoother.update(jump, i * 33)
    expect(smoother.current()!.height).toBeGreaterThan(0.7)
    for (let i = 11; i <= 40; i++) smoother.update(jump, i * 33)
    expect(smoother.current()!.height).toBeLessThan(0.5)
  })
  it('la mezcla de encuadres no deforma (misma escala en ambos ejes)', () => {
    const from = { crop: { x: 0, y: 0, width: 1, height: 1 }, box: { x: 0, y: 0, width: 1, height: 1 } }
    const to = { crop: { x: 0.25, y: 0.25, width: 0.5, height: 0.5 }, box: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 } }
    for (const k of [0.1, 0.5, 0.9]) {
      const mid = blendPlacement(from, to, k)
      expect(mid.box.width / mid.crop.width).toBeCloseTo(mid.box.height / mid.crop.height, 6)
    }
  })
})
