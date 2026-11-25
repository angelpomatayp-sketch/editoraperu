import { z } from 'zod'
import { attractSettingsSchema, DEFAULT_ATTRACT } from './attract'
import { cameraControlsSchema } from './cameraControls'
import { BACKGROUND_METHODS, chromaSchema, DEFAULT_CHROMA } from './chroma'

/**
 * Parámetros generales (RF-CFG-001). Los valores por defecto son provisionales
 * hasta que se aprueben los temporizadores (PD-007) y los límites (PD-005, PD-006).
 */
export const settingsSchema = z
  .object({
    kiosk: z.object({
      /** Pantalla completa sin bordes y bloqueo de salida (RF-KIO-002, RF-KIO-003). */
      enabled: z.boolean(),
      /** Inicio automático al iniciar sesión en Windows (RF-KIO-001). */
      autoStart: z.boolean()
    }),
    session: z.object({
      inactivityWarningSeconds: z.int().min(10).max(600),
      inactivityCancelSeconds: z.int().min(5).max(120)
    }),
    experience: z.object({
      /** Con una sola campaña disponible, se entra directamente en ella (RF-EXP-001). */
      skipSingleCampaign: z.boolean()
    }),
    capture: z.object({
      countdownSeconds: z.int().min(1).max(30),
      /** Intentos fallidos de captura o composición antes de cancelar de forma segura (RF-CAP-007). */
      maxAttempts: z.int().min(1).max(5),
      soundEnabled: z.boolean(),
      /** Repeticiones permitidas de la foto; 0 las desactiva (RF-CAP-006, PD-003). */
      maxRetakes: z.int().min(0).max(5),
      /** Vista previa y foto como espejo, como al mirarse en un espejo. */
      mirror: z.boolean(),
      /** Parte del nombre de la cámara a usar; vacío usa la primera disponible (RF-CAP-001). */
      cameraLabel: z.string().max(200),
      /**
       * Encuadre de la cámara en la zona de la persona: 0 = imagen completa, sin recorte (la persona
       * se ve más pequeña); 100 = llena la zona recortando los costados (como un zoom).
       */
      framingPercent: z.int().min(0).max(100),
      /**
       * Encuadre automático: centra a la persona y la agranda hasta ocupar el alto de la zona, de cuerpo
       * entero. Si no se detecta a nadie (o sin recorte automático), se usa `framingPercent`.
       */
      autoFraming: z.boolean(),
        /** Adapta la persona a la altura del primer personaje seleccionado; solo con recorte automático. */
        matchCharacterSize: z.boolean().default(false),
        /** Nivelado automático: alinea los pies de la persona con los del primer personaje en la foto final (recorte automático). */
        levelToCharacter: z.boolean().default(false),
        /** Filtro avanzado de color: integra a la persona en la luz y el ambiente de la escena (solo con fondo recortado). */
        advancedSceneColor: z.boolean().default(false),
        /** Cámara montada girada: grados (sentido horario) para enderezar la imagen. 0, 90, 180 o 270. */
        rotation: z.number().refine((v) => [0, 90, 180, 270].includes(v), { message: 'Use 0, 90, 180 o 270' }),
      /** Aviso grande «Ubíquese aquí» sobre la zona de la persona hasta que alguien se ubique. */
      positionHint: z.boolean(),
      /** Solo aplicar calibración guardada si el operador lo activa; no reemplazar la del controlador. */
      cameraControlsEnabled: z.boolean().default(false),
      /** Corrección opcional de luminosidad y temperatura al componer una persona recortada. */
      matchSceneTone: z.boolean().default(false),
      /** Ajustes de imagen de la cámara (brillo, exposición…), solo los que la cámara soporte. */
      cameraControls: cameraControlsSchema
    }),
    /** Cómo se quita el fondo de la captura (RF-CMP-002). */
    background: z.object({ method: z.enum(BACKGROUND_METHODS) }),
    /** Recorte por fondo verde; se calibra en el lugar de instalación. */
    chroma: chromaSchema,
    /** Pantalla principal: contenido institucional o ciclo de imágenes y videos. */
    attract: attractSettingsSchema,
    download: z.object({
      qrDisplaySeconds: z.int().min(15).max(600)
    }),
    publication: z.object({
      /** URL base del servicio de publicación. Vacía mientras no esté configurado. */
      baseUrl: z.union([z.literal(''), z.url({ protocol: /^https?$/ })]),
      retryIntervalSeconds: z.int().min(10).max(3600),
      maxRetries: z.int().min(0).max(100)
    }),
    storage: z.object({
      /** Por debajo de este espacio libre no se inician participaciones (RF-ALM-002). */
      minFreeMegabytes: z.int().min(100),
      /** Por debajo de este espacio libre se advierte al administrador. */
      warnFreeMegabytes: z.int().min(100)
    }),
    admin: z.object({
      sessionTimeoutSeconds: z.int().min(60).max(3600),
      maxFailedLogins: z.int().min(3).max(10),
      lockoutSeconds: z.int().min(30).max(3600)
    }),
    /**
     * Conservación (RF-FOT-005, PD-002). Desactivada hasta que se apruebe la política: mientras tanto
     * no se elimina nada de forma automática (RN-009).
     */
    retention: z.object({
      enabled: z.boolean(),
      /** Días que se conservan las fotografías (originales y finales) después de la participación. */
      photoDays: z.int().min(1).max(3650),
      /** Días que se conservan nombres y DNI; después se anonimiza la participación. */
      personalDataDays: z.int().min(1).max(3650)
    }),
    timezone: z.string().min(1)
  })
  .refine((s) => s.storage.warnFreeMegabytes >= s.storage.minFreeMegabytes, {
    message: 'El umbral de advertencia debe ser mayor o igual al mínimo de espacio libre',
    path: ['storage', 'warnFreeMegabytes']
  })

export type Settings = z.infer<typeof settingsSchema>

export const DEFAULT_SETTINGS: Settings = {
  kiosk: { enabled: true, autoStart: true },
  session: { inactivityWarningSeconds: 60, inactivityCancelSeconds: 15 },
  experience: { skipSingleCampaign: true },
    capture: { countdownSeconds: 10, maxAttempts: 3, soundEnabled: true, maxRetakes: 2, mirror: true, cameraLabel: '', framingPercent: 0, autoFraming: false, matchCharacterSize: false, levelToCharacter: false, advancedSceneColor: false, rotation: 0, positionHint: true, cameraControlsEnabled: false, matchSceneTone: false, cameraControls: {} },
  background: { method: 'segmentation' },
  chroma: DEFAULT_CHROMA,
  attract: DEFAULT_ATTRACT,
  download: { qrDisplaySeconds: 90 },
  publication: { baseUrl: '', retryIntervalSeconds: 60, maxRetries: 30 },
  storage: { minFreeMegabytes: 2048, warnFreeMegabytes: 10240 },
  admin: { sessionTimeoutSeconds: 300, maxFailedLogins: 5, lockoutSeconds: 300 },
  retention: { enabled: true, photoDays: 7, personalDataDays: 30 },
  timezone: 'America/Lima'
}
