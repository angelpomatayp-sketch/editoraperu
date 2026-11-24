import { describe, expect, it } from 'vitest'
import { applyCameraControls, applyConfiguredCameraControls, cameraCapabilities, type ControllableTrack } from '../../src/shared/cameraControls'

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
    whiteBalanceMode: ['manual', 'continuous'],
    focusMode: ['manual', 'continuous'],
    focusDistance: { min: 0, max: 100, step: 1 },
    zoom: { min: 1, max: 4, step: 0.1 }
  }

  it('detecta solo los ajustes soportados', () => {
    const { track } = fakeTrack(caps)
    const result = cameraCapabilities(track)
    expect(Object.keys(result.numeric).sort()).toEqual(['brightness', 'contrast', 'exposureTime', 'focusDistance'])
    expect(result.modes).toEqual({
      exposureMode: ['manual', 'continuous'],
      whiteBalanceMode: ['manual', 'continuous'],
      focusMode: ['manual', 'continuous']
    })
  })

  it('por defecto no aplica ni siquiera calibración guardada, para respetar el controlador', async () => {
    const { track, applied } = fakeTrack(caps)
    await applyConfiguredCameraControls(track, { exposureMode: 'continuous', focusMode: 'continuous', brightness: 30 })
    expect(applied).toEqual([])
  })

  it('con control activado aplica solo lo elegido y no fuerza los demás modos automáticos', async () => {
    const { track, applied } = fakeTrack(caps)
    await applyConfiguredCameraControls(track, {}, true)
    expect(applied).toEqual([])
    await applyConfiguredCameraControls(track, { exposureMode: 'manual' }, true)
    expect(applied).toEqual([{ exposureMode: 'manual' }])
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

  it('solo usa la distancia de enfoque en modo manual', async () => {
    const { track, applied } = fakeTrack(caps)
    await applyCameraControls(track, { focusMode: 'continuous', focusDistance: 30 })
    expect(applied).toEqual([{ focusMode: 'continuous' }])
  })

  it('una cámara que rechaza el ajuste sigue funcionando', async () => {
    const { track } = fakeTrack(caps, true)
    await expect(applyCameraControls(track, { brightness: 10 })).resolves.toBeUndefined()
  })

  it('conserva 4K, FPS y enfoque al aplicar brillo o exposición', async () => {
    const resolution = { width: { min: 3840 }, height: { min: 2160 }, resizeMode: { exact: 'none' }, frameRate: { ideal: 15 } }
    let current = { ...resolution, advanced: [{ focusMode: 'manual', focusDistance: 20 }] as Record<string, unknown>[] }
    const track: ControllableTrack = {
      getCapabilities: () => caps, getSettings: () => ({}), getConstraints: () => current,
      applyConstraints: async (c) => { current = c as typeof current }
    }
    await applyCameraControls(track, { brightness: 20, exposureMode: 'continuous' })
    expect(current).toEqual({ ...resolution, advanced: [{ focusMode: 'manual', focusDistance: 20, brightness: 20, exposureMode: 'continuous' }] })
    await applyCameraControls(track, { brightness: 30, focusMode: 'continuous' })
    expect(current).toMatchObject({ ...resolution, advanced: [{ brightness: 30, focusMode: 'continuous' }] })
  })
})
