import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import sharp from '../../src/infra/imaging/sharpSetup'
import { analyzeCharacter } from '../../src/infra/imaging/characterAnalysis'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('analyzeCharacter', () => {
  it('detecta la silueta y usa la franja inferior como punto de apoyo', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'character-analysis-'))
    dirs.push(dir)
    const file = join(dir, 'personaje.png')
    await sharp({ create: { width: 100, height: 200, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([
        { input: { create: { width: 40, height: 140, channels: 4, background: { r: 1, g: 1, b: 1, alpha: 1 } } }, left: 30, top: 30 },
        { input: { create: { width: 60, height: 10, channels: 4, background: { r: 1, g: 1, b: 1, alpha: 1 } } }, left: 20, top: 170 }
      ])
      .png()
      .toFile(file)

    const result = await analyzeCharacter(file)
    expect(result.bounds).toEqual({ x: 0.2, y: 0.15, width: 0.6, height: 0.75 })
    expect(result.anchorX).toBeCloseTo(0.5)
    expect(result.anchorY).toBeCloseTo(0.9)
  })
})
