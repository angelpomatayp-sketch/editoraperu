import type { ReactNode } from 'react'

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }): React.JSX.Element {
  return (
    <label className="afield">
      <span className="afield__label">{label}</span>
      {children}
      {hint && <span className="afield__hint">{hint}</span>}
    </label>
  )
}

/** Mensaje de resultado; el estado se expresa con texto además del color (RF-DSH-002). */
export function Notice({ kind, children }: { kind: 'error' | 'ok' | 'info'; children: ReactNode }): React.JSX.Element {
  const prefix = kind === 'error' ? 'Error: ' : kind === 'ok' ? 'Listo: ' : ''
  return (
    <p className={`anotice anotice--${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      {prefix}
      {children}
    </p>
  )
}

export function Card({ title, actions, children }: { title?: string; actions?: ReactNode; children: ReactNode }): React.JSX.Element {
  return (
    <section className="acard">
      {(title || actions) && (
        <header className="acard__head">
          {title && <h2>{title}</h2>}
          {actions && <div className="acard__actions">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  )
}

/** Fecha ISO en formato local de Lima. */
export function formatDate(iso: string | null): string {
  if (!iso) return '—'
  return new Intl.DateTimeFormat('es-PE', { timeZone: 'America/Lima', dateStyle: 'short', timeStyle: 'short' }).format(new Date(iso))
}

/** Convierte ISO a valor de `<input type="datetime-local">` en la hora del equipo y viceversa. */
export function toLocalInput(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function fromLocalInput(value: string): string | null {
  return value ? new Date(value).toISOString() : null
}
