import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BirefnetSegmenter } from '../../src/infra/imaging/birefnetSegmenter'

const mocks = vi.hoisted(() => ({ run: vi.fn(), create: vi.fn() }))
vi.mock('onnxruntime-node', () => ({
  InferenceSession: { create: mocks.create },
  Tensor: class {
    constructor(public type: string, public data: Float32Array, public dims: number[]) {}
  }
}))

beforeEach(() => {
  vi.clearAllMocks()
  mocks.create.mockResolvedValue({ inputNames: ['image'], outputNames: ['mask'], run: mocks.run })
  mocks.run.mockResolvedValue({ mask: { type: 'float32', dims: [1, 1, 2, 2], data: new Float32Array([-10, 10, -10, 10]) } })
})

describe('BiRefNet Portrait', () => {
  it('usa RGB CHW normalizado y devuelve alfa a resolución original', async () => {
    const model = new BirefnetSegmenter('test.onnx')
    const alpha = await model.matte(Buffer.from([255, 0, 0, 255, 0, 0, 255, 0, 0, 255, 0, 0]), 2, 2)
    expect([...alpha]).toEqual([0, 255, 0, 255])
    const tensor = mocks.run.mock.calls[0]![0].image
    expect(tensor.dims).toEqual([1, 3, 1024, 1024])
    expect(tensor.data[0]).toBeCloseTo((1 - 0.485) / 0.229)
    expect(tensor.data[1024 * 1024]).toBeCloseTo(-0.456 / 0.224)
    expect(model.independentMatte).toBe(true)
  })

  it('reutiliza la sesión y vuelve a cargarla si falla la carga inicial', async () => {
    const model = new BirefnetSegmenter('test.onnx')
    mocks.create.mockRejectedValueOnce(new Error('fallo de carga'))
    await expect(model.warmUp()).rejects.toThrow('fallo de carga')
    await model.warmUp()
    await model.warmUp()
    expect(mocks.create).toHaveBeenCalledTimes(2)
  })

  it('rechaza resultados corruptos y evita división por cero en máscaras uniformes', async () => {
    const model = new BirefnetSegmenter('test.onnx')
    mocks.run.mockResolvedValueOnce({ mask: { type: 'float32', dims: [1, 1, 1, 1], data: new Float32Array([NaN]) } })
    await expect(model.matte(Buffer.alloc(12), 2, 2)).rejects.toThrow('no finita')
    mocks.run.mockResolvedValueOnce({ mask: { type: 'float32', dims: [1, 1, 1, 1], data: new Float32Array([-20]) } })
    expect([...await model.matte(Buffer.alloc(12), 2, 2)]).toEqual([0, 0, 0, 0])
  })
})
