// Arma el paquete del servicio de publicación para subirlo al cPanel.
//
//   npm run publicador:paquete                 instalación inicial (incluye app/config.php con la clave)
//   npm run publicador:paquete --actualizacion   solo código y vistas: no incluye config.php ni storage/
//
// Resultado en dist/publicador/: una carpeta lista para subir y su .zip. La clave de producción se
// genera una sola vez y se guarda en .data/config/publicador-produccion.json (no se versiona); es la
// que se configura en el tótem (panel → Sistema → Servicio de publicación).
import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const BASE_URL = 'https://editora.wowtechperu.com'
const FOLDER = 'editora.wowtechperu.com'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const update = process.argv.includes('--actualizacion') || process.env.npm_config_actualizacion === 'true'
const secretFile = join(root, '.data', 'config', 'publicador-produccion.json')

let production
if (existsSync(secretFile)) {
  production = JSON.parse(readFileSync(secretFile, 'utf8'))
} else {
  production = { baseUrl: BASE_URL, secret: randomBytes(32).toString('base64url'), createdAt: new Date().toISOString() }
  mkdirSync(dirname(secretFile), { recursive: true })
  writeFileSync(secretFile, JSON.stringify(production, null, 2))
}

const outDir = join(root, 'dist', 'publicador')
const stage = join(outDir, FOLDER)
rmSync(outDir, { recursive: true, force: true })
mkdirSync(stage, { recursive: true })

const source = join(root, 'publicador')
for (const part of ['app', 'cron', 'database', 'public']) {
  cpSync(join(source, part), join(stage, part), {
    recursive: true,
    // Nunca la configuración de pruebas local.
    filter: (path) => !path.endsWith(join('app', 'config.php'))
  })
}

if (!update) {
  // storage/ vacía y protegida; las fotos y la base las crea el servicio.
  mkdirSync(join(stage, 'storage'), { recursive: true })
  cpSync(join(source, 'storage', '.htaccess'), join(stage, 'storage', '.htaccess'))
  writeFileSync(
    join(stage, 'app', 'config.php'),
    `<?php
// Configuración de producción del servicio de publicación (${production.baseUrl}).
// Generada por scripts/package-publicador.mjs. No compartir: contiene la clave del tótem.
return [
    'base_url' => '${production.baseUrl}',
    'secret' => '${production.secret}',
    'db_dsn' => 'sqlite:' . __DIR__ . '/../storage/publicador.sqlite',
    'db_user' => null,
    'db_password' => null,
    'storage_dir' => __DIR__ . '/../storage/photos',
    'ttl_hours' => 72,
    'max_bytes' => 15 * 1024 * 1024,
    'rate_limit_per_minute' => 120,
    'max_clock_skew' => 300,
    'timezone' => 'America/Lima',
];
`
  )
}

const zip = join(outDir, `publicador-${update ? 'actualizacion' : 'instalacion'}.zip`)
// tar (incluido en Windows 10/11) genera rutas con «/» y conserva los .htaccess, como espera cPanel (Linux).
execFileSync('tar', ['-a', '-c', '-f', zip, '-C', stage, '.'], { stdio: 'inherit' })

console.log(`\nPaquete de ${update ? 'actualización' : 'instalación'}: ${zip}`)
console.log(`Subir y extraer en: /home/<usuario>/${FOLDER}/  (raíz del subdominio: ${FOLDER}/public)`)
if (update) console.log('No incluye app/config.php ni storage/: se conservan los del servidor.')
else console.log(`Clave para el tótem (panel → Sistema → Servicio de publicación): guardada en ${secretFile}`)
