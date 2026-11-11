import { DatabaseSync } from 'node:sqlite'

/** Abre la base embebida con escritura WAL y claves foráneas activas (RF-ALM-004). */
export function openDatabase(file: string): DatabaseSync {
  const db = new DatabaseSync(file)
  try {
    db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      PRAGMA foreign_keys = ON;
      PRAGMA busy_timeout = 5000;
    `)
  } catch (error) {
    db.close()
    throw error
  }
  return db
}

/** Indica si el error de SQLite corresponde a un archivo dañado o que no es una base de datos. */
export function isCorruptionError(error: unknown): boolean {
  return error instanceof Error && /not a database|malformed|SQLITE_CORRUPT|SQLITE_NOTADB/i.test(error.message)
}

/** Devuelve los problemas de integridad encontrados; una lista vacía indica que la base está sana. */
export function checkIntegrity(db: DatabaseSync): string[] {
  const rows = db.prepare('PRAGMA quick_check').all() as { quick_check: string }[]
  return rows.map((row) => row.quick_check).filter((result) => result !== 'ok')
}

/** Copia consistente de la base, usada antes de aplicar migraciones. */
export function backupDatabase(db: DatabaseSync, targetFile: string): void {
  db.prepare('VACUUM INTO ?').run(targetFile)
}
