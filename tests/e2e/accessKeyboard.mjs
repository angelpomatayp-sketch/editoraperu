// Uso: npm run build && node --no-warnings tests/e2e/accessKeyboard.mjs
import assert from 'node:assert/strict'
import { mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { launch, ROOT, sleep, tempDir } from './lib.mjs'

const dataDir = tempDir('totem-access-keyboard-')
const evidence = join(ROOT, 'docs/pruebas/evidencias/access-keyboard')
mkdirSync(evidence, { recursive: true })
let app
try {
  app = await launch({ dataDir })
  const { page } = app
  await page.send('Emulation.setTouchEmulationEnabled', { enabled: true })
  const tap = async (selector, text = null) => {
    const point = await page.evaluate(`(() => {
      const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find(el => !el.disabled && (${JSON.stringify(text)} === null || el.textContent.trim() === ${JSON.stringify(text)}));
      if (!el) return null;
      el.scrollIntoView({ block: 'nearest' });
      const r = el.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    })()`)
    assert.ok(point, `Control no encontrado: ${selector} ${text ?? ''}`)
    await page.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] })
    await page.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await sleep(35)
  }
  const keyExists = (text) => page.evaluate(`[...document.querySelectorAll('.key')].some(el => el.textContent.trim() === ${JSON.stringify(text)})`)
  const type = async (text) => {
    for (const ch of text) {
      if (/\p{L}/u.test(ch)) {
        const uppercase = ch === ch.toLocaleUpperCase('es-PE')
        const shifted = await page.evaluate(`document.querySelector('.key[aria-pressed]')?.getAttribute('aria-pressed') === 'true'`)
        if (uppercase !== shifted) await tap('.key', 'Mayús')
      }
      const label = ch === ' ' ? 'espacio' : ch
      if (!(await keyExists(label))) await tap('.key[aria-label^="Mostrar"]')
      await tap('.key', label)
    }
  }
  const focus = (index) => tap(`.admin--access .afield:nth-of-type(${index + 1}) input`)
  const value = (index) => page.evaluate(`document.querySelectorAll('.admin--access input')[${index}].value`)
  const select = (index, start, end) => page.evaluate(`document.querySelectorAll('.admin--access input')[${index}].setSelectionRange(${start}, ${end})`)
  const assertFits = async () => {
    assert.ok(await page.evaluate(`(() => {
      const form = document.querySelector('.admin--access form').getBoundingClientRect();
      const keys = [...document.querySelectorAll('.key')];
      return form.top >= 0 && form.bottom <= innerHeight && keys.every(key => {
        const r = key.getBoundingClientRect(); return r.left >= form.left && r.right <= form.right && r.height >= innerHeight * .047;
      });
    })()`), 'El teclado o los botones quedan fuera de la pantalla')
  }

  await page.waitFor(`document.querySelector('.home-control--admin')`, 20_000)
  await tap('.home-control--admin')
  await page.waitText('Configuración inicial')
  await assertFits()
  await type('admn')
  await select(0, 3, 3)
  await type('i')
  assert.equal(await value(0), 'admin', 'La tecla debe insertarse en la posición del cursor')
  await select(0, 4, 5)
  await type('n')
  assert.equal(await page.evaluate(`document.querySelector('.admin--access input').selectionStart`), 5, 'Reemplazar texto idéntico debe avanzar el cursor')
  await type('_01')
  await focus(1)
  await type('Administración')
  await focus(2)
  const password = 'Peru2026!@_a'
  await type(password)
  assert.equal(await value(2), password, 'El teclado debe respetar mayúsculas, números y símbolos')
  assert.equal(await page.evaluate(`document.querySelectorAll('.admin--access input')[2].type`), 'password')
  await focus(3)
  await type(password)
  await page.screenshot(join(evidence, 'configuracion-inicial.png'))
  await tap('button', 'Crear y entrar')
  await page.waitText('Alertas')
  await tap('button', 'Cerrar sesión')
  await page.waitFor(`document.querySelector('.home-control--admin')`)

  await tap('.home-control--admin')
  await page.waitText('Acceso administrativo')
  await assertFits()
  // Una pulsación de tecla no envía el formulario ni se salta la autenticación.
  await type('admin_01')
  await focus(1)
  await type('incorrecta2026')
  await tap('button', 'Ingresar')
  await page.waitText('Usuario o contraseña incorrectos')
  await page.waitFor(`document.activeElement === document.querySelectorAll('.admin--access input')[1]`)
  assert.equal(await value(1), '', 'Tras un error la contraseña debe limpiarse')
  await type('ab')
  await select(1, 1, 1)
  await tap('.key[aria-label="Borrar"]')
  assert.equal(await value(1), 'b', 'Borrar debe eliminar antes del cursor, no al final')
  await select(1, 0, 1)
  await type(password)
  assert.equal(await value(1), password)
  await page.screenshot(join(evidence, 'acceso-administrativo.png'))
  await tap('button', 'Ingresar')
  await page.waitText('Alertas')
  assert.ok(!(await page.evaluate(`!!document.querySelector('.keyboard')`)), 'El teclado debe desaparecer al ingresar')

  // El teclado físico sigue disponible; volver al inicio descarta las credenciales.
  await tap('button', 'Cerrar sesión')
  await page.waitFor(`document.querySelector('.home-control--admin')`)
  await tap('.home-control--admin')
  await page.waitText('Acceso administrativo')
  assert.equal(await value(0), '')
  assert.equal(await value(1), '')
  await page.send('Input.insertText', { text: 'admin_01' })
  await focus(1)
  await page.send('Input.insertText', { text: password })
  await tap('button', 'Ingresar')
  await page.waitText('Alertas')
  assert.deepEqual(page.logs, [], 'Errores en la interfaz')
  console.log('APROBADO: creación y acceso con teclado táctil, símbolos y mayúsculas, cursor y selección, error de contraseña, teclado físico y disposición sin desbordamientos.')
} finally {
  if (app) await app.close()
  // El único borrado recursivo es la carpeta temporal creada por esta prueba.
  if (resolve(dirname(dataDir)) !== resolve(tmpdir()) || !basename(dataDir).startsWith('totem-access-keyboard-')) throw new Error('Carpeta temporal inesperada')
  rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 })
}
