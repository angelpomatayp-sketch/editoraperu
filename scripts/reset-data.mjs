// Solo desarrollo: deja la carpeta de datos como recién instalada, conservando los usuarios
// administrativos, la configuración y los textos legales. Borra campañas, recursos, contenido de
// atracción, participaciones, fotografías, publicaciones, bitácora y temporales.
//
// Uso: npm run reset-data --confirmar
import { existsSync, readdirSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dataDir = process.env.TOTEM_DATA_DIR ?? join(root, '.data')
const dbFile = join(dataDir, 'db', 'totem.sqlite')

// `npm run reset-data --confirmar` llega como variable de npm (PowerShell no deja pasar `--`).
if (!process.argv.includes('--confirmar') && process.env.npm_config_confirmar !== 'true') {
  console.log(`Esto borra campañas, recursos, contenido, participaciones, fotos y bitácora de:\n  ${dataDir}`)
  console.log('Se conservan los usuarios, la configuración (con la pantalla principal) y los textos legales.')
  console.log('Para continuar: npm run reset-data --confirmar')
  process.exit(1)
}
if (!existsSync(dbFile)) {
  console.log(`No hay base de datos en ${dbFile}; no hay nada que borrar.`)
  process.exit(0)
}

// Hijos antes que padres, para respetar las claves foráneas.
const TABLES = [
  'scenario_characters',
  'campaign_resources',
  'publication_queue',
  'photos',
  'consents',
  'participations',
  'resources',
  'campaigns',
  'media_items',
  'audit_events'
]

const db = new DatabaseSync(dbFile)
db.exec('PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON')
const counts = {}
db.exec('BEGIN IMMEDIATE')
try {
  for (const table of TABLES) counts[table] = Number(db.prepare(`DELETE FROM ${table}`).run().changes)
  db.exec("DELETE FROM sqlite_sequence WHERE name = 'audit_events'")
  db.exec('COMMIT')
} catch (error) {
  db.exec('ROLLBACK')
  throw error
}
const users = db.prepare('SELECT COUNT(*) AS n FROM users').get().n
try {
  db.exec('VACUUM')
} catch {
  // Con la aplicación abierta puede no compactarse; los datos ya están borrados.
}
db.close()

// Archivos: contenido cargado, fotografías, temporales y respaldos previos a migraciones.
const failed = []
const empty = (dir, keep = () => false) => {
  if (!existsSync(dir)) return
  for (const name of readdirSync(dir)) {
    if (keep(name)) continue
    try {
      rmSync(join(dir, name), { recursive: true, force: true })
    } catch {
      failed.push(join(dir, name))
    }
  }
}
// La pantalla principal es parte de la configuración: sus imágenes se conservan.
empty(join(dataDir, 'content'), (name) => name === 'institutional')
empty(join(dataDir, 'photos', 'originals'))
empty(join(dataDir, 'photos', 'finals'))
empty(join(dataDir, 'tmp'))
empty(join(dataDir, 'backups'))
empty(join(dataDir, 'db'), (name) => name.startsWith('totem.sqlite'))

console.log('Registros borrados:', counts)
console.log(`Usuarios conservados: ${users}`)
if (failed.length > 0) {
  console.log('No se pudieron borrar (en uso); cierre la aplicación y repita:', failed)
  process.exit(2)
}
console.log('Listo. Reinicie la aplicación.')
