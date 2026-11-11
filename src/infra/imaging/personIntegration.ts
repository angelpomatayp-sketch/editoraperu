import sharp from './sharpSetup'

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value))

/** Luminancia sRGB aproximada, suficiente para una corrección fotográfica deliberadamente leve. */
const luminance = (r: number, g: number, b: number): number => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255

/**
 * Integra el recorte con el escenario sin reinterpretar la fotografía:
 * - acerca suavemente la luminosidad de la persona a la del escenario;
 * - en el borde semitransparente sustituye parte del color del antiguo fondo por colores opacos
 *   cercanos de la propia persona (descontaminación de borde).
 * Los píxeles opacos —rostro, ropa y piel— conservan sus colores salvo la corrección global limitada.
 */
export function integratePerson(rgb: Buffer, alpha: Uint8Array, width: number, height: number, sceneLuma?: number): Buffer {
  const output = Buffer.from(rgb)
  let sum = 0
  let count = 0
  const sampleStep = Math.max(1, Math.floor((width * height) / 300_000))
  for (let i = 0; i < alpha.length; i += sampleStep) {
    if (alpha[i]! < 224) continue
    sum += luminance(rgb[i * 3]!, rgb[i * 3 + 1]!, rgb[i * 3 + 2]!)
    count++
  }

  if (count > 0 && sceneLuma !== undefined) {
    const personLuma = sum / count
    const desired = clamp(sceneLuma, 0.28, 0.72)
    // Solo se recorre el 30 % de la diferencia y nunca se altera más de ±14 %.
    const brightness = clamp(1 + (desired / Math.max(0.08, personLuma) - 1) * 0.3, 0.88, 1.14)
    if (Math.abs(brightness - 1) > 0.005) {
      for (let i = 0; i < alpha.length; i++) {
        if (alpha[i]! <= 8) continue
        const offset = i * 3
        output[offset] = clamp(Math.round(output[offset]! * brightness), 0, 255)
        output[offset + 1] = clamp(Math.round(output[offset + 1]! * brightness), 0, 255)
        output[offset + 2] = clamp(Math.round(output[offset + 2]! * brightness), 0, 255)
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
