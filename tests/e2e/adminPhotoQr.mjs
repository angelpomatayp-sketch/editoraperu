// Recuperación táctil real: captura sin red -> reintento administrativo -> QR -> descarga PHP.
import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { launch, openDb, patchSettings, registerParticipant, ROOT, startPublicador, startSession, tempDir } from './lib.mjs'

const dataDir = tempDir('totem-admin-qr-')
const server = await startPublicador()
let app
const check = (value, message) => { if (!value) throw new Error(message) }
try {
  app = await launch({ dataDir })
  await app.page.waitFor(`document.querySelector('main.attract')`, 20_000)
  await app.close()
  patchSettings(dataDir, { background: { method: 'none' }, capture: { countdownSeconds: 1 } })
  server.configure(dataDir) // Servidor todavía detenido: se prueba una pérdida real de conexión.
  app = await launch({ dataDir })
  const { page } = app
  await startSession(page)
  await registerParticipant(page)
  await page.waitText('¡Su fotografía está lista!', 30_000)
  await page.click('.touch-button', 'Continuar')
  await page.waitText('Su fotografía quedó guardada', 30_000)
  check(!(await page.evaluate(`!!document.querySelector('.download__qr')`)), 'Se mostró un QR sin publicación')
  await page.click('.touch-button', 'Finalizar')
  await page.waitFor(`document.querySelector('.reserved-corner')`)
  await page.click('.home-control--admin')
  await page.waitText('Configuración inicial')
  for (const [i, value] of ['admin', 'Administración', 'editora2026', 'editora2026'].entries()) await page.fill('.aform input', i, value)
  await page.click('button', 'Crear y entrar')
  await page.waitText('Alertas')
  await page.click('.tab', 'Participaciones')
  await page.waitFor(`document.querySelector('.atable tbody tr')`)
  await page.click('.atable tbody tr')
  await page.waitText('Reintentar publicación')
  await server.start()
  await page.click('button', 'Reintentar publicación')
  await page.waitFor(`document.querySelector('.admin-photo-qr img')?.naturalWidth > 0`, 30_000, 'QR generado después del reintento')
  const evidenceDir = join(ROOT, 'docs/pruebas/evidencias/admin-qr')
  mkdirSync(evidenceDir, { recursive: true })
  await page.screenshot(join(evidenceDir, 'qr-automatico.png'))
  console.log(await page.evaluate(`(() => { const img = document.querySelector('.admin-photo-qr img').getBoundingClientRect(), area = document.querySelector('.admin__content').getBoundingClientRect(); return { qrTop: img.top, qrBottom: img.bottom, areaTop: area.top, areaBottom: area.bottom }; })()`))
  await page.waitFor(`(() => { const box = document.querySelector('.admin-photo-qr img')?.getBoundingClientRect(), area = document.querySelector('.admin__content')?.getBoundingClientRect(); return box && area && box.top >= area.top && box.bottom <= area.bottom; })()`, 5000, 'QR completo visible sin desplazamiento manual')
  const db = openDb(dataDir)
  const photo = db.prepare("SELECT public_url, expires_at FROM photos WHERE kind = 'final' AND status = 'published'").get()
  const before = db.prepare('SELECT attempts FROM publication_queue').get().attempts
  check(photo && (await fetch(photo.public_url)).ok, 'La página del QR no está disponible')
  const response = await fetch(`${photo.public_url}/download`)
  check(response.ok && response.headers.get('content-type').includes('image/jpeg'), 'La foto no se descarga')
  await page.screenshot(join(evidenceDir, 'qr-recuperado.png'))
  await page.click('button', 'Ocultar QR')
  check(!(await page.evaluate(`!!document.querySelector('.admin-photo-qr')`)), 'No se ocultó el QR')
  await page.click('button', 'Mostrar QR')
  await page.waitFor(`document.querySelector('.admin-photo-qr img')?.naturalWidth > 0`)
  check(db.prepare('SELECT attempts FROM publication_queue').get().attempts === before, 'Mostrar QR volvió a subir la foto')
  db.close()
  check(page.logs.length === 0, `Errores en la interfaz: ${page.logs.join(' | ')}`)
  console.log('APROBADO: foto offline, reintento táctil, QR en el panel, descarga real y mostrar nuevamente sin duplicar.')
} finally {
  if (app) await app.close()
  server.cleanup()
  rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 })
}
