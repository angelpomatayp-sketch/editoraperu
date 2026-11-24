import { Worker } from 'node:worker_threads'
import type { Compositor, StoredImage } from '../../core/capture/captureService'
import type { CompositorOptions } from './sharpCompositor'

export type CompositionWorkerOptions = Pick<CompositorOptions, 'dataRoot' | 'contentDir' | 'output'> & {
  modelPath?: string
  model: 'birefnet' | 'modnet'
  provider?: 'cpu' | 'dml'
  threads?: number
}
export type CompositionRequest = { id: number } & (
  { kind: 'warmup' } | { kind: 'compose'; args: Parameters<Compositor['compose']> } | { kind: 'shutdown' }
)

/** Mantiene ONNX, refinado y montaje fuera del hilo principal de Electron. */
export class WorkerCompositor implements Compositor {
  private worker: Worker | null = null
  private nextId = 0
  private pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>()
  private closed = false
  private closing: Promise<void> | null = null

  constructor(private readonly workerPath: string, private readonly options: CompositionWorkerOptions,
    private readonly onEvent: (event: { event: string; stage?: string; milliseconds?: number; message?: string; error?: string }) => void = () => {}) {}

  private getWorker(): Worker {
    if (this.closed) throw new Error('Procesador de fotografía cerrado')
    if (this.worker) return this.worker
    const worker = new Worker(this.workerPath, { workerData: this.options })
    this.worker = worker
    worker.on('message', (reply) => {
      if (reply.event) { this.onEvent(reply); return }
      const task = this.pending.get(reply.id)
      if (!task) return
      this.pending.delete(reply.id)
      if (reply.error) task.reject(new Error(reply.error))
      else task.resolve(reply.result)
    })
    const fail = (error: Error) => {
      if (this.worker !== worker) return
      this.worker = null
      for (const task of this.pending.values()) task.reject(error)
      this.pending.clear()
    }
    worker.on('error', fail)
    worker.on('exit', (code) => fail(new Error(`Procesador de fotografía detenido (${code})`)))
    worker.unref()
    return worker
  }

  private request(request: Omit<Extract<CompositionRequest, { kind: 'compose' }>, 'id'> | { kind: 'warmup' }): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const worker = this.getWorker()
      const id = ++this.nextId
      this.pending.set(id, { resolve, reject })
      try { worker.postMessage({ ...request, id }) }
      catch (error) { this.pending.delete(id); reject(error) }
    })
  }

  async warmUp(): Promise<void> { await this.request({ kind: 'warmup' }) }

  async compose(...args: Parameters<Compositor['compose']>): Promise<StoredImage> {
    return await this.request({ kind: 'compose', args }) as StoredImage
  }

  dispose(): Promise<void> {
    if (this.closing) return this.closing
    this.closed = true
    const worker = this.worker
    if (!worker) return Promise.resolve()
    // No terminar a la fuerza un hilo que está ejecutando ONNX nativo.
    this.closing = new Promise<void>((resolve, reject) => {
      worker.once('exit', code => code === 0 ? resolve() : reject(new Error(`El motor no cerró limpiamente (${code})`)))
      worker.ref()
      worker.postMessage({ kind: 'shutdown', id: ++this.nextId } satisfies CompositionRequest)
    })
    return this.closing
  }
}
