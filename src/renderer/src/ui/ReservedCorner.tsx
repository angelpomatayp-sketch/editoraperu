import { useRef } from 'react'
import { registerReservedTap } from '../../../shared/reservedGesture'

/**
 * Zona invisible en la esquina superior izquierda para la acción reservada del personal
 * (RF-KIO-003): 5 toques seguidos abren el acceso administrativo, que exige usuario y contraseña.
 */
export function ReservedCorner({ onTrigger, visible }: { onTrigger: () => void; visible?: boolean }): React.JSX.Element {
  const taps = useRef<number[]>([])

  const onTap = (event: React.MouseEvent): void => {
    event.stopPropagation()
    const result = registerReservedTap(taps.current, Date.now())
    taps.current = result.taps
    if (!result.triggered) return
    void window.totem.reservedGesture()
    onTrigger()
  }

  // En desarrollo la zona se marca para que el equipo sepa dónde tocar; en el tótem es invisible.
  return (
    <div className={`reserved-corner${visible ? ' reserved-corner--visible' : ''}`} onClick={onTap} aria-hidden="true">
      {visible && <span>Admin ×5</span>}
    </div>
  )
}
