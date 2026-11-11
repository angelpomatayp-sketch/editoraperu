import { isAbsolute, relative, resolve, sep } from 'node:path'

export const MEDIA_SCHEME = 'totem-media'
const CONTENT_HOST = 'content'
const APP_HOST = 'app'

/** Carpetas de recursos de la aplicación que la interfaz puede leer (motor y modelos de recorte). */
const APP_FOLDERS = ['vendor', 'models']

/** URL interna para un archivo relativo a la carpeta de contenido. */
export function contentUrl(relativePath: string): string {
  const encoded = relativePath.split(/[\\/]+/).map(encodeURIComponent).join('/')
  return `${MEDIA_SCHEME}://${CONTENT_HOST}/${encoded}`
}

function resolveUnder(root: string, url: string, host: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.protocol !== `${MEDIA_SCHEME}:` || parsed.hostname !== host) return null

  let relativePath: string
  try {
    relativePath = decodeURIComponent(parsed.pathname).replace(/^\/+/, '')
  } catch {
    return null
  }
  if (!relativePath || relativePath.includes('\0')) return null

  const base = resolve(root)
  const target = resolve(base, relativePath)
  const rel = relative(base, target)
  if (!rel || rel.startsWith('..') || isAbsolute(rel) || rel.split(sep).includes('..')) return null
  return target
}

/**
 * Traduce una URL interna a una ruta absoluta dentro de la carpeta de contenido.
 * Devuelve `null` si la URL no es válida o intenta salir de esa carpeta.
 */
export function resolveContentUrl(contentDir: string, url: string): string | null {
  return resolveUnder(contentDir, url, CONTENT_HOST)
}

/**
 * Traduce `totem-media://app/...` a un archivo de los recursos de la aplicación, solo dentro de
 * las carpetas permitidas (motor WASM y modelos de recorte).
 */
export function resolveAppUrl(appResourcesDir: string, url: string): string | null {
  const target = resolveUnder(appResourcesDir, url, APP_HOST)
  if (!target) return null
  const first = relative(resolve(appResourcesDir), target).split(sep)[0]
  return first && APP_FOLDERS.includes(first) ? target : null
}
