import type { CharacterSlot, CharacterVideoTransforms, FreePlacement, PhotoRegion } from './campaign'

export interface LayerResource {
  id: string
  type: 'scenario' | 'character' | 'frame' | 'logo' | 'other'
  /** Origen de la imagen: ruta relativa a la carpeta de contenido o URL para la vista previa. */
  src: string
  width: number
  height: number
  layerOrder: number
  /** Posición de la esquina superior izquierda, en fracciones del ancho y alto de salida. */
  posX: number
  posY: number
  /** Ancho como fracción del ancho de salida; el alto conserva la proporción. */
  scale: number
  /** Escenarios: zona transparente donde va la foto del participante, si la imagen la trae. */
  photoHole?: FractionRect | null
  /** Personajes con video: conserva el cuadro completo del video y sus coordenadas internas. */
  preserveFrame?: boolean
}

export interface CompositionInputs {
  photoRegion: PhotoRegion
  /** La foto va en la zona transparente del escenario: con su fondo y la zona rellena (ver `backdrop`). */
  fillsHole?: boolean
  /** `null` significa que la fotografía de la cámara ocupa el fondo completo. */
  scenario: LayerResource | null
  /** Personajes ya ubicados en sus posiciones. */
  characters: LayerResource[]
  frame: LayerResource | null
  /** Logotipos y otros elementos aprobados de la campaña, aplicados siempre. */
  overlays: LayerResource[]
}

export type PlannedLayer =
  | { kind: 'photo'; order: number; left: number; top: number; width: number; height: number }
  /**
   * Escenarios y marcos cubren toda la imagen. Un escenario con otra proporción se muestra completo
   * dentro de `box` (fracciones de la imagen final), sin recortarlo.
   */
  | { kind: 'fill'; order: number; resource: LayerResource; box?: FractionRect }
  /** Relleno de las franjas que deja un escenario de otra proporción: él mismo, ampliado y desenfocado. */
  | { kind: 'backdrop'; order: number; resource: LayerResource }
  | { kind: 'placed'; order: number; resource: LayerResource; left: number; top: number; width: number; height: number }

export interface OutputSize {
  width: number
  height: number
}

/** Rectángulo en fracciones (0 a 1) del ancho y alto de su referencia. */
export interface FractionRect {
  x: number
  y: number
  width: number
  height: number
}

/**
 * Cómo entra la imagen de la cámara en la zona de la persona:
 * - `crop`: parte de la imagen de la cámara que se usa (fracciones del cuadro capturado);
 * - `box`: dónde queda dentro de la zona (fracciones de la zona).
 * `framing` va de 0 (imagen completa, sin recorte: la persona se ve más pequeña) a 1 (llena la zona
 * recortando los costados, como un zoom). La imagen se centra a lo ancho y se apoya abajo, para que la
 * persona quede «parada» sobre el escenario. Lo usan la vista previa y la foto final, para que coincidan.
 */
export function placeFrame(frameWidth: number, frameHeight: number, regionWidth: number, regionHeight: number, framing: number): { crop: FractionRect; box: FractionRect } {
  const t = clamp(Number.isFinite(framing) ? framing : 1, 0, 1)
  const contain = Math.min(regionWidth / frameWidth, regionHeight / frameHeight)
  const cover = Math.max(regionWidth / frameWidth, regionHeight / frameHeight)
  // Interpolación geométrica: cada paso del ajuste se percibe como el mismo «zoom».
  const scale = contain * Math.pow(cover / contain, t)
  const visibleWidth = Math.min(frameWidth * scale, regionWidth)
  const visibleHeight = Math.min(frameHeight * scale, regionHeight)
  const cropWidth = visibleWidth / (frameWidth * scale)
  const cropHeight = visibleHeight / (frameHeight * scale)
  return {
    crop: { x: (1 - cropWidth) / 2, y: (1 - cropHeight) / 2, width: cropWidth, height: cropHeight },
    box: {
      x: (regionWidth - visibleWidth) / 2 / regionWidth,
      y: (regionHeight - visibleHeight) / regionHeight,
      width: visibleWidth / regionWidth,
      height: visibleHeight / regionHeight
    }
  }
}

/** Ubicación de la imagen de la cámara en la zona de la persona (ver `placeFrame`). */
export interface FramePlacement {
  crop: FractionRect
  box: FractionRect
}

/** Márgenes del encuadre automático (fracciones de la zona) y ampliación máxima, para cuidar la nitidez. */
export const AUTO_FRAME = { headroom: 0.07, footroom: 0.02, sideMargin: 0.04, maxUpscale: 2 } as const

/** Altura y línea de apoyo del personaje, en fracciones de la zona del participante. */
export interface CharacterFrameTarget {
  height: number
  baseline: number
}

/**
 * Encuadre automático: centra a la persona y la agranda hasta ocupar el alto de la zona, de cuerpo
 * entero (pies apoyados abajo y un margen sobre la cabeza), sin superar `maxUpscale` píxeles de salida
 * por píxel de la cámara ni hacerla más pequeña que con la imagen completa.
 * `person`: contorno de la persona en fracciones del cuadro (en la orientación de la foto).
 * `regionWidth`/`regionHeight`: tamaño de la zona en píxeles de la imagen final.
 * Las partes que caen fuera del cuadro quedan transparentes (se ve el escenario).
 * Con `target`, permite también reducir y toma la altura y el apoyo del personaje como referencia.
 * Devuelve `null` si el contorno no es útil; con referencia, también si toca el borde de la cámara.
 */
export function autoFrame(person: FractionRect, frameWidth: number, frameHeight: number, regionWidth: number, regionHeight: number, target?: CharacterFrameTarget | null): FramePlacement | null {
  if (![frameWidth, frameHeight, regionWidth, regionHeight].every((v) => Number.isFinite(v) && v > 0)) return null
  if (![person.x, person.y, person.width, person.height].every(Number.isFinite)) return null
  const personWidth = person.width * frameWidth
  const personHeight = person.height * frameHeight
  if (!(personWidth > 0) || personHeight < frameHeight * 0.15) return null
  // Una silueta cortada no permite comparar alturas completas. No inventar cabeza ni pies.
  if (target && (person.y <= 0.01 || person.y + person.height >= 0.99 || person.x <= 0.005 || person.x + person.width >= 0.995)) return null
  if (target && (!Number.isFinite(target.height) || !Number.isFinite(target.baseline) || target.height <= 0 || target.baseline <= AUTO_FRAME.headroom)) return null

  const contain = Math.min(regionWidth / frameWidth, regionHeight / frameHeight)
  const baseline = target ? Math.min(target.baseline, 1 - AUTO_FRAME.footroom) : 1 - AUTO_FRAME.footroom
  const height = target ? Math.min(target.height, baseline - AUTO_FRAME.headroom) : 1 - AUTO_FRAME.headroom - AUTO_FRAME.footroom
  const fitHeight = (regionHeight * height) / personHeight
  const fitWidth = (regionWidth * (1 - 2 * AUTO_FRAME.sideMargin)) / personWidth
  const fit = Math.min(fitHeight, fitWidth, AUTO_FRAME.maxUpscale)
  const scale = target ? fit : Math.max(contain, fit)

  // Zona completa expresada en píxeles de la cámara, centrada en la persona y con sus pies abajo.
  const cropWidth = regionWidth / scale
  const cropHeight = regionHeight / scale
  const left = (person.x + person.width / 2) * frameWidth - cropWidth / 2
  const top = (person.y + person.height) * frameHeight - (baseline * regionHeight) / scale

  const x0 = Math.max(0, left)
  const y0 = Math.max(0, top)
  const x1 = Math.min(frameWidth, left + cropWidth)
  const y1 = Math.min(frameHeight, top + cropHeight)
  if (x1 <= x0 || y1 <= y0) return null
  const placement = {
    crop: { x: x0 / frameWidth, y: y0 / frameHeight, width: (x1 - x0) / frameWidth, height: (y1 - y0) / frameHeight },
    box: { x: (x0 - left) / cropWidth, y: (y0 - top) / cropHeight, width: (x1 - x0) / cropWidth, height: (y1 - y0) / cropHeight }
  }
  // La vista no debe mostrar una reducción tan pequeña que la foto final rechace su geometría.
  return target ? sanitizePlacement(placement) : placement
}

/** Ajusta una ubicación recibida de la interfaz a rangos válidos; `null` si no es utilizable. */
export function sanitizePlacement(placement: FramePlacement): FramePlacement | null {
  const fix = (r: FractionRect): FractionRect | null => {
    const x = clamp(r.x, 0, 1)
    const y = clamp(r.y, 0, 1)
    const width = clamp(r.width, 0, 1 - x)
    const height = clamp(r.height, 0, 1 - y)
    return width > 0.01 && height > 0.01 ? { x, y, width, height } : null
  }
  const crop = fix(placement.crop)
  const box = fix(placement.box)
  return crop && box ? { crop, box } : null
}

/** Ubicaciones elegidas por el participante, por orden de personaje; `null` usa la configurada. */
export interface ChosenPlacements {
  videoTransforms?: CharacterVideoTransforms
  placements: (CharacterSlot | null)[]
  limits: FreePlacement
  output: OutputSize
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

/**
 * Mantiene una ubicación elegida dentro de los límites de la campaña: el tamaño entre el mínimo y el
 * máximo, y al menos la mitad del personaje dentro de la imagen. Se aplica igual en la pantalla y en
 * la foto final, que además lo vuelve a aplicar sobre lo recibido de la interfaz.
 * `aspect` es la proporción alto/ancho de la imagen del personaje.
 */
export function clampPlacement(place: CharacterSlot, aspect: number, limits: FreePlacement, output: OutputSize): CharacterSlot {
  const finite = (v: number, fallback: number) => (Number.isFinite(v) ? v : fallback)
  const scale = clamp(finite(place.scale, limits.minScale), limits.minScale, limits.maxScale)
  const heightFraction = (scale * output.width * aspect) / output.height
  return {
    x: clamp(finite(place.x, 0), -scale / 2, 1 - scale / 2),
    y: clamp(finite(place.y, 0), -heightFraction / 2, 1 - heightFraction / 2),
    scale
  }
}

/**
 * Cambia el tamaño de un personaje sin mover su centro, dentro de los límites de la campaña.
 */
export function resizePlacement(place: CharacterSlot, factor: number, aspect: number, limits: FreePlacement, output: OutputSize): CharacterSlot {
  const scale = clamp(place.scale * factor, limits.minScale, limits.maxScale)
  const heightOf = (s: number) => (s * output.width * aspect) / output.height
  const centerX = place.x + place.scale / 2
  const centerY = place.y + heightOf(place.scale) / 2
  return clampPlacement({ x: centerX - scale / 2, y: centerY - heightOf(scale) / 2, scale }, aspect, limits, output)
}

/**
 * Ubica cada personaje elegido en la posición configurada que le corresponde por orden de elección
 * o, si la campaña lo permite, donde lo dejó el participante. Los personajes que excedan las
 * posiciones disponibles se descartan.
 */
export function placeCharacters(characters: LayerResource[], slots: CharacterSlot[], chosen?: ChosenPlacements): LayerResource[] {
  return characters.slice(0, slots.length).map((c, i) => {
    if (c.preserveFrame) {
      const output = chosen?.output
      if (!output) return { ...c, posX: 0, posY: 0, scale: 1 }
      const fit = Math.min(output.width / c.width, output.height / c.height)
      const width = c.width * fit
      const height = c.height * fit
      const transform = chosen?.videoTransforms?.[c.id]
      const scale = transform?.scale ?? 1
      return {
        ...c,
        // Reducir conserva el centro horizontal y el apoyo inferior del cuadro original.
        posX: (output.width - width * scale) / 2 / output.width + (transform?.x ?? 0),
        posY: ((output.height - height) / 2 + height * (1 - scale)) / output.height + (transform?.y ?? 0),
        scale: width / output.width * scale
      }
    }
    const custom = chosen?.limits.enabled ? chosen.placements[i] : null
    const place = custom ? clampPlacement(custom, c.height / c.width, chosen!.limits, chosen!.output) : slots[i]!
    return { ...c, posX: place.x, posY: place.y, scale: place.scale }
  })
}

/**
 * Zona de la foto para un escenario. Si el escenario trae una zona transparente, la foto va ahí,
 * justo debajo del escenario (lo que no es transparente, como titulares o bordes, queda encima), con su
 * fondo y el encuadre configurado. Si no, se usa la zona configurada en la campaña, como siempre.
 */
export function photoRegionFor(
  campaignRegion: PhotoRegion,
  scenario: { layerOrder: number; width: number; height: number; photoHole?: FractionRect | null } | undefined,
  output: OutputSize
): { region: PhotoRegion; fillsHole: boolean } {
  const hole = scenario?.photoHole
  if (!hole) return { region: campaignRegion, fillsHole: false }
  // El hueco se mide sobre la imagen del escenario: se ubica donde queda el escenario en la foto final.
  const box = scenarioBox(scenario, output) ?? { x: 0, y: 0, width: 1, height: 1 }
  return {
    region: {
      x: box.x + hole.x * box.width,
      y: box.y + hole.y * box.height,
      width: hole.width * box.width,
      height: hole.height * box.height,
      layer: scenario.layerOrder - 1
    },
    fillsHole: true
  }
}

/** Diferencia de proporción tolerada antes de dejar franjas: menos que esto se ajusta sin notarse. */
const SCENARIO_FIT_TOLERANCE = 0.015

/**
 * Ubicación de un escenario cuya proporción no es la de la foto final: completo y centrado, sin
 * recortarlo (las franjas que quedan se rellenan). `null` si tiene la misma proporción y cubre todo.
 */
export function scenarioBox(scenario: { width: number; height: number }, output: OutputSize): FractionRect | null {
  if (!(scenario.width > 0 && scenario.height > 0)) return null
  const scale = Math.min(output.width / scenario.width, output.height / scenario.height)
  const width = (scenario.width * scale) / output.width
  const height = (scenario.height * scale) / output.height
  if (width >= 1 - SCENARIO_FIT_TOLERANCE && height >= 1 - SCENARIO_FIT_TOLERANCE) return null
  return { x: (1 - width) / 2, y: (1 - height) / 2, width, height }
}

/** Lee una zona guardada como JSON; cualquier valor inválido se trata como «sin zona». */
export function parsePhotoHole(json: string | null | undefined): FractionRect | null {
  if (!json) return null
  try {
    const r = JSON.parse(json) as Partial<FractionRect>
    const ok = [r.x, r.y, r.width, r.height].every((v) => typeof v === 'number' && Number.isFinite(v))
    if (!ok || r.width! <= 0 || r.height! <= 0 || r.x! < 0 || r.y! < 0 || r.x! + r.width! > 1.0001 || r.y! + r.height! > 1.0001) return null
    return { x: r.x!, y: r.y!, width: r.width!, height: r.height! }
  } catch {
    return null
  }
}

/** Recursos que ocupan toda la imagen; el resto se ubica según su posición y escala. */
const FILL_TYPES = new Set<LayerResource['type']>(['scenario', 'frame'])

function layerFor(resource: LayerResource, output: OutputSize): PlannedLayer {
  if (FILL_TYPES.has(resource.type)) return { kind: 'fill', order: resource.layerOrder, resource }
  const width = Math.max(1, Math.round(resource.scale * output.width))
  const height = Math.max(1, Math.round((width * resource.height) / resource.width))
  return {
    kind: 'placed',
    order: resource.layerOrder,
    resource,
    left: Math.round(resource.posX * output.width),
    top: Math.round(resource.posY * output.height),
    width,
    height
  }
}

/**
 * Capas de la composición en el orden configurado (RF-CMP-002, RF-CMP-003). Con el mismo orden,
 * se respeta la secuencia escenario, persona, personajes, marco y elementos superpuestos.
 * Se usa tanto para la imagen final como para la vista previa en pantalla.
 */
export function buildCompositionPlan(inputs: CompositionInputs, output: OutputSize): PlannedLayer[] {
  const region = inputs.photoRegion
  const photo: PlannedLayer = {
    kind: 'photo',
    order: region.layer,
    left: Math.round(region.x * output.width),
    top: Math.round(region.y * output.height),
    width: Math.round(region.width * output.width),
    height: Math.round(region.height * output.height)
  }

  // Un escenario de otra proporción se muestra completo; debajo de todo, él mismo desenfocado rellena las franjas.
  const box = inputs.scenario ? scenarioBox(inputs.scenario, output) : null
  const scenarioLayer: PlannedLayer[] = inputs.scenario
    ? [box
        ? { kind: 'fill', order: inputs.scenario.layerOrder, resource: inputs.scenario, box }
        : layerFor(inputs.scenario, output)]
    : []
  const backdrop: PlannedLayer[] = box && inputs.scenario
    ? [{ kind: 'backdrop', order: Math.min(inputs.scenario.layerOrder, region.layer) - 1, resource: inputs.scenario }]
    : []

  const sequence: PlannedLayer[] = [
    ...backdrop,
    ...scenarioLayer,
    photo,
    ...inputs.characters.map((c) => layerFor(c, output)),
    ...(inputs.frame ? [layerFor(inputs.frame, output)] : []),
    ...inputs.overlays.map((o) => layerFor(o, output))
  ]
  // `sort` es estable: ante el mismo orden se mantiene la secuencia anterior.
  return sequence.sort((a, b) => a.order - b.order)
}

/** Recursos cuyo archivo debe existir para componer sin resultados incompletos (RF-CMP-006). */
export function planResources(plan: PlannedLayer[]): LayerResource[] {
  return plan.flatMap((layer) => (layer.kind === 'photo' ? [] : [layer.resource]))
}
