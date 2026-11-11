export type SaveCaptureError =
  | 'session_invalid'
  /** La sesión no tiene una participación registrada con consentimientos (RN-002). */
  | 'not_registered'
  | 'already_captured'
  | 'invalid_image'
  | 'insufficient_disk'
  | 'too_many_attempts'
  | 'storage_error'

/**
 * Cuadro de la cámara sin comprimir (RGBA, 4 bytes por píxel). Se codifica a JPEG en el proceso
 * principal: hacerlo en la interfaz tardaba más de 2 s por cuadro 4K.
 */
export interface CapturedFrame {
  width: number
  height: number
  rgba: Uint8Array
}

/** Lado máximo aceptado para un cuadro de la cámara (8K). */
export const MAX_FRAME_SIDE = 7680

/**
 * Silueta aproximada de la persona en el cuadro capturado (un canal, 0 = fondo, 255 = persona),
 * calculada en la interfaz con el modelo de la vista previa. Guía al recorte fino de la foto final:
 * evita huecos con poca luz y descarta objetos del fondo que el modelo fino confunde con la persona.
 */
export interface PersonGuide {
  width: number
  height: number
  alpha: Uint8Array
}

/** Lado máximo aceptado para la silueta guía. */
export const MAX_GUIDE_SIDE = 1024

export type SaveCaptureResult = { ok: true } | { ok: false; error: SaveCaptureError; attemptsLeft: number }

export type ComposeError = 'session_invalid' | 'no_capture' | 'resource_missing' | 'composition_failed' | 'too_many_attempts'

export type ComposeResult =
  | { ok: true; imageDataUrl: string; retakesLeft: number }
  | { ok: false; error: ComposeError; attemptsLeft: number }

export type RetakeResult = { ok: true; retakesLeft: number } | { ok: false; error: 'session_invalid' | 'limit_reached' }

export type CameraProblem = 'not_found' | 'permission_denied' | 'in_use' | 'failed' | 'disconnected'
