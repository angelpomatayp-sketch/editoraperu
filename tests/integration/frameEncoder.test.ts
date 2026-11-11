import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { InvalidImageError } from '../../src/core/capture/captureService'
import { encodeFrame } from '../../src/infra/imaging/frameEncoder'

function frame(width: number, height: number, rgb: [number, number, number]) {
  const rgba = new Uint8Array(width * height * 4)
  for (let i = 0; i < rgba.length; i += 4) rgba.set([...rgb, 255], i)
  return { width, height, rgba }
}

describe('codificación del cuadro de la cámara', () => {
  it('convierte el cuadro crudo en un JPEG con sus dimensiones y colores', async () => {
    const jpeg = await encodeFrame(frame(640, 360, [200, 40, 30]))
    const meta = await sharp(jpeg).metadata()
    expect(meta).toMatchObject({ format: 'jpeg', width: 640, height: 360, channels: 3 })
    const { data } = await sharp(jpeg).raw().toBuffer({ resolveWithObject: true })
    expect(Math.abs(data[0]! - 200)).toBeLessThan(6)
    expect(Math.abs(data[1]! - 40)).toBeLessThan(6)
  })

  it('rechaza cuadros cuyas dimensiones no coinciden con los bytes', async () => {
    const bad = { ...frame(64, 64, [0, 0, 0]), width: 65 }
    await expect(encodeFrame(bad)).rejects.toBeInstanceOf(InvalidImageError)
    await expect(encodeFrame({ width: 0, height: 0, rgba: new Uint8Array(0) })).rejects.toBeInstanceOf(InvalidImageError)
    await expect(encodeFrame({ width: 10000, height: 1, rgba: new Uint8Array(40000) })).rejects.toBeInstanceOf(InvalidImageError)
  })
})
