import { useCallback, useEffect, useState } from 'react'
import type { DashboardData } from '../../../shared/admin'
import { errorMessage, useAdmin } from './adminContext'
import { Card, formatDate, Notice } from './ui'

const CONNECTIVITY: Record<DashboardData['connectivity'], { text: string; tone: 'ok' | 'warn' | 'bad' }> = {
  online: { text: 'Conectado', tone: 'ok' },
  offline: { text: 'Sin acceso', tone: 'bad' },
  not_configured: { text: 'No configurado', tone: 'warn' },
  unknown: { text: 'Comprobando…', tone: 'warn' }
}

function Stat({ label, value, note, tone }: { label: string; value: string | number; note?: string; tone?: 'ok' | 'warn' | 'bad' }) {
  return (
    <div className={`stat${tone ? ` stat--${tone}` : ''}`}>
      <span className="stat__label">{label}</span>
      <strong className="stat__value">{value}</strong>
      {note && <span className="stat__note">{note}</span>}
    </div>
  )
}

/** Resumen y estado técnico (8.12), actualizado cada 15 segundos. */
export function DashboardView(): React.JSX.Element {
  const { call } = useAdmin()
  const [data, setData] = useState<DashboardData | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    call<DashboardData>('dashboard.get')
      .then((d) => {
        setData(d)
        setError(null)
      })
      .catch((e) => setError(errorMessage(e)))
  }, [call])

  useEffect(() => {
    load()
    const timer = setInterval(load, 15_000)
    return () => clearInterval(timer)
  }, [load])

  if (error) return <Notice kind="error">{error}</Notice>
  if (!data) return <p>Cargando…</p>

  const connectivity = CONNECTIVITY[data.connectivity]
  const diskTone = data.freeDiskMb === null ? 'warn' : data.freeDiskMb < data.warnFreeMb ? 'bad' : 'ok'

  return (
    <div className="astack">
      <Card title="Alertas" actions={<button type="button" className="btn" onClick={load}>Actualizar</button>}>
        {data.alerts.length === 0 ? (
          <Notice kind="ok">Sin alertas. El tótem opera con normalidad.</Notice>
        ) : (
          <ul className="alerts">
            {data.alerts.map((a) => (
              <li key={a}>⚠ {a}</li>
            ))}
          </ul>
        )}
      </Card>
      <Card title="Participaciones">
        <div className="stats">
          <Stat label="Hoy" value={data.participationsToday} note="iniciadas desde las 00:00 (Lima)" />
          <Stat label="Completadas hoy" value={data.completedToday} />
          <Stat label="Total histórico" value={data.participationsTotal} />
          <Stat label="Campañas disponibles" value={`${data.availableCampaigns} de ${data.activeCampaigns}`} note="visibles / activas" />
        </div>
      </Card>
      <Card title="Estado técnico">
        <div className="stats">
          <Stat label="Servicio de publicación" value={connectivity.text} tone={connectivity.tone} />
          <Stat label="Publicaciones pendientes" value={data.pendingPublications} tone={data.pendingPublications > 0 ? 'warn' : 'ok'} />
          <Stat label="Publicaciones fallidas" value={data.failedPublications} tone={data.failedPublications > 0 ? 'bad' : 'ok'} />
          <Stat
            label="Espacio libre"
            value={data.freeDiskMb === null ? 'Desconocido' : `${data.freeDiskMb.toLocaleString('es-PE')} MB`}
            tone={diskTone}
            note={`advertencia bajo ${data.warnFreeMb.toLocaleString('es-PE')} MB`}
          />
          <Stat label="Errores (24 h)" value={data.errorsLast24h} tone={data.errorsLast24h > 0 ? 'warn' : 'ok'} />
          <Stat label="Último problema de cámara" value={formatDate(data.lastCameraProblemAt)} />
        </div>
        <p className="muted">Actualizado: {formatDate(data.generatedAt)}</p>
      </Card>
    </div>
  )
}
