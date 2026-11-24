import { useCallback, useEffect, useState } from 'react'
import type { MaintenanceStatus } from '../../../../shared/admin'
import { ConfirmDialog } from '../../ui/ConfirmDialog'
import { errorMessage, useAdmin } from '../adminContext'
import { Card, formatDate, Notice } from '../ui'

/** Uso del almacenamiento, respaldo (RF-ALM-005) y conservación de datos (RF-FOT-005). */
export function MaintenanceCard(): React.JSX.Element {
  const { call, can } = useAdmin()
  const [status, setStatus] = useState<MaintenanceStatus | null>(null)
  const [includePhotos, setIncludePhotos] = useState(false)
  const [busy, setBusy] = useState(false)
  const [confirmRetention, setConfirmRetention] = useState(false)
  const [message, setMessage] = useState<{ kind: 'error' | 'ok' | 'info'; text: string } | null>(null)

  const load = useCallback(() => {
    call<MaintenanceStatus>('maintenance.status')
      .then(setStatus)
      .catch((e) => setMessage({ kind: 'error', text: errorMessage(e) }))
  }, [call])

  useEffect(load, [load])

  const backup = async () => {
    setBusy(true)
    setMessage({ kind: 'info', text: 'Elija la carpeta de destino (por ejemplo, una unidad USB)…' })
    try {
      const r = await call<{ saved: boolean; folder: string | null }>('maintenance.backup', { includePhotos })
      setMessage(r.saved ? { kind: 'ok', text: `Respaldo creado en ${r.folder}` } : { kind: 'info', text: 'Respaldo cancelado' })
      load()
    } catch (e) {
      setMessage({ kind: 'error', text: errorMessage(e) })
    } finally {
      setBusy(false)
    }
  }

  const runRetention = async () => {
    setConfirmRetention(false)
    try {
      const r = await call<{ photos: number; participations: number }>('maintenance.runRetention')
      setMessage({ kind: 'ok', text: `Se eliminaron ${r.photos} fotografía(s) y se anonimizaron ${r.participations} participación(es)` })
      load()
    } catch (e) {
      setMessage({ kind: 'error', text: errorMessage(e) })
    }
  }

  if (!status) return <Card title="Mantenimiento">{message ? <Notice kind={message.kind}>{message.text}</Notice> : 'Cargando…'}</Card>

  return (
    <Card title="Mantenimiento">
      <div className="stats">
        <div className="stat">
          <span className="stat__label">Base de datos</span>
          <strong className="stat__value">{status.databaseMb} MB</strong>
        </div>
        <div className="stat">
          <span className="stat__label">Contenido</span>
          <strong className="stat__value">{status.contentMb} MB</strong>
        </div>
        <div className="stat">
          <span className="stat__label">Fotografías</span>
          <strong className="stat__value">{status.photosMb} MB</strong>
        </div>
        <div className="stat">
          <span className="stat__label">Espacio libre</span>
          <strong className="stat__value">{status.freeDiskMb === null ? '—' : `${status.freeDiskMb.toLocaleString('es-PE')} MB`}</strong>
        </div>
      </div>
      <p className="muted">
        Datos en <code>{status.dataRoot}</code> · último respaldo: {formatDate(status.lastBackupAt)}
      </p>

      <fieldset className="agroup">
        <legend>Respaldo</legend>
        <p className="muted">
          Copia la base de datos, el contenido y la configuración (sin la clave del servicio). Contiene datos personales: guárdelo en un medio protegido (PD-011).
        </p>
        <label className="inline">
          <input type="checkbox" checked={includePhotos} onChange={(e) => setIncludePhotos(e.target.checked)} />
          Incluir fotografías de los participantes
        </label>
        <div className="aform__actions aform__actions--start">
          <button type="button" className="btn btn--primary" disabled={busy} onClick={() => void backup()}>
            Crear respaldo…
          </button>
        </div>
      </fieldset>

      <fieldset className="agroup">
        <legend>Conservación de datos</legend>
        <p>
          Estado: <strong>{status.retention.enabled ? 'activada' : 'desactivada hasta la aprobación de la política (PD-002)'}</strong>
        </p>
        <p className="muted">
          Con la política actual ({status.retention.photoDays} días para fotografías, {status.retention.personalDataDays} días para nombres y DNI), alcanzaron el plazo{' '}
          {status.retentionPreview.photos} fotografía(s) y {status.retentionPreview.participations} participación(es). Las fotos sin aviso previo esperan al menos 24 horas antes de eliminarse.
        </p>
        <p className="muted">Las fotografías necesitan un aviso registrado al menos 24 horas antes de su eliminación. Al actualizar, los archivos antiguos reciben ese margen. Revise las publicaciones pendientes antes de que venza el plazo. No se modifican campañas, personajes, modelos ni respaldos externos.</p>
        {status.retention.enabled && can('settings.general') && (
          <button type="button" className="btn btn--danger" onClick={() => setConfirmRetention(true)}>
            Aplicar ahora
          </button>
        )}
      </fieldset>

      {message && <Notice kind={message.kind}>{message.text}</Notice>}
      {confirmRetention && (
        <ConfirmDialog
          title="¿Aplicar la conservación?"
          message="Se eliminarán fotografías y datos personales antiguos de forma irreversible."
          cancelLabel="Cancelar"
          confirmLabel="Aplicar"
          onCancel={() => setConfirmRetention(false)}
          onConfirm={() => void runRetention()}
        />
      )}
    </Card>
  )
}
