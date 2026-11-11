import { useEffect, useState } from 'react'
import { ROLE_LABELS, ROLES, type AdminUserRow, type Role } from '../../../shared/admin'
import { errorMessage, useAdmin } from './adminContext'
import { Card, Field, formatDate, Notice } from './ui'

/** Usuarios administrativos: alta, rol, activación y restablecimiento de contraseña (8.23). */
export function UsersView(): React.JSX.Element {
  const { call, user: me } = useAdmin()
  const [users, setUsers] = useState<AdminUserRow[]>([])
  const [message, setMessage] = useState<{ kind: 'error' | 'ok'; text: string } | null>(null)
  const [form, setForm] = useState({ username: '', displayName: '', role: 'content' as Role, password: '' })
  const [resetting, setResetting] = useState<{ id: string; password: string } | null>(null)

  const run = async (method: Parameters<typeof call>[0], payload?: unknown, ok?: string): Promise<boolean> => {
    try {
      setUsers(await call<AdminUserRow[]>(method, payload))
      if (ok) setMessage({ kind: 'ok', text: ok })
      return true
    } catch (error) {
      setMessage({ kind: 'error', text: errorMessage(error) })
      return false
    }
  }

  useEffect(() => {
    void run('users.list')
  }, []) // Solo al abrir.

  const create = async (event: React.FormEvent) => {
    event.preventDefault()
    if (await run('users.create', form, `Usuario "${form.username}" creado; deberá cambiar la contraseña al ingresar`)) {
      setForm({ username: '', displayName: '', role: 'content', password: '' })
    }
  }

  return (
    <div className="astack">
      {message && <Notice kind={message.kind}>{message.text}</Notice>}
      <Card title="Usuarios">
        <ul className="alist">
          {users.map((u) => (
            <li key={u.id} className={`aitem${u.active ? '' : ' aitem--off'}`}>
              <div className="aitem__body">
                <strong>
                  {u.username} {u.id === me.id && <span className="tag">usted</span>}
                  {u.locked && <span className="tag tag--bad">bloqueado</span>}
                  {u.mustChangePassword && <span className="tag">contraseña temporal</span>}
                </strong>
                <div className="aitem__row">
                  <input
                    defaultValue={u.displayName}
                    aria-label="Nombre visible"
                    onBlur={(e) => e.target.value !== u.displayName && void run('users.update', { id: u.id, displayName: e.target.value, role: u.role, active: u.active })}
                  />
                  <select value={u.role} onChange={(e) => void run('users.update', { id: u.id, displayName: u.displayName, role: e.target.value, active: u.active })}>
                    {ROLES.map((r) => (
                      <option key={r} value={r}>
                        {ROLE_LABELS[r]}
                      </option>
                    ))}
                  </select>
                  <label className="inline">
                    <input
                      type="checkbox"
                      checked={u.active}
                      onChange={(e) => void run('users.update', { id: u.id, displayName: u.displayName, role: u.role, active: e.target.checked })}
                    />
                    {u.active ? 'Activo' : 'Desactivado'}
                  </label>
                </div>
                <span className="muted">Último acceso: {formatDate(u.lastLoginAt)}</span>
                {resetting?.id === u.id ? (
                  <div className="aitem__row">
                    <input
                      type="password"
                      placeholder="Contraseña temporal"
                      value={resetting.password}
                      onChange={(e) => setResetting({ id: u.id, password: e.target.value })}
                      autoComplete="new-password"
                    />
                    <button
                      type="button"
                      className="btn btn--primary"
                      onClick={() => void run('users.resetPassword', { id: u.id, password: resetting.password }, 'Contraseña restablecida').then((ok) => ok && setResetting(null))}
                    >
                      Guardar
                    </button>
                    <button type="button" className="btn" onClick={() => setResetting(null)}>
                      Cancelar
                    </button>
                  </div>
                ) : (
                  <button type="button" className="btn btn--small" onClick={() => setResetting({ id: u.id, password: '' })}>
                    Restablecer contraseña
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </Card>
      <Card title="Nuevo usuario">
        <form className="aform" onSubmit={(e) => void create(e)}>
          <Field label="Usuario">
            <input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} autoComplete="off" />
          </Field>
          <Field label="Nombre visible">
            <input value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} />
          </Field>
          <Field label="Rol">
            <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Contraseña temporal" hint="La persona deberá cambiarla en su primer acceso">
            <input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} autoComplete="new-password" />
          </Field>
          <div className="aform__actions">
            <button type="submit" className="btn btn--primary">
              Crear usuario
            </button>
          </div>
        </form>
      </Card>
    </div>
  )
}
