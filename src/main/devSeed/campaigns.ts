import { randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import type { AuditLog } from '../../core/audit/auditLog'
import { campaignConfigSchema, type CampaignConfig } from '../../shared/campaign'
import { campaignCardSvg, characterSvg, frameSvg, logoSvg, scenarioSvg } from './svg'

type ResourceType = 'scenario' | 'character' | 'frame' | 'logo'

interface SeedResource {
  key: string
  type: ResourceType
  name: string
  svg: string
  width: number
  height: number
  required?: boolean
  /** Simula un archivo faltante para probar la validación de campañas. */
  missingFile?: boolean
  /** Posición y ancho en fracciones de la imagen final (personajes y logotipos). */
  place?: { x: number; y: number; scale: number }
  /** Escenarios (por su clave) en los que se ofrece el personaje. */
  scenarios?: string[]
}

interface SeedCampaign {
  code: string
  name: string
  description: string
  card: string
  status: 'active' | 'inactive'
  /** Lo omitido toma el valor por defecto de la campaña. */
  config: Omit<CampaignConfig, 'freePlacement' | 'characterAnimation'>
  resources: SeedResource[]
}

const SCENE = { width: 1080, height: 1920 }
const CHARACTER = { width: 600, height: 1200 }
/** Zona de la persona (ya sin fondo verde): centrada, apoyada sobre la franja inferior del marco. */
const PHOTO = { x: 0.12, y: 0.2, width: 0.76, height: 0.665, layer: 10 }
/** Posiciones de los personajes: izquierda, derecha y arriba a la derecha. */
const CHARACTER_SLOTS = [
  { x: -0.02, y: 0.45, scale: 0.36 },
  { x: 0.66, y: 0.45, scale: 0.36 },
  { x: 0.72, y: 0.12, scale: 0.22 }
]
const LOGO_PLACE = { x: 0.05, y: 0.035, scale: 0.15 }

const CAMPAIGNS: SeedCampaign[] = [
  {
    code: 'DEMO-LECTURA',
    name: 'Lectura en familia',
    description: 'Elija un escenario y un personaje para su foto.',
    card: campaignCardSvg('Lectura en familia', 'Campaña de prueba', '#1d4e89'),
    status: 'active',
    config: { characterMode: 'required', frameMode: 'required', allowCameraBackground: false, photo: PHOTO, characterSlots: CHARACTER_SLOTS },
    resources: [
      {
        key: 'biblioteca',
        type: 'scenario',
        name: 'Biblioteca',
        ...SCENE,
        svg: scenarioSvg('Biblioteca', '#3b2a1a', '#7a5230', [0, 1, 2, 3, 4].map((i) => `<rect x="${80 + i * 190}" y="500" width="150" height="900" rx="10" fill="#a0522d" opacity="0.6"/>`).join(''))
      },
      {
        key: 'parque',
        type: 'scenario',
        name: 'Parque',
        ...SCENE,
        svg: scenarioSvg('Parque', '#7ec8e3', '#3c8d2f', '<circle cx="860" cy="420" r="120" fill="#ffd23f"/><rect x="0" y="1300" width="1080" height="620" fill="#2e7d32"/>')
      },
      { key: 'lector', type: 'character', name: 'Lector', ...CHARACTER, svg: characterSvg('Lector', '#f4a261', '#2a9d8f'), scenarios: ['biblioteca', 'parque'] },
      { key: 'lectora', type: 'character', name: 'Lectora', ...CHARACTER, svg: characterSvg('Lectora', '#e9c46a', '#e76f51'), scenarios: ['biblioteca', 'parque'] },
      { key: 'bibliotecaria', type: 'character', name: 'Bibliotecaria', ...CHARACTER, svg: characterSvg('Biblio', '#c08552', '#6a4c93'), scenarios: ['biblioteca'] },
      { key: 'marco-lectura', type: 'frame', name: 'Marco Lectura', ...SCENE, svg: frameSvg('Lectura en familia', '#1d4e89'), required: true },
      { key: 'logo', type: 'logo', name: 'Logo Editora Perú', width: 400, height: 400, svg: logoSvg(), required: true, place: LOGO_PLACE }
    ]
  },
  {
    code: 'DEMO-BICENTENARIO',
    name: 'Perú Bicentenario',
    description: 'Elija un escenario y el marco de su preferencia.',
    card: campaignCardSvg('Perú Bicentenario', 'Campaña de prueba', '#9b1c1c'),
    status: 'active',
    config: { characterMode: 'none', frameMode: 'required', allowCameraBackground: false, photo: PHOTO, characterSlots: CHARACTER_SLOTS },
    resources: [
      {
        key: 'plaza',
        type: 'scenario',
        name: 'Plaza de Armas',
        ...SCENE,
        svg: scenarioSvg('Plaza de Armas', '#f4d35e', '#ee964b', '<rect x="140" y="900" width="800" height="500" fill="#c44536" opacity="0.7"/><rect x="460" y="600" width="160" height="300" fill="#c44536" opacity="0.7"/>')
      },
      {
        key: 'costa',
        type: 'scenario',
        name: 'Costa verde',
        ...SCENE,
        svg: scenarioSvg('Costa verde', '#90e0ef', '#0077b6', '<rect x="0" y="1200" width="1080" height="720" fill="#023e8a"/><path d="M0 1200 Q270 1120 540 1200 T1080 1200" fill="#caf0f8" opacity="0.6"/>')
      },
      { key: 'marco-rojo', type: 'frame', name: 'Marco rojo', ...SCENE, svg: frameSvg('Perú Bicentenario', '#c1121f') },
      { key: 'marco-blanco', type: 'frame', name: 'Marco blanco', ...SCENE, svg: frameSvg('Perú Bicentenario', '#6c757d') },
      { key: 'logo', type: 'logo', name: 'Logo Editora Perú', width: 400, height: 400, svg: logoSvg(), required: true, place: LOGO_PLACE }
    ]
  },
  {
    code: 'DEMO-INCOMPLETA',
    name: 'Campaña incompleta',
    description: 'No debe mostrarse: le falta el archivo de un recurso obligatorio.',
    card: campaignCardSvg('Incompleta', 'No debe mostrarse', '#444444'),
    status: 'active',
    config: { characterMode: 'none', frameMode: 'none', allowCameraBackground: false, photo: PHOTO, characterSlots: CHARACTER_SLOTS },
    resources: [
      { key: 'vacio', type: 'scenario', name: 'Escenario sin archivo', ...SCENE, svg: '', required: true, missingFile: true }
    ]
  }
]

const LAYER: Record<ResourceType, number> = { scenario: 0, character: 20, frame: 30, logo: 40 }

const seedDir = (campaign: SeedCampaign) => `resources/dev-seed/${campaign.code.toLowerCase()}`

/**
 * Solo desarrollo y solo con `TOTEM_DEMO=1`: crea campañas y recursos gráficos de demostración si no existen.
 * Una campaña que ya existe no se toca: desde la fase 6 se administra en el panel, y volver a
 * sembrarla restauraba en cada inicio los recursos borrados y la ubicación editada.
 */
export function syncDevSeedCampaigns(db: DatabaseSync, contentDir: string, audit: AuditLog): number {
  const find = db.prepare('SELECT 1 FROM campaigns WHERE code = ?')
  const insertCampaign = db.prepare(
    `INSERT INTO campaigns (id, code, name, description, image_path, status, config_json, config_version, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
  )
  const insertResource = db.prepare(
    `INSERT INTO resources (id, type, name, file_path, format, width, height, size_bytes, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'svg', ?, ?, ?, 'active', ?, ?)`
  )
  const link = db.prepare(
    `INSERT INTO campaign_resources (campaign_id, resource_id, layer_order, pos_x, pos_y, scale, is_required, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  )
  const assign = db.prepare(
    'INSERT OR IGNORE INTO scenario_characters (campaign_id, scenario_id, character_id, sort_order) VALUES (?, ?, ?, ?)'
  )

  let added = 0
  for (const campaign of CAMPAIGNS) {
    const now = new Date().toISOString()
    if (find.get(campaign.code)) continue
    const dir = seedDir(campaign)
    mkdirSync(join(contentDir, dir), { recursive: true })
    const configJson = JSON.stringify(campaignConfigSchema.parse(campaign.config))

    db.exec('BEGIN')
    try {
      const cardPath = `${dir}/portada.svg`
      writeFileSync(join(contentDir, cardPath), campaign.card, 'utf8')
      const row = { id: randomUUID() }
      insertCampaign.run(row.id, campaign.code, campaign.name, campaign.description, cardPath, campaign.status, configJson, now, now)
      added++

      const idsByKey = new Map<string, string>()
      campaign.resources.forEach((resource, index) => {
        const filePath = `${dir}/${resource.key}.svg`
        const p = resource.place ?? { x: 0, y: 0, scale: 1 }
        if (!resource.missingFile) writeFileSync(join(contentDir, filePath), resource.svg, 'utf8')
        const resourceId = randomUUID()
        idsByKey.set(resource.key, resourceId)
        insertResource.run(
          resourceId,
          resource.type,
          resource.name,
          filePath,
          resource.width,
          resource.height,
          Buffer.byteLength(resource.svg),
          now,
          now
        )
        link.run(row.id, resourceId, LAYER[resource.type], p.x, p.y, p.scale, resource.required ? 1 : 0, index * 10)
      })
      campaign.resources.forEach((resource, index) => {
        for (const scenarioKey of resource.scenarios ?? []) {
          assign.run(row.id, idsByKey.get(scenarioKey)!, idsByKey.get(resource.key)!, index * 10)
        }
      })
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }

  if (added > 0) {
    audit.record({ level: 'info', category: 'content', action: 'dev_seed.campaigns', result: 'ok', detail: { added } })
  }
  return added
}

