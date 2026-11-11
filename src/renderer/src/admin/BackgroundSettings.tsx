import { useEffect, useRef, useState } from 'react'
import {
  applyCameraControls,
  CAMERA_CONTROL_LABEL,
  CAMERA_MODE_CONTROLS,
  CAMERA_NUMERIC_CONTROLS,
  cameraCapabilities,
  currentCameraControls,
  type CameraCapabilities,
  type CameraControls
} from '../../../shared/cameraControls'
import type { BackgroundMethod, ChromaSettings } from '../../../shared/chroma'
import { CameraError, cameraTrack, openCamera, stopCamera } from '../public/capture/camera'
import { PersonVideo } from '../public/capture/PersonVideo'
import { errorMessage, useAdmin } from './adminContext'
import { Card, Notice } from './ui'

const SAMPLE = 7

const METHODS: { value: BackgroundMethod; title: string; text: string }[] = [
  {
    value: 'segmentation',
    title: 'Recorte automático',
    text: 'Detecta a la persona sobre cualquier fondo con modelos locales (MediaPipe y MODNet), sin Internet. Usa inteligencia artificial: requiere la aprobación de Editora Perú como cambio de alcance.'
  },
  {
    value: 'chroma',
    title: 'Fondo verde (croma)',
    text: 'Requiere una tela o panel verde detrás del participante e iluminación pareja. Sin inteligencia artificial. Los bordes son los más nítidos si está bien calibrado.'
  },
  { value: 'none', title: 'Sin recorte', text: 'La fotografía se usa completa, con su fondo.' }
]

function toHex([r, g, b]: number[]): string {
  return `#${[r, g, b].map((v) => Math.round(v!).toString(16).padStart(2, '0')).join('')}`
}

interface Background {
  method: BackgroundMethod
  chroma: ChromaSettings
  cameraControls: CameraControls
}

const MODE_LABEL: Record<string, string> = { continuous: 'Automático', manual: 'Manual', 'single-shot': 'Automático una vez' }

/**
 * Cómo se quita el fondo de la fotografía y calibración del fondo verde (PD-016), con la cámara en
 * vivo para ver el resultado antes de guardar.
 */
export function BackgroundSettings(): React.JSX.Element {
  const { call } = useAdmin()
  const [value, setValue] = useState<Background | null>(null)
  const [message, setMessage] = useState<{ kind: 'error' | 'ok' | 'info'; text: string } | null>(null)
  const [mirror, setMirror] = useState(true)
  /** Resolución real de la cámara: 1280 × 720 es HD; 1920 × 1080, Full HD. */
  const [resolution, setResolution] = useState<string | null>(null)
  const sourceRef = useRef<HTMLVideoElement | null>(null)
  const rawRef = useRef<HTMLVideoElement | null>(null)
  /** Pista física de la cámara y sus valores de fábrica, para «Restablecer». */
  const trackRef = useRef<MediaStreamTrack | null>(null)
  const factoryRef = useRef<CameraControls>({})
  const [capabilities, setCapabilities] = useState<CameraCapabilities | null>(null)

  useEffect(() => {
    const loaded = call<Background>('settings.getBackground')
    void loaded.then(setValue)
    let stream: MediaStream | null = null
    let cancelled = false
    void window.totem.getPublicSettings().then(async (s) => {
      setMirror(s.capture.mirror)
      try {
        // Se abre sin ajustes para conocer los valores propios de la cámara; luego se aplican los guardados.
        stream = await openCamera(s.capture.cameraLabel, s.capture.rotation)
        if (cancelled) return stopCamera(stream)
        const track = cameraTrack(stream)
        if (track) {
          trackRef.current = track
          factoryRef.current = currentCameraControls(track)
          setCapabilities(cameraCapabilities(track))
          await applyCameraControls(track, (await loaded).cameraControls)
        }
        if (sourceRef.current) sourceRef.current.srcObject = stream
        if (rawRef.current) rawRef.current.srcObject = stream
      } catch (error) {
        setMessage({ kind: 'error', text: error instanceof CameraError ? 'La cámara no está disponible' : errorMessage(error) })
      }
    })
    return () => {
      cancelled = true
      stopCamera(stream)
    }
  }, [call])

  /** Toma el color promedio de una zona de 7 × 7 píxeles donde se tocó la imagen. */
  const sample = (event: React.PointerEvent<HTMLVideoElement>) => {
    const video = event.currentTarget
    if (!video.videoWidth || !value || value.method !== 'chroma') return
    const rect = video.getBoundingClientRect()
    const scale = Math.min(rect.width / video.videoWidth, rect.height / video.videoHeight)
    const offsetX = (rect.width - video.videoWidth * scale) / 2
    const offsetY = (rect.height - video.videoHeight * scale) / 2
    const x = Math.round((event.clientX - rect.left - offsetX) / scale)
    const y = Math.round((event.clientY - rect.top - offsetY) / scale)
    if (x < 0 || y < 0 || x >= video.videoWidth || y >= video.videoHeight) return

    const canvas = document.createElement('canvas')
    canvas.width = SAMPLE
    canvas.height = SAMPLE
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!
    ctx.drawImage(video, x - 3, y - 3, SAMPLE, SAMPLE, 0, 0, SAMPLE, SAMPLE)
    const data = ctx.getImageData(0, 0, SAMPLE, SAMPLE).data
    const sum = [0, 0, 0]
    for (let i = 0; i < data.length; i += 4) for (let c = 0; c < 3; c++) sum[c]! += data[i + c]!
    const color = toHex(sum.map((v) => v / (SAMPLE * SAMPLE)))
    setValue({ ...value, chroma: { ...value.chroma, keyColor: color } })
    setMessage({ kind: 'info', text: `Color del fondo tomado: ${color}` })
  }

  const save = async () => {
    if (!value) return
    try {
      setValue(await call<Background>('settings.saveBackground', value))
      setMessage({ kind: 'ok', text: 'Guardado; se aplica a las próximas fotografías' })
    } catch (error) {
      setMessage({ kind: 'error', text: errorMessage(error) })
    }
  }

  /** Cambia un ajuste de la cámara y se ve al instante; se conserva al guardar. */
  const setControl = (changes: CameraControls) => {
    if (!value) return
    const cameraControls = { ...value.cameraControls, ...changes }
    setValue({ ...value, cameraControls })
    if (trackRef.current) void applyCameraControls(trackRef.current, cameraControls)
  }

  const resetControls = () => {
    if (!value) return
    setValue({ ...value, cameraControls: {} })
    if (trackRef.current) void applyCameraControls(trackRef.current, factoryRef.current)
    setMessage({ kind: 'info', text: 'Ajustes de la cámara restablecidos; guarde para conservarlo' })
  }

  if (!value) return <Card title="Fondo de la foto">Cargando…</Card>
  const chroma = value.chroma
  const setChroma = (changes: Partial<ChromaSettings>) => setValue({ ...value, chroma: { ...chroma, ...changes } })

  const slider = (key: 'similarity' | 'smoothness' | 'spill', label: string, max: number, hint: string) => (
    <label className="slider">
      <span>
        {label}: <strong>{chroma[key].toFixed(3)}</strong>
      </span>
      <input type="range" min={key === 'smoothness' ? 0.005 : 0} max={max} step={0.005} value={chroma[key]} onChange={(e) => setChroma({ [key]: Number(e.target.value) })} />
      <span className="afield__hint">{hint}</span>
    </label>
  )

  return (
    <Card title="Fondo de la foto">
      <video ref={sourceRef} autoPlay muted playsInline className="capture__source" />
      <div className="methods" role="radiogroup" aria-label="Método para quitar el fondo">
        {METHODS.map((m) => (
          <label key={m.value} className={`method${value.method === m.value ? ' method--on' : ''}`}>
            <input type="radio" name="background-method" checked={value.method === m.value} onChange={() => setValue({ ...value, method: m.value })} />
            <span>
              <strong>{m.title}</strong>
              <span className="afield__hint">{m.text}</span>
            </span>
          </label>
        ))}
      </div>

      <div className="calibration">
        <figure>
          <video
            ref={rawRef}
            autoPlay
            muted
            playsInline
            className="calibration__raw"
            onPointerDown={sample}
            onLoadedMetadata={(e) => setResolution(`${e.currentTarget.videoWidth} × ${e.currentTarget.videoHeight}`)}
            onResize={(e) => setResolution(`${e.currentTarget.videoWidth} × ${e.currentTarget.videoHeight}`)}
          />
          <figcaption>
            {value.method === 'chroma' ? 'Cámara (toque el fondo verde)' : 'Cámara'}
            {resolution && ` · captura a ${resolution} px`}
          </figcaption>
        </figure>
        <figure>
          <div className="calibration__keyed">
            <PersonVideo videoRef={sourceRef} method={value.method} chroma={chroma} mirror={mirror} />
          </div>
          <figcaption>Resultado en vivo</figcaption>
        </figure>
      </div>

      <div className="aform">
        {value.method === 'chroma' && (
          <>
            <label className="inline">
              Color del fondo
              <input type="color" value={chroma.keyColor} onChange={(e) => setChroma({ keyColor: e.target.value })} />
              <code>{chroma.keyColor}</code>
            </label>
            {slider('similarity', 'Tolerancia', 0.5, 'Más alto elimina más tonos de verde; demasiado alto borra partes de la persona')}
            {slider('smoothness', 'Suavidad de bordes', 0.3, 'Transición entre persona y fondo')}
            {slider('spill', 'Reducción del reflejo verde', 1, 'Quita el tono verde que el fondo refleja sobre la persona')}
          </>
        )}
        {value.method === 'segmentation' && (
          <p className="muted">
            La vista en vivo es una aproximación rápida; la fotografía final se recorta con un modelo de mayor calidad. Funciona mejor con una sola persona, bien
            iluminada y con un fondo que contraste con su ropa.
          </p>
        )}
        <h3>Ajustes de imagen de la cámara</h3>
        {capabilities && (Object.keys(capabilities.numeric).length > 0 || Object.keys(capabilities.modes).length > 0) ? (
          <>
            <p className="muted">
              Compensan la luz del lugar en la propia cámara, antes de la foto: con poca luz suba el brillo o la exposición; con luz de fondo (ventanas), suba la
              compensación de exposición. Se aplican cada vez que se abre la cámara. Solo aparecen los ajustes que esta cámara permite.
            </p>
            {CAMERA_MODE_CONTROLS.map((key) => {
              const modes = capabilities.modes[key]
              if (!modes) return null
              const current = value.cameraControls[key] ?? factoryRef.current[key] ?? ''
              return (
                <label key={key}>
                  {CAMERA_CONTROL_LABEL[key]}
                  <select value={current} onChange={(e) => setControl({ [key]: e.target.value as CameraControls[typeof key] })}>
                    {modes.map((m) => (
                      <option key={m} value={m}>
                        {MODE_LABEL[m] ?? m}
                      </option>
                    ))}
                  </select>
                </label>
              )
            })}
            {CAMERA_NUMERIC_CONTROLS.map((key) => {
              const range = capabilities.numeric[key]
              if (!range) return null
              // El tiempo de exposición y la temperatura de color solo se usan en modo manual.
              if (key === 'exposureTime' && (value.cameraControls.exposureMode ?? factoryRef.current.exposureMode) !== 'manual') return null
              if (key === 'colorTemperature' && (value.cameraControls.whiteBalanceMode ?? factoryRef.current.whiteBalanceMode) !== 'manual') return null
              const current = value.cameraControls[key] ?? factoryRef.current[key] ?? range.min
              return (
                <label key={key} className="slider">
                  <span>
                    {CAMERA_CONTROL_LABEL[key]}: <strong>{current}</strong>
                    {value.cameraControls[key] === undefined && <span className="afield__hint"> (de la cámara)</span>}
                  </span>
                  <input type="range" min={range.min} max={range.max} step={range.step} value={current} onChange={(e) => setControl({ [key]: Number(e.target.value) })} />
                </label>
              )
            })}
            <div>
              <button type="button" className="btn" onClick={resetControls}>
                Restablecer ajustes de la cámara
              </button>
            </div>
          </>
        ) : (
          <p className="muted">{capabilities ? 'Esta cámara no permite ajustar su imagen desde la aplicación.' : 'Abriendo la cámara…'}</p>
        )}

        {message && <Notice kind={message.kind}>{message.text}</Notice>}
        <div className="aform__actions">
          <button type="button" className="btn btn--primary" onClick={() => void save()}>
            Guardar
          </button>
        </div>
      </div>
    </Card>
  )
}
