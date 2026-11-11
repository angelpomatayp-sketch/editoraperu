import { readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Elimina los temporales abandonados al iniciar (RF-ALM-003, RF-KIO-004). Al arrancar no existe
 * ninguna sesión en curso, por lo que todo lo que quede en la carpeta temporal está incompleto.
 * Devuelve los nombres eliminados y los que no se pudieron eliminar, para la bitácora.
 */
export function cleanTempDir(dir: string): { removed: string[]; failed: string[] } {
  const removed: string[] = []
  const failed: string[] = []
  for (const name of readdirSync(dir)) {
    try {
      rmSync(join(dir, name), { recursive: true, force: true })
      removed.push(name)
    } catch {
      failed.push(name)
    }
  }
  return { removed, failed }
}
