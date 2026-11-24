import { existsSync, mkdtempSync, mkdirSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import sharp from 'sharp'
import { expect, it } from 'vitest'
import { SharpCompositor } from '../../src/infra/imaging/sharpCompositor'
import { WorkerCompositor } from '../../src/infra/imaging/workerCompositor'

const entry = resolve(process.env.TOTEM_TEST_WORKER_ENTRY ?? 'out/main/compositionWorker.js')
it.skipIf(!existsSync(entry))('el cierre espera las tareas pendientes y rechaza tareas nuevas sin terminar el hilo a la fuerza', async () => {
  const worker = new WorkerCompositor(entry, {
    dataRoot: tmpdir(), contentDir: tmpdir(), output: { width: 120, height: 200, jpegQuality: 95 }, model: 'birefnet'
  })
  const warmup = worker.warmUp()
  const stopped = worker.dispose()
  expect(worker.dispose()).toBe(stopped)
  await warmup
  await stopped
  await expect(worker.warmUp()).rejects.toThrow('cerrado')
})
it.skipIf(!process.env.TOTEM_TEST_PACKAGED_MODEL || !existsSync(entry))('carga ONNX nativo desde el worker empaquetado sin bloquear el hilo principal', async () => {
  const events: { stage?: string }[] = []
  const worker = new WorkerCompositor(entry, {
    dataRoot: tmpdir(), contentDir: tmpdir(), output: { width: 2160, height: 3840, jpegQuality: 95 },
    model: 'birefnet', modelPath: resolve('resources/models/birefnet-portrait.onnx'), provider: 'cpu', threads: 8
  }, (event) => events.push(event))
  let ticks = 0
  const timer = setInterval(() => ticks++, 100)
  try {
    await worker.warmUp()
    expect(events.some((event) => event.stage === 'model_load')).toBe(true)
    expect(ticks).toBeGreaterThan(1)
  } finally { clearInterval(timer); await worker.dispose() }
}, 120_000)

it.skipIf(!existsSync(entry))('el worker produce el mismo JPEG y propaga errores sin bloquear la aplicación', async () => {
  const root = mkdtempSync(join(tmpdir(), 'totem-compose-worker-'))
  mkdirSync(join(root, 'photos'))
  const options = { dataRoot: root, contentDir: root, output: { width: 120, height: 200, jpegQuality: 95 } }
  const events: unknown[] = []
  const worker = new WorkerCompositor(entry, { ...options, model: 'birefnet' }, (event) => events.push(event))
  try {
    await sharp({ create: { width: 120, height: 200, channels: 3, background: '#a98362' } }).jpeg().toFile(join(root, 'original.jpg'))
    const plan = [{ kind: 'photo' as const, order: 10, left: 0, top: 0, width: 120, height: 200 }]
    const direct = new SharpCompositor(options)
    await direct.compose(plan, 'original.jpg', 'photos/direct.jpg', null)
    await worker.warmUp()
    const stored = await worker.compose(plan, 'original.jpg', 'photos/worker.jpg', null)
    expect(stored.width).toBe(120)
    expect(readFileSync(join(root, 'photos/worker.jpg'))).toEqual(readFileSync(join(root, 'photos/direct.jpg')))
    await expect(worker.compose(plan, 'missing.jpg', 'photos/error.jpg', null)).rejects.toThrow()
    await worker.compose(plan, 'original.jpg', 'photos/retry.jpg', null)
    expect(events).toContainEqual(expect.objectContaining({ stage: 'compose_total' }))
  } finally { await worker.dispose(); rmSync(root, { recursive: true, force: true }) }
})
