import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { AdminAuth } from '../../core/auth/adminAuth'
import { AdminContentRepository } from '../../infra/db/repositories/adminContentRepository'
import { SqliteUserRepository } from '../../infra/db/repositories/userRepository'
import { contentUrl } from '../../infra/storage/contentPaths'
import { freeDiskMegabytes } from '../../infra/storage/paths'
import type { AppContext } from '../bootstrap'
import { BUILT_IN_PUBLICATION } from '../builtInPublication'
import { OperationsRepository } from '../../infra/db/repositories/operationsRepository'
import { SqliteSettingsRepository } from '../../infra/db/repositories/settingsRepository'
import { AdminApi } from './adminApi'
import { AttractAdmin } from './attractAdmin'
import { Maintenance } from './maintenance'
import { OperationsAdmin } from './operationsAdmin'
import { ContentAdmin, type FileKind } from './contentAdmin'
import { SettingsAdmin, type SecretAccess } from './settingsAdmin'
import { UsersAdmin } from './usersAdmin'
import { ensureDefaultConsents } from '../defaults/consents'

export interface AdminHost {
  pickFile: (kind: FileKind | 'json') => Promise<string | null>
  saveFile: (defaultName: string) => Promise<string | null>
  pickDirectory: () => Promise<string | null>
  quit: (actorId: string) => void
  secret: SecretAccess
  isDev: boolean
  version: string
}

/** Arma el módulo administrativo sobre el contexto de la aplicación. */
export function createAdmin(context: AppContext, host: AdminHost): { api: AdminApi; maintenance: Maintenance; content: ContentAdmin } {
  const content = new ContentAdmin({
    repo: new AdminContentRepository(context.db),
    contentDir: context.paths.content,
    toUrl: contentUrl,
    pickFile: host.pickFile,
    audit: context.audit,
    segmenter: context.segmenter
  })
  const users = new SqliteUserRepository(context.db)
  const operationsRepo = new OperationsRepository(context.db)
  const freeDisk = () => {
    try {
      return freeDiskMegabytes(context.paths.root)
    } catch {
      return null
    }
  }
  const maintenance = new Maintenance({
    db: context.db,
    paths: context.paths,
    repo: operationsRepo,
    settings: context.settings,
    settingsRepo: new SqliteSettingsRepository(context.db),
    freeDiskMb: freeDisk,
    pickDirectory: host.pickDirectory,
    saveFile: host.saveFile,
    pickJson: () => host.pickFile('json'),
    version: host.version,
    schemaVersion: context.schemaVersion,
    audit: context.audit
  })
  const auth = new AdminAuth(users, () => context.settings.get(), context.audit)
  const devFile = join(context.paths.config, 'publication.dev.json')

  const api = new AdminApi({
    refreshConsents: () => ensureDefaultConsents(context.db, context.settings.get().retention),
    auth,
    operations: new OperationsAdmin({
      repo: operationsRepo,
      dataRoot: context.paths.root,
      settings: () => context.settings.get(),
      client: context.publicationClient,
      publication: context.publication,
      saveFile: host.saveFile,
      audit: context.audit
    }),
    maintenance,
    content,
    attract: new AttractAdmin({
      settings: context.settings,
      contentDir: context.paths.content,
      toUrl: contentUrl,
      pickFile: host.pickFile,
      audit: context.audit
    }),
    users: new UsersAdmin(users, auth, context.audit),
    settings: new SettingsAdmin(
      context.settings,
      host.secret,
      context.connectivity,
      context.audit,
      () => {
        if (!host.isDev || !existsSync(devFile)) return null
        try {
          return (JSON.parse(readFileSync(devFile, 'utf8')) as { baseUrl?: string }).baseUrl ?? null
        } catch {
          return null
        }
      },
      BUILT_IN_PUBLICATION?.baseUrl ?? null
    ),
    dashboard: {
      db: context.db,
      availableCampaigns: () => context.campaigns.listAvailable().length,
      connectivity: () => context.connectivity.state,
      freeDiskMb: freeDisk,
      settings: () => context.settings.get()
    },
    audit: context.audit,
    quit: host.quit
  })
  return { api, maintenance, content }
}
