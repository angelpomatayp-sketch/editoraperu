import { extname, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { net, protocol } from 'electron'
import { MEDIA_SCHEME, resolveAppUrl, resolveContentUrl } from '../infra/storage/contentPaths'

export const RENDERER_SCHEME = 'totem-app'

/** Debe llamarse antes de que la aplicación esté lista. */
export function registerMediaScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: MEDIA_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } },
    { scheme: RENDERER_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } }
  ])
}

const MIME: Record<string, string> = {
  '.wasm': 'application/wasm',
  '.js': 'text/javascript',
  '.tflite': 'application/octet-stream',
  '.webm': 'video/webm',
  '.mp4': 'video/mp4',
  '.gif': 'image/gif'
}

/** Sirve la interfaz instalada desde un origen seguro y estable, en lugar de `file://`. */
export function handleRendererProtocol(rendererDir: string): void {
  protocol.handle(RENDERER_SCHEME, async (request) => {
    if (request.method !== 'GET') return new Response(null, { status: 405 })
    const url = new URL(request.url)
    if (url.hostname !== 'renderer') return new Response(null, { status: 404 })
    let pathname: string
    try {
      pathname = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html'
    } catch {
      return new Response(null, { status: 400 })
    }
    const root = resolve(rendererDir)
    const target = resolve(root, pathname)
    const inside = relative(root, target)
    if (inside.startsWith(`..${sep}`) || inside === '..' || resolve(inside) === inside) {
      return new Response(null, { status: 404 })
    }
    return net.fetch(pathToFileURL(target).toString())
  })
}

/**
 * Sirve a la interfaz, en solo lectura:
 * - `totem-media://content/...`: multimedia y recursos de las campañas.
 * - `totem-media://app/...`: motor y modelos de recorte incluidos en la aplicación.
 * Todo lo que salga de esas carpetas responde 404.
 */
export function handleMediaProtocol(contentDir: string, appResourcesDir: string): void {
  protocol.handle(MEDIA_SCHEME, async (request) => {
    if (request.method !== 'GET') return new Response(null, { status: 405 })
    const file = resolveContentUrl(contentDir, request.url) ?? resolveAppUrl(appResourcesDir, request.url)
    if (!file) return new Response(null, { status: 404 })
    // Solo se reenvía Range (necesario para los videos); otras cabeceras pueden no ser ASCII.
    const range = request.headers.get('range')
    const response = await net.fetch(pathToFileURL(file).toString(), range ? { headers: { range } } : undefined)
    const mime = MIME[extname(file).toLowerCase()]
    if (!mime) return response
    // El motor WASM exige el tipo correcto para compilarse en streaming.
    const headers = new Headers(response.headers)
    headers.set('content-type', mime)
    // Canvas necesita acceso CORS para retirar el fondo de los videos de personajes.
    headers.set('access-control-allow-origin', '*')
    return new Response(response.body, { status: response.status, headers })
  })
}
