import { existsSync, mkdtempSync, rmSync, copyFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import ffmpeg from 'ffmpeg-static'
import { expect, it } from 'vitest'
import sharp from '../../src/infra/imaging/sharpSetup'
import { importCharacterVideo, repairGreenScreenPose } from '../../src/infra/imaging/characterVideo'
import { applyCharacterChromaKey, applyChromaKey, CHARACTER_CHROMA, detectGreenScreen } from '../../src/shared/chroma'

it.skipIf(!process.env.TOTEM_TEST_CHROMA_FRAME)('conserva el alfa del cuadro real y genera comparación visual', async () => {
  const { data, info } = await sharp(process.env.TOTEM_TEST_CHROMA_FRAME!).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const key = detectGreenScreen(data, info.width, info.height)!.keyColor
  const before = Buffer.from(data)
  applyChromaKey(before, { ...CHARACTER_CHROMA, keyColor: key })
  applyCharacterChromaKey(data, info.width, info.height, key)
  let changed = 0
  for (let i = 0; i < data.length; i += 4) {
    expect(data[i + 3]).toBe(before[i + 3])
    if (data[i + 3]! > 0 && data[i + 1] !== before[i + 1]) changed++
  }
  expect(changed).toBeGreaterThan(0)
  if (process.env.TOTEM_TEST_CHROMA_OUTPUT) {
    const raw = { width: info.width, height: info.height, channels: 4 as const }
    const left = await sharp(before, { raw }).flatten({ background: '#404040' }).png().toBuffer()
    const right = await sharp(data, { raw }).flatten({ background: '#404040' }).png().toBuffer()
    await sharp({ create: { width: info.width * 2, height: info.height, channels: 3, background: '#404040' } })
      .composite([{ input: left, left: 0, top: 0 }, { input: right, left: info.width, top: 0 }]).png().toFile(process.env.TOTEM_TEST_CHROMA_OUTPUT)
  }
}, 30_000)

const source = resolve('1112.mp4')
it('actualiza una pose anterior una sola vez y conserva el video', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'totem-chroma-revision-'))
  try {
    const input = join(directory, 'source.png'), video = join(directory, 'source.mp4')
    await sharp({ create: { width: 720, height: 1280, channels: 3, background: '#00ff00' } })
      .composite([{ input: await sharp({ create: { width: 240, height: 900, channels: 3, background: '#bca080' } }).png().toBuffer(), left: 200, top: 200 }]).png().toFile(input)
    expect(spawnSync(ffmpeg!, ['-hide_banner', '-loglevel', 'error', '-loop', '1', '-i', input, '-t', '0.4', '-pix_fmt', 'yuv420p', '-y', video]).status).toBe(0)
    const result = await importCharacterVideo(video, directory, 'characters', null)
    const image = join(directory, result.image.filePath), animation = join(directory, result.animation!.filePath)
    expect(result.animation!.background).toBe('chroma')
    expect(await repairGreenScreenPose(image, animation)).toBe(false)
    rmSync(`${image}.chroma.json`)
    expect(await repairGreenScreenPose(image, animation)).toBe(true)
    expect(await repairGreenScreenPose(image, animation)).toBe(false)
    expect(existsSync(animation)).toBe(true)
  } finally { rmSync(directory, { recursive: true, force: true }) }
}, 30_000)
it.skipIf(!existsSync(source))('recorta 1112 sin borde verde y conserva opacas piel y ropa', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'totem-green-video-'))
  try {
    const result = await importCharacterVideo(source, directory, 'characters', null)
    expect(result.animation?.background).toBe('chroma')
    const image = join(directory, result.image.filePath)
    const { data, info } = await sharp(image).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    expect(info.width).toBe(720)
    expect(info.height).toBe(1280)
    expect(data[3]).toBe(0)
    for (const [x, y] of [[165, 330], [160, 650], [130, 900]]) expect(data[(y! * info.width + x!) * 4 + 3]).toBe(255)
    let green = 0
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3]! > 32 && data[i + 1]! > Math.max(data[i]!, data[i + 2]!) + 1) green++
    }
    expect(green).toBe(0)
    expect(await repairGreenScreenPose(image, join(directory, result.animation!.filePath))).toBe(false)
    if (process.env.TOTEM_TEST_CHROMA_OUTPUT) copyFileSync(image, process.env.TOTEM_TEST_CHROMA_OUTPUT)
  } finally { rmSync(directory, { recursive: true, force: true }) }
}, 30_000)
