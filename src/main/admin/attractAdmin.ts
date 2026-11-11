import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type { AdminAttract, AdminInput } from '../../shared/admin'
import type { AuditLog } from '../../core/audit/auditLog'
import type { SettingsService } from '../../core/settings/settingsService'
import { importImage, ImportError } from '../../infra/imaging/resourceImport'
import { AdminError } from './contentAdmin'

const FOLDER = 'institutional'

export interface AttractAdminDeps {
  settings: SettingsService
  contentDir: string
  toUrl: (relativePath: string) => string
  pickFile: (kind: 'image') => Promise<string | null>
  audit: AuditLog
}

type ImageKind = 'logo' | 'background'
const PATH_KEY = { logo: 'logoPath', background: 'backgroundPath' } as const

/** Pantalla principal institucional: textos, categorías, logotipo y fondo (RF-ATR-001). */
export class AttractAdmin {
  constructor(private readonly deps: AttractAdminDeps) {}

  get(): AdminAttract {
    const attract = this.deps.settings.get().attract
    const url = (path: string) => (path && existsSync(join(this.deps.contentDir, path)) ? this.deps.toUrl(path) : null)
    return { ...attract, logoUrl: url(attract.logoPath), backgroundUrl: url(attract.backgroundPath) }
  }

  /** Textos, categorías y modo; las imágenes se cambian con sus propias operaciones. */
  save(input: AdminInput<'attract.save'>, actorId: string): AdminAttract {
    const current = this.deps.settings.get()
    this.update({ ...current.attract, ...input }, actorId, 'attract.update', { mode: input.mode })
    return this.get()
  }

  async setImage(kind: ImageKind, actorId: string): Promise<AdminAttract | null> {
    const source = await this.deps.pickFile('image')
    if (!source) return null
    mkdirSync(join(this.deps.contentDir, FOLDER), { recursive: true })
    let filePath: string
    try {
      filePath = (await importImage(source, this.deps.contentDir, FOLDER)).filePath
    } catch (error) {
      if (error instanceof ImportError) throw new AdminError('invalid_file', error.message)
      throw error
    }
    this.replaceImage(kind, filePath, actorId)
    return this.get()
  }

  clearImage(kind: ImageKind, actorId: string): AdminAttract {
    this.replaceImage(kind, '', actorId)
    return this.get()
  }

  private replaceImage(kind: ImageKind, filePath: string, actorId: string): void {
    const attract = this.deps.settings.get().attract
    const previous = attract[PATH_KEY[kind]]
    this.update({ ...attract, [PATH_KEY[kind]]: filePath }, actorId, `attract.${kind}`, { removed: !filePath })
    if (previous && previous !== filePath) rmSync(join(this.deps.contentDir, previous), { force: true })
  }

  private update(attract: unknown, actorId: string, action: string, detail: Record<string, unknown>): void {
    const result = this.deps.settings.update({ ...this.deps.settings.get(), attract }, actorId)
    if (!result.ok) throw new AdminError('invalid_settings', result.errors.join('; '))
    this.deps.audit.record({ level: 'info', category: 'content', action, result: 'ok', actor: { type: 'user', id: actorId }, detail })
  }
}
