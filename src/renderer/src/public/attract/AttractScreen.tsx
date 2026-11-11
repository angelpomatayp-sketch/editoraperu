import { useEffect, useState } from 'react'
import type { PublicAttract } from '../../../../shared/attract'
import { AttractPlayer } from './AttractPlayer'
import { InstitutionalScreen } from './InstitutionalScreen'

/** Sin ningún toque en la pantalla de inicio, se vuelve al protector de pantalla. */
const BACK_TO_SCREENSAVER_SECONDS = 30

interface AttractScreenProps {
  attract: PublicAttract
  onStart: () => void
  /** Mensaje cuando no se pudo iniciar la participación. */
  notice?: string
  /** Empezar en «Toque aquí para participar» (por ejemplo, tras cancelar) en lugar del protector. */
  startAwake?: boolean
}

/**
 * Pantalla de atracción (RF-ATR-001, RF-ATR-002) en dos pasos:
 * 1. Protector de pantalla con el contenido institucional; un toque en cualquier parte lo despierta.
 * 2. Pantalla de inicio con el contenido en ciclo; solo el botón «TOQUE PARA COMENZAR» inicia la experiencia.
 * Se monta de nuevo al terminar cada participación: al completarla o por inactividad se vuelve al
 * protector; al cancelarla, a «Toque aquí para participar».
 */
export function AttractScreen({ attract, onStart, notice, startAwake = false }: AttractScreenProps): React.JSX.Element {
  const screensaver = attract.mode === 'institutional'
  const [awake, setAwake] = useState(!screensaver || startAwake)
  const [touchedAt, setTouchedAt] = useState(0)

  useEffect(() => {
    if (!screensaver || !awake || notice) return
    const timer = setTimeout(() => setAwake(false), BACK_TO_SCREENSAVER_SECONDS * 1000)
    return () => clearTimeout(timer)
  }, [screensaver, awake, notice, touchedAt])

  if (!awake) {
    return (
      <main className="attract" onClick={() => setAwake(true)}>
        <InstitutionalScreen attract={attract} />
      </main>
    )
  }

  return (
    // Cualquier toque reinicia la espera para volver al protector, pero solo el botón inicia la experiencia.
    <main className="attract" onPointerDown={() => setTouchedAt(Date.now())}>
      <AttractPlayer />
      <div className="attract__cta">
        {notice ? (
          <p className="notice" role="status">
            {notice}
          </p>
        ) : (
          <button type="button" className="touch-button start-button" onClick={onStart}>
            <TapIcon />
            <span>TOQUE PARA COMENZAR</span>
          </button>
        )}
      </div>
    </main>
  )
}

/** Mano tocando la pantalla, de línea y en la grilla de 24×24 de los demás íconos. */
function TapIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M7.3 3.6a4 4 0 0 1 6.4 0" />
      <path d="M9 13V6.5a1.5 1.5 0 0 1 3 0V12M12 11.5a1.5 1.5 0 0 1 3 0v.5M15 12a1.5 1.5 0 0 1 3 0v3.5c0 3.6-2.4 6-5.8 6h-.9c-2 0-3.3-.7-4.5-2l-2.6-3a1.4 1.4 0 0 1 2.1-1.9L9 16" />
    </svg>
  )
}
