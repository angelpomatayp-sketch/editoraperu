/**
 * Refinado fino del recorte a resolución completa, en el procesador (sin tarjeta gráfica):
 * 1. Filtro guiado (He et al.): la máscara sigue los bordes reales de la foto (cabello, hombros,
 *    brazos) en lugar de quedar suavizada por haberse calculado a menor resolución.
 * 2. Solo en la franja del borde: el interior y el fondo seguros no cambian, así las texturas de la
 *    ropa (cuadros, estampados) no generan huecos.
 * 3. Limpieza de halos: lo casi transparente pasa a transparente y lo casi opaco, a opaco.
 */

/** Radio del filtro como fracción del ancho de la imagen. */
const RADIUS = 0.006
/** Regularización: más pequeño, el recorte sigue más de cerca los bordes de la foto. */
const EPSILON = 2e-3
/** Fuera de este rango de la máscara promediada, el píxel es interior o fondo seguro. */
const BAND_LOW = 0.02
const BAND_HIGH = 0.98
/** Niveles para quitar halos: por debajo es fondo, por encima es persona. */
const HALO_LOW = 0.08
const HALO_HIGH = 0.92

/** Media de cada píxel en una ventana de (2r+1)², recortada en los bordes (tabla de sumas). */
function boxMean(src: Float32Array, width: number, height: number, r: number, sums: Float64Array): Float32Array {
  const stride = width + 1
  for (let y = 0; y < height; y++) {
    let row = 0
    for (let x = 0; x < width; x++) {
      row += src[y * width + x]!
      sums[(y + 1) * stride + x + 1] = sums[y * stride + x + 1]! + row
    }
  }
  const out = new Float32Array(width * height)
  for (let y = 0; y < height; y++) {
    const y0 = Math.max(0, y - r)
    const y1 = Math.min(height, y + r + 1)
    for (let x = 0; x < width; x++) {
      const x0 = Math.max(0, x - r)
      const x1 = Math.min(width, x + r + 1)
      const total = sums[y1 * stride + x1]! - sums[y0 * stride + x1]! - sums[y1 * stride + x0]! + sums[y0 * stride + x0]!
      out[y * width + x] = total / ((x1 - x0) * (y1 - y0))
    }
  }
  return out
}

/**
 * Devuelve la máscara refinada (un canal, 0–255) del mismo tamaño.
 * `rgb`: la foto (3 canales intercalados) en la que se calculó la máscara.
 */
export function refineMatte(alpha: Uint8Array, rgb: Uint8Array, width: number, height: number): Buffer {
  const n = width * height
  const guide = new Float32Array(n)
  const p = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    guide[i] = (0.299 * rgb[i * 3]! + 0.587 * rgb[i * 3 + 1]! + 0.114 * rgb[i * 3 + 2]!) / 255
    p[i] = alpha[i]! / 255
  }

  const r = Math.max(2, Math.round(width * RADIUS))
  // La tabla auxiliar se sobrescribe completamente; su fila/columna cero permanecen en cero.
  // Reutilizarla evita reservar seis tablas de ~66 MB en una foto 4K, con idéntica aritmética.
  const sums = new Float64Array((width + 1) * (height + 1))
  const meanI = boxMean(guide, width, height, r, sums)
  const meanP = boxMean(p, width, height, r, sums)
  const ii = new Float32Array(n)
  const ip = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    ii[i] = guide[i]! * guide[i]!
    ip[i] = guide[i]! * p[i]!
  }
  const corrI = boxMean(ii, width, height, r, sums)
  const corrIp = boxMean(ip, width, height, r, sums)

  const a = ii // se reutilizan los arreglos ya consumidos
  const b = ip
  for (let i = 0; i < n; i++) {
    const varI = corrI[i]! - meanI[i]! * meanI[i]!
    const covIp = corrIp[i]! - meanI[i]! * meanP[i]!
    a[i] = covIp / (varI + EPSILON)
    b[i] = meanP[i]! - a[i]! * meanI[i]!
  }
  const meanA = boxMean(a, width, height, r, sums)
  const meanB = boxMean(b, width, height, r, sums)

  const out = Buffer.alloc(n)
  for (let i = 0; i < n; i++) {
    // Solo en la franja del borde; el resto conserva la máscara original.
    const inBand = meanP[i]! > BAND_LOW && meanP[i]! < BAND_HIGH
    const value = inBand ? meanA[i]! * guide[i]! + meanB[i]! : p[i]!
    const leveled = (value - HALO_LOW) / (HALO_HIGH - HALO_LOW)
    out[i] = Math.round(Math.min(1, Math.max(0, leveled)) * 255)
  }
  return out
}
