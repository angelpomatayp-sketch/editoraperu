import { randomUUID } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { extname, join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import type { AuditLog } from '../../core/audit/auditLog'

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.svg'])
const VIDEO_EXTENSIONS = new Set(['.mp4', '.webm'])
const SEED_SUBDIR = 'dev-seed'
const SEED_IMAGE_SECONDS = 6

/**
 * Solo desarrollo: si todavía no hay contenido de atracción, registra los archivos de
 * `resources/dev-seed/media`. Después se administra desde el panel, sin que vuelva lo borrado.
 */
export function syncDevSeedMedia(db: DatabaseSync, sourceDir: string, contentDir: string, audit: AuditLog): number {
  if (!existsSync(sourceDir) || db.prepare('SELECT 1 FROM media_items LIMIT 1').get()) return 0
  const targetDir = join(contentDir, 'media', SEED_SUBDIR)
  mkdirSync(targetDir, { recursive: true })

  const exists = db.prepare('SELECT 1 FROM media_items WHERE file_path = ?')
  const nextOrder = db.prepare('SELECT COALESCE(MAX(sort_order), 0) + 10 AS next FROM media_items')
  const insert = db.prepare(
    `INSERT INTO media_items (id, type, name, file_path, display_seconds, sort_order, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)`
  )

  let added = 0
  for (const name of readdirSync(sourceDir).sort()) {
    const source = join(sourceDir, name)
    const ext = extname(name).toLowerCase()
    const type = IMAGE_EXTENSIONS.has(ext) ? 'image' : VIDEO_EXTENSIONS.has(ext) ? 'video' : null
    if (!type || !statSync(source).isFile()) continue

    const relativePath = `media/${SEED_SUBDIR}/${name}`
    if (exists.get(relativePath)) continue

    copyFileSync(source, join(targetDir, name))
    const now = new Date().toISOString()
    const { next } = nextOrder.get() as { next: number }
    insert.run(randomUUID(), type, name, relativePath, type === 'image' ? SEED_IMAGE_SECONDS : null, next, now, now)
    added++
  }

  if (added > 0) {
    audit.record({ level: 'info', category: 'content', action: 'dev_seed.media', result: 'ok', detail: { added } })
  }
  return added
}
