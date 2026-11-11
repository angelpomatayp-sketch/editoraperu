import { useEffect, useState } from 'react'
import type { AuditFilters, AuditRow, ExportResult, Page } from '../../../../shared/admin'
import { errorMessage, useAdmin } from '../adminContext'
import { Card, formatDate, Notice } from '../ui'

const EMPTY: AuditFilters = { from: null, to: null, level: null, category: null, result: null }
const LEVELS = { debug: 'Depuración', info: 'Información', warn: 'Advertencia', error: 'Error' } as const
const RESULTS = { ok: 'Correcto', fail: 'Falló', denied: 'Denegado', skipped: 'Omitido' } as const

type AuditPage = Page<AuditRow> & { categories: string[] }

/** Consulta de la bitácora con filtros (RF-BIT-004). El rol de contenido ve solo la de contenido. */
export function AuditView(): React.JSX.Element {
  const { call, can } = useAdmin()
  const [filters, setFilters] = useState<AuditFilters>(EMPTY)
  const [page, setPage] = useState(1)
  const [data, setData] = useState<AuditPage | null>(null)
  const [message, setMessage] = useState<{ kind: 'error' | 'ok' | 'info'; text: string } | null>(null)
  const full = can('audit.view')

  useEffect(() => {
    call<AuditPage>('audit.list', { ...filters, page })
      .then(setData)
      .catch((e) => setMessage({ kind: 'error', text: errorMessage(e) }))
  }, [call, filters, page])

  const set = (changes: Partial<AuditFilters>) => {
    setFilters({ ...filters, ...changes })
    setPage(1)
  }
  const day = (value: string, plus = 0) => {
    if (!value) return null
    const d = new Date(`${value}T00:00:00`)
    d.setDate(d.getDate() + plus)
    return d.toISOString()
  }
  const exportCsv = async () => {
    try {
      const r = await call<ExportResult>('reports.audit', filters)
      setMessage(r.saved ? { kind: 'ok', text: `Se exportaron ${r.rows} evento(s) a ${r.fileName}` } : { kind: 'info', text: 'Exportación cancelada' })
    } catch (e) {
      setMessage({ kind: 'error', text: errorMessage(e) })
    }
  }
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1

  return (
    <Card
      title={full ? 'Bitácora' : 'Bitácora de contenido'}
      actions={
        full && (
          <button type="button" className="btn" onClick={() => void exportCsv()}>
            Exportar CSV
          </button>
        )
      }
    >
      <div className="filters">
        <label className="afield">
          <span className="afield__label">Desde</span>
          <input type="date" onChange={(e) => set({ from: day(e.target.value) })} />
        </label>
        <label className="afield">
          <span className="afield__label">Hasta</span>
          <input type="date" onChange={(e) => set({ to: day(e.target.value, 1) })} />
        </label>
        <label className="afield">
          <span className="afield__label">Nivel</span>
          <select value={filters.level ?? ''} onChange={(e) => set({ level: (e.target.value || null) as AuditFilters['level'] })}>
            <option value="">Todos</option>
            {Object.entries(LEVELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label className="afield">
          <span className="afield__label">Categoría</span>
          <select value={filters.category ?? ''} onChange={(e) => set({ category: e.target.value || null })}>
            <option value="">Todas</option>
            {data?.categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label className="afield">
          <span className="afield__label">Resultado</span>
          <select value={filters.result ?? ''} onChange={(e) => set({ result: (e.target.value || null) as AuditFilters['result'] })}>
            <option value="">Todos</option>
            {Object.entries(RESULTS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
      </div>
      {message && <Notice kind={message.kind}>{message.text}</Notice>}
      {data && (
        <>
          <p className="muted">
            {data.total} evento(s) · página {page} de {pages}
          </p>
          <div className="table-wrap">
            <table className="atable atable--compact">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Nivel</th>
                  <th>Evento</th>
                  <th>Resultado</th>
                  <th>Usuario o componente</th>
                  <th>Detalle</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((r) => (
                  <tr key={r.id} className={`level-${r.level}`}>
                    <td>{formatDate(r.occurredAt)}</td>
                    <td>{LEVELS[r.level as keyof typeof LEVELS] ?? r.level}</td>
                    <td>
                      {r.category}.{r.action}
                      {r.entity && <div className="muted">{r.entity}</div>}
                    </td>
                    <td>{RESULTS[r.result as keyof typeof RESULTS] ?? r.result}</td>
                    <td>{r.actor ?? '—'}</td>
                    <td className="detail">{r.detail ?? ''}</td>
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
  )
}
