// electron-builder (afterPack): incluye las bibliotecas de Visual C++ junto a ONNX Runtime, para que
// el recorte con IA funcione en equipos nuevos sin instalar nada más (y sin administrador).
// Windows busca las dependencias de una DLL nativa primero en su propia carpeta.
const { copyFileSync, existsSync, readdirSync } = require('node:fs')
const { join } = require('node:path')

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return
  const source = join(__dirname, '..', 'resources', 'vcredist', 'x64')
  const dlls = readdirSync(source).filter((f) => f.toLowerCase().endsWith('.dll'))
  const targets = [
    join(context.appOutDir, 'resources', 'app.asar.unpacked', 'node_modules', 'onnxruntime-node', 'bin', 'napi-v6', 'win32', 'x64'),
    // Junto al ejecutable, por si otro componente las busca desde la carpeta de la aplicación.
    context.appOutDir
  ]
  for (const target of targets) {
    if (!existsSync(target)) throw new Error(`No existe la carpeta de destino de Visual C++: ${target}`)
    for (const dll of dlls) copyFileSync(join(source, dll), join(target, dll))
  }
  console.log(`  • Visual C++ x64 incluido (${dlls.length} DLL) junto a ONNX Runtime y al ejecutable`)
}
