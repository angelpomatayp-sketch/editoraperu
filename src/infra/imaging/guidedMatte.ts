import type { PersonGuide } from '../../shared/capture'
import type { FractionRect } from '../../shared/compositionPlan'
import sharp from './sharpSetup'

/** Suavizado de la silueta guía, como fracción del ancho de la zona de la persona. */
const GUIDE_BLUR = 0.01
/** Margen exterior: protege cabello, manos y prendas que la guía rápida no haya visto completas. */
const OUTER_MARGIN = 0.025
/** Solo el núcleo de máxima confianza puede rellenar huecos del modelo fotográfico. */
const INNER_FROM = 0.88
const INNER_RAMP = 0.1
/** Fuera de la guía ampliada sí se descartan falsos positivos distantes. */
const OUTER_UNTIL = 0.02
const OUTER_RAMP = 0.14

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)

/** Dilatación cuadrada separable para el alfa de la guía, que suele ser de baja resolución. */
function dilateAlpha(alpha: Buffer, width: number, height: number, radiusX: number, radiusY: number): Buffer {
  const horizontal = Buffer.alloc(alpha.length)
  const out = Buffer.alloc(alpha.length)
  for (let y = 0; y < height; y++) {
    const row = y * width
    for (let x = 0; x < width; x++) {
      let value = 0
      for (let dx = -radiusX; dx <= radiusX; dx++) {
        const xx = x + dx
        if (xx >= 0 && xx < width) value = Math.max(value, alpha[row + xx]!)
      }
      horizontal[row + x] = value
    }
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let value = 0
      for (let dy = -radiusY; dy <= radiusY; dy++) {
        const yy = y + dy
        if (yy >= 0 && yy < height) value = Math.max(value, horizontal[yy * width + x]!)
      }
      out[y * width + x] = value
    }
  }
  return out
}

/**
 * Combina la máscara fina (MODNet) con la silueta guía (modelo de la vista previa):
 * - dentro de la silueta, la persona queda opaca aunque el modelo fino deje huecos (cara con poca luz);
 * - fuera de ella se descarta lo que el modelo fino confunda con la persona (frazadas, muebles);
 * - en el borde manda la máscara fina, que conserva el detalle del cabello.
 * La guía corresponde al cuadro completo: se le aplica el mismo recorte que a la foto (`crop`, en
 * fracciones del cuadro) y se lleva al mismo tamaño.
 */
export async function guidedMatte(
  fine: Buffer,
  guide: PersonGuide,
  width: number,
  height: number,
  crop: FractionRect = { x: 0, y: 0, width: 1, height: 1 }
): Promise<Buffer> {
  const left = Math.round(crop.x * guide.width)
  const top = Math.round(crop.y * guide.height)
  const extract = {
    left,
    top,
    width: Math.max(1, Math.min(guide.width - left, Math.round(crop.width * guide.width))),
    height: Math.max(1, Math.min(guide.height - top, Math.round(crop.height * guide.height)))
  }
  const cropped = await sharp(guide.alpha, { raw: { width: guide.width, height: guide.height, channels: 1 } })
    .extract(extract)
    .extractChannel(0)
    .raw()
    .toBuffer()
  const resized = sharp(cropped, { raw: { width: extract.width, height: extract.height, channels: 1 } })
    .resize(width, height, { fit: 'fill', kernel: 'cubic' })

  const inner = await resized
    .clone()
    .blur(Math.max(1, width * GUIDE_BLUR))
    .extractChannel(0)
    .raw()
    .toBuffer()

  // La guía de la vista previa trabaja a mucha menos resolución. Antes de usarla como límite se
  // expande de forma deliberada; dentro de ese margen manda MODNet y no la guía rápida.
  const expandedGuide = dilateAlpha(
    cropped,
    extract.width,
    extract.height,
    Math.max(1, Math.round(extract.width * OUTER_MARGIN)),
    Math.max(1, Math.round(extract.width * OUTER_MARGIN * extract.height / extract.width))
  )
  const outer = await sharp(expandedGuide, { raw: { width: extract.width, height: extract.height, channels: 1 } })
    .resize(width, height, { fit: 'fill', kernel: 'cubic' })
    .blur(Math.max(1, width * GUIDE_BLUR))
    .extractChannel(0)
    .raw()
    .toBuffer()

  const out = Buffer.alloc(width * height)
  for (let i = 0; i < out.length; i++) {
    const core = clamp01((inner[i]! / 255 - INNER_FROM) / INNER_RAMP)
    const allowed = clamp01((outer[i]! / 255 - OUTER_UNTIL) / OUTER_RAMP)
    out[i] = Math.round(Math.min(Math.max(fine[i]! / 255, core), allowed) * 255)
  }
  return out
}
