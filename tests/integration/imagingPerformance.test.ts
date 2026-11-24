import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { expect, it } from 'vitest'
import sharp from 'sharp'
import { WorkerCompositor } from '../../src/infra/imaging/workerCompositor'

const entry = resolve('out/main/compositionWorker.js')
const model = resolve('resources/models/birefnet-portrait.onnx')
const photo = resolve(process.env.TOTEM_TEST_PHOTO ?? 'ae0399e8-56c8-437f-85f2-fd80ebe2610e.jpg')
it.skipIf(!process.env.TOTEM_TEST_PERFORMANCE || !existsSync(model) || !existsSync(entry) || !existsSync(photo))('compara 4 hilos y CPU automática sin cambiar el montaje 4K', async () => {
  const root = mkdtempSync(join(tmpdir(), 'totem-performance-'))
  mkdirSync(join(root, 'photos'))
  copyFileSync(photo, join(root, 'original.jpg'))
  const reports: unknown[] = []
  const runs = process.env.TOTEM_TEST_ONLY_CPU_THREADS ? [
    { label: `cpu${process.env.TOTEM_TEST_ONLY_CPU_THREADS}`, provider: 'cpu' as const, threads: Number(process.env.TOTEM_TEST_ONLY_CPU_THREADS) }
  ] : [
    { label: 'cpu4', provider: 'cpu' as const, threads: 4 },
    { label: 'cpuAuto', provider: 'cpu' as const, threads: 0 },
    ...(process.env.TOTEM_TEST_DML ? [{ label: 'dml', provider: 'dml' as const, threads: 0 }] : [])
  ]
  let reference: Buffer | undefined = process.env.TOTEM_TEST_REFERENCE
    ? await sharp(process.env.TOTEM_TEST_REFERENCE).raw().toBuffer() : undefined
  for (const run of runs) {
    const timings: unknown[] = []
    const worker = new WorkerCompositor(entry, {
      dataRoot: root, contentDir: root, output: { width: 2160, height: 3840, jpegQuality: 95 },
      model: 'birefnet', modelPath: model, provider: run.provider, threads: run.threads
    }, (event) => timings.push(event))
    let ticks = 0
    const timer = setInterval(() => ticks++, 100)
    const started = Date.now()
    try {
      await worker.compose([{ kind: 'photo', order: 10, left: 0, top: 0, width: 2160, height: 3840 }], 'original.jpg', `photos/${run.label}.jpg`, { method: 'segmentation', guide: null })
      expect(timings.some((e) => (e as { stage?: string }).stage === 'inference')).toBe(true)
      expect(timings.some((e) => (e as { event: string }).event === 'warning')).toBe(false)
      const jpeg = readFileSync(join(root, `photos/${run.label}.jpg`))
      const pixels = await sharp(jpeg).raw().toBuffer()
      let maxDifference = 0
      let different = 0
      if (reference) for (let i = 0; i < pixels.length; i++) {
        const difference = Math.abs(pixels[i]! - reference[i]!)
        maxDifference = Math.max(maxDifference, difference)
        if (difference) different++
      }
      else reference = pixels
      reports.push({ run: run.label, milliseconds: Date.now() - started, ticks, maxDifference, differentChannels: different, timings: [...timings] })
      writeFileSync(join(root, 'report.json'), JSON.stringify(reports, null, 2))
      expect(ticks).toBeGreaterThan(5)
      if (run.provider === 'cpu') expect(maxDifference).toBe(0)
      if (process.env.TOTEM_TEST_REPEAT) {
        const warmStarted = Date.now()
        const tickStart = ticks
        const eventStart = timings.length
        await worker.compose([{ kind: 'photo', order: 10, left: 0, top: 0, width: 2160, height: 3840 }], 'original.jpg', `photos/${run.label}-warm.jpg`, { method: 'segmentation', guide: null })
        expect(readFileSync(join(root, `photos/${run.label}-warm.jpg`))).toEqual(jpeg)
        reports.push({ run: `${run.label}-warm`, milliseconds: Date.now() - warmStarted, ticks: ticks - tickStart, maxDifference: 0, timings: timings.slice(eventStart) })
        writeFileSync(join(root, 'report.json'), JSON.stringify(reports, null, 2))
      }
    } finally {
      clearInterval(timer)
      worker.dispose()
      await new Promise((r) => setTimeout(r, 1500))
    }
  }
  console.log(`Comparación guardada en ${root}`)
  if (process.env.TOTEM_TEST_REPORT) writeFileSync(process.env.TOTEM_TEST_REPORT, JSON.stringify({ root, reports }, null, 2))
}, 900_000)
