import { useState } from 'react'
import { PASSWORD_MIN_LENGTH, type AdminUser } from '../../../shared/admin'
import { errorMessage, useAdmin } from './adminContext'
import { Card, Field, Notice } from './ui'

interface ChangePasswordProps {
  /** Contraseña temporal: debe cambiarse antes de continuar (RF-USR-002). */
  forced?: boolean
  onDone: (user: AdminUser) => void
  onCancel?: () => void
}

/** Cambio de la propia contraseña (RF-AUT-004). */
export function ChangePassword({ forced, onDone, onCancel }: ChangePasswordProps): React.JSX.Element {
  const { call } = useAdmin()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [message, setMessage] = useState<{ kind: 'error' | 'ok'; text: string } | null>(null)

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (next !== confirm) return setMessage({ kind: 'error', text: 'Las contraseñas nuevas no coinciden' })
    try {
      const user = await call<AdminUser>('session.changePassword', { current, next })
      setCurrent('')
      setNext('')
      setConfirm('')
      setMessage({ kind: 'ok', text: 'Contraseña actualizada' })
      onDone(user)
    } catch (error) {
      setMessage({ kind: 'error', text: errorMessage(error) })
    }
  }

  return (
    <Card title={forced ? 'Cambie su contraseña temporal' : 'Cambiar contraseña'}>
      <form className="aform" onSubmit={(e) => void submit(e)}>
        <Field label="Contraseña actual">
          <input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" />
        </Field>
        <Field label="Contraseña nueva" hint={`Al menos ${PASSWORD_MIN_LENGTH} caracteres, con letras y números`}>
          <input type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" />
        </Field>
        <Field label="Repetir contraseña nueva">
          <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
        </Field>
        {message && <Notice kind={message.kind}>{message.text}</Notice>}
        <div className="aform__actions">
          {onCancel && (
            <button type="button" className="btn" onClick={onCancel}>
              Salir
            </button>
          )}
          <button type="submit" className="btn btn--primary">
            Guardar contraseña
          </button>
        </div>
      </form>
    </Card>
  )
}
