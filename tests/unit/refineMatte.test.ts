import { describe, expect, it } from 'vitest'
import { refineMatte } from '../../src/infra/imaging/refineMatte'

describe('refinado fino del recorte', () => {
  // Foto de 120×60: mitad izquierda oscura (persona), mitad derecha clara (fondo).
  const width = 120
  const height = 60
  const rgb = new Uint8Array(width * height * 3)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) rgb.fill(x < 60 ? 40 : 220, (y * width + x) * 3, (y * width + x) * 3 + 3)

  it('ajusta un borde borroso al borde real de la foto', () => {
    // Máscara calculada a baja resolución: rampa suave entre x=50 y x=70.
    const alpha = new Uint8Array(width * height)
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) alpha[y * width + x] = Math.round(Math.min(1, Math.max(0, (70 - x) / 20)) * 255)
    const out = refineMatte(alpha, rgb, width, height)
    const row = 30 * width
    expect(out[row + 56]!).toBeGreaterThan(alpha[row + 56]!) // del lado de la persona, más opaco
    expect(out[row + 64]!).toBeLessThan(alpha[row + 64]!) // del lado del fondo, más transparente
  })

  it('no toca el interior ni el fondo seguros, aunque la ropa tenga textura', () => {
    const textured = new Uint8Array(rgb)
    for (let i = 0; i < 30 * width * 3; i += 9) textured[i] = 255 // «estampado» en la parte de arriba
    const alpha = new Uint8Array(width * height)
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) alpha[y * width + x] = x < 60 ? 255 : 0
    const out = refineMatte(alpha, textured, width, height)
    expect(out[10 * width + 10]).toBe(255)
    expect(out[10 * width + 110]).toBe(0)
  })

  it('quita los halos casi transparentes', () => {
    const alpha = new Uint8Array(width * height).fill(12) // 5 % de opacidad: halo
    const out = refineMatte(alpha, rgb, width, height)
    expect(Math.max(...out)).toBe(0)
  })
})
