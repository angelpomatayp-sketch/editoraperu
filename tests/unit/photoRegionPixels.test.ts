import { describe, expect, it } from 'vitest'
import { OUTPUT, photoRegionPixels } from '../../src/shared/composition'
import { AUTO_FRAME, autoFrame } from '../../src/shared/compositionPlan'

describe('límite de ampliación sobre la foto 4K, no sobre la vista previa HD', () => {
  it.each([undefined, { height: 0.9, baseline: 0.98 }])('no supera 2x con o sin referencia al personaje (%j)', (target) => {
    const region = photoRegionPixels({ width: 1, height: 1 })
    expect(region).toEqual({ width: OUTPUT.width, height: OUTPUT.height })
    const frame = autoFrame({ x: 0.5, y: 0.6, width: 0.1, height: 0.16 }, 2160, 3840, region.width, region.height, target)!
    const scaleX = frame.box.width * region.width / (frame.crop.width * 2160)
    const scaleY = frame.box.height * region.height / (frame.crop.height * 3840)
    expect(scaleX).toBeCloseTo(AUTO_FRAME.maxUpscale)
    expect(scaleY).toBeCloseTo(AUTO_FRAME.maxUpscale)
    expect(scaleX).toBeCloseTo(scaleY)
  })
  it('redondea la zona con las mismas dimensiones finales que el compositor', () => {
    expect(photoRegionPixels({ width: 0.333, height: 0.731 })).toEqual({ width: 719, height: 2807 })
  })
})
