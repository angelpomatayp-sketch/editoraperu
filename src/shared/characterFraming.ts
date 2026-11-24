import type { CampaignDetail, PhotoRegion } from './campaign'
import { AUTO_FRAME, placeCharacters, type CharacterFrameTarget, type LayerResource, type OutputSize } from './compositionPlan'

/**
 * Referencia estable: el primer personaje seleccionado, en su pose final y con los ajustes del
 * administrador. No sigue la animación ni cambia de referencia según el orden de las capas.
 * Usa la misma geometría redondeada de `buildCompositionPlan`, sin contar márgenes transparentes.
 */
export function characterFrameTarget(
  detail: Pick<CampaignDetail, 'characters' | 'characterSlots' | 'characterVideoTransforms' | 'freePlacement'>,
  characterIds: string[],
  region: PhotoRegion,
  output: OutputSize
): CharacterFrameTarget | null {
  const character = detail.characters.find((c) => c.id === characterIds[0])
  if (!character || !detail.characterSlots.length || !(character.width > 0 && character.height > 0)) return null
  const bounds = character.contentBounds
  if (![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite)
    || bounds.x < 0 || bounds.y < 0 || bounds.width <= 0 || bounds.height <= 0
    || bounds.x + bounds.width > 1.0001 || bounds.y + bounds.height > 1.0001) return null
  const resource: LayerResource = {
    id: character.id, type: 'character', src: character.imageUrl,
    width: character.width, height: character.height, layerOrder: character.layer,
    posX: 0, posY: 0, scale: 1, preserveFrame: character.animationUrl !== null
  }
  const placed = placeCharacters([resource], detail.characterSlots, {
    placements: [], limits: { ...detail.freePlacement, enabled: false },
    videoTransforms: detail.characterVideoTransforms, output
  })[0]!
  const width = Math.max(1, Math.round(placed.scale * output.width))
  const height = Math.max(1, Math.round(width * placed.height / placed.width))
  const top = Math.round(placed.posY * output.height) + bounds.y * height
  const bottom = top + bounds.height * height
  const left = Math.round(placed.posX * output.width) + bounds.x * width
  // Un personaje fuera de la foto o cortado verticalmente tampoco es una referencia fiable.
  if (top < -1 || bottom > output.height + 1 || left >= output.width || left + bounds.width * width <= 0) return null
  const regionHeight = Math.round(region.height * output.height)
  if (regionHeight <= 0) return null
  const target = {
    height: (bottom - top) / regionHeight,
    baseline: (bottom - Math.round(region.y * output.height)) / regionHeight
  }
  // El apoyo puede limitarse al borde inferior de la zona, pero no situarse por encima de ella.
  return Number.isFinite(target.height) && Number.isFinite(target.baseline)
    && target.height > 0.02 && target.baseline > AUTO_FRAME.headroom + 0.02 ? target : null
}
