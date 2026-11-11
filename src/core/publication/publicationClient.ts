export interface PublishedPhoto {
  token: string
  url: string
  expiresAt: string
}

/**
 * `network`: sin conexión o sin respuesta; `rejected`: el servicio rechazó la solicitud (4xx);
 * `server`: error del servicio (5xx). Todas se reintentan según la configuración.
 */
export class PublicationError extends Error {
  constructor(
    readonly kind: 'network' | 'rejected' | 'server',
    message: string
  ) {
    super(message)
    this.name = 'PublicationError'
  }
}

export interface PublicationClient {
  /** Publica la fotografía; repetir con el mismo identificador devuelve la misma publicación. */
  upload(photoId: string, jpeg: Uint8Array): Promise<PublishedPhoto>
  /** Comprueba el acceso real al servicio externo (RF-RED-001). */
  health(): Promise<boolean>
  /** Elimina la copia publicada antes de su vencimiento (RF-PAR-005). */
  remove(photoId: string): Promise<void>
}
