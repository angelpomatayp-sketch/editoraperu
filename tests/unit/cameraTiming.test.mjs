import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { captureBestFrame, preparePhotoCapture } from '../../src/renderer/src/public/capture/camera'

const capabilities = vi.fn()
const take = vi.fn()
let draw
beforeEach(() => {
  vi.useFakeTimers()
  capabilities.mockReset().mockResolvedValue({ imageWidth: { max: 3840 }, imageHeight: { max: 2160 } })
  take.mockReset().mockRejectedValue(new Error('sensor no disponible'))
  vi.stubGlobal('window', { setTimeout })
  vi.stubGlobal('ImageCapture', class {
    getPhotoCapabilities = capabilities
    takePhoto = take
  })
  draw = vi.fn()
  vi.stubGlobal('document', { createElement: () => ({ getContext: () => ({
    drawImage: draw, translate: vi.fn(), scale: vi.fn(), rotate: vi.fn(),
    getImageData: () => ({ data: new Uint8ClampedArray([11, 22, 33, 255]) })
  }) }) })
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

function camera() {
  const constraints = vi.fn().mockResolvedValue(undefined)
  const track = { readyState: 'live', getSettings: () => ({ width: 3840, height: 2160 }), getConstraints: () => ({}), applyConstraints: constraints }
  return {
    stream: { getVideoTracks: () => [track] },
    preview: { videoWidth: 3840, videoHeight: 2160 },
    constraints, track
  }
}

describe('instante de captura', () => {
  it('usa la captura del sensor preparada y conserva el giro vertical', async () => {
    const { stream, preview } = camera()
    const close = vi.fn()
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 3840, height: 2160, close }))
    take.mockResolvedValue(new Blob(['foto']))
    const ready = preparePhotoCapture(stream, preview)
    await vi.advanceTimersByTimeAsync(200)
    await ready
    const photo = await captureBestFrame(stream, preview, true, 90)
    expect(photo.width).toBe(2160)
    expect(photo.height).toBe(3840)
    expect(take).toHaveBeenCalledWith({ imageWidth: 3840, imageHeight: 2160 })
    expect(capabilities).toHaveBeenCalledTimes(1)
    expect(close).toHaveBeenCalledTimes(1)
  })
  it('prepara 4K y capacidades antes del disparo sin tomar fotos ni repetir la preparación', async () => {
    const { stream, preview, constraints } = camera()
    const ready = preparePhotoCapture(stream, preview)
    await vi.advanceTimersByTimeAsync(200)
    await ready
    expect(capabilities).toHaveBeenCalledTimes(1)
    expect(take).not.toHaveBeenCalled()
    await preparePhotoCapture(stream, preview)
    const photo = await captureBestFrame(stream, preview, false, 0)
    expect(constraints).toHaveBeenCalledTimes(1)
    expect(constraints).toHaveBeenCalledWith(expect.objectContaining({
      width: { min: 3840, ideal: 3840, max: 4096 }, height: { min: 2160, ideal: 2160, max: 4096 }, resizeMode: { exact: 'none' }
    }))
    expect(capabilities).toHaveBeenCalledTimes(1)
    expect([...photo.rgba]).toEqual([11, 22, 33, 255])
    // Si falla el sensor usa el cuadro congelado al disparar, no uno posterior.
    expect(draw).toHaveBeenCalledTimes(1)
  })

  it('intenta tomar foto aunque el controlador no implemente la consulta de capacidades', async () => {
    const { stream, preview } = camera()
    capabilities.mockRejectedValue(new Error('no implementado'))
    const ready = preparePhotoCapture(stream, preview)
    await vi.advanceTimersByTimeAsync(200)
    await ready
    await captureBestFrame(stream, preview, false, 0)
    expect(take).toHaveBeenCalled()
    expect(draw).toHaveBeenCalledTimes(1)
  })

  it('rechaza fotos Full HD aunque ImageCapture diga que soporta 4K, sin ampliarlas', async () => {
    const { stream, preview, track, constraints } = camera()
    preview.videoWidth = 1920; preview.videoHeight = 1080
    track.getSettings = () => ({ width: 1920, height: 1080 })
    constraints.mockRejectedValue(new Error('sin vídeo 4K'))
    const close = vi.fn()
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 1920, height: 1080, close }))
    take.mockResolvedValue(new Blob(['HD']))
    await expect(captureBestFrame(stream, preview, false, 0)).rejects.toMatchObject({ problem: 'resolution_unsupported' })
    expect(take).toHaveBeenCalledTimes(2)
    expect(close).toHaveBeenCalledTimes(2)
    expect(draw).not.toHaveBeenCalled()
  })

  it('acepta foto 4K del sensor aunque el vídeo solo admita Full HD', async () => {
    const { stream, preview, track, constraints } = camera()
    preview.videoWidth = 1920; preview.videoHeight = 1080
    track.getSettings = () => ({ width: 1920, height: 1080 })
    constraints.mockRejectedValue(new Error('sin vídeo 4K'))
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 3840, height: 2160, close: vi.fn() }))
    take.mockResolvedValue(new Blob(['4K']))
    expect(await captureBestFrame(stream, preview, true, 270)).toMatchObject({ width: 2160, height: 3840 })
    expect(draw).toHaveBeenCalledTimes(1)
  })

  it('sin ImageCapture no acepta un cuadro HD', async () => {
    vi.stubGlobal('ImageCapture', undefined)
    const { stream, preview, track, constraints } = camera()
    preview.videoWidth = 1920; preview.videoHeight = 1080
    track.getSettings = () => ({ width: 1920, height: 1080 })
    constraints.mockRejectedValue(new Error('sin UHD'))
    await expect(captureBestFrame(stream, preview, false, 0)).rejects.toMatchObject({ problem: 'resolution_unsupported' })
    expect(draw).not.toHaveBeenCalled()
  })

  it('sin ImageCapture espera la propagación del vídeo 4K girado antes de congelarlo', async () => {
    vi.stubGlobal('ImageCapture', undefined)
    const { stream, preview } = camera()
    preview.videoWidth = 1080; preview.videoHeight = 1920
    setTimeout(() => { preview.videoWidth = 2160; preview.videoHeight = 3840 }, 350)
    const capture = captureBestFrame(stream, preview, false, 90)
    await vi.advanceTimersByTimeAsync(400)
    expect(await capture).toMatchObject({ width: 2160, height: 3840 })
    expect(draw).toHaveBeenCalledTimes(1)
  })

  it('conserva controles manuales y admite un flujo físico vertical', async () => {
    const { stream, preview, track, constraints } = camera()
    preview.videoWidth = 2160; preview.videoHeight = 3840
    track.getSettings = () => ({ width: 2160, height: 3840 })
    track.getConstraints = () => ({ advanced: [{ focusMode: 'manual', focusDistance: 20 }] })
    const ready = preparePhotoCapture(stream, preview)
    await vi.advanceTimersByTimeAsync(200)
    await ready
    expect(constraints).toHaveBeenCalledWith(expect.objectContaining({
      width: { min: 2160, ideal: 2160, max: 4096 }, height: { min: 3840, ideal: 3840, max: 4096 },
      advanced: [{ focusMode: 'manual', focusDistance: 20 }]
    }))
  })

  it('una desconexión no devuelve el último cuadro como una foto nueva', async () => {
    const { stream, preview, track } = camera()
    track.readyState = 'ended'
    await expect(captureBestFrame(stream, preview, false, 0)).rejects.toMatchObject({ problem: 'disconnected' })
    expect(draw).not.toHaveBeenCalled()
  })
})
