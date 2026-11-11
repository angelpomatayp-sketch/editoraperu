import { CAMERA_SCENARIO_ID, type ResourceOption } from '../../../../shared/campaign'

interface OptionGridProps {
  options: ResourceOption[]
  /** Identificadores elegidos, en orden de elección. */
  selectedIds: string[]
  onSelect: (id: string | null) => void
  /** Etiqueta de la opción "ninguno" cuando la selección es opcional (selección única). */
  noneLabel?: string
  /** Con selección múltiple se numera cada elección según su orden. */
  multiple?: boolean
  variant: 'scene' | 'character'
}

/** Cuadrícula de opciones con vista previa (RF-EXP-003 a RF-EXP-005). */
export function OptionGrid({ options, selectedIds, onSelect, noneLabel, multiple, variant }: OptionGridProps): React.JSX.Element {
  return (
    <ul className={`option-grid option-grid--${variant}`}>
      {options.map((option) => {
        const position = selectedIds.indexOf(option.id)
        const cameraBackground = option.id === CAMERA_SCENARIO_ID
        return (
          <li key={option.id}>
            <button type="button" className="option-card" aria-pressed={position >= 0} onClick={() => onSelect(option.id)}>
              <span className="option-card__preview">
                {cameraBackground ? (
                  <span className="option-card__camera" aria-hidden="true">
                    <svg viewBox="0 0 64 64">
                      <path d="M18 18h7l3-5h8l3 5h7a8 8 0 0 1 8 8v20a8 8 0 0 1-8 8H18a8 8 0 0 1-8-8V26a8 8 0 0 1 8-8Z" />
                      <circle cx="32" cy="36" r="11" />
                      <circle cx="47" cy="26" r="2" />
                    </svg>
                    <strong>Fondo real</strong>
                  </span>
                ) : (
                  <img src={option.imageUrl} alt="" draggable={false} />
                )}
                {multiple && position >= 0 && <span className="option-card__order">{position + 1}</span>}
              </span>
              {/* Los escenarios se reconocen por su imagen: el nombre queda solo para lectores de pantalla. */}
              <span className={`option-card__name${variant === 'scene' && !cameraBackground ? ' visually-hidden' : ''}`}>{option.name}</span>
            </button>
          </li>
        )
      })}
      {noneLabel && (
        <li>
          <button type="button" className="option-card" aria-pressed={selectedIds.length === 0} onClick={() => onSelect(null)}>
            <span className="option-card__preview option-card__preview--none">Ninguno</span>
            <span className="option-card__name">{noneLabel}</span>
          </button>
        </li>
      )}
    </ul>
  )
}
