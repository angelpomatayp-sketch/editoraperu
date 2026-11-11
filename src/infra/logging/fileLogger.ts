import { appendFileSync, readdirSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { sanitize } from '../../core/audit/sanitize'
import type { Logger, LogLevel } from '../../core/logging'

const FILE_PATTERN = /^totem-(\d{4}-\d{2}-\d{2})\.log$/

export interface FileLoggerOptions {
  retentionDays: number
  /** Replica los mensajes en la consola (desarrollo). */
  echo: boolean
}

/**
 * Archivo de diagnóstico diario en formato JSON por línea, con rotación por antigüedad.
 * Escribe de forma síncrona para no perder eventos ante un cierre inesperado.
 */
export class FileLogger implements Logger {
  constructor(
    private readonly dir: string,
    private readonly options: FileLoggerOptions
  ) {}

  log(level: LogLevel, message: string, data?: Record<string, unknown>): void {
    const now = new Date()
    const entry = { t: now.toISOString(), level, message, ...(data ? { data: sanitize(data) } : {}) }
    try {
      appendFileSync(join(this.dir, `totem-${now.toISOString().slice(0, 10)}.log`), JSON.stringify(entry) + '\n', 'utf8')
    } catch {
      // Sin disco disponible no hay otro destino; la aplicación debe continuar.
    }
    if (this.options.echo) {
      const write = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log
      write(`[${level}] ${message}`, entry.data ?? '')
    }
  }

  /** Elimina archivos más antiguos que el período de retención. Devuelve cuántos eliminó. */
  purgeOld(now: Date = new Date()): number {
    const limit = now.getTime() - this.options.retentionDays * 24 * 60 * 60 * 1000
    let removed = 0
    for (const name of readdirSync(this.dir)) {
      const match = FILE_PATTERN.exec(name)
      if (!match || Date.parse(`${match[1]}T00:00:00Z`) >= limit) continue
      try {
        unlinkSync(join(this.dir, name))
        removed++
      } catch {
        // Un archivo bloqueado se reintentará en la próxima limpieza.
      }
    }
    return removed
  }
}
