/**
 * Acción reservada para el personal (RF-KIO-003): varios toques seguidos en la esquina
 * superior izquierda. No es una medida de seguridad por sí sola; la salida exige autenticación.
 */
export const RESERVED_TAPS = 5
export const RESERVED_WINDOW_MS = 3000

/** Registra un toque y devuelve los toques vigentes y si se completó la secuencia. */
export function registerReservedTap(previous: number[], now: number): { taps: number[]; triggered: boolean } {
  const taps = [...previous.filter((t) => now - t <= RESERVED_WINDOW_MS), now]
  if (taps.length >= RESERVED_TAPS) return { taps: [], triggered: true }
  return { taps, triggered: false }
}
