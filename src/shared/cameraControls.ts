import { z } from 'zod'

/**
 * Ajustes de imagen que muchas cámaras USB permiten controlar desde la aplicación (UVC). Cada cámara
 * soporta solo algunos: el panel muestra los que ofrece y se guardan solo los elegidos. Se aplican
 * cada vez que se abre la cámara, para compensar la luz del lugar en el origen.
 */
export const CAMERA_NUMERIC_CONTROLS = ['brightness', 'contrast', 'saturation', 'sharpness', 'exposureCompensation', 'exposureTime', 'colorTemperature'] as const
export const CAMERA_MODE_CONTROLS = ['exposureMode', 'whiteBalanceMode'] as const
export type CameraNumericControl = (typeof CAMERA_NUMERIC_CONTROLS)[number]
export type CameraModeControl = (typeof CAMERA_MODE_CONTROLS)[number]

export const CAMERA_CONTROL_LABEL: Record<CameraNumericControl | CameraModeControl, string> = {
  brightness: 'Brillo',
  contrast: 'Contraste',
  saturation: 'Saturación',
  sharpness: 'Nitidez',
  exposureCompensation: 'Compensación de exposición',
  exposureTime: 'Tiempo de exposición (manual)',
  colorTemperature: 'Temperatura de color (manual)',
  exposureMode: 'Exposición',
  whiteBalanceMode: 'Balance de blancos'
}

const mode = z.enum(['manual', 'continuous', 'single-shot'])

export const cameraControlsSchema = z.object({
  brightness: z.number().finite().optional(),
  contrast: z.number().finite().optional(),
  saturation: z.number().finite().optional(),
  sharpness: z.number().finite().optional(),
  exposureCompensation: z.number().finite().optional(),
  exposureTime: z.number().finite().optional(),
  colorTemperature: z.number().finite().optional(),
  exposureMode: mode.optional(),
  whiteBalanceMode: mode.optional()
})
export type CameraControls = z.infer<typeof cameraControlsSchema>

/** Lo mínimo de una pista de cámara (`MediaStreamTrack`) que usan los ajustes de imagen. */
export interface ControllableTrack {
  getCapabilities?(): unknown
  getSettings(): unknown
  applyConstraints(constraints: { advanced: Record<string, unknown>[] }): Promise<void>
}

/** Lo que la cámara permite ajustar: rangos numéricos y modos (exposición, balance de blancos). */
export interface CameraCapabilities {
  numeric: Partial<Record<CameraNumericControl, { min: number; max: number; step: number }>>
  modes: Partial<Record<CameraModeControl, string[]>>
}

export function cameraCapabilities(track: ControllableTrack): CameraCapabilities {
  const caps = (track.getCapabilities?.() ?? {}) as Record<string, unknown>
  const result: CameraCapabilities = { numeric: {}, modes: {} }
  for (const key of CAMERA_NUMERIC_CONTROLS) {
    const range = caps[key] as { min?: number; max?: number; step?: number } | undefined
    if (range && typeof range.min === 'number' && typeof range.max === 'number' && range.max > range.min) {
      result.numeric[key] = { min: range.min, max: range.max, step: range.step && range.step > 0 ? range.step : 1 }
    }
  }
  for (const key of CAMERA_MODE_CONTROLS) {
    const modes = caps[key]
    if (Array.isArray(modes) && modes.length > 1) result.modes[key] = modes.filter((m): m is string => typeof m === 'string')
  }
  return result
}

/** Valores actuales de la cámara para los ajustes que soporta. */
export function currentCameraControls(track: ControllableTrack): CameraControls {
  const settings = track.getSettings() as Record<string, unknown>
  const result: Record<string, unknown> = {}
  for (const key of [...CAMERA_NUMERIC_CONTROLS, ...CAMERA_MODE_CONTROLS]) if (settings[key] !== undefined) result[key] = settings[key]
  return result as CameraControls
}

/**
 * Aplica los ajustes guardados que la cámara soporte; los demás se ignoran. Un ajuste rechazado no
 * impide usar la cámara. Los modos van primero: el tiempo de exposición y la temperatura de color
 * solo cuentan en modo manual.
 */
export async function applyCameraControls(track: ControllableTrack, controls: CameraControls): Promise<void> {
  const caps = cameraCapabilities(track)
  const modes: Record<string, unknown> = {}
  const values: Record<string, unknown> = {}
  for (const key of CAMERA_MODE_CONTROLS) {
    const value = controls[key]
    if (value && caps.modes[key]?.includes(value)) modes[key] = value
  }
  for (const key of CAMERA_NUMERIC_CONTROLS) {
    const value = controls[key]
    const range = caps.numeric[key]
    if (value === undefined || !range) continue
    if (key === 'exposureTime' && modes.exposureMode !== 'manual') continue
    if (key === 'colorTemperature' && modes.whiteBalanceMode !== 'manual') continue
    values[key] = Math.min(range.max, Math.max(range.min, value))
  }
  for (const set of [modes, values]) {
    if (Object.keys(set).length === 0) continue
    try {
      await track.applyConstraints({ advanced: [set] })
    } catch {
      // Cámara que rechaza el ajuste: se sigue con su configuración propia.
    }
  }
}
