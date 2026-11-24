import { z } from 'zod'
import type { FractionRect } from './compositionPlan'

/** Si la campaña exige, permite u omite la selección de un tipo de elemento (RF-EXP-004, RF-EXP-005). */
export const selectionModeSchema = z.enum(['required', 'optional', 'none'])
export type SelectionMode = z.infer<typeof selectionModeSchema>

/** Máximo de personajes por fotografía. */
export const MAX_CHARACTERS = 3

/** Opción virtual: usa la fotografía real completa como fondo, sin añadir un escenario gráfico. */
export const CAMERA_SCENARIO_ID = '00000000-0000-4000-8000-000000000001'
export const CAMERA_SCENARIO_NAME = 'Usar fondo real de la cámara'
export const CAMERA_PHOTO_REGION: PhotoRegion = { x: 0, y: 0, width: 1, height: 1, layer: 0 }

/**
 * Zona de la persona dentro de la composición, en fracciones del ancho y alto de salida (RF-CMP-003).
 * La captura, ya sin fondo verde, se ajusta para cubrir la zona sin deformarse. `layer` ubica a la
 * persona en el orden de capas.
 */
export const photoRegionSchema = z
  .object({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    width: z.number().gt(0).max(1),
    height: z.number().gt(0).max(1),
    layer: z.int().default(10)
  })
  .refine((r) => r.x + r.width <= 1.0001 && r.y + r.height <= 1.0001, {
    message: 'La zona de la fotografía debe quedar dentro de la imagen'
  })
export type PhotoRegion = z.infer<typeof photoRegionSchema>

export const DEFAULT_PHOTO_REGION: PhotoRegion = { x: 0.08, y: 0.1, width: 0.84, height: 0.62, layer: 10 }

/**
 * Posición de un personaje elegido: esquina superior izquierda y ancho, en fracciones de la imagen.
 * Los personajes ocupan las posiciones en el orden en que se eligen; la cantidad de posiciones define
 * cuántos personajes se pueden elegir.
 */
export const characterSlotSchema = z.object({
  x: z.number().min(-0.5).max(1),
  y: z.number().min(-0.5).max(1),
  scale: z.number().gt(0).max(1)
})
export type CharacterSlot = z.infer<typeof characterSlotSchema>

/** Ajuste del cuadro completo del video respecto a su encuadre original. */
export const characterVideoTransformSchema = z.object({
  scale: z.number().min(0.1).max(1),
  x: z.number().min(-0.5).max(0.5),
  y: z.number().min(-0.5).max(0.5)
})
export const characterVideoTransformsSchema = z.record(z.string(), characterVideoTransformSchema)
export type CharacterVideoTransforms = z.infer<typeof characterVideoTransformsSchema>

export const DEFAULT_CHARACTER_SLOT: CharacterSlot = { x: 0.56, y: 0.42, scale: 0.38 }

/**
 * Si el participante puede mover y cambiar el tamaño de los personajes en la pantalla de la cámara,
 * y entre qué tamaños (ancho como fracción del ancho de la imagen). Las posiciones configuradas
 * son el punto de partida.
 */
export const freePlacementSchema = z
  .object({
    enabled: z.boolean(),
    minScale: z.number().min(0.05).max(1),
    maxScale: z.number().min(0.05).max(1)
  })
  .refine((p) => p.minScale <= p.maxScale, { message: 'El tamaño mínimo no puede superar al máximo' })
export type FreePlacement = z.infer<typeof freePlacementSchema>

export const DEFAULT_FREE_PLACEMENT: FreePlacement = { enabled: true, minScale: 0.12, maxScale: 0.7 }

export const entryDirectionSchema = z.enum(['auto', 'left', 'right'])
export type EntryDirection = z.infer<typeof entryDirectionSchema>

/** Tiempos del movimiento automático de los personajes antes de habilitar la fotografía. */
export const characterAnimationSchema = z.object({
  enabled: z.boolean().default(true),
  entryDurationMs: z.int().min(400).max(5000).default(1600),
  prepareDurationMs: z.int().min(150).max(2000).default(650),
  staggerMs: z.int().min(0).max(1000).default(160),
  tiltDegrees: z.number().min(0).max(4).default(1.5)
})
export type CharacterAnimation = z.infer<typeof characterAnimationSchema>
export const DEFAULT_CHARACTER_ANIMATION: CharacterAnimation = {
  enabled: true,
  entryDurationMs: 1600,
  prepareDurationMs: 650,
  staggerMs: 160,
  tiltDegrees: 1.5
}

/** Configuración funcional de una campaña, guardada en `campaigns.config_json`. */
export const campaignConfigSchema = z.object({
  characterMode: selectionModeSchema.default('none'),
  frameMode: selectionModeSchema.default('required'),
  /** Ofrece una alternativa sin escenario gráfico, conservando el entorno real de la cámara. */
  allowCameraBackground: z.boolean().default(false),
  photo: photoRegionSchema.default(DEFAULT_PHOTO_REGION),
  characterSlots: z.array(characterSlotSchema).min(1).max(MAX_CHARACTERS).default([DEFAULT_CHARACTER_SLOT]),
  characterVideoTransforms: characterVideoTransformsSchema.optional(),
  freePlacement: freePlacementSchema.default(DEFAULT_FREE_PLACEMENT),
  characterAnimation: characterAnimationSchema.default(DEFAULT_CHARACTER_ANIMATION)
})
export type CampaignConfig = z.infer<typeof campaignConfigSchema>

export interface ResourceOption {
  id: string
  name: string
  imageUrl: string
  /** Dimensiones originales, para ubicarlo sin deformarlo. */
  width: number
  height: number
  /** Orden de capa configurado en la campaña. */
  layer: number
  /** Escenarios: zona transparente donde va la foto (fracciones de la imagen), si la trae. */
  photoHole?: FractionRect | null
}

/** Personaje con los escenarios en los que se ofrece (RF-EXP-004). */
export interface CharacterOption extends ResourceOption {
  scenarioIds: string[]
  /** WebM transparente opcional, usado solo en la vista previa. La foto final siempre usa imageUrl. */
  animationUrl: string | null
  /** Duración real de la animación cuando se puede obtener (GIF). */
  animationDurationMs: number | null
  animationBackground: 'alpha' | 'chroma' | 'segmentation'
  entryDirection: EntryDirection
  contentBounds: FractionRect
  anchorX: number
  anchorY: number
}

/** Elemento que se aplica siempre en una posición fija (logotipos y otros). */
export interface OverlayOption extends ResourceOption {
  x: number
  y: number
  scale: number
}

export interface CampaignSummary {
  id: string
  name: string
  description: string | null
  imageUrl: string | null
}

export interface CampaignDetail extends CampaignSummary {
  /** Zona de la persona, para que la vista previa muestre el mismo encuadre que la imagen final. */
  photo: PhotoRegion
  scenarios: ResourceOption[]
  allowCameraBackground: boolean
  characterMode: SelectionMode
  characters: CharacterOption[]
  characterSlots: CharacterSlot[]
  characterVideoTransforms?: CharacterVideoTransforms
  /** Si el participante puede ubicar los personajes a su gusto, y con qué límites. */
  freePlacement: FreePlacement
  characterAnimation: CharacterAnimation
  frameMode: SelectionMode
  frames: ResourceOption[]
  overlays: OverlayOption[]
}

export interface CampaignList {
  campaigns: CampaignSummary[]
  /** Si hay una sola campaña, la selección puede omitirse (RF-EXP-001). */
  skipSingleCampaign: boolean
}

export interface Selections {
  scenarioId: string
  /** Personajes en el orden elegido; cada uno ocupa la posición correspondiente. */
  characterIds: string[]
  frameId: string | null
}

/** Un marco requerido y único se aplica automáticamente, sin pantalla de selección (RF-EXP-005). */
export function autoFrameId(detail: Pick<CampaignDetail, 'frameMode' | 'frames'>): string | null {
  return detail.frameMode === 'required' && detail.frames.length === 1 ? detail.frames[0]!.id : null
}

/** Personajes que se ofrecen con el escenario elegido, en su orden. */
export function charactersForScenario(detail: Pick<CampaignDetail, 'characters'>, scenarioId: string | null): CharacterOption[] {
  return scenarioId === null ? [] : detail.characters.filter((c) => c.scenarioIds.includes(scenarioId))
}

export function needsCharacterStep(
  detail: Pick<CampaignDetail, 'characterMode' | 'characters'>,
  scenarioId: string | null
): boolean {
  return detail.characterMode !== 'none' && charactersForScenario(detail, scenarioId).length > 0
}

export function needsFrameStep(detail: Pick<CampaignDetail, 'frameMode' | 'frames'>): boolean {
  if (detail.frameMode === 'none' || detail.frames.length === 0) return false
  return autoFrameId(detail) === null
}

/**
 * Cantidad máxima de personajes que se pueden elegir: las posiciones configuradas en la campaña y,
 * con un escenario, nunca más que los personajes que ese escenario ofrece.
 */
export function maxCharacters(
  detail: Pick<CampaignDetail, 'characterMode' | 'characterSlots' | 'characters'>,
  scenarioId?: string | null
): number {
  if (detail.characterMode === 'none') return 0
  const slots = detail.characterSlots.length
  return scenarioId === undefined ? slots : Math.min(slots, charactersForScenario(detail, scenarioId).length)
}

/** Convierte selecciones guardadas con el formato anterior (un solo personaje). */
export function normalizeSelections(raw: unknown): Selections {
  const value = (raw ?? {}) as Partial<Selections> & { characterId?: string | null }
  const characterIds = Array.isArray(value.characterIds)
    ? value.characterIds
    : value.characterId
      ? [value.characterId]
      : []
  return { scenarioId: value.scenarioId ?? '', characterIds, frameId: value.frameId ?? null }
}
