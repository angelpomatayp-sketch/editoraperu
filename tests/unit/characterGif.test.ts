import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import sharp from '../../src/infra/imaging/sharpSetup'
import { importCharacter } from '../../src/infra/imaging/resourceImport'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('importCharacter con GIF', () => {
  it('conserva la animación y extrae el último cuadro como PNG', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'character-gif-'))
    dirs.push(dir)
    const gif = join(dir, 'caminando.gif')
    const raw = Buffer.alloc(200 * 400 * 4)
    const paint = (pageY: number, left: number) => {
      for (let y = 20; y < 180; y++) {
        for (let x = left; x < left + 60; x++) {
          const offset = ((pageY + y) * 200 + x) * 4
          raw[offset] = 220
          raw[offset + 1] = 30
          raw[offset + 2] = 30
          raw[offset + 3] = 255
        }
      }
    }
    paint(0, 20)
    paint(200, 120)
    await sharp(raw, { raw: { width: 200, height: 400, channels: 4, pageHeight: 200 } })
      .gif({ delay: [400, 600], loop: 0, keepDuplicateFrames: true })
      .toFile(gif)

    const result = await importCharacter(gif, dir, 'campaigns/test')
    expect(result.animation).toMatchObject({ format: 'gif', durationMs: 1000 })
    expect(result.image).toMatchObject({ format: 'png', width: 200, height: 200 })
    expect(existsSync(join(dir, result.animation!.filePath))).toBe(true)
    const { data, info } = await sharp(join(dir, result.image.filePath)).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    expect(info.height).toBe(200)
    expect(data[(100 * 200 + 140) * 4 + 3]).toBe(255)
    expect(data[(100 * 200 + 40) * 4 + 3]).toBe(0)
  })
})
