import { sanitizePlacement, type FractionRect, type FramePlacement } from './compositionPlan'

export interface PersonSmootherOptions {
  /** Cuadros de la ventana de mediana de la altura. */
  window?: number
  /** Constante de tiempo del tamaño (ms): mayor = más estable, menos rebote. */
  sizeTauMs?: number
  /** Constante de tiempo de la posición (ms): sigue al visitante sin arrastrar el tamaño. */
  moveTauMs?: number
  /** Cambio relativo de altura que se ignora (banda muerta). */
  deadband?: number
  /** Salto relativo de altura considerado atípico. */
  outlierRatio?: number
  /** Ms que debe sostenerse un salto atípico para aceptarse (acercarse/alejarse de verdad). */
  confirmMs?: number
}

const lerp = (a: number, b: number, k: number): number => a + (b - a) * k
const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = sorted.length >> 1
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2
}

/**
 * Estabiliza la caja de la persona en tiempo real: mediana móvil contra el parpadeo de la máscara,
 * banda muerta para que el tamaño no «respire», y confirmación temporal antes de aceptar un cambio
 * grande de altura. La posición se sigue rápido; el tamaño, lento y sin saltos.
 */
export class PersonBoxSmoother {
  private state: FractionRect | null = null
  private heights: number[] = []
  private pending: { value: number; since: number } | null = null
  private lastNow = 0

  constructor(private readonly opts: PersonSmootherOptions = {}) {}

  current(): FractionRect | null { return this.state }

  reset(): void {
    this.state = null
    this.heights = []
    this.pending = null
    this.lastNow = 0
  }

  update(raw: FractionRect, now: number): FractionRect {
    const { window = 5, sizeTauMs = 600, moveTauMs = 140, deadband = 0.015, outlierRatio = 0.25, confirmMs = 450 } = this.opts
    this.heights.push(raw.height)
    if (this.heights.length > window) this.heights.shift()
    if (!this.state) {
      this.state = { ...raw }
      this.lastNow = now
      return this.state
    }
    const dt = Math.min(250, Math.max(1, now - this.lastNow))
    this.lastNow = now
    let height = median(this.heights)
    const relative = Math.abs(height - this.state.height) / Math.max(1e-6, this.state.height)
    if (relative > outlierRatio) {
      const sustained = this.pending
        && Math.abs(height - this.pending.value) / this.pending.value < 0.1
        && now - this.pending.since >= confirmMs
      if (sustained) {
        this.heights = Array.from({ length: window }, () => height)
        this.pending = null
      } else {
        this.pending ??= { value: height, since: now }
        height = this.state.height
      }
    } else {
      this.pending = null
    }
    if (Math.abs(height - this.state.height) / Math.max(1e-6, this.state.height) <= deadband) height = this.state.height
    const kSize = 1 - Math.exp(-dt / sizeTauMs)
    const kMove = 1 - Math.exp(-dt / moveTauMs)
    const h = lerp(this.state.height, height, kSize)
    const w = lerp(this.state.width, raw.width, kSize)
    const cx = lerp(this.state.x + this.state.width / 2, raw.x + raw.width / 2, kMove)
    const feet = lerp(this.state.y + this.state.height, raw.y + raw.height, kMove)
    this.state = { x: cx - w / 2, y: feet - h, width: w, height: h }
    return this.state
  }
}

/**
 * Mezcla dos encuadres como una transformación de semejanza (escala + traslación): la escala
 * interpolada es la misma en ambos ejes, así que la persona nunca se deforma durante la transición.
 * Si el resultado no es utilizable, conserva el destino.
 */
export function blendPlacement(from: FramePlacement, to: FramePlacement, k: number): FramePlacement {
  const t = Math.min(1, Math.max(0, k))
  const scaleOf = (p: FramePlacement): number => (p.box.width / p.crop.width + p.box.height / p.crop.height) / 2
  const a = lerp(scaleOf(from), scaleOf(to), t)
  const bx = lerp(from.box.x - from.crop.x * scaleOf(from), to.box.x - to.crop.x * scaleOf(to), t)
  const by = lerp(from.box.y - from.crop.y * scaleOf(from), to.box.y - to.crop.y * scaleOf(to), t)
  const crop = {
    x: lerp(from.crop.x, to.crop.x, t),
    y: lerp(from.crop.y, to.crop.y, t),
    width: lerp(from.crop.width, to.crop.width, t),
    height: lerp(from.crop.height, to.crop.height, t)
  }
  const box = { x: bx + crop.x * a, y: by + crop.y * a, width: crop.width * a, height: crop.height * a }
  return sanitizePlacement({ crop, box }) ?? to
}
