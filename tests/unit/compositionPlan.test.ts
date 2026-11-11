import { describe, expect, it } from 'vitest'
import { campaignConfigSchema, DEFAULT_PHOTO_REGION, normalizeSelections } from '../../src/shared/campaign'
import {
  buildCompositionPlan,
  clampPlacement,
  placeCharacters,
  placeFrame,
  autoFrame,
  AUTO_FRAME,
  sanitizePlacement,
  planResources,
  resizePlacement,
  type LayerResource
} from '../../src/shared/compositionPlan'

const OUT = { width: 1000, height: 2000 }

function res(id: string, type: LayerResource['type'], layerOrder: number, extra: Partial<LayerResource> = {}): LayerResource {
  return { id, type, src: `${id}.png`, width: 500, height: 1000, layerOrder, posX: 0, posY: 0, scale: 1, ...extra }
}

describe('encuadre de la cámara en la zona de la persona', () => {
  // Cámara HD horizontal (1280×720) en una zona vertical de 821×1277.
  const frame = [1280, 720] as const
  const region = [821, 1277] as const

  it('0 % usa la imagen completa, sin recorte, centrada y apoyada abajo', () => {
    const { crop, box } = placeFrame(...frame, ...region, 0)
    expect(crop).toEqual({ x: 0, y: 0, width: 1, height: 1 })
    expect(box.width).toBeCloseTo(1)
    expect(box.height).toBeCloseTo((821 * 720) / 1280 / 1277)
    expect(box.y + box.height).toBeCloseTo(1)
  })

  it('100 % llena la zona recortando los costados (como antes)', () => {
    const { crop, box } = placeFrame(...frame, ...region, 1)
    for (const [key, value] of Object.entries({ x: 0, y: 0, width: 1, height: 1 })) expect(box[key as keyof typeof box]).toBeCloseTo(value)
    expect(crop.height).toBeCloseTo(1)
    expect(crop.width).toBeCloseTo((720 * 821) / 1277 / 1280)
    expect(crop.x).toBeCloseTo((1 - crop.width) / 2)
  })

  it('los valores intermedios recortan menos y no deforman', () => {
    const { crop, box } = placeFrame(...frame, ...region, 0.5)
    expect(crop.width).toBeGreaterThan(0.36)
    expect(crop.width).toBeLessThan(1)
    // Misma proporción en lo que se toma de la cámara y en lo que ocupa en la zona.
    expect((crop.width * 1280) / (crop.height * 720)).toBeCloseTo((box.width * 821) / (box.height * 1277))
  })
})

describe('encuadre automático de la persona', () => {
  // Cámara HD horizontal; zona de 821×1277 px en la imagen final.
  const W = 1280
  const H = 720

  it('agranda a la persona de cuerpo entero hasta el alto de la zona, centrada y con los pies abajo', () => {
    // Persona de pie, al centro, de 600 px de alto (filas 100 a 700) y 200 px de ancho.
    const person = { x: 540 / W, y: 100 / H, width: 200 / W, height: 600 / H }
    const placement = autoFrame(person, W, H, 821, 1277)!
    const scale = (1277 * (1 - AUTO_FRAME.headroom - AUTO_FRAME.footroom)) / 600
    expect(scale).toBeLessThan(AUTO_FRAME.maxUpscale)
    // Lo que se toma de la cámara, llevado a la zona, mide lo mismo que la persona escalada.
    expect((placement.box.height * 1277) / (placement.crop.height * H)).toBeCloseTo(scale)
    // Centrada a lo ancho.
    const center = placement.crop.x + placement.crop.width / 2
    expect(center).toBeCloseTo(640 / W, 2)
  })

  it('no amplía más de lo permitido, para cuidar la nitidez', () => {
    // Persona lejana: 150 px de alto.
    const person = { x: 0.48, y: 0.5, width: 50 / W, height: 150 / H }
    const placement = autoFrame(person, W, H, 821, 1277)!
    const scale = (placement.box.height * 1277) / (placement.crop.height * H)
    expect(scale).toBeLessThanOrEqual(AUTO_FRAME.maxUpscale + 1e-9)
  })

  it('sin persona útil devuelve null (se usa el encuadre fijo)', () => {
    expect(autoFrame({ x: 0.5, y: 0.5, width: 0.01, height: 0.05 }, W, H, 821, 1277)).toBeNull()
  })

  it('valida lo que llega de la interfaz', () => {
    expect(sanitizePlacement({ crop: { x: -1, y: 0, width: 5, height: 1 }, box: { x: 0, y: 0, width: 1, height: 1 } })).toEqual({
      crop: { x: 0, y: 0, width: 1, height: 1 },
      box: { x: 0, y: 0, width: 1, height: 1 }
    })
    expect(sanitizePlacement({ crop: { x: 0, y: 0, width: 0, height: 0 }, box: { x: 0, y: 0, width: 1, height: 1 } })).toBeNull()
  })
})

describe('ubicación libre de personajes', () => {
  const limits = { enabled: true, minScale: 0.1, maxScale: 0.6 }
  // Personaje de proporción 2:1 (alto el doble del ancho) en una salida de 1000×2000.
  const aspect = 2

  it('limita el tamaño al mínimo y máximo de la campaña', () => {
    expect(clampPlacement({ x: 0.2, y: 0.2, scale: 0.01 }, aspect, limits, OUT).scale).toBe(0.1)
    expect(clampPlacement({ x: 0.2, y: 0.2, scale: 0.95 }, aspect, limits, OUT).scale).toBe(0.6)
  })

  it('deja al menos la mitad del personaje dentro de la imagen', () => {
    const outside = clampPlacement({ x: 3, y: -3, scale: 0.4 }, aspect, limits, OUT)
    // Alto relativo: 0.4 × 1000 × 2 / 2000 = 0.4.
    expect(outside).toEqual({ x: 0.8, y: -0.2, scale: 0.4 })
  })

  it('cambia el tamaño sin mover el centro', () => {
    const bigger = resizePlacement({ x: 0.3, y: 0.3, scale: 0.2 }, 1.5, aspect, limits, OUT)
    expect(bigger.scale).toBeCloseTo(0.3)
    expect(bigger.x + bigger.scale / 2).toBeCloseTo(0.4)
  })

  it('solo usa la ubicación elegida si la campaña lo permite', () => {
    const c = res('p1', 'character', 20)
    const slots = [{ x: 0.1, y: 0.5, scale: 0.3 }]
    const chosen = { placements: [{ x: 0.4, y: 0.2, scale: 0.25 }], limits, output: OUT }
    expect(placeCharacters([c], slots, chosen)[0]).toMatchObject({ posX: 0.4, posY: 0.2, scale: 0.25 })
    expect(placeCharacters([c], slots, { ...chosen, limits: { ...limits, enabled: false } })[0]).toMatchObject({ posX: 0.1, scale: 0.3 })
    expect(placeCharacters([c], slots, { ...chosen, placements: [null] })[0]).toMatchObject({ posX: 0.1, scale: 0.3 })
  })
})

describe('plan de composición (RF-CMP-002, RF-CMP-003)', () => {
  it('ordena las capas: escenario, persona, personajes, marco y logotipo', () => {
    const plan = buildCompositionPlan(
      {
        photoRegion: { x: 0.1, y: 0.1, width: 0.8, height: 0.5, layer: 10 },
        scenario: res('fondo', 'scenario', 0),
        characters: [res('p1', 'character', 20), res('p2', 'character', 20)],
        frame: res('marco', 'frame', 30),
        overlays: [res('logo', 'logo', 40, { posX: 0.05, posY: 0.02, scale: 0.1 })]
      },
      OUT
    )
    expect(plan.map((l) => (l.kind === 'photo' ? 'persona' : l.resource.id))).toEqual(['fondo', 'persona', 'p1', 'p2', 'marco', 'logo'])
    expect(planResources(plan).map((r) => r.id)).toEqual(['fondo', 'p1', 'p2', 'marco', 'logo'])
  })

  it('un orden configurado distinto cambia la superposición', () => {
    const plan = buildCompositionPlan(
      {
        photoRegion: { ...DEFAULT_PHOTO_REGION, layer: 50 },
        scenario: res('fondo', 'scenario', 0),
        characters: [],
        frame: res('marco', 'frame', 30),
        overlays: []
      },
      OUT
    )
    expect(plan.map((l) => l.kind)).toEqual(['fill', 'fill', 'photo'])
  })

  it('ubica a la persona en su zona y a los personajes sin deformarlos', () => {
    const plan = buildCompositionPlan(
      {
        photoRegion: { x: 0.1, y: 0.25, width: 0.8, height: 0.5, layer: 10 },
        scenario: res('fondo', 'scenario', 0),
        characters: [res('personaje', 'character', 20, { posX: 0.5, posY: 0.4, scale: 0.4 })],
        frame: null,
        overlays: []
      },
      OUT
    )
    expect(plan[1]).toEqual({ kind: 'photo', order: 10, left: 100, top: 500, width: 800, height: 1000 })
    // 500x1000 escalado a 400 de ancho conserva la proporción 1:2.
    expect(plan[2]).toMatchObject({ kind: 'placed', left: 500, top: 800, width: 400, height: 800 })
  })
})

describe('posiciones de personajes', () => {
  const slots = [
    { x: 0, y: 0.5, scale: 0.3 },
    { x: 0.7, y: 0.5, scale: 0.3 }
  ]

  it('cada personaje ocupa la posición que le corresponde por orden de elección', () => {
    const placed = placeCharacters([res('b', 'character', 20), res('a', 'character', 20)], slots)
    expect(placed.map((c) => [c.id, c.posX, c.posY, c.scale])).toEqual([
      ['b', 0, 0.5, 0.3],
      ['a', 0.7, 0.5, 0.3]
    ])
  })

  it('descarta personajes que excedan las posiciones', () => {
    expect(placeCharacters([res('a', 'character', 20), res('b', 'character', 20), res('c', 'character', 20)], slots)).toHaveLength(2)
  })
})

describe('configuración de campaña', () => {
  it('usa valores por defecto en configuraciones anteriores', () => {
    const config = campaignConfigSchema.parse({ characterMode: 'none', frameMode: 'none' })
    expect(config.photo).toEqual(DEFAULT_PHOTO_REGION)
    expect(config.characterSlots).toHaveLength(1)
  })

  it('rechaza una zona que sale de la imagen o más de tres posiciones de personaje', () => {
    expect(campaignConfigSchema.safeParse({ photo: { x: 0.5, y: 0, width: 0.6, height: 0.5 } }).success).toBe(false)
    const slot = { x: 0, y: 0, scale: 0.2 }
    expect(campaignConfigSchema.safeParse({ characterSlots: [slot, slot, slot, slot] }).success).toBe(false)
  })

  it('convierte selecciones guardadas con un solo personaje', () => {
    expect(normalizeSelections({ scenarioId: 's', characterId: 'c', frameId: null })).toEqual({
      scenarioId: 's',
      characterIds: ['c'],
      frameId: null
    })
    expect(normalizeSelections({ scenarioId: 's', characterId: null, frameId: 'f' }).characterIds).toEqual([])
  })
})
