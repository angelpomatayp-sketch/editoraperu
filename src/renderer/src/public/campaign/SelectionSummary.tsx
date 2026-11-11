import { CAMERA_SCENARIO_ID, CAMERA_SCENARIO_NAME, type CampaignDetail, type Selections } from '../../../../shared/campaign'
import { CompositionPreview } from './CompositionPreview'

export type SummaryTarget = 'scenario' | 'character' | 'frame'

interface SelectionSummaryProps {
  detail: CampaignDetail
  selections: Selections
  /** Pasos que se pueden volver a elegir; un marco automático no aparece aquí. */
  editable: SummaryTarget[]
  onEdit: (target: SummaryTarget) => void
}

/** Resumen visual con la vista previa de la composición y opción de cambiar cada elección (RF-EXP-006). */
export function SelectionSummary({ detail, selections, editable, onEdit }: SelectionSummaryProps): React.JSX.Element {
  const scenario = detail.scenarios.find((s) => s.id === selections.scenarioId)
  const characters = selections.characterIds
    .map((id) => detail.characters.find((c) => c.id === id)?.name)
    .filter(Boolean)
    .join(', ')
  const frame = detail.frames.find((f) => f.id === selections.frameId)

  const rows: { target: SummaryTarget; label: string; value: string }[] = [
    { target: 'scenario', label: 'Escenario', value: selections.scenarioId === CAMERA_SCENARIO_ID ? CAMERA_SCENARIO_NAME : (scenario?.name ?? '—') },
    ...(detail.characterMode !== 'none'
      ? [{ target: 'character' as const, label: selections.characterIds.length > 1 ? 'Personajes' : 'Personaje', value: characters || 'Ninguno' }]
      : []),
    ...(detail.frameMode !== 'none' ? [{ target: 'frame' as const, label: 'Marco', value: frame?.name ?? 'Ninguno' }] : [])
  ]

  return (
    <div className="summary">
      <CompositionPreview
        className="summary__preview"
        detail={detail}
        selections={selections}
        person={<div className="person-placeholder">Usted</div>}
      />
      <dl className="summary__list">
        {rows.map((row) => (
          <div className="summary__row" key={row.target}>
            <dt>{row.label}</dt>
            <dd>{row.value}</dd>
            {editable.includes(row.target) && (
              <button type="button" className="link-button" onClick={() => onEdit(row.target)}>
                Cambiar
              </button>
            )}
          </div>
        ))}
      </dl>
    </div>
  )
}
