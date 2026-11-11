import { mkdirSync, statfsSync } from 'node:fs'
import { join } from 'node:path'

/** Carpetas de datos separadas del programa instalado (RF-ALM-001, sección 20.6). */
export interface DataPaths {
  root: string
  config: string
  db: string
  content: string
  originals: string
  finals: string
  tmp: string
  logs: string
}

export function resolveDataPaths(root: string): DataPaths {
  return {
    root,
    config: join(root, 'config'),
    db: join(root, 'db'),
    content: join(root, 'content'),
    originals: join(root, 'photos', 'originals'),
    finals: join(root, 'photos', 'finals'),
    tmp: join(root, 'tmp'),
    logs: join(root, 'logs')
  }
}

export function ensureDataPaths(paths: DataPaths): void {
  for (const dir of Object.values(paths)) mkdirSync(dir, { recursive: true })
}

/** Espacio libre disponible para el usuario actual, en megabytes. */
export function freeDiskMegabytes(path: string): number {
  const stats = statfsSync(path)
  return Math.floor((stats.bavail * stats.bsize) / (1024 * 1024))
}
