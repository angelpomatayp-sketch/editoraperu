import sharp from './sharpSetup'
import type { FractionRect } from '../../shared/compositionPlan'

export interface CharacterAnalysis {
  /** Rectángulo de píxeles visibles, expresado como fracciones del lienzo original. */
  bounds: FractionRect
  /** Punto de apoyo para giros y balanceos; normalmente, el centro entre los pies. */
  anchorX: number
  anchorY: number
}

const DEFAULT_ANALYSIS: CharacterAnalysis = {
  bounds: { x: 0, y: 0, width: 1, height: 1 },
  anchorX: 0.5,
  anchorY: 1
}

/** Analiza el canal alfa sin IA. Los píxeles casi transparentes no cuentan como silueta. */
export async function analyzeCharacter(file: string): Promise<CharacterAnalysis> {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const { width, height, channels } = info
  if (!(width > 0 && height > 0) || channels < 4) return DEFAULT_ANALYSIS

  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1
  const visible = (x: number, y: number) => data[(y * width + x) * channels + 3]! >= 16
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!visible(x, y)) continue
      minX = Math.min(minX, x)
      maxX = Math.max(maxX, x)
      minY = Math.min(minY, y)
      maxY = Math.max(maxY, y)
    }
  }
  if (maxX < minX || maxY < minY) return DEFAULT_ANALYSIS

  // En la franja inferior de la silueta se encuentran normalmente los pies. Usar el centro del
  // conjunto visible funciona también con dos pies separados y evita que una manga desplace el eje.
  const bandTop = Math.max(minY, maxY - Math.max(1, Math.round((maxY - minY + 1) * 0.04)))
  let supportMinX = width
  let supportMaxX = -1
  for (let y = bandTop; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      if (!visible(x, y)) continue
      supportMinX = Math.min(supportMinX, x)
      supportMaxX = Math.max(supportMaxX, x)
    }
  }
  const supportX = supportMaxX >= supportMinX ? (supportMinX + supportMaxX + 1) / 2 : (minX + maxX + 1) / 2
  return {
    bounds: { x: minX / width, y: minY / height, width: (maxX - minX + 1) / width, height: (maxY - minY + 1) / height },
    anchorX: supportX / width,
    anchorY: (maxY + 1) / height
  }
}
