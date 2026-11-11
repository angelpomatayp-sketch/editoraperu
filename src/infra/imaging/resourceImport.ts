import { randomUUID } from 'node:crypto'
import { copyFileSync, mkdirSync, openSync, readSync, closeSync, rmSync, statSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import sharp from './sharpSetup'

/**
 * Límites de carga, provisionales hasta aprobar PD-005 y PD-006 (RF-REC-001, RF-MUL-002).
 * Se documentan en el README.
 */
export const IMAGE_LIMITS = { maxBytes: 25 * 1024 * 1024, minSide: 200, maxSide: 8000 } as const
export const VIDEO_LIMITS = { maxBytes: 300 * 1024 * 1024 } as const

export const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp']
export const VIDEO_EXTENSIONS = ['mp4', 'webm']

export class ImportError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ImportError'
  }
}

export interface ImportedFile {
  /** Ruta relativa a la carpeta de contenido. */
  filePath: string
  name: string
  format: string
  width: number
  height: number
  sizeBytes: number
  type: 'image' | 'video'
}

export interface ImportedCharacter {
  image: ImportedFile
  animation: (ImportedFile & { durationMs: number | null; background: CharacterAnimationBackground }) | null
}

export type CharacterAnimationBackground = 'alpha' | 'chroma' | 'segmentation'

function nameFrom(file: string): string {
  return basename(file, extname(file)).replace(/[_-]+/g, ' ').trim().slice(0, 120) || 'Sin nombre'
}

function readHead(file: string, length: number): Buffer {
  const fd = openSync(file, 'r')
  try {
    const buffer = Buffer.alloc(length)
    readSync(fd, buffer, 0, length, 0)
    return buffer
  } finally {
    closeSync(fd)
  }
}

/**
 * Valida una imagen por su contenido real, no por la extensión, y la copia a la carpeta de
 * contenido con un nombre aleatorio. Con `requireAlpha`, exige transparencia (personajes y marcos).
 */
export async function importImage(
  source: string,
  contentDir: string,
  folder: string,
  options: { requireAlpha?: boolean } = {}
): Promise<ImportedFile> {
  const size = statSync(source).size
  if (size > IMAGE_LIMITS.maxBytes) throw new ImportError(`La imagen supera ${IMAGE_LIMITS.maxBytes / 1024 / 1024} MB`)

  let meta
  try {
    meta = await sharp(source).metadata()
  } catch {
    throw new ImportError('El archivo no es una imagen válida')
  }
  const format: string | undefined = meta.format
  if (!format || !['jpeg', 'png', 'webp'].includes(format)) throw new ImportError('Formato no admitido: use JPG, PNG o WebP')
  if (!meta.width || !meta.height) throw new ImportError('No se pudieron leer las dimensiones')
  if (Math.min(meta.width, meta.height) < IMAGE_LIMITS.minSide) throw new ImportError(`La imagen debe medir al menos ${IMAGE_LIMITS.minSide} px por lado`)
  if (Math.max(meta.width, meta.height) > IMAGE_LIMITS.maxSide) throw new ImportError(`La imagen no puede superar ${IMAGE_LIMITS.maxSide} px por lado`)
  if (options.requireAlpha && !meta.hasAlpha) {
    throw new ImportError('Este elemento necesita fondo transparente: use PNG o WebP con transparencia')
  }

  const extension = format === 'jpeg' ? 'jpg' : format
  const filePath = `${folder}/${randomUUID()}.${extension}`
  mkdirSync(join(contentDir, folder), { recursive: true })
  copyFileSync(source, join(contentDir, filePath))
  return { filePath, name: nameFrom(source), format, width: meta.width, height: meta.height, sizeBytes: size, type: 'image' }
}

/**
 * Convierte un GIF animado transparente en el par que usa el motor: el GIF conserva el movimiento
 * y el último cuadro se guarda como PNG para la pose y la composición final con Sharp.
 */
export async function importAnimatedGif(source: string, contentDir: string, folder: string): Promise<ImportedCharacter> {
  const size = statSync(source).size
  if (size > IMAGE_LIMITS.maxBytes) throw new ImportError(`La animación supera ${IMAGE_LIMITS.maxBytes / 1024 / 1024} MB`)

  let meta
  try {
    meta = await sharp(source, { animated: true, limitInputPixels: 300_000_000 }).metadata()
  } catch {
    throw new ImportError('El archivo no es un GIF válido')
  }
  if (meta.format !== 'gif') throw new ImportError('La animación debe ser un GIF')
  const pages = meta.pages ?? 1
  const width = meta.width ?? 0
  const pageHeight = meta.pageHeight ?? meta.height ?? 0
  if (pages < 2) throw new ImportError('El GIF debe tener al menos dos cuadros')
  if (pages > 300) throw new ImportError('El GIF tiene demasiados cuadros; use un máximo de 300')
  if (!width || !pageHeight) throw new ImportError('No se pudieron leer las dimensiones del GIF')
  if (Math.min(width, pageHeight) < IMAGE_LIMITS.minSide) throw new ImportError(`El GIF debe medir al menos ${IMAGE_LIMITS.minSide} px por lado`)
  if (Math.max(width, pageHeight) > IMAGE_LIMITS.maxSide) throw new ImportError(`El GIF no puede superar ${IMAGE_LIMITS.maxSide} px por lado`)
  if (!meta.hasAlpha) throw new ImportError('El GIF necesita fondo transparente')

  const id = randomUUID()
  const animationPath = `${folder}/animations/${id}.gif`
  const posePath = `${folder}/${id}.png`
  mkdirSync(join(contentDir, folder, 'animations'), { recursive: true })
  copyFileSync(source, join(contentDir, animationPath))
  try {
    await sharp(source, { page: pages - 1, pages: 1, limitInputPixels: 300_000_000 })
      .png()
      .toFile(join(contentDir, posePath))
  } catch {
    rmSync(join(contentDir, animationPath), { force: true })
    throw new ImportError('No se pudo extraer la pose final del GIF')
  }

  const poseSize = statSync(join(contentDir, posePath)).size
  const durationMs = meta.delay?.length ? meta.delay.reduce((total, delay) => total + delay, 0) : null
  const name = nameFrom(source)
  return {
    image: { filePath: posePath, name, format: 'png', width, height: pageHeight, sizeBytes: poseSize, type: 'image' },
    animation: { filePath: animationPath, name, format: 'gif', width, height: pageHeight, sizeBytes: size, type: 'image', durationMs, background: 'alpha' }
  }
}

/** PNG/WebP estático o GIF animado del que se deriva automáticamente la pose final. */
export async function importCharacter(source: string, contentDir: string, folder: string, segmenter: import('./modnetSegmenter').ModnetSegmenter | null = null): Promise<ImportedCharacter> {
  const extension = extname(source).slice(1).toLowerCase()
  if (extension === 'mp4' || extension === 'webm') {
    const { importCharacterVideo } = await import('./characterVideo')
    return importCharacterVideo(source, contentDir, folder, segmenter)
  }
  const meta = await sharp(source, { animated: true }).metadata().catch(() => null)
  if (meta?.format === 'gif') return importAnimatedGif(source, contentDir, folder)
  return { image: await importImage(source, contentDir, folder, { requireAlpha: true }), animation: null }
}

/** Valida un video MP4 o WebM por su firma y tamaño (RF-MUL-002; códec y duración pendientes de PD-006). */
export function importVideo(source: string, contentDir: string, folder: string): ImportedFile {
  const size = statSync(source).size
  if (size > VIDEO_LIMITS.maxBytes) throw new ImportError(`El video supera ${VIDEO_LIMITS.maxBytes / 1024 / 1024} MB`)
  const head = readHead(source, 12)
  const isMp4 = head.subarray(4, 8).toString('latin1') === 'ftyp'
  const isWebm = head.readUInt32BE(0) === 0x1a45dfa3
  if (!isMp4 && !isWebm) throw new ImportError('Formato de video no admitido: use MP4 o WebM')

  const extension = isMp4 ? 'mp4' : 'webm'
  const filePath = `${folder}/${randomUUID()}.${extension}`
  mkdirSync(join(contentDir, folder), { recursive: true })
  copyFileSync(source, join(contentDir, filePath))
  return { filePath, name: nameFrom(source), format: extension, width: 0, height: 0, sizeBytes: size, type: 'video' }
}

/**
 * Importa la animación de un personaje. Se limita a WebM porque MP4 no conserva el canal alfa que
 * necesita una silueta superpuesta a la cámara. La pose final continúa siendo el PNG/WebP principal.
 */
export function importCharacterAnimation(source: string, contentDir: string, folder: string): ImportedFile {
  const head = readHead(source, 12)
  if (head.subarray(0, 6).toString('ascii').match(/^GIF8[79]a$/)) {
    throw new ImportError('Para usar un GIF, agréguelo directamente como personaje; la aplicación extraerá su pose final')
  }
  if (head.readUInt32BE(0) !== 0x1a45dfa3) {
    throw new ImportError('La animación debe ser un WebM transparente (VP9 con canal alfa)')
  }
  return importVideo(source, contentDir, folder)
}

/** Importa imagen o video según la extensión; el contenido se valida igual. */
export async function importMedia(source: string, contentDir: string, folder: string): Promise<ImportedFile> {
  const ext = extname(source).slice(1).toLowerCase()
  if (VIDEO_EXTENSIONS.includes(ext)) return importVideo(source, contentDir, folder)
  return importImage(source, contentDir, folder)
}
