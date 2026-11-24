import { readFile, rename, rm, writeFile } from 'node:fs/promises'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import type { Metadata } from 'sharp'
import sharp from './sharpSetup'
import { InsufficientResolutionError, InvalidImageError, type PhotoFiles, type StoredImage } from '../../core/capture/captureService'
import { is4kCapture } from '../../shared/capture'
import { MAX_CAPTURE_BYTES } from '../../shared/composition'

const MIN_CAPTURE_SIDE = 320

/**
 * Archivos de fotografías bajo la carpeta de datos. Los nombres son identificadores aleatorios,
 * nunca datos del participante (RF-CMP-005). Se escribe primero en temporales y luego se mueve,
 * para no dejar archivos a medias (RF-KIO-004).
 */
export class FsPhotoFiles implements PhotoFiles {
  constructor(private readonly dataRoot: string) {}

  async saveOriginal(photoId: string, jpeg: Uint8Array): Promise<StoredImage> {
    if (jpeg.byteLength === 0 || jpeg.byteLength > MAX_CAPTURE_BYTES) throw new InvalidImageError('Tamaño fuera de rango')
    if (jpeg[0] !== 0xff || jpeg[1] !== 0xd8 || jpeg[2] !== 0xff) throw new InvalidImageError('No es un JPEG')

    let meta: Metadata
    try {
      meta = await sharp(jpeg).metadata()
    } catch {
      throw new InvalidImageError('JPEG ilegible')
    }
    if (meta.format !== 'jpeg' || !meta.width || !meta.height) throw new InvalidImageError('Formato inesperado')
    if (Math.min(meta.width, meta.height) < MIN_CAPTURE_SIDE) throw new InvalidImageError('Resolución insuficiente')
    if (!is4kCapture(meta.width, meta.height)) throw new InsufficientResolutionError(meta.width, meta.height)

    const filePath = `photos/originals/${photoId}.jpg`
    const temp = join(this.dataRoot, 'tmp', `${photoId}.jpg.part`)
    try {
      await writeFile(temp, jpeg)
      await rename(temp, this.abs(filePath))
    } catch (error) {
      await rm(temp, { force: true })
      throw error
    }
    return { filePath, format: 'jpeg', width: meta.width, height: meta.height, sizeBytes: jpeg.byteLength }
  }

  finalPath(photoId: string): string {
    return `photos/finals/${photoId}.jpg`
  }

  async readAsDataUrl(filePath: string): Promise<string> {
    return `data:image/jpeg;base64,${(await readFile(this.abs(filePath))).toString('base64')}`
  }

  remove(filePath: string): void {
    rmSync(this.abs(filePath), { force: true })
  }

  private abs(filePath: string): string {
    return join(this.dataRoot, filePath)
  }
}
