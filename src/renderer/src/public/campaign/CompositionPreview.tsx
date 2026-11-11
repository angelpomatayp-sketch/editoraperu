import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { CAMERA_PHOTO_REGION, CAMERA_SCENARIO_ID, type CampaignDetail, type CharacterOption, type ResourceOption, type Selections } from '../../../../shared/campaign'
import { PREVIEW_OUTPUT } from '../../../../shared/composition'
import { buildCompositionPlan, photoRegionFor, placeCharacters, type LayerResource } from '../../../../shared/compositionPlan'
import { DEFAULT_CHROMA, detectGreenScreen, type ChromaSettings } from '../../../../shared/chroma'
import { ChromaVideo } from '../capture/ChromaVideo'
import { SegmentationVideo } from '../capture/SegmentationVideo'

interface CompositionPreviewProps {
  detail: CampaignDetail
  selections: Selections
  /** Contenido de la capa de la persona: la cámara en vivo o un marcador. */
  person: ReactNode
  /** Elementos superpuestos a toda la composición (cuenta regresiva, destello). */
  children?: ReactNode
  className?: string
  /** Movimiento de los personajes en la cámara. Sin esta opción, se muestran como imágenes fijas. */
  characterMotion?: { mode: 'waiting' | 'enter' | 'pose'; cycle: number }
  /** Confirma el final real de un video de personaje, después de que el recortador esté listo. */
  onCharacterVideoEnd?: (characterId: string, cycle: number) => void
}

function asLayer(option: ResourceOption, type: LayerResource['type'], place = { x: 0, y: 0, scale: 1 }): LayerResource {
  return {
    id: option.id,
    type,
    src: option.imageUrl,
    width: option.width,
    height: option.height,
    layerOrder: option.layer,
    posX: place.x,
    posY: place.y,
    scale: place.scale,
    photoHole: option.photoHole ?? null,
    preserveFrame: type === 'character' && 'animationUrl' in option && option.animationUrl !== null
  }
}

const pct = (value: number, total: number) => `${(value / total) * 100}%`
/**
 * Oculta los fotogramas de arranque que algunos generadores de video copian de la imagen de
 * referencia antes de iniciar el movimiento. El video ya avanza durante este tiempo, por lo que
 * el visitante ve directamente la entrada desde el borde y nunca la pose final inicial.
 */
const CHARACTER_PREROLL_MS = 300
/**
 * El video es solo una mejora visual: ante cualquier error se muestra de inmediato la pose final.
 * `waiting` mantiene la capa vacía durante el arranque; en `capture` se reproduce una sola vez y
 * `pose` fuerza la imagen que también usará Sharp en la fotografía final.
 */
function CharacterMedia({ character, motion, delayMs, onFinished }: { character: CharacterOption; motion: NonNullable<CompositionPreviewProps['characterMotion']>; delayMs: number; onFinished?: () => void }): React.JSX.Element {
  const video = useRef<HTMLVideoElement | null>(null)
  const [failedUrl, setFailedUrl] = useState<string | null>(null)
  const [videoEnded, setVideoEnded] = useState(false)
  const [rendererReady, setRendererReady] = useState(character.animationBackground === 'alpha')
  const [revealed, setRevealed] = useState(false)
  const [videoChroma, setVideoChroma] = useState<ChromaSettings>(DEFAULT_CHROMA)
  const finishedRef = useRef(onFinished)
  finishedRef.current = onFinished
  const isGif = character.animationUrl?.toLowerCase().endsWith('.gif') ?? false
  // Los videos se reproducen una vez por ciclo, solo durante la entrada, y deciden su final mediante
  // `ended`. Antes del primer ciclo no se sustituye por la pose: la capa permanece invisible.
  const animated = character.animationUrl !== null
    && failedUrl !== character.animationUrl
    && motion.mode === 'enter'
    && (isGif || (motion.cycle > 0 && !videoEnded))

  const finishVideo = () => {
    setVideoEnded(true)
    finishedRef.current?.()
  }

  const calibrateChroma = (element: HTMLVideoElement) => {
    if (character.animationBackground !== 'chroma' || !element.videoWidth || !element.videoHeight) return
    const width = Math.min(160, element.videoWidth)
    const height = Math.max(1, Math.round(width * element.videoHeight / element.videoWidth))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (context) {
      context.drawImage(element, 0, 0, width, height)
      const detected = detectGreenScreen(context.getImageData(0, 0, width, height).data, width, height)
      if (detected && detected.ratio >= 0.35) setVideoChroma({ ...DEFAULT_CHROMA, keyColor: detected.keyColor })
    }
    setRendererReady(true)
  }

  useEffect(() => {
    const element = video.current
    if (!element || !animated || !rendererReady) return
    let revealTimer: ReturnType<typeof setTimeout> | null = null
    const timer = setTimeout(() => {
      void element.play()
        .then(() => {
          revealTimer = setTimeout(() => setRevealed(true), CHARACTER_PREROLL_MS)
        })
        .catch(() => {
          setFailedUrl(character.animationUrl)
          finishVideo()
        })
    }, delayMs)
    return () => {
      clearTimeout(timer)
      if (revealTimer) clearTimeout(revealTimer)
    }
  }, [animated, character.animationUrl, delayMs, motion.cycle, motion.mode, rendererReady])

  // Los GIF no exponen control de reproducción; se montan ocultos y se revelan tras el mismo
  // pre-roll para mantener una entrada consistente con MP4 y WebM.
  useEffect(() => {
    if (!animated || !isGif) return
    const timer = setTimeout(() => setRevealed(true), delayMs + CHARACTER_PREROLL_MS)
    return () => clearTimeout(timer)
  }, [animated, delayMs, isGif, motion.cycle])

  // No mostrar nunca la pose final como sustituto mientras se prepara el primer cuadro de entrada.
  if (motion.mode === 'waiting' || (motion.mode === 'enter' && motion.cycle === 0)) return <></>

  if (animated && isGif) {
    return (
      <img
        key={`${character.animationUrl}-${motion.cycle}`}
        className={`composition__character-media${revealed ? '' : ' composition__character-media--preroll'}`}
        src={`${character.animationUrl}?cycle=${motion.cycle}`}
        alt=""
        draggable={false}
        onError={() => setFailedUrl(character.animationUrl)}
      />
    )
  }
  if (animated) {
    if (character.animationBackground !== 'alpha') {
      return (
        <div className={`composition__character-media${revealed ? '' : ' composition__character-media--preroll'}`}>
          <video
            ref={video}
            className="composition__character-source"
            crossOrigin="anonymous"
            src={character.animationUrl!}
            muted
            playsInline
            preload="auto"
            onLoadedData={(event) => calibrateChroma(event.currentTarget)}
            onEnded={finishVideo}
            onError={() => {
              setFailedUrl(character.animationUrl)
              finishVideo()
            }}
          />
          {character.animationBackground === 'chroma' ? (
            <ChromaVideo videoRef={video} chroma={videoChroma} mirror={false} />
          ) : (
            <SegmentationVideo videoRef={video} mirror={false} framing={0} onReady={() => setRendererReady(true)} />
          )}
        </div>
      )
    }
    return (
      <video
        ref={video}
        className={`composition__character-media${revealed ? '' : ' composition__character-media--preroll'}`}
        src={character.animationUrl!}
        muted
        playsInline
        preload="auto"
        loop={false}
        onEnded={finishVideo}
        onError={() => {
          setFailedUrl(character.animationUrl)
          finishVideo()
        }}
      />
    )
  }
  return (
    <img
      className="composition__character-media"
      src={character.imageUrl}
      alt=""
      draggable={false}
    />
  )
}

/**
 * Vista previa de la composición con el mismo plan de capas que la imagen final (RF-EXP-006, RF-CAP-002):
 * lo que el participante ve es lo que obtiene. Los videos conservan su cuadro, escala y ubicación.
 */
export function CompositionPreview({ detail, selections, person, children, className, characterMotion, onCharacterVideoEnd }: CompositionPreviewProps): React.JSX.Element {
  const scenario = detail.scenarios.find((s) => s.id === selections.scenarioId)
  const cameraBackground = selections.scenarioId === CAMERA_SCENARIO_ID
  const characterOptions = selections.characterIds
    .map((id) => detail.characters.find((c) => c.id === id))
    .filter((c): c is CharacterOption => c !== undefined)
  const characters = characterOptions.map((c) => asLayer(c, 'character'))
  const frame = detail.frames.find((f) => f.id === selections.frameId)
  const plan = scenario || cameraBackground
    ? buildCompositionPlan(
        {
          photoRegion: cameraBackground ? CAMERA_PHOTO_REGION : photoRegionFor(detail.photo, asLayer(scenario!, 'scenario'), PREVIEW_OUTPUT).region,
          scenario: cameraBackground ? null : asLayer(scenario!, 'scenario'),
          characters: placeCharacters(characters, detail.characterSlots, {
            placements: [],
            limits: { ...detail.freePlacement, enabled: false },
            output: PREVIEW_OUTPUT
          }),
          frame: frame ? asLayer(frame, 'frame') : null,
          overlays: detail.overlays.map((o) => asLayer(o, 'logo', o))
        },
        PREVIEW_OUTPUT
      )
    : []

  return (
    <div
      className={`composition ${className ?? ''}`}
      data-character-motion={characterMotion?.mode}
      data-character-cycle={characterMotion?.cycle}
      style={{ aspectRatio: `${PREVIEW_OUTPUT.width} / ${PREVIEW_OUTPUT.height}` }}
    >
      {plan.map((layer, index) => {
        if (layer.kind === 'backdrop') {
          return <img key="backdrop" className="composition__backdrop" src={layer.resource.src} alt="" draggable={false} style={{ zIndex: index }} />
        }
        if (layer.kind === 'fill') {
          const fit = layer.box
            ? { inset: 'auto', left: `${layer.box.x * 100}%`, top: `${layer.box.y * 100}%`, width: `${layer.box.width * 100}%`, height: `${layer.box.height * 100}%` }
            : {}
          return <img key={layer.resource.id} className="composition__fill" src={layer.resource.src} alt="" draggable={false} style={{ zIndex: index, ...fit }} />
        }
        const box = {
          left: pct(layer.left, PREVIEW_OUTPUT.width),
          top: pct(layer.top, PREVIEW_OUTPUT.height),
          width: pct(layer.width, PREVIEW_OUTPUT.width),
          height: pct(layer.height, PREVIEW_OUTPUT.height),
          zIndex: index
        }
        if (layer.kind === 'photo') {
          return (
            <div key="photo" className="composition__person" style={box}>
              {person}
            </div>
          )
        }
        const characterIndex = layer.resource.type === 'character' ? selections.characterIds.indexOf(layer.resource.id) : -1
        const character = characterIndex >= 0 ? characterOptions[characterIndex] : undefined
        if (character && characterMotion) {
          const bounds = character.contentBounds
          const visibleLeft = layer.left + bounds.x * layer.width
          const visibleRight = layer.left + (bounds.x + bounds.width) * layer.width
          const autoDirection = (visibleLeft + visibleRight) / 2 < PREVIEW_OUTPUT.width / 2 ? 'left' : 'right'
          const direction = character.entryDirection === 'auto' ? autoDirection : character.entryDirection
          const margin = PREVIEW_OUTPUT.width * 0.04
          const entryPercent = direction === 'left'
            ? -((visibleRight + margin) / layer.width) * 100
            : ((PREVIEW_OUTPUT.width - visibleLeft + margin) / layer.width) * 100
          const animation = detail.characterAnimation
          const entryDurationMs = character.animationDurationMs
            ? Math.max(400, character.animationDurationMs - animation.prepareDurationMs)
            : animation.entryDurationMs
          // Un GIF o video ya contiene el desplazamiento real del personaje dentro de sus cuadros.
          // Trasladar además todo su contenedor desde fuera de pantalla oculta casi toda la
          // reproducción y hace que solo se vea la pose final. La entrada programada se reserva
          // para personajes estáticos; los animados permanecen en su encuadre final mientras
          // reproducen su propio movimiento.
          const usesProgrammedEntry = !character.animationUrl
          const motionStyle = {
            ...box,
            transformOrigin: `${character.anchorX * 100}% ${character.anchorY * 100}%`,
            '--character-entry-x': `${entryPercent}%`,
            '--character-entry-duration': `${entryDurationMs}ms`,
            '--character-prepare-duration': `${animation.prepareDurationMs}ms`,
            '--character-entry-delay': `${characterIndex * animation.staggerMs}ms`,
            '--character-tilt': `${direction === 'left' ? animation.tiltDegrees : -animation.tiltDegrees}deg`
          } as CSSProperties
          return (
            <div
              key={layer.resource.id}
              className={`composition__placed composition__character${characterMotion.mode === 'enter' && animation.enabled && usesProgrammedEntry ? ' composition__character--entering' : ''}`}
              style={motionStyle}
            >
              {character.animationUrl ? <CharacterMedia key={`${character.id}-${characterMotion.cycle}`} character={character} motion={characterMotion} delayMs={characterIndex * animation.staggerMs} onFinished={() => onCharacterVideoEnd?.(character.id, characterMotion.cycle)} /> : characterMotion.mode !== 'waiting' ? (
                <img className="composition__character-media" src={character.imageUrl} alt="" draggable={false} />
              ) : null}
            </div>
          )
        }
        return <img key={layer.resource.id} className="composition__placed" src={layer.resource.src} alt="" draggable={false} style={box} />
      })}
      {children}
    </div>
  )
}
