import { useEffect, useRef, useState, type RefObject } from 'react'
import type { BackgroundMethod, ChromaSettings } from '../../../../shared/chroma'
import { placeFrame, type CharacterFrameTarget, type FramePlacement } from '../../../../shared/compositionPlan'
import { ChromaVideo } from './ChromaVideo'
import { SegmentationVideo } from './SegmentationVideo'
import { BufferedVideo } from './BufferedVideo'

interface PersonVideoProps {
  frozen?: boolean
  videoRef: RefObject<HTMLVideoElement | null>
  method: BackgroundMethod
  chroma: ChromaSettings
  mirror: boolean
  /**
   * Encuadre fijo en la zona de la persona, de 0 (imagen completa) a 1 (llenar la zona), y tamaño de
   * la zona en píxeles de la imagen final. Sin ellos, la cámara llena el recuadro.
   */
  framing?: number
  regionPx?: { width: number; height: number }
  /** Encuadre automático de la persona (solo con recorte automático del fondo). */
  autoFraming?: boolean
  characterTarget?: CharacterFrameTarget | null
  /** Mantiene el encuadre en los últimos segundos, sin congelar el video. */
  lockFraming?: boolean
  /** Recibe el encuadre automático en uso, para aplicar el mismo a la foto. */
  onPlacement?: (placement: FramePlacement | null) => void
  /** Aparición o salida de una persona (solo con recorte automático). */
  onPresence?: (present: boolean) => void
  /** Zona transparente de un escenario: lo que la cámara no cubre se rellena con la misma imagen desenfocada. */
  backdrop?: boolean
}

/** Tamaño del cuadro de la cámara, cuando ya se conoce. */
function useVideoSize(videoRef: RefObject<HTMLVideoElement | null>): { width: number; height: number } | null {
  const [size, setSize] = useState<{ width: number; height: number } | null>(null)
  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    const update = () => setSize(video.videoWidth && video.videoHeight ? { width: video.videoWidth, height: video.videoHeight } : null)
    update()
    video.addEventListener('loadedmetadata', update)
    video.addEventListener('resize', update)
    return () => {
      video.removeEventListener('loadedmetadata', update)
      video.removeEventListener('resize', update)
    }
  }, [videoRef])
  return size
}

/**
 * Cámara en vivo con el fondo quitado según el método configurado (RF-CAP-002), ubicada en la zona
 * de la persona con el mismo encuadre que la foto final (`placeFrame`).
 */
export function PersonVideo({
  videoRef,
  method,
  chroma,
  mirror,
  framing,
  regionPx,
  autoFraming,
  characterTarget,
  lockFraming,
  onPlacement,
  onPresence,
  backdrop,
  frozen = false
}: PersonVideoProps): React.JSX.Element {
  const size = useVideoSize(videoRef)

  // Con recorte automático, la vista calcula el encuadre (fijo o automático) cuadro a cuadro.
  if (method === 'segmentation') {
    return (
      <SegmentationVideo
        frozen={frozen}
        videoRef={videoRef}
        mirror={mirror}
        framing={framing}
        autoFraming={autoFraming}
        characterTarget={characterTarget}
        lockFraming={lockFraming}
        regionPx={regionPx}
        onPlacement={onPlacement}
        onPresence={onPresence}
      />
    )
  }

  const content =
    method === 'chroma' ? (
      <ChromaVideo videoRef={videoRef} chroma={chroma} mirror={mirror} frozen={frozen} />
    ) : (
      <BufferedVideo videoRef={videoRef} mirror={mirror} frozen={frozen} />
    )

  if (framing === undefined || regionPx === undefined || !size) return content

  // Un recuadro con la proporción de la parte usada: dentro, cada vista recorta «cover» y coincide.
  const { box } = placeFrame(size.width, size.height, regionPx.width, regionPx.height, framing)
  const pct = (v: number) => `${v * 100}%`
  const frame = (
    <div className="person-frame" style={{ left: pct(box.x), top: pct(box.y), width: pct(box.width), height: pct(box.height) }}>
      {content}
    </div>
  )
  if (!backdrop) return frame
  return (
    <>
      <BackdropCanvas videoRef={videoRef} mirror={mirror} aspect={regionPx.width / regionPx.height} frozen={frozen} />
      {frame}
    </>
  )
}

/** Ancho del relleno desenfocado y cuadros por segundo: diminuto y lento, casi sin costo. */
const BACKDROP_WIDTH = 48
const BACKDROP_FPS = 8

/**
 * Relleno de la zona transparente de un escenario: la cámara reducida a unos pocos píxeles, suavizada
 * y ampliada al tamaño de la zona, lo que la deja desenfocada sin el costo de desenfocar un video 4K.
 * Coincide con el relleno de la foto final (la misma imagen ampliada y desenfocada).
 */
function BackdropCanvas({ videoRef, mirror, aspect, frozen }: { videoRef: RefObject<HTMLVideoElement | null>; mirror: boolean; aspect: number; frozen: boolean }): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const frozenRef = useRef(frozen)
  frozenRef.current = frozen
  useEffect(() => {
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    if (!canvas || !context) return
    canvas.width = BACKDROP_WIDTH
    canvas.height = Math.max(1, Math.round(BACKDROP_WIDTH / aspect))
    const draw = () => {
      if (frozenRef.current) return
      const video = videoRef.current
      if (!video?.videoWidth || !video.videoHeight) return
      // Recorte «cover» de la cámara a la proporción de la zona.
      const scale = Math.max(canvas.width / video.videoWidth, canvas.height / video.videoHeight)
      const sw = canvas.width / scale
      const sh = canvas.height / scale
      context.setTransform(mirror ? -1 : 1, 0, 0, 1, mirror ? canvas.width : 0, 0)
      context.filter = 'blur(1.5px) brightness(0.85)'
      context.drawImage(video, (video.videoWidth - sw) / 2, (video.videoHeight - sh) / 2, sw, sh, 0, 0, canvas.width, canvas.height)
    }
    draw()
    const timer = setInterval(draw, 1000 / BACKDROP_FPS)
    return () => clearInterval(timer)
  }, [videoRef, mirror, aspect])
  return <canvas ref={canvasRef} className="person-backdrop" aria-hidden="true" />
}
