import { parentPort, workerData } from 'node:worker_threads'
import { BirefnetSegmenter } from './birefnetSegmenter'
import { ModnetSegmenter } from './modnetSegmenter'
import { SharpCompositor } from './sharpCompositor'
import type { CompositionWorkerOptions, CompositionRequest } from './workerCompositor'

const port = parentPort!
const options = workerData as CompositionWorkerOptions
const timing = (stage: string, milliseconds: number) => port.postMessage({ event: 'timing', stage, milliseconds: Math.round(milliseconds) })
const segmenter = options.modelPath ? options.model === 'birefnet'
  ? new BirefnetSegmenter(options.modelPath, { provider: options.provider, threads: options.threads, onTiming: timing })
  : new ModnetSegmenter(options.modelPath) : null
const compositor = new SharpCompositor({
  ...options, segmenter, onTiming: timing,
  onWarning: (message, error) => port.postMessage({ event: 'warning', message, error: String(error) })
})

// Una sola inferencia/composición a la vez; reutiliza el modelo sin multiplicar su memoria.
let queue = Promise.resolve()
port.on('message', (request: CompositionRequest) => {
  queue = queue.then(async () => {
    try {
      if (request.kind === 'shutdown') {
        try { await segmenter?.dispose() } finally { port.close() }
        return
      }
      const started = performance.now()
      const result = request.kind === 'warmup'
        ? await segmenter?.warmUp()
        : await compositor.compose(...request.args)
      timing(request.kind === 'warmup' ? 'warmup' : 'compose_total', performance.now() - started)
      port.postMessage({ id: request.id, result })
    } catch (error) {
      port.postMessage({ id: request.id, error: String(error) })
    }
  })
})
