import { describe, expect, it } from 'vitest'
import { inactivityPhase, secondsUntilTimeout } from '../../src/shared/inactivity'
import { registerReservedTap, RESERVED_TAPS, RESERVED_WINDOW_MS } from '../../src/shared/reservedGesture'

const timers = { warningAfterMs: 60_000, cancelAfterMs: 15_000 }

describe('inactividad (RF-SES-002)', () => {
  it('pasa de activa a advertencia y luego a cancelación', () => {
    expect(inactivityPhase(0, timers)).toBe('active')
    expect(inactivityPhase(59_999, timers)).toBe('active')
    expect(inactivityPhase(60_000, timers)).toBe('warning')
    expect(inactivityPhase(74_999, timers)).toBe('warning')
    expect(inactivityPhase(75_000, timers)).toBe('timeout')
  })

  it('calcula la cuenta regresiva de la advertencia', () => {
    expect(secondsUntilTimeout(60_000, timers)).toBe(15)
    expect(secondsUntilTimeout(74_001, timers)).toBe(1)
    expect(secondsUntilTimeout(90_000, timers)).toBe(0)
  })
})

describe('acción reservada (RF-KIO-003)', () => {
  it('se activa con la cantidad de toques dentro de la ventana de tiempo', () => {
    let taps: number[] = []
    let triggered = false
    for (let i = 0; i < RESERVED_TAPS; i++) {
      ;({ taps, triggered } = registerReservedTap(taps, 1000 + i * 200))
    }
    expect(triggered).toBe(true)
    expect(taps).toEqual([])
  })

  it('no se activa si los toques están demasiado separados', () => {
    let taps: number[] = []
    let triggered = false
    for (let i = 0; i < RESERVED_TAPS; i++) {
      ;({ taps, triggered } = registerReservedTap(taps, i * (RESERVED_WINDOW_MS / 2 + 1)))
    }
    expect(triggered).toBe(false)
  })
})
