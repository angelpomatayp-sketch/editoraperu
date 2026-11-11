import { z } from 'zod'
import { PublicationError, type PublicationClient, type PublishedPhoto } from '../../core/publication/publicationClient'
import { signRequest } from './signature'

const UPLOAD_TIMEOUT_MS = 20_000
const HEALTH_TIMEOUT_MS = 5_000

const publishedSchema = z.object({ token: z.string().min(1), url: z.url(), expiresAt: z.string().min(1) })

/** Cliente HTTPS del servicio de publicación con solicitudes firmadas (sección 20.4). */
export class HttpPublicationClient implements PublicationClient {
  private readonly base: URL

  constructor(
    baseUrl: string,
    private readonly secret: string,
    private readonly fetchImpl: typeof fetch = fetch
  ) {
    this.base = new URL(baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`)
  }

  /**
   * La foto viaja como formulario (multipart, campo `photo`), la forma de subir archivos que todos los
   * hostings entregan a PHP; algunos descartan los cuerpos en bruto. La firma cubre los bytes del JPEG.
   */
  async upload(photoId: string, jpeg: Uint8Array): Promise<PublishedPhoto> {
    const form = new FormData()
    form.append('photo', new Blob([jpeg as Uint8Array<ArrayBuffer>], { type: 'image/jpeg' }), 'foto.jpg')
    const response = await this.request('POST', 'api/v1/photos', jpeg, UPLOAD_TIMEOUT_MS, { 'X-Idempotency-Key': photoId }, form)
    if (response.status >= 500) throw new PublicationError('server', `HTTP ${response.status}`)
    if (response.status !== 200 && response.status !== 201) throw new PublicationError('rejected', `HTTP ${response.status}`)
    const parsed = publishedSchema.safeParse(await response.json().catch(() => null))
    if (!parsed.success) throw new PublicationError('server', 'Respuesta inesperada')
    return parsed.data
  }

  async remove(photoId: string): Promise<void> {
    const response = await this.request('DELETE', `api/v1/photos/${encodeURIComponent(photoId)}`, new Uint8Array(), HEALTH_TIMEOUT_MS, {})
    if (response.status >= 500) throw new PublicationError('server', `HTTP ${response.status}`)
    if (response.status !== 204) throw new PublicationError('rejected', `HTTP ${response.status}`)
  }

  async health(): Promise<boolean> {
    try {
      const response = await this.fetchImpl(new URL('api/v1/health', this.base), {
        signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS)
      })
      return response.ok
    } catch {
      return false
    }
  }

  /** `signed`: bytes que cubre la firma; `payload`: lo que se envía (si falta, nada). */
  private async request(
    method: string,
    relativePath: string,
    signed: Uint8Array,
    timeoutMs: number,
    headers: Record<string, string>,
    payload?: FormData
  ): Promise<Response> {
    const url = new URL(relativePath, this.base)
    const timestamp = Math.floor(Date.now() / 1000).toString()
    try {
      return await this.fetchImpl(url, {
        method,
        body: payload,
        headers: {
          ...headers,
          'X-Totem-Timestamp': timestamp,
          'X-Totem-Signature': signRequest(this.secret, method, url.pathname, timestamp, signed)
        },
        signal: AbortSignal.timeout(timeoutMs)
      })
    } catch (error) {
      throw new PublicationError('network', error instanceof Error ? error.message : 'Sin conexión')
    }
  }
}
