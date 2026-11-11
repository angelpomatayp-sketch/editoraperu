/** Motivo por el que no se pudo mostrar el QR; nunca se muestra un QR inválido (RF-QR-008). */
export type PublishFailure = 'session_invalid' | 'no_photo' | 'not_configured' | 'offline' | 'rejected'

export type PublishResult =
  | { ok: true; qrDataUrl: string; expiresAt: string }
  | { ok: false; reason: PublishFailure }

export type ConnectivityState = 'unknown' | 'online' | 'offline' | 'not_configured'
