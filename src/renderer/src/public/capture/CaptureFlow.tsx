import { useCallback, useEffect, useRef, useState } from 'react'
import { CAMERA_PHOTO_REGION, CAMERA_SCENARIO_ID, type CampaignDetail, type CharacterOption, type Selections } from '../../../../shared/campaign'
import { OUTPUT, PREVIEW_OUTPUT, photoRegionPixels } from '../../../../shared/composition'
import { characterFrameTarget } from '../../../../shared/characterFraming'
import { photoRegionFor, type FramePlacement } from '../../../../shared/compositionPlan'
import { CAMERA_4K_MESSAGE, type CameraProblem, type CapturedFrame } from '../../../../shared/capture'
import type { PublicSettings, SessionEndReason } from '../../../../shared/ipc'
import { CompositionPreview } from '../campaign/CompositionPreview'
import { CancelButton } from '../../ui/CancelButton'
import { beep, shutter } from '../../ui/sounds'
import { CameraError, captureBestFrame, openCamera, preparePhotoCapture, stopCamera } from './camera'
import { PersonVideo } from './PersonVideo'
import { computePersonGuide, loadSegmenter } from './SegmentationVideo'

type Phase =
  | { name: 'starting' }
  | { name: 'preview' }
  | { name: 'countdown'; value: number }
  | { name: 'capturing' }
  | { name: 'processing' }
  | { name: 'result'; imageDataUrl: string; retakesLeft: number }
  | { name: 'camera_error'; problem: CameraProblem }
  | { name: 'retryable'; message: string; retry: 'capture' | 'compose' }
  | { name: 'failed' }

interface CaptureFlowProps {
  sessionId: string
  detail: CampaignDetail
  selections: Selections
  settings: PublicSettings['capture']
  chroma: PublicSettings['chroma']
  background: PublicSettings['background']
  onContinue: () => void
  onEnd: (reason: SessionEndReason) => void
}

/** Segundos del aviso «Ubíquese aquí» cuando no hay detección de personas. */
const HINT_SECONDS = 5

const CAPTURE_RETRY_MESSAGE = 'No pudimos tomar la fotografía. Intentémoslo de nuevo.'
const COMPOSE_RETRY_MESSAGE = 'No pudimos preparar su fotografía. Intentémoslo de nuevo.'

/**
 * Vista previa, cuenta regresiva, captura, composición y resultado (8.7 a 8.9). Los botones se
 * deshabilitan mientras se procesa para evitar dobles acciones (RF-CAP-005, RNF-007).
 */
export function CaptureFlow({
  sessionId,
  detail,
  selections,
  settings,
  chroma,
  background,
  onContinue,
  onEnd
}: CaptureFlowProps): React.JSX.Element {
  const [phase, setPhase] = useState<Phase>({ name: 'starting' })
  const [flash, setFlash] = useState(false)
  /** Reinicia la entrada cuando la cámara queda lista. */
  const [animationCycle, setAnimationCycle] = useState(0)
  const [charactersReady, setCharactersReady] = useState(false)
  const animationWaitRef = useRef<{
    cycle: number
    pendingVideoIds: Set<string>
    minimumElapsed: boolean
    minimumTimer: ReturnType<typeof setTimeout> | null
  } | null>(null)
  // Encuadre automático que muestra la vista previa y el que tenía al tomar la foto (para componerla igual).
  const livePlacementRef = useRef<FramePlacement | null>(null)
  const photoPlacementRef = useRef<FramePlacement | null>(null)
  const onPlacement = useCallback((placement: FramePlacement | null) => {
    livePlacementRef.current = placement
  }, [])
  // Aviso «Ubíquese aquí»: con recorte automático, hasta detectar a alguien; si no, los primeros segundos.
  const [personPresent, setPersonPresent] = useState(false)
  const [hintTimedOut, setHintTimedOut] = useState(false)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const busy = useRef(false)
  const cameraNeeded = phase.name === 'starting' || phase.name === 'preview' || phase.name === 'countdown' || phase.name === 'capturing'
  // Escenario con zona transparente: la cámara va en esa zona, con su fondo y el encuadre configurado.
  const scenarioOption = detail.scenarios.find((o) => o.id === selections.scenarioId)
  const cameraBackground = selections.scenarioId === CAMERA_SCENARIO_ID
  const { region, fillsHole } = cameraBackground
    ? { region: CAMERA_PHOTO_REGION, fillsHole: false }
    : photoRegionFor(
        detail.photo,
        scenarioOption && { layerOrder: scenarioOption.layer, width: scenarioOption.width, height: scenarioOption.height, photoHole: scenarioOption.photoHole },
        PREVIEW_OUTPUT
      )
  const method = cameraBackground || fillsHole ? 'none' : background.method
  const characterTarget = settings.matchCharacterSize && method === 'segmentation'
    ? characterFrameTarget(detail, selections.characterIds, region, OUTPUT)
    : null

  // Sin detección de personas (fondo verde o sin recorte), el aviso se muestra unos segundos.
  useEffect(() => {
    if (phase.name !== 'preview' || method === 'segmentation') return
    setHintTimedOut(false)
    const timer = setTimeout(() => setHintTimedOut(true), HINT_SECONDS * 1000)
    return () => clearTimeout(timer)
  }, [phase.name, method])
  const showHint = settings.positionHint && phase.name === 'preview' && (method === 'segmentation' ? !personPresent : !hintTimedOut)

  const reportProblem = useCallback((problem: CameraProblem) => {
    void window.totem.reportCameraProblem(problem)
    setPhase({ name: 'camera_error', problem })
  }, [])

  // La cámara solo está encendida durante la vista previa y la cuenta regresiva.
  useEffect(() => {
    if (!cameraNeeded || streamRef.current) return
    let cancelled = false
    let detachVideoReady: (() => void) | null = null
    // El modelo se prepara en paralelo con la cámara; un fallo conserva el respaldo ya existente.
    const segmenterReady = method === 'segmentation' ? loadSegmenter().catch(() => undefined) : Promise.resolve()
    openCamera(settings.cameraLabel, settings.rotation, settings.cameraControls, settings.cameraControlsEnabled)
      .then(async (stream) => {
        if (cancelled) return stopCamera(stream)
        streamRef.current = stream
        stream.getVideoTracks()[0]?.addEventListener('ended', () => {
          streamRef.current = null
          reportProblem('disconnected')
        })
        const source = videoRef.current
        const videoReady = new Promise<void>((resolve) => {
          if (!source || source.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) return resolve()
          const ready = () => {
            detachVideoReady?.()
            resolve()
          }
          detachVideoReady = () => {
            source.removeEventListener('loadeddata', ready)
            source.removeEventListener('error', ready)
          }
          source.addEventListener('loadeddata', ready, { once: true })
          source.addEventListener('error', ready, { once: true })
        })
        if (source) source.srcObject = stream
        await Promise.all([videoReady, segmenterReady])
        if (cancelled) return
        if (source) await preparePhotoCapture(stream, source)
        if (cancelled) return
        setPhase((p) => (p.name === 'starting' ? { name: 'preview' } : p))
      })
      .catch((error: unknown) => {
        if (!cancelled) reportProblem(error instanceof CameraError ? error.problem : 'failed')
      })
    return () => {
      cancelled = true
      detachVideoReady?.()
    }
  }, [cameraNeeded, method, settings.cameraLabel, settings.rotation, settings.cameraControls, settings.cameraControlsEnabled, reportProblem])

  useEffect(() => {
    if (!cameraNeeded) {
      stopCamera(streamRef.current)
      streamRef.current = null
    }
  }, [cameraNeeded])

  useEffect(() => () => stopCamera(streamRef.current), [])

  const finishCharacterVideo = useCallback((characterId: string, cycle: number) => {
    const wait = animationWaitRef.current
    if (!wait || wait.cycle !== cycle) return
    wait.pendingVideoIds.delete(characterId)
    if (wait.minimumElapsed && wait.pendingVideoIds.size === 0) {
      animationWaitRef.current = null
      setCharactersReady(true)
    }
  }, [])

  // La fotografía solo se habilita cuando las entradas programadas terminaron y cada MP4/WebM
  // emitió su final real. Así la carga inicial del modelo de recorte no consume la animación oculta.
  useEffect(() => {
    const previous = animationWaitRef.current
    if (previous) {
      if (previous.minimumTimer) clearTimeout(previous.minimumTimer)
      animationWaitRef.current = null
    }
    if (phase.name !== 'preview') {
      setCharactersReady(false)
      return
    }
    const chosenCharacters = selections.characterIds
      .slice(0, detail.characterSlots.length)
      .map((id) => detail.characters.find((character) => character.id === id))
      .filter((character): character is CharacterOption => character !== undefined)
    const count = chosenCharacters.length
    if (!detail.characterAnimation.enabled || count === 0) {
      setCharactersReady(true)
      return
    }
    setCharactersReady(false)
    const cycle = animationCycle + 1
    setAnimationCycle(cycle)
    const isTimedAnimation = (character: CharacterOption) => !character.animationUrl || character.animationUrl.toLowerCase().endsWith('.gif')
    const timedDurations = chosenCharacters.flatMap((character, index) => isTimedAnimation(character)
      ? [(character.animationDurationMs ?? (detail.characterAnimation.entryDurationMs + detail.characterAnimation.prepareDurationMs)) + index * detail.characterAnimation.staggerMs]
      : [])
    const minimumDuration = timedDurations.length ? Math.max(...timedDurations) : 0
    const pendingVideoIds = new Set(chosenCharacters.filter((character) => !isTimedAnimation(character)).map((character) => character.id))
    const finishIfComplete = () => {
      const wait = animationWaitRef.current
      if (!wait || wait.cycle !== cycle) return
      wait.minimumElapsed = true
      if (wait.pendingVideoIds.size === 0) {
        animationWaitRef.current = null
        setCharactersReady(true)
      }
    }
    const minimumTimer = minimumDuration > 0 ? setTimeout(finishIfComplete, minimumDuration) : null
    // MP4/WebM confirman su final real (o error). No vencer toda la entrada a los 6 segundos:
    // cargar el recortador o reproducir un video largo no significa que el video haya fallado.
    animationWaitRef.current = { cycle, pendingVideoIds, minimumElapsed: minimumDuration === 0, minimumTimer }
    if (minimumDuration === 0 && pendingVideoIds.size === 0) finishIfComplete()
    return () => {
      const wait = animationWaitRef.current
      if (wait?.cycle !== cycle) return
      if (wait.minimumTimer) clearTimeout(wait.minimumTimer)
      animationWaitRef.current = null
    }
  }, [phase.name, detail.characterAnimation, detail.characterSlots.length, selections.characterIds.length])

  const compose = useCallback(async () => {
    setPhase({ name: 'processing' })
    const result = await window.totem.compose(sessionId, [], photoPlacementRef.current)
    if (result.ok) {
      setPhase({ name: 'result', imageDataUrl: result.imageDataUrl, retakesLeft: result.retakesLeft })
    } else if (result.attemptsLeft > 0 && result.error !== 'session_invalid') {
      setPhase({ name: 'retryable', message: COMPOSE_RETRY_MESSAGE, retry: 'compose' })
    } else {
      setPhase({ name: 'failed' })
    }
  }, [sessionId])

  const takePhoto = useCallback(async () => {
    const video = videoRef.current
    const stream = streamRef.current
    if (!video || !stream) {
      setPhase({ name: 'retryable', message: CAPTURE_RETRY_MESSAGE, retry: 'capture' })
      return
    }
    // La pista física permanece encendida mientras ImageCapture obtiene el cuadro 4K. La máscara
    // guía copia inmediatamente el mismo instante de la vista previa y se calcula en paralelo.
    setPhase({ name: 'capturing' })
    photoPlacementRef.current = livePlacementRef.current
    const guidePromise = method === 'segmentation' ? computePersonGuide(video, settings.mirror) : Promise.resolve(null)
    let frame: CapturedFrame
    try {
      frame = await captureBestFrame(stream, video, settings.mirror, settings.rotation)
    } catch (error) {
      if (error instanceof CameraError && error.problem === 'resolution_unsupported') {
        reportProblem(error.problem)
        return
      }
      setPhase({ name: 'retryable', message: CAPTURE_RETRY_MESSAGE, retry: 'capture' })
      return
    }
    // La señal confirma que ya hay una fotografía, no que apenas se está solicitando al sensor.
    if (settings.soundEnabled) shutter()
    setFlash(true)
    setTimeout(() => setFlash(false), 250)
    const guide = await guidePromise
    setPhase({ name: 'processing' })
    const saved = await window.totem.saveCapture(sessionId, frame, guide)
    if (!saved.ok) {
      if (saved.error === 'resolution_unsupported') {
        reportProblem('resolution_unsupported')
        return
      }
      setPhase(
        saved.attemptsLeft > 0 && saved.error !== 'insufficient_disk' && saved.error !== 'session_invalid'
          ? { name: 'retryable', message: CAPTURE_RETRY_MESSAGE, retry: 'capture' }
          : { name: 'failed' }
      )
      return
    }
    await compose()
  }, [method, compose, reportProblem, sessionId, settings.mirror, settings.rotation, settings.soundEnabled])

  // Cuenta regresiva visual con señal sonora opcional (RF-CAP-004).
  useEffect(() => {
    if (phase.name !== 'countdown') return
    if (phase.value === 0) {
      void takePhoto().finally(() => {
        busy.current = false
      })
      return
    }
    if (settings.soundEnabled) beep(phase.value === 1 ? 1320 : 880)
    const timer = setTimeout(() => setPhase({ name: 'countdown', value: phase.value - 1 }), 1000)
    return () => clearTimeout(timer)
  }, [phase, settings.soundEnabled, takePhoto])

  // Al terminar la entrada de todos los personajes, inicia la captura sin exigir otro toque. Si la
  // cámara todavía no entregó su primer cuadro, espera `loadeddata` para no fotografiar en negro.
  useEffect(() => {
    if (phase.name !== 'preview' || !charactersReady || busy.current) return
    const video = videoRef.current
    const begin = () => {
      if (busy.current) return
      busy.current = true
      setPhase({ name: 'countdown', value: settings.countdownSeconds })
    }
    if (video && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      begin()
      return
    }
    video?.addEventListener('loadeddata', begin, { once: true })
    return () => video?.removeEventListener('loadeddata', begin)
  }, [phase.name, charactersReady, settings.countdownSeconds])

  const retake = async () => {
    if (busy.current) return
    busy.current = true
    try {
      const result = await window.totem.retake(sessionId)
      if (result.ok) {
        setCharactersReady(false)
        setAnimationCycle(0)
      }
      setPhase(result.ok ? { name: 'starting' } : { name: 'failed' })
    } finally {
      busy.current = false
    }
  }

  const cancel = () => onEnd('cancelled')

  if (phase.name === 'result') {
    return (
      <main className="step result">
        <div className="step__intro">
          <h1 className="title">¡Su fotografía está lista!</h1>
        </div>
        <div className="result__image">
          <img src={phase.imageDataUrl} alt="Su fotografía" draggable={false} />
        </div>
        <footer className="step__footer footer-actions">
          {phase.retakesLeft > 0 ? (
            <button type="button" className="touch-button touch-button--secondary" onClick={() => void retake()}>
              Repetir ({phase.retakesLeft})
            </button>
          ) : (
            <span />
          )}
          <button type="button" className="touch-button" onClick={onContinue}>
            Continuar
          </button>
        </footer>
      </main>
    )
  }

  if (phase.name === 'camera_error' || phase.name === 'failed' || phase.name === 'retryable') {
    const title =
      phase.name === 'camera_error'
        ? phase.problem === 'resolution_unsupported' ? 'No se pudo capturar en 4K' : 'La cámara no está disponible'
        : phase.name === 'failed'
          ? 'No fue posible completar su fotografía'
          : 'Algo no salió bien'
    const text =
      phase.name === 'retryable'
        ? phase.message
        : phase.name === 'camera_error' && phase.problem === 'resolution_unsupported'
        ? CAMERA_4K_MESSAGE
        : 'Por favor, solicite asistencia al personal. Disculpe las molestias.'
    return (
      <main className="screen screen--message">
        <h1>{title}</h1>
        <p>{text}</p>
        {phase.name === 'camera_error' && (
          <button type="button" className="touch-button" onClick={() => setPhase({ name: 'starting' })}>
            Volver a intentar
          </button>
        )}
        {phase.name === 'retryable' && (
          <button
            type="button"
            className="touch-button"
            onClick={() => (phase.retry === 'compose' ? void compose() : setPhase({ name: 'starting' }))}
          >
            Intentar de nuevo
          </button>
        )}
        <button type="button" className="touch-button touch-button--secondary" onClick={cancel}>
          {phase.name === 'failed' ? 'Volver al inicio' : 'Cancelar'}
        </button>
      </main>
    )
  }

  const counting = phase.name === 'countdown'
  const capturing = phase.name === 'capturing'
  const processing = phase.name === 'processing'
  const working = capturing || processing

  return (
    <main className="step capture">
      <header className="step__header">
        <span />
        {!counting && !working && <CancelButton hasUnsavedData onConfirm={cancel} compact />}
      </header>
      <div className="step__intro">
        <h1 className="title">{capturing ? 'Capturando en alta calidad…' : processing ? 'Preparando su fotografía…' : phase.name === 'starting' ? 'Preparando la cámara…' : phase.name === 'preview' && !charactersReady ? 'Preparando a los personajes…' : 'Mire a la cámara'}</h1>
        {!working && (
          <p className="subtitle">
            {phase.name === 'starting'
              ? 'Un momento, por favor.'
              : !charactersReady && phase.name === 'preview'
              ? 'Espere un momento mientras toman su posición.'
              : 'Ubíquese dentro del recuadro y sonría.'}
          </p>
        )}
      </div>
      <div className="capture__stage">
        {/* Fuente de la captura a resolución completa; se muestra recortada en la vista previa. */}
        <video ref={videoRef} autoPlay muted playsInline className="capture__source" />
        <CompositionPreview
          className="capture__preview"
          detail={detail}
          selections={selections}
          characterMotion={{
            mode: phase.name === 'starting' ? 'waiting' : phase.name === 'preview' && !charactersReady ? 'enter' : 'pose',
            cycle: animationCycle
          }}
          onCharacterVideoEnd={finishCharacterVideo}
          person={
            phase.name === 'starting' ? null : (
              <>
                <PersonVideo
                  frozen={working}
                  videoRef={videoRef}
                  method={method}
                  chroma={chroma}
                  mirror={settings.mirror}
                  framing={settings.framingPercent / 100}
                  regionPx={photoRegionPixels(region)}
                  autoFraming={(settings.autoFraming || characterTarget !== null) && !fillsHole}
                  characterTarget={characterTarget}
                  lockFraming={characterTarget !== null && phase.name === 'countdown' && phase.value <= 2}
                  backdrop={fillsHole}
                  onPlacement={onPlacement}
                  onPresence={setPersonPresent}
                />
                {!working && <div className={`capture__guide${showHint ? ' capture__guide--hint' : ''}`} aria-hidden="true" />}
              </>
            )
          }
        >
          {showHint && (
            <div
              className="position-hint"
              style={{
                left: `${region.x * 100}%`,
                top: `${(region.y + region.height * 0.5) * 100}%`,
                width: `${region.width * 100}%`,
                height: `${region.height * 0.5 * 100}%`
              }}
              role="status"
            >
              <svg className="position-hint__figure" viewBox="0 0 40 80" aria-hidden="true">
                <circle cx="20" cy="10" r="8" />
                <path d="M8 26c0-5 5-8 12-8s12 3 12 8v22h-6v30h-5V54h-2v24h-5V48H8z" />
              </svg>
              <strong>Ubíquese aquí</strong>
              <span>De pie, dentro del recuadro</span>
            </div>
          )}
          {counting && phase.value > 0 && (
            <div className="capture__countdown" aria-live="assertive">
              {phase.value}
            </div>
          )}
          {working && <div className="spinner" role="status" aria-label={capturing ? 'Capturando en alta calidad' : 'Procesando'} />}
          {flash && <div className="capture__flash" />}
        </CompositionPreview>
      </div>
      <footer className="step__footer">
        <p className="capture__auto-message" role="status" aria-live="polite">
          {phase.name === 'starting'
            ? 'Encendiendo la cámara…'
            : phase.name === 'preview' && !charactersReady
              ? 'La cuenta regresiva comenzará cuando los personajes estén listos.'
              : counting
                ? 'Manténgase en posición para la fotografía.'
                : capturing
                  ? 'No se mueva: estamos tomando la fotografía…'
                  : 'Preparando su fotografía…'}
        </p>
      </footer>
    </main>
  )
}
