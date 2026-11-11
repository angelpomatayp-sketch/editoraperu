// Antes de generar el instalador: los modelos de recorte y el motor de MediaPipe deben estar
// preparados (`npm run models`); sin ellos el tótem instalado no podría quitar el fondo.
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const required = ['resources/models/modnet.onnx', 'resources/models/selfie_segmenter.tflite', 'resources/vendor/mediapipe/wasm']
const missing = required.filter((path) => !existsSync(join(root, path)))
if (missing.length > 0) {
  console.error(`Faltan recursos para el instalador: ${missing.join(', ')}\nEjecute primero: npm run models`)
  process.exit(1)
}
console.log('Modelos de recorte y motor de MediaPipe: listos.')
