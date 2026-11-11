import { parsePhotoHole } from '../../../shared/compositionPlan'
import type { DatabaseSync } from 'node:sqlite'
import type {
  CampaignRecord,
  CampaignRepository,
  CampaignResourceRecord,
  ScenarioCharacterLink
} from '../../../core/campaigns/campaignCatalog'

interface CampaignRow {
  id: string
  code: string
  name: string
  description: string | null
  image_path: string | null
  status: CampaignRecord['status']
  starts_at: string | null
  ends_at: string | null
  config_json: string
  config_version: number
}

const CAMPAIGN_COLUMNS =
  'id, code, name, description, image_path, status, starts_at, ends_at, config_json, config_version'

function toRecord(row: CampaignRow): CampaignRecord {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description,
    imagePath: row.image_path,
    status: row.status,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    configJson: row.config_json,
    configVersion: row.config_version
  }
}

export class SqliteCampaignRepository implements CampaignRepository {
  constructor(private readonly db: DatabaseSync) {}

  listActiveInPeriod(nowIso: string): CampaignRecord[] {
    const rows = this.db
      .prepare(
        `SELECT ${CAMPAIGN_COLUMNS} FROM campaigns
         WHERE status = 'active'
           AND (starts_at IS NULL OR starts_at <= ?)
           AND (ends_at IS NULL OR ends_at > ?)
         ORDER BY name`
      )
      .all(nowIso, nowIso) as unknown as CampaignRow[]
    return rows.map(toRecord)
  }

  getById(id: string): CampaignRecord | null {
    const row = this.db.prepare(`SELECT ${CAMPAIGN_COLUMNS} FROM campaigns WHERE id = ?`).get(id) as
      | CampaignRow
      | undefined
    return row ? toRecord(row) : null
  }

  listResources(campaignId: string): CampaignResourceRecord[] {
    const rows = this.db
      .prepare(
        `SELECT r.id, r.type, r.name, r.file_path, r.animation_path, r.animation_duration_ms, r.animation_background, r.status, r.width, r.height, r.photo_hole_json,
                r.entry_direction, r.content_bounds_json, r.anchor_x, r.anchor_y,
                cr.is_required, cr.sort_order, cr.layer_order, cr.pos_x, cr.pos_y, cr.scale
         FROM campaign_resources cr
         JOIN resources r ON r.id = cr.resource_id
         WHERE cr.campaign_id = ?
         ORDER BY cr.sort_order, r.name`
      )
      .all(campaignId) as {
      id: string
      type: CampaignResourceRecord['type']
      name: string
      file_path: string
      animation_path: string | null
      animation_duration_ms: number | null
      animation_background: 'alpha' | 'chroma' | 'segmentation'
      status: CampaignResourceRecord['status']
      is_required: number
      sort_order: number
      width: number
      height: number
      layer_order: number
      pos_x: number
      pos_y: number
      scale: number
      photo_hole_json: string | null
      entry_direction: 'auto' | 'left' | 'right'
      content_bounds_json: string | null
      anchor_x: number
      anchor_y: number
    }[]
    return rows.map((r) => ({
      resourceId: r.id,
      type: r.type,
      name: r.name,
      filePath: r.file_path,
      animationPath: r.animation_path,
      animationDurationMs: r.animation_duration_ms,
      animationBackground: r.animation_background,
      status: r.status,
      isRequired: r.is_required === 1,
      sortOrder: r.sort_order,
      width: r.width,
      height: r.height,
      layerOrder: r.layer_order,
      posX: r.pos_x,
      posY: r.pos_y,
      scale: r.scale,
      photoHole: r.type === 'scenario' ? parsePhotoHole(r.photo_hole_json) : null,
      entryDirection: r.entry_direction,
      contentBounds: parsePhotoHole(r.content_bounds_json) ?? { x: 0, y: 0, width: 1, height: 1 },
      anchorX: r.anchor_x,
      anchorY: r.anchor_y
    }))
  }

  listScenarioCharacters(campaignId: string): ScenarioCharacterLink[] {
    const rows = this.db
      .prepare(
        `SELECT scenario_id, character_id, sort_order FROM scenario_characters
         WHERE campaign_id = ? ORDER BY scenario_id, sort_order`
      )
      .all(campaignId) as { scenario_id: string; character_id: string; sort_order: number }[]
    return rows.map((r) => ({ scenarioId: r.scenario_id, characterId: r.character_id, sortOrder: r.sort_order }))
  }
}
