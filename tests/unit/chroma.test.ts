import { describe, expect, it } from 'vitest'
import { applyChromaKey, applyCharacterChromaKey, CHARACTER_CHROMA, DEFAULT_CHROMA, hexToRgb } from '../../src/shared/chroma'

function pixel(r: number, g: number, b: number): Uint8Array {
  return new Uint8Array([r, g, b, 255])
}

function key(px: Uint8Array, settings = DEFAULT_CHROMA): Uint8Array {
  applyChromaKey(px, settings)
  return px
}

describe('recorte por fondo verde (croma, sin IA)', () => {
  it('limpia solo el borde del personaje conservando exactamente el alfa y el interior', () => {
    const width = 21, height = 21
    const image = new Uint8Array(width * height * 4)
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const color = x < 5 ? [0, 255, 0, 255] : x === 5 ? [140, 190, 120, 255] : [190, 150, 120, 255]
      image.set(color, (y * width + x) * 4)
    }
    const baseline = image.slice()
    applyChromaKey(baseline, { ...CHARACTER_CHROMA, keyColor: '#00ff00' })
    applyCharacterChromaKey(image, width, height, '#00ff00')
    for (let i = 3; i < image.length; i += 4) expect(image[i]).toBe(baseline[i])
    expect([...image.slice((10 * width + 5) * 4, (10 * width + 5) * 4 + 3)]).toEqual([190, 150, 120])
    expect([...image.slice((10 * width + 12) * 4, (10 * width + 12) * 4 + 4)]).toEqual([190, 150, 120, 255])
  })
  it('el croma digital elimina el residuo verde del borde sin borrar ropa clara ni oscura', () => {
    const edge = key(pixel(140, 200, 130), { ...CHARACTER_CHROMA, keyColor: '#00ff00' })
    expect(edge[1]).toBe(140)
    for (const color of [[240, 240, 235], [20, 23, 25], [210, 170, 140]]) {
      expect(key(pixel(color[0]!, color[1]!, color[2]!), { ...CHARACTER_CHROMA, keyColor: '#00ff00' })[3]).toBe(255)
    }
  })
  it('el color del fondo queda transparente', () => {
    const [r, g, b] = hexToRgb(DEFAULT_CHROMA.keyColor)
    expect(key(pixel(r, g, b))[3]).toBe(0)
  })

  it('las sombras y luces sobre el fondo verde también se eliminan', () => {
    expect(key(pixel(0, 110, 40))[3]).toBe(0)
    expect(key(pixel(60, 220, 110))[3]).toBe(0)
  })

  it.each([
    ['piel', [224, 172, 140]],
    ['cabello oscuro', [40, 30, 25]],
    ['ropa blanca', [240, 240, 240]],
    ['ropa negra', [10, 10, 10]],
    ['ropa roja', [200, 30, 40]],
    ['ropa azul', [30, 60, 200]]
  ])('conserva %s', (_name, [r, g, b]) => {
    expect(key(pixel(r!, g!, b!))[3]).toBe(255)
  })

  it('los bordes quedan semitransparentes', () => {
    // Mezcla de fondo verde y piel, como en el contorno del cabello.
    const alpha = key(pixel(110, 160, 100))[3]!
    expect(alpha).toBeGreaterThan(0)
    expect(alpha).toBeLessThan(255)
  })

  it('reduce el reflejo verde sobre la persona', () => {
    const px = key(pixel(180, 230, 170))
    expect(px[1]!).toBeLessThan(230)
    expect(px[1]!).toBeGreaterThanOrEqual(180)
  })

  it('no altera colores sin exceso de verde', () => {
    expect([...key(pixel(200, 120, 90))]).toEqual([200, 120, 90, 255])
  })
})
