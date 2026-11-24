// Prepara los modelos de recorte de personas para uso sin Internet (se ejecuta una vez).
// - MediaPipe Selfie Segmenter (Apache 2.0): vista previa en vivo en la interfaz.
// - MODNet (Apache 2.0, exportación ONNX): recorte de la fotografía final en el proceso principal.
// Los archivos quedan en resources/ y se incluyen en el instalador (fase 9).
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { rename, rm } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const models = join(root, 'resources', 'models')
const wasmTarget = join(root, 'resources', 'vendor', 'mediapipe', 'wasm')

const DOWNLOADS = [
  {
    file: join(models, 'birefnet-portrait.onnx'),
    url: 'https://github.com/danielgatis/rembg/releases/download/v0.0.0/BiRefNet-portrait-epoch_150.onnx',
    minBytes: 100_000_000,
    md5: 'c3a64a6abf20250d090cd055f12a3b67'
  },
  {
    file: join(models, 'BiRefNet-LICENSE.txt'),
    url: 'https://raw.githubusercontent.com/ZhengPeng7/BiRefNet/main/LICENSE',
    minBytes: 1000
  },
  {
    file: join(models, 'selfie_segmenter.tflite'),
    url: 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite',
    minBytes: 100_000
  },
  {
    file: join(models, 'modnet.onnx'),
    url: 'https://huggingface.co/Xenova/modnet/resolve/main/onnx/model.onnx',
    minBytes: 20_000_000
  }
]

mkdirSync(models, { recursive: true })
mkdirSync(wasmTarget, { recursive: true })

const wasmSource = join(root, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm')
for (const name of readdirSync(wasmSource)) copyFileSync(join(wasmSource, name), join(wasmTarget, name))
console.log(`MediaPipe WASM copiado en ${wasmTarget}`)

async function checksum(file) {
  const hash = createHash('md5')
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  return hash.digest('hex')
}

for (const { file, url, minBytes, md5 } of DOWNLOADS) {
  if (existsSync(file) && statSync(file).size >= minBytes && (!md5 || await checksum(file) === md5)) {
    console.log(`Ya existe: ${file}`)
    continue
  }
  console.log(`Descargando ${url} …`)
  let lastError
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const response = await fetch(url, { redirect: 'follow' })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const temp = `${file}.part`
      await pipeline(Readable.fromWeb(response.body), createWriteStream(temp))
      const size = statSync(temp).size
      if (size < minBytes) throw new Error(`archivo incompleto (${size} bytes)`)
      if (md5 && await checksum(temp) !== md5) throw new Error('checksum del modelo incorrecto')
      await rename(temp, file)
      console.log(`  listo: ${(size / 1024 / 1024).toFixed(1)} MB`)
      lastError = null
      break
    } catch (error) {
      await rm(`${file}.part`, { force: true })
      lastError = error
      console.log(`  intento ${attempt} falló: ${error.message}`)
    }
  }
  if (lastError) {
    console.error(`No se pudo descargar ${url}. Vuelva a ejecutar "npm run models".`)
    process.exitCode = 1
  }
}
