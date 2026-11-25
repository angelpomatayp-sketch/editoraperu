import type { FractionRect } from './compositionPlan'

export interface PersonMeasurement {
  box: FractionRect
  clippedTop: boolean
  clippedBottom: boolean
  clippedSide: boolean
}

/** Confianza mínima del modelo para considerar un píxel parte de la persona. */
const THRESHOLD = 0.55

/**
 * Contorno fiable de la persona a partir de la máscara de confianza:
 * - ignora motas aisladas (filas/columnas con cobertura mínima);
 * - toma el tramo vertical continuo más grande (tolera huecos pequeños entre brazos y piernas);
 * - mide el ancho solo dentro de ese tramo, para que ruido fuera del cuerpo no infle la caja.
 * Devuelve `null` si casi no hay persona. Los avisos de corte permiten no comparar alturas incompletas.
 */
export function measurePerson(values: Float32Array, width: number, height: number): PersonMeasurement | null {
  if (!(width > 0 && height > 0) || values.length < width * height) return null
  const rows = new Uint32Array(height)
  for (let y = 0; y < height; y++) {
    let count = 0
    const base = y * width
    for (let x = 0; x < width; x++) if (values[base + x]! > THRESHOLD) count++
    rows[y] = count
  }
  const minRow = Math.max(2, Math.round(width * 0.012))
  const maxGap = Math.max(2, Math.round(height * 0.03))
  let bestStart = -1
  let bestEnd = -1
  let bestCount = 0
  let start = -1
  let end = -1
  let count = 0
  let gap = 0
  for (let y = 0; y < height; y++) {
    if (rows[y]! >= minRow) {
      if (start < 0) { start = y; count = 0 }
      end = y
      count += rows[y]!
      gap = 0
    } else if (start >= 0) {
      gap++
      if (gap > maxGap) {
        if (count > bestCount) { bestCount = count; bestStart = start; bestEnd = end }
        start = -1
        gap = 0
      }
    }
  }
  if (start >= 0 && count > bestCount) { bestCount = count; bestStart = start; bestEnd = end }
  if (bestStart < 0 || bestCount < width * height * 0.005) return null

  const bandHeight = bestEnd - bestStart + 1
  const cols = new Uint32Array(width)
  for (let y = bestStart; y <= bestEnd; y++) {
    const base = y * width
    for (let x = 0; x < width; x++) if (values[base + x]! > THRESHOLD) cols[x]++
  }
  const minCol = Math.max(2, Math.round(bandHeight * 0.02))
  let minX = -1
  let maxX = -1
  for (let x = 0; x < width; x++) {
    if (cols[x]! < minCol) continue
    if (minX < 0) minX = x
    maxX = x
  }
  if (minX < 0) return null
  return {
    box: { x: minX / width, y: bestStart / height, width: (maxX + 1 - minX) / width, height: bandHeight / height },
    clippedTop: bestStart <= 1,
    clippedBottom: bestEnd >= height - 2,
    clippedSide: minX <= 1 || maxX >= width - 2
  }
}
