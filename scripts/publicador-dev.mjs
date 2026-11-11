// Solo desarrollo: configura y levanta el servicio de publicación con el PHP de XAMPP.
// - Genera publicador/app/config.php con una clave aleatoria (se conserva entre ejecuciones).
// - Escribe .data/config/publication.dev.json para que el tótem use este servicio local.
// - Escucha en la IP de la red local, para abrir el enlace del QR desde un teléfono en la misma red Wi-Fi.
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { networkInterfaces } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const port = Number(process.env.PUBLICADOR_PORT ?? 8090)
const devTarget = join(process.env.TOTEM_DATA_DIR ?? join(root, '.data'), 'config', 'publication.dev.json')
const configPhp = join(root, 'publicador', 'app', 'config.php')

function lanAddress() {
  const candidates = Object.entries(networkInterfaces()).flatMap(([name, list]) =>
    (list ?? []).filter((a) => a.family === 'IPv4' && !a.internal).map((a) => ({ name, address: a.address }))
  )
  const preferred = candidates.find((c) => /wi-?fi|wlan|ethernet/i.test(c.name)) ?? candidates[0]
  return preferred?.address ?? '127.0.0.1'
}

function phpBinary() {
  if (process.env.PHP_BIN) return process.env.PHP_BIN
  return existsSync('C:\\xampp\\php\\php.exe') ? 'C:\\xampp\\php\\php.exe' : 'php'
}

const previous = existsSync(devTarget) ? JSON.parse(readFileSync(devTarget, 'utf8')) : {}
const secret = previous.secret ?? randomBytes(32).toString('base64url')
const baseUrl = `http://${lanAddress()}:${port}`

mkdirSync(dirname(devTarget), { recursive: true })
writeFileSync(devTarget, JSON.stringify({ baseUrl, secret }, null, 2))

const php = (value) => `'${String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
writeFileSync(
  configPhp,
  `<?php
// Generado por scripts/publicador-dev.mjs para pruebas locales. No usar en producción.
return [
    'base_url' => ${php(baseUrl)},
    'secret' => ${php(secret)},
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

console.log(`Servicio de publicación local: ${baseUrl}`)
console.log(`El tótem usará esta configuración (${devTarget}).`)
console.log('Para probar el QR con un teléfono, conéctelo a la misma red Wi-Fi que este equipo.')
console.log('Si Windows lo pregunta, permita el acceso de PHP en redes privadas.\n')

const server = spawn(
  phpBinary(),
  ['-S', `0.0.0.0:${port}`, '-t', join(root, 'publicador', 'public'), join(root, 'publicador', 'public', 'index.php')],
  { stdio: 'inherit' }
)
server.on('exit', (code) => process.exit(code ?? 0))
process.on('SIGINT', () => server.kill('SIGINT'))
