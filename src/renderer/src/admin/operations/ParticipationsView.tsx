import { useEffect, useRef, useState } from 'react'
import type { AdminPhotoQr, DeletionResult, ParticipationDetail, ParticipationFilters, ParticipationPage } from '../../../../shared/admin'
import { errorMessage, useAdmin } from '../adminContext'
import { Card, formatDate, Notice } from '../ui'
import { EMPTY_FILTERS, ParticipationFiltersBar, PHOTO_TEXT, STATUS_TEXT } from './ParticipationFiltersBar'

/** Consulta de participaciones con filtros y paginación (RF-PAR-001, RF-PAR-002). */
export function ParticipationsView(): React.JSX.Element {
  const { call } = useAdmin()
  const [filters, setFilters] = useState<ParticipationFilters>(EMPTY_FILTERS)
  const [page, setPage] = useState(1)
  const [data, setData] = useState<ParticipationPage | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    call<ParticipationPage>('participations.list', { ...filters, page })
      .then((d) => {
        setData(d)
        setError(null)
      })
      .catch((e) => setError(errorMessage(e)))
  }, [call, filters, page, selected])

  if (selected) return <ParticipationDetailView id={selected} onBack={() => setSelected(null)} />

  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1

  return (
    <div className="astack">
      <Card title="Participaciones">
        <ParticipationFiltersBar
          value={filters}
          onChange={(f) => {
            setFilters(f)
            setPage(1)
          }}
          campaigns={data?.campaigns ?? []}
          allowDni={data?.personal ?? false}
        />
        {error && <Notice kind="error">{error}</Notice>}
        {data && (
          <>
            <p className="muted">
              {data.total} participación(es) · página {page} de {pages}
              {!data.personal && ' · sin datos personales (según su rol)'}
            </p>
            <div className="table-wrap">
              <table className="atable">
                <thead>
                  <tr>
                    <th>Inicio</th>
                    <th>Campaña</th>
                    {data.personal && <th>Participante</th>}
                    <th>Estado</th>
                    <th>Fotografía</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((p) => (
                    <tr key={p.id} onClick={() => setSelected(p.id)} className="clickable">
                      <td>{formatDate(p.startedAt)}</td>
                      <td>{p.campaignName}</td>
                      {data.personal && <td>{p.fullName ?? '—'}</td>}
                      <td>{STATUS_TEXT[p.status] ?? p.status}</td>
                      <td>{PHOTO_TEXT[p.photoStatus] ?? p.photoStatus}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="aform__actions">
              <button type="button" className="btn" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                ‹ Anterior
              </button>
              <button type="button" className="btn" disabled={page >= pages} onClick={() => setPage(page + 1)}>
                Siguiente ›
              </button>
            </div>
          </>
        )}
      </Card>
    </div>
  )
}

/** Detalle con selecciones, consentimientos, fotografías y acciones permitidas (RF-PAR-003, 8.17). */
function ParticipationDetailView({ id, onBack }: { id: string; onBack: () => void }): React.JSX.Element {
  const { call, can } = useAdmin()
  const [detail, setDetail] = useState<ParticipationDetail | null>(null)
  const [image, setImage] = useState<string | null>(null)
  const [message, setMessage] = useState<{ kind: 'error' | 'ok' | 'info'; text: string } | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [reason, setReason] = useState('')
  const [qr, setQr] = useState<AdminPhotoQr | null>(null)
  const [busyPhoto, setBusyPhoto] = useState<string | null>(null)
  const qrRef = useRef<HTMLElement | null>(null)
  useEffect(() => {
    if (!qr) return
    const frame = requestAnimationFrame(() => qrRef.current?.scrollIntoView({ block: 'center' }))
    const timer = setTimeout(() => setQr(null), Math.min(90_000, Math.max(0, Date.parse(qr.expiresAt) - Date.now())))
    return () => { clearTimeout(timer); cancelAnimationFrame(frame) }
  }, [qr])

  const load = () =>
    call<ParticipationDetail>('participations.get', { id })
      .then(setDetail)
      .catch((e) => setMessage({ kind: 'error', text: errorMessage(e) }))

  useEffect(() => {
    void load()
  }, [id]) // Al abrir.

  if (!detail) return <p>{message?.text ?? 'Cargando…'}</p>

  const retry = async (photoId: string) => {
    setQr(null)
    setBusyPhoto(photoId)
    setMessage({ kind: 'info', text: 'Reintentando la publicación…' })
    try {
      const result = await call<{ published: boolean }>('publication.retry', { photoId })
      setMessage(result.published ? { kind: 'ok', text: 'Fotografía publicada' } : { kind: 'error', text: 'No se pudo publicar; quedó en cola para reintentos' })
      void load()
      if (result.published && can('publication.qr')) setQr(await call<AdminPhotoQr>('publication.qr', { photoId }))
    } catch (e) {
      setMessage({ kind: 'error', text: errorMessage(e) })
    } finally {
      setBusyPhoto(null)
    }
  }

  const showQr = async (photoId: string) => {
    setQr(null)
    setBusyPhoto(photoId)
    try { setQr(await call<AdminPhotoQr>('publication.qr', { photoId })) }
    catch (e) { setMessage({ kind: 'error', text: errorMessage(e) }) }
    finally { setBusyPhoto(null) }
  }

  const remove = async () => {
    try {
      const r = await call<DeletionResult>('participations.delete', { id, reason })
      setDeleting(false)
      setImage(null)
      setQr(null)
      setMessage({
        kind: r.remotePending > 0 ? 'error' : 'ok',
        text:
          `Datos eliminados: ${r.localPhotosDeleted} archivo(s) local(es), ${r.remoteDeleted} copia(s) publicada(s).` +
          (r.remotePending > 0 ? ` ${r.remotePending} copia(s) publicada(s) no se pudieron eliminar ahora; vencerán en su plazo.` : '')
      })
      void load()
    } catch (e) {
      setMessage({ kind: 'error', text: errorMessage(e) })
    }
  }

  return (
    <div className="astack">
      <div className="aform__actions aform__actions--start">
        <button type="button" className="btn" onClick={onBack}>
          ‹ Participaciones
        </button>
      </div>
      {message && <Notice kind={message.kind}>{message.text}</Notice>}
      <Card title="Participación">
        <dl className="adl">
          <dt>Identificador</dt>
          <dd>
            <code>{detail.id}</code>
          </dd>
          <dt>Campaña</dt>
          <dd>{detail.campaignName}</dd>
          {detail.fullName !== null || detail.dni !== null ? (
            <>
              <dt>Participante</dt>
              <dd>
                {detail.fullName ?? '—'} · DNI {detail.dni ?? '—'}
              </dd>
            </>
          ) : null}
          <dt>Estado</dt>
          <dd>{STATUS_TEXT[detail.status] ?? detail.status}</dd>
          <dt>Inicio · confirmación · fin</dt>
          <dd>
            {formatDate(detail.startedAt)} · {formatDate(detail.confirmedAt)} · {formatDate(detail.finishedAt)}
          </dd>
          <dt>Selección</dt>
          <dd>
            {detail.selections.scenario ?? '—'}
            {detail.selections.characters.length > 0 && ` · ${detail.selections.characters.join(', ')}`}
            {detail.selections.frame && ` · ${detail.selections.frame}`}
          </dd>
        </dl>
      </Card>
      <Card title="Consentimientos">
        <ul className="alerts">
          {detail.consents.map((c) => (
            <li key={c.type}>
              {c.title} (versión {c.version}): {c.accepted ? 'aceptado' : 'no aceptado'} el {formatDate(c.recordedAt)}
            </li>
          ))}
        </ul>
      </Card>
      <Card title="Fotografías">
        {detail.photos.length === 0 && <Notice kind="info">Sin fotografías.</Notice>}
        <ul className="alist">
          {detail.photos.map((p) => (
            <li key={p.id} className="aitem">
              <div className="aitem__body">
                <strong>
                  {p.kind === 'final' ? 'Composición final' : 'Captura original'} · {PHOTO_TEXT[p.status] ?? p.status}
                </strong>
                <span className="muted">
                  {p.width && p.height ? `${p.width} × ${p.height} px · ` : ''}creada {formatDate(p.createdAt)}
                  {p.publishedAt && ` · publicada ${formatDate(p.publishedAt)}`}
                  {p.expiresAt && ` · vence ${formatDate(p.expiresAt)}`}
                  {p.tokenHint && ` · token ${p.tokenHint}`}
                </span>
                {p.queue && (
                  <span className="muted">
                    Cola: {p.queue.status}, {p.queue.attempts} intento(s){p.queue.lastError && `, último error: ${p.queue.lastError}`}
                  </span>
                )}
                {p.retentionWarning && <Notice kind="error">{p.retentionWarning}</Notice>}
                <div className="aitem__row">
                  {can('participations.personal') && p.localAvailable && p.status !== 'deleted' && (
                    <button type="button" className="btn btn--small" onClick={() => void call<string>('participations.photo', { photoId: p.id }).then(setImage)}>
                      Ver fotografía
                    </button>
                  )}
                  {can('publication.retry') && p.kind === 'final' && (p.status === 'pending' || p.status === 'failed') && (
                    <button type="button" className="btn" disabled={busyPhoto !== null} onClick={() => void retry(p.id)}>
                      Reintentar publicación
                    </button>
                  )}
                  {can('publication.qr') && p.kind === 'final' && p.status === 'published' && p.expiresAt && Date.parse(p.expiresAt) > Date.now() && (
                    <button type="button" className="btn" disabled={busyPhoto !== null} onClick={() => void showQr(p.id)}>Mostrar QR</button>
                  )}
                </div>
                {qr?.photoId === p.id && (
                  <section ref={qrRef} className="admin-photo-qr" aria-label="QR de descarga de la fotografía">
                    <strong>Escanee con su teléfono para descargar su fotografía</strong>
                    <img src={qr.qrDataUrl} alt="Código QR de descarga" width={480} height={480} style={{ width: 'min(100%, 480px)', height: 'auto', display: 'block', margin: '16px auto' }} />
                    <p>Disponible hasta {formatDate(qr.expiresAt)}. Quien tenga este QR puede acceder a la fotografía.</p>
                    <button type="button" className="btn" onClick={() => setQr(null)}>Ocultar QR</button>
                  </section>
                )}
              </div>
            </li>
          ))}
        </ul>
        {image && <img className="photo-preview" src={image} alt="Fotografía" />}
      </Card>
      {can('participations.delete') && detail.status !== 'anonymized' && (
        <Card title="Solicitud de eliminación">
          <p className="muted">
            Elimina nombres, DNI y fotografías (incluida la copia publicada). Se conserva la constancia técnica y la evidencia del consentimiento. Revise también los
            respaldos según la política aprobada.
          </p>
          {!deleting ? (
            <button type="button" className="btn btn--danger" onClick={() => setDeleting(true)}>
              Eliminar datos de esta participación
            </button>
          ) : (
            <div className="aform">
              <label className="afield">
                <span className="afield__label">Motivo o referencia de la solicitud (sin datos personales)</span>
                <input value={reason} onChange={(e) => setReason(e.target.value)} />
              </label>
              <div className="aform__actions">
                <button type="button" className="btn" onClick={() => setDeleting(false)}>
                  Cancelar
                </button>
                <button type="button" className="btn btn--danger" disabled={reason.trim().length < 3} onClick={() => void remove()}>
                  Confirmar eliminación
                </button>
              </div>
            </div>
          )}
        </Card>
      )}
    </div>
  )
}
