import type { DatabaseSync } from 'node:sqlite'
import type { MediaRecord, MediaRepository } from '../../../core/media/attractService'

export class SqliteMediaRepository implements MediaRepository {
  constructor(private readonly db: DatabaseSync) {}

  listPlayable(nowIso: string): MediaRecord[] {
    const rows = this.db
      .prepare(
        `SELECT id, type, name, file_path, display_seconds
         FROM media_items
         WHERE status = 'active'
           AND (starts_at IS NULL OR starts_at <= ?)
           AND (ends_at IS NULL OR ends_at > ?)
         ORDER BY sort_order, name`
      )
      .all(nowIso, nowIso) as {
      id: string
      type: 'image' | 'video'
      name: string
      file_path: string
      display_seconds: number | null
    }[]
    return rows.map((r) => ({
      id: r.id,
      type: r.type,
      name: r.name,
      filePath: r.file_path,
      displaySeconds: r.display_seconds
    }))
  }
}
