import { z } from 'zod'

/** Íconos incluidos para las categorías de la pantalla principal (sin archivos externos). */
export const ATTRACT_ICONS = ['cultura', 'educacion', 'identidad', 'ciudadania', 'libro', 'periodico', 'estrella', 'corazon'] as const
export type AttractIcon = (typeof ATTRACT_ICONS)[number]

export const ATTRACT_ICON_LABEL: Record<AttractIcon, string> = {
  cultura: 'Cultura (edificio con columnas)',
  educacion: 'Educación (birrete)',
  identidad: 'Identidad (persona)',
  ciudadania: 'Ciudadanía (grupo de personas)',
  libro: 'Libro',
  periodico: 'Periódico',
  estrella: 'Estrella',
  corazon: 'Corazón'
}

export const MAX_ATTRACT_TILES = 4

/** Solo archivos cargados desde el panel a la carpeta `institutional/` del contenido. */
const institutionalFile = z.string().max(200).regex(/^(institutional\/[A-Za-z0-9._-]+)?$/)

/**
 * Pantalla principal (RF-ATR-001): contenido institucional con logotipo, fondo, frase y categorías,
 * o el ciclo de imágenes y videos cargados en el panel.
 */
export const attractSettingsSchema = z.object({
  mode: z.enum(['institutional', 'media']),
  /**
   * Muestra logotipo, frase y categorías sobre el fondo. Se desactiva cuando el fondo es un diseño
   * completo que ya los trae dibujados; entonces solo se agrega la invitación a tocar.
   */
  showTexts: z.boolean(),
  /** Nombre que se muestra si no hay logotipo cargado. */
  title: z.string().trim().max(60),
  tagline: z.string().trim().max(120),
  slogan: z.string().trim().max(120),
  /** Invitación a tocar la pantalla. */
  cta: z.string().trim().min(1).max(60),
  tiles: z
    .array(z.object({ icon: z.enum(ATTRACT_ICONS), label: z.string().trim().min(1).max(24) }))
    .max(MAX_ATTRACT_TILES),
  logoPath: institutionalFile,
  backgroundPath: institutionalFile
})
export type AttractSettings = z.infer<typeof attractSettingsSchema>

export const DEFAULT_ATTRACT: AttractSettings = {
  mode: 'institutional',
  // Por defecto, el diseño institucional incluido con la aplicación, tal cual.
  showTexts: false,
  title: 'Editora Perú',
  tagline: 'Nuestras publicaciones, un mejor país',
  slogan: 'Grandes historias también las escribes tú',
  cta: 'Toque la pantalla para comenzar',
  tiles: [
    { icon: 'cultura', label: 'Cultura' },
    { icon: 'educacion', label: 'Educación' },
    { icon: 'identidad', label: 'Identidad' },
    { icon: 'ciudadania', label: 'Ciudadanía' }
  ],
  logoPath: '',
  backgroundPath: ''
}

/** Lo que la interfaz pública necesita: textos y URL de las imágenes que existen. */
export interface PublicAttract extends Omit<AttractSettings, 'logoPath' | 'backgroundPath'> {
  logoUrl: string | null
  backgroundUrl: string | null
}
