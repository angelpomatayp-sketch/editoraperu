import { useEffect, useRef, useState, type RefObject } from 'react'
import type { ImageSegmenter } from '@mediapipe/tasks-vision'
import type { PersonGuide } from '../../../../shared/capture'
import { autoFrame, placeFrame, type FractionRect, type FramePlacement } from '../../../../shared/compositionPlan'

/** Motor y modelo incluidos con la aplicación; se sirven sin Internet por el protocolo interno. */
const WASM_BASE = 'totem-media://app/vendor/mediapipe/wasm'
const MODEL_URL = 'totem-media://app/models/selfie_segmenter.tflite'

/** Lado mayor del cuadro que se entrega al modelo de la vista previa. */
const SEGMENTATION_SIDE = 512

let segmenterPromise: Promise<ImageSegmenter> | null = null

/** Carga MediaPipe una sola vez por ejecución; intenta con la tarjeta gráfica y, si no, con el procesador. */
export function loadSegmenter(): Promise<ImageSegmenter> {
  segmenterPromise ??= (async () => {
    const { FilesetResolver, ImageSegmenter } = await import('@mediapipe/tasks-vision')
    const fileset = await FilesetResolver.forVisionTasks(WASM_BASE)
    const create = (delegate: 'GPU' | 'CPU') =>
      ImageSegmenter.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MODEL_URL, delegate },
        runningMode: 'VIDEO',
        outputConfidenceMasks: true,
        outputCategoryMask: false
      })
    try {
      return await create('GPU')
    } catch {
      return create('CPU')
    }
  })()
  segmenterPromise.catch(() => {
    segmenterPromise = null
  })
  return segmenterPromise
}

/**
 * Silueta de la persona en el cuadro actual del video, para guiar el recorte de la foto final.
 * El cuadro se copia antes de cualquier espera, porque la cámara se apaga al pasar a procesar.
 * Devuelve `null` si el modelo no está disponible: la foto se recorta igual, solo con MODNet.
 */
export async function computePersonGuide(video: HTMLVideoElement, mirror: boolean): Promise<PersonGuide | null> {
  const vw = video.videoWidth
  const vh = video.videoHeight
  if (!vw || !vh) return null
  const scale = Math.min(1, SEGMENTATION_SIDE / Math.max(vw, vh))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(vw * scale)
  canvas.height = Math.round(vh * scale)
  const context = canvas.getContext('2d')
  if (!context) return null
  if (mirror) {
    context.translate(canvas.width, 0)
    context.scale(-1, 1)
  }
  context.drawImage(video, 0, 0, canvas.width, canvas.height)

  try {
    const segmenter = await loadSegmenter()
    const result = segmenter.segmentForVideo(canvas, performance.now())
    try {
      const mask = result.confidenceMasks?.[0]
      if (!mask) return null
      const values = mask.getAsFloat32Array()
      const alpha = new Uint8Array(values.length)
      for (let i = 0; i < values.length; i++) alpha[i] = Math.round(values[i]! * 255)
      return { width: mask.width, height: mask.height, alpha }
    } finally {
      result.close()
    }
  } catch {
    return null
  }
}

/** Suavizado del encuadre automático entre cuadros (0 a 1: más alto, reacciona más rápido). */
const FRAMING_SMOOTHING = 0.2
/** Tiempo sin detectar a nadie tras el cual se vuelve al encuadre fijo. */
const LOST_PERSON_MS = 1000

/** Contorno de la persona en la máscara (fracciones), o `null` si casi no hay persona. */
function personBox(values: Float32Array, width: number, height: number): FractionRect | null {
  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1
  let count = 0
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (values[y * width + x]! <= 0.5) continue
      count++
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }
  if (count < width * height * 0.005) return null
  return { x: minX / width, y: minY / height, width: (maxX + 1 - minX) / width, height: (maxY + 1 - minY) / height }
}

const blend = (from: FractionRect, to: FractionRect, k: number): FractionRect => ({
  x: from.x + (to.x - from.x) * k,
  y: from.y + (to.y - from.y) * k,
  width: from.width + (to.width - from.width) * k,
  height: from.height + (to.height - from.height) * k
})

interface SegmentationVideoProps {
  videoRef: RefObject<HTMLVideoElement | null>
  mirror: boolean
  /** Encuadre fijo, de 0 (imagen completa) a 1 (llenar el recuadro, por defecto). */
  framing?: number
  /** Encuadre automático de la persona; requiere `regionPx`. */
  autoFraming?: boolean
  /** Tamaño de la zona de la persona en píxeles de la imagen final (para limitar la ampliación). */
  regionPx?: { width: number; height: number }
  /** Recibe el encuadre automático en uso (o `null` si se usa el fijo), para aplicarlo a la foto. */
  onPlacement?: (placement: FramePlacement | null) => void
  /** Avisa cuando aparece o desaparece una persona frente a la cámara (solo al cambiar). */
  onPresence?: (present: boolean) => void
  /** Avisa cuando el modelo local ya puede procesar cuadros del video. */
  onReady?: () => void
}

/**
 * Vista previa en vivo con la persona recortada automáticamente (MediaPipe Selfie Segmenter, local).
 * Es una aproximación rápida: la fotografía final se recorta con un modelo de mayor calidad (MODNet).
 * Si el modelo no carga, se muestra la cámara sin recortar.
 */
export function SegmentationVideo({ videoRef, mirror, framing, autoFraming, regionPx, onPlacement, onPresence, onReady }: SegmentationVideoProps): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [failed, setFailed] = useState(false)
  // Los ajustes se leen en cada cuadro sin reiniciar el ciclo de dibujo.
  const options = useRef({ framing, autoFraming, regionPx, onPlacement, onPresence, onReady })
  options.current = { framing, autoFraming, regionPx, onPlacement, onPresence, onReady }

  useEffect(() => {
    let smoothed: FractionRect | null = null
    let lastSeen = 0
    let present: boolean | null = null
    let frame = 0
    let cancelled = false
    const maskCanvas = document.createElement('canvas')
    const maskContext = maskCanvas.getContext('2d')!
    // El modelo trabaja a 256 px: pasarle el cuadro 4K completo bajaba la interfaz a 5 cuadros por segundo.
    const inputCanvas = document.createElement('canvas')
    const inputContext = inputCanvas.getContext('2d')!

    void loadSegmenter()
      .then((segmenter) => {
        options.current.onReady?.()
        let lastTime = -1
        const draw = () => {
          if (cancelled) return
          frame = requestAnimationFrame(draw)
          const video = videoRef.current
          const canvas = canvasRef.current
          if (!video || !canvas || video.readyState < 2 || !video.videoWidth) return
          const now = performance.now()
          if (now <= lastTime) return
          lastTime = now

          const width = Math.round(canvas.clientWidth * devicePixelRatio)
          const height = Math.round(canvas.clientHeight * devicePixelRatio)
          if (canvas.width !== width || canvas.height !== height) {
            canvas.width = width
            canvas.height = height
          }

          const inputScale = Math.min(1, SEGMENTATION_SIDE / Math.max(video.videoWidth, video.videoHeight))
          const inputWidth = Math.round(video.videoWidth * inputScale)
          const inputHeight = Math.round(video.videoHeight * inputScale)
          if (inputCanvas.width !== inputWidth || inputCanvas.height !== inputHeight) {
            inputCanvas.width = inputWidth
            inputCanvas.height = inputHeight
          }
          inputContext.drawImage(video, 0, 0, inputWidth, inputHeight)
          const result = segmenter.segmentForVideo(inputCanvas, now)
          const mask = result.confidenceMasks?.[0]
          if (!mask) return result.close()
          const values = mask.getAsFloat32Array()
          if (maskCanvas.width !== mask.width || maskCanvas.height !== mask.height) {
            maskCanvas.width = mask.width
            maskCanvas.height = mask.height
          }
          const image = maskContext.createImageData(mask.width, mask.height)
          for (let i = 0; i < values.length; i++) image.data[i * 4 + 3] = Math.round(values[i]! * 255)
          maskContext.putImageData(image, 0, 0)
          const detected = personBox(values, mask.width, mask.height)
          result.close()

          const vw = video.videoWidth
          const vh = video.videoHeight
          const { framing: fixed = 1, autoFraming: auto, regionPx: region, onPlacement: report } = options.current

          // Contorno de la persona en la orientación de la foto (en espejo si corresponde), suavizado.
          if (detected) {
            const person = mirror ? { ...detected, x: 1 - detected.x - detected.width } : detected
            smoothed = smoothed ? blend(smoothed, person, FRAMING_SMOOTHING) : person
            lastSeen = now
          } else if (now - lastSeen > LOST_PERSON_MS) {
            smoothed = null
          }
          // Hay alguien si se lo detectó hace poco (evita parpadeos del aviso «Ubíquese aquí»).
          const nowPresent = smoothed !== null
          if (nowPresent !== present) {
            present = nowPresent
            options.current.onPresence?.(nowPresent)
          }

          // Mismo encuadre que la foto final: automático si hay persona; si no, el fijo configurado.
          const regionSize = region ?? { width, height }
          const automatic = auto && region && smoothed ? autoFrame(smoothed, vw, vh, regionSize.width, regionSize.height) : null
          report?.(automatic)
          const { crop, box } = automatic ?? placeFrame(vw, vh, regionSize.width, regionSize.height, fixed)

          // Fuente en coordenadas del video sin espejo; destino dentro del recuadro de la zona.
          const sx = (mirror ? 1 - crop.x - crop.width : crop.x) * vw
          const sy = crop.y * vh
          const sw = crop.width * vw
          const sh = crop.height * vh
          const dx = box.x * width
          const dy = box.y * height
          const dw = box.width * width
          const dh = box.height * height
          const mx = mask.width / vw
          const my = mask.height / vh

          const ctx = canvas.getContext('2d')!
          ctx.save()
          ctx.clearRect(0, 0, width, height)
          if (mirror) {
            ctx.translate(dx + dw, dy)
            ctx.scale(-1, 1)
          } else {
            ctx.translate(dx, dy)
          }
          ctx.imageSmoothingQuality = 'high'
          ctx.drawImage(video, sx, sy, sw, sh, 0, 0, dw, dh)
          ctx.globalCompositeOperation = 'destination-in'
          ctx.drawImage(maskCanvas, sx * mx, sy * my, sw * mx, sh * my, 0, 0, dw, dh)
          ctx.restore()
        }
        draw()
      })
      .catch(() => {
        if (!cancelled) {
          // El modo de respaldo muestra el video original; también debe liberar su reproducción.
          options.current.onReady?.()
          setFailed(true)
        }
      })

    return () => {
      cancelled = true
      cancelAnimationFrame(frame)
    }
  }, [videoRef, mirror])

  const fallbackRef = useRef<HTMLVideoElement | null>(null)
  useEffect(() => {
    if (!failed || !fallbackRef.current || !videoRef.current) return
    if (videoRef.current.srcObject) fallbackRef.current.srcObject = videoRef.current.srcObject
    else fallbackRef.current.src = videoRef.current.currentSrc || videoRef.current.src
  }, [failed, videoRef])

  if (failed) return <video ref={fallbackRef} autoPlay muted playsInline className={`chroma-video${mirror ? ' mirrored' : ''}`} />
  return <canvas ref={canvasRef} className="chroma-video" />
}
