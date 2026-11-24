import { existsSync } from 'node:fs'
import { availableParallelism } from 'node:os'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { AuditLog } from '../core/audit/auditLog'
import { CampaignCatalog } from '../core/campaigns/campaignCatalog'
import { CaptureService } from '../core/capture/captureService'
import { ConnectivityMonitor } from '../core/network/connectivityMonitor'
import type { PublicationClient } from '../core/publication/publicationClient'
import { PublicationService } from '../core/publication/publicationService'
import type { ConsentRepository } from '../core/consents/consentRepository'
import type { Logger } from '../core/logging'
import { AttractService } from '../core/media/attractService'
import { RegistrationService } from '../core/participants/registrationService'
import { SessionService } from '../core/session/sessionService'
import { SettingsService } from '../core/settings/settingsService'
import type { StartupFailure } from '../shared/ipc'
import { backupDatabase, checkIntegrity, isCorruptionError, openDatabase } from '../infra/db/connection'
import { MIGRATIONS } from '../infra/db/migrations'
import { DatabaseNewerThanAppError, migrate, pendingMigrations } from '../infra/db/migrator'
import { SqliteAuditRepository } from '../infra/db/repositories/auditRepository'
import { SqliteCampaignRepository } from '../infra/db/repositories/campaignRepository'
import { SqliteCaptureRepository } from '../infra/db/repositories/captureRepository'
import { ModnetSegmenter } from '../infra/imaging/modnetSegmenter'
import { BirefnetSegmenter } from '../infra/imaging/birefnetSegmenter'
import { FsPhotoFiles } from '../infra/imaging/photoFiles'
import { SharpCompositor } from '../infra/imaging/sharpCompositor'
import { WorkerCompositor } from '../infra/imaging/workerCompositor'
import { OUTPUT } from '../shared/composition'
import { SqliteConsentRepository } from '../infra/db/repositories/consentRepository'
import { SqliteMediaRepository } from '../infra/db/repositories/mediaRepository'
import { SqliteParticipationRepository } from '../infra/db/repositories/participationRepository'
import { SqlitePublicationRepository } from '../infra/db/repositories/publicationRepository'
import { publicationTarget } from '../infra/publication/publicationTarget'
import { qrDataUrl } from '../infra/publication/qr'
import { SqliteSettingsRepository } from '../infra/db/repositories/settingsRepository'
import { FileLogger } from '../infra/logging/fileLogger'
import { contentUrl } from '../infra/storage/contentPaths'
import { ensureDataPaths, freeDiskMegabytes, resolveDataPaths, type DataPaths } from '../infra/storage/paths'
import { cleanTempDir } from '../infra/storage/tempCleanup'

const LOG_RETENTION_DAYS = 30

export interface AppContext {
  stopImaging?: () => Promise<void> | void
  paths: DataPaths
  logger: Logger
  db: DatabaseSync
  audit: AuditLog
  settings: SettingsService
  sessions: SessionService
  attract: AttractService
  campaigns: CampaignCatalog
  consents: ConsentRepository
  registration: RegistrationService
  capture: CaptureService
  /** Modelo local compartido para recortar fotos y personajes en video. */
  segmenter: ModnetSegmenter | null
  publication: PublicationService
  /** Cliente del servicio configurado, o `null` si la publicación no está configurada. */
  publicationClient: () => PublicationClient | null
  connectivity: ConnectivityMonitor
  schemaVersion: number
}

export interface BootstrapOptions {
  dataRoot: string
  isDev: boolean
  version: string
  /** Clave del servicio de publicación guardada de forma protegida (RF-CFG-002). */
  publicationSecret?: () => string | null
  /** Carpeta con los modelos de recorte (MODNet); si falta, el recorte automático no está disponible. */
  modelsDir?: string
  /** Modelo fotográfico verificado, guardado fuera del programa para conservarlo al actualizar. */
  portraitModelPath?: string
  compositionWorkerPath?: string
  /** Servicio incluido en el instalador; se usa si el panel no tiene URL o clave propias. */
  publicationDefaults?: { baseUrl: string; secret: string } | null
}

export type BootstrapOutcome =
  | { ok: true; context: AppContext; warnings: string[]; startedAt: string }
  | { ok: false; failure: StartupFailure; logger: Logger; paths: DataPaths; startedAt: string }

const consoleLogger: Logger = {
  log: (level, message, data) => console[level === 'debug' ? 'log' : level](`[${level}] ${message}`, data ?? '')
}

/**
 * Arranque con comprobaciones (RF-KIO-001): carpetas, base de datos, migraciones y configuración.
 * Un fallo esencial devuelve `ok: false` para mostrar la pantalla de servicio no disponible.
 */
export function bootstrap(options: BootstrapOptions): BootstrapOutcome {
  const startedAt = new Date().toISOString()
  const paths = resolveDataPaths(options.dataRoot)
  const warnings: string[] = []

  try {
    ensureDataPaths(paths)
  } catch (error) {
    consoleLogger.log('error', 'startup.storage_unavailable', { error })
    return { ok: false, failure: 'storage_unavailable', logger: consoleLogger, paths, startedAt }
  }

  const fileLogger = new FileLogger(paths.logs, { retentionDays: LOG_RETENTION_DAYS, echo: options.isDev })
  fileLogger.purgeOld()
  fileLogger.log('info', 'startup.begin', { version: options.version, dev: options.isDev })

  const dbFile = join(paths.db, 'totem.sqlite')
  let db: DatabaseSync
  try {
    db = openDatabase(dbFile)
  } catch (error) {
    const failure = isCorruptionError(error) ? 'database_corrupt' : 'database_unavailable'
    fileLogger.log('error', `startup.${failure}`, { error })
    return { ok: false, failure, logger: fileLogger, paths, startedAt }
  }

  const fail = (failure: StartupFailure, data: Record<string, unknown>): BootstrapOutcome => {
    fileLogger.log('error', `startup.${failure}`, data)
    db.close()
    return { ok: false, failure, logger: fileLogger, paths, startedAt }
  }

  let schemaVersion: number
  try {
    const problems = checkIntegrity(db)
    if (problems.length > 0) return fail('database_corrupt', { problems: problems.slice(0, 10) })

    const pending = pendingMigrations(db, MIGRATIONS)
    const isExistingDatabase = pending.length < MIGRATIONS.length
    if (pending.length > 0 && isExistingDatabase) {
      backupDatabase(db, join(paths.db, `totem-before-migration-${startedAt.replace(/[:.]/g, '-')}.sqlite`))
    }
    const result = migrate(db, MIGRATIONS)
    schemaVersion = result.to
    if (result.applied.length > 0) fileLogger.log('info', 'startup.migrated', { ...result })
  } catch (error) {
    if (error instanceof DatabaseNewerThanAppError) {
      return fail('database_newer', { databaseVersion: error.databaseVersion, appVersion: error.appVersion })
    }
    return fail(isCorruptionError(error) ? 'database_corrupt' : 'database_unavailable', { error })
  }

  const audit = new AuditLog(new SqliteAuditRepository(db), fileLogger)
  const settings = new SettingsService(new SqliteSettingsRepository(db), audit)
  warnings.push(...settings.load().warnings)

  const freeMb = freeDiskMegabytes(paths.root)
  const { minFreeMegabytes, warnFreeMegabytes } = settings.get().storage
  if (freeMb < minFreeMegabytes) warnings.push('Espacio en disco insuficiente para nuevas participaciones')
  else if (freeMb < warnFreeMegabytes) warnings.push('Espacio en disco bajo')

  const temp = cleanTempDir(paths.tmp)
  if (temp.removed.length > 0 || temp.failed.length > 0) {
    audit.record({
      level: temp.failed.length > 0 ? 'warn' : 'info',
      category: 'storage',
      action: 'tmp_cleanup',
      result: temp.failed.length > 0 ? 'fail' : 'ok',
      detail: { removed: temp.removed.length, failed: temp.failed }
    })
  }

  audit.record({
    level: warnings.length > 0 ? 'warn' : 'info',
    category: 'system',
    action: 'start',
    result: 'ok',
    detail: { version: options.version, schemaVersion, freeDiskMb: freeMb, warnings }
  })

  const contentExists = (relativePath: string) => existsSync(join(paths.content, relativePath))
  const segmenter = options.modelsDir ? new ModnetSegmenter(join(options.modelsDir, 'modnet.onnx')) : null
  const portraitPath = options.portraitModelPath ?? (options.modelsDir ? join(options.modelsDir, 'birefnet-portrait.onnx') : null)
  const portraitSegmenter = portraitPath ? new BirefnetSegmenter(portraitPath) : null
  const photoSegmenter = portraitSegmenter?.available() ? portraitSegmenter : segmenter
  fileLogger.log('info', 'segmentation.photo_model', { model: portraitSegmenter?.available() ? 'birefnet-portrait' : 'modnet' })
  if (settings.get().background.method === 'segmentation' && !photoSegmenter?.available()) {
    warnings.push('El modelo de recorte automático no está instalado: ejecute npm run models')
  } else if (settings.get().background.method === 'segmentation' && !options.compositionWorkerPath) {
    // Carga en segundo plano: no retrasa el inicio y la primera foto no espera al modelo.
    void photoSegmenter?.warmUp().catch((error) => fileLogger.log('warn', 'segmentation.warmup_failed', { error }))
  }
  const participations = new SqliteParticipationRepository(db)
  const interrupted = participations.closeInterrupted(new Date().toISOString())
  if (interrupted > 0) {
    audit.record({ level: 'warn', category: 'session', action: 'interrupted', result: 'ok', detail: { participations: interrupted } })
  }
  const sessions = new SessionService(audit, () => checkCanStartSession(paths, settings), undefined, undefined, {
    onAbandoned: (participationId) => participations.markCancelled(participationId, new Date().toISOString()),
    onCompleted: (participationId) => participations.markCompleted(participationId, new Date().toISOString())
  })
  const attract = new AttractService(new SqliteMediaRepository(db), contentExists, contentUrl, audit)
  const campaigns = new CampaignCatalog(new SqliteCampaignRepository(db), contentExists, contentUrl, audit)
  const consents = new SqliteConsentRepository(db)
  const registration = new RegistrationService(sessions, campaigns, consents, participations, audit)
  const workerCompositor = options.compositionWorkerPath ? new WorkerCompositor(options.compositionWorkerPath, {
    dataRoot: paths.root, contentDir: paths.content, output: OUTPUT,
    model: portraitSegmenter?.available() ? 'birefnet' : 'modnet',
    modelPath: portraitSegmenter?.available() ? portraitPath! : segmenter?.available() ? join(options.modelsDir!, 'modnet.onnx') : undefined,
    // CPU FP32 conserva el comportamiento probado; DirectML solo se habilita para evaluación explícita.
    provider: process.env['TOTEM_PHOTO_PROVIDER'] === 'dml' ? 'dml' : 'cpu',
    threads: process.env['TOTEM_PHOTO_THREADS'] && /^\d+$/.test(process.env['TOTEM_PHOTO_THREADS'])
      ? Math.min(32, Number(process.env['TOTEM_PHOTO_THREADS'])) : Math.min(8, availableParallelism())
  }, (event) => {
    if (event.event === 'timing') fileLogger.log('info', 'composition.timing', { stage: event.stage, milliseconds: event.milliseconds })
    else {
      fileLogger.log('warn', 'composition.worker_warning', { message: event.message, error: event.error })
      audit.record({ level: 'warn', category: 'composition', action: event.message ?? 'worker_warning', result: 'fail', detail: { error: event.error } })
    }
  }) : null
  if (workerCompositor && settings.get().background.method === 'segmentation') {
    void workerCompositor.warmUp().catch((error: unknown) => fileLogger.log('warn', 'segmentation.warmup_failed', { error: String(error) }))
  }
  const capture = new CaptureService({
    sessions,
    repository: new SqliteCaptureRepository(db),
    files: new FsPhotoFiles(paths.root),
    compositor: workerCompositor ?? new SharpCompositor({
      dataRoot: paths.root,
      contentDir: paths.content,
      output: OUTPUT,
      segmenter: photoSegmenter?.available() ? photoSegmenter : null,
      onWarning: (message, error) =>
        audit.record({ level: 'warn', category: 'composition', action: message, result: 'fail', detail: { error } })
    }),
    settings: () => settings.get(),
    hasDiskSpace: () => checkCanStartSession(paths, settings).ok,
    contentFileExists: contentExists,
    audit
  })
  const defaults = options.publicationDefaults ?? null
  const client = publicationTarget({
    // Lo configurado en el panel tiene prioridad; si falta, lo incluido en el instalador.
    baseUrl: () => settings.get().publication.baseUrl || defaults?.baseUrl || '',
    secret: () => options.publicationSecret?.() ?? defaults?.secret ?? null,
    // Solo en desarrollo: configuración generada por `npm run publicador` para el servicio local.
    devFile: options.isDev ? join(paths.config, 'publication.dev.json') : undefined
  })
  const publication = new PublicationService({
    sessions,
    repository: new SqlitePublicationRepository(db),
    readFile: (filePath) => readFile(join(paths.root, filePath)),
    client,
    qr: qrDataUrl,
    settings: () => settings.get(),
    audit
  })
  const released = publication.recoverInterrupted()
  if (released > 0) {
    audit.record({ level: 'warn', category: 'publication', action: 'queue.recovered', result: 'ok', detail: { released } })
  }
  // Al recuperar la conexión se publican de inmediato todas las pendientes (RF-QR-009).
  const connectivity = new ConnectivityMonitor(client, audit, () => void publication.processQueue({ immediately: true }))

  return {
    ok: true,
    context: {
      stopImaging: () => workerCompositor?.dispose(),
      paths,
      logger: fileLogger,
      db,
      audit,
      settings,
      sessions,
      attract,
      campaigns,
      consents,
      registration,
      capture,
      segmenter: segmenter?.available() ? segmenter : null,
      publication,
      publicationClient: client,
      connectivity,
      schemaVersion
    },
    warnings,
    startedAt
  }
}

/** Sin espacio suficiente no se inicia una participación ni se piden datos personales (RF-ALM-002). */
function checkCanStartSession(paths: DataPaths, settings: SettingsService) {
  try {
    return freeDiskMegabytes(paths.root) < settings.get().storage.minFreeMegabytes
      ? ({ ok: false, reason: 'insufficient_disk' } as const)
      : ({ ok: true } as const)
  } catch {
    return { ok: false, reason: 'unavailable' } as const
  }
}
