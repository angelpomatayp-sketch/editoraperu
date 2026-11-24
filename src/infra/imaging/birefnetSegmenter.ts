import { existsSync } from 'node:fs'
import { availableParallelism } from 'node:os'
import type { InferenceSession } from 'onnxruntime-node'
import sharp from './sharpSetup'

const SIDE = 1024
const MEAN = [0.485, 0.456, 0.406] as const
const STD = [0.229, 0.224, 0.225] as const

/** BiRefNet Portrait: inferencia local con el preprocesado de rembg, sin Python ni red. */
export class BirefnetSegmenter {
  // La guía rápida no debe rellenar ni mutilar la máscara fotográfica.
  readonly independentMatte = true
  private session: Promise<InferenceSession> | null = null

  constructor(private readonly modelPath: string, private readonly options: {
    provider?: 'cpu' | 'dml'
    threads?: number
    onTiming?: (stage: string, milliseconds: number) => void
  } = {}) {}

  available(): boolean {
    return existsSync(this.modelPath)
  }

  async warmUp(): Promise<void> {
    await this.getSession()
  }

  async dispose(): Promise<void> {
    const session = this.session
    this.session = null
    if (session) await (await session).release()
  }

  private getSession(): Promise<InferenceSession> {
    const started = performance.now()
    this.session ??= import('onnxruntime-node').then((ort) => ort.InferenceSession.create(this.modelPath, {
      graphOptimizationLevel: 'all',
      executionProviders: this.options.provider === 'dml' ? ['dml', 'cpu'] : ['cpu'],
      intraOpNumThreads: this.options.threads ?? Math.min(8, availableParallelism()),
      executionMode: 'sequential',
      ...(this.options.provider === 'dml' ? { enableMemPattern: false } : {}),
      extra: { session: { 'intra_op.allow_spinning': '0', 'inter_op.allow_spinning': '0' } }
    })).then((session) => {
      this.options.onTiming?.('model_load', performance.now() - started)
      return session
    })
    this.session.catch(() => { this.session = null })
    return this.session
  }

  async matte(rgb: Buffer, width: number, height: number): Promise<Buffer> {
    if (rgb.length !== width * height * 3 || width < 1 || height < 1) throw new Error('Imagen RGB inválida')
    const ort = await import('onnxruntime-node')
    const session = await this.getSession()
    const resized = await sharp(rgb, { raw: { width, height, channels: 3 } })
      .resize(SIDE, SIDE, { fit: 'fill', kernel: 'lanczos3' }).raw().toBuffer()
    const plane = SIDE * SIDE
    const input = new Float32Array(plane * 3)
    for (let c = 0; c < 3; c++) {
      for (let i = 0; i < plane; i++) input[c * plane + i] = (resized[i * 3 + c]! / 255 - MEAN[c]!) / STD[c]!
    }
    const inferenceStarted = performance.now()
    const outputs = await session.run({ [session.inputNames[0]!]: new ort.Tensor('float32', input, [1, 3, SIDE, SIDE]) })
    this.options.onTiming?.('inference', performance.now() - inferenceStarted)
    const output = outputs[session.outputNames[0]!]!
    const h = Number(output.dims.at(-2))
    const w = Number(output.dims.at(-1))
    if (!w || !h || output.type !== 'float32' || output.data.length !== w * h) throw new Error('Máscara BiRefNet inválida')
    const values = output.data as Float32Array
    const probabilities = new Float32Array(w * h)
    let min = 1
    let max = 0
    for (let i = 0; i < values.length; i++) {
      if (!Number.isFinite(values[i])) throw new Error('Máscara BiRefNet no finita')
      const p = 1 / (1 + Math.exp(-values[i]!))
      probabilities[i] = p
      min = Math.min(min, p)
      max = Math.max(max, p)
    }
    const alpha = Buffer.alloc(w * h)
    const range = max - min
    for (let i = 0; i < alpha.length; i++) {
      alpha[i] = Math.round(255 * (range > 1e-6 ? (probabilities[i]! - min) / range : probabilities[i]!))
    }
    return sharp(alpha, { raw: { width: w, height: h, channels: 1 } })
      .resize(width, height, { fit: 'fill', kernel: 'lanczos3' }).extractChannel(0).raw().toBuffer()
  }
}
