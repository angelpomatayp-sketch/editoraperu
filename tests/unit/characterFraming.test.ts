import { describe, expect, it } from 'vitest'
import { characterFrameTarget } from '../../src/shared/characterFraming'
import { DEFAULT_FREE_PLACEMENT, type CharacterOption } from '../../src/shared/campaign'
import { autoFrame, AUTO_FRAME, sanitizePlacement, type FractionRect, type FramePlacement } from '../../src/shared/compositionPlan'

const output = { width: 1000, height: 2000 }
const region = { x: 0.1, y: 0.1, width: 0.5, height: 0.8, layer: 10 }
const character: CharacterOption = {
  id: 'uno', name: 'Uno', imageUrl: 'uno.png', width: 1000, height: 2000, layer: 20,
  scenarioIds: [], animationUrl: 'uno.webm', animationDurationMs: null, animationBackground: 'alpha',
  entryDirection: 'auto', contentBounds: { x: 0.2, y: 0.1, width: 0.5, height: 0.8 }, anchorX: 0.5, anchorY: 0.9
}
const detail = {
  characters: [character, { ...character, id: 'dos' }],
  characterSlots: [{ x: 0.5, y: 0.3, scale: 0.4 }],
  freePlacement: DEFAULT_FREE_PLACEMENT,
  characterVideoTransforms: { uno: { scale: 0.5, x: 0, y: -0.1 }, dos: { scale: 0.8, x: 0, y: -0.1 } }
}

describe('referencia del personaje para el participante', () => {
  it('usa el tamaño y desplazamiento del video y descarta los márgenes transparentes', () => {
    // Cuadro: y=800, alto=1000. Silueta: y=900..1700. Zona: y=200..1800.
    const target = characterFrameTarget(detail, ['uno'], region, output)!
    expect(target.height).toBeCloseTo(800 / 1600)
    expect(target.baseline).toBeCloseTo(1500 / 1600)
  })

  it('subir o bajar al personaje modifica el apoyo, no su altura', () => {
    const target = characterFrameTarget(detail, ['uno'], region, output)!
    const moved = characterFrameTarget({ ...detail, characterVideoTransforms: { uno: { scale: 0.5, x: 0, y: -0.2 } } }, ['uno'], region, output)!
    expect(moved.height).toBeCloseTo(target.height)
    expect(moved.baseline).toBeCloseTo(target.baseline - 200 / 1600)
  })

  it('los personajes estáticos usan la posición y escala de su casilla', () => {
    const target = characterFrameTarget({ ...detail, characters: [{ ...character, animationUrl: null }] }, ['uno'], region, output)!
    // Cuadro y=600, alto=800; silueta de 640, apoyo en 1320.
    expect(target.height).toBeCloseTo(640 / 1600)
    expect(target.baseline).toBeCloseTo(1120 / 1600)
  })

  it('con varios personajes toma siempre el primero seleccionado', () => {
    expect(characterFrameTarget(detail, ['uno', 'dos'], region, output)).toEqual(characterFrameTarget(detail, ['uno'], region, output))
    expect(characterFrameTarget(detail, ['dos', 'uno'], region, output)).not.toEqual(characterFrameTarget(detail, ['uno'], region, output))
  })

  it('mantiene las mismas proporciones en la vista previa y en la salida 4K', () => {
    expect(characterFrameTarget(detail, ['uno'], region, output)).toEqual(characterFrameTarget(detail, ['uno'], region, { width: 2000, height: 4000 }))
  })

  it('sin selección o con datos no utilizables no altera el encuadre habitual', () => {
    expect(characterFrameTarget(detail, [], region, output)).toBeNull()
    expect(characterFrameTarget(detail, ['desconocido'], region, output)).toBeNull()
    expect(characterFrameTarget({ ...detail, characterSlots: [] }, ['uno'], region, output)).toBeNull()
    expect(characterFrameTarget({ ...detail, characters: [{ ...character, contentBounds: { x: 0, y: 0, width: 1, height: NaN } }] }, ['uno'], region, output)).toBeNull()
    expect(characterFrameTarget({ ...detail, characterVideoTransforms: { uno: { scale: 1, x: 0, y: 0.3 } } }, ['uno'], region, output)).toBeNull()
    expect(characterFrameTarget(detail, ['uno'], { ...region, y: 0.9, height: 0.1 }, output)).toBeNull()
  })
})

/** Rectángulo de la persona una vez aplicada la misma transformación que usa el canvas/Sharp. */
function placedPerson(person: FractionRect, p: FramePlacement): FractionRect {
  return {
    x: p.box.x + (person.x - p.crop.x) * p.box.width / p.crop.width,
    y: p.box.y + (person.y - p.crop.y) * p.box.height / p.crop.height,
    width: person.width * p.box.width / p.crop.width,
    height: person.height * p.box.height / p.crop.height
  }
}

describe('ajuste de altura y apoyo del participante', () => {
  const person = { x: 0.4, y: 0.1, width: 0.2, height: 0.8 }
  const camera = [1000, 2000] as const
  const zone = [500, 1600] as const
  const target = { height: 0.5, baseline: 0.8 }

  it('reduce incluso por debajo del encuadre de imagen completa, sin deformar', () => {
    const p = autoFrame(person, ...camera, ...zone, { ...target, height: 0.3 })!
    const shown = placedPerson(person, p)
    expect(shown.height).toBeCloseTo(0.3)
    expect(shown.y + shown.height).toBeCloseTo(0.8)
    expect(shown.x + shown.width / 2).toBeCloseTo(0.5)
    const scaleX = p.box.width * zone[0] / (p.crop.width * camera[0])
    const scaleY = p.box.height * zone[1] / (p.crop.height * camera[1])
    expect(scaleX).toBeCloseTo(scaleY)
    expect(scaleY).toBeLessThan(Math.min(zone[0] / camera[0], zone[1] / camera[1]))
    expect(sanitizePlacement(p)).toEqual(p)
  })

  it('agranda una persona más alejada hasta la referencia y conserva el apoyo', () => {
    const distant = { x: 0.45, y: 0.4, width: 0.1, height: 0.4 }
    const p = autoFrame(distant, ...camera, ...zone, target)!
    const shown = placedPerson(distant, p)
    expect(shown.height).toBeCloseTo(target.height)
    expect(shown.y + shown.height).toBeCloseTo(target.baseline)
  })

  it('respeta margen superior, apoyo inferior y ancho de la zona aunque el personaje sea mayor', () => {
    const wide = { x: 0.1, y: 0.15, width: 0.8, height: 0.7 }
    for (const p of [person, wide]) {
      const shown = placedPerson(p, autoFrame(p, ...camera, ...zone, { height: 2, baseline: 1.3 })!)
      expect(shown.y).toBeGreaterThanOrEqual(AUTO_FRAME.headroom - 1e-9)
      expect(shown.x).toBeGreaterThanOrEqual(AUTO_FRAME.sideMargin - 1e-9)
      expect(shown.x + shown.width).toBeLessThanOrEqual(1 - AUTO_FRAME.sideMargin + 1e-9)
      expect(shown.y + shown.height).toBeCloseTo(1 - AUTO_FRAME.footroom)
    }
  })

  it('limita la ampliación para no forzar la nitidez', () => {
    const small = { x: 0.45, y: 0.4, width: 0.1, height: 0.16 }
    const p = autoFrame(small, 640, 480, ...zone, target)!
    expect(p.box.height * zone[1] / (p.crop.height * 480)).toBeCloseTo(AUTO_FRAME.maxUpscale)
    expect(placedPerson(small, p).height).toBeLessThan(target.height)
  })

  it('no compara alturas si la silueta está cortada por la cámara', () => {
    for (const clipped of [{ ...person, y: 0 }, { ...person, height: 0.9 }, { ...person, x: 0 }]) {
      expect(autoFrame(clipped, ...camera, ...zone, target)).toBeNull()
      // El modo anterior no cambia al desactivar la nueva opción.
      expect(autoFrame(clipped, ...camera, ...zone)).not.toBeNull()
    }
  })

  it('conserva exactamente el comportamiento anterior sin referencia', () => {
    expect(autoFrame(person, ...camera, ...zone, null)).toEqual(autoFrame(person, ...camera, ...zone))
  })

  it('rechaza entradas inválidas sin producir geometría no finita', () => {
    expect(autoFrame(person, 0, 2000, ...zone, target)).toBeNull()
    expect(autoFrame({ ...person, height: NaN }, ...camera, ...zone, target)).toBeNull()
    expect(autoFrame(person, ...camera, ...zone, { ...target, height: -1 })).toBeNull()
    expect(autoFrame(person, ...camera, ...zone, { ...target, baseline: Infinity })).toBeNull()
    expect(autoFrame(person, ...camera, ...zone, { ...target, height: 0.0001 })).toBeNull()
  })
})
