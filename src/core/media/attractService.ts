import type { AttractMediaItem } from '../../shared/ipc'
import type { AuditLog } from '../audit/auditLog'

export interface MediaRecord {
  id: string
  type: 'image' | 'video'
  name: string
  /** Ruta relativa a la carpeta de contenido. */
  filePath: string
  displaySeconds: number | null
}

export interface MediaRepository {
  /** Piezas activas y vigentes en el instante indicado, en el orden configurado. */
  listPlayable(nowIso: string): MediaRecord[]
}

export const DEFAULT_IMAGE_SECONDS = 8

/**
 * Contenido de la pantalla de atracción (RF-ATR-001, RF-ATR-003, RF-ATR-004).
 * Omite las piezas cuyo archivo falta o no se puede reproducir y lo registra una vez por ejecución.
 */
export class AttractService {
  private readonly reported = new Set<string>()

  constructor(
    private readonly repository: MediaRepository,
    private readonly fileExists: (relativePath: string) => boolean,
    private readonly toUrl: (relativePath: string) => string,
    private readonly audit: AuditLog,
    private readonly now: () => Date = () => new Date()
  ) {}

  list(): AttractMediaItem[] {
    const items: AttractMediaItem[] = []
    for (const record of this.repository.listPlayable(this.now().toISOString())) {
      if (!this.fileExists(record.filePath)) {
        this.reportOnce(record.id, 'missing_file', record.name)
        continue
      }
      items.push({
        id: record.id,
        type: record.type,
        url: this.toUrl(record.filePath),
        displaySeconds: record.displaySeconds ?? DEFAULT_IMAGE_SECONDS
      })
    }
    return items
  }

  /** La interfaz informa que una pieza no se pudo reproducir; la pieza se omite en el ciclo. */
  reportPlaybackError(id: string): void {
    this.reportOnce(id, 'playback_failed')
  }

  private reportOnce(id: string, reason: string, name?: string): void {
    const key = `${id}:${reason}`
    if (this.reported.has(key)) return
    this.reported.add(key)
    this.audit.record({
      level: 'warn',
      category: 'content',
      action: 'attract.media_skipped',
      result: 'skipped',
      entity: { type: 'media_item', id },
      detail: { reason, ...(name ? { name } : {}) }
    })
  }
}
