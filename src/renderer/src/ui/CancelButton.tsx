import { useState } from 'react'
import { ConfirmDialog } from './ConfirmDialog'

interface CancelButtonProps {
  /** Si se perdería información ya introducida, se pide confirmación (RF-SES-003). */
  hasUnsavedData: boolean
  onConfirm: () => void
  /** Versión reducida para el encabezado de la cámara. */
  compact?: boolean
  /** Cápsula blanca con borde rojo, al pie de los pasos. */
  pill?: boolean
}

export function CancelButton({ hasUnsavedData, onConfirm, compact, pill }: CancelButtonProps): React.JSX.Element {
  const [confirming, setConfirming] = useState(false)

  return (
    <>
      <button
        type="button"
        className={pill ? 'pill-button' : compact ? 'link-button' : 'touch-button touch-button--secondary'}
        onClick={() => (hasUnsavedData ? setConfirming(true) : onConfirm())}
      >
        {pill && (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
          </svg>
        )}
        Cancelar
      </button>
      {confirming && (
        <ConfirmDialog
          title="¿Desea cancelar?"
          message="Se perderán los datos que ingresó."
          confirmLabel="Sí, cancelar"
          cancelLabel="No, continuar"
          onConfirm={onConfirm}
          onCancel={() => setConfirming(false)}
        />
      )}
    </>
  )
}
