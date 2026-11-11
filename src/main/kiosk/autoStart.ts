import { app } from 'electron'
import type { AuditLog } from '../../core/audit/auditLog'

/** Nombre fijo de la entrada de inicio automático; el desinstalador la elimina por este nombre. */
const LOGIN_ITEM_NAME = 'EditoraPeruTotem'

/**
 * Inicio automático al iniciar sesión en Windows (RF-KIO-001). En desarrollo no se registra,
 * porque apuntaría al Electron de desarrollo y no a la aplicación instalada.
 */
export function applyAutoStart(enabled: boolean, isDev: boolean, audit: AuditLog): void {
  if (isDev) return
  const current = app.getLoginItemSettings().launchItems.some((item) => item.name === LOGIN_ITEM_NAME && item.enabled)
  if (current === enabled) return
  app.setLoginItemSettings({ openAtLogin: enabled, name: LOGIN_ITEM_NAME })
  audit.record({ level: 'info', category: 'kiosk', action: 'auto_start', result: 'ok', detail: { enabled } })
}
