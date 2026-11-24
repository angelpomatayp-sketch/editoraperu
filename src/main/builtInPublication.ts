/** Reemplazado al compilar (electron.vite.config.ts); `null` en desarrollo y en las pruebas. */
declare const __BUILT_IN_PUBLICATION__: { baseUrl: string; secret: string } | null

/**
 * Servicio de publicación incluido en el instalador: el tótem genera QR apenas se instala. Lo que se
 * configure en el panel (URL o clave) tiene prioridad sobre esto.
 */
export const BUILT_IN_PUBLICATION: { baseUrl: string; secret: string } | null =
  __BUILT_IN_PUBLICATION__
