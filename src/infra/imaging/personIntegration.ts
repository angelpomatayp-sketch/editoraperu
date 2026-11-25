import sharp from './sharpSetup'

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value))

/** Luminancia sRGB aproximada, suficiente para una corrección fotográfica deliberadamente leve. */
const luminance = (r: number, g: number, b: number): number => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255

/** Referencia visual calculada de los recursos elegidos, siempre en rangos normalizados. */
export interface PhotoTone {
  luminance: number
  /** Positivo = cálido (más rojo); negativo = frío (más azul). */
  warmth: number
}

/**
 * Integra el recorte con el escenario sin reinterpretar la fotografía:
 * - acerca suavemente la luminosidad de la persona a la del escenario;
 * - en el borde semitransparente sustituye parte del color del antiguo fondo por colores opacos
 *   cercanos de la propia persona (descontaminación de borde).
 * Los píxeles opacos —rostro, ropa y piel— conservan sus colores salvo la corrección global limitada.
 */
export function integratePerson(rgb: Buffer, alpha: Uint8Array, width: number, height: number, tone?: PhotoTone): Buffer {
  const output = Buffer.from(rgb)
  let sum = 0
  let red = 0
  let blue = 0
  let count = 0
  const sampleStep = Math.max(1, Math.floor((width * height) / 300_000))
  for (let i = 0; i < alpha.length; i += sampleStep) {
    if (alpha[i]! < 224) continue
    sum += luminance(rgb[i * 3]!, rgb[i * 3 + 1]!, rgb[i * 3 + 2]!)
    red += rgb[i * 3]!
    blue += rgb[i * 3 + 2]!
    count++
  }

  if (count > 0 && tone) {
    const personLuma = sum / count
    const desired = clamp(tone.luminance, 0.28, 0.72)
    // Solo se recorre el 30 % de la diferencia y nunca se altera más de ±14 %.
    const brightness = clamp(1 + (desired / Math.max(0.08, personLuma) - 1) * 0.3, 0.88, 1.14)
    // Temperatura deliberadamente sutil: acerca la persona al ambiente/personajes sin falsear piel.
    const personWarmth = (red / count - blue / count) / 255
    const warmth = clamp((clamp(tone.warmth, -0.18, 0.18) - personWarmth) * 0.18, -0.035, 0.035)
    if (Math.abs(brightness - 1) > 0.005 || Math.abs(warmth) > 0.002) {
      for (let i = 0; i < alpha.length; i++) {
        if (alpha[i]! <= 8) continue
        const offset = i * 3
        output[offset] = clamp(Math.round(output[offset]! * brightness * (1 + warmth)), 0, 255)
        output[offset + 1] = clamp(Math.round(output[offset + 1]! * brightness), 0, 255)
        output[offset + 2] = clamp(Math.round(output[offset + 2]! * brightness * (1 - warmth)), 0, 255)
      }
    }
  }

  // En salida 4K, los bordes suaves pueden extenderse más que los 10 px del ajuste HD anterior.
  // Buscar más lejos permite reemplazar el color del fondo por el de la propia persona antes de
  // componer sobre cualquier escenario, sin usar su color para decidir la máscara.
  const radius = clamp(Math.round(Math.min(width, height) * 0.01), 6, 28)
  const directions = [
    [-1, 0], [1, 0], [0, -1], [0, 1],
    [-1, -1], [1, -1], [-1, 1], [1, 1]
  ] as const

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = y * width + x
      const a = alpha[index]!
      if (a <= 12 || a >= 244) continue

      let red = 0
      let green = 0
      let blue = 0
      let weight = 0
      for (const [dx, dy] of directions) {
        for (let distance = 1; distance <= radius; distance++) {
          const sx = x + dx * distance
          const sy = y + dy * distance
          if (sx < 0 || sy < 0 || sx >= width || sy >= height) break
          const sample = sy * width + sx
          if (alpha[sample]! < 244) continue
          const w = 1 / distance
          const offset = sample * 3
          red += output[offset]! * w
          green += output[offset + 1]! * w
          blue += output[offset + 2]! * w
          weight += w
          break
        }
      }
      if (!weight) continue

      const offset = index * 3
      // Cuanto más transparente era el borde, más color del fondo contenía el píxel original.
      const mix = Math.min(0.82, (1 - a / 255) * 0.92)
      output[offset] = Math.round(output[offset]! * (1 - mix) + (red / weight) * mix)
      output[offset + 1] = Math.round(output[offset + 1]! * (1 - mix) + (green / weight) * mix)
      output[offset + 2] = Math.round(output[offset + 2]! * (1 - mix) + (blue / weight) * mix)
    }
  }

  return output
}

/** Perfil de color y luz de la escena, medido del escenario y los personajes (valores normalizados 0..1). */
export interface SceneColorProfile {
  red: number
  green: number
  blue: number
  luminance: number
  /** Saturación media (0..1). */
  saturation: number
  /** Contraste: desviación típica de la luminancia. */
  contrast: number
  /** Luz cenital: positivo si la mitad superior de la escena es más clara (cielo, sol). */
  skyLight: number
}

/**
 * Filtro avanzado de color: integra a la persona recortada en la luz y el ambiente de la escena.
 * A diferencia de la corrección básica de `integratePerson`, además del brillo y la temperatura
 * acerca el tono general (dominante de color), la saturación y el contraste a los de la escena,
 * y aplica un gradiente suave de luz vertical si la escena tiene el cielo más claro (luz de sol).
 * Todas las ganancias están limitadas para no falsear la piel ni quemar la imagen.
 */
export function applySceneColorGrade(rgb: Buffer, alpha: Uint8Array, width: number, height: number, scene: SceneColorProfile): Buffer {
  const output = Buffer.from(rgb)

  // Estadísticas de la persona: solo píxeles opacos (rostro, ropa, piel), muestreados por velocidad.
  let sum = 0
  let sumSq = 0
  let red = 0
  let green = 0
  let blue = 0
  let sat = 0
  let count = 0
  const sampleStep = Math.max(1, Math.floor((width * height) / 300_000))
  for (let i = 0; i < alpha.length; i += sampleStep) {
    if (alpha[i]! < 224) continue
    const r = rgb[i * 3]!
    const g = rgb[i * 3 + 1]!
    const b = rgb[i * 3 + 2]!
    const l = luminance(r, g, b)
    sum += l
    sumSq += l * l
    red += r
    green += g
    blue += b
    const max = Math.max(r, g, b)
    sat += max > 0 ? (max - Math.min(r, g, b)) / max : 0
    count++
  }
  if (count === 0) return output

  const personLuma = sum / count
  const personContrast = Math.sqrt(Math.max(0, sumSq / count - personLuma * personLuma))
  const personSat = sat / count
  const pr = red / count / 255
  const pg = green / count / 255
  const pb = blue / count / 255

  // Brillo: se recorre el 50 % de la diferencia con la escena, nunca más de ±30 %.
  const desired = clamp(scene.luminance, 0.25, 0.75)
  const brightness = clamp(1 + (desired / Math.max(0.08, personLuma) - 1) * 0.5, 0.78, 1.3)

  // Dominante de color (cromaticidad, sin brillo): acerca el tono global al ambiente de la escena.
  const personTotal = Math.max(1e-4, pr + pg + pb)
  const sceneTotal = Math.max(1e-4, scene.red + scene.green + scene.blue)
  const castR = clamp(1 + (scene.red / sceneTotal / Math.max(1e-4, pr / personTotal) - 1) * 0.35, 0.85, 1.18)
  const castG = clamp(1 + (scene.green / sceneTotal / Math.max(1e-4, pg / personTotal) - 1) * 0.35, 0.85, 1.18)
  const castB = clamp(1 + (scene.blue / sceneTotal / Math.max(1e-4, pb / personTotal) - 1) * 0.35, 0.85, 1.18)

  // Saturación y contraste acercados a la escena, con topes suaves.
  const saturation = clamp(1 + (clamp(scene.saturation, 0, 0.8) / Math.max(0.05, personSat) - 1) * 0.35, 0.75, 1.3)
  const contrast = clamp(1 + (clamp(scene.contrast, 0.05, 0.35) / Math.max(0.04, personContrast) - 1) * 0.25, 0.9, 1.15)

  // Luz direccional: si el cielo de la escena es más claro, la persona recibe más luz arriba (sol),
  // con un tinte cálido muy leve en la parte iluminada, según la temperatura de la escena.
  const sky = clamp(scene.skyLight, -0.25, 0.25) * 0.3
  const warmth = clamp(scene.red - scene.blue, -0.18, 0.18)

  for (let y = 0; y < height; y++) {
    const vertical = 1 - (2 * y) / height
    const light = 1 + sky * vertical
    const litWarmth = warmth * 0.25 * Math.max(0, vertical)
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      if (alpha[i]! <= 8) continue
      const o = i * 3
      let r = output[o]! * brightness * castR * light * (1 + litWarmth)
      let g = output[o + 1]! * brightness * castG * light
      let b = output[o + 2]! * brightness * castB * light * (1 - litWarmth)
      // Contraste alrededor del gris medio.
      r = 127.5 + (r - 127.5) * contrast
      g = 127.5 + (g - 127.5) * contrast
      b = 127.5 + (b - 127.5) * contrast
      // Saturación alrededor de la luminancia del propio píxel.
      const l = 0.2126 * r + 0.7152 * g + 0.0722 * b
      output[o] = clamp(Math.round(l + (r - l) * saturation), 0, 255)
      output[o + 1] = clamp(Math.round(l + (g - l) * saturation), 0, 255)
      output[o + 2] = clamp(Math.round(l + (b - l) * saturation), 0, 255)
    }
  }
  return output
}

export interface ContactShadow {
  input: Buffer
  left: number
  top: number
  width: number
  height: number
}

/** Sombra elíptica muy suave bajo los pies; no duplica ni perfila toda la silueta. */
export async function contactShadow(alpha: Uint8Array, width: number, height: number): Promise<ContactShadow | null> {
  let minX = width
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (alpha[y * width + x]! < 160) continue
      minX = Math.min(minX, x)
      maxX = Math.max(maxX, x)
      maxY = y
    }
  }
  if (maxX < minX || maxY < 0) return null

  const personWidth = maxX - minX + 1
  const ellipseWidth = Math.max(24, Math.round(personWidth * 0.52))
  const ellipseHeight = Math.max(10, Math.min(Math.round(height * 0.018), Math.round(ellipseWidth * 0.16)))
  const padding = Math.max(4, Math.round(ellipseHeight * 0.8))
  const shadowWidth = ellipseWidth + padding * 2
  const shadowHeight = ellipseHeight + padding * 2
  const centerX = (minX + maxX) / 2
  const left = Math.round(centerX - shadowWidth / 2)
  const top = Math.round(maxY - ellipseHeight / 2 - padding)
  const svg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${shadowWidth}" height="${shadowHeight}">` +
      `<ellipse cx="${shadowWidth / 2}" cy="${shadowHeight / 2}" rx="${ellipseWidth / 2}" ry="${ellipseHeight / 2}" fill="#000" fill-opacity="0.24"/>` +
    `</svg>`
  )
  const input = await sharp(svg).blur(Math.max(0.4, ellipseHeight * 0.32)).png().toBuffer()
  return { input, left, top, width: shadowWidth, height: shadowHeight }
}
