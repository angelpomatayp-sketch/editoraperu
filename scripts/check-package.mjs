// Verifica que el paquete generado por electron-builder tenga la aplicación completa antes de
// entregar el instalador. Si se recompiló `out/` mientras se empaquetaba (por ejemplo, con `npm start`
// abierto), el paquete puede salir sin la interfaz y la app mostraría solo una pantalla azul.
import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const require = createRequire(import.meta.url)
const asar = require('@electron/asar')
const pkg = require('../package.json')

const archive = join(import.meta.dirname, '..', 'dist', 'win-unpacked', 'resources', 'app.asar')
if (!existsSync(archive)) {
  console.error(`No se encontró el paquete: ${archive}`)
  process.exit(1)
}

const files = new Set(asar.listPackage(archive).map((f) => f.replaceAll('\\', '/')))
const required = ['/out/main/index.js', '/out/preload/index.js', '/out/renderer/index.html']
const missing = required.filter((f) => !files.has(f))
const assets = [...files].filter((f) => f.startsWith('/out/renderer/assets/'))
for (const kind of [/\.js$/, /\.css$/, /fondo1-.*\.png$/, /fondo2-.*\.png$/, /fondo3-.*\.png$/]) {
  if (!assets.some((f) => kind.test(f))) missing.push(`/out/renderer/assets/${kind.source}`)
}

if (missing.length > 0) {
  console.error('El paquete está incompleto; NO entregue este instalador. Faltan:')
  for (const f of missing) console.error(`  - ${f}`)
  console.error('Cierre `npm start` / `npm run dev` y vuelva a ejecutar `npm run dist`.')
  process.exit(1)
}
console.log(`Paquete ${pkg.version} completo: interfaz, proceso principal y fondos incluidos (${assets.length} archivos de interfaz).`)
