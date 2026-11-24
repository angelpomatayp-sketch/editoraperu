import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdirSync, rmSync, statSync, readFileSync, writeFileSync, renameSync } from 'node:fs'
import { extname, join } from 'node:path'
import ffmpegStatic from 'ffmpeg-static'
import { applyCharacterChromaKey, detectGreenScreen } from '../../shared/chroma'
import { refineMatte } from './refineMatte'
import sharp from './sharpSetup'
import { IMAGE_LIMITS, importVideo, ImportError, VIDEO_LIMITS, type CharacterAnimationBackground, type ImportedCharacter } from './resourceImport'
import type { ModnetSegmenter } from './modnetSegmenter'

const MAX_DURATION_SECONDS = 30

function executable(): string {
  if (!ffmpegStatic) throw new ImportError('El procesador de video no está disponible')
  return ffmpegStatic.replace('app.asar', 'app.asar.unpacked')
}

function runFfmpeg(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const process = spawn(executable(), ['-hide_banner', '-nostdin', ...args], { windowsHide: true })
    let stderr = ''
    process.stderr.on('data', (chunk) => {
      if (stderr.length < 200_000) stderr += String(chunk)
    })
    process.once('error', () => reject(new ImportError('No se pudo abrir el procesador de video')))
    process.once('exit', (code) => code === 0 ? resolve(stderr) : reject(new ImportError('No se pudo leer el video o extraer su pose final')))
  })
}

function durationSeconds(log: string): number | null {
  const match = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(log)
  if (!match) return null
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3])
}

async function removePoseBackground(file: string, segmenter: ModnetSegmenter | null): Promise<CharacterAnimationBackground> {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  let transparent = 0
  for (let i = 3; i < data.length; i += 4) if (data[i]! < 245) transparent++
  if (transparent / (info.width * info.height) > 0.01) return 'alpha'

  const greenScreen = detectGreenScreen(data, info.width, info.height)
  if (greenScreen && greenScreen.ratio >= 0.35) {
    applyCharacterChromaKey(data, info.width, info.height, greenScreen.keyColor)
    await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toFile(`${file}.cut.png`)
    rmSync(file, { force: true })
    await sharp(`${file}.cut.png`).png().toFile(file)
    rmSync(`${file}.cut.png`, { force: true })
    return 'chroma'
  }

  if (!segmenter?.available()) {
    throw new ImportError('El video tiene fondo común y el modelo de recorte no está disponible. Use WebM transparente o fondo verde')
  }
  const rgb = await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).removeAlpha().raw().toBuffer()
  const matte = await segmenter.matte(rgb, info.width, info.height)
  const alpha = refineMatte(matte, rgb, info.width, info.height)
  await sharp(rgb, { raw: { width: info.width, height: info.height, channels: 3 } })
    .joinChannel(alpha, { raw: { width: info.width, height: info.height, channels: 1 } })
    .png()
    .toFile(`${file}.cut.png`)
  rmSync(file, { force: true })
  await sharp(`${file}.cut.png`).png().toFile(file)
  rmSync(`${file}.cut.png`, { force: true })
  return 'segmentation'
}

function poseRevision(file: string, animationFile: string): string {
  const pose = statSync(file), video = statSync(animationFile)
  return JSON.stringify({ revision: 2, poseSize: pose.size, poseTime: pose.mtimeMs, videoSize: video.size, videoTime: video.mtimeMs })
}

function markPose(file: string, animationFile: string): void {
  writeFileSync(`${file}.chroma.json`, poseRevision(file, animationFile))
}

/**
 * Reconstruye las poses anteriores desde el video original, una vez por revisión del algoritmo.
 * No vuelve a procesar el PNG ya recortado: eso acumularía pérdida de color o transparencia.
 */
export async function repairGreenScreenPose(file: string, animationFile: string): Promise<boolean> {
  // No depender de cuánto verde queda: las poses anteriores ya limitaron ese canal.
  try { if (readFileSync(`${file}.chroma.json`, 'utf8') === poseRevision(file, animationFile)) return false } catch { /* primera actualización */ }

  const source = `${file}.chroma-source.png`
  const output = `${file}.chroma-repair.png`
  try {
    await runFfmpeg(['-sseof', '-0.08', '-i', animationFile, '-map', '0:v:0', '-frames:v', '1', '-an', '-y', source])
    const { data, info } = await sharp(source).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    const greenScreen = detectGreenScreen(data, info.width, info.height)
    if (!greenScreen || greenScreen.ratio < 0.35) return false
    applyCharacterChromaKey(data, info.width, info.height, greenScreen.keyColor)
    await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toFile(output)
    renameSync(output, file)
    markPose(file, animationFile)
    return true
  } finally {
    rmSync(source, { force: true })
    rmSync(output, { force: true })
  }
}

/** Importa MP4/WebM, deriva la pose final PNG y clasifica cómo quitar el fondo durante la reproducción. */
export async function importCharacterVideo(
  source: string,
  contentDir: string,
  folder: string,
  segmenter: ModnetSegmenter | null
): Promise<ImportedCharacter> {
  if (statSync(source).size > VIDEO_LIMITS.maxBytes) throw new ImportError(`El video supera ${VIDEO_LIMITS.maxBytes / 1024 / 1024} MB`)
  const extension = extname(source).slice(1).toLowerCase()
  if (!['mp4', 'webm'].includes(extension)) throw new ImportError('Use un video MP4 o WebM')

  const animation = importVideo(source, contentDir, `${folder}/animations`)
  const posePath = `${folder}/${randomUUID()}.png`
  const poseFile = join(contentDir, posePath)
  mkdirSync(join(contentDir, folder), { recursive: true })
  try {
    const log = await runFfmpeg(['-sseof', '-0.08', '-i', source, '-map', '0:v:0', '-frames:v', '1', '-an', '-y', poseFile])
    const seconds = durationSeconds(log)
    if (seconds !== null && seconds > MAX_DURATION_SECONDS) throw new ImportError(`El video no puede durar más de ${MAX_DURATION_SECONDS} segundos`)
    const background = await removePoseBackground(poseFile, segmenter)
    const meta = await sharp(poseFile).metadata()
    if (!meta.width || !meta.height) throw new ImportError('No se pudieron leer las dimensiones del video')
    if (Math.min(meta.width, meta.height) < IMAGE_LIMITS.minSide) throw new ImportError(`El video debe medir al menos ${IMAGE_LIMITS.minSide} px por lado`)
    if (Math.max(meta.width, meta.height) > IMAGE_LIMITS.maxSide) throw new ImportError(`El video no puede superar ${IMAGE_LIMITS.maxSide} px por lado`)
    const poseSize = statSync(poseFile).size
    if (background === 'chroma') markPose(poseFile, join(contentDir, animation.filePath))
    return {
      image: { filePath: posePath, name: animation.name, format: 'png', width: meta.width, height: meta.height, sizeBytes: poseSize, type: 'image' },
      animation: { ...animation, width: meta.width, height: meta.height, durationMs: seconds === null ? null : Math.round(seconds * 1000), background }
    }
  } catch (error) {
    rmSync(join(contentDir, animation.filePath), { force: true })
    rmSync(poseFile, { force: true })
    rmSync(`${poseFile}.cut.png`, { force: true })
    rmSync(`${poseFile}.chroma.json`, { force: true })
    if (error instanceof ImportError) throw error
    throw new ImportError('No se pudo preparar el video del personaje')
  }
}
