export type InactivityPhase = 'active' | 'warning' | 'timeout'

export interface InactivityTimers {
  /** Tiempo sin interacción antes de mostrar la advertencia. */
  warningAfterMs: number
  /** Duración de la cuenta regresiva de la advertencia antes de cancelar. */
  cancelAfterMs: number
}

/** Fase de inactividad según el tiempo transcurrido desde la última interacción (RF-SES-002). */
export function inactivityPhase(idleMs: number, timers: InactivityTimers): InactivityPhase {
  if (idleMs < timers.warningAfterMs) return 'active'
  if (idleMs < timers.warningAfterMs + timers.cancelAfterMs) return 'warning'
  return 'timeout'
}

/** Segundos restantes de la cuenta regresiva de advertencia, redondeados hacia arriba. */
export function secondsUntilTimeout(idleMs: number, timers: InactivityTimers): number {
  const remaining = timers.warningAfterMs + timers.cancelAfterMs - idleMs
  return Math.max(0, Math.ceil(remaining / 1000))
}
