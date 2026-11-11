import { existsSync, readFileSync } from 'node:fs'
import { z } from 'zod'
import type { PublicationClient } from '../../core/publication/publicationClient'
import { HttpPublicationClient } from './httpPublicationClient'

const devTargetSchema = z.object({ baseUrl: z.url(), secret: z.string().min(32) })

export interface TargetSources {
  /** URL configurada (parámetro `publication.baseUrl`). */
  baseUrl: () => string
  /** Clave compartida guardada de forma protegida; `null` si no se configuró. */
  secret: () => string | null
  /** Solo desarrollo: archivo generado por `npm run publicador` con URL y clave del servicio local. */
  devFile?: string
}

/**
 * Devuelve el cliente del servicio de publicación configurado o `null` si falta la URL o la clave.
 * El cliente se reutiliza mientras la configuración no cambie.
 */
export function publicationTarget(sources: TargetSources): () => PublicationClient | null {
  let cached: { key: string; client: PublicationClient } | null = null

  const resolve = (): { baseUrl: string; secret: string } | null => {
    if (sources.devFile && existsSync(sources.devFile)) {
      try {
        const parsed = devTargetSchema.safeParse(JSON.parse(readFileSync(sources.devFile, 'utf8')))
        if (parsed.success) return parsed.data
      } catch {
        // Archivo de desarrollo dañado: se usa la configuración normal.
      }
    }
    const baseUrl = sources.baseUrl()
    const secret = sources.secret()
    return baseUrl && secret ? { baseUrl, secret } : null
  }

  return () => {
    const target = resolve()
    if (!target) return null
    const key = `${target.baseUrl}\n${target.secret}`
    if (cached?.key !== key) cached = { key, client: new HttpPublicationClient(target.baseUrl, target.secret) }
    return cached.client
  }
}
