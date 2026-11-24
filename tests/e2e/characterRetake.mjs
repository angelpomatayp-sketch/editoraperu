// Regresión real en Chromium: video de 8 s, primera toma y repetición, sin inferencia ni red.
import { mkdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import ffmpeg from 'ffmpeg-static'
import { launch, openDb, patchSettings, registerParticipant, startSession, tempDir, ROOT } from './lib.mjs'

const dataDir = tempDir('totem-video-retake-')
const cameraOnly = process.env.TOTEM_TEST_CAMERA_ONLY === '1'
let app
const check = (condition, message) => { if (!condition) throw new Error(message) }
try {
  app = await launch({ dataDir })
  await app.page.waitFor(`document.querySelector('main.attract')`, 20_000)
  await app.close()
  app = null
  patchSettings(dataDir, { background: { method: 'none' }, capture: { countdownSeconds: 2, maxRetakes: 2 } })
  const mediaDir = join(dataDir, 'content', 'test-video')
  mkdirSync(mediaDir, { recursive: true })
  const video = join(mediaDir, 'entrada.mp4')
  const realVideo = process.env.TOTEM_TEST_CHARACTER_VIDEO
  const input = realVideo ? ['-i', realVideo, '-vf', 'setpts=2.4*(PTS-STARTPTS)', '-t', '8']
    : ['-f', 'lavfi', '-i', 'testsrc2=size=160x288:rate=10:duration=8']
  const generated = spawnSync(ffmpeg, ['-hide_banner', '-nostdin', ...input, '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-an', '-y', video], { windowsHide: true })
  check(generated.status === 0, 'No se pudo generar el video de prueba')
  const db = openDb(dataDir)
  db.prepare(`UPDATE resources SET animation_path = ?, animation_format = 'mp4', animation_size_bytes = ?, animation_duration_ms = 8000, animation_background = ? WHERE name = 'Lectora'`).run('test-video/entrada.mp4', statSync(video).size, realVideo ? 'chroma' : 'alpha')
  const campaign = db.prepare("SELECT id, name FROM campaigns WHERE code = 'DEMO-LECTURA'").get()
  const character = db.prepare("SELECT id FROM resources WHERE name = 'Lectora'").get()
  if (cameraOnly) {
    const config = JSON.parse(db.prepare('SELECT config_json FROM campaigns WHERE id = ?').get(campaign.id).config_json)
    config.allowCameraBackground = true
    db.prepare('UPDATE campaigns SET config_json = ? WHERE id = ?').run(JSON.stringify(config), campaign.id)
    db.prepare('DELETE FROM scenario_characters WHERE campaign_id = ?').run(campaign.id)
    db.prepare("DELETE FROM campaign_resources WHERE campaign_id = ? AND resource_id IN (SELECT id FROM resources WHERE type = 'scenario')").run(campaign.id)
  }
  db.close()
  app = await launch({ dataDir })
  const { page } = app
  let expectedVideoBox
  if (process.env.TOTEM_TEST_VIDEO_TRANSFORM === '1' || cameraOnly) {
    await page.waitFor(`document.querySelector('.home-control--admin')`, 20_000)
    await page.click('.home-control--admin')
    await page.waitText('Configuración inicial')
    for (const [i, value] of ['admin', 'Administración', 'editora2026', 'editora2026'].entries()) await page.fill('.aform input', i, value)
    await page.click('button', 'Crear y entrar')
    await page.waitText('Alertas')
    await page.click('button', 'Campañas')
    await page.click('.aitem__open', campaign.name)
    if (!cameraOnly) {
      await page.click('.tab', 'Escenarios y personajes')
      await page.waitText('Reemplazar imagen…')
    }
    await page.click('.tab', 'Ubicación')
    await page.waitFor(`document.querySelector('.layout-video-preview')`)
    if (cameraOnly) check(await page.evaluate(`!!document.querySelector('.layout-camera-backdrop') && !document.querySelector('video')`), 'El editor sin escenarios no mostró el fondo neutro o encendió una cámara')
    await page.fill('.layout-video-adjustment input[type=number]', 0, '75')
    await page.fill('.layout-video-adjustment input[type=number]', 1, '-6')
    await page.fill('.layout-video-adjustment input[type=number]', 2, '-3')
    await page.click('button', 'Restablecer este video')
    check(await page.evaluate(`document.querySelector('.layout-video-adjustment input[type=number]').value === '100'`), 'Restablecer no recuperó el tamaño original')
    await page.fill('.layout-video-adjustment input[type=number]', 0, '75')
    await page.fill('.layout-video-adjustment input[type=number]', 1, '-6')
    await page.fill('.layout-video-adjustment input[type=number]', 2, '-3')
    expectedVideoBox = await page.evaluate(`(() => { const s = document.querySelector('.layout-video-preview').style; return [s.left, s.top, s.width, s.height].map(parseFloat); })()`)
    await page.click('button', 'Guardar cambios')
    await page.waitText('Ubicación guardada')
    const savedDb = openDb(dataDir)
    const saved = JSON.parse(savedDb.prepare('SELECT config_json FROM campaigns WHERE id = ?').get(campaign.id).config_json)
    savedDb.close()
    check(JSON.stringify(saved.characterVideoTransforms[character.id]) === JSON.stringify({ scale: 0.75, x: -0.06, y: -0.03 }), 'No se guardó el ajuste por personaje')
    await page.click('.tab', 'Datos')
    await page.click('.tab', 'Ubicación')
    await page.waitFor(`document.querySelector('.layout-video-adjustment input[type=number]')?.value === '75'`)
    await page.evaluate(`document.querySelector('.layout-stage').scrollIntoView({ block: 'center' })`)
    const evidence = join(ROOT, 'docs/pruebas/evidencias', cameraOnly ? 'video-placement-camera-only' : 'video-placement')
    mkdirSync(evidence, { recursive: true })
    await page.screenshot(join(evidence, 'ubicacion.png'))
    await page.evaluate(`document.querySelector('.layout-video-controls').scrollIntoView({ block: 'center' })`)
    await page.screenshot(join(evidence, 'controles.png'))
    await page.click('button', 'Cerrar sesión')
  }
  await startSession(page)
  await registerParticipant(page, {
    scenario: cameraOnly ? 'Fondo real' : 'Biblioteca',
    cameraTimeoutMs: 30_000,
    onBeforeCamera: () => page.evaluate(`(() => {
      window.__videoStarts = []; window.__videoEnds = 0; window.__earlyCountdown = false;
      window.__frozenFrames = 0; window.__missingPerson = false; window.__videoBoxes = [];
      const isCharacter = (v) => v instanceof HTMLVideoElement && v.matches('.composition__character-media, .composition__character-source');
      document.addEventListener('play', (event) => { if (isCharacter(event.target)) window.__videoStarts.push(event.target.currentTime); }, true);
      document.addEventListener('ended', (event) => { if (isCharacter(event.target)) window.__videoEnds++; }, true);
      setInterval(() => {
        if (document.querySelector('.capture .spinner')) {
          const canvas = document.querySelector('.composition__person canvas.chroma-video');
          if (!canvas || !canvas.width || !canvas.height || getComputedStyle(canvas).display === 'none') window.__missingPerson = true;
          else {
            const sample = canvas.getContext('2d')?.getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data;
            if (sample && sample[3] > 0) window.__frozenFrames++;
          }
        }
        const v = document.querySelector('video.composition__character-media, video.composition__character-source');
        if (v && v.currentTime > 0.1 && !v.ended) {
          const s = v.closest('.composition__character')?.style;
          if (s) window.__videoBoxes.push([s.left, s.top, s.width, s.height].map(parseFloat));
        }
        if (v && v.currentTime > 0.1 && !v.ended && document.querySelector('.capture__countdown')) window.__earlyCountdown = true;
      }, 30);
    })()`)
  })
  check(await page.evaluate('window.__videoStarts.length === 1 && window.__videoStarts[0] < 0.1'), 'La primera foto no inició el video desde cero')
  check(await page.evaluate('window.__videoEnds === 1 && !window.__earlyCountdown'), 'La primera entrada se cortó antes de terminar')
  await page.waitText('¡Su fotografía está lista!', 30_000)
  await page.click('.touch-button', 'Repetir')
  await page.waitFor('window.__videoStarts.length >= 2', 15_000, 'video de repetición iniciado')
  check(await page.evaluate('window.__videoStarts[1] < 0.1'), 'La repetición no inició el video desde cero')
  check(await page.evaluate('window.__videoEnds === 1 && !document.querySelector(".capture__countdown")'), 'Comenzó el conteo antes de completar la repetición')
  await page.waitFor(`document.querySelector('video.composition__character-media, video.composition__character-source')?.currentTime > 6.2`, 12_000, 'entrada sigue reproduciéndose después de 6 segundos')
  check(await page.evaluate('!document.querySelector(".capture__countdown")'), 'El respaldo de 6 segundos cortó la entrada')
  await page.waitText('¡Su fotografía está lista!', 30_000)
  check(await page.evaluate('window.__videoEnds === 2 && !window.__earlyCountdown'), 'La repetición no esperó al final real del video')
  check(await page.evaluate('window.__frozenFrames > 0 && !window.__missingPerson'), 'El usuario desapareció durante la captura/procesamiento')
  if (expectedVideoBox) {
    const boxes = await page.evaluate('window.__videoBoxes')
    check(boxes.length > 0 && boxes.every(box => box.every((value, i) => Math.abs(value - expectedVideoBox[i]) < 0.2)), 'El video no respetó el ajuste del editor durante la primera entrada o la repetición')
    console.log('APROBADO: tamaño y posición por video, restablecer, guardado y persistencia; la entrada y la repetición coinciden con el editor.')
  }
  console.log('APROBADO: primera toma y repetición reproducen desde cero los 8 s; la cuenta empieza después del final real.')
} finally {
  if (app) await app.close()
  rmSync(dataDir, { recursive: true, force: true })
}
