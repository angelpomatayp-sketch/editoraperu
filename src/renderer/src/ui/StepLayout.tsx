import type { ReactNode } from 'react'
import { CancelButton } from './CancelButton'

interface StepLayoutProps {
  title: string
  subtitle?: string
  onBack?: () => void
  onCancel: () => void
  hasUnsavedData: boolean
  footer?: ReactNode
  children: ReactNode
}

/**
 * Estructura común de los pasos públicos: título bajo el logo del fondo, contenido y, abajo, la
 * acción principal con «Volver» y «Cancelar» en cápsulas.
 */
export function StepLayout(props: StepLayoutProps): React.JSX.Element {
  return (
    <main className="step">
      <div className="step__intro">
        <h1 className="title">{props.title}</h1>
        {props.subtitle && <p className="subtitle">{props.subtitle}</p>}
      </div>
      <div className="step__body">{props.children}</div>
      <footer className="step__footer">
        {props.footer}
        <div className="step__nav">
          {props.onBack && (
            <button type="button" className="pill-button" onClick={props.onBack}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="m14.5 6-6 6 6 6" />
              </svg>
              Volver
            </button>
          )}
          <CancelButton hasUnsavedData={props.hasUnsavedData} onConfirm={props.onCancel} pill />
        </div>
      </footer>
    </main>
  )
}
