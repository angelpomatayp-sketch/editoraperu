import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, rename, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'

export const PORTRAIT_MODEL = {
  file: 'birefnet-portrait.onnx',
  url: 'https://github.com/danielgatis/rembg/releases/download/v0.0.0/BiRefNet-portrait-epoch_150.onnx',
  bytes: 972_666_916,
  md5: 'c3a64a6abf20250d090cd055f12a3b67'
} as const

interface ModelDownload {
  directory: string
  bundledPath?: string
  onProgress?: (received: number, total: number) => void
  signal?: AbortSignal
  model?: { file: string; url: string; bytes: number; md5: string }
}

async function verified(path: string, model: { bytes: number; md5: string }): Promise<boolean> {
  try {
    if ((await stat(path)).size !== model.bytes) return false
    const hash = createHash('md5')
    for await (const chunk of createReadStream(path)) hash.update(chunk)
    return hash.digest('hex') === model.md5
  } catch { return false }
}

/** Solo publica el archivo definitivo después de verificar tamaño y checksum de rembg. */
export async function ensurePortraitModel(options: ModelDownload): Promise<string> {
  const model = options.model ?? PORTRAIT_MODEL
  const target = join(options.directory, model.file)
  if (await verified(target, model)) return target
  if (options.bundledPath && await verified(options.bundledPath, model)) return options.bundledPath
  await mkdir(options.directory, { recursive: true })
  const temp = `${target}.part`
  const signal = options.signal
    ? AbortSignal.any([options.signal, AbortSignal.timeout(15 * 60_000)])
    : AbortSignal.timeout(15 * 60_000)
  try {
    const response = await fetch(model.url, { signal, redirect: 'follow' })
    if (!response.ok || !response.body) throw new Error(`Descarga del modelo: HTTP ${response.status}`)
    let received = 0
    const hash = createHash('md5')
    const progress = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        received += chunk.length
        if (received > model.bytes) return callback(new Error('Tamaño de modelo inesperado'))
        hash.update(chunk)
        options.onProgress?.(received, model.bytes)
        callback(null, chunk)
      }
    })
    await pipeline(Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]), progress, createWriteStream(temp), { signal })
    if (received !== model.bytes || hash.digest('hex') !== model.md5) throw new Error('El modelo descargado no pasó la verificación; reintente la descarga')
    await rename(temp, target)
    return target
  } catch (error) {
    await rm(temp, { force: true })
    throw error
  }
}
