import { PARTICIPATION_STATES, PHOTO_STATES, type ParticipationFilters } from '../../../../shared/admin'

export const STATUS_TEXT: Record<string, string> = {
  registered: 'Registrada',
  captured: 'Capturada',
  composed: 'Compuesta',
  completed: 'Completada',
  cancelled: 'Cancelada',
  failed: 'Fallida',
  anonymized: 'Anonimizada'
}

export const PHOTO_TEXT: Record<string, string> = {
  none: 'Sin foto',
  captured: 'Capturada',
  composed: 'Compuesta',
  pending: 'Publicación pendiente',
  published: 'Publicada',
  failed: 'Publicación fallida',
  expired: 'Enlace vencido',
  deleted: 'Eliminada'
}

export const EMPTY_FILTERS: ParticipationFilters = { from: null, to: null, campaignId: null, status: null, photoStatus: null, dni: null }

/** Fecha `aaaa-mm-dd` del selector como inicio del día local, y el día siguiente para el límite. */
function dayStart(value: string, plusDays = 0): string | null {
  if (!value) return null
  const d = new Date(`${value}T00:00:00`)
  d.setDate(d.getDate() + plusDays)
  return d.toISOString()
}

function dayValue(iso: string | null, minusDays = 0): string {
  if (!iso) return ''
  const d = new Date(iso)
  d.setDate(d.getDate() - minusDays)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

interface Props {
  value: ParticipationFilters
  onChange: (filters: ParticipationFilters) => void
  campaigns: { id: string; name: string }[]
  /** Búsqueda por DNI solo para roles autorizados (RF-PAR-002). */
  allowDni: boolean
}

/** Filtros por fechas, campaña, estado de la participación y de la fotografía (RF-PAR-002). */
export function ParticipationFiltersBar({ value, onChange, campaigns, allowDni }: Props): React.JSX.Element {
  const set = (changes: Partial<ParticipationFilters>) => onChange({ ...value, ...changes })
  return (
    <div className="filters">
      <label className="afield">
        <span className="afield__label">Desde</span>
        <input type="date" value={dayValue(value.from)} onChange={(e) => set({ from: dayStart(e.target.value) })} />
      </label>
      <label className="afield">
        <span className="afield__label">Hasta</span>
        <input type="date" value={dayValue(value.to, 1)} onChange={(e) => set({ to: dayStart(e.target.value, 1) })} />
      </label>
      <label className="afield">
        <span className="afield__label">Campaña</span>
        <select value={value.campaignId ?? ''} onChange={(e) => set({ campaignId: e.target.value || null })}>
          <option value="">Todas</option>
          {campaigns.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      <label className="afield">
        <span className="afield__label">Participación</span>
        <select value={value.status ?? ''} onChange={(e) => set({ status: (e.target.value || null) as ParticipationFilters['status'] })}>
          <option value="">Todas</option>
          {PARTICIPATION_STATES.map((s) => (
            <option key={s} value={s}>
              {STATUS_TEXT[s]}
            </option>
          ))}
        </select>
      </label>
      <label className="afield">
        <span className="afield__label">Fotografía</span>
        <select value={value.photoStatus ?? ''} onChange={(e) => set({ photoStatus: (e.target.value || null) as ParticipationFilters['photoStatus'] })}>
          <option value="">Todas</option>
          {PHOTO_STATES.map((s) => (
            <option key={s} value={s}>
              {PHOTO_TEXT[s]}
            </option>
          ))}
        </select>
      </label>
      {allowDni && (
        <label className="afield">
          <span className="afield__label">DNI</span>
          <input
            inputMode="numeric"
            maxLength={8}
            value={value.dni ?? ''}
            onChange={(e) => {
              const dni = e.target.value.replace(/\D/g, '')
              set({ dni: dni.length === 8 ? dni : null })
            }}
            placeholder="8 dígitos"
          />
        </label>
      )}
    </div>
  )
}
