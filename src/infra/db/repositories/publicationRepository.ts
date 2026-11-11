import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { PublishedPhoto } from '../../../core/publication/publicationClient'
import type { FinalPhoto, PublicationRepository, QueueItem } from '../../../core/publication/publicationService'

export class SqlitePublicationRepository implements PublicationRepository {
  constructor(private readonly db: DatabaseSync) {}

  finalPhotoFor(participationId: string): FinalPhoto | null {
    const row = this.db
      .prepare(
        `SELECT id, file_path, status, public_url, expires_at FROM photos
         WHERE participation_id = ? AND kind = 'final' AND status <> 'deleted' AND file_path IS NOT NULL
         ORDER BY created_at DESC LIMIT 1`
      )
      .get(participationId) as
      | { id: string; file_path: string; status: string; public_url: string | null; expires_at: string | null }
      | undefined
    return row
      ? { id: row.id, filePath: row.file_path, status: row.status, publicUrl: row.public_url, expiresAt: row.expires_at }
      : null
  }

  enqueue(photoId: string, nowIso: string): void {
    // La clave de idempotencia es el identificador de la fotografía: el servicio no la duplica.
    this.db
      .prepare(
        `INSERT OR IGNORE INTO publication_queue (id, photo_id, idempotency_key, status, attempts, next_attempt_at, created_at, updated_at)
         VALUES (?, ?, ?, 'pending', 0, ?, ?, ?)`
      )
      .run(randomUUID(), photoId, photoId, nowIso, nowIso, nowIso)
    this.db
      .prepare(`UPDATE photos SET status = 'pending', updated_at = ? WHERE id = ? AND status IN ('composed', 'failed')`)
      .run(nowIso, photoId)
  }

  claim(photoId: string, nowIso: string): QueueItem | null {
    const changed = this.db
      .prepare(
        `UPDATE publication_queue SET status = 'in_progress', updated_at = ?
         WHERE photo_id = ? AND status IN ('pending', 'failed')`
      )
      .run(nowIso, photoId)
    if (Number(changed.changes) === 0) return null
    const row = this.db
      .prepare(
        `SELECT q.photo_id, q.attempts, p.file_path FROM publication_queue q JOIN photos p ON p.id = q.photo_id
         WHERE q.photo_id = ?`
      )
      .get(photoId) as { photo_id: string; attempts: number; file_path: string | null }
    if (!row.file_path) {
      this.db.prepare(`UPDATE publication_queue SET status = 'cancelled', updated_at = ? WHERE photo_id = ?`).run(nowIso, photoId)
      return null
    }
    return { photoId: row.photo_id, filePath: row.file_path, attempts: row.attempts }
  }

  markPublished(photoId: string, published: PublishedPhoto, nowIso: string): void {
    this.db.exec('BEGIN')
    try {
      this.db
        .prepare(
          `UPDATE photos SET status = 'published', public_token = ?, public_url = ?, published_at = ?, expires_at = ?, updated_at = ?
           WHERE id = ?`
        )
        .run(published.token, published.url, nowIso, published.expiresAt, nowIso, photoId)
      this.db
        .prepare(
          `UPDATE publication_queue SET status = 'done', attempts = attempts + 1, last_error = NULL, updated_at = ?
           WHERE photo_id = ?`
        )
        .run(nowIso, photoId)
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  markFailedAttempt(photoId: string, error: string, nextAttemptIso: string, giveUp: boolean, nowIso: string): void {
    this.db
      .prepare(
        `UPDATE publication_queue SET status = ?, attempts = attempts + 1, last_error = ?, next_attempt_at = ?, updated_at = ?
         WHERE photo_id = ?`
      )
      .run(giveUp ? 'failed' : 'pending', error, nextAttemptIso, nowIso, photoId)
    this.db
      .prepare(`UPDATE photos SET status = ?, updated_at = ? WHERE id = ?`)
      .run(giveUp ? 'failed' : 'pending', nowIso, photoId)
  }

  due(nowIso: string, all = false): string[] {
    const rows = this.db
      .prepare(
        `SELECT photo_id FROM publication_queue WHERE status = 'pending' AND (? = 1 OR next_attempt_at <= ?)
         ORDER BY next_attempt_at LIMIT 20`
      )
      .all(all ? 1 : 0, nowIso) as { photo_id: string }[]
    return rows.map((r) => r.photo_id)
  }

  releaseInterrupted(nowIso: string): number {
    const result = this.db
      .prepare(`UPDATE publication_queue SET status = 'pending', updated_at = ? WHERE status = 'in_progress'`)
      .run(nowIso)
    return Number(result.changes)
  }
}
