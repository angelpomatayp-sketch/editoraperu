import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { inactivityPhase, secondsUntilTimeout, type InactivityPhase } from '../../../shared/inactivity'

interface InactivityGuardProps {
  warningAfterSeconds: number
  cancelAfterSeconds: number
  onTimeout: () => void
  /** Mientras está en pausa no se mide la inactividad (por ejemplo, en la pantalla del QR). */
  paused?: boolean
  children: ReactNode
}

const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'touchstart', 'wheel'] as const
const TICK_MS = 250

/**
 * Mide la inactividad de las pantallas públicas (RF-SES-002): muestra una advertencia con
 * cuenta regresiva y una opción para continuar; sin respuesta, cancela la sesión.
 */
export function InactivityGuard({
  warningAfterSeconds,
  cancelAfterSeconds,
  onTimeout,
  paused = false,
  children
}: InactivityGuardProps): React.JSX.Element {
  const lastActivity = useRef(Date.now())
  const timedOut = useRef(false)
  const onTimeoutRef = useRef(onTimeout)
  onTimeoutRef.current = onTimeout
  const [phase, setPhase] = useState<InactivityPhase>('active')
  const [secondsLeft, setSecondsLeft] = useState(cancelAfterSeconds)

  const markActivity = useCallback(() => {
    lastActivity.current = Date.now()
  }, [])

  useEffect(() => {
    if (paused) {
      setPhase('active')
      return
    }
    lastActivity.current = Date.now()
    const timers = { warningAfterMs: warningAfterSeconds * 1000, cancelAfterMs: cancelAfterSeconds * 1000 }
    for (const name of ACTIVITY_EVENTS) window.addEventListener(name, markActivity, { capture: true, passive: true })
    const interval = setInterval(() => {
      const idle = Date.now() - lastActivity.current
      const current = inactivityPhase(idle, timers)
      setPhase(current)
      setSecondsLeft(secondsUntilTimeout(idle, timers))
      if (current === 'timeout' && !timedOut.current) {
        timedOut.current = true
        onTimeoutRef.current()
      }
    }, TICK_MS)
    return () => {
      for (const name of ACTIVITY_EVENTS) window.removeEventListener(name, markActivity, { capture: true })
      clearInterval(interval)
    }
  }, [markActivity, warningAfterSeconds, cancelAfterSeconds, paused])

  return (
    <>
      {children}
      {phase === 'warning' && (
        <div className="overlay" role="alertdialog" aria-labelledby="inactivity-title">
          <div className="dialog">
            <h2 id="inactivity-title">¿Sigue ahí?</h2>
            <p>
              Su sesión se cerrará en <strong className="countdown">{secondsLeft}</strong>{' '}
              {secondsLeft === 1 ? 'segundo' : 'segundos'}.
            </p>
            <button type="button" className="touch-button" onClick={markActivity}>
              Continuar
            </button>
          </div>
        </div>
      )}
    </>
  )
}
