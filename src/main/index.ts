import { join } from 'node:path'
import { app, BrowserWindow, dialog } from 'electron'
import type { AdminApi } from './admin/adminApi'
import { createAdmin } from './admin/createAdmin'
import { bootstrap, type BootstrapOutcome } from './bootstrap'
import { BUILT_IN_PUBLICATION } from './builtInPublication'
import { ensureDefaultConsents } from './defaults/consents'
import { syncDevSeedCampaigns } from './devSeed/campaigns'
import { syncDevSeedMedia } from './devSeed/media'
import { registerIpc } from './ipc/registerIpc'
import { applyAutoStart } from './kiosk/autoStart'
import { applyKioskGuard, controlledQuit } from './kiosk/kioskGuard'
import { handleMediaProtocol, handleRendererProtocol, registerMediaScheme } from './protocol'
import { SecretStore } from './secretStore'
import { startPublicationWorker } from './workers/publicationWorker'
import { startRetentionWorker } from './workers/retentionWorker'
import { createMainWindow, hardenSession } from './windows/mainWindow'

const isDev = !app.isPackaged

// Diagnóstico local opcional: permite inspeccionar la ventana de desarrollo sin exponer ningún
// puerto en instalaciones. Solo se activa explícitamente mediante una variable del desarrollador.
if (isDev && process.env['TOTEM_DEBUG_PORT']) {
  app.commandLine.appendSwitch('remote-debugging-port', process.env['TOTEM_DEBUG_PORT'])
}

// Instalada: carpetas y nombres fijos, sin tildes, para que el desinstalador los encuentre y borre
// (datos en %LOCALAPPDATA%, caché de la ventana en %APPDATA%\EditoraPeruTotem, inicio automático).
if (!isDev) {
  app.setAppUserModelId('pe.editoraperu.totem')
  app.setPath('userData', join(app.getPath('appData'), 'EditoraPeruTotem'))
}

/**
 * Carpeta de datos: `TOTEM_DATA_DIR` si está definida; instalada, `%LOCALAPPDATA%\EditoraPeruTotem`
 * (instalación por usuario, sin permisos de administrador); en desarrollo `.data` en la carpeta del
 * proyecto, para las pruebas locales en este equipo.
 */
function resolveDataRoot(): string {
  const fromEnv = process.env['TOTEM_DATA_DIR']
  if (fromEnv) return fromEnv
  if (!isDev) return join(process.env['LOCALAPPDATA'] ?? join(app.getPath('home'), 'AppData', 'Local'), 'EditoraPeruTotem')
  return join(app.getAppPath(), '.data')
}

/** En desarrollo el modo kiosco se activa solo con `TOTEM_KIOSK=1`, para no bloquear el equipo de trabajo. */
function shouldUseKiosk(outcome: BootstrapOutcome): boolean {
  if (isDev) return process.env['TOTEM_KIOSK'] === '1'
  return outcome.ok ? outcome.context.settings.get().kiosk.enabled : true
}

let outcome: BootstrapOutcome | null = null
let stopWorker: (() => void) | null = null
let stopRetention: (() => void) | null = null

/**
 * Recursos incluidos con la aplicación (motor y modelos de recorte): en desarrollo `resources/`
 * del proyecto; instalada, la carpeta de recursos del instalador (extraResources, fase 9).
 */
function appResourcesDir(): string {
  return isDev ? join(app.getAppPath(), 'resources') : process.resourcesPath
}

/** Ventana sobre la que se abren los diálogos de archivos (en modo kiosco quedan al frente). */
function dialogParent(): BrowserWindow {
  return BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]!
}

function start(): void {
  hardenSession()
  handleRendererProtocol(join(__dirname, '../renderer'))
  const dataRoot = resolveDataRoot()
  const secrets = new SecretStore(join(dataRoot, 'config', 'secrets.json'))
  outcome = bootstrap({
    dataRoot,
    isDev,
    version: app.getVersion(),
    publicationSecret: () => secrets.get('publication.secret'),
    publicationDefaults: BUILT_IN_PUBLICATION,
    modelsDir: join(appResourcesDir(), 'models')
  })

  if (outcome.ok) {
    const { context } = outcome
    handleMediaProtocol(context.paths.content, appResourcesDir())
    applyAutoStart(context.settings.get().kiosk.autoStart, isDev, context.audit)
    // Textos legales de prueba incluidos con la aplicación, también instalada (PD-008 pendiente).
    ensureDefaultConsents(context.db)
    if (isDev) {
      // Campañas y contenido de demostración solo a pedido: lo normal es crearlos desde el panel.
      if (process.env['TOTEM_DEMO'] === '1') {
        syncDevSeedMedia(context.db, join(app.getAppPath(), 'resources', 'dev-seed', 'media'), context.paths.content, context.audit)
        syncDevSeedCampaigns(context.db, context.paths.content, context.audit)
      }
    }
    stopWorker = startPublicationWorker(context)
  }

  let admin: AdminApi | null = null
  if (outcome.ok) {
    const { context } = outcome
    const created = createAdmin(context, {
      isDev,
      version: app.getVersion(),
      pickFile: async (kind) => {
        const filters =
          kind === 'media'
            ? [{ name: 'Imágenes y videos', extensions: ['png', 'jpg', 'jpeg', 'webp', 'mp4', 'webm'] }]
            : kind === 'character'
              ? [{ name: 'Personaje estático o animado', extensions: ['png', 'webp', 'gif', 'mp4', 'webm'] }]
            : kind === 'animation'
              ? [{ name: 'Animación transparente WebM', extensions: ['webm'] }]
            : kind === 'json'
              ? [{ name: 'Configuración', extensions: ['json'] }]
              : [{ name: 'Imágenes', extensions: ['png', 'jpg', 'jpeg', 'webp'] }]
        const result = await dialog.showOpenDialog(dialogParent(), { title: 'Elegir archivo', properties: ['openFile'], filters })
        return result.canceled ? null : (result.filePaths[0] ?? null)
      },
      saveFile: async (defaultName) => {
        const extension = defaultName.split('.').pop() ?? 'csv'
        const result = await dialog.showSaveDialog(dialogParent(), {
          title: 'Guardar archivo',
          defaultPath: join(app.getPath('documents'), defaultName),
          filters: [{ name: extension.toUpperCase(), extensions: [extension] }]
        })
        return result.canceled ? null : (result.filePath ?? null)
      },
      pickDirectory: async () => {
        const result = await dialog.showOpenDialog(dialogParent(), {
          title: 'Carpeta de destino del respaldo',
          properties: ['openDirectory', 'createDirectory']
        })
        return result.canceled ? null : (result.filePaths[0] ?? null)
      },
      quit: (actorId) => controlledQuit(context.audit, actorId),
      secret: {
        has: () => secrets.get('publication.secret') !== null,
        set: (value) => secrets.set('publication.secret', value)
      }
    })
    admin = created.api
    stopRetention = startRetentionWorker(created.maintenance, context.settings)
    // Escenarios subidos antes de la detección de zona transparente: se revisan en segundo plano.
    void created.content.checkPendingPhotoHoles().catch((error: unknown) =>
      context.audit.record({ level: 'warn', category: 'content', action: 'resource.photo_hole', result: 'fail', detail: { error: String(error) } })
    )
    void created.content.checkPendingCharacterAnalysis().catch((error: unknown) =>
      context.audit.record({ level: 'warn', category: 'content', action: 'resource.character_analysis', result: 'fail', detail: { error: String(error) } })
    )
    void created.content.repairChromaCharacterPoses().catch((error: unknown) =>
      context.audit.record({ level: 'warn', category: 'content', action: 'resource.character_chroma_repair', result: 'fail', detail: { error: String(error) } })
    )
  }

  registerIpc({ outcome, isDev, version: app.getVersion(), admin })
  const kiosk = shouldUseKiosk(outcome)
  const window = createMainWindow({ kiosk, isDev })
  if (outcome.ok) applyKioskGuard(window, { kiosk, audit: outcome.context.audit })
}

function shutdown(): void {
  stopWorker?.()
  stopRetention?.()
  if (!outcome?.ok) return
  const { audit, db } = outcome.context
  audit.record({ level: 'info', category: 'system', action: 'stop', result: 'ok' })
  db.close()
  outcome = null
}

// Un error no controlado se registra en lugar de mostrar un cuadro de diálogo al público.
process.on('uncaughtException', (error) => {
  const audit = outcome?.ok ? outcome.context.audit : null
  if (audit) audit.record({ level: 'error', category: 'system', action: 'uncaught_exception', result: 'fail', detail: { error } })
  else console.error(error)
})

registerMediaScheme()

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const [window] = BrowserWindow.getAllWindows()
    if (window) {
      if (window.isMinimized()) window.restore()
      window.focus()
    }
  })
  app.on('window-all-closed', () => app.quit())
  app.on('will-quit', shutdown)
  void app.whenReady().then(start)
}
