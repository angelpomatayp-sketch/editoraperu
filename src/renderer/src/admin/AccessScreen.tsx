import { useEffect, useState } from 'react'
import { PASSWORD_MIN_LENGTH, type LoginResult } from '../../../shared/admin'
import { Field, Notice } from './ui'

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

  useEffect(() => {
    void window.totem.adminStatus().then((s) => setSetup(s.setupRequired))
  }, [])

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
    } finally {
      setBusy(false)
    }
  }

  if (setup === null) return <main className="admin admin--center" aria-busy="true" />

  return (
    <main className="admin admin--center">
      <form className="acard aform" onSubmit={(e) => void submit(e)}>
        <h1>{setup ? 'Configuración inicial' : 'Acceso administrativo'}</h1>
        {setup && <Notice kind="info">No hay usuarios. Cree la cuenta del administrador del sistema.</Notice>}
        <Field label="Usuario">
          <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoFocus />
        </Field>
        {setup && (
          <Field label="Nombre visible">
            <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          </Field>
        )}
        <Field label="Contraseña" hint={setup ? `Al menos ${PASSWORD_MIN_LENGTH} caracteres, con letras y números` : undefined}>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={setup ? 'new-password' : 'current-password'} />
        </Field>
        {setup && (
          <Field label="Repetir contraseña">
            <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
          </Field>
        )}
        {error && <Notice kind="error">{error}</Notice>}
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
