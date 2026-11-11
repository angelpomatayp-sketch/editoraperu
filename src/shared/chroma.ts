import { z } from 'zod'

/**
 * Método para quitar el fondo de la captura:
 * - `segmentation`: recorte automático de la persona con modelos locales (MediaPipe y MODNet).
 *   Usa inteligencia artificial: cambio de alcance pendiente de aprobación (sección 19).
 * - `chroma`: fondo verde detrás del participante, sin IA.
 * - `none`: la captura se usa completa.
 */
export const BACKGROUND_METHODS = ['segmentation', 'chroma', 'none'] as const
export type BackgroundMethod = (typeof BACKGROUND_METHODS)[number]

/**
 * Recorte por fondo verde (croma). No usa inteligencia artificial: cada píxel se vuelve transparente
 * según qué tan cerca está su color del color de fondo configurado. Se calibra para la iluminación
 * del lugar donde se instala el tótem.
 */
export const chromaSchema = z.object({
  /** Color del fondo, en formato #rrggbb. */
  keyColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  /** Distancia de color por debajo de la cual el píxel es fondo (0 a 1). */
  similarity: z.number().min(0).max(1),
  /** Franja de transición para bordes suaves (0 a 1). */
  smoothness: z.number().min(0.001).max(1),
  /** Cuánto se reduce el reflejo verde sobre la persona (0 a 1). */
  spill: z.number().min(0).max(1)
})
export type ChromaSettings = z.infer<typeof chromaSchema>

export const DEFAULT_CHROMA: ChromaSettings = {
  keyColor: '#00b140',
  similarity: 0.16,
  smoothness: 0.08,
  spill: 0.6
}

/** Color verde dominante del borde de una imagen y proporción de borde que ocupa. */
export interface DetectedGreenScreen {
  keyColor: string
  ratio: number
}

/**
 * Detecta el verde real usado por un generador o estudio. Los videos generados suelen usar
 * #00ff00, mientras que un ciclorama físico suele acercarse a #00b140; calibrar desde el borde
 * evita asumir uno de esos tonos y permite recortar ambos correctamente.
 */
export function detectGreenScreen(
  pixels: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number
): DetectedGreenScreen | null {
  if (!width || !height || pixels.length < width * height * 4) return null
  const border = Math.max(2, Math.round(Math.min(width, height) * 0.04))
  const step = Math.max(1, Math.floor(Math.min(width, height) / 540))
  let red = 0
  let green = 0
  let blue = 0
  let matches = 0
  let samples = 0
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      if (x >= border && x < width - border && y >= border && y < height - border) continue
      const i = (y * width + x) * 4
      const r = pixels[i]!
      const g = pixels[i + 1]!
      const b = pixels[i + 2]!
      // Una pose ya reparada conserva RGB bajo los píxeles transparentes; no debe procesarse otra vez.
      if (pixels[i + 3]! < 128) continue
      samples++
      if (g <= 45 || g <= r * 1.18 || g <= b * 1.15) continue
      red += r
      green += g
      blue += b
      matches++
    }
  }
  if (!samples || !matches) return null
  const hex = (value: number) => Math.round(value / matches).toString(16).padStart(2, '0')
  return { keyColor: `#${hex(red)}${hex(green)}${hex(blue)}`, ratio: matches / samples }
}

export function hexToRgb(hex: string): [number, number, number] {
  const value = parseInt(hex.slice(1), 16)
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255]
}

/** Componentes de color (Cb, Cr) de BT.601, normalizados a 0..1. Separan el color del brillo. */
export function chromaOf(r: number, g: number, b: number): [number, number] {
  const cb = (-0.168736 * r - 0.331264 * g + 0.5 * b) / 255 + 0.5
  const cr = (0.5 * r - 0.418688 * g - 0.081312 * b) / 255 + 0.5
  return [cb, cr]
}

/**
 * Aplica el croma sobre píxeles RGBA en el lugar: ajusta la transparencia y reduce el reflejo verde.
 * La distancia se mide solo en color (Cb, Cr), así las sombras sobre el fondo también se eliminan.
 */
export function applyChromaKey(pixels: Uint8Array | Uint8ClampedArray, settings: ChromaSettings): void {
  const [kr, kg, kb] = hexToRgb(settings.keyColor)
  const [kcb, kcr] = chromaOf(kr, kg, kb)
  const { similarity, smoothness, spill } = settings

  for (let i = 0; i < pixels.length; i += 4) {
    const r = pixels[i]!
    const g = pixels[i + 1]!
    const b = pixels[i + 2]!
    const [cb, cr] = chromaOf(r, g, b)
    const distance = Math.hypot(cb - kcb, cr - kcr)
    // La distancia cromática por sí sola confunde azules oscuros y negros con un verde sombreado.
    // Solo un píxel en el que el canal verde realmente domina puede pertenecer al fondo croma.
    const greenDominant = g > r && g > b
    const alpha = greenDominant ? Math.min(1, Math.max(0, (distance - similarity) / smoothness)) : 1
    pixels[i + 3] = Math.round(alpha * pixels[i + 3]!)

    // Reflejo verde: el verde no puede superar mucho al mayor de rojo y azul.
    const limit = Math.max(r, b)
    if (g > limit) pixels[i + 1] = Math.round(limit + (g - limit) * (1 - spill))
  }
}
