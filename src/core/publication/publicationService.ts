import type { PublishFailure, PublishResult } from '../../shared/publication'
import type { Settings } from '../../shared/settings'
import type { AuditLog } from '../audit/auditLog'
import type { SessionService } from '../session/sessionService'
import { PublicationError, type PublicationClient, type PublishedPhoto } from './publicationClient'

export interface FinalPhoto {
  id: string
  /** Ruta relativa a la carpeta de datos. */
  filePath: string
  status: string
  publicUrl: string | null
  expiresAt: string | null
}

export interface QueueItem {
  photoId: string
  filePath: string
  attempts: number
}

export interface PublicationRepository {
  /** Última fotografía final vigente de la participación. */
  finalPhotoFor(participationId: string): FinalPhoto | null
  /** Agrega la fotografía a la cola si no estaba; la marca como pendiente (RF-QR-008). */
  enqueue(photoId: string, nowIso: string): void
  /** Toma el elemento para publicarlo; `false` si ya está en curso o publicado (evita duplicados). */
  claim(photoId: string, nowIso: string): QueueItem | null
  markPublished(photoId: string, published: PublishedPhoto, nowIso: string): void
  markFailedAttempt(photoId: string, error: string, nextAttemptIso: string, giveUp: boolean, nowIso: string): void
  /** Elementos pendientes cuyo próximo intento ya venció; con `all`, todos los pendientes. */
  due(nowIso: string, all?: boolean): string[]
  /** Tras un cierre inesperado, lo que quedó en curso vuelve a pendiente (RF-RED-003). */
  releaseInterrupted(nowIso: string): number
}

export interface PublicationDeps {
  sessions: SessionService
  repository: PublicationRepository
  readFile: (filePath: string) => Promise<Uint8Array>
  /** Cliente del servicio configurado, o `null` si la publicación no está configurada. */
  client: () => PublicationClient | null
  qr: (url: string) => Promise<string>
  settings: () => Settings
  audit: AuditLog
  now?: () => Date
}

/**
 * Publicación de la fotografía final y QR (8.10). La publicación pasa siempre por una cola
 * persistente: si falla, la fotografía queda guardada localmente y se reintenta según la
 * configuración, sin duplicar publicaciones (RF-QR-008, RF-QR-009, RF-RED-003).
 */
export class PublicationService {
  private processing = false
  private readonly now: () => Date

  constructor(private readonly deps: PublicationDeps) {
    this.now = deps.now ?? (() => new Date())
  }

  async publish(sessionId: string): Promise<PublishResult> {
    const participationId = this.deps.sessions.get(sessionId)?.participationId
    if (!participationId) return { ok: false, reason: 'session_invalid' }
    const photo = this.deps.repository.finalPhotoFor(participationId)
    if (!photo) return { ok: false, reason: 'no_photo' }

    if (photo.status === 'published' && photo.publicUrl && photo.expiresAt && photo.expiresAt > this.nowIso()) {
      return { ok: true, qrDataUrl: await this.deps.qr(photo.publicUrl), expiresAt: photo.expiresAt }
    }

    this.deps.repository.enqueue(photo.id, this.nowIso())
    const client = this.deps.client()
    if (!client) {
      this.record('warn', 'publish', 'skipped', photo.id, { reason: 'not_configured' })
      return { ok: false, reason: 'not_configured' }
    }

    const outcome = await this.attempt(client, photo.id)
    if (!outcome.ok) return { ok: false, reason: outcome.reason }
    return { ok: true, qrDataUrl: await this.deps.qr(outcome.published.url), expiresAt: outcome.published.expiresAt }
  }

  /**
   * Reintenta las publicaciones pendientes cuyo plazo venció (RF-QR-009). Con `immediately`
   * (al recuperar la conexión) reintenta todas las pendientes sin esperar su intervalo.
   */
  async processQueue(options: { immediately?: boolean } = {}): Promise<{ published: number; failed: number }> {
    const result = { published: 0, failed: 0 }
    const client = this.deps.client()
    if (!client || this.processing) return result
    this.processing = true
    try {
      for (const photoId of this.deps.repository.due(this.nowIso(), options.immediately)) {
        const outcome = await this.attempt(client, photoId)
        if (outcome.ok) result.published++
        else result.failed++
      }
    } finally {
      this.processing = false
    }
    return result
  }

  recoverInterrupted(): number {
    return this.deps.repository.releaseInterrupted(this.nowIso())
  }

  private async attempt(
    client: PublicationClient,
    photoId: string
  ): Promise<{ ok: true; published: PublishedPhoto } | { ok: false; reason: PublishFailure }> {
    const item = this.deps.repository.claim(photoId, this.nowIso())
    if (!item) return { ok: false, reason: 'offline' }

    try {
      const published = await client.upload(photoId, await this.deps.readFile(item.filePath))
      this.deps.repository.markPublished(photoId, published, this.nowIso())
      this.record('info', 'publish', 'ok', photoId, { attempt: item.attempts + 1, expiresAt: published.expiresAt })
      return { ok: true, published }
    } catch (error) {
      const kind = error instanceof PublicationError ? error.kind : 'server'
      const { maxRetries, retryIntervalSeconds } = this.deps.settings().publication
      const attempts = item.attempts + 1
      const giveUp = attempts > maxRetries
      const next = new Date(this.now().getTime() + retryIntervalSeconds * 1000).toISOString()
      this.deps.repository.markFailedAttempt(photoId, kind, next, giveUp, this.nowIso())
      this.record(giveUp ? 'error' : 'warn', 'publish', 'fail', photoId, { kind, attempt: attempts, giveUp })
      return { ok: false, reason: kind === 'rejected' ? 'rejected' : 'offline' }
    }
  }

  private nowIso(): string {
    return this.now().toISOString()
  }

  private record(level: 'info' | 'warn' | 'error', action: string, result: 'ok' | 'fail' | 'skipped', photoId: string, detail: Record<string, unknown>): void {
    this.deps.audit.record({ level, category: 'publication', action, result, entity: { type: 'photo', id: photoId }, detail })
  }
}
