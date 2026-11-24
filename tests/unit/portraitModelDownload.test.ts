import { createHash } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ensurePortraitModel } from '../../src/infra/imaging/portraitModelDownload'

const data = Buffer.from('modelo-de-prueba')
const model = { file: 'model.onnx', url: 'https://example.test/model', bytes: data.length, md5: createHash('md5').update(data).digest('hex') }
let directory: string
const fetchMock = vi.fn()
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'totem-model-test-'))
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset().mockImplementation(async () => new Response(data))
})
afterEach(async () => {
  vi.unstubAllGlobals()
  await rm(directory, { recursive: true, force: true })
})

describe('preparación persistente del modelo', () => {
  it('descarga, verifica y reutiliza el mismo archivo sin pedir Internet de nuevo', async () => {
    const progress = vi.fn()
    const path = await ensurePortraitModel({ directory, model, onProgress: progress })
    expect(await readFile(path)).toEqual(data)
    expect(progress).toHaveBeenLastCalledWith(data.length, data.length)
    expect(await ensurePortraitModel({ directory, model })).toBe(path)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(await readdir(directory)).toEqual(['model.onnx'])
  })

  it('reutiliza el modelo incluido en desarrollo sin descargarlo', async () => {
    const bundledPath = join(directory, 'bundled.onnx')
    await writeFile(bundledPath, data)
    expect(await ensurePortraitModel({ directory, model, bundledPath })).toBe(bundledPath)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('reemplaza un modelo corrupto y elimina descargas parciales antiguas', async () => {
    await writeFile(join(directory, model.file), Buffer.alloc(data.length))
    await writeFile(join(directory, `${model.file}.part`), 'parcial')
    const path = await ensurePortraitModel({ directory, model })
    expect(await readFile(path)).toEqual(data)
    expect(await readdir(directory)).toEqual(['model.onnx'])
  })

  it.each(['checksum', 'incompleto', 'excesivo', 'http'])('no publica una descarga inválida: %s', async (kind) => {
    fetchMock.mockResolvedValue(new Response(kind === 'checksum' ? Buffer.alloc(data.length) : kind === 'incompleto' ? data.subarray(0, 3) : Buffer.alloc(data.length + 1), { status: kind === 'http' ? 503 : 200 }))
    await expect(ensurePortraitModel({ directory, model })).rejects.toThrow()
    expect(await readdir(directory)).toEqual([])
  })

  it('permite reintentar después de un error de red', async () => {
    fetchMock.mockRejectedValueOnce(new Error('sin conexión'))
    await expect(ensurePortraitModel({ directory, model })).rejects.toThrow('sin conexión')
    const path = await ensurePortraitModel({ directory, model })
    expect(await readFile(path)).toEqual(data)
  })

  it('cancela sin dejar un modelo definitivo ni restos parciales', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(ensurePortraitModel({ directory, model, signal: controller.signal })).rejects.toThrow()
    expect(await readdir(directory)).toEqual([])
  })
})
