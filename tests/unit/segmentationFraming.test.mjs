import { afterEach, describe, expect, it, vi } from 'vitest'

// Ejecuta el ciclo real del canvas con máscara sintética, sin necesitar cámara ni GPU.
const hooks = vi.hoisted(() => ({ refs: [], cursor: 0, effects: [] }))
const createSegmenter = vi.hoisted(() => vi.fn())
vi.mock('react', () => ({
  useRef: (value) => {
    const i = hooks.cursor++
    return hooks.refs[i] ?? (hooks.refs[i] = { current: value })
  },
  useState: (value) => [value, vi.fn()],
  useEffect: (effect) => { hooks.effects.push(effect) }
}))
vi.mock('@mediapipe/tasks-vision', () => ({
  FilesetResolver: { forVisionTasks: async () => ({}) },
  ImageSegmenter: { createFromOptions: createSegmenter }
}))
import { SegmentationVideo } from '../../src/renderer/src/public/capture/SegmentationVideo'

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); hooks.refs = []; hooks.cursor = 0; hooks.effects = [] })

describe('estabilidad del encuadre en vivo', () => {
  it('suaviza, fija el tamaño al final de la cuenta sin congelar el video y libera el encuadre al salir', async () => {
    let now = 100
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    let nextFrame
    vi.stubGlobal('requestAnimationFrame', (draw) => { nextFrame = draw; return 1 })
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    vi.stubGlobal('devicePixelRatio', 1)
    const ctx = {
      createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
      putImageData: vi.fn(), drawImage: vi.fn(), save: vi.fn(), restore: vi.fn(), clearRect: vi.fn(), translate: vi.fn(), scale: vi.fn()
    }
    const canvas = () => ({ width: 600, height: 1000, clientWidth: 600, clientHeight: 1000, getContext: () => ctx })
    vi.stubGlobal('document', { createElement: canvas })
    let bottom = 180
    let visible = true
    const close = vi.fn()
    createSegmenter.mockResolvedValue({ segmentForVideo: () => {
      const values = new Float32Array(100 * 200)
      if (visible) for (let y = 20; y < bottom; y++) for (let x = 40; x < 60; x++) values[y * 100 + x] = 1
      return { confidenceMasks: [{ width: 100, height: 200, getAsFloat32Array: () => values }], close }
    } })
    const report = vi.fn()
    const props = {
      videoRef: { current: { readyState: 4, videoWidth: 1000, videoHeight: 2000 } },
      mirror: true, autoFraming: true, framing: 0, characterTarget: { height: 0.45, baseline: 0.8 },
      regionPx: { width: 600, height: 1000 }, onPlacement: report
    }
    const render = (extra = {}) => { hooks.cursor = 0; SegmentationVideo({ ...props, ...extra }) }
    // Incluso una cuenta de 1–2 segundos puede obtener su primer encuadre antes de fijarlo.
    render({ lockFraming: true })
    hooks.refs[0].current = canvas()
    const cleanup = hooks.effects[0]()
    try {
      await vi.waitFor(() => expect(report).toHaveBeenCalled())
      const initial = report.mock.lastCall[0]
      expect(initial).not.toBeNull()
      const tick = () => { now += 40; nextFrame() }
      render({ lockFraming: false })
      bottom = 140
      tick()
      const smoothed = report.mock.lastCall[0]
      // La altura detectada cambia de 160 a 120: el primer paso utiliza 152, no salta a 120.
      expect(smoothed.box.height / smoothed.crop.height).toBeCloseTo(0.45 / 0.76)
      expect(smoothed).not.toEqual(initial)
      render({ lockFraming: true })
      bottom = 100
      const draws = ctx.drawImage.mock.calls.length
      for (let i = 0; i < 8; i++) tick()
      expect(report.mock.lastCall[0]).toEqual(smoothed)
      expect(ctx.drawImage.mock.calls.length).toBeGreaterThan(draws)
      // Desbloquear (nuevo intento) permite volver a acomodarse.
      render({ lockFraming: false })
      tick()
      expect(report.mock.lastCall[0]).not.toEqual(smoothed)
      visible = false
      now += 1100
      tick()
      expect(report.mock.lastCall[0]).toBeNull()
      expect(close).toHaveBeenCalled()
    } finally { cleanup() }
    expect(report.mock.lastCall[0]).toBeNull()
  })
})
