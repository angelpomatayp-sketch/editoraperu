// Verifica el servicio de publicación ya subido, firmando como el tótem.
//
//   npm run publicador:verificar
//
// Usa la URL y la clave de .data/config/publicador-produccion.json. Sube una imagen de prueba
// (no es una foto de una persona), revisa la página y la descarga, y al final la borra.
import { createHash, createHmac, randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const secretFile = join(root, '.data', 'config', 'publicador-produccion.json')
// PUBLICADOR_URL y PUBLICADOR_SECRET permiten verificar otro servidor (por ejemplo, uno local).
const override = process.env.PUBLICADOR_URL ? { baseUrl: process.env.PUBLICADOR_URL, secret: process.env.PUBLICADOR_SECRET ?? '' } : null
if (!override && !existsSync(secretFile)) {
  console.error('Falta la configuración de producción: ejecute primero npm run publicador:paquete')
  process.exit(1)
}
const { baseUrl, secret } = override ?? JSON.parse(readFileSync(secretFile, 'utf8'))
const results = []
const check = (name, ok, detail = '') => {
  results.push(ok)
  console.log(`${ok ? '✔' : '✘'} ${name}${detail ? ` — ${detail}` : ''}`)
}

// Igual que el tótem: la firma cubre los bytes del JPEG y la foto viaja como formulario (campo «photo»).
const signed = async (method, path, jpeg = new Uint8Array(), headers = {}) => {
  const timestamp = String(Math.floor(Date.now() / 1000))
  const bodyHash = createHash('sha256').update(jpeg).digest('hex')
  const signature = createHmac('sha256', secret).update(`${method}\n${path}\n${timestamp}\n${bodyHash}`, 'utf8').digest('hex')
  let body
  if (jpeg.length) {
    body = new FormData()
    body.append('photo', new Blob([jpeg], { type: 'image/jpeg' }), 'foto.jpg')
  }
  return fetch(new URL(path, baseUrl), {
    method,
    body,
    headers: { 'X-Totem-Timestamp': timestamp, 'X-Totem-Signature': signature, ...headers }
  })
}

try {
  const health = await fetch(new URL('/api/v1/health', baseUrl))
  const healthBody = await health.text()
  check('Disponibilidad por HTTPS (/api/v1/health)', health.status === 200 && healthBody.includes('"ok"'), `${health.status} ${healthBody.slice(0, 80)}`)
  if (health.status === 200) {
    const serverTime = Date.parse(JSON.parse(healthBody).time)
    const skew = Math.round(Math.abs(serverTime - Date.now()) / 1000)
    check('Hora del servidor y de este equipo', skew < 120, `diferencia ${skew} s (máximo aceptado 300 s)`)
  }

  const http = await fetch(baseUrl.replace('https://', 'http://') + '/api/v1/health', { redirect: 'manual' })
  check('HTTP redirige a HTTPS', http.status === 301 || http.status === 302 || http.status === 308, `${http.status} ${http.headers.get('location') ?? ''}`)

  const unsigned = await fetch(new URL('/api/v1/photos', baseUrl), { method: 'POST', body: 'x' })
  check('Rechaza cargas sin firma', unsigned.status === 401, String(unsigned.status))

  const jpeg = new Uint8Array(
    await sharp({ create: { width: 1080, height: 1920, channels: 3, background: '#1d4e89' } })
      .composite([{ input: Buffer.from('<svg width="1080" height="1920"><text x="540" y="960" font-size="90" fill="white" text-anchor="middle">Prueba del servicio</text></svg>') }])
      .jpeg({ quality: 85 })
      .toBuffer()
  )
  const id = randomUUID()
  const upload = await signed('POST', '/api/v1/photos', jpeg, { 'X-Idempotency-Key': id })
  const uploadText = await upload.text()
  const ok = upload.status === 201 || upload.status === 200
  check('Carga firmada de una foto (como el tótem)', ok, `${upload.status} ${ok ? '' : uploadText.slice(0, 300)}`)
  if (!ok) {
    console.log(`   enviado: ruta /api/v1/photos, ${jpeg.length} bytes, sha256 ${createHash('sha256').update(jpeg).digest('hex')}`)
  }
  if (!ok) {
    if (upload.status === 403) console.log('   403: probablemente ModSecurity del hosting bloquea la carga; ver la guía.')
    throw new Error('no se pudo cargar')
  }
  const { url } = JSON.parse(uploadText)
  check('El enlace es HTTPS y del subdominio', url.startsWith(baseUrl + '/f/'), url.replace(/\/f\/(.{6}).*/, '/f/$1…'))

  const again = await signed('POST', '/api/v1/photos', jpeg, { 'X-Idempotency-Key': id })
  check('Reintento de la misma foto no la duplica', again.status === 200, String(again.status))

  const page = await fetch(url)
  const html = await page.text()
  check('Página de descarga', page.status === 200 && html.includes('Descargar'), String(page.status))
  const image = await fetch(url + '/image')
  check('Imagen en la página', image.status === 200 && image.headers.get('content-type') === 'image/jpeg', `${image.status} ${image.headers.get('content-type')}`)
  const download = await fetch(url + '/download')
  const bytes = new Uint8Array(await download.arrayBuffer())
  check(
    'Descarga como archivo',
    download.status === 200 && (download.headers.get('content-disposition') ?? '').includes('attachment') && bytes.length === jpeg.length,
    `${download.status} ${bytes.length} bytes`
  )
  const tampered = await fetch(url.slice(0, -2) + (url.endsWith('aa') ? 'bb' : 'aa'))
  check('Enlace alterado no muestra nada', tampered.status === 404, String(tampered.status))

  for (const path of ['/app/config.php', '/../app/config.php', '/storage/publicador.sqlite', '/database/schema.sql']) {
    const res = await fetch(new URL(path, baseUrl))
    const body = await res.text()
    check(`No expone ${path}`, !body.includes('secret') && !body.includes('CREATE TABLE') && !body.startsWith('SQLite'), String(res.status))
  }

  const removed = await signed('DELETE', `/api/v1/photos/${id}`)
  check('Borrado de la foto de prueba', removed.status === 204, String(removed.status))
  const gone = await fetch(url)
  check('Tras borrarla, el enlace ya no funciona', gone.status === 404, String(gone.status))
} catch (error) {
  console.log(`✘ Interrumpido: ${error.message}`)
  results.push(false)
}

const passed = results.filter(Boolean).length
console.log(`\n${passed} de ${results.length} comprobaciones correctas en ${baseUrl}`)
process.exit(passed === results.length ? 0 : 1)

