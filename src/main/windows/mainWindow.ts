import { join } from 'node:path'
import { BrowserWindow, screen, session, shell } from 'electron'
import { RENDERER_SCHEME } from '../protocol'

export interface MainWindowOptions {
  kiosk: boolean
  isDev: boolean
}

/** Permisos del navegador que la interfaz puede usar. La cámara se habilita para la captura (8.7). */
const ALLOWED_PERMISSIONS = new Set(['media'])

/** Endurece la sesión: solo los permisos imprescindibles y ninguna descarga iniciada por la interfaz. */
export function hardenSession(): void {
  const ses = session.defaultSession
  // El nombre del producto lleva tildes y el User-Agent debe ser ASCII; si no, fallan los protocolos internos.
  ses.setUserAgent(ses.getUserAgent().normalize('NFD').replace(/[^\x20-\x7E]/g, ''))
  ses.setPermissionRequestHandler((_wc, permission, callback) => callback(ALLOWED_PERMISSIONS.has(permission)))
  ses.setPermissionCheckHandler((_wc, permission) => ALLOWED_PERMISSIONS.has(permission))
  ses.on('will-download', (event) => event.preventDefault())
}

/** Ventana vertical 9:16 que cabe en la pantalla del equipo de desarrollo. */
function portraitSimulatorBounds(): { width: number; height: number; useContentSize: true } {
  const { height: available } = screen.getPrimaryDisplay().workAreaSize
  const height = Math.min(960, Math.floor(available * 0.92))
  return { width: Math.round((height * 9) / 16), height, useContentSize: true }
}

/**
 * Ventana pública. En modo kiosco ocupa toda la pantalla sin bordes ni menús (RF-KIO-002).
 * En desarrollo simula la pantalla vertical 9:16 del tótem en una ventana normal.
 */
export function createMainWindow(options: MainWindowOptions): BrowserWindow {
  const window = new BrowserWindow({
    ...(options.kiosk ? { kiosk: true, fullscreen: true, frame: false } : portraitSimulatorBounds()),
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#0b1f3a',
    title: 'Tótem Editora Perú',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      devTools: options.isDev
    }
  })

  window.setMenu(null)
  window.once('ready-to-show', () => window.show())

  // La interfaz nunca navega fuera de la aplicación ni abre ventanas nuevas.
  window.webContents.on('will-navigate', (event) => event.preventDefault())
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (options.isDev && url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })

  const devServerUrl = process.env['ELECTRON_RENDERER_URL']
  if (options.isDev && devServerUrl) void window.loadURL(devServerUrl)
  else void window.loadURL(`${RENDERER_SCHEME}://renderer/index.html`)

  return window
}
