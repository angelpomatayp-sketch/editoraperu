import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import type { PublicSettings, SessionEndReason } from '../../../shared/ipc'
import { InactivityGuard } from '../ui/InactivityGuard'
import { AttractScreen } from './attract/AttractScreen'
import { ExperienceFlow } from './ExperienceFlow'

/** `awake`: volver a «Toque aquí para participar» en lugar del protector de pantalla (al cancelar). */
type FlowState = { phase: 'attract'; notice?: string; awake?: boolean } | { phase: 'experience'; sessionId: string }

const START_UNAVAILABLE_NOTICE =
  'En este momento no es posible iniciar una nueva participación. Por favor, solicite asistencia al personal.'
const NOTICE_SECONDS = 8

/**
 * Recorrido público (sección 7). Cada sesión monta sus pantallas con una clave propia, de modo que
 * al terminar o cancelar se descarta todo su estado y nada queda visible para el siguiente
 * participante (RF-SES-004).
 */
export function PublicFlow({ settings, reservedCorner }: { settings: PublicSettings; reservedCorner: ReactNode }): React.JSX.Element {
  const [state, setState] = useState<FlowState>({ phase: 'attract' })
  const [inactivityPaused, setInactivityPaused] = useState(false)
  const starting = useRef(false)

  const start = useCallback(async () => {
    if (starting.current) return
    starting.current = true
    try {
      const result = await window.totem.startSession()
      setInactivityPaused(false)
      setState(result.ok ? { phase: 'experience', sessionId: result.sessionId } : { phase: 'attract', notice: START_UNAVAILABLE_NOTICE })
    } catch {
      setState({ phase: 'attract', notice: START_UNAVAILABLE_NOTICE })
    } finally {
      starting.current = false
    }
  }, [])

  const end = useCallback(
    (reason: SessionEndReason) => {
      if (state.phase !== 'experience') return
      void window.totem.endSession(state.sessionId, reason)
      setState({ phase: 'attract', awake: reason === 'cancelled' })
    },
    [state]
  )

  // Si la experiencia se desmonta en medio de una sesión (por ejemplo, al abrir el panel
  // administrativo), la sesión se cancela para no dejar datos pendientes (RF-SES-004).
  const activeSession = state.phase === 'experience' ? state.sessionId : null
  useEffect(() => {
    if (!activeSession) return
    return () => void window.totem.endSession(activeSession, 'cancelled')
  }, [activeSession])

  const notice = state.phase === 'attract' ? state.notice : undefined
  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => setState({ phase: 'attract' }), NOTICE_SECONDS * 1000)
    return () => clearTimeout(timer)
  }, [notice])

  if (state.phase === 'attract') {
    return (
      <>
        <AttractScreen attract={settings.attract} onStart={start} notice={notice} startAwake={state.awake === true || notice !== undefined} />
        {reservedCorner}
      </>
    )
  }

  // Desde «TOQUE PARA COMENZAR» en adelante: fondo institucional claro (fondo3.png) y colores claros (`.experience`).
  return (
    <div className="experience">
      <InactivityGuard
        key={state.sessionId}
        warningAfterSeconds={settings.session.inactivityWarningSeconds}
        cancelAfterSeconds={settings.session.inactivityCancelSeconds}
        paused={inactivityPaused}
        onTimeout={() => end('timeout')}
      >
        <ExperienceFlow sessionId={state.sessionId} settings={settings} onEnd={end} onPauseInactivity={setInactivityPaused} />
      </InactivityGuard>
    </div>
  )
}
