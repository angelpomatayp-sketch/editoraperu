// Pruebas de punta a punta de la aplicación real (fase 8). Uso: npm run test:e2e
// Cada escenario usa su propia carpeta de datos; las capturas quedan en docs/pruebas/evidencias/.
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  focusField,
  launch,
  openDb,
  patchSettings,
  registerParticipant,
  ROOT,
  sleep,
  startPublicador,
  startSession,
  takePhoto,
  tempDir
} from './lib.mjs'

const STAMP = new Date().toISOString().slice(0, 10)
const EVIDENCE = join(ROOT, 'docs', 'pruebas', 'evidencias', STAMP)
mkdirSync(EVIDENCE, { recursive: true })

const results = []
const timings = {}
const only = process.argv[2]

function check(condition, message) {
  if (!condition) throw new Error(message)
}

/** Prepara una carpeta de datos con la base creada (primer arranque) y devuelve su ruta. */
async function preparedData(patch) {
  const dataDir = tempDir('e2e-data-')
  const app = await launch({ dataDir })
  await app.page.waitFor(`document.querySelector('main.attract')`, 20_000)
  await app.close()
  if (patch) patchSettings(dataDir, patch)
  return dataDir
}

async function scenario(id, title, refs, fn) {
  if (only && !id.startsWith(only)) return
  const started = Date.now()
  const shots = []
  const shot = async (page, name) => {
    const file = `${id}-${name}.png`
    await page.screenshot(join(EVIDENCE, file))
    shots.push(file)
  }
  try {
    const notes = (await fn(shot)) ?? []
    results.push({ id, title, refs, ok: true, ms: Date.now() - started, notes, shots })
    console.log(`✔ ${id} ${title}`)
  } catch (error) {
    results.push({ id, title, refs, ok: false, ms: Date.now() - started, notes: [String(error?.message ?? error)], shots })
    console.log(`✘ ${id} ${title}\n    ${error?.message ?? error}`)
  }
}

// ---------------------------------------------------------------------------

await scenario('E2E-01', 'Inicio, pantalla de atracción y estado inicial limpio', ['RF-KIO-001', 'RF-ATR-001', 'CA-001'], async (shot) => {
  const dataDir = tempDir('e2e-data-')
  const app = await launch({ dataDir })
  try {
    await app.page.waitFor(`document.querySelector('main.attract .institutional, main.attract img, main.attract .attract__fallback')`, 20_000)
    timings.startupMs = Date.now() - app.started
    await shot(app.page, 'atraccion')
    check(!(await app.page.hasText('Sus datos')), 'apareció información de una sesión')
    // Primero el protector de pantalla; un toque lleva a «TOQUE PARA COMENZAR», sin iniciar sesión.
    check(await app.page.evaluate(`!!document.querySelector('main.attract .institutional')`), 'no se mostró el protector de pantalla')
    await app.page.clickAt(270, 600)
    await app.page.waitFor(`document.querySelector('main.attract .touch-button')`, 5000, 'pantalla «TOQUE PARA COMENZAR»')
    check(!(await app.page.hasText('Elija')), 'el protector inició la participación directamente')
    const db = openDb(dataDir)
    check(db.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE action = 'start'").get().n === 1, 'no se registró el inicio')
    db.close()
    return [`Inicio hasta la pantalla de atracción: ${timings.startupMs} ms (primer arranque, crea la base).`]
  } finally {
    await app.close()
    rmSync(dataDir, { recursive: true, force: true })
  }
})

await scenario('E2E-02', 'Recorrido completo con publicación y descarga por QR', ['Sección 7', 'CA-005', 'CA-006', 'CA-007', 'RF-QR-001 a RF-QR-006'], async (shot) => {
  const publicador = await startPublicador()
  await publicador.start()
  const dataDir = await preparedData()
  publicador.configure(dataDir)
  const app = await launch({ dataDir })
  try {
    const { page } = app
    await startSession(page)
    const t0 = Date.now()
    await registerParticipant(page, { characters: ['Lectora', 'Bibliotecaria'] })
    timings.registrationFlowMs = Date.now() - t0
    await shot(page, 'camara')
    timings.captureToResultMs = await takePhoto(page)
    await shot(page, 'resultado')
    const t1 = Date.now()
    await page.click('.touch-button', 'Continuar')
    await page.waitFor(`document.querySelector('.download__qr')`, 30_000, 'QR')
    timings.publishToQrMs = Date.now() - t1
    await shot(page, 'qr')

    const db = openDb(dataDir)
    const photo = db.prepare("SELECT status, public_url, public_token FROM photos WHERE kind = 'final' AND status <> 'deleted'").get()
    db.close()
    check(photo.status === 'published', `foto en estado ${photo.status}`)
    check(!/12345678|Mar[ií]a|Quispe/i.test(photo.public_url), 'la URL contiene datos personales')

    const pageResponse = await fetch(photo.public_url)
    check(pageResponse.status === 200, `página del QR: HTTP ${pageResponse.status}`)
    const download = await fetch(`${photo.public_url}/download`)
    check(download.headers.get('content-disposition')?.includes('attachment'), 'la descarga no es un archivo adjunto')
    const altered = photo.public_url.slice(0, -1) + (photo.public_url.endsWith('A') ? 'B' : 'A')
    check((await fetch(altered)).status === 404, 'un token alterado no devolvió 404')

    await page.click('.touch-button', 'Finalizar')
    await page.waitFor(`document.querySelector('main.attract')`, 10_000)
    const db2 = openDb(dataDir)
    check(db2.prepare('SELECT status FROM participations').get().status === 'completed', 'la participación no quedó completada')
    db2.close()
    return [
      `Recorrido de selección, registro y consentimientos (automatizado): ${timings.registrationFlowMs} ms.`,
      `Desde «Tomar foto» hasta el resultado (cuenta regresiva de 3 s incluida): ${timings.captureToResultMs} ms.`,
      `Desde «Continuar» hasta el QR (publicación incluida): ${timings.publishToQrMs} ms.`,
      'Página de descarga 200, descarga como adjunto, token alterado 404, URL sin datos personales.'
    ]
  } finally {
    await app.close()
    publicador.cleanup()
    rmSync(dataDir, { recursive: true, force: true })
  }
})

await scenario('E2E-03', 'Validaciones del registro y rechazo de consentimientos', ['RF-REG-002', 'RF-REG-003', 'RF-CON-002', 'RF-CON-004', 'CA-004'], async (shot) => {
  const dataDir = await preparedData()
  const app = await launch({ dataDir })
  try {
    const { page } = app
    await startSession(page)
    await page.click('.campaign-card', 'Perú Bicentenario')
    await page.click('.option-card', 'Plaza de Armas')
    await page.waitText('Elija un marco')
    await page.click('.option-card', 'Marco rojo')
    await page.click('.step__footer .touch-button', 'Continuar')
    await page.click('.step__footer .touch-button', 'Continuar')
    await page.waitText('Sus datos')
    await page.click('.step__footer .touch-button', 'Continuar')
    await page.waitText('Ingrese sus nombres')
    check(await page.hasText('El DNI debe tener 8 dígitos'), 'no se validó el DNI vacío')
    await focusField(page, 0)
    await page.typeVirtual('ana')
    await focusField(page, 1)
    await page.typeVirtual('ruiz')
    await focusField(page, 2)
    await page.typeVirtual('1234')
    await page.click('.step__footer .touch-button', 'Continuar')
    await shot(page, 'errores')
    check(await page.hasText('El DNI debe tener 8 dígitos'), 'aceptó un DNI de 4 dígitos')
    await page.typeVirtual('5678')
    await page.click('.step__footer .touch-button', 'Continuar')
    await page.waitText('Términos y condiciones')
    check(await page.evaluate(`document.querySelector('.step__footer .touch-button:not(.touch-button--secondary)').disabled`), 'se puede continuar sin aceptar')
    check(await page.evaluate(`[...document.querySelectorAll('.terms__check input')].every(i => !i.checked)`), 'casillas marcadas de antemano')
    // El detalle de cada término se abre en una ventana con el texto completo (RF-CON-001).
    await page.click('.terms__detail', 'Ver detalle')
    await page.waitFor(`document.querySelector('.terms__dialog .terms__body')?.textContent.length > 20`, 3000, 'ventana de detalle')
    await shot(page, 'detalle')
    await page.click('.terms__dialog .touch-button', 'Cerrar')
    await page.waitFor(`!document.querySelector('.terms__dialog')`, 3000, 'cierre del detalle')
    await page.click('.touch-button--secondary', 'No acepto')
    await page.waitText('No es posible continuar')
    await shot(page, 'rechazo')
    await page.click('.dialog .touch-button', 'Cancelar participación')
    await page.waitFor(`document.querySelector('main.attract')`, 5000)
    const db = openDb(dataDir)
    check(db.prepare('SELECT COUNT(*) AS n FROM participations').get().n === 0, 'se guardaron datos sin aceptar los consentimientos')
    db.close()
    return ['Campos vacíos y DNI incompleto rechazados; casillas sin marcar; botón deshabilitado; al rechazar no se guarda ningún dato personal.']
  } finally {
    await app.close()
    rmSync(dataDir, { recursive: true, force: true })
  }
})

await scenario('E2E-04', 'Cancelación voluntaria con confirmación', ['RF-SES-003', 'RF-SES-004'], async (shot) => {
  const dataDir = await preparedData()
  const app = await launch({ dataDir })
  try {
    const { page } = app
    await startSession(page)
    await page.click('.campaign-card', 'Lectura en familia')
    await page.click('.option-card', 'Biblioteca')
    await page.click('.option-card', 'Lector')
    await page.click('.step__footer .touch-button', 'Continuar')
    await page.click('.step__footer .touch-button', 'Continuar')
    await page.waitText('Sus datos')
    await page.typeVirtual('pedro')
    await page.click('.pill-button', 'Cancelar')
    await page.waitText('¿Desea cancelar?')
    await shot(page, 'confirmacion')
    await page.click('.dialog .touch-button', 'Sí, cancelar')
    await page.waitFor(`document.querySelector('main.attract')`, 5000)
    check(!(await page.hasText('Pedro')), 'quedó visible el nombre ingresado')
    return ['Con datos ingresados se pide confirmación; al confirmar vuelve a la atracción sin datos visibles.']
  } finally {
    await app.close()
    rmSync(dataDir, { recursive: true, force: true })
  }
})

await scenario('E2E-05', 'Inactividad: advertencia y cancelación automática', ['RF-SES-002', 'CA-011'], async (shot) => {
  const dataDir = await preparedData({ session: { inactivityWarningSeconds: 10, inactivityCancelSeconds: 5 } })
  const app = await launch({ dataDir })
  try {
    const { page } = app
    await startSession(page)
    await page.waitText('¿Sigue ahí?', 15_000)
    await shot(page, 'advertencia')
    await page.waitFor(`document.querySelector('main.attract')`, 10_000, 'regreso a la atracción')
    const db = openDb(dataDir)
    const end = db.prepare("SELECT detail_json FROM audit_events WHERE category = 'session' AND action = 'end'").get()
    db.close()
    check(JSON.parse(end.detail_json).reason === 'timeout', 'la sesión no terminó por inactividad')
    return ['Advertencia a los 10 s con cuenta regresiva; cancelación y regreso a la atracción a los 15 s (tiempos de prueba).']
  } finally {
    await app.close()
    rmSync(dataDir, { recursive: true, force: true })
  }
})

await scenario('E2E-06', 'Sin Internet: sin QR inválido, foto pendiente y publicación al recuperar', ['RF-QR-008', 'RF-QR-009', 'RF-RED-002', 'CA-008'], async (shot) => {
  const publicador = await startPublicador()
  const dataDir = await preparedData()
  publicador.configure(dataDir)
  const app = await launch({ dataDir })
  try {
    const { page } = app
    await startSession(page)
    await registerParticipant(page)
    await takePhoto(page)
    await page.click('.touch-button', 'Continuar')
    await page.waitText('no es posible generar el código de descarga', 30_000)
    await shot(page, 'sin-qr')
    check(!(await page.evaluate(`Boolean(document.querySelector('.download__qr'))`)), 'se mostró un QR sin publicación')
    const db = openDb(dataDir)
    check(db.prepare("SELECT status FROM photos WHERE kind = 'final' AND status <> 'deleted'").get().status === 'pending', 'la foto no quedó pendiente')
    await publicador.start()
    const t0 = Date.now()
    let status = 'pending'
    while (Date.now() - t0 < 75_000 && status !== 'published') {
      await sleep(2000)
      status = db.prepare("SELECT status FROM photos WHERE kind = 'final' AND status <> 'deleted'").get().status
    }
    db.close()
    check(status === 'published', `tras recuperar la conexión la foto quedó en ${status}`)
    return [`Sin servicio: mensaje sin QR y foto pendiente. Con el servicio disponible se publicó sola en ${Math.round((Date.now() - t0) / 1000)} s.`]
  } finally {
    await app.close()
    publicador.cleanup()
    rmSync(dataDir, { recursive: true, force: true })
  }
})

await scenario('E2E-07', 'Cámara no disponible', ['RF-CAP-001', '12.1', 'CA-005'], async (shot) => {
  const dataDir = await preparedData()
  const app = await launch({ dataDir, camera: 'none' })
  try {
    const { page } = app
    await startSession(page)
    await registerParticipant(page).catch(() => undefined)
    await page.waitText('La cámara no está disponible', 15_000)
    await shot(page, 'sin-camara')
    const db = openDb(dataDir)
    check(db.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE action = 'camera.unavailable'").get().n >= 1, 'no se registró el problema de cámara')
    db.close()
    return ['Mensaje público sin detalles técnicos, opción de reintentar y evento en la bitácora.']
  } finally {
    await app.close()
    rmSync(dataDir, { recursive: true, force: true })
  }
})

await scenario('E2E-08', 'Cierre inesperado durante la participación y recuperación', ['RF-KIO-004', '12.6', 'CA-001', 'CA-012'], async (shot) => {
  const dataDir = await preparedData()
  let app = await launch({ dataDir })
  try {
    await startSession(app.page)
    await registerParticipant(app.page)
    await takePhoto(app.page)
    await app.close({ kill: true })
    app = await launch({ dataDir })
    await app.page.waitFor(`document.querySelector('main.attract')`, 20_000)
    await shot(app.page, 'tras-reinicio')
    check(!(await app.page.hasText('María')), 'reapareció información de la participación')
    const db = openDb(dataDir)
    const integrity = db.prepare('PRAGMA quick_check').get().quick_check
    const status = db.prepare('SELECT status FROM participations').get().status
    const interrupted = db.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE action = 'interrupted'").get().n
    db.close()
    check(integrity === 'ok', `integridad de la base: ${integrity}`)
    check(status === 'cancelled', `la participación interrumpida quedó en ${status}`)
    check(interrupted === 1, 'no se registró la interrupción')
    check(readdirSync(join(dataDir, 'tmp')).length === 0, 'quedaron temporales')
    return ['Tras matar el proceso con la foto compuesta: vuelve a la atracción, base íntegra, participación cerrada como cancelada y registrada, sin temporales.']
  } finally {
    await app.close()
    rmSync(dataDir, { recursive: true, force: true })
  }
})

await scenario('E2E-09', 'Espacio insuficiente en disco', ['RF-ALM-002', '12.4'], async (shot) => {
  const dataDir = await preparedData({ storage: { minFreeMegabytes: 99_000_000, warnFreeMegabytes: 99_000_000 } })
  const app = await launch({ dataDir })
  try {
    const { page } = app
    await page.waitFor(`document.querySelector('main.attract')`, 20_000)
    if (await page.evaluate(`!!document.querySelector('main.attract .institutional')`)) await page.click('main.attract .institutional')
    await page.waitFor(`document.querySelector('main.attract .touch-button')`, 5000)
    await page.click('main.attract .start-button', 'TOQUE PARA COMENZAR')
    await page.waitText('no es posible iniciar una nueva participación')
    await shot(page, 'sin-espacio')
    check(!(await page.hasText('Elija una experiencia')), 'se inició la participación sin espacio')
    return ['No se inicia la participación ni se piden datos; se muestra un mensaje para solicitar asistencia.']
  } finally {
    await app.close()
    rmSync(dataDir, { recursive: true, force: true })
  }
})

await scenario('E2E-10', 'Panel administrativo: acceso, error de contraseña, secciones y salida', ['RF-AUT-001', 'RF-AUT-003', 'CA-009'], async (shot) => {
  const dataDir = await preparedData()
  const app = await launch({ dataDir })
  try {
    const { page } = app
    await page.waitFor(`document.querySelector('.reserved-corner')`, 20_000)
    await page.click('.home-control--admin')
    await page.waitText('Configuración inicial')
    await page.fill('.aform input', 0, 'admin')
    await page.fill('.aform input', 1, 'Administración')
    await page.fill('.aform input', 2, 'editora2026')
    await page.fill('.aform input', 3, 'editora2026')
    await page.click('button', 'Crear y entrar')
    await page.waitText('Alertas')
    await shot(page, 'resumen')
    for (const tab of ['Campañas', 'Atracción', 'Participaciones', 'Reportes', 'Bitácora', 'Usuarios', 'Sistema']) {
      await page.click('.tab', tab)
      await sleep(400)
    }
    await page.click('button', 'Cerrar sesión')
    await page.waitFor(`document.querySelector('main.attract')`, 5000)
    await page.click('.home-control--admin')
    await page.waitText('Acceso administrativo')
    await page.fill('.aform input', 0, 'admin')
    await page.fill('.aform input', 1, 'clave-equivocada')
    await page.click('button', 'Ingresar')
    await page.waitText('Usuario o contraseña incorrectos')
    await shot(page, 'acceso-denegado')
    check(page.logs.length === 0, `errores en la interfaz: ${page.logs.join(' | ')}`)
    return ['Cuenta inicial, todas las secciones sin errores de interfaz, cierre de sesión y mensaje genérico ante contraseña incorrecta.']
  } finally {
    await app.close()
    rmSync(dataDir, { recursive: true, force: true })
  }
})

await scenario('E2E-11', 'Resistencia: participaciones consecutivas', ['RNF-004', 'RF-SES-004', 'CA-011', 'CA-012'], async (shot) => {
  const ROUNDS = Number(process.env.E2E_ROUNDS ?? 12)
  const dataDir = await preparedData()
  const app = await launch({ dataDir })
  try {
    const { page } = app
    const heap = []
    for (let i = 1; i <= ROUNDS; i++) {
      await startSession(page)
      // Limpieza entre participantes: el formulario empieza vacío en cada sesión (RF-SES-004).
      await registerParticipant(page, { name: `persona`, last: `numero`, dni: String(10000000 + i) })
      await takePhoto(page)
      await page.click('.touch-button', 'Continuar')
      await page.waitText('Finalizar', 30_000)
      await page.click('.touch-button', 'Finalizar')
      await page.waitFor(`document.querySelector('main.attract')`, 10_000)
      if (i === 1 || i % 4 === 0) heap.push({ round: i, ...(await page.metrics()) })
    }
    await shot(page, 'final')
    const db = openDb(dataDir)
    const completed = db.prepare("SELECT COUNT(*) AS n FROM participations WHERE status = 'completed'").get().n
    const finals = readdirSync(join(dataDir, 'photos', 'finals')).length
    const errors = db.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE level = 'error'").get().n
    db.close()
    check(completed === ROUNDS, `${completed} de ${ROUNDS} completadas`)
    check(finals === ROUNDS, `${finals} fotos finales para ${ROUNDS} participaciones`)
    check(readdirSync(join(dataDir, 'tmp')).length === 0, 'quedaron temporales')
    check(errors === 0, `${errors} errores en la bitácora`)
    const first = heap[0]
    const last = heap.at(-1)
    const growthMb = (last.JSHeapUsedSize - first.JSHeapUsedSize) / 1024 / 1024
    timings.endurance = { rounds: ROUNDS, heap: heap.map((h) => ({ round: h.round, heapMb: +(h.JSHeapUsedSize / 1024 / 1024).toFixed(1), nodes: h.Nodes, listeners: h.JSEventListeners })) }
    check(growthMb < 40, `la memoria de la interfaz creció ${growthMb.toFixed(1)} MB`)
    check(last.Nodes < first.Nodes * 2 + 500, `los nodos del DOM crecieron de ${first.Nodes} a ${last.Nodes}`)
    return [
      `${ROUNDS} participaciones completas seguidas, sin errores ni temporales.`,
      `Memoria de la interfaz: ${(first.JSHeapUsedSize / 1048576).toFixed(1)} MB → ${(last.JSHeapUsedSize / 1048576).toFixed(1)} MB; nodos ${first.Nodes} → ${last.Nodes}; escuchas ${first.JSEventListeners} → ${last.JSEventListeners}.`
    ]
  } finally {
    await app.close()
    rmSync(dataDir, { recursive: true, force: true })
  }
})

// ---------------------------------------------------------------------------

const passed = results.filter((r) => r.ok).length
const report = [
  `# Resultados de las pruebas de punta a punta (${STAMP})`,
  '',
  'Generado por `npm run test:e2e` sobre la aplicación compilada, con cámara simulada de Chromium y el servicio PHP local.',
  '',
  `**${passed} de ${results.length} escenarios aprobados.**`,
  '',
  '| Escenario | Resultado | Requisitos | Duración | Observaciones | Evidencias |',
  '|---|---|---|---|---|---|',
  ...results.map(
    (r) =>
      `| ${r.id} ${r.title} | ${r.ok ? 'Aprobado' : '**Falló**'} | ${r.refs.join(', ')} | ${(r.ms / 1000).toFixed(1)} s | ${r.notes.join(' ')} | ${r.shots
        .map((s) => `[${s.replace(/^E2E-\d+-/, '').replace('.png', '')}](evidencias/${STAMP}/${s})`)
        .join(', ')} |`
  ),
  '',
  '## Tiempos medidos',
  '',
  '```json',
  JSON.stringify(timings, null, 2),
  '```',
  ''
].join('\n')
if (!only) writeFileSync(join(ROOT, 'docs', 'pruebas', 'resultados-e2e.md'), report)
console.log(`\n${passed} de ${results.length} escenarios aprobados`)
console.log(`Tiempos: ${JSON.stringify({ ...timings, endurance: undefined })}`)
process.exitCode = passed === results.length ? 0 : 1
if (!existsSync(EVIDENCE)) mkdirSync(EVIDENCE, { recursive: true })
