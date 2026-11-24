import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import sharp from 'sharp'
import { expect, it } from 'vitest'
import { BirefnetSegmenter } from '../../src/infra/imaging/birefnetSegmenter'

const model = resolve('resources/models/birefnet-portrait.onnx')
// Opt-in: el modelo completo necesita más memoria/tiempo que la suite cotidiana.
it.skipIf(!process.env.TOTEM_TEST_BIREFNET || !existsSync(model))('ejecuta BiRefNet real y conserva la resolución de la foto', async () => {
  const source = process.env.TOTEM_TEST_PHOTO
  const image = source ? sharp(source).rotate() : sharp({ create: { width: 64, height: 96, channels: 3, background: '#808080' } })
  const { data, info } = await image.removeAlpha().raw().toBuffer({ resolveWithObject: true })
  const segmenter = new BirefnetSegmenter(model)
  const start = Date.now()
  const alpha = await segmenter.matte(data, info.width, info.height)
  expect(alpha.length).toBe(info.width * info.height)
  console.log(`BiRefNet: ${info.width}x${info.height}, ${Date.now() - start} ms`)
  if (source && process.env.TOTEM_TEST_OUTPUT) {
    const output = process.env.TOTEM_TEST_OUTPUT
    await sharp(alpha, { raw: { width: info.width, height: info.height, channels: 1 } }).png().toFile(join(output, 'birefnet-mask.png'))
    await sharp(data, { raw: { width: info.width, height: info.height, channels: 3 } })
      .joinChannel(alpha, { raw: { width: info.width, height: info.height, channels: 1 } }).png().toFile(join(output, 'birefnet-person.png'))
  }
}, 240_000)
