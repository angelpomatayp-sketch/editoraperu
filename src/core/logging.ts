export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

/** Registro técnico de diagnóstico. Las implementaciones nunca deben lanzar excepciones. */
export interface Logger {
  log(level: LogLevel, message: string, data?: Record<string, unknown>): void
}
