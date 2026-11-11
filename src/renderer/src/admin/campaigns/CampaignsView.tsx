import { useEffect, useState } from 'react'
import type { AdminCampaign, CampaignListItem } from '../../../../shared/admin'
import { errorMessage, useAdmin } from '../adminContext'
import { Card, formatDate, Notice } from '../ui'
import { CampaignEditor } from './CampaignEditor'

export const STATUS_LABEL: Record<CampaignListItem['status'], string> = {
  draft: 'Borrador',
  active: 'Activa',
  inactive: 'Inactiva',
  archived: 'Archivada'
}

/** Listado y creación de campañas (8.13). */
export function CampaignsView(): React.JSX.Element {
  const { call } = useAdmin()
  const [list, setList] = useState<CampaignListItem[]>([])
  const [editing, setEditing] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)

  const load = () =>
    call<CampaignListItem[]>('campaigns.list')
      .then(setList)
      .catch((e) => setError(errorMessage(e)))

  useEffect(() => {
    void load()
  }, []) // Solo al abrir.

  if (editing) {
    return (
      <CampaignEditor
        id={editing}
        onBack={() => {
          setEditing(null)
          void load()
        }}
      />
    )
  }

  const create = async (event: React.FormEvent) => {
    event.preventDefault()
    try {
      const campaign = await call<AdminCampaign>('campaigns.create', { name })
      setName('')
      setEditing(campaign.id)
    } catch (e) {
      setError(errorMessage(e))
    }
  }

  return (
    <div className="astack">
      <Card title="Nueva campaña">
        <form className="aform aform--inline" onSubmit={(e) => void create(e)}>
          <input placeholder="Nombre de la campaña" value={name} onChange={(e) => setName(e.target.value)} />
          <button type="submit" className="btn btn--primary" disabled={name.trim().length < 2}>
            Crear
          </button>
        </form>
      </Card>
      {error && <Notice kind="error">{error}</Notice>}
      <Card title="Campañas">
        <ul className="alist">
          {list.map((c) => (
            <li key={c.id} className={`aitem aitem--link${c.status === 'archived' ? ' aitem--off' : ''}`}>
              <button type="button" className="aitem__open" onClick={() => setEditing(c.id)}>
                <div className="aitem__body">
                  <strong>{c.name}</strong>
                  <div className="aitem__row">
                    <span className={`tag tag--${c.status}`}>{STATUS_LABEL[c.status]}</span>
                    <span className="muted">
                      {c.scenarios} escenario(s) · {c.participations} participación(es) · vigencia {formatDate(c.startsAt)} – {formatDate(c.endsAt)}
                    </span>
                  </div>
                  {c.problems.length > 0 && <span className="tag tag--bad">Incompleta: {c.problems.length} pendiente(s)</span>}
                </div>
                <span aria-hidden="true">›</span>
              </button>
            </li>
          ))}
        </ul>
        {list.length === 0 && <Notice kind="info">Todavía no hay campañas.</Notice>}
      </Card>
    </div>
  )
}
