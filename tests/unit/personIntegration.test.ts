import { describe, expect, it } from 'vitest'
import { integratePerson } from '../../src/infra/imaging/personIntegration'

describe('descontaminación del borde de la persona', () => {
  it('reemplaza el color del ambiente en un borde semitransparente por el de la ropa', () => {
    const width = 32
    const height = 32
    const rgb = Buffer.alloc(width * height * 3)
    const alpha = new Uint8Array(width * height)

    // Fondo verde de cámara; persona con ropa azul oscuro. La máscara identifica su borde.
    for (let i = 0; i < width * height; i++) {
      rgb[i * 3] = 20
      rgb[i * 3 + 1] = 220
      rgb[i * 3 + 2] = 30
    }
    for (let y = 8; y < 25; y++) {
      for (let x = 12; x < 20; x++) {
        const i = y * width + x
        rgb[i * 3] = 24
        rgb[i * 3 + 1] = 38
        rgb[i * 3 + 2] = 86
        alpha[i] = 255
      }
      const edge = y * width + 11
      alpha[edge] = 128
    }

    const result = integratePerson(rgb, alpha, width, height)
    const edgeOffset = (12 * width + 11) * 3
    expect(result[edgeOffset + 1]).toBeLessThan(150) // el verde del ambiente se reduce
    expect(result[edgeOffset + 2]).toBeGreaterThan(50) // se recupera azul de la ropa
    const opaqueOffset = (12 * width + 12) * 3
    expect([...result.subarray(opaqueOffset, opaqueOffset + 3)]).toEqual([24, 38, 86])
  })

  it('acerca de forma leve brillo y temperatura a los recursos elegidos', () => {
    const rgb = Buffer.from([100, 100, 120, 100, 100, 120])
    const alpha = new Uint8Array([255, 255])
    const result = integratePerson(rgb, alpha, 2, 1, { luminance: 0.6, warmth: 0.15 })
    expect(result[0]).toBeGreaterThan(100)
    expect(result[1]).toBeGreaterThan(100)
    expect(result[2]).toBeGreaterThan(120)
    // El rojo se acerca al azul: la referencia cálida corrige el sesgo frío sin invertirlo bruscamente.
    expect(result[2]! - result[0]!).toBeLessThan(20)
  })
})
