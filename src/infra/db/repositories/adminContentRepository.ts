import type { FractionRect } from '../../../shared/compositionPlan'
import type { DatabaseSync } from 'node:sqlite'

export type ResourceType = 'scenario' | 'character' | 'frame' | 'logo' | 'other'
export type CampaignStatus = 'draft' | 'active' | 'inactive' | 'archived'

export interface CampaignRow {
  id: string
  code: string
  name: string
  description: string | null
  image_path: string | null
  status: CampaignStatus
  starts_at: string | null
  ends_at: string | null
  config_json: string
  config_version: number
}

export interface ResourceRow {
  id: string
  type: ResourceType
  name: string
  file_path: string
  animation_path: string | null
  animation_format: string | null
  animation_size_bytes: number | null
  animation_duration_ms: number | null
  animation_background: 'alpha' | 'chroma' | 'segmentation'
  entry_direction: 'auto' | 'left' | 'right'
  content_bounds_json: string | null
  anchor_x: number
  anchor_y: number
  character_analysis_checked: number
  width: number
  height: number
  status: 'active' | 'inactive' | 'archived'
  layer_order: number
  pos_x: number
  pos_y: number
  scale: number
  sort_order: number
  is_required: number
  photo_hole_json: string | null
}

export interface MediaRow {
  id: string
  type: 'image' | 'video'
  name: string
  file_path: string
  display_seconds: number | null
  sort_order: number
  status: 'active' | 'inactive' | 'archived'
}

/** Operaciones de la administración de contenido sobre la base local. */
export class AdminContentRepository {
  constructor(private readonly db: DatabaseSync) {}

  transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const result = fn()
      this.db.exec('COMMIT')
      return result
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  // ----- Campañas -----

  listCampaigns(): (CampaignRow & { scenarios: number; participations: number })[] {
    return this.db
      .prepare(
        `SELECT c.*,
           (SELECT COUNT(*) FROM campaign_resources cr JOIN resources r ON r.id = cr.resource_id
             WHERE cr.campaign_id = c.id AND r.type = 'scenario' AND r.status = 'active') AS scenarios,
           (SELECT COUNT(*) FROM participations p WHERE p.campaign_id = c.id) AS participations
         FROM campaigns c ORDER BY CASE c.status WHEN 'archived' THEN 1 ELSE 0 END, c.name`
      )
      .all() as unknown as (CampaignRow & { scenarios: number; participations: number })[]
  }

  getCampaign(id: string): CampaignRow | null {
    return (this.db.prepare('SELECT * FROM campaigns WHERE id = ?').get(id) as CampaignRow | undefined) ?? null
  }

  countParticipations(campaignId: string): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM participations WHERE campaign_id = ?').get(campaignId) as { n: number }).n
  }

  insertCampaign(c: { id: string; code: string; name: string; configJson: string }, now: string): void {
    this.db
      .prepare(
        `INSERT INTO campaigns (id, code, name, description, status, config_json, config_version, created_at, updated_at)
         VALUES (?, ?, ?, '', 'draft', ?, 1, ?, ?)`
      )
      .run(c.id, c.code, c.name, c.configJson, now, now)
  }

  updateCampaign(
    id: string,
    f: { name: string; description: string; startsAt: string | null; endsAt: string | null; configJson: string },
    now: string
  ): void {
    // La versión de configuración cambia solo si cambió la configuración (RF-CMP-003).
    this.db
      .prepare(
        `UPDATE campaigns SET name = ?, description = ?, starts_at = ?, ends_at = ?,
           config_version = config_version + CASE WHEN config_json = ? THEN 0 ELSE 1 END,
           config_json = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(f.name, f.description, f.startsAt, f.endsAt, f.configJson, f.configJson, now, id)
  }

  setCampaignStatus(id: string, status: CampaignStatus, now: string): void {
    this.db.prepare('UPDATE campaigns SET status = ?, updated_at = ? WHERE id = ?').run(status, now, id)
  }

  setCampaignImage(id: string, imagePath: string, now: string): void {
    this.db.prepare('UPDATE campaigns SET image_path = ?, updated_at = ? WHERE id = ?').run(imagePath, now, id)
  }

  // ----- Recursos de campaña -----

  /** Escenarios que aún no se revisaron en busca de zona transparente (subidos antes de existir la detección). */
  listUncheckedScenarios(): { id: string; file_path: string }[] {
    return this.db
      .prepare(`SELECT id, file_path FROM resources WHERE type = 'scenario' AND photo_hole_checked = 0 AND status <> 'archived'`)
      .all() as { id: string; file_path: string }[]
  }

  setPhotoHole(id: string, hole: FractionRect | null): void {
    this.db
      .prepare('UPDATE resources SET photo_hole_json = ?, photo_hole_checked = 1 WHERE id = ?')
      .run(hole ? JSON.stringify(hole) : null, id)
  }

  listUncheckedCharacters(): { id: string; file_path: string }[] {
    return this.db
      .prepare(`SELECT id, file_path FROM resources WHERE type = 'character' AND character_analysis_checked = 0 AND status <> 'archived'`)
      .all() as { id: string; file_path: string }[]
  }

  /** Personajes de video croma cuyas poses pueden requerir recalibración del verde. */
  listChromaCharacterPoses(): { id: string; file_path: string; animation_path: string }[] {
    return this.db
      .prepare(`SELECT id, file_path, animation_path FROM resources WHERE type = 'character' AND animation_background = 'chroma' AND animation_path IS NOT NULL AND status <> 'archived'`)
      .all() as { id: string; file_path: string; animation_path: string }[]
  }

  setCharacterAnalysis(id: string, bounds: FractionRect, anchorX: number, anchorY: number): void {
    this.db
      .prepare('UPDATE resources SET content_bounds_json = ?, anchor_x = ?, anchor_y = ?, character_analysis_checked = 1 WHERE id = ?')
      .run(JSON.stringify(bounds), anchorX, anchorY, id)
  }

  listResources(campaignId: string): ResourceRow[] {
    return this.db
      .prepare(
        `SELECT r.id, r.type, r.name, r.file_path, r.animation_path, r.animation_format, r.animation_size_bytes, r.animation_duration_ms, r.animation_background,
                r.entry_direction, r.content_bounds_json, r.anchor_x, r.anchor_y, r.character_analysis_checked,
                r.width, r.height, r.status, r.photo_hole_json,
                cr.layer_order, cr.pos_x, cr.pos_y, cr.scale, cr.sort_order, cr.is_required
         FROM campaign_resources cr JOIN resources r ON r.id = cr.resource_id
         WHERE cr.campaign_id = ? AND r.status <> 'archived'
         ORDER BY cr.sort_order, r.created_at`
      )
      .all(campaignId) as unknown as ResourceRow[]
  }

  scenarioLinks(campaignId: string): { scenario_id: string; character_id: string }[] {
    return this.db
      .prepare('SELECT scenario_id, character_id FROM scenario_characters WHERE campaign_id = ? ORDER BY sort_order')
      .all(campaignId) as { scenario_id: string; character_id: string }[]
  }

  nextSortOrder(campaignId: string): number {
    return (
      this.db.prepare('SELECT COALESCE(MAX(sort_order), 0) + 10 AS next FROM campaign_resources WHERE campaign_id = ?').get(campaignId) as {
        next: number
      }
    ).next
  }

  insertResource(
    r: {
      id: string
      campaignId: string
      type: ResourceType
      name: string
      filePath: string
      format: string
      width: number
      height: number
      sizeBytes: number
      layerOrder: number
      x: number
      y: number
      scale: number
      required: boolean
      sortOrder: number
      /** Escenarios: zona transparente ya revisada al subirlo (`null` si no tiene). */
      photoHole?: FractionRect | null
      characterAnalysis?: { bounds: FractionRect; anchorX: number; anchorY: number }
    },
    now: string
  ): void {
    const checked = r.type === 'scenario' && r.photoHole !== undefined
    this.db
      .prepare(
        `INSERT INTO resources (id, type, name, file_path, format, width, height, size_bytes, status, created_at, updated_at,
                                photo_hole_json, photo_hole_checked, content_bounds_json, anchor_x, anchor_y, character_analysis_checked)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        r.id, r.type, r.name, r.filePath, r.format, r.width, r.height, r.sizeBytes, now, now,
        r.photoHole ? JSON.stringify(r.photoHole) : null, checked ? 1 : 0,
        r.characterAnalysis ? JSON.stringify(r.characterAnalysis.bounds) : null,
        r.characterAnalysis?.anchorX ?? 0.5, r.characterAnalysis?.anchorY ?? 1,
        r.type === 'character' && r.characterAnalysis ? 1 : 0
      )
    this.db
      .prepare(
        `INSERT INTO campaign_resources (campaign_id, resource_id, layer_order, pos_x, pos_y, scale, is_required, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(r.campaignId, r.id, r.layerOrder, r.x, r.y, r.scale, r.required ? 1 : 0, r.sortOrder)
  }

  updateResource(id: string, name: string, status: 'active' | 'inactive', now: string): void {
    this.db.prepare('UPDATE resources SET name = ?, status = ?, updated_at = ? WHERE id = ?').run(name, status, now, id)
  }

  /** Sustituye solo la imagen; conserva identidad, estado, ubicación y asociaciones. */
  replaceScenarioImage(id: string, image: { filePath: string; format: string; width: number; height: number; sizeBytes: number }, hole: FractionRect | null, now: string): void {
    this.db.prepare(`UPDATE resources SET file_path = ?, format = ?, width = ?, height = ?, size_bytes = ?,
      photo_hole_json = ?, photo_hole_checked = 1, updated_at = ? WHERE id = ? AND type = 'scenario'`)
      .run(image.filePath, image.format, image.width, image.height, image.sizeBytes, hole ? JSON.stringify(hole) : null, now, id)
    this.db.prepare(`UPDATE campaigns SET config_version = config_version + 1, updated_at = ?
      WHERE id IN (SELECT campaign_id FROM campaign_resources WHERE resource_id = ?)`)
      .run(now, id)
  }

  setCharacterAnimation(
    id: string,
    filePath: string | null,
    format: string | null,
    sizeBytes: number | null,
    durationMs: number | null,
    background: 'alpha' | 'chroma' | 'segmentation',
    now: string
  ): void {
    this.db
      .prepare('UPDATE resources SET animation_path = ?, animation_format = ?, animation_size_bytes = ?, animation_duration_ms = ?, animation_background = ?, updated_at = ? WHERE id = ?')
      .run(filePath, format, sizeBytes, durationMs, background, now, id)
  }

  setCharacterMotion(id: string, direction: 'auto' | 'left' | 'right', anchorX: number, anchorY: number, now: string): void {
    this.db
      .prepare('UPDATE resources SET entry_direction = ?, anchor_x = ?, anchor_y = ?, character_analysis_checked = 1, updated_at = ? WHERE id = ?')
      .run(direction, anchorX, anchorY, now, id)
  }

  setCharacterScenarios(campaignId: string, characterId: string, scenarioIds: string[]): void {
    this.db.prepare('DELETE FROM scenario_characters WHERE campaign_id = ? AND character_id = ?').run(campaignId, characterId)
    const insert = this.db.prepare(
      `INSERT INTO scenario_characters (campaign_id, scenario_id, character_id, sort_order)
       VALUES (?, ?, ?, (SELECT sort_order FROM campaign_resources WHERE campaign_id = ? AND resource_id = ?))`
    )
    for (const scenarioId of scenarioIds) insert.run(campaignId, scenarioId, characterId, campaignId, characterId)
  }

  setPlacement(campaignId: string, resourceId: string, x: number, y: number, scale: number): void {
    this.db
      .prepare('UPDATE campaign_resources SET pos_x = ?, pos_y = ?, scale = ? WHERE campaign_id = ? AND resource_id = ?')
      .run(x, y, scale, campaignId, resourceId)
  }

  setSortOrder(campaignId: string, resourceId: string, sortOrder: number): void {
    this.db
      .prepare('UPDATE campaign_resources SET sort_order = ? WHERE campaign_id = ? AND resource_id = ?')
      .run(sortOrder, campaignId, resourceId)
    this.db
      .prepare('UPDATE scenario_characters SET sort_order = ? WHERE campaign_id = ? AND character_id = ?')
      .run(sortOrder, campaignId, resourceId)
  }

  /** Indica si alguna participación usó el recurso (RF-REC-006). */
  isResourceReferenced(resourceId: string): boolean {
    return Boolean(this.db.prepare('SELECT 1 FROM participations WHERE selections_json LIKE ? LIMIT 1').get(`%"${resourceId}"%`))
  }

  archiveResource(id: string, now: string): void {
    this.db.prepare("UPDATE resources SET status = 'archived', updated_at = ? WHERE id = ?").run(now, id)
  }

  deleteResource(campaignId: string, id: string): void {
    this.db.prepare('DELETE FROM scenario_characters WHERE campaign_id = ? AND (scenario_id = ? OR character_id = ?)').run(campaignId, id, id)
    this.db.prepare('DELETE FROM campaign_resources WHERE campaign_id = ? AND resource_id = ?').run(campaignId, id)
    this.db.prepare('DELETE FROM resources WHERE id = ? AND id NOT IN (SELECT resource_id FROM campaign_resources)').run(id)
  }

  // ----- Contenido de atracción -----

  listMedia(): MediaRow[] {
    return this.db
      .prepare(`SELECT id, type, name, file_path, display_seconds, sort_order, status FROM media_items WHERE status <> 'archived' ORDER BY sort_order, name`)
      .all() as unknown as MediaRow[]
  }

  getMedia(id: string): MediaRow | null {
    return (
      (this.db.prepare('SELECT id, type, name, file_path, display_seconds, sort_order, status FROM media_items WHERE id = ?').get(id) as
        | MediaRow
        | undefined) ?? null
    )
  }

  insertMedia(m: { id: string; type: 'image' | 'video'; name: string; filePath: string; displaySeconds: number | null }, now: string): void {
    this.db
      .prepare(
        `INSERT INTO media_items (id, type, name, file_path, display_seconds, sort_order, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, (SELECT COALESCE(MAX(sort_order), 0) + 10 FROM media_items), 'active', ?, ?)`
      )
      .run(m.id, m.type, m.name, m.filePath, m.displaySeconds, now, now)
  }

  updateMedia(id: string, f: { name: string; status: 'active' | 'inactive'; displaySeconds: number | null }, now: string): void {
    this.db
      .prepare('UPDATE media_items SET name = ?, status = ?, display_seconds = ?, updated_at = ? WHERE id = ?')
      .run(f.name, f.status, f.displaySeconds, now, id)
  }

  setMediaSortOrder(id: string, sortOrder: number): void {
    this.db.prepare('UPDATE media_items SET sort_order = ? WHERE id = ?').run(sortOrder, id)
  }

  deleteMedia(id: string): void {
    this.db.prepare('DELETE FROM media_items WHERE id = ?').run(id)
  }
}
