import { useEffect, useState } from 'react'
import type { AdminCampaign, AdminResource } from '../../../../shared/admin'
import type { SelectionMode } from '../../../../shared/campaign'
import { ConfirmDialog } from '../../ui/ConfirmDialog'
import { errorMessage, useAdmin } from '../adminContext'
import { Card, Field, fromLocalInput, Notice, toLocalInput } from '../ui'
import { STATUS_LABEL } from './CampaignsView'
import { LayoutEditor } from './LayoutEditor'

type Tab = 'data' | 'scenarios' | 'frames' | 'layout'

const MODE_LABEL: Record<SelectionMode, string> = { required: 'Obligatorio', optional: 'Opcional', none: 'No se usa' }

interface Message {
  kind: 'error' | 'ok' | 'info'
  text: string
}

/** Edición de una campaña: datos, estado, escenarios con sus personajes, marcos, logotipos y ubicación. */
export function CampaignEditor({ id, onBack }: { id: string; onBack: () => void }): React.JSX.Element {
  const { call } = useAdmin()
  const [campaign, setCampaign] = useState<AdminCampaign | null>(null)
  const [tab, setTab] = useState<Tab>('data')
  const [message, setMessage] = useState<Message | null>(null)
  const [removing, setRemoving] = useState<AdminResource | null>(null)

  /** Ejecuta una operación que devuelve la campaña actualizada. */
  const run = async (method: Parameters<typeof call>[0], payload: unknown, ok?: string) => {
    try {
      const result = await call<AdminCampaign | { campaign: AdminCampaign; archived: boolean } | null>(method, payload)
      if (!result) return
      if ('archived' in result) {
        setCampaign(result.campaign)
        setMessage({ kind: 'ok', text: result.archived ? 'El recurso fue usado en participaciones: se archivó en lugar de eliminarse' : 'Recurso eliminado' })
      } else {
        setCampaign(result)
        if (ok) setMessage({ kind: 'ok', text: ok })
      }
    } catch (error) {
      setMessage({ kind: 'error', text: errorMessage(error) })
    }
  }

  useEffect(() => {
    void run('campaigns.get', { id })
  }, [id]) // Al abrir la campaña.

  if (!campaign) return <p>{message?.text ?? 'Cargando…'}</p>

  const of = (type: AdminResource['type']) => campaign.resources.filter((r) => r.type === type)

  return (
    <div className="astack">
      <div className="aform__actions aform__actions--start">
        <button type="button" className="btn" onClick={onBack}>
          ‹ Campañas
        </button>
        <h1 className="editor-title">
          {campaign.name} <span className={`tag tag--${campaign.status}`}>{STATUS_LABEL[campaign.status]}</span>
        </h1>
      </div>

      <StatusCard campaign={campaign} run={run} />

      <nav className="admin__nav admin__nav--sub">
        {(
          [
            ['data', 'Datos'],
            ['scenarios', 'Escenarios y personajes'],
            ['frames', 'Marcos y logotipos'],
            ['layout', 'Ubicación']
          ] as const
        ).map(([key, label]) => (
          <button key={key} type="button" className="tab" aria-pressed={tab === key} onClick={() => setTab(key)}>
            {label}
          </button>
        ))}
      </nav>

      {message && <Notice kind={message.kind}>{message.text}</Notice>}

      {tab === 'data' && <DataForm campaign={campaign} run={run} />}

      {tab === 'scenarios' && (
        <Card
          title="Escenarios y personajes"
          actions={
            <button type="button" className="btn btn--primary" onClick={() => void run('resources.add', { campaignId: id, type: 'scenario' }, 'Escenario agregado')}>
              + Agregar escenario
            </button>
          }
        >
          <p className="muted">
            Fondo a pantalla completa (JPG, PNG o WebP). Para un personaje puede subir PNG, WebP, GIF, MP4 o WebM. En videos y GIF se extrae automáticamente la pose final y se elimina el fondo.
          </p>
          {campaign.characterMode === 'none' && of('character').length > 0 && (
            <Notice kind="error">
              Esta campaña tiene «Personajes: No se usa», así que el público no verá estos personajes. Cámbielo a Obligatorio u
              Opcional en{' '}
              <button type="button" className="btn btn--small" onClick={() => setTab('data')}>
                Datos
              </button>
            </Notice>
          )}
          {campaign.allowCameraBackground && (
            <div className="scenario scenario--camera">
              <div>
                <strong>Fondo real de la cámara</strong>
                <p className="muted">
                  No necesita subir un escenario. Todos los personajes activos de esta campaña se ofrecerán sobre la imagen real de la cámara.
                </p>
              </div>
              <div className="scenario__characters">
                <strong>Personajes para el fondo real</strong>
                <div className="chips">
                  {of('character').map((character) => (
                    <span key={character.id} className={`chip${character.active ? '' : ' chip--off'}`}>
                      <img src={character.imageUrl} alt="" />
                      {character.name}
                    </span>
                  ))}
                </div>
                <button
                  type="button"
                  className="btn btn--primary"
                  onClick={() => void run('resources.add', { campaignId: id, type: 'character', scenarioIds: [] }, 'Personaje agregado')}
                >
                  + Agregar personaje
                </button>
              </div>
            </div>
          )}
          {of('scenario').length === 0 && !campaign.allowCameraBackground && <Notice kind="info">Agregue el primer escenario.</Notice>}
          {of('scenario').map((scenario, index, list) => (
            <div key={scenario.id} className="scenario">
              <ResourceRow resource={scenario} first={index === 0} last={index === list.length - 1} campaignId={id} run={run} onRemove={setRemoving} />
              <div className="scenario__characters">
                <strong>Personajes de este escenario</strong>
                <div className="chips">
                  {of('character')
                    .filter((c) => c.scenarioIds.includes(scenario.id))
                    .map((c) => (
                      <span key={c.id} className={`chip${c.active ? '' : ' chip--off'}`}>
                        <img src={c.imageUrl} alt="" />
                        {c.name}
                      </span>
                    ))}
                </div>
                <button
                  type="button"
                  className="btn btn--small"
                  onClick={() => void run('resources.add', { campaignId: id, type: 'character', scenarioIds: [scenario.id] }, 'Personaje agregado')}
                >
                  + Agregar personaje a este escenario
                </button>
              </div>
            </div>
          ))}
          {of('character').length > 0 && (
            <>
              <h3>Personajes</h3>
              <p className="muted">
                {campaign.allowCameraBackground
                  ? 'Todos se ofrecen con el fondo real. Además, puede marcar los escenarios adicionales donde aparecerá cada personaje.'
                  : 'Marque en qué escenarios se ofrece cada personaje.'}
              </p>
              {of('character').map((c, index, list) => (
                <ResourceRow
                  key={c.id}
                  resource={c}
                  first={index === 0}
                  last={index === list.length - 1}
                  campaignId={id}
                  run={run}
                  onRemove={setRemoving}
                  scenarios={of('scenario')}
                />
              ))}
            </>
          )}
        </Card>
      )}

      {tab === 'frames' && (
        <>
          <Card
            title="Marcos"
            actions={
              <button type="button" className="btn btn--primary" onClick={() => void run('resources.add', { campaignId: id, type: 'frame' }, 'Marco agregado')}>
                + Agregar marco
              </button>
            }
          >
            <p className="muted">Imagen del tamaño de la foto final con el centro transparente (PNG o WebP).</p>
            {of('frame').map((r, index, list) => (
              <ResourceRow key={r.id} resource={r} first={index === 0} last={index === list.length - 1} campaignId={id} run={run} onRemove={setRemoving} />
            ))}
          </Card>
          <Card
            title="Logotipos y elementos fijos"
            actions={
              <button type="button" className="btn btn--primary" onClick={() => void run('resources.add', { campaignId: id, type: 'logo' }, 'Logotipo agregado')}>
                + Agregar logotipo
              </button>
            }
          >
            <p className="muted">Se aplican siempre a la foto. Su posición se ajusta en «Ubicación».</p>
            {of('logo').map((r, index, list) => (
              <ResourceRow key={r.id} resource={r} first={index === 0} last={index === list.length - 1} campaignId={id} run={run} onRemove={setRemoving} />
            ))}
          </Card>
        </>
      )}

      {tab === 'layout' && <LayoutEditor campaign={campaign} onSave={(payload) => run('campaigns.saveLayout', payload, 'Ubicación guardada')} />}

      {removing && (
        <ConfirmDialog
          title="¿Quitar este recurso?"
          message={`"${removing.name}" dejará de ofrecerse. Si ya se usó en participaciones, se archivará para conservar el historial.`}
          cancelLabel="Cancelar"
          confirmLabel="Quitar"
          onCancel={() => setRemoving(null)}
          onConfirm={() => {
            void run('resources.remove', { campaignId: id, resourceId: removing.id })
            setRemoving(null)
          }}
        />
      )}
    </div>
  )
}

type Run = (method: Parameters<ReturnType<typeof useAdmin>['call']>[0], payload: unknown, ok?: string) => Promise<void>

/** Estado de la campaña y validación previa a la activación (RF-CAM-002, RF-CAM-003). */
function StatusCard({ campaign, run }: { campaign: AdminCampaign; run: Run }): React.JSX.Element {
  const setStatus = (status: 'active' | 'inactive' | 'archived', ok: string) => void run('campaigns.setStatus', { id: campaign.id, status }, ok)
  return (
    <Card title="Estado">
      {campaign.problems.length > 0 ? (
        <>
          <Notice kind="error">
            {campaign.status === 'active'
              ? 'Está activa, pero no se muestra al público hasta resolver lo siguiente:'
              : 'Para activarla falta:'}
          </Notice>
          <ul className="alerts">
            {campaign.problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </>
      ) : (
        <Notice kind="ok">La campaña está completa y puede mostrarse al público.</Notice>
      )}
      <div className="aform__actions aform__actions--start">
        {campaign.status !== 'active' && (
          <button type="button" className="btn btn--primary" disabled={campaign.problems.length > 0} onClick={() => setStatus('active', 'Campaña activada')}>
            Activar
          </button>
        )}
        {campaign.status === 'active' && (
          <button type="button" className="btn" onClick={() => setStatus('inactive', 'Campaña desactivada')}>
            Desactivar
          </button>
        )}
        {campaign.status !== 'archived' && (
          <button type="button" className="btn" onClick={() => setStatus('archived', 'Campaña archivada')}>
            Archivar
          </button>
        )}
      </div>
      <p className="muted">
        Las campañas no se eliminan: se desactivan o archivan para conservar el historial ({campaign.participations} participación(es)).
      </p>
    </Card>
  )
}

function DataForm({ campaign, run }: { campaign: AdminCampaign; run: Run }): React.JSX.Element {
  const [form, setForm] = useState({
    name: campaign.name,
    description: campaign.description,
    startsAt: toLocalInput(campaign.startsAt),
    endsAt: toLocalInput(campaign.endsAt),
    characterMode: campaign.characterMode,
    frameMode: campaign.frameMode,
    allowCameraBackground: campaign.allowCameraBackground
  })
  const save = () =>
    void run(
      'campaigns.update',
      { id: campaign.id, ...form, startsAt: fromLocalInput(form.startsAt), endsAt: fromLocalInput(form.endsAt) },
      'Datos guardados'
    )
  const modeSelect = (key: 'characterMode' | 'frameMode') => (
    <select value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value as SelectionMode })}>
      {(Object.keys(MODE_LABEL) as SelectionMode[]).map((m) => (
        <option key={m} value={m}>
          {MODE_LABEL[m]}
        </option>
      ))}
    </select>
  )

  return (
    <Card title="Datos de la campaña">
      <div className="aform">
        <Field label="Nombre">
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </Field>
        <Field label="Descripción breve" hint="Se muestra al público al elegir la experiencia">
          <textarea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </Field>
        <div className="arow">
          <Field label="Vigente desde" hint="Vacío: sin fecha de inicio">
            <input type="datetime-local" value={form.startsAt} onChange={(e) => setForm({ ...form, startsAt: e.target.value })} />
          </Field>
          <Field label="Vigente hasta" hint="Vacío: sin fecha de fin">
            <input type="datetime-local" value={form.endsAt} onChange={(e) => setForm({ ...form, endsAt: e.target.value })} />
          </Field>
        </div>
        <div className="arow">
          <Field label="Personajes">{modeSelect('characterMode')}</Field>
          <Field label="Marco">{modeSelect('frameMode')}</Field>
        </div>
        <label className="inline">
          <input
            type="checkbox"
            checked={form.allowCameraBackground}
            onChange={(e) => setForm({ ...form, allowCameraBackground: e.target.checked })}
          />
          Permitir «Usar fondo real de la cámara»
        </label>
        <p className="muted">
          La fotografía ocupará todo el formato 9:16. Los personajes de video conservarán su recorte y se mostrarán encima.
        </p>
        <div className="aform__actions">
          <button type="button" className="btn btn--primary" onClick={save}>
            Guardar datos
          </button>
        </div>
        <Field
          label="Imagen de presentación (opcional)"
          hint="Fondo de la tarjeta al elegir la experiencia: horizontal (unos 1600 × 860 px) y sin textos; el nombre y la descripción los pone la aplicación. Sin imagen, se usa la del primer escenario."
        >
          <div className="aitem__row">
            {campaign.imageUrl ? <img className="cover" src={campaign.imageUrl} alt="" /> : <span className="muted">Sin imagen</span>}
            <button type="button" className="btn" onClick={() => void run('campaigns.setImage', { id: campaign.id }, 'Imagen actualizada')}>
              Elegir imagen…
            </button>
          </div>
        </Field>
      </div>
    </Card>
  )
}

interface ResourceRowProps {
  resource: AdminResource
  first: boolean
  last: boolean
  campaignId: string
  run: Run
  onRemove: (resource: AdminResource) => void
  /** Para personajes: escenarios donde se puede ofrecer. */
  scenarios?: AdminResource[]
}

function ResourceRow({ resource, first, last, campaignId, run, onRemove, scenarios }: ResourceRowProps): React.JSX.Element {
  const update = (changes: { name?: string; active?: boolean; scenarioIds?: string[] }) =>
    void run('resources.update', {
      campaignId,
      resourceId: resource.id,
      name: changes.name ?? resource.name,
      active: changes.active ?? resource.active,
      ...(changes.scenarioIds ? { scenarioIds: changes.scenarioIds } : {})
    })
  const updateMotion = (changes: { entryDirection?: AdminResource['entryDirection']; anchorX?: number; anchorY?: number }) =>
    void run('resources.updateMotion', {
      campaignId,
      resourceId: resource.id,
      entryDirection: changes.entryDirection ?? resource.entryDirection,
      anchorX: changes.anchorX ?? resource.anchorX,
      anchorY: changes.anchorY ?? resource.anchorY
    }, 'Movimiento actualizado')

  return (
    <div className={`aitem${resource.active ? '' : ' aitem--off'}`}>
      <div
        className={`aitem__thumb${resource.type === 'character' || resource.type === 'logo' || resource.type === 'frame' || resource.photoHole ? ' aitem__thumb--alpha' : ''}`}
      >
        {resource.photoHole ? (
          // La zona se dibuja sobre la imagen con su misma proporción.
          <span className="aitem__frame" style={{ aspectRatio: `${resource.width} / ${resource.height}` }}>
            <img src={resource.imageUrl} alt="" />
            <span
              className="aitem__hole"
              title="Zona transparente: aquí irá la foto"
              style={{
                left: `${resource.photoHole.x * 100}%`,
                top: `${resource.photoHole.y * 100}%`,
                width: `${resource.photoHole.width * 100}%`,
                height: `${resource.photoHole.height * 100}%`
              }}
            />
          </span>
        ) : resource.type === 'character' && resource.animationUrl && resource.animationBackground !== 'alpha' ? (
          <img src={resource.imageUrl} alt={`Pose final de ${resource.name}`} />
        ) : resource.type === 'character' && resource.animationUrl?.toLowerCase().endsWith('.gif') ? (
          <img src={resource.animationUrl} alt={`Animación de ${resource.name}`} />
        ) : resource.type === 'character' && resource.animationUrl ? (
          <video src={resource.animationUrl} poster={resource.imageUrl} autoPlay loop muted playsInline aria-label={`Animación de ${resource.name}`} />
        ) : (
          <img src={resource.imageUrl} alt="" />
        )}
      </div>
      <div className="aitem__body">
        <input defaultValue={resource.name} aria-label="Nombre" onBlur={(e) => e.target.value !== resource.name && update({ name: e.target.value })} />
        <div className="aitem__row">
          <span className="muted">
            {resource.width} × {resource.height} px
          </span>
          {resource.photoHole && <span className="tag tag--active">La foto irá en la zona transparente</span>}
          {resource.type === 'character' && (
            <span className={`tag${resource.animationUrl ? ' tag--active' : ''}`}>
              {resource.animationUrl
                ? resource.animationUrl.toLowerCase().endsWith('.gif')
                  ? 'GIF animado'
                  : `Video · ${resource.animationBackground === 'chroma' ? 'croma automático' : resource.animationBackground === 'segmentation' ? 'recorte automático' : 'transparente'}`
                : 'Movimiento automático'}
            </span>
          )}
          <label className="inline">
            <input type="checkbox" checked={resource.active} onChange={(e) => update({ active: e.target.checked })} />
            {resource.active ? 'Activo' : 'Inactivo'}
          </label>
        </div>
        {scenarios && (
          <div className="aitem__row">
            {scenarios.map((s) => (
              <label key={s.id} className="inline">
                <input
                  type="checkbox"
                  checked={resource.scenarioIds.includes(s.id)}
                  onChange={(e) =>
                    update({ scenarioIds: e.target.checked ? [...resource.scenarioIds, s.id] : resource.scenarioIds.filter((x) => x !== s.id) })
                  }
                />
                {s.name}
              </label>
            ))}
          </div>
        )}
        {resource.type === 'character' && (
          <div className="aitem__row">
            <label className="inline">Entrada
              <select value={resource.entryDirection} onChange={(e) => updateMotion({ entryDirection: e.target.value as AdminResource['entryDirection'] })}>
                <option value="auto">Automática</option>
                <option value="left">Desde la izquierda</option>
                <option value="right">Desde la derecha</option>
              </select>
            </label>
            <label className="inline">Apoyo horizontal
              <input type="number" min={0} max={100} step={1} defaultValue={Math.round(resource.anchorX * 100)}
                onBlur={(e) => updateMotion({ anchorX: Math.min(1, Math.max(0, Number(e.target.value) / 100)) })} />%
            </label>
            <label className="inline">Apoyo vertical
              <input type="number" min={0} max={100} step={1} defaultValue={Math.round(resource.anchorY * 100)}
                onBlur={(e) => updateMotion({ anchorY: Math.min(1, Math.max(0, Number(e.target.value) / 100)) })} />%
            </label>
          </div>
        )}
        {resource.type === 'character' && (
          <div className="aitem__row">
            <button
              type="button"
              className="btn btn--small"
              onClick={() => void run('resources.setAnimation', { campaignId, resourceId: resource.id }, resource.animationUrl ? 'Animación reemplazada' : 'Animación agregada')}
            >
              {resource.animationUrl ? 'Reemplazar animación' : 'Agregar animación WebM'}
            </button>
            {resource.animationUrl && (
              <button
                type="button"
                className="btn btn--small"
                onClick={() => void run('resources.clearAnimation', { campaignId, resourceId: resource.id }, 'Se usará el movimiento automático')}
              >
                Quitar animación
              </button>
            )}
          </div>
        )}
      </div>
      <div className="aitem__tools">
        <button type="button" className="btn btn--icon" disabled={first} aria-label="Subir" onClick={() => void run('resources.move', { campaignId, resourceId: resource.id, direction: 'up' })}>
          ↑
        </button>
        <button type="button" className="btn btn--icon" disabled={last} aria-label="Bajar" onClick={() => void run('resources.move', { campaignId, resourceId: resource.id, direction: 'down' })}>
          ↓
        </button>
        <button type="button" className="btn btn--danger" onClick={() => onRemove(resource)}>
          Quitar
        </button>
      </div>
    </div>
  )
}
