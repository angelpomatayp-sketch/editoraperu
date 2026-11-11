import { readFile, writeFile } from 'node:fs/promises'
import { rmSync } from 'node:fs'
import { basename, join } from 'node:path'
import {
  PAGE_SIZE,
  type AuditFilters,
  type AuditRow,
  type DeletionResult,
  type ExportResult,
  type Page,
  type ParticipationDetail,
  type ParticipationFilters,
  type ParticipationPage,
  type ParticipationRow,
  type SummaryRow
} from '../../shared/admin'
import { CAMERA_SCENARIO_ID, CAMERA_SCENARIO_NAME, normalizeSelections } from '../../shared/campaign'
import type { Settings } from '../../shared/settings'
import type { AuditLog } from '../../core/audit/auditLog'
import type { PublicationClient } from '../../core/publication/publicationClient'
import type { PublicationService } from '../../core/publication/publicationService'
import { toCsv, type CsvColumn } from '../../core/reports/csv'
import type { OperationsRepository, ParticipationBaseRow } from '../../infra/db/repositories/operationsRepository'
import { AdminError } from './contentAdmin'

export interface OperationsDeps {
  repo: OperationsRepository
  dataRoot: string
  settings: () => Settings
  client: () => PublicationClient | null
  publication: PublicationService
  /** Diálogo para guardar un archivo; `null` si se canceló. */
  saveFile: (defaultName: string) => Promise<string | null>
  audit: AuditLog
  now?: () => Date
}

/** Qué puede ver quien consulta: con datos personales o sin ellos (RN-008). */
export interface Viewer {
  userId: string
  personal: boolean
}

/** Categorías visibles en la bitácora limitada del rol de contenido (sección 14). */
const CONTENT_CATEGORIES = ['content']

/**
 * Operación: participaciones, fotografías, eliminación a pedido, reintentos, reportes y bitácora
 * (8.16 a 8.19). Los datos personales solo se entregan a quien tiene el permiso correspondiente.
 */
export class OperationsAdmin {
  private readonly now: () => Date

  constructor(private readonly deps: OperationsDeps) {
    this.now = deps.now ?? (() => new Date())
  }

  // ----- Participaciones (8.16) -----

  list(filters: ParticipationFilters, page: number, viewer: Viewer): ParticipationPage {
    this.guardDni(filters, viewer)
    const { rows, total } = this.deps.repo.listParticipations(filters, this.iso(), PAGE_SIZE, (page - 1) * PAGE_SIZE)
    return {
      items: rows.map((r) => this.row(r, viewer)),
      total,
      page,
      pageSize: PAGE_SIZE,
      campaigns: this.deps.repo.campaignNames(),
      personal: viewer.personal
    }
  }

  get(id: string, viewer: Viewer): ParticipationDetail {
    const base = this.deps.repo.getParticipation(id, this.iso())
    if (!base) throw new AdminError('not_found', 'La participación no existe')
    const selections = normalizeSelections(JSON.parse(base.selections_json))
    const names = this.deps.repo.resourceNames([selections.scenarioId, ...selections.characterIds, selections.frameId].filter((x): x is string => Boolean(x)))
    return {
      ...this.row(base, viewer),
      campaignId: base.campaign_id,
      confirmedAt: base.confirmed_at,
      selections: {
        scenario: selections.scenarioId === CAMERA_SCENARIO_ID ? CAMERA_SCENARIO_NAME : (names.get(selections.scenarioId) ?? null),
        characters: selections.characterIds.map((c) => names.get(c) ?? '?'),
        frame: selections.frameId ? (names.get(selections.frameId) ?? null) : null
      },
      consents: this.deps.repo.consents(id).map((c) => ({
        title: c.title,
        type: c.type,
        version: c.version,
        accepted: c.accepted === 1,
        recordedAt: c.recorded_at
      })),
      photos: this.deps.repo.photos(id).map((p) => ({
        id: p.id,
        kind: p.kind,
        status: p.status === 'published' && p.expires_at && p.expires_at <= this.iso() ? 'expired' : p.status,
        width: p.width,
        height: p.height,
        createdAt: p.created_at,
        publishedAt: p.published_at,
        expiresAt: p.expires_at,
        tokenHint: p.public_token ? `${p.public_token.slice(0, 6)}…` : null,
        queue: p.queue_status ? { status: p.queue_status, attempts: p.queue_attempts ?? 0, lastError: p.queue_error } : null
      }))
    }
  }

  /** Imagen de una fotografía para verla en el panel (RF-FOT-001); exige permiso de datos personales. */
  async photo(photoId: string, viewer: Viewer): Promise<string> {
    const photo = this.deps.repo.photo(photoId)
    if (!photo?.file_path) throw new AdminError('not_found', 'La fotografía no está disponible')
    this.deps.audit.record({
      level: 'info',
      category: 'session',
      action: 'photo.view',
      result: 'ok',
      actor: { type: 'user', id: viewer.userId },
      entity: { type: 'photo', id: photoId }
    })
    return `data:image/jpeg;base64,${(await readFile(join(this.deps.dataRoot, photo.file_path))).toString('base64')}`
  }

  /**
   * Solicitud de eliminación (RF-PAR-005): se eliminan los archivos locales, se intenta eliminar la
   * copia publicada y se anonimiza la participación. La constancia técnica y la evidencia de los
   * consentimientos se conservan. Los respaldos ya hechos deben tratarse según PD-011.
   */
  async delete(id: string, reason: string, viewer: Viewer): Promise<DeletionResult> {
    if (!this.deps.repo.getParticipation(id, this.iso())) throw new AdminError('not_found', 'La participación no existe')
    const result: DeletionResult = { localPhotosDeleted: 0, remoteDeleted: 0, remotePending: 0 }
    const client = this.deps.client()

    for (const photo of this.deps.repo.photos(id)) {
      if (photo.public_token) {
        try {
          if (!client) throw new Error('no configurado')
          await client.remove(photo.id)
          result.remoteDeleted++
        } catch {
          result.remotePending++
        }
      }
      if (photo.file_path) {
        rmSync(join(this.deps.dataRoot, photo.file_path), { force: true })
        result.localPhotosDeleted++
      }
      if (photo.status !== 'deleted') this.deps.repo.markPhotoDeleted(photo.id, this.iso())
    }
    this.deps.repo.anonymize(id, this.iso())
    this.deps.audit.record({
      level: 'warn',
      category: 'session',
      action: 'participation.delete_request',
      result: 'ok',
      actor: { type: 'user', id: viewer.userId },
      entity: { type: 'participation', id },
      detail: { reason, ...result }
    })
    return result
  }

  /** Reintento manual de una publicación pendiente o fallida (RF-FOT-003). */
  async retry(photoId: string, viewer: Viewer): Promise<{ published: boolean }> {
    if (!this.deps.repo.requeue(photoId, this.iso())) {
      throw new AdminError('not_retryable', 'Esta fotografía no tiene una publicación pendiente o fallida')
    }
    const outcome = await this.deps.publication.processQueue()
    const published = this.deps.repo.photo(photoId)?.status === 'published'
    this.deps.audit.record({
      level: published ? 'info' : 'warn',
      category: 'publication',
      action: 'publish.manual_retry',
      result: published ? 'ok' : 'fail',
      actor: { type: 'user', id: viewer.userId },
      entity: { type: 'photo', id: photoId },
      detail: { ...outcome }
    })
    return { published }
  }

  // ----- Reportes (8.18) -----

  async exportParticipations(filters: ParticipationFilters, viewer: Viewer): Promise<ExportResult> {
    this.guardDni(filters, viewer)
    const rows = this.deps.repo.allParticipations(filters, this.iso())
    const columns: CsvColumn<ParticipationBaseRow>[] = [
      { header: 'Identificador', value: (r) => r.id },
      { header: 'Campaña', value: (r) => r.campaign_name },
      { header: 'Inicio', value: (r) => this.local(r.started_at) },
      { header: 'Confirmación', value: (r) => this.local(r.confirmed_at) },
      { header: 'Fin', value: (r) => this.local(r.finished_at) },
      { header: 'Estado', value: (r) => r.status },
      { header: 'Fotografía', value: (r) => r.photo_status },
      ...(viewer.personal
        ? [
            { header: 'Nombres', value: (r: ParticipationBaseRow) => r.first_names },
            { header: 'Apellidos', value: (r: ParticipationBaseRow) => r.last_names },
            { header: 'DNI', value: (r: ParticipationBaseRow) => r.document_number }
          ]
        : [])
    ]
    return this.export('participaciones', toCsv(rows, columns), rows.length, viewer, { filters, personalData: viewer.personal })
  }

  /** Totales por campaña, día y estado de publicación (RF-REP-004). */
  summary(filters: ParticipationFilters): SummaryRow[] {
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: this.deps.settings().timezone, year: 'numeric', month: '2-digit', day: '2-digit' })
    const groups = new Map<string, SummaryRow>()
    for (const r of this.deps.repo.allParticipations({ ...filters, dni: null }, this.iso())) {
      const d = day.format(new Date(r.started_at))
      const key = `${r.campaign_name}\n${d}`
      const g = groups.get(key) ?? { campaignName: r.campaign_name, day: d, participations: 0, completed: 0, cancelled: 0, published: 0, pendingOrFailed: 0 }
      g.participations++
      if (r.status === 'completed') g.completed++
      if (r.status === 'cancelled') g.cancelled++
      if (r.photo_status === 'published' || r.photo_status === 'expired') g.published++
      if (r.photo_status === 'pending' || r.photo_status === 'failed') g.pendingOrFailed++
      groups.set(key, g)
    }
    return [...groups.values()].sort((a, b) => b.day.localeCompare(a.day) || a.campaignName.localeCompare(b.campaignName))
  }

  async exportAudit(filters: AuditFilters, full: boolean, viewer: Viewer): Promise<ExportResult> {
    const rows = this.auditRows(filters, full, 10_000, 0).items
    const csv = toCsv(rows, [
      { header: 'Fecha', value: (r) => this.local(r.occurredAt) },
      { header: 'Nivel', value: (r) => r.level },
      { header: 'Categoría', value: (r) => r.category },
      { header: 'Acción', value: (r) => r.action },
      { header: 'Resultado', value: (r) => r.result },
      { header: 'Usuario o componente', value: (r) => r.actor },
      { header: 'Entidad', value: (r) => r.entity },
      { header: 'Detalle', value: (r) => r.detail }
    ])
    return this.export('bitacora', csv, rows.length, viewer, { filters })
  }

  // ----- Bitácora (8.19) -----

  auditPage(filters: AuditFilters, page: number, full: boolean): Page<AuditRow> & { categories: string[] } {
    const result = this.auditRows(filters, full, PAGE_SIZE, (page - 1) * PAGE_SIZE)
    const categories = full ? this.deps.repo.auditCategories() : CONTENT_CATEGORIES
    return { ...result, page, pageSize: PAGE_SIZE, categories }
  }

  private auditRows(filters: AuditFilters, full: boolean, limit: number, offset: number): { items: AuditRow[]; total: number } {
    const { rows, total } = this.deps.repo.audit(filters, full ? null : CONTENT_CATEGORIES, limit, offset)
    const users = this.deps.repo.usernames([...new Set(rows.filter((r) => r.actor_type === 'user' && r.actor_id).map((r) => r.actor_id!))])
    return {
      total,
      items: rows.map((r) => ({
        id: r.id,
        occurredAt: r.occurred_at,
        level: r.level,
        category: r.category,
        action: r.action,
        result: r.result,
        actor: r.actor_type === 'user' ? (users.get(r.actor_id ?? '') ?? r.actor_id) : r.actor_type,
        entity: r.entity_type ? `${r.entity_type}:${r.entity_id?.slice(0, 8) ?? ''}` : null,
        detail: r.detail_json
      }))
    }
  }

  // ----- Apoyo -----

  private row(r: ParticipationBaseRow, viewer: Viewer): ParticipationRow {
    return {
      id: r.id,
      campaignName: r.campaign_name,
      status: r.status as ParticipationRow['status'],
      photoStatus: r.photo_status as ParticipationRow['photoStatus'],
      startedAt: r.started_at,
      finishedAt: r.finished_at,
      fullName: viewer.personal && r.first_names ? `${r.first_names} ${r.last_names ?? ''}`.trim() : null,
      dni: viewer.personal ? r.document_number : null
    }
  }

  /** La búsqueda por DNI queda limitada a roles autorizados (RF-PAR-002). */
  private guardDni(filters: ParticipationFilters, viewer: Viewer): void {
    if (filters.dni && !viewer.personal) throw new AdminError('forbidden', 'Su rol no puede buscar por DNI')
  }

  private async export(prefix: string, csv: string, rows: number, viewer: Viewer, detail: Record<string, unknown>): Promise<ExportResult> {
    const stamp = this.local(this.iso())!.replace(/[^\d]/g, '').slice(0, 12)
    const path = await this.deps.saveFile(`${prefix}-${stamp}.csv`)
    if (!path) return { saved: false, rows, fileName: null }
    await writeFile(path, csv, 'utf8')
    // RF-REP-003: usuario, fecha, filtros y resultado de la exportación.
    this.deps.audit.record({
      level: 'info',
      category: 'export',
      action: `report.${prefix}`,
      result: 'ok',
      actor: { type: 'user', id: viewer.userId },
      detail: { ...detail, rows, file: basename(path) }
    })
    return { saved: true, rows, fileName: basename(path) }
  }

  private local(iso: string | null): string | null {
    if (!iso) return null
    return new Intl.DateTimeFormat('es-PE', {
      timeZone: this.deps.settings().timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23'
    }).format(new Date(iso))
  }

  private iso(): string {
    return this.now().toISOString()
  }
}
