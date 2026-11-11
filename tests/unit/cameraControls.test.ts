import { describe, expect, it } from 'vitest'
import { applyCameraControls, cameraCapabilities, type ControllableTrack } from '../../src/shared/cameraControls'

/** Pista de cámara simulada: solo lo que usan los ajustes de imagen. */
function fakeTrack(capabilities: Record<string, unknown>, reject = false) {
  const applied: Record<string, unknown>[] = []
  const track = {
    getCapabilities: () => capabilities,
    getSettings: () => ({}),
    applyConstraints: async (c: { advanced: Record<string, unknown>[] }) => {
      if (reject) throw new Error('OverconstrainedError')
      applied.push(...c.advanced)
    }
  } satisfies ControllableTrack
  return { track, applied }
}

describe('ajustes de imagen de la cámara', () => {
  const caps = {
    brightness: { min: -64, max: 64, step: 1 },
    contrast: { min: 0, max: 100, step: 1 },
    exposureMode: ['manual', 'continuous'],
    exposureTime: { min: 1, max: 5000, step: 1 },
    zoom: { min: 1, max: 4, step: 0.1 }
  }

  it('detecta solo los ajustes soportados', () => {
    const { track } = fakeTrack(caps)
    const result = cameraCapabilities(track)
    expect(Object.keys(result.numeric).sort()).toEqual(['brightness', 'contrast', 'exposureTime'])
    expect(result.modes).toEqual({ exposureMode: ['manual', 'continuous'] })
  })

  it('aplica primero los modos, limita los valores e ignora lo no soportado', async () => {
    const { track, applied } = fakeTrack(caps)
    await applyCameraControls(track, { exposureMode: 'manual', exposureTime: 9000, brightness: 20, saturation: 50 })
    expect(applied).toEqual([{ exposureMode: 'manual' }, { exposureTime: 5000, brightness: 20 }])
  })

  it('no usa el tiempo de exposición en modo automático', async () => {
    const { track, applied } = fakeTrack(caps)
    await applyCameraControls(track, { exposureTime: 300, contrast: 40 })
    expect(applied).toEqual([{ contrast: 40 }])
  })

  it('una cámara que rechaza el ajuste sigue funcionando', async () => {
    const { track } = fakeTrack(caps, true)
    await expect(applyCameraControls(track, { brightness: 10 })).resolves.toBeUndefined()
  })
})
