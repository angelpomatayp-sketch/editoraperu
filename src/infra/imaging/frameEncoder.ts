import { InvalidImageError } from '../../core/capture/captureService'
import { MAX_FRAME_SIDE, type CapturedFrame } from '../../shared/capture'
import { CAPTURE_JPEG_QUALITY } from '../../shared/composition'
import sharp from './sharpSetup'

/**
 * Codifica a JPEG el cuadro crudo enviado por la interfaz (RF-CAP-005). Rechaza dimensiones que
 * no coincidan con los bytes recibidos.
 */
export async function encodeFrame(frame: CapturedFrame): Promise<Uint8Array> {
  const { width, height, rgba } = frame
  const valid =
    Number.isInteger(width) &&
    Number.isInteger(height) &&
    width > 0 &&
    height > 0 &&
    width <= MAX_FRAME_SIDE &&
    height <= MAX_FRAME_SIDE &&
    rgba.byteLength === width * height * 4
  if (!valid) throw new InvalidImageError('Cuadro de cámara inválido')

  const jpeg = await sharp(rgba, { raw: { width, height, channels: 4 } })
    .removeAlpha()
    .jpeg({ quality: CAPTURE_JPEG_QUALITY, chromaSubsampling: '4:4:4' })
    .toBuffer()
  return new Uint8Array(jpeg.buffer, jpeg.byteOffset, jpeg.byteLength)
}
