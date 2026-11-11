/** Geometría lógica usada por la vista previa y el editor; no exige renderizar video 4K en vivo. */
export const PREVIEW_OUTPUT = { width: 1080, height: 1920 } as const

/**
 * Fotografía final vertical 9:16 en 4K. Las posiciones se guardan como fracciones, por lo que
 * duplicar la resolución conserva exactamente el diseño configurado a 1080 × 1920.
 */
export const OUTPUT = { width: 2160, height: 3840, jpegQuality: 95 } as const

/** Calidad JPEG (1–100) con la que se guarda la captura original. */
export const CAPTURE_JPEG_QUALITY = 95

/** Tamaño máximo aceptado para una captura original. */
export const MAX_CAPTURE_BYTES = 30 * 1024 * 1024

/** Proporción ancho/alto de la zona de la foto en la imagen final. */
export function photoAspect(region: { width: number; height: number }): number {
  return (region.width * OUTPUT.width) / (region.height * OUTPUT.height)
}
