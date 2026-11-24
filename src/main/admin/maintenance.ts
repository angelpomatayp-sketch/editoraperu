import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import type { MaintenanceStatus } from '../../shared/admin'
import { settingsSchema, type Settings } from '../../shared/settings'
import type { AuditLog } from '../../core/audit/auditLog'
import { mergeWithDefaults, type SettingsRepository, type SettingsService } from '../../core/settings/settingsService'
import { backupDatabase } from '../../infra/db/connection'
import type { OperationsRepository } from '../../infra/db/repositories/operationsRepository'
import type { DataPaths } from '../../infra/storage/paths'
import { AdminError } from './contentAdmin'

const LAST_BACKUP_KEY = 'maintenance.lastBackupAt'
const DAY_MS = 24 * 3600 * 1000

export interface MaintenanceDeps {
  db: DatabaseSync
  paths: DataPaths
  repo: OperationsRepository
  settings: SettingsService
  settingsRepo: SettingsRepository
  freeDiskMb: () => number | null
  pickDirectory: () => Promise<string | null>
  saveFile: (defaultName: string) => Promise<string | null>
  pickJson: () => Promise<string | null>
  version: string
  schemaVersion: number
  audit: AuditLog
  now?: () => Date
}

function sizeMb(path: string): number {
  if (!existsSync(path)) return 0
  let total = 0
  const walk = (p: string) => {
    const stat = statSync(p)
    if (stat.isDirectory()) for (const name of readdirSync(p)) walk(join(p, name))
    else total += stat.size
  }
  walk(path)
  return Math.round((total / 1024 / 1024) * 10) / 10
}

/**
 * Mantenimiento (8.22): uso del almacenamiento, respaldo (RF-ALM-005), política de conservación
 * (RF-FOT-005) y copia de la configuración (RF-CFG-004).
 */
export class Maintenance {
  private readonly now: () => Date

  constructor(private readonly deps: MaintenanceDeps) {
    this.now = deps.now ?? (() => new Date())
  }

  status(): MaintenanceStatus {
    const { paths } = this.deps
    const retention = this.deps.settings.get().retention
    const preview = this.retentionTargets()
    return {
      dataRoot: paths.root,
      databaseMb: sizeMb(paths.db),
      contentMb: sizeMb(paths.content),
      photosMb: sizeMb(join(paths.root, 'photos')),
      logsMb: sizeMb(paths.logs),
      freeDiskMb: this.deps.freeDiskMb(),
      retention,
      retentionPreview: { photos: preview.photos.length, participations: preview.participations.length },
      lastBackupAt: this.deps.settingsRepo.read(LAST_BACKUP_KEY)
    }
  }

  /**
   * Respaldo en una carpeta elegida: base de datos (copia consistente), contenido, configuración sin
   * secretos y, opcionalmente, fotografías. Contiene datos personales: el destino y su cifrado deben
   * definirse (PD-011).
   */
  async backup(includePhotos: boolean, actorId: string): Promise<{ saved: boolean; folder: string | null }> {
    const target = await this.deps.pickDirectory()
    if (!target) return { saved: false, folder: null }
    const stamp = this.now().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15)
    const folder = join(target, `respaldo-totem-${stamp}`)
    if (existsSync(folder)) throw new AdminError('exists', 'Ya existe un respaldo con ese nombre; intente de nuevo')
    mkdirSync(folder, { recursive: true })
    try {
      backupDatabase(this.deps.db, join(folder, 'totem.sqlite'))
      cpSync(this.deps.paths.content, join(folder, 'content'), { recursive: true })
      if (includePhotos) cpSync(join(this.deps.paths.root, 'photos'), join(folder, 'photos'), { recursive: true })
      writeFileSync(join(folder, 'configuracion.json'), JSON.stringify(this.deps.settings.get(), null, 2))
      writeFileSync(
        join(folder, 'manifiesto.json'),
        JSON.stringify(
          {
            creado: this.now().toISOString(),
            version: this.deps.version,
            esquema: this.deps.schemaVersion,
            incluyeFotografias: includePhotos,
            nota: 'Contiene datos personales. La clave del servicio de publicación no se incluye y debe registrarse de nuevo al restaurar.'
          },
          null,
          2
        )
      )
    } catch (error) {
      rmSync(folder, { recursive: true, force: true })
      throw error
    }
    this.deps.settingsRepo.write(LAST_BACKUP_KEY, this.now().toISOString(), actorId)
    this.deps.audit.record({
      level: 'info',
      category: 'storage',
      action: 'backup',
      result: 'ok',
      actor: { type: 'user', id: actorId },
      detail: { includePhotos, folder: folder.split(/[\\/]/).pop() }
    })
    return { saved: true, folder }
  }

  /**
   * Aplica la política de conservación (RF-FOT-005): elimina fotografías y anonimiza datos personales
   * con más antigüedad que la configurada. Solo actúa si la política está activada (RN-009).
   */
  runRetention(actor: { type: 'user' | 'system'; id?: string }): { photos: number; participations: number } {
    if (!this.deps.settings.get().retention.enabled) {
      throw new AdminError('retention_disabled', 'La política de conservación está desactivada hasta su aprobación (PD-002)')
    }
    const targets = this.retentionTargets()
    const nowIso = this.now().toISOString()
    const warnBefore = new Date(this.now().getTime() - Math.max(0, this.deps.settings.get().retention.photoDays - 1) * DAY_MS).toISOString()
    const warned = this.deps.repo.warnPhotoRetention(warnBefore, nowIso)
    if (warned) this.deps.audit.record({ level: 'warn', category: 'storage', action: 'retention.notice', result: 'ok', actor, detail: { photos: warned, minimumNoticeHours: 24 } })
    const warnedBefore = new Date(this.now().getTime() - DAY_MS).toISOString()
    const eligible = targets.photos.filter(photo => this.deps.repo.wasWarnedBefore(photo.id, warnedBefore))
    for (const photo of eligible) {
      rmSync(join(this.deps.paths.root, photo.file_path), { force: true })
      this.deps.repo.markLocalPhotoPurged(photo.id, nowIso)
    }
    for (const id of targets.participations) this.deps.repo.anonymize(id, nowIso)
    const result = { photos: eligible.length, participations: targets.participations.length }
    this.deps.audit.record({ level: 'info', category: 'storage', action: 'retention', result: 'ok', actor, detail: result })
    return result
  }

  async exportConfig(actorId: string): Promise<{ saved: boolean }> {
    const path = await this.deps.saveFile('configuracion-totem.json')
    if (!path) return { saved: false }
    writeFileSync(path, JSON.stringify(this.deps.settings.get(), null, 2), 'utf8')
    this.deps.audit.record({ level: 'info', category: 'config', action: 'config.export', result: 'ok', actor: { type: 'user', id: actorId } })
    return { saved: true }
  }

  /** Restaura una configuración validada; un archivo inválido no cambia nada (RF-CFG-003). */
  async importConfig(actorId: string): Promise<Settings | null> {
    const path = await this.deps.pickJson()
    if (!path) return null
    let parsedJson: unknown
    try {
      parsedJson = JSON.parse(readFileSync(path, 'utf8'))
    } catch {
      throw new AdminError('invalid_file', 'El archivo no es una configuración válida')
    }
    const parsed = settingsSchema.safeParse(mergeWithDefaults(parsedJson))
    if (!parsed.success) throw new AdminError('invalid_file', `Configuración inválida: ${parsed.error.issues[0]?.message ?? ''}`)
    const result = this.deps.settings.update(parsed.data, actorId)
    if (!result.ok) throw new AdminError('invalid_file', result.errors.join('; '))
    this.deps.audit.record({ level: 'info', category: 'config', action: 'config.import', result: 'ok', actor: { type: 'user', id: actorId } })
    return result.settings
  }

  private retentionTargets() {
    const { photoDays, personalDataDays } = this.deps.settings.get().retention
    const now = this.now().getTime()
    return {
      photos: this.deps.repo.photosOlderThan(new Date(now - photoDays * DAY_MS).toISOString()),
      participations: this.deps.repo.participationsWithPersonalDataOlderThan(new Date(now - personalDataDays * DAY_MS).toISOString())
    }
  }
}
