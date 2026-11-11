import { useEffect, useState } from 'react'
import type { ExportResult, ParticipationFilters, ParticipationPage, SummaryRow } from '../../../../shared/admin'
import { errorMessage, useAdmin } from '../adminContext'
import { Card, Notice } from '../ui'
import { EMPTY_FILTERS, ParticipationFiltersBar } from './ParticipationFiltersBar'

/** Reportes (8.18): resumen por campaña y día, y exportación CSV según permisos. */
export function ReportsView(): React.JSX.Element {
  const { call, can } = useAdmin()
  const [filters, setFilters] = useState<ParticipationFilters>(EMPTY_FILTERS)
  const [campaigns, setCampaigns] = useState<{ id: string; name: string }[]>([])
  const [personal, setPersonal] = useState(false)
  const [summary, setSummary] = useState<SummaryRow[]>([])
  const [message, setMessage] = useState<{ kind: 'error' | 'ok' | 'info'; text: string } | null>(null)

  useEffect(() => {
    if (!can('participations.view')) return
    void call<ParticipationPage>('participations.list', { page: 1 }).then((p) => {
      setCampaigns(p.campaigns)
      setPersonal(p.personal)
    })
  }, [call, can])

  useEffect(() => {
    call<SummaryRow[]>('reports.summary', filters)
      .then(setSummary)
      .catch((e) => setMessage({ kind: 'error', text: errorMessage(e) }))
  }, [call, filters])

  const exportCsv = async () => {
    try {
      const r = await call<ExportResult>('reports.participations', filters)
      setMessage(r.saved ? { kind: 'ok', text: `Se exportaron ${r.rows} participación(es) a ${r.fileName}` } : { kind: 'info', text: 'Exportación cancelada' })
    } catch (e) {
      setMessage({ kind: 'error', text: errorMessage(e) })
    }
  }

  const totals = summary.reduce(
    (t, r) => ({
      participations: t.participations + r.participations,
      completed: t.completed + r.completed,
      cancelled: t.cancelled + r.cancelled,
      published: t.published + r.published,
      pendingOrFailed: t.pendingOrFailed + r.pendingOrFailed
    }),
    { participations: 0, completed: 0, cancelled: 0, published: 0, pendingOrFailed: 0 }
  )

  return (
    <div className="astack">
      <Card
        title="Reportes"
        actions={
          <button type="button" className="btn btn--primary" onClick={() => void exportCsv()}>
            Exportar CSV
          </button>
        }
      >
        <ParticipationFiltersBar value={filters} onChange={setFilters} campaigns={campaigns} allowDni={personal} />
        <p className="muted">
          El archivo CSV se abre en Excel con tildes correctas.
          {personal ? ' Incluye nombres y DNI según su rol: manéjelo con cuidado.' : ' No incluye nombres ni DNI según su rol.'}
        </p>
        {message && <Notice kind={message.kind}>{message.text}</Notice>}
      </Card>
      <Card title="Resumen por campaña y día (RF-REP-004)">
        <div className="table-wrap">
          <table className="atable">
            <thead>
              <tr>
                <th>Día</th>
                <th>Campaña</th>
                <th>Participaciones</th>
                <th>Completadas</th>
                <th>Canceladas</th>
                <th>Publicadas</th>
                <th>Pendientes o fallidas</th>
              </tr>
            </thead>
            <tbody>
              {summary.map((r) => (
                <tr key={`${r.day}-${r.campaignName}`}>
                  <td>{r.day}</td>
                  <td>{r.campaignName}</td>
                  <td>{r.participations}</td>
                  <td>{r.completed}</td>
                  <td>{r.cancelled}</td>
                  <td>{r.published}</td>
                  <td>{r.pendingOrFailed}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th colSpan={2}>Total</th>
                <th>{totals.participations}</th>
                <th>{totals.completed}</th>
                <th>{totals.cancelled}</th>
                <th>{totals.published}</th>
                <th>{totals.pendingOrFailed}</th>
              </tr>
            </tfoot>
          </table>
        </div>
        {summary.length === 0 && <Notice kind="info">No hay participaciones con estos filtros.</Notice>}
      </Card>
    </div>
  )
}
