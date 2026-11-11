// Herramientas de las pruebas de punta a punta: lanzan la aplicación compilada, la controlan por
// el protocolo de depuración de Chromium (CDP) y guardan evidencias.
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

export const ROOT = resolve(import.meta.dirname, '../..')
const ELECTRON = join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe')
export const PHP = process.env.PHP_BIN ?? (existsSync('C:\\xampp\\php\\php.exe') ? 'C:\\xampp\\php\\php.exe' : 'php')

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export function freePort() {
  return new Promise((done) => {
    const srv = createServer().listen(0, '127.0.0.1', () => {
      const { port } = srv.address()
      srv.close(() => done(port))
    })
  })
}

export function tempDir(prefix) {
  return mkdtempSync(join(tmpdir(), prefix))
}

/** Base de datos del tótem de una carpeta de datos. */
export function openDb(dataDir) {
  return new DatabaseSync(join(dataDir, 'db', 'totem.sqlite'))
}

/** Modifica la configuración guardada (la aplicación debe estar cerrada). */
export function patchSettings(dataDir, patch) {
  const db = openDb(dataDir)
  const row = db.prepare("SELECT value_json FROM settings WHERE key = 'app'").get()
  const current = JSON.parse(row.value_json)
  const merged = { ...current }
  for (const [k, v] of Object.entries(patch)) merged[k] = typeof v === 'object' && v && !Array.isArray(v) ? { ...current[k], ...v } : v
  db.prepare("UPDATE settings SET value_json = ? WHERE key = 'app'").run(JSON.stringify(merged))
  db.close()
}

/** Conexión CDP con la página de la aplicación. */
export class Page {
  constructor(ws) {
    this.ws = ws
    this.id = 0
    this.pending = new Map()
    this.logs = []
    ws.addEventListener('message', (e) => {
      const m = JSON.parse(e.data)
      if (m.id && this.pending.has(m.id)) {
        this.pending.get(m.id)(m)
        this.pending.delete(m.id)
      } else if (m.method === 'Runtime.exceptionThrown') {
        this.logs.push(`excepción: ${m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text}`)
      } else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
        this.logs.push(`consola: ${m.params.args.map((a) => a.value ?? a.description).join(' ').slice(0, 300)}`)
      }
    })
  }

  send(method, params = {}) {
    // Si la ventana se cerró, se falla de inmediato en lugar de esperar para siempre.
    if (this.ws.readyState !== WebSocket.OPEN) return Promise.reject(new Error(`la ventana se cerró (${method})`))
    return new Promise((resolve, reject) => {
      const n = ++this.id
      const timer = setTimeout(() => {
        this.pending.delete(n)
        reject(new Error(`sin respuesta de la ventana (${method})`))
      }, 30_000)
      this.pending.set(n, (m) => {
        clearTimeout(timer)
        resolve(m)
      })
      this.ws.send(JSON.stringify({ id: n, method, params }))
    })
  }

  async evaluate(expression) {
    const r = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? 'error en la página')
    return r.result?.result?.value
  }

  /** Espera hasta que la expresión sea verdadera. */
  async waitFor(expression, timeoutMs = 10_000, label = expression) {
    const end = Date.now() + timeoutMs
    while (Date.now() < end) {
      if (await this.evaluate(`Boolean(${expression})`).catch(() => false)) return
      await sleep(100)
    }
    throw new Error(`tiempo agotado esperando: ${label}`)
  }

  waitText(text, timeoutMs = 10_000) {
    return this.waitFor(`document.body.innerText.includes(${JSON.stringify(text)})`, timeoutMs, `texto "${text}"`)
  }

  hasText(text) {
    return this.evaluate(`document.body.innerText.includes(${JSON.stringify(text)})`)
  }

  /** Clic real del ratón en el centro del elemento que contiene el texto. */
  async click(selector, text = '') {
    const pos = await this.evaluate(`(() => {
      const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find(e => e.textContent.includes(${JSON.stringify(text)}) && !e.disabled);
      if (!el) return null;
      el.scrollIntoView({ block: 'center' });
      const r = el.getBoundingClientRect();
      return [r.x + r.width / 2, r.y + r.height / 2];
    })()`)
    if (!pos) throw new Error(`no se encontró ${selector} "${text}"`)
    await this.clickAt(pos[0], pos[1])
  }

  async clickAt(x, y) {
    for (const type of ['mousePressed', 'mouseReleased']) await this.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 })
    await sleep(150)
  }

  /** Escribe con el teclado en pantalla del registro. */
  async typeVirtual(text) {
    for (const ch of text) {
      const label = ch === ' ' ? 'espacio' : ch.toLowerCase()
      const ok = await this.evaluate(`(() => {
        const el = [...document.querySelectorAll('.key')].find(k => k.textContent.toLowerCase() === ${JSON.stringify(label)});
        if (!el) return false;
        el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
        return true;
      })()`)
      if (!ok) throw new Error(`tecla "${ch}" no disponible`)
      await sleep(30)
    }
  }

  /** Escribe en un campo controlado por React (formularios del panel). */
  async fill(selector, index, value) {
    await this.evaluate(`(() => {
      const el = document.querySelectorAll(${JSON.stringify(selector)})[${index}];
      const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set;
      setter.call(el, ${JSON.stringify(value)});
      el.dispatchEvent(new Event('input', { bubbles: true }));
    })()`)
  }

  async screenshot(file) {
    const r = await this.send('Page.captureScreenshot', { format: 'png' })
    writeFileSync(file, Buffer.from(r.result.data, 'base64'))
  }

  async metrics() {
    // `Performance.getMetrics` también cuenta nodos desmontados pendientes de GC. Recolectar antes
    // permite distinguir una fuga real de la heurística variable de Chromium entre ejecuciones.
    await this.send('HeapProfiler.collectGarbage')
    const r = await this.send('Performance.getMetrics')
    return Object.fromEntries(r.result.metrics.map((m) => [m.name, m.value]))
  }
}

/**
 * Lanza la aplicación compilada con una carpeta de datos propia y cámara simulada.
 * Devuelve la página, el tiempo hasta la pantalla de atracción y la función para cerrarla.
 */
export async function launch({ dataDir, camera = 'fake', extraArgs = [], env = {} } = {}) {
  const port = await freePort()
  // Aísla también la caché/lock de Chromium: permite ejecutar E2E mientras `npm run dev` está abierto.
  const args = ['.', `--remote-debugging-port=${port}`, `--user-data-dir=${join(dataDir, '.electron')}`, ...extraArgs]
  if (camera === 'fake') args.push('--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream')
  if (camera === 'none') args.push('--use-fake-device-for-media-stream=device-count=0', '--use-fake-ui-for-media-stream')
  const started = Date.now()
  // Las pruebas recorren las campañas de demostración.
  const childEnv = { ...process.env, TOTEM_DATA_DIR: dataDir, TOTEM_DEMO: '1', ...env }
  delete childEnv.ELECTRON_RUN_AS_NODE
  const proc = spawn(ELECTRON, args, { cwd: ROOT, env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] })
  const output = []
  proc.stdout.on('data', (d) => output.push(String(d)))
  proc.stderr.on('data', (d) => output.push(String(d)))

  let target
  for (let i = 0; i < 100 && !target; i++) {
    try {
      target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === 'page')
    } catch {
      // Aún no inicia.
    }
    if (!target) await sleep(150)
  }
  if (!target) {
    proc.kill()
    throw new Error(`la aplicación no inició: ${output.join('').slice(-500)}`)
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((r) => ws.addEventListener('open', r))
  const page = new Page(ws)
  await page.send('Runtime.enable')
  await page.send('Performance.enable')

  const close = async ({ kill = false } = {}) => {
    try {
      ws.close()
    } catch {
      // Ya cerrada.
    }
    if (kill) {
      spawnSync('taskkill', ['/PID', String(proc.pid), '/T', '/F'])
    } else {
      proc.kill()
    }
    await new Promise((r) => (proc.exitCode !== null ? r() : proc.once('exit', r)))
    await sleep(300)
  }
  return { page, proc, output, started, close }
}

/** Servicio de publicación PHP con configuración temporal. */
export async function startPublicador({ ttlHours = 72 } = {}) {
  const dir = tempDir('e2e-publicador-')
  const port = await freePort()
  const baseUrl = `http://127.0.0.1:${port}`
  const secret = 'clave-de-prueba-e2e-de-al-menos-32-caracteres'
  const q = (v) => `'${v.replace(/\\/g, '\\\\')}'`
  writeFileSync(
    join(dir, 'config.php'),
    `<?php return ['base_url' => ${q(baseUrl)}, 'secret' => ${q(secret)}, 'db_dsn' => ${q(`sqlite:${join(dir, 'db.sqlite')}`)},
      'db_user' => null, 'db_password' => null, 'storage_dir' => ${q(join(dir, 'photos'))}, 'ttl_hours' => ${ttlHours},
      'max_bytes' => 15000000, 'rate_limit_per_minute' => 1000, 'max_clock_skew' => 300, 'timezone' => 'America/Lima'];`
  )
  let proc = null
  const start = async () => {
    proc = spawn(PHP, ['-S', `127.0.0.1:${port}`, '-t', join(ROOT, 'publicador/public'), join(ROOT, 'publicador/public/index.php')], {
      env: { ...process.env, PUBLICADOR_CONFIG: join(dir, 'config.php') },
      stdio: 'ignore'
    })
    for (let i = 0; i < 50; i++) {
      try {
        if ((await fetch(`${baseUrl}/api/v1/health`)).ok) return
      } catch {
        // Aún no inicia.
      }
      await sleep(100)
    }
    throw new Error('el servicio PHP no inició')
  }
  const stop = () => {
    proc?.kill()
    proc = null
  }
  return {
    baseUrl,
    secret,
    dir,
    start,
    stop,
    /** Indica al tótem de una carpeta de datos que use este servicio. */
    configure(dataDir) {
      mkdirSync(join(dataDir, 'config'), { recursive: true })
      writeFileSync(join(dataDir, 'config', 'publication.dev.json'), JSON.stringify({ baseUrl, secret }))
    },
    cleanup() {
      stop()
      rmSync(dir, { recursive: true, force: true })
    }
  }
}

// ----- Recorrido público -----

export async function startSession(page) {
  // Protector de pantalla (si está activo): un toque lleva a «TOQUE PARA COMENZAR».
  await page.waitFor(`document.querySelector('main.attract .institutional, main.attract .touch-button')`, 15_000, 'pantalla de atracción')
  if (await page.evaluate(`!!document.querySelector('main.attract .institutional')`)) await page.click('main.attract .institutional')
  await page.waitFor(`document.querySelector('main.attract .touch-button')`, 5_000, 'pantalla «TOQUE PARA COMENZAR»')
  await page.click('main.attract .start-button', 'TOQUE PARA COMENZAR')
  try {
    await page.waitText('Elija una experiencia')
  } catch (error) {
    await page.screenshot(join(ROOT, 'docs', 'pruebas', 'fallo-inicio-sesion.png'))
    const state = await page.evaluate(`document.body.innerText.slice(0, 300)`)
    throw new Error(`${error.message}; pantalla: ${JSON.stringify(state)}`)
  }
}

/** Enfoca un campo del registro y espera el teclado que le corresponde (numérico para el DNI). */
export async function focusField(page, index) {
  await page.evaluate(`document.querySelectorAll('.field input')[${index}].focus()`)
  const numeric = index === 2
  await page.waitFor(`${numeric ? '' : '!'}document.querySelector('.keyboard--numeric')`, 3000, 'teclado del campo')
}

/** Recorre selección, registro y consentimientos hasta la cámara. */
export async function registerParticipant(page, { campaign = 'Lectura en familia', scenario = 'Biblioteca', characters = ['Lectora'], name = 'maría josé', last = 'quispe mamani', dni = '12345678' } = {}) {
  await page.click('.campaign-card', campaign)
  await page.waitText('Elija un escenario')
  // Un toque en el escenario lo elige y avanza.
  await page.click('.option-card', scenario)
  if (characters.length) {
    await page.waitFor(`document.querySelector('h1')?.textContent.includes('personaje')`, 5000, 'paso de personajes')
    for (const c of characters) await page.click('.option-card', c)
    await page.click('.step__footer .touch-button', 'Continuar')
  }
  if (await page.hasText('Elija un marco')) {
    await page.click('.option-card', '')
    await page.click('.step__footer .touch-button', 'Continuar')
  }
  await page.waitText('Su selección')
  await page.click('.step__footer .touch-button', 'Continuar')
  await page.waitText('Sus datos')
  await focusField(page, 0)
  await page.typeVirtual(name)
  await focusField(page, 1)
  await page.typeVirtual(last)
  await focusField(page, 2)
  await page.typeVirtual(dni)
  await page.click('.step__footer .touch-button', 'Continuar')
  await page.waitText('Términos y condiciones')
  await page.evaluate(`[...document.querySelectorAll('.terms__check input')].forEach(i => { if (!i.checked) i.click() })`)
  await sleep(200)
  await page.click('.step__footer .touch-button', 'Continuar')
  await page.waitText('Mire a la cámara', 10_000)
}

/** Toma la foto y espera el resultado; devuelve los milisegundos desde «Tomar foto» hasta el resultado. */
export async function takePhoto(page) {
  await page.waitFor(`!document.querySelector('.step__footer .touch-button')?.disabled`, 15_000, 'cámara lista')
  const t0 = Date.now()
  await page.click('.step__footer .touch-button', 'Tomar foto')
  await page.waitText('¡Su fotografía está lista!', 30_000)
  return Date.now() - t0
}
