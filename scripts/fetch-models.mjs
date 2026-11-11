// Prepara los modelos de recorte de personas para uso sin Internet (se ejecuta una vez).
// - MediaPipe Selfie Segmenter (Apache 2.0): vista previa en vivo en la interfaz.
// - MODNet (Apache 2.0, exportación ONNX): recorte de la fotografía final en el proceso principal.
// Los archivos quedan en resources/ y se incluyen en el instalador (fase 9).
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const models = join(root, 'resources', 'models')
const wasmTarget = join(root, 'resources', 'vendor', 'mediapipe', 'wasm')

const DOWNLOADS = [
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

for (const { file, url, minBytes } of DOWNLOADS) {
  if (existsSync(file) && statSync(file).size >= minBytes) {
    console.log(`Ya existe: ${file}`)
    continue
  }
  console.log(`Descargando ${url} …`)
  let lastError
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const response = await fetch(url, { redirect: 'follow' })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const data = Buffer.from(await response.arrayBuffer())
      if (data.length < minBytes) throw new Error(`archivo incompleto (${data.length} bytes)`)
      writeFileSync(file, data)
      console.log(`  listo: ${(data.length / 1024 / 1024).toFixed(1)} MB`)
      lastError = null
      break
    } catch (error) {
      lastError = error
      console.log(`  intento ${attempt} falló: ${error.message}`)
    }
  }
  if (lastError) {
    console.error(`No se pudo descargar ${url}. Vuelva a ejecutar "npm run models".`)
    process.exitCode = 1
  }
}
