import { useEffect, useRef, useState } from 'react'
import type { AdminCampaign, AdminResource } from '../../../../shared/admin'
import { CAMERA_SCENARIO_ID, CAMERA_PHOTO_REGION, MAX_CHARACTERS, type CharacterAnimation, type CharacterSlot, type CharacterVideoTransforms, type FreePlacement, type PhotoRegion } from '../../../../shared/campaign'
import { PREVIEW_OUTPUT } from '../../../../shared/composition'
import { placeCharacters } from '../../../../shared/compositionPlan'
import { Card, Notice } from '../ui'

interface Placement {
  x: number
  y: number
  scale: number
}

type Target = { kind: 'photo' } | { kind: 'overlay'; id: string }

interface Drag {
  target: Target
  mode: 'move' | 'resize'
  startX: number
  startY: number
  photo: PhotoRegion
  placement: Placement
}

interface LayoutEditorProps {
  campaign: AdminCampaign
  onSave: (payload: {
    id: string
    photo: PhotoRegion
    characterSlots: CharacterSlot[]
    freePlacement: FreePlacement
    characterAnimation: CharacterAnimation
    characterVideoTransforms: CharacterVideoTransforms
    overlays: { resourceId: string; x: number; y: number; scale: number }[]
  }) => Promise<void>
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v))
const pct = (v: number) => `${v * 100}%`

/**
 * Ubicación visual (RF-CMP-003, RF-REC-004): zona de la persona y logotipos sobre la vista previa.
 * El ajuste de video conserva su cuadro completo y usa la misma geometría que la foto final.
 */
export function LayoutEditor({ campaign, onSave }: LayoutEditorProps): React.JSX.Element {
  const scenarios = campaign.resources.filter((r) => r.type === 'scenario')
  const frames = campaign.resources.filter((r) => r.type === 'frame' && r.active)
  const logos = campaign.resources.filter((r) => r.type === 'logo')
  const videos = campaign.resources.filter((r) => r.type === 'character' && r.animationUrl)

  const [scenarioId, setScenarioId] = useState(scenarios[0]?.id ?? CAMERA_SCENARIO_ID)
  const [showFrame, setShowFrame] = useState(true)
  const [photo, setPhoto] = useState<PhotoRegion>(campaign.photo)
  const [slots, setSlots] = useState<CharacterSlot[]>(campaign.characterSlots)
  const [overlays, setOverlays] = useState<Record<string, Placement>>(() =>
    Object.fromEntries(logos.map((l) => [l.id, { x: l.x, y: l.y, scale: l.scale }]))
  )
  const [animation, setAnimation] = useState<CharacterAnimation>(campaign.characterAnimation)
  const [dirty, setDirty] = useState(false)
  const [videoId, setVideoId] = useState(videos[0]?.id ?? '')
  const [videoTransforms, setVideoTransforms] = useState<CharacterVideoTransforms>(campaign.characterVideoTransforms ?? {})
  const stage = useRef<HTMLDivElement | null>(null)
  const drag = useRef<Drag | null>(null)

  const scenario = scenarios.find((s) => s.id === scenarioId)
  const video = videos.find((v) => v.id === videoId)
  const videoTransform = videoTransforms[videoId] ?? { scale: 1, x: 0, y: 0 }
  const videoPlacement = video ? placeCharacters([{
    id: video.id, type: 'character', src: video.imageUrl, width: video.width, height: video.height,
    layerOrder: video.layer, posX: 0, posY: 0, scale: 1, preserveFrame: true
  }], [slots[0]!], {
    placements: [], limits: { ...campaign.freePlacement, enabled: false },
    output: PREVIEW_OUTPUT, videoTransforms
  })[0] : undefined
  const updateVideo = (key: 'scale' | 'x' | 'y', value: number) => {
    if (!Number.isFinite(value)) return
    const next = { ...videoTransform, [key]: clamp(value, key === 'scale' ? 0.1 : -0.5, key === 'scale' ? 1 : 0.5) }
    setVideoTransforms(current => ({ ...current, [videoId]: next }))
    setDirty(true)
  }
  useEffect(() => {
    const move = (event: PointerEvent) => {
      const d = drag.current
      const rect = stage.current?.getBoundingClientRect()
      if (!d || !rect) return
      const dx = (event.clientX - d.startX) / rect.width
      const dy = (event.clientY - d.startY) / rect.height
      setDirty(true)
      if (d.target.kind === 'photo') {
        const p = d.photo
        setPhoto(
          d.mode === 'move'
            ? { ...p, x: clamp(p.x + dx, 0, 1 - p.width), y: clamp(p.y + dy, 0, 1 - p.height) }
            : { ...p, width: clamp(p.width + dx, 0.1, 1 - p.x), height: clamp(p.height + dy, 0.1, 1 - p.y) }
        )
        return
      }
      const pl = d.placement
      const next: Placement =
        d.mode === 'move' ? { ...pl, x: clamp(pl.x + dx, -0.5, 1), y: clamp(pl.y + dy, -0.5, 1) } : { ...pl, scale: clamp(pl.scale + dx, 0.03, 1) }
      const id = d.target.id
      setOverlays((o) => ({ ...o, [id]: next }))
    }
    const up = () => {
      drag.current = null
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
  }, [])

  const start = (target: Target, mode: Drag['mode'], placement: Placement = { x: 0, y: 0, scale: 1 }) => (event: React.PointerEvent) => {
    event.preventDefault()
    event.stopPropagation()
    drag.current = { target, mode, startX: event.clientX, startY: event.clientY, photo, placement }
  }

  /** Alto relativo de un elemento ubicado por ancho, según su proporción. */
  const heightOf = (resource: AdminResource | undefined, scale: number) =>
    resource ? (scale * PREVIEW_OUTPUT.width * (resource.height / resource.width)) / PREVIEW_OUTPUT.height : scale * 0.5

  const save = () =>
    void onSave({
      id: campaign.id,
      photo,
      characterSlots: slots,
      freePlacement: { ...campaign.freePlacement, enabled: false },
      characterAnimation: animation,
      characterVideoTransforms: videoTransforms,
      overlays: Object.entries(overlays).map(([resourceId, p]) => ({ resourceId, ...p }))
    }).then(() => setDirty(false))

  const previewPhoto = scenario ? photo : CAMERA_PHOTO_REGION

  return (
    <Card title="Ubicación de los elementos">
      <p className="muted">
        Arrastre para mover y use la esquina inferior derecha para cambiar el tamaño. La zona punteada es donde aparecerá la persona. Los personajes conservan el
        cuadro completo de sus videos; puede reducirlos y desplazarlos con los controles de abajo.
      </p>
      <div className="aform__actions aform__actions--start">
        {(scenarios.length > 0 || campaign.allowCameraBackground) && <label className="inline">
          Escenario de vista previa
          <select value={scenarioId} onChange={(e) => setScenarioId(e.target.value)}>
            {campaign.allowCameraBackground && <option value={CAMERA_SCENARIO_ID}>Fondo real de la cámara</option>}
            {scenarios.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>}
        {frames.length > 0 && (
          <label className="inline">
            <input type="checkbox" checked={showFrame} onChange={(e) => setShowFrame(e.target.checked)} />
            Mostrar marco
          </label>
        )}
      </div>

      {!scenario && <Notice kind="info">{campaign.allowCameraBackground
        ? 'Fondo real de la cámara: puede ajustar los videos sin subir escenarios. La vista previa usa un fondo neutro y no enciende la cámara.'
        : 'Puede ajustar los videos sin un escenario. Para usar esta campaña, active «Fondo real de la cámara» en Datos o agregue un escenario.'}</Notice>}

      <div className="layout-stage" ref={stage} style={{ aspectRatio: `${PREVIEW_OUTPUT.width} / ${PREVIEW_OUTPUT.height}` }}>
        {scenario ? <img className="composition__fill" src={scenario.imageUrl} alt="" draggable={false} />
          : <div className="layout-camera-backdrop" aria-label="Vista previa con fondo neutro" />}

        <div
          className="layout-box layout-box--photo"
          aria-label={scenario ? 'Zona del participante' : 'Cámara a pantalla completa'}
          style={{ left: pct(previewPhoto.x), top: pct(previewPhoto.y), width: pct(previewPhoto.width), height: pct(previewPhoto.height) }}
          onPointerDown={scenario ? start({ kind: 'photo' }, 'move') : undefined}
        >
          {scenario && <span>Persona</span>}
          {scenario && <span className="layout-handle" onPointerDown={start({ kind: 'photo' }, 'resize')} />}
        </div>

        {video && videoPlacement && campaign.characterMode !== 'none' && <img
          className="layout-video-preview" src={video.imageUrl} alt={`Vista previa de ${video.name}`} draggable={false}
          style={{ left: pct(videoPlacement.posX), top: pct(videoPlacement.posY), width: pct(videoPlacement.scale), height: pct(heightOf(video, videoPlacement.scale)) }}
        />}
        {showFrame && frames[0] && <img className="composition__fill layout-frame" src={frames[0].imageUrl} alt="" draggable={false} />}

        {logos.map((logo) => {
          const p = overlays[logo.id] ?? { x: logo.x, y: logo.y, scale: logo.scale }
          return (
            <div
              key={logo.id}
              className="layout-box layout-box--logo"
              style={{ left: pct(p.x), top: pct(p.y), width: pct(p.scale), height: pct(heightOf(logo, p.scale)) }}
              onPointerDown={start({ kind: 'overlay', id: logo.id }, 'move', p)}
            >
              <img src={logo.imageUrl} alt="" draggable={false} />
              <span className="layout-handle" onPointerDown={start({ kind: 'overlay', id: logo.id }, 'resize', p)} />
            </div>
          )
        })}
      </div>

      {campaign.characterMode !== 'none' && videos.length > 0 && (
        <fieldset className="layout-video-controls aform">
          <legend>Ubicación y tamaño del video</legend>
          <label>Personaje que desea ajustar
            <select value={videoId} onChange={event => setVideoId(event.target.value)}>
              {videos.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </label>
          <p className="muted">El ajuste se guarda por personaje en esta campaña y se aplica al video completo y a su pose final. Al reducirlo, conserva el apoyo inferior del cuadro.</p>
          {(['scale', 'x', 'y'] as const).map(key => {
            const label = key === 'scale' ? 'Tamaño del video' : key === 'x' ? 'Desplazamiento horizontal' : 'Desplazamiento vertical'
            return <div className="layout-video-adjustment" key={key}>
              <label>{label} (%)
                <input type="number" min={key === 'scale' ? 10 : -50} max={key === 'scale' ? 100 : 50} step={1}
                  value={Math.round(videoTransform[key] * 100)} onChange={event => updateVideo(key, event.target.valueAsNumber / 100)} />
              </label>
              <input type="range" aria-label={label} min={key === 'scale' ? 10 : -50} max={key === 'scale' ? 100 : 50} step={1}
                value={Math.round(videoTransform[key] * 100)} onChange={event => updateVideo(key, Number(event.target.value) / 100)} />
            </div>
          })}
          <p className="muted">Horizontal: negativo hacia la izquierda. Vertical: negativo hacia arriba. 100 % conserva el tamaño original.</p>
          <button type="button" className="btn" onClick={() => {
            setVideoTransforms(current => { const next = { ...current }; delete next[videoId]; return next })
            setDirty(true)
          }}>Restablecer este video</button>
        </fieldset>
      )}
      {campaign.characterMode !== 'none' && (
        <div className="aform__actions aform__actions--start">
          <label className="inline">
            <input
              type="checkbox"
              checked={animation.enabled}
              onChange={(e) => { setAnimation({ ...animation, enabled: e.target.checked }); setDirty(true) }}
            />
            Animar la entrada antes de habilitar la foto
          </label>
          {animation.enabled && (
            <>
              <label className="inline">Entrada
                <input type="number" min={400} max={5000} step={100} value={animation.entryDurationMs}
                  onChange={(e) => { setAnimation({ ...animation, entryDurationMs: clamp(Number(e.target.value), 400, 5000) }); setDirty(true) }} /> ms
              </label>
              <label className="inline">Preparación
                <input type="number" min={150} max={2000} step={50} value={animation.prepareDurationMs}
                  onChange={(e) => { setAnimation({ ...animation, prepareDurationMs: clamp(Number(e.target.value), 150, 2000) }); setDirty(true) }} /> ms
              </label>
              <label className="inline">Separación
                <input type="number" min={0} max={1000} step={20} value={animation.staggerMs}
                  onChange={(e) => { setAnimation({ ...animation, staggerMs: clamp(Number(e.target.value), 0, 1000) }); setDirty(true) }} /> ms
              </label>
              <label className="inline">Inclinación
                <input type="number" min={0} max={4} step={0.1} value={animation.tiltDegrees}
                  onChange={(e) => { setAnimation({ ...animation, tiltDegrees: clamp(Number(e.target.value), 0, 4) }); setDirty(true) }} />°
              </label>
            </>
          )}
        </div>
      )}
      {campaign.characterMode !== 'none' && (
        <div className="aform__actions aform__actions--start">
          <span className="muted">Personajes permitidos por fotografía: {slots.length} de {MAX_CHARACTERS}</span>
          <button
            type="button"
            className="btn"
            disabled={slots.length >= MAX_CHARACTERS}
            onClick={() => {
              setSlots([...slots, { x: 0.36, y: 0.1, scale: 0.28 }])
              setDirty(true)
            }}
          >
            + Personaje
          </button>
          <button
            type="button"
            className="btn"
            disabled={slots.length <= 1}
            onClick={() => {
              setSlots(slots.slice(0, -1))
              setDirty(true)
            }}
          >
            − Quitar última
          </button>
        </div>
      )}
      <div className="aform__actions">
        {dirty && <span className="muted">Cambios sin guardar</span>}
        <button type="button" className="btn btn--primary" disabled={!dirty} onClick={save}>
          Guardar cambios
        </button>
      </div>
    </Card>
  )
}
