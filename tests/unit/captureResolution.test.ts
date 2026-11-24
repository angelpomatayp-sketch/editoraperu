import { describe, expect, it } from 'vitest'
import { is4kCapture } from '../../src/shared/capture'

describe('resolución mínima del original', () => {
  it.each([[3840, 2160], [2160, 3840], [4096, 2160], [4000, 3000]])('acepta %i × %i sin depender de la orientación', (width, height) => {
    expect(is4kCapture(width, height)).toBe(true)
  })
  it.each([[1920, 1080], [1080, 1920], [3840, 2159], [3839, 2160], [3000, 3000], [7680, 1080], [NaN, 2160], [Infinity, 2160], [3840.5, 2160]])('rechaza %i × %i aunque la cantidad total de píxeles sea grande', (width, height) => {
    expect(is4kCapture(width, height)).toBe(false)
  })
})
