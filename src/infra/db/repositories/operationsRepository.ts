import type { DatabaseSync, SQLInputValue } from 'node:sqlite'
import type { AuditFilters, ParticipationFilters } from '../../../shared/admin'

export interface ParticipationBaseRow {
  id: string
  campaign_id: string
  campaign_name: string
  status: string
  started_at: string
  confirmed_at: string | null
  finished_at: string | null
  first_names: string | null
  last_names: string | null
  document_number: string | null
  selections_json: string
  photo_status: string
}

export interface PhotoRow {
  id: string
  kind: 'original' | 'final'
  status: string
  file_path: string | null
  width: number | null
  height: number | null
  created_at: string
  published_at: string | null
  expires_at: string | null
  public_token: string | null
  public_url: string | null
  queue_status: string | null
  queue_attempts: number | null
  queue_error: string | null
}

/** Estado de la fotografía de una participación, derivado de sus fotos (RF-FOT-002). */
const PHOTO_STATUS = `COALESCE(
  (SELECT CASE WHEN f.status = 'published' AND f.expires_at <= ? THEN 'expired' ELSE f.status END
     FROM photos f WHERE f.participation_id = p.id AND f.kind = 'final' AND f.status <> 'deleted'
     ORDER BY f.created_at DESC LIMIT 1),
  (SELECT 'captured' FROM photos o WHERE o.participation_id = p.id AND o.kind = 'original' AND o.status <> 'deleted' LIMIT 1),
  (SELECT 'deleted' FROM photos d WHERE d.participation_id = p.id LIMIT 1),
  'none')`

/** Consultas de operación: participaciones, fotografías, reportes y bitácora. */
export class OperationsRepository {
  constructor(private readonly db: DatabaseSync) {}

  private base(filters: ParticipationFilters, nowIso: string): { sql: string; params: SQLInputValue[] } {
    const where: string[] = []
    const params: SQLInputValue[] = []
    if (filters.from) where.push('started_at >= ?'), params.push(filters.from)
    if (filters.to) where.push('started_at < ?'), params.push(filters.to)
    if (filters.campaignId) where.push('campaign_id = ?'), params.push(filters.campaignId)
    if (filters.status) where.push('status = ?'), params.push(filters.status)
    if (filters.photoStatus) where.push('photo_status = ?'), params.push(filters.photoStatus)
    if (filters.dni) where.push('document_number = ?'), params.push(filters.dni)
    const sql = `WITH base AS (
        SELECT p.id, p.campaign_id, c.name AS campaign_name, p.status, p.started_at, p.confirmed_at, p.finished_at,
               p.first_names, p.last_names, p.document_number, p.selections_json, ${PHOTO_STATUS} AS photo_status
        FROM participations p JOIN campaigns c ON c.id = p.campaign_id)
      SELECT * FROM base ${where.length ? `WHERE ${where.join(' AND ')}` : ''}`
    return { sql, params: [nowIso, ...params] }
  }

  listParticipations(filters: ParticipationFilters, nowIso: string, limit: number, offset: number): { rows: ParticipationBaseRow[]; total: number } {
    const { sql, params } = this.base(filters, nowIso)
    const total = (this.db.prepare(`SELECT COUNT(*) AS n FROM (${sql})`).get(...params) as { n: number }).n
    const rows = this.db.prepare(`${sql} ORDER BY started_at DESC LIMIT ? OFFSET ?`).all(...params, limit, offset) as unknown as ParticipationBaseRow[]
    return { rows, total }
  }

  allParticipations(filters: ParticipationFilters, nowIso: string): ParticipationBaseRow[] {
    const { sql, params } = this.base(filters, nowIso)
    return this.db.prepare(`${sql} ORDER BY started_at`).all(...params) as unknown as ParticipationBaseRow[]
  }

  getParticipation(id: string, nowIso: string): ParticipationBaseRow | null {
    const { sql, params } = this.base({ from: null, to: null, campaignId: null, status: null, photoStatus: null, dni: null }, nowIso)
    return (this.db.prepare(`SELECT * FROM (${sql}) WHERE id = ?`).get(...params, id) as ParticipationBaseRow | undefined) ?? null
  }

  consents(participationId: string): { title: string; type: string; version: string; accepted: number; recorded_at: string }[] {
    return this.db
      .prepare(
        `SELECT cv.title, cv.type, cv.version, c.accepted, c.recorded_at
         FROM consents c JOIN consent_versions cv ON cv.id = c.consent_version_id
         WHERE c.participation_id = ? ORDER BY cv.type`
      )
      .all(participationId) as { title: string; type: string; version: string; accepted: number; recorded_at: string }[]
  }

  photos(participationId: string): PhotoRow[] {
    return this.db
      .prepare(
        `SELECT p.id, p.kind, p.status, p.file_path, p.width, p.height, p.created_at, p.published_at, p.expires_at, p.public_token,
                q.status AS queue_status, q.attempts AS queue_attempts, q.last_error AS queue_error
         FROM photos p LEFT JOIN publication_queue q ON q.photo_id = p.id
         WHERE p.participation_id = ? ORDER BY p.created_at`
      )
      .all(participationId) as unknown as PhotoRow[]
  }

  photo(photoId: string): (PhotoRow & { participation_id: string }) | null {
    return (
      (this.db
        .prepare(
          `SELECT p.*, q.status AS queue_status, q.attempts AS queue_attempts, q.last_error AS queue_error
           FROM photos p LEFT JOIN publication_queue q ON q.photo_id = p.id WHERE p.id = ?`
        )
        .get(photoId) as (PhotoRow & { participation_id: string }) | undefined) ?? null
    )
  }

  resourceNames(ids: string[]): Map<string, string> {
    if (ids.length === 0) return new Map()
    const rows = this.db.prepare(`SELECT id, name FROM resources WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids) as { id: string; name: string }[]
    return new Map(rows.map((r) => [r.id, r.name]))
  }

  /** Vuelve a poner en cola una publicación fallida o pendiente (RF-FOT-003). */
  requeue(photoId: string, nowIso: string): boolean {
    const result = this.db
      .prepare(
        `UPDATE publication_queue SET status = 'pending', attempts = 0, next_attempt_at = ?, updated_at = ?
         WHERE photo_id = ? AND status IN ('pending', 'failed')`
      )
      .run(nowIso, nowIso, photoId)
    if (Number(result.changes) === 0) return false
    this.db.prepare(`UPDATE photos SET status = 'pending', updated_at = ? WHERE id = ?`).run(nowIso, photoId)
    return true
  }

  markPhotoDeleted(photoId: string, nowIso: string): void {
    this.db.prepare(`UPDATE photos SET status = 'deleted', file_path = NULL, updated_at = ? WHERE id = ?`).run(nowIso, photoId)
    this.db.prepare(`UPDATE publication_queue SET status = 'cancelled', updated_at = ? WHERE photo_id = ? AND status <> 'done'`).run(nowIso, photoId)
  }

  /** Limpiar el archivo local no invalida un QR que aún vive en el servidor. */
  markLocalPhotoPurged(photoId: string, nowIso: string): void {
    const kept = this.db.prepare(`UPDATE photos SET file_path = NULL, updated_at = ?
      WHERE id = ? AND kind = 'final' AND status = 'published' AND expires_at > ?`).run(nowIso, photoId, nowIso)
    if (!Number(kept.changes)) this.markPhotoDeleted(photoId, nowIso)
  }

  /** Elimina nombres y DNI conservando la constancia técnica de la participación (RF-PAR-005). */
  anonymize(participationId: string, nowIso: string): void {
    this.db
      .prepare(
        `UPDATE participations SET first_names = NULL, last_names = NULL, document_number = NULL, status = 'anonymized', updated_at = ?
         WHERE id = ?`
      )
      .run(nowIso, participationId)
  }

  // ----- Conservación (RF-FOT-005) -----

  photosOlderThan(cutoffIso: string): { id: string; file_path: string }[] {
    return this.db
      .prepare(
        `SELECT ph.id, ph.file_path FROM photos ph JOIN participations p ON p.id = ph.participation_id
         WHERE ph.file_path IS NOT NULL AND p.finished_at IS NOT NULL AND ph.created_at < ?
           AND ph.status <> 'deleted'
           AND NOT EXISTS (SELECT 1 FROM publication_queue q WHERE q.photo_id = ph.id AND q.status = 'in_progress')`
      )
      .all(cutoffIso) as { id: string; file_path: string }[]
  }

  warnPhotoRetention(cutoffIso: string, nowIso: string): number {
    let count = 0
    for (const photo of this.photosOlderThan(cutoffIso)) {
      count += Number(this.db.prepare('INSERT OR IGNORE INTO photo_retention_notices (photo_id, warned_at) VALUES (?, ?)').run(photo.id, nowIso).changes)
    }
    return count
  }

  wasWarnedBefore(photoId: string, cutoffIso: string): boolean {
    return Boolean(this.db.prepare('SELECT 1 FROM photo_retention_notices WHERE photo_id = ? AND warned_at <= ?').get(photoId, cutoffIso))
  }

  participationsWithPersonalDataOlderThan(cutoffIso: string): string[] {
    return (
      this.db
        .prepare(`SELECT id FROM participations WHERE document_number IS NOT NULL AND started_at < ?`)
        .all(cutoffIso) as { id: string }[]
    ).map((r) => r.id)
  }

  // ----- Bitácora (8.19) -----

  audit(filters: AuditFilters, categories: string[] | null, limit: number, offset: number) {
    const where: string[] = []
    const params: SQLInputValue[] = []
    if (filters.from) where.push('occurred_at >= ?'), params.push(filters.from)
    if (filters.to) where.push('occurred_at < ?'), params.push(filters.to)
    if (filters.level) where.push('level = ?'), params.push(filters.level)
    if (filters.category) where.push('category = ?'), params.push(filters.category)
    if (filters.result) where.push('result = ?'), params.push(filters.result)
    if (categories) where.push(`category IN (${categories.map(() => '?').join(',')})`), params.push(...categories)
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : ''
    const total = (this.db.prepare(`SELECT COUNT(*) AS n FROM audit_events ${clause}`).get(...params) as { n: number }).n
    const rows = this.db
      .prepare(`SELECT * FROM audit_events ${clause} ORDER BY id DESC LIMIT ? OFFSET ?`)
      .all(...params, limit, offset) as {
      id: number
      occurred_at: string
      level: string
      category: string
      action: string
      result: string
      actor_type: string
      actor_id: string | null
      entity_type: string | null
      entity_id: string | null
      detail_json: string | null
    }[]
    return { rows, total }
  }

  usernames(ids: string[]): Map<string, string> {
    if (ids.length === 0) return new Map()
    const rows = this.db.prepare(`SELECT id, username FROM users WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids) as { id: string; username: string }[]
    return new Map(rows.map((r) => [r.id, r.username]))
  }

  campaignNames(): { id: string; name: string }[] {
    return this.db.prepare('SELECT id, name FROM campaigns ORDER BY name').all() as { id: string; name: string }[]
  }

  auditCategories(): string[] {
    return (this.db.prepare('SELECT DISTINCT category FROM audit_events ORDER BY category').all() as { category: string }[]).map((r) => r.category)
  }
}
