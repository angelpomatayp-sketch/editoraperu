import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { AuditLog } from '../../src/core/audit/auditLog'
import { CampaignCatalog } from '../../src/core/campaigns/campaignCatalog'
import { CaptureService, type Compositor } from '../../src/core/capture/captureService'
import { RegistrationService } from '../../src/core/participants/registrationService'
import { SessionService } from '../../src/core/session/sessionService'
import { MIGRATIONS } from '../../src/infra/db/migrations'
import { migrate } from '../../src/infra/db/migrator'
import { SqliteAuditRepository } from '../../src/infra/db/repositories/auditRepository'
import { SqliteCampaignRepository } from '../../src/infra/db/repositories/campaignRepository'
import { SqliteCaptureRepository } from '../../src/infra/db/repositories/captureRepository'
import { SqliteConsentRepository } from '../../src/infra/db/repositories/consentRepository'
import { SqliteParticipationRepository } from '../../src/infra/db/repositories/participationRepository'
import { FsPhotoFiles } from '../../src/infra/imaging/photoFiles'
import { SharpCompositor } from '../../src/infra/imaging/sharpCompositor'
import { contentUrl } from '../../src/infra/storage/contentPaths'
import { ensureDataPaths, resolveDataPaths } from '../../src/infra/storage/paths'
import { ensureDefaultConsents } from '../../src/main/defaults/consents'
import { syncDevSeedCampaigns } from '../../src/main/devSeed/campaigns'
import type { RegistrationInput } from '../../src/shared/registration'
import { OUTPUT } from '../../src/shared/composition'
import { DEFAULT_SETTINGS, type Settings } from '../../src/shared/settings'

interface SeededOptions {
  now?: () => Date
  settings?: Settings
  hasDiskSpace?: () => boolean
  compositor?: Compositor
}

/** Carpeta de datos temporal con la base, las campañas y textos legales de prueba, y los servicios del recorrido. */
export function seededApp(options: SeededOptions = {}) {
  const now = options.now ?? (() => new Date())
  const paths = resolveDataPaths(mkdtempSync(join(tmpdir(), 'totem-data-')))
  ensureDataPaths(paths)
  const contentDir = paths.content
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON')
  migrate(db, MIGRATIONS)
  const audit = new AuditLog(new SqliteAuditRepository(db), { log: () => {} })
  syncDevSeedCampaigns(db, contentDir, audit)
  ensureDefaultConsents(db)

  const fileExists = (p: string) => existsSync(join(contentDir, p))
  const participations = new SqliteParticipationRepository(db)
  const sessions = new SessionService(audit, () => ({ ok: true }), now, undefined, {
    onAbandoned: (id) => participations.markCancelled(id, now().toISOString()),
    onCompleted: (id) => participations.markCompleted(id, now().toISOString())
  })
  const catalog = new CampaignCatalog(new SqliteCampaignRepository(db), fileExists, contentUrl, audit, now)
  const consents = new SqliteConsentRepository(db)
  const registration = new RegistrationService(sessions, catalog, consents, participations, audit, now)
  const capture = new CaptureService({
    sessions,
    repository: new SqliteCaptureRepository(db),
    files: new FsPhotoFiles(paths.root),
    compositor: options.compositor ?? new SharpCompositor({ dataRoot: paths.root, contentDir, output: OUTPUT }),
    // Las capturas sintéticas de las pruebas tienen fondo verde: por defecto se recortan con croma.
    settings: () => options.settings ?? { ...DEFAULT_SETTINGS, background: { method: 'chroma' } },
    hasDiskSpace: options.hasDiskSpace ?? (() => true),
    contentFileExists: fileExists,
    audit
  })

  const campaignId = (code: string) =>
    (db.prepare('SELECT id FROM campaigns WHERE code = ?').get(code) as { id: string }).id

  /** Inicia una sesión, elige la campaña y registra una participación válida. */
  const registerParticipant = (code = 'DEMO-LECTURA', choose?: (input: RegistrationInput) => void) => {
    const start = sessions.start()
    if (!start.ok) throw new Error('no inició')
    const id = campaignId(code)
    const detail = catalog.getDetail(id)!
    sessions.selectCampaign(start.sessionId, { id, configVersion: detail.configVersion })
    const input: RegistrationInput = {
      sessionId: start.sessionId,
      campaignId: id,
      selections: {
        scenarioId: detail.scenarios[0]!.id,
        characterIds: detail.characters[0] ? [detail.characters[0].id] : [],
        frameId: detail.frameMode === 'required' && detail.frames.length > 1 ? detail.frames[0]!.id : null
      },
      participant: { firstNames: 'Ana', lastNames: 'Quispe', dni: '12345678' },
      consents: consents.listActive().map((c) => ({ versionId: c.id, accepted: true }))
    }
    choose?.(input)
    const result = registration.register(input)
    if (!result.ok) throw new Error(`registro falló: ${result.error}`)
    return { sessionId: start.sessionId, participationId: result.participationId, detail }
  }

  return {
    db,
    paths,
    contentDir,
    sessions,
    catalog,
    consents,
    registration,
    capture,
    campaignId,
    registerParticipant,
    cleanup: () => {
      db.close()
      rmSync(paths.root, { recursive: true, force: true })
    }
  }
}
