import sharp from './sharpSetup'
import type { FractionRect } from '../../shared/compositionPlan'

/** Lado de la versión reducida en la que se busca la zona: suficiente para ubicarla y muy rápido. */
const ANALYSIS_SIDE = 320
/** Por debajo de esta opacidad (0 a 255) el píxel se considera transparente. */
const ALPHA_THRESHOLD = 128
/** Zonas más pequeñas (fracción de la imagen) se ignoran: bordes suaves o restos del diseño. */
const MIN_AREA = 0.02

/**
 * Zona transparente de un escenario («hueco» donde va la foto del participante), como rectángulo en
 * fracciones de la imagen: la zona más grande junto con las partes cercanas del mismo hueco (un titular
 * opaco puede partirlo). Devuelve `null` si la imagen no tiene transparencia o la zona es demasiado
 * pequeña. El rectángulo se amplía un píxel de análisis para cubrir el borde: lo que sobra queda
 * tapado por el escenario, que va encima de la foto.
 */
export async function detectPhotoHole(file: string): Promise<FractionRect | null> {
  const meta = await sharp(file).metadata()
  if (!meta.hasAlpha) return null

  const { data, info } = await sharp(file)
    .resize(ANALYSIS_SIDE, ANALYSIS_SIDE, { fit: 'inside' })
    .ensureAlpha()
    .extractChannel(3)
    .raw()
    .toBuffer({ resolveWithObject: true })
  return largestTransparentRect(data, info.width, info.height)
}

/** Partes más pequeñas (fracción de la imagen) no se unen a la zona: restos sueltos del diseño. */
const MIN_PART = 0.001
/** Distancia (fracción de la imagen) hasta la que otra parte transparente se considera del mismo hueco. */
const JOIN_DISTANCE = 0.05

interface Part {
  area: number
  x0: number
  y0: number
  x1: number
  y1: number
}

/**
 * Rectángulo de la zona transparente principal de un canal alfa: la mayor zona conectada (vecinos en
 * cruz) más las partes cercanas que un titular o una franja opaca separaron del mismo hueco.
 */
export function largestTransparentRect(alpha: Uint8Array, width: number, height: number): FractionRect | null {
  const seen = new Uint8Array(width * height)
  const stack = new Int32Array(width * height)
  const parts: Part[] = []

  for (let start = 0; start < alpha.length; start++) {
    if (seen[start] || alpha[start]! >= ALPHA_THRESHOLD) continue
    let top = 0
    stack[top++] = start
    seen[start] = 1
    const part: Part = { area: 0, x0: width, y0: height, x1: -1, y1: -1 }
    while (top > 0) {
      const i = stack[--top]!
      const x = i % width
      const y = (i - x) / width
      part.area++
      if (x < part.x0) part.x0 = x
      if (x > part.x1) part.x1 = x
      if (y < part.y0) part.y0 = y
      if (y > part.y1) part.y1 = y
      const push = (n: number) => {
        if (!seen[n] && alpha[n]! < ALPHA_THRESHOLD) {
          seen[n] = 1
          stack[top++] = n
        }
      }
      if (x > 0) push(i - 1)
      if (x < width - 1) push(i + 1)
      if (y > 0) push(i - width)
      if (y < height - 1) push(i + width)
    }
    parts.push(part)
  }

  parts.sort((a, b) => b.area - a.area)
  const main = parts[0]
  if (!main || main.area < MIN_AREA * width * height) return null

  // Se unen las partes cercanas al hueco principal, repitiendo mientras el rectángulo crezca.
  const box = { ...main }
  const reachX = JOIN_DISTANCE * width
  const reachY = JOIN_DISTANCE * height
  const pending = parts.slice(1).filter((p) => p.area >= MIN_PART * width * height)
  let grew = true
  while (grew) {
    grew = false
    for (let k = pending.length - 1; k >= 0; k--) {
      const p = pending[k]!
      const near = p.x0 <= box.x1 + reachX && p.x1 >= box.x0 - reachX && p.y0 <= box.y1 + reachY && p.y1 >= box.y0 - reachY
      if (!near) continue
      box.x0 = Math.min(box.x0, p.x0)
      box.y0 = Math.min(box.y0, p.y0)
      box.x1 = Math.max(box.x1, p.x1)
      box.y1 = Math.max(box.y1, p.y1)
      pending.splice(k, 1)
      grew = true
    }
  }

  const left = Math.max(0, box.x0 - 1)
  const topEdge = Math.max(0, box.y0 - 1)
  const right = Math.min(width, box.x1 + 2)
  const bottom = Math.min(height, box.y1 + 2)
  return { x: left / width, y: topEdge / height, width: (right - left) / width, height: (bottom - topEdge) / height }
}
