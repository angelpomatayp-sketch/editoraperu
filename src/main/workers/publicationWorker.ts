import type { AppContext } from '../bootstrap'

const CHECK_INTERVAL_MS = 30_000

/**
 * Comprueba periódicamente el acceso al servicio externo y, con conexión, reintenta las
 * publicaciones pendientes cuyo plazo venció (RF-RED-001, RF-QR-009). Devuelve la función para detenerlo.
 */
export function startPublicationWorker(context: AppContext): () => void {
  const tick = () => {
    void context.connectivity.check().then((state) => {
      if (state === 'online') void context.publication.processQueue()
    })
  }
  tick()
  const timer = setInterval(tick, CHECK_INTERVAL_MS)
  return () => clearInterval(timer)
}
