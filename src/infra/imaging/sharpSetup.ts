import sharp from 'sharp'

/**
 * En Windows, la caché de libvips mantiene abiertos los archivos leídos y luego no se pueden
 * eliminar (repetir una foto, limpieza de temporales). Cada imagen se procesa una sola vez,
 * por lo que la caché no aporta rendimiento.
 */
sharp.cache(false)

export default sharp
