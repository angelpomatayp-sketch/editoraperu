import { parsePhotoHole } from '../../../shared/compositionPlan'
import type { DatabaseSync } from 'node:sqlite'
import type {
  CaptureRepository,
  ParticipationForCapture,
  StoredImage
} from '../../../core/capture/captureService'
import { campaignConfigSchema, normalizeSelections } from '../../../shared/campaign'
import type { LayerResource } from '../../../shared/compositionPlan'

export class SqliteCaptureRepository implements CaptureRepository {
  constructor(private readonly db: DatabaseSync) {}

  loadParticipation(participationId: string): ParticipationForCapture | null {
    const row = this.db
      .prepare(
        `SELECT p.id, p.status, p.campaign_id, p.selections_json, c.config_json
         FROM participations p JOIN campaigns c ON c.id = p.campaign_id
         WHERE p.id = ?`
      )
      .get(participationId) as
      | { id: string; status: string; campaign_id: string; selections_json: string; config_json: string }
      | undefined
    if (!row) return null

    const config = campaignConfigSchema.safeParse(JSON.parse(row.config_json))
    if (!config.success) return null

    // Incluye recursos ya desactivados: una sesión en curso puede terminar con su configuración (RF-EXP-007).
    const resources = this.db
      .prepare(
        `SELECT r.id, r.type, r.file_path, r.animation_path, r.width, r.height, r.photo_hole_json, cr.layer_order, cr.pos_x, cr.pos_y, cr.scale
         FROM campaign_resources cr JOIN resources r ON r.id = cr.resource_id
         WHERE cr.campaign_id = ? AND r.status <> 'archived'
         ORDER BY cr.layer_order, cr.sort_order`
      )
      .all(row.campaign_id) as {
      id: string
      type: LayerResource['type']
      file_path: string
      animation_path: string | null
      width: number
      height: number
      layer_order: number
      pos_x: number
      pos_y: number
      scale: number
      photo_hole_json: string | null
    }[]

    return {
      id: row.id,
      status: row.status,
      campaignId: row.campaign_id,
      selections: normalizeSelections(JSON.parse(row.selections_json)),
      config: config.data,
      resources: resources.map((r) => ({
        id: r.id,
        type: r.type,
        src: r.file_path,
        width: r.width,
        height: r.height,
        layerOrder: r.layer_order,
        posX: r.pos_x,
        posY: r.pos_y,
        scale: r.scale,
        photoHole: r.type === 'scenario' ? parsePhotoHole(r.photo_hole_json) : null,
        preserveFrame: r.type === 'character' && r.animation_path !== null
      }))
    }
  }

  insertPhoto(
    photo: { id: string; participationId: string; kind: 'original' | 'final'; status: 'captured' | 'composed' } & StoredImage
  ): void {
    const now = new Date().toISOString()
    this.db
      .prepare(
        `INSERT INTO photos (id, participation_id, kind, file_path, format, width, height, size_bytes, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        photo.id,
        photo.participationId,
        photo.kind,
        photo.filePath,
        photo.format,
        photo.width,
        photo.height,
        photo.sizeBytes,
        photo.status,
        now,
        now
      )
  }

  markPhotoDeleted(photoId: string): void {
    const now = new Date().toISOString()
    this.db
      .prepare(`UPDATE photos SET status = 'deleted', file_path = NULL, updated_at = ? WHERE id = ?`)
      .run(now, photoId)
  }

  setParticipationStatus(participationId: string, status: 'registered' | 'captured' | 'composed'): void {
    this.db
      .prepare(`UPDATE participations SET status = ?, updated_at = ? WHERE id = ?`)
      .run(status, new Date().toISOString(), participationId)
  }
}
