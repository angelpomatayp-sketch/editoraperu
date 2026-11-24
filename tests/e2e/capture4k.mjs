// Regresión de captura en Chromium real, sin publicar fotos ni usar la cámara física.
import assert from 'node:assert/strict'
import { readdirSync, rmSync } from 'node:fs'
import { join, relative } from 'node:path'
import { tmpdir } from 'node:os'
import sharp from 'sharp'
import { launch, openDb, patchSettings, registerParticipant, startSession, tempDir } from './lib.mjs'

for (const mode of ['uhd', 'uhd-camera', 'hd']) {
  const dataDir = tempDir('totem-capture-4k-')
  let app
  try {
    app = await launch({ dataDir })
    await app.page.waitFor("document.querySelector('main.attract')", 20_000)
    await app.close()
    app = null
    patchSettings(dataDir, { background: { method: 'none' }, capture: {
      rotation: 90, countdownSeconds: 2, soundEnabled: false,
      cameraControlsEnabled: false, cameraControls: { focusMode: 'manual', focusDistance: 20, brightness: 128 }
    } })
    if (mode === 'uhd-camera') {
      const db = openDb(dataDir)
      const campaign = db.prepare("SELECT id, config_json FROM campaigns WHERE code = 'DEMO-LECTURA'").get()
      db.prepare('UPDATE campaigns SET config_json = ? WHERE id = ?')
        .run(JSON.stringify({ ...JSON.parse(campaign.config_json), allowCameraBackground: true }), campaign.id)
      db.close()
    }
    app = await launch({ dataDir })
    const { page } = app
    await startSession(page)
    await registerParticipant(page, {
      scenario: mode === 'uhd-camera' ? 'Usar fondo real de la cámara' : 'Biblioteca',
      cameraTimeoutMs: 30_000,
      onBeforeCamera: () => page.evaluate(`(() => {
        window.__captureSizes = [];
        window.__cameraConstraintKeys = [];
        const nativeGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
        navigator.mediaDevices.getUserMedia = async (...args) => {
          const stream = await nativeGetUserMedia(...args);
          const track = stream.getVideoTracks()[0];
          const apply = track.applyConstraints.bind(track);
          track.applyConstraints = async (constraints) => {
            window.__cameraConstraintKeys.push(...Object.keys(constraints), ...(constraints.advanced ?? []).flatMap(Object.keys));
            return apply(constraints);
          };
          return stream;
        };
        setInterval(() => {
          const video = document.querySelector('video.capture__source');
          if (video?.videoWidth) window.__captureSizes.push([video.videoWidth, video.videoHeight]);
        }, 50);
        ${mode === 'hd' ? `
          // Controlador simulado que solo entrega Full HD y no tiene fotografía independiente.
          const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
          navigator.mediaDevices.getUserMedia = async () => {
            const stream = await original({ audio: false, video: { width: { exact: 1920 }, height: { exact: 1080 }, resizeMode: { exact: 'none' } } });
            const track = stream.getVideoTracks()[0];
            const apply = track.applyConstraints.bind(track);
            track.applyConstraints = async (constraints) => {
              if (constraints.width?.min >= 3840 || constraints.height?.min >= 3840) throw new DOMException('Solo HD', 'OverconstrainedError');
              return apply(constraints);
            };
            return stream;
          };
          window.ImageCapture = undefined;
        ` : ''}
      })()`)
    })
    if (mode !== 'hd') {
      await page.waitText('¡Su fotografía está lista!', 40_000)
      const db = openDb(dataDir)
      const original = db.prepare("SELECT width, height, file_path FROM photos WHERE kind = 'original' AND status = 'captured'").get()
      const final = db.prepare("SELECT width, height FROM photos WHERE kind = 'final' AND status = 'composed'").get()
      db.close()
      assert.deepEqual([original.width, original.height], [2160, 3840])
      assert.deepEqual([final.width, final.height], [2160, 3840])
      const meta = await sharp(join(dataDir, original.file_path)).metadata()
      assert.deepEqual([meta.width, meta.height], [2160, 3840])
      const sizes = await page.evaluate('window.__captureSizes')
      assert(sizes.some(([w, h]) => w === 2160 && h === 3840), 'La cámara girada no entregó vídeo UHD')
      const keys = await page.evaluate('window.__cameraConstraintKeys');
      for (const key of ['focusMode', 'focusDistance', 'exposureMode', 'whiteBalanceMode', 'brightness']) {
        assert(!keys.includes(key), 'El modo neutro no debe modificar ' + key);
      }
      console.log('APROBADO: ' + (mode === 'uhd-camera' ? 'fondo real' : 'con escenario') + ', cámara simulada UHD, giro de 90°, original y final 2160 × 3840, sin imponer controles de imagen.')
    } else {
      await page.waitText('No se pudo capturar en 4K', 20_000)
      assert(await page.hasText('No se guardó una imagen de menor resolución'))
      const db = openDb(dataDir)
      assert.equal(db.prepare('SELECT COUNT(*) AS n FROM photos').get().n, 0)
      const failure = db.prepare("SELECT detail_json FROM audit_events WHERE category = 'camera' ORDER BY rowid DESC LIMIT 1").get()
      assert(failure?.detail_json.includes('resolution_unsupported'), 'Falta el registro de rechazo UHD')
      db.close()
      assert.deepEqual(readdirSync(join(dataDir, 'photos/originals')), [])
      assert.deepEqual(readdirSync(join(dataDir, 'photos/finals')), [])
      assert(await page.evaluate("[...document.querySelectorAll('button')].some(b => b.textContent.includes('Volver a intentar'))"))
      await page.click('button', 'Cancelar')
      await page.waitFor("document.querySelector('main.attract')", 10_000)
      console.log('APROBADO: controlador Full HD bloqueado con aviso, registro y cancelación; no se guardaron fotos.')
    }
    assert.equal(page.logs.filter(line => line.startsWith('excepción:')).length, 0, page.logs.join('\n'))
  } finally {
    if (app) await app.close()
    // Solo elimina la carpeta temporal creada por esta prueba; nunca datos del usuario.
    const local = relative(tmpdir(), dataDir)
    assert(local.startsWith('totem-capture-4k-') && !local.includes('..') && !local.includes('/') && !local.includes('\\'))
    rmSync(dataDir, { recursive: true, force: true })
  }
}
