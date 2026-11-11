import { useState } from 'react'
import type { ConsentText } from '../../../../shared/registration'

interface ConsentScreenProps {
  consents: ConsentText[]
  accepted: Record<string, boolean>
  onToggle: (versionId: string) => void
}

/**
 * Términos y condiciones en formato compacto: una casilla por texto vigente y, para quien quiera
 * leerlo, el texto completo en una ventana (RF-CON-001). Ninguna casilla aparece marcada de
 * antemano (RF-CON-002).
 */
export function ConsentScreen({ consents, accepted, onToggle }: ConsentScreenProps): React.JSX.Element {
  const [open, setOpen] = useState<ConsentText | null>(null)

  return (
    <div className="terms">
      <svg className="terms__icon" viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="11" y="5" width="26" height="38" rx="3" />
        <path d="M17 17h14M17 24h14M17 31h8" />
      </svg>

      <ul className="terms__list">
        {consents.map((consent) => (
          <li key={consent.id} className="terms__item">
            <label className="terms__check">
              <input type="checkbox" checked={accepted[consent.id] === true} onChange={() => onToggle(consent.id)} />
              <span>
                Acepto: <strong>{consent.title}</strong>
                {consent.isRequired && <span className="terms__required"> (obligatorio)</span>}
              </span>
            </label>
            <button type="button" className="terms__detail" onClick={() => setOpen(consent)}>
              Ver detalle
            </button>
          </li>
        ))}
      </ul>

      {open && (
        <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="terms-title" onClick={() => setOpen(null)}>
          <div className="dialog terms__dialog" onClick={(e) => e.stopPropagation()}>
            <h2 id="terms-title">{open.title}</h2>
            <div className="terms__body" tabIndex={0}>
              {open.body}
            </div>
            <div className="dialog__actions">
              {accepted[open.id] !== true && (
                <button
                  type="button"
                  className="touch-button"
                  onClick={() => {
                    onToggle(open.id)
                    setOpen(null)
                  }}
                >
                  Acepto este término
                </button>
              )}
              <button type="button" className="touch-button touch-button--secondary" onClick={() => setOpen(null)}>
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
