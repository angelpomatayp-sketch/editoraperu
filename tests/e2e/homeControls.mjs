import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { launch, openDb, ROOT, tempDir } from './lib.mjs'

const dataDir = tempDir('totem-home-controls-')
const evidence = join(ROOT, 'docs/pruebas/evidencias/home-controls')
mkdirSync(evidence, { recursive: true })
let app
const check = (condition, message) => { if (!condition) throw new Error(message) }
try {
  app = await launch({ dataDir })
  const { page } = app
  await page.waitFor(`document.querySelector('.home-control--admin')`, 20_000)
  check(await page.evaluate(`document.querySelectorAll('.home-control').length === 2`), 'Falta un control inicial')
  check(await page.evaluate(`[...document.querySelectorAll('.home-control')].every(button => { const r = button.getBoundingClientRect(); return r.width >= 48 && r.height >= 48 && !!button.getAttribute('aria-label'); })`), 'Área táctil o nombre accesible insuficientes')
  await page.screenshot(join(evidence, 'inicio.png'))
  // Incluso sin cuenta creada, la X solo presenta confirmación, sin autenticación.
  await page.evaluate(`window.totem.confirmQuit(false)`)
  check(app.proc.exitCode === null, 'Un argumento no confirmado cerró la aplicación')
  await page.click('.home-control--close')
  await page.waitText('¿Desea cerrar la aplicación?')
  check(!(await page.evaluate(`!!document.querySelector('.aform input')`)), 'La X pidió credenciales')
  check(await page.evaluate(`(() => { const el = document.querySelector('.home-control--admin'), r = el.getBoundingClientRect(); return !el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)); })()`), 'Los accesos iniciales quedan por encima de la confirmación')
  check(app.proc.exitCode === null, 'La X cerró antes de confirmar')
  await page.click('.dialog button', 'Cancelar')
  await page.waitFor(`!document.querySelector('.home-close-dialog')`)
  check(app.proc.exitCode === null, 'Cancelar cerró la aplicación')
  // El engranaje conserva la protección administrativa y abre con un único toque.
  await page.click('.home-control--admin')
  await page.waitText('Configuración inicial')
  for (const [i, text] of ['admin', 'Administración', 'editora2026', 'editora2026'].entries()) await page.fill('.aform input', i, text)
  await page.click('button', 'Crear y entrar')
  await page.waitText('Alertas')
  await page.click('button', 'Cerrar sesión')
  await page.waitFor(`document.querySelector('.home-control--admin')`)
  await page.click('.home-control--admin')
  await page.waitText('Acceso administrativo')
  await page.fill('.aform input', 0, 'admin')
  await page.fill('.aform input', 1, 'incorrecta2026')
  await page.click('button', 'Ingresar')
  await page.waitText('Usuario o contraseña incorrectos')
  await page.click('button', 'Volver al tótem')
  await page.waitFor(`document.querySelector('.home-control--close')`)
  // Cierre desde el inicio, sin ninguna sesión administrativa activa.
  await page.click('.home-control--close')
  await page.waitText('¿Desea cerrar la aplicación?')
  await page.screenshot(join(evidence, 'confirmar-cierre.png'))
  const exited = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('La aplicación no cerró después de confirmar')), 120_000)
    app.proc.once('exit', code => { clearTimeout(timeout); resolve(code) })
  })
  void page.click('.dialog button', 'Cerrar aplicación').catch(() => undefined)
  const hiddenDeadline = Date.now() + 1500
  let hidden = false
  while (Date.now() < hiddenDeadline) {
    if (app.proc.exitCode !== null || await page.evaluate('document.hidden').catch(() => app.proc.exitCode !== null)) {
      hidden = true
      break
    }
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  check(hidden, 'La ventana no se ocultó inmediatamente después de confirmar')
  check(await exited === 0, 'El cierre no fue limpio')
  const db = openDb(dataDir)
  check(db.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE action = 'controlled_quit' AND detail_json LIKE '%home_confirmation%'").get().n === 1, 'No se registró el cierre público confirmado')
  db.close()
  console.log('APROBADO: engranaje autenticado, X sin credenciales, cancelación, ocultamiento inmediato y cierre limpio confirmado.')
} finally {
  if (app) await app.close()
  rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 })
}
