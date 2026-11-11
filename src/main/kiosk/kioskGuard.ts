import { app, type BrowserWindow, type Input } from 'electron'
import type { AuditLog } from '../../core/audit/auditLog'

/** Solo el cierre controlado habilita el cierre de la ventana en modo kiosco. */
let allowClose = false

/** Atajos del navegador que el participante no debe poder usar (RF-KIO-003). */
function isBlockedShortcut(input: Input): boolean {
  const key = input.key.toLowerCase()
  const ctrl = input.control || input.meta
  if (['f5', 'f11', 'f12', 'browserback', 'browserforward', 'browserrefresh'].includes(key)) return true
  if (ctrl && ['r', 'w', 'p', 's', 'o', 'n', 't', '+', '-', '=', '0'].includes(key)) return true
  if (ctrl && input.shift && ['i', 'j', 'c'].includes(key)) return true
  if (input.alt && ['arrowleft', 'arrowright', 'f4'].includes(key)) return true
  return false
}

/**
 * Restricciones de la ventana pública. El bloqueo completo de Windows (tecla Windows,
 * Ctrl+Alt+Supr, gestos del sistema) se configura en el sistema operativo (PD-013, fase 9).
 */
export function applyKioskGuard(window: BrowserWindow, options: { kiosk: boolean; audit: AuditLog }): void {
  const contents = window.webContents

  // Sin zoom por gestos táctiles ni atajos, en todos los modos.
  contents.on('did-finish-load', () => void contents.setVisualZoomLevelLimits(1, 1))

  if (options.kiosk) {
    contents.on('before-input-event', (event, input) => {
      if (input.type === 'keyDown' && isBlockedShortcut(input)) event.preventDefault()
    })
    // La ventana solo se cierra mediante el cierre controlado (RF-KIO-005) o al apagar Windows.
    window.on('close', (event) => {
      if (!allowClose) event.preventDefault()
    })
    window.on('session-end', () => {
      allowClose = true
    })
  }

  // Recuperación si el proceso de la interfaz falla o se bloquea (RF-KIO-004).
  contents.on('render-process-gone', (_event, details) => {
    options.audit.record({
      level: 'error',
      category: 'kiosk',
      action: 'renderer_gone',
      result: 'fail',
      detail: { reason: details.reason, exitCode: details.exitCode }
    })
    if (details.reason !== 'clean-exit' && !window.isDestroyed()) contents.reload()
  })
  contents.on('unresponsive', () => {
    options.audit.record({ level: 'error', category: 'kiosk', action: 'renderer_unresponsive', result: 'fail' })
    setTimeout(() => {
      if (!window.isDestroyed()) contents.forcefullyCrashRenderer()
    }, 10_000)
  })
}

/** Cierre controlado de la aplicación (RF-KIO-005). */
export function controlledQuit(audit: AuditLog, actorId: string): void {
  audit.record({ level: 'info', category: 'kiosk', action: 'controlled_quit', result: 'ok', actor: { type: 'user', id: actorId } })
  allowClose = true
  app.quit()
}
