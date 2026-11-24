import { is4kCapture, UHD_CAPTURE, type CameraProblem, type CapturedFrame } from '../../../../shared/capture'
import { applyConfiguredCameraControls, type CameraControls } from '../../../../shared/cameraControls'

/** Abrir en UHD sin escalado del navegador; una vista previa menor nunca autoriza guardar en HD. */
type CameraStreamConstraints = MediaTrackConstraints & { resizeMode?: ConstrainDOMString }
const IDEAL_VIDEO: CameraStreamConstraints = {
  width: { ideal: UHD_CAPTURE.width },
  height: { ideal: UHD_CAPTURE.height },
  resizeMode: { exact: 'none' },
  frameRate: { ideal: 15, max: 30 }
}

const CAMERA_RETRY_DELAYS_MS = [700, 1_500, 2_500] as const
/** Límite de captura fotográfica: cubre UHD 4K sin enviar cuadros 8K enormes por IPC. */
const MAX_PHOTO_SIDE = 4096
const PHOTO_TIMEOUT_MS = 8_000

interface PhotoCapabilitiesLike {
  imageWidth?: { max?: number }
  imageHeight?: { max?: number }
}

interface ImageCaptureLike {
  getPhotoCapabilities(): Promise<PhotoCapabilitiesLike>
  takePhoto(settings?: { imageWidth?: number; imageHeight?: number }): Promise<Blob>
}

type ImageCaptureConstructor = new (track: MediaStreamTrack) => ImageCaptureLike

interface PreparedPhoto {
  capture: ImageCaptureLike
  settings?: { imageWidth: number; imageHeight: number }
}
const preparedPhotos = new WeakMap<MediaStreamTrack, Promise<PreparedPhoto | null>>()

const wait = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => window.setTimeout(resolve, milliseconds))

const retryableCameraError = (error: unknown): boolean => {
  const name = error instanceof DOMException ? error.name : ''
  return name === 'NotReadableError' || name === 'AbortError' || name === 'OverconstrainedError'
}

/**
 * Algunos controladores de cámaras integradas devuelven `NotReadableError` al recibir inicialmente
 * una resolución alta o justo después de liberar una pista. Se reintenta una vez sin resolución
 * forzada solo para la vista previa (algunos equipos ofrecen 4K solo mediante takePhoto). Nunca
 * se guarda ese respaldo si el cuadro recibido no alcanza 4K.
 */
async function requestCamera(deviceId?: string): Promise<MediaStream> {
  const preferred: MediaTrackConstraints = deviceId
    ? { ...IDEAL_VIDEO, deviceId: { exact: deviceId } }
    : IDEAL_VIDEO
  const fallback: boolean | MediaTrackConstraints = deviceId
    ? { deviceId: { exact: deviceId } }
    : true
  let lastError: unknown
  for (let attempt = 0; attempt <= CAMERA_RETRY_DELAYS_MS.length; attempt++) {
    try {
      return await navigator.mediaDevices.getUserMedia({ video: attempt === 0 ? preferred : fallback, audio: false })
    } catch (error) {
      lastError = error
      if (!retryableCameraError(error) || attempt === CAMERA_RETRY_DELAYS_MS.length) throw error
      // Chromium puede desmontar una solicitud duplicada mientras el controlador UVC todavía figura
      // ocupado. Los reintentos escalonados cubren esa ventana sin exigir reiniciar la aplicación.
      await wait(CAMERA_RETRY_DELAYS_MS[attempt]!)
    }
  }
  throw lastError
}

export class CameraError extends Error {
  constructor(readonly problem: CameraProblem) {
    super(problem)
    this.name = 'CameraError'
  }
}

function toProblem(error: unknown): CameraProblem {
  const name = error instanceof DOMException ? error.name : ''
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'not_found'
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'permission_denied'
  if (name === 'NotReadableError' || name === 'AbortError') return 'in_use'
  return 'failed'
}

/** Limpieza de las cámaras enderezadas (ver `rotatedStream`). */
const rotationCleanups = new WeakMap<MediaStream, () => void>()
/** La pista real de la cámara detrás de un flujo enderezado: los ajustes de imagen se aplican a ella. */
const rawTracks = new WeakMap<MediaStream, MediaStreamTrack>()

/**
 * Endereza la imagen de una cámara montada girada: cada cuadro se dibuja rotado, a resolución
 * completa y sin comprimir, y se entrega como un flujo de video normal. Así la vista previa, el
 * recorte del fondo, el encuadre y la foto reciben la imagen ya derecha.
 */
async function rotatedStream(source: MediaStream, rotation: 90 | 180 | 270): Promise<MediaStream> {
  const video = document.createElement('video')
  video.muted = true
  video.playsInline = true
  video.srcObject = source
  await video.play()
  if (!video.videoWidth) await new Promise((resolve) => video.addEventListener('loadedmetadata', resolve, { once: true }))

  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d', { alpha: false })!
  let frame = 0
  let stopped = false
  // Se dibuja solo cuando la cámara entrega un cuadro nuevo (no en cada refresco de la pantalla): en 4K
  // redibujar cuadros repetidos recarga la tarjeta gráfica y retrasa la vista en vivo.
  const withFrames = 'requestVideoFrameCallback' in video
  const schedule = () => {
    frame = withFrames ? video.requestVideoFrameCallback(draw) : requestAnimationFrame(draw)
  }
  const draw = () => {
    if (stopped) return
    schedule()
    const width = video.videoWidth
    const height = video.videoHeight
    if (!width || !height) return
    const turned = rotation !== 180
    const targetWidth = turned ? height : width
    const targetHeight = turned ? width : height
    if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
      canvas.width = targetWidth
      canvas.height = targetHeight
    }
    context.setTransform(1, 0, 0, 1, 0, 0)
    context.translate(targetWidth / 2, targetHeight / 2)
    context.rotate((rotation * Math.PI) / 180)
    context.drawImage(video, -width / 2, -height / 2, width, height)
  }
  draw()

  const output = canvas.captureStream(30)
  const raw = source.getVideoTracks()[0]
  if (raw) rawTracks.set(output, raw)
  rotationCleanups.set(output, () => {
    stopped = true
    if (withFrames) video.cancelVideoFrameCallback(frame)
    else cancelAnimationFrame(frame)
    source.getTracks().forEach((track) => track.stop())
    video.srcObject = null
  })
  // Si se desconecta la cámara, se avisa igual que sin rotación.
  source.getVideoTracks()[0]?.addEventListener('ended', () => output.getVideoTracks()[0]?.dispatchEvent(new Event('ended')))
  return output
}

/**
 * Abre la cámara configurada como principal (RF-CAP-001). Si se indicó parte de su nombre, se busca
 * entre las cámaras detectadas; si no existe, se usa la primera disponible. Con `rotation` (grados en
 * sentido horario) se endereza una cámara montada girada.
 */
export async function openCamera(preferredLabel: string, rotation = 0, controls: CameraControls = {}, controlsEnabled = false): Promise<MediaStream> {
  const stream = await openRawCamera(preferredLabel)
  const track = stream.getVideoTracks()[0]
  if (track) await applyConfiguredCameraControls(track, controls, controlsEnabled)
  if (rotation !== 90 && rotation !== 180 && rotation !== 270) return stream
  try {
    return await rotatedStream(stream, rotation)
  } catch {
    stopCamera(stream)
    throw new CameraError('failed')
  }
}

async function openRawCamera(preferredLabel: string): Promise<MediaStream> {
  try {
    let stream = await requestCamera()
    const wanted = preferredLabel.trim().toLowerCase()
    if (wanted) {
      const devices = await navigator.mediaDevices.enumerateDevices()
      const match = devices.find((d) => d.kind === 'videoinput' && d.label.toLowerCase().includes(wanted))
      const currentTrack = stream.getVideoTracks()[0]
      const current = currentTrack?.getSettings().deviceId
      // Algunos controladores cambian el identificador expuesto después de conceder el permiso. Si
      // el nombre ya coincide, conservar el flujo evita cerrar y reabrir innecesariamente la misma
      // cámara, operación que en cámaras HP integradas puede devolver NotReadableError.
      const currentMatches = currentTrack?.label.toLowerCase().includes(wanted) ?? false
      if (match && !currentMatches && match.deviceId !== current) {
        stopCamera(stream)
        await wait(CAMERA_RETRY_DELAYS_MS[0])
        stream = await requestCamera(match.deviceId)
      }
    }
    return stream
  } catch (error) {
    throw new CameraError(toProblem(error))
  }
}

/** La pista física de la cámara de un flujo abierto con `openCamera`, aunque esté enderezado. */
export function cameraTrack(stream: MediaStream): MediaStreamTrack | null {
  return rawTracks.get(stream) ?? stream.getVideoTracks()[0] ?? null
}

export function stopCamera(stream: MediaStream | null): void {
  if (!stream) return
  rotationCleanups.get(stream)?.()
  stream.getTracks().forEach((track) => track.stop())
}

/**
 * Toma un cuadro a la resolución completa del video, en espejo si corresponde (RF-CAP-005). Se
 * entrega sin comprimir: el proceso principal lo codifica mucho más rápido que el lienzo.
 */
export function captureFrame(video: HTMLVideoElement, mirror: boolean): CapturedFrame {
  const width = video.videoWidth
  const height = video.videoHeight
  if (!width || !height) throw new CameraError('failed')

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new CameraError('failed')
  if (mirror) {
    context.translate(width, 0)
    context.scale(-1, 1)
  }
  context.drawImage(video, 0, 0, width, height)

  const pixels = context.getImageData(0, 0, width, height).data
  return { width, height, rgba: new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength) }
}

/** Lleva una fotografía del sensor a la misma orientación y espejo que ve el visitante. */
async function orientedFrame(blob: Blob, mirror: boolean, rotation: number): Promise<CapturedFrame> {
  const bitmap = await createImageBitmap(blob)
  try {
    if (!is4kCapture(bitmap.width, bitmap.height)) throw new CameraError('resolution_unsupported')
    if (Math.max(bitmap.width, bitmap.height) > MAX_PHOTO_SIDE) throw new CameraError('failed')
    const turned = rotation === 90 || rotation === 270
    const width = turned ? bitmap.height : bitmap.width
    const height = turned ? bitmap.width : bitmap.height
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) throw new CameraError('failed')
    context.translate(width / 2, height / 2)
    if (mirror) context.scale(-1, 1)
    context.rotate((rotation * Math.PI) / 180)
    context.drawImage(bitmap, -bitmap.width / 2, -bitmap.height / 2)
    const pixels = context.getImageData(0, 0, width, height).data
    return { width, height, rgba: new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength) }
  } finally {
    bitmap.close()
  }
}

const withTimeout = async <T>(promise: Promise<T>, milliseconds: number): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Tiempo de captura fotográfica agotado')), milliseconds)
      })
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/** Exige UHD al flujo físico antes de posar; los controles de imagen se conservan. */
async function maximizePhotoTrack(track: MediaStreamTrack): Promise<void> {
  try {
    const current = track.getSettings()
    const portrait = (current.height ?? 0) > (current.width ?? 0)
    const width = portrait ? UHD_CAPTURE.height : UHD_CAPTURE.width
    const height = portrait ? UHD_CAPTURE.width : UHD_CAPTURE.height
    const constraints: CameraStreamConstraints = {
      ...track.getConstraints(),
      width: { min: width, ideal: width, max: MAX_PHOTO_SIDE },
      height: { min: height, ideal: height, max: MAX_PHOTO_SIDE },
      resizeMode: { exact: 'none' },
      // Al tomar una foto importa el detalle, no sostener 30 FPS en 4K.
      frameRate: { ideal: 15, max: 30 }
    }
    await track.applyConstraints(constraints)
    // Se deja estabilizar el cambio de modo antes de la animación y la cuenta regresiva.
    await wait(200)
  } catch {
    // Puede ofrecer foto 4K aunque el vídeo no la soporte. Se validan los píxeles de takePhoto;
    // si tampoco llegan a UHD, captureBestFrame rechaza la captura, sin respaldo de menor calidad.
  }
}

/** El canvas rotado propaga las dimensiones al recibir su próximo cuadro, no al aplicar ajustes. */
async function waitFor4kPreview(track: MediaStreamTrack, preview: HTMLVideoElement): Promise<void> {
  const actual = track.getSettings()
  if (!is4kCapture(actual.width ?? 0, actual.height ?? 0)) return
  for (let elapsed = 0; elapsed < 1000 && !is4kCapture(preview.videoWidth, preview.videoHeight); elapsed += 50) {
    await wait(50)
  }
}

/** Prepara modo y capacidades una sola vez por pista; no toma ninguna foto. */
export async function preparePhotoCapture(stream: MediaStream, preview: HTMLVideoElement): Promise<void> {
  const track = cameraTrack(stream)
  if (!track || track.readyState !== 'live') return
  if (!preparedPhotos.has(track)) {
    const prepare = async (): Promise<PreparedPhoto | null> => {
      const ImageCaptureApi = (globalThis as typeof globalThis & { ImageCapture?: ImageCaptureConstructor }).ImageCapture
      await maximizePhotoTrack(track)
      await waitFor4kPreview(track, preview)
      if (!ImageCaptureApi || track.readyState !== 'live') return null
      const capture = new ImageCaptureApi(track)
      // Algunos UVC toman fotos pero no implementan la consulta de capacidades.
      const capabilities = await withTimeout(capture.getPhotoCapabilities(), PHOTO_TIMEOUT_MS).catch(() => null)
      const maxWidth = capabilities?.imageWidth?.max
      const maxHeight = capabilities?.imageHeight?.max
      const scale = maxWidth && maxHeight ? Math.min(1, MAX_PHOTO_SIDE / Math.max(maxWidth, maxHeight)) : 1
      const settings = maxWidth && maxHeight
        ? { imageWidth: Math.max(1, Math.round(maxWidth * scale)), imageHeight: Math.max(1, Math.round(maxHeight * scale)) }
        : undefined
      return { capture, settings }
    }
    preparedPhotos.set(track, prepare().catch(() => null))
  }
  await preparedPhotos.get(track)
}

/** Solo devuelve píxeles recibidos en UHD o superior. No amplía un cuadro HD para hacerlo pasar por 4K. */
export async function captureBestFrame(
  stream: MediaStream,
  preview: HTMLVideoElement,
  mirror: boolean,
  rotation: number
): Promise<CapturedFrame> {
  const track = cameraTrack(stream)
  if (!track || track.readyState !== 'live') throw new CameraError('disconnected')
  await preparePhotoCapture(stream, preview)
  if (track.readyState !== 'live') throw new CameraError('disconnected')
  await waitFor4kPreview(track, preview)
  // Congelar solo después de preparar la resolución. Antes se podía congelar el cuadro HD viejo.
  const fallbackFrame = is4kCapture(preview.videoWidth, preview.videoHeight) ? captureFrame(preview, mirror) : null
  const prepared = await preparedPhotos.get(track)
  if (prepared) {
    const { capture, settings } = prepared
    for (const request of settings ? [settings, undefined] : [undefined]) {
      try {
        const blob = await withTimeout(capture.takePhoto(request), PHOTO_TIMEOUT_MS)
        const photo = await orientedFrame(blob, mirror, rotation)
        return !fallbackFrame || photo.width * photo.height >= fallbackFrame.width * fallbackFrame.height ? photo : fallbackFrame
      } catch {
        // Reintentar sin parámetros si el controlador rechaza el tamaño o devuelve menos píxeles.
      }
    }
  }
  if (fallbackFrame) return fallbackFrame
  throw new CameraError('resolution_unsupported')
}
