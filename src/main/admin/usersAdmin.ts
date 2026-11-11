import { randomUUID } from 'node:crypto'
import type { AdminInput, AdminUserRow } from '../../shared/admin'
import type { AuditLog } from '../../core/audit/auditLog'
import { toAdminUser, type AdminAuth, type UserRepository } from '../../core/auth/adminAuth'
import { hashPassword } from '../../core/auth/passwords'
import { AdminError } from './contentAdmin'

/**
 * Usuarios administrativos (8.23). Desactivar no elimina el historial (RF-USR-001) y siempre debe
 * quedar al menos un administrador del sistema activo.
 */
export class UsersAdmin {
  constructor(
    private readonly users: UserRepository,
    private readonly auth: AdminAuth,
    private readonly audit: AuditLog,
    private readonly now: () => Date = () => new Date()
  ) {}

  list(): AdminUserRow[] {
    const nowIso = this.now().toISOString()
    return this.users.list().map((u) => ({
      ...toAdminUser(u),
      active: u.status === 'active',
      lastLoginAt: u.lastLoginAt,
      locked: Boolean(u.lockedUntil && u.lockedUntil > nowIso)
    }))
  }

  create(input: AdminInput<'users.create'>, actorId: string): AdminUserRow[] {
    if (this.users.findByUsername(input.username)) throw new AdminError('duplicate', 'Ya existe un usuario con ese nombre')
    const id = randomUUID()
    // La contraseña inicial se cambia en el primer acceso (RF-USR-002).
    this.users.insert(
      { id, username: input.username, displayName: input.displayName, role: input.role, passwordHash: hashPassword(input.password), mustChangePassword: true },
      this.now().toISOString()
    )
    this.record('user.create', id, actorId, { role: input.role })
    return this.list()
  }

  update(input: AdminInput<'users.update'>, actorId: string): AdminUserRow[] {
    const user = this.users.findById(input.id)
    if (!user) throw new AdminError('not_found', 'El usuario no existe')
    if (input.id === actorId && !input.active) throw new AdminError('self', 'No puede desactivar su propia cuenta')
    const losesAdmin = user.role === 'sysadmin' && user.status === 'active' && (input.role !== 'sysadmin' || !input.active)
    if (losesAdmin && this.activeSysadmins() <= 1) {
      throw new AdminError('last_admin', 'Debe quedar al menos un administrador del sistema activo')
    }
    this.users.update(input.id, { displayName: input.displayName, role: input.role, status: input.active ? 'active' : 'disabled' }, this.now().toISOString())
    if (!input.active) this.auth.revokeUser(input.id)
    this.record('user.update', input.id, actorId, { role: input.role, active: input.active })
    return this.list()
  }

  /** Restablecimiento controlado: contraseña temporal que se cambia en el siguiente acceso (RF-AUT-004). */
  resetPassword(id: string, password: string, actorId: string): AdminUserRow[] {
    if (!this.users.findById(id)) throw new AdminError('not_found', 'El usuario no existe')
    this.users.update(
      id,
      { passwordHash: hashPassword(password), mustChangePassword: true, failedAttempts: 0, lockedUntil: null },
      this.now().toISOString()
    )
    this.auth.revokeUser(id)
    this.record('user.reset_password', id, actorId)
    return this.list()
  }

  private activeSysadmins(): number {
    return this.users.list().filter((u) => u.role === 'sysadmin' && u.status === 'active').length
  }

  private record(action: string, userId: string, actorId: string, detail?: Record<string, unknown>): void {
    this.audit.record({
      level: 'info',
      category: 'auth',
      action,
      result: 'ok',
      actor: { type: 'user', id: actorId },
      entity: { type: 'user', id: userId },
      ...(detail ? { detail } : {})
    })
  }
}
