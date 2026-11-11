import { useEffect, useRef, useState } from 'react'
import {
  DNI_LENGTH,
  NAME_MAX_LENGTH,
  type ParticipantField,
  type ParticipantFieldErrors,
  type ParticipantInput
} from '../../../../shared/participant'
import { shouldAutoCapitalize, typeDigitKey, typeNameKey } from '../../../../shared/typing'
import { VirtualKeyboard } from '../../ui/VirtualKeyboard'

interface RegisterFormProps {
  value: ParticipantInput
  errors: ParticipantFieldErrors
  /** Aumenta con cada intento de envío; solo entonces se lleva el foco al primer campo con error. */
  attempt: number
  onChange: (field: ParticipantField, value: string) => void
}

const FIELDS: { field: ParticipantField; label: string; hint?: string }[] = [
  { field: 'firstNames', label: 'Nombres' },
  { field: 'lastNames', label: 'Apellidos' },
  { field: 'dni', label: 'DNI', hint: `${DNI_LENGTH} dígitos` }
]

/**
 * Formulario de registro con teclado en pantalla (RF-REG-001). Los campos obligatorios se indican
 * y los errores se muestran junto a cada campo. La validación definitiva la hace el proceso principal.
 */
export function RegisterForm({ value, errors, attempt, onChange }: RegisterFormProps): React.JSX.Element {
  const firstError = FIELDS.find((f) => errors[f.field])?.field
  const [active, setActive] = useState<ParticipantField>(firstError ?? 'firstNames')
  const [shift, setShift] = useState(false)
  const inputs = useRef<Partial<Record<ParticipantField, HTMLInputElement | null>>>({})

  useEffect(() => {
    if (attempt > 0 && firstError) setActive(firstError)
  }, [attempt]) // Solo tras un intento de envío, no al corregir un campo.

  useEffect(() => {
    inputs.current[active]?.focus()
  }, [active])

  const current = value[active]
  const isDni = active === 'dni'

  const onKey = (key: string): void => {
    if (isDni) onChange('dni', typeDigitKey(current, key, DNI_LENGTH))
    else {
      onChange(active, typeNameKey(current, key, shift, NAME_MAX_LENGTH))
      setShift(false)
    }
  }

  const onPhysicalChange = (field: ParticipantField, raw: string): void => {
    onChange(field, field === 'dni' ? raw.replace(/\D/g, '').slice(0, DNI_LENGTH) : raw.slice(0, NAME_MAX_LENGTH))
  }

  return (
    <div className="register">
      <div className="register__fields">
        {FIELDS.map(({ field, label, hint }) => (
          <label key={field} className={`field${active === field ? ' field--active' : ''}${errors[field] ? ' field--error' : ''}`}>
            <span className="field__label">
              {label} <span className="field__required">(obligatorio)</span>
              {hint && <span className="field__hint"> · {hint}</span>}
            </span>
            <input
              ref={(el) => {
                inputs.current[field] = el
              }}
              value={value[field]}
              inputMode="none"
              autoComplete="off"
              spellCheck={false}
              aria-invalid={Boolean(errors[field])}
              onFocus={() => setActive(field)}
              onChange={(e) => onPhysicalChange(field, e.target.value)}
            />
            {errors[field] && (
              <span className="field__error" role="alert">
                {errors[field]}
              </span>
            )}
          </label>
        ))}
      </div>
      <VirtualKeyboard
        layout={isDni ? 'numeric' : 'alpha'}
        uppercase={!isDni && shouldAutoCapitalize(current) !== shift}
        shift={shift}
        onKey={onKey}
        onBackspace={() => onChange(active, current.slice(0, -1))}
        onShift={() => setShift((s) => !s)}
      />
    </div>
  )
}
