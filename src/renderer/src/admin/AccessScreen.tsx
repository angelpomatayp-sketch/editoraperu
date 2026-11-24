import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { PASSWORD_MIN_LENGTH, type LoginResult } from '../../../shared/admin'
import { VirtualKeyboard } from '../ui/VirtualKeyboard'
import { Field, Notice } from './ui'

type AccessField = 'username' | 'displayName' | 'password' | 'confirm'

interface AccessScreenProps {
  onLogin: (result: Extract<LoginResult, { ok: true }>) => void
  onCancel: () => void
}

/**
 * Acceso administrativo (RF-AUT-001). Si todavía no hay usuarios, solicita crear la cuenta
 * administrativa inicial (RF-USR-002).
 */
export function AccessScreen({ onLogin, onCancel }: AccessScreenProps): React.JSX.Element {
  const [setup, setSetup] = useState<boolean | null>(null)
  const [username, setUsername] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [active, setActive] = useState<AccessField>('username')
  const [shift, setShift] = useState(false)
  const inputs = useRef<Partial<Record<AccessField, HTMLInputElement | null>>>({})
  const caret = useRef<{ field: AccessField; position: number } | null>(null)

  // React actualiza el valor antes de recuperar la posición del cursor (también en contraseñas).
  useLayoutEffect(() => {
    if (!caret.current) return
    const { field, position } = caret.current
    caret.current = null
    inputs.current[field]?.setSelectionRange(position, position)
  })

  useEffect(() => {
    void window.totem.adminStatus().then((s) => setSetup(s.setupRequired))
  }, [])

  useEffect(() => {
    if (!busy && setup !== null) inputs.current[active]?.focus({ preventScroll: true })
  }, [active, busy, setup])

  const focusField = (field: AccessField) => {
    setActive(field)
    setShift(false)
  }

  const editActive = (key: string | null) => {
    if (busy) return
    const values = { username, displayName, password, confirm }
    const setters = { username: setUsername, displayName: setDisplayName, password: setPassword, confirm: setConfirm }
    const input = inputs.current[active]
    const value = values[active]
    const start = input?.selectionStart ?? value.length
    const end = input?.selectionEnd ?? value.length
    const from = key === null && start === end ? Math.max(0, start - 1) : start
    const text = key === null ? '' : shift ? key.toLocaleUpperCase('es-PE') : key
    const next = value.slice(0, from) + text + value.slice(end)
    input?.focus({ preventScroll: true })
    if (next !== value) {
      caret.current = { field: active, position: from + text.length }
      setters[active](next)
    } else input?.setSelectionRange(from + text.length, from + text.length)
    if (key !== null) setShift(false)
  }

  const touchInput = (field: AccessField) => ({
    ref: (input: HTMLInputElement | null) => { inputs.current[field] = input },
    onFocus: () => focusField(field),
    inputMode: 'none' as const,
    autoCapitalize: 'none',
    spellCheck: false,
    disabled: busy
  })

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (busy) return
    setError(null)
    if (setup && password !== confirm) {
      setError('Las contraseñas no coinciden')
      return
    }
    setBusy(true)
    try {
      const result = setup
        ? await window.totem.adminSetup({ username, displayName, password })
        : await window.totem.adminLogin({ username, password })
      if (result.ok) return onLogin(result)
      if ('message' in result) setError(result.message)
      else if (result.error === 'locked') {
        setError(`Cuenta bloqueada temporalmente. Intente en ${Math.ceil((result.retryAfterSeconds ?? 60) / 60)} minuto(s).`)
      } else setError('Usuario o contraseña incorrectos')
      setPassword('')
      setActive('password')
    } finally {
      setBusy(false)
    }
  }

  if (setup === null) return <main className="admin admin--center" aria-busy="true" />

  return (
    <main className="admin admin--center admin--access">
      <form className="acard aform" onSubmit={(e) => void submit(e)}>
        <h1>{setup ? 'Configuración inicial' : 'Acceso administrativo'}</h1>
        {setup && <Notice kind="info">No hay usuarios. Cree la cuenta del administrador del sistema.</Notice>}
        <Field label="Usuario">
          <input {...touchInput('username')} value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoFocus />
        </Field>
        {setup && (
          <Field label="Nombre visible">
            <input {...touchInput('displayName')} value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          </Field>
        )}
        <Field label="Contraseña" hint={setup ? `Al menos ${PASSWORD_MIN_LENGTH} caracteres, con letras y números` : undefined}>
          <input {...touchInput('password')} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={setup ? 'new-password' : 'current-password'} />
        </Field>
        {setup && (
          <Field label="Repetir contraseña">
            <input {...touchInput('confirm')} type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
          </Field>
        )}
        {error && <Notice kind="error">{error}</Notice>}
        <VirtualKeyboard
          layout="credentials"
          uppercase={shift}
          shift={shift}
          onKey={editActive}
          onBackspace={() => editActive(null)}
          onShift={() => setShift((s) => !s)}
          disabled={busy}
        />
        <div className="aform__actions">
          <button type="button" className="btn" onClick={onCancel}>
            Volver al tótem
          </button>
          <button type="submit" className="btn btn--primary" disabled={busy}>
            {setup ? 'Crear y entrar' : 'Ingresar'}
          </button>
        </div>
      </form>
    </main>
  )
}
