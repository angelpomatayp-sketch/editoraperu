import { useCallback, useEffect, useMemo, useState } from 'react'
import { ROLE_LABELS, type AdminUser, type LoginResult, type Permission } from '../../../shared/admin'
import { AdminContext, adminCaller, errorMessage, permissionsFor } from './adminContext'
import { AccessScreen } from './AccessScreen'
import { CampaignsView } from './campaigns/CampaignsView'
import { ChangePassword } from './ChangePassword'
import { DashboardView } from './DashboardView'
import { AttractSettings } from './AttractSettings'
import { MediaView } from './MediaView'
import { AuditView } from './operations/AuditView'
import { ParticipationsView } from './operations/ParticipationsView'
import { ReportsView } from './operations/ReportsView'
import { SystemView } from './SystemView'
import { UsersView } from './UsersView'
import './admin.css'

type Section = 'dashboard' | 'campaigns' | 'media' | 'participations' | 'reports' | 'audit' | 'users' | 'system' | 'account'

const SECTIONS: { id: Section; label: string; permission: Permission | null }[] = [
  { id: 'dashboard', label: 'Resumen', permission: 'dashboard.view' },
  { id: 'campaigns', label: 'Campañas', permission: 'campaigns.manage' },
  { id: 'media', label: 'Atracción', permission: 'media.manage' },
  { id: 'participations', label: 'Participaciones', permission: 'participations.view' },
  { id: 'reports', label: 'Reportes', permission: 'reports.export' },
  { id: 'audit', label: 'Bitácora', permission: 'audit.viewContent' },
  { id: 'users', label: 'Usuarios', permission: 'users.manage' },
  { id: 'system', label: 'Sistema', permission: null },
  { id: 'account', label: 'Mi cuenta', permission: null }
]

interface AdminAppProps {
  /** Segundos de inactividad antes de cerrar la sesión (RF-AUT-005). */
  timeoutSeconds: number
  onExit: () => void
}

/**
 * Módulo administrativo (8.11 a 8.23). Se abre con la acción reservada y exige usuario y
 * contraseña; al cerrar sesión o expirar, vuelve a la experiencia pública.
 */
export function AdminApp({ timeoutSeconds, onExit }: AdminAppProps): React.JSX.Element {
  const [session, setSession] = useState<{ token: string; user: AdminUser } | null>(null)
  const [section, setSection] = useState<Section>('dashboard')

  const exit = useCallback(() => {
    setSession(null)
    onExit()
  }, [onExit])

  const call = useMemo(() => (session ? adminCaller(session.token, exit) : null), [session, exit])

  // Cierre por inactividad en la interfaz; el proceso principal también vence la sesión.
  useEffect(() => {
    if (!session) return
    let last = Date.now()
    const touch = () => {
      last = Date.now()
    }
    const events = ['pointerdown', 'keydown', 'wheel'] as const
    events.forEach((e) => window.addEventListener(e, touch, { capture: true, passive: true }))
    const timer = setInterval(() => {
      if (Date.now() - last > timeoutSeconds * 1000) {
        void window.totem.admin(session.token, 'session.logout')
        exit()
      }
    }, 5000)
    return () => {
      events.forEach((e) => window.removeEventListener(e, touch, { capture: true }))
      clearInterval(timer)
    }
  }, [session, timeoutSeconds, exit])

  if (!session || !call) {
    return (
      <AccessScreen
        onCancel={onExit}
        onLogin={(result: Extract<LoginResult, { ok: true }>) => {
          setSession({ token: result.token, user: result.user })
          setSection(result.user.role === 'operator' ? 'system' : 'dashboard')
        }}
      />
    )
  }

  const can = permissionsFor(session.user)
  const value = { user: session.user, call, can }

  if (session.user.mustChangePassword) {
    return (
      <AdminContext.Provider value={value}>
        <main className="admin admin--center">
          <ChangePassword
            forced
            onDone={(user) => setSession({ ...session, user })}
            onCancel={() => {
              void call('session.logout').catch(() => undefined)
              exit()
            }}
          />
        </main>
      </AdminContext.Provider>
    )
  }

  const visible = SECTIONS.filter((s) => s.permission === null || can(s.permission))
  const logout = async () => {
    await call('session.logout').catch((e) => console.warn(errorMessage(e)))
    exit()
  }

  return (
    <AdminContext.Provider value={value}>
      <main className="admin">
        <header className="admin__bar">
          <div className="admin__who">
            <strong>Administración</strong>
            <span>
              {session.user.displayName} · {ROLE_LABELS[session.user.role]}
            </span>
          </div>
          <div className="admin__actions">
            <button type="button" className="btn" onClick={() => void logout()}>
              Cerrar sesión
            </button>
          </div>
        </header>
        <nav className="admin__nav">
          {visible.map((s) => (
            <button key={s.id} type="button" className="tab" aria-pressed={section === s.id} onClick={() => setSection(s.id)}>
              {s.label}
            </button>
          ))}
        </nav>
        <section className="admin__content">
          {section === 'dashboard' && <DashboardView />}
          {section === 'campaigns' && <CampaignsView />}
          {section === 'media' && (
            <>
              <AttractSettings />
              <MediaView />
            </>
          )}
          {section === 'participations' && <ParticipationsView />}
          {section === 'reports' && <ReportsView />}
          {section === 'audit' && <AuditView />}
          {section === 'users' && <UsersView />}
          {section === 'system' && <SystemView />}
          {section === 'account' && (
            <ChangePassword onDone={(user) => setSession({ ...session, user })} />
          )}
        </section>
      </main>
    </AdminContext.Provider>
  )
}
