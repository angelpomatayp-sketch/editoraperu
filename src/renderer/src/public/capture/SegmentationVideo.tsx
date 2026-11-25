import { useEffect, useRef, useState, type RefObject } from 'react'
import type { ImageSegmenter } from '@mediapipe/tasks-vision'
import type { PersonGuide } from '../../../../shared/capture'
import { BufferedVideo } from './BufferedVideo'
import { autoFrame, placeFrame, type CharacterFrameTarget, type FramePlacement } from '../../../../shared/compositionPlan'
import { measurePerson } from '../../../../shared/personMeasure'
import { blendPlacement, PersonBoxSmoother } from '../../../../shared/framingSmoother'

/** Motor y modelo incluidos con la aplicación; se sirven sin Internet por el protocolo interno. */
const WASM_BASE = 'totem-media://app/vendor/mediapipe/wasm'
const MODEL_URL = 'totem-media://app/models/selfie_segmenter.tflite'

/** Lado mayor del cuadro que se entrega al modelo de la vista previa. */
const SEGMENTATION_SIDE = 512

/** Tiempo sin detectar a la persona antes de darla por perdida y reiniciar el suavizado. */
const LOST_PERSON_MS = 1200

/** Constante de tiempo (ms) del encuadre visible: mayor = transición más suave y lenta. */
const PLACEMENT_TAU_MS = 350

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

interface SegmentationVideoProps {
  frozen?: boolean
  videoRef: RefObject<HTMLVideoElement | null>
  mirror: boolean
  /** Encuadre fijo, de 0 (imagen completa) a 1 (llenar el recuadro, por defecto). */
  framing?: number
  /** Encuadre automático de la persona; requiere `regionPx`. */
  autoFraming?: boolean
  characterTarget?: CharacterFrameTarget | null
  /** Fija únicamente la geometría; la persona puede seguir moviéndose en el video. */
  lockFraming?: boolean
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
export function SegmentationVideo({ videoRef, mirror, framing, autoFraming, characterTarget, lockFraming, regionPx, onPlacement, onPresence, onReady, frozen = false }: SegmentationVideoProps): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [failed, setFailed] = useState(false)
  const frozenRef = useRef(frozen)
  frozenRef.current = frozen
  // Los ajustes se leen en cada cuadro sin reiniciar el ciclo de dibujo.
  const options = useRef({ framing, autoFraming, characterTarget, lockFraming, regionPx, onPlacement, onPresence, onReady })
  options.current = { framing, autoFraming, characterTarget, lockFraming, regionPx, onPlacement, onPresence, onReady }

  useEffect(() => {
    let display: FramePlacement | null = null
    let lastPlacement: FramePlacement | null = null
    let lastSeen = 0
    let lastNow = 0
    let present: boolean | null = null
    let frame = 0
    let cancelled = false
    const smoother = new PersonBoxSmoother()
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
          if (frozenRef.current) return
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
          const measured = measurePerson(values, mask.width, mask.height)
          result.close()

          const vw = video.videoWidth
          const vh = video.videoHeight
          const { framing: fixed = 1, autoFraming: auto, characterTarget: target, lockFraming: locked, regionPx: region, onPlacement: report } = options.current

          // Contorno completo y limpio de la persona, en la orientación de la foto y estabilizado.
          if (measured) {
            const person = mirror ? { ...measured.box, x: 1 - measured.box.x - measured.box.width } : measured.box
            smoother.update(person, now)
            lastSeen = now
          } else if (now - lastSeen > LOST_PERSON_MS) {
            smoother.reset()
          }
          const stable = smoother.current()
          // Hay alguien si se lo detectó hace poco (evita parpadeos del aviso «Ubíquese aquí»).
          const nowPresent = stable !== null
          if (nowPresent !== present) {
            present = nowPresent
            options.current.onPresence?.(nowPresent)
          }

          // Altura relativa al personaje. Si la silueta está cortada y no permite comparar alturas,
          // se llena la zona con el encuadre automático anterior: nunca el fijo, que dejaba al
          // visitante diminuto. El fijo solo se usa cuando no hay nadie frente a la cámara.
          const regionSize = region ?? { width, height }
          let candidate: FramePlacement | null = null
          if (locked && lastPlacement) candidate = lastPlacement
          else if (auto && region && stable) {
            candidate = (target ? autoFrame(stable, vw, vh, regionSize.width, regionSize.height, target) : null)
                ?? autoFrame(stable, vw, vh, regionSize.width, regionSize.height)
          }
          const desired = candidate ?? placeFrame(vw, vh, regionSize.width, regionSize.height, fixed)
          const dt = lastNow ? Math.min(250, now - lastNow) : 16
          lastNow = now
          display = display ? blendPlacement(display, desired, 1 - Math.exp(-dt / PLACEMENT_TAU_MS)) : desired
          // Se reporta exactamente el encuadre visible: la foto final reproduce lo que se vio.
          if (candidate) {
            lastPlacement = display
            report?.(display)
          } else {
            lastPlacement = null
            report?.(null)
          }
          const { crop, box } = display


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
          options.current.onPlacement?.(null)
          setFailed(true)
        }
      })

    return () => {
      cancelled = true
      cancelAnimationFrame(frame)
      options.current.onPlacement?.(null)
    }
  }, [videoRef, mirror])

  if (failed) return <BufferedVideo videoRef={videoRef} mirror={mirror} frozen={frozen} />
  return <canvas ref={canvasRef} className="chroma-video" />
}
