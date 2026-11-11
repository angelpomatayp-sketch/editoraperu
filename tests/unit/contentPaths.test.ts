import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { contentUrl, resolveAppUrl, resolveContentUrl } from '../../src/infra/storage/contentPaths'

const contentDir = resolve('C:/datos/content')

describe('protocolo de contenido', () => {
  it('genera y resuelve la URL de un archivo dentro de la carpeta de contenido', () => {
    const url = contentUrl('media/dev-seed/01 bienvenida ñ.svg')
    expect(url).toBe('totem-media://content/media/dev-seed/01%20bienvenida%20%C3%B1.svg')
    expect(resolveContentUrl(contentDir, url)).toBe(join(contentDir, 'media', 'dev-seed', '01 bienvenida ñ.svg'))
  })

  it.each(['totem-media://content/../db/totem.sqlite', 'totem-media://content/%2e%2e/db/totem.sqlite'])(
    'normaliza %s sin salir de la carpeta de contenido',
    (url) => {
      expect(resolveContentUrl(contentDir, url)).toBe(join(contentDir, 'db', 'totem.sqlite'))
    }
  )

  it.each([
    'totem-media://content/media/%2e%2e%2f%2e%2e%2fdb/totem.sqlite',
    'totem-media://content/..%5c..%5cdb%5ctotem.sqlite',
    'totem-media://content/C:%5cWindows%5cwin.ini',
    'totem-media://otro/media/a.png',
    'file:///C:/datos/content/media/a.png',
    'totem-media://content/',
    'no es una url'
  ])('rechaza %s', (url) => {
    expect(resolveContentUrl(contentDir, url)).toBeNull()
  })
})

describe('recursos de la aplicación (motor y modelos de recorte)', () => {
  const appDir = resolve('C:/app/resources')

  it('sirve solo las carpetas del motor y de los modelos', () => {
    expect(resolveAppUrl(appDir, 'totem-media://app/models/selfie_segmenter.tflite')).toBe(join(appDir, 'models', 'selfie_segmenter.tflite'))
    expect(resolveAppUrl(appDir, 'totem-media://app/vendor/mediapipe/wasm/vision_wasm_internal.wasm')).toBe(
      join(appDir, 'vendor', 'mediapipe', 'wasm', 'vision_wasm_internal.wasm')
    )
  })

  it.each([
    'totem-media://app/dev-seed/media/01.svg',
    'totem-media://app/models/%2e%2e/%2e%2e/secretos.json',
    'totem-media://app/',
    'totem-media://content/models/modnet.onnx'
  ])('rechaza %s', (url) => {
    expect(resolveAppUrl(appDir, url)).toBeNull()
  })
})
