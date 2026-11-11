import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { AuditLog } from '../../src/core/audit/auditLog'
import { AdminAuth } from '../../src/core/auth/adminAuth'
import { ConnectivityMonitor } from '../../src/core/network/connectivityMonitor'
import { SettingsService } from '../../src/core/settings/settingsService'
import { AdminContentRepository } from '../../src/infra/db/repositories/adminContentRepository'
import { SqliteAuditRepository } from '../../src/infra/db/repositories/auditRepository'
import { SqliteSettingsRepository } from '../../src/infra/db/repositories/settingsRepository'
import { SqliteUserRepository } from '../../src/infra/db/repositories/userRepository'
import { contentUrl } from '../../src/infra/storage/contentPaths'
import { AdminApi } from '../../src/main/admin/adminApi'
import { AttractAdmin } from '../../src/main/admin/attractAdmin'
import { ContentAdmin, type FileKind } from '../../src/main/admin/contentAdmin'
import { SettingsAdmin } from '../../src/main/admin/settingsAdmin'
import { UsersAdmin } from '../../src/main/admin/usersAdmin'
import type { AdminMethod, AdminResult, LoginResult } from '../../src/shared/admin'
import { readFile } from 'node:fs/promises'
import type { PublicationClient } from '../../src/core/publication/publicationClient'
import { PublicationService } from '../../src/core/publication/publicationService'
import { OperationsRepository } from '../../src/infra/db/repositories/operationsRepository'
import { SqlitePublicationRepository } from '../../src/infra/db/repositories/publicationRepository'
import { Maintenance } from '../../src/main/admin/maintenance'
import { OperationsAdmin } from '../../src/main/admin/operationsAdmin'
import { seededApp } from './helpers'

/** Panel administrativo completo sobre la base de prueba; los archivos se eligen con `nextFile`. */
export function adminApp() {
  const app = seededApp()
  const files = mkdtempSync(join(tmpdir(), 'totem-uploads-'))
  const audit = new AuditLog(new SqliteAuditRepository(app.db), { log: () => {} })
  const settings = new SettingsService(new SqliteSettingsRepository(app.db), audit)
  settings.load()
  const users = new SqliteUserRepository(app.db)
  let clock = new Date('2026-10-05T15:00:00Z')
  const auth = new AdminAuth(users, () => settings.get(), audit, () => clock)
  const secret = { value: null as string | null }
  const picks: (string | null)[] = []
  const saves: (string | null)[] = []
  let quitBy: string | null = null
  const operationsRepo = new OperationsRepository(app.db)
  const publicationClient = { current: null as PublicationClient | null }
  const publication = new PublicationService({
    sessions: app.sessions,
    repository: new SqlitePublicationRepository(app.db),
    readFile: (filePath) => readFile(join(app.paths.root, filePath)),
    client: () => publicationClient.current,
    qr: async (url) => url,
    settings: () => settings.get(),
    audit,
    now: () => clock
  })
  const maintenance = new Maintenance({
    db: app.db,
    paths: app.paths,
    repo: operationsRepo,
    settings,
    settingsRepo: new SqliteSettingsRepository(app.db),
    freeDiskMb: () => 50_000,
    pickDirectory: async () => saves.shift() ?? null,
    saveFile: async () => saves.shift() ?? null,
    pickJson: async () => picks.shift() ?? null,
    version: 'test',
    schemaVersion: 2,
    audit,
    now: () => clock
  })

  const api = new AdminApi({
    auth,
    operations: new OperationsAdmin({
      repo: operationsRepo,
      dataRoot: app.paths.root,
      settings: () => settings.get(),
      client: () => publicationClient.current,
      publication,
      saveFile: async () => saves.shift() ?? null,
      audit,
      now: () => clock
    }),
    maintenance,
    content: new ContentAdmin({
      repo: new AdminContentRepository(app.db),
      contentDir: app.contentDir,
      toUrl: contentUrl,
      pickFile: async (_kind: FileKind) => picks.shift() ?? null,
      audit
    }),
    attract: new AttractAdmin({
      settings,
      contentDir: app.contentDir,
      toUrl: contentUrl,
      pickFile: async () => picks.shift() ?? null,
      audit
    }),
    users: new UsersAdmin(users, auth, audit, () => clock),
    settings: new SettingsAdmin(
      settings,
      { has: () => secret.value !== null, set: (v) => (secret.value = v) },
      new ConnectivityMonitor(() => null, audit, () => {}),
      audit,
      () => null
    ),
    dashboard: {
      db: app.db,
      availableCampaigns: () => app.catalog.listAvailable().length,
      connectivity: () => 'not_configured',
      freeDiskMb: () => 50_000,
      settings: () => settings.get(),
      now: () => clock
    },
    audit,
    quit: (actorId) => (quitBy = actorId)
  })

  /** Crea un archivo de imagen para la próxima selección del diálogo. */
  const nextFile = async (name: string, opts: { width?: number; height?: number; alpha?: boolean; format?: 'png' | 'jpeg' | 'webp' } = {}) => {
    const { width = 600, height = 1000, alpha = false, format = 'png' } = opts
    const path = join(files, name)
    await sharp({ create: { width, height, channels: alpha ? 4 : 3, background: alpha ? { r: 200, g: 50, b: 50, alpha: 0.5 } : '#3366aa' } })
      .toFormat(format)
      .toFile(path)
    picks.push(path)
    return path
  }

  const pickRaw = (path: string | null) => picks.push(path)

  /** GIF transparente de dos cuadros para probar la carga directa de personajes animados. */
  const nextGif = async (name = 'personaje.gif') => {
    const width = 240
    const pageHeight = 320
    const raw = Buffer.alloc(width * pageHeight * 2 * 4)
    for (let page = 0; page < 2; page++) {
      const left = page === 0 ? 30 : 120
      for (let y = 30; y < 290; y++) {
        for (let x = left; x < left + 70; x++) {
          const offset = (((page * pageHeight) + y) * width + x) * 4
          raw[offset] = 190
          raw[offset + 1] = 40
          raw[offset + 2] = 40
          raw[offset + 3] = 255
        }
      }
    }
    const path = join(files, name)
    await sharp(raw, { raw: { width, height: pageHeight * 2, channels: 4, pageHeight } })
      .gif({ delay: [500, 700], loop: 0, keepDuplicateFrames: true })
      .toFile(path)
    picks.push(path)
    return path
  }

  /** Llama al panel y devuelve los datos o lanza el error. */
  const call = async <T>(token: string, method: AdminMethod, payload?: unknown): Promise<T> => {
    const result = (await api.invoke(token, method, payload)) as AdminResult<T>
    if (!result.ok) throw Object.assign(new Error(result.message), { code: result.error })
    return result.data
  }

  const login = (username: string, password: string) => {
    const result = api.login({ username, password }) as LoginResult
    if (!result.ok) throw new Error(`login: ${result.error}`)
    return result.token
  }

  const admin = () => {
    const result = api.setup({ username: 'admin', displayName: 'Administración', password: 'editora2026' })
    if (!result.ok) throw new Error('setup')
    return result.token
  }

  return {
    app,
    api,
    files,
    publication,
    publicationClient,
    maintenance,
    /** Ruta que devolverá el próximo diálogo de guardar o de carpeta. */
    nextSave: (path: string | null) => saves.push(path),
    auth,
    users,
    settings,
    secret,
    call,
    login,
    admin,
    nextFile,
    nextGif,
    pickRaw,
    quitBy: () => quitBy,
    advance: (seconds: number) => (clock = new Date(clock.getTime() + seconds * 1000)),
    cleanup: () => {
      app.cleanup()
      rmSync(files, { recursive: true, force: true })
    }
  }
}
