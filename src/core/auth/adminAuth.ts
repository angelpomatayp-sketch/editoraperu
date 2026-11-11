import { randomBytes, randomUUID } from 'node:crypto'
import type { AdminUser, LoginResult, Role } from '../../shared/admin'
import type { Settings } from '../../shared/settings'
import type { AuditLog } from '../audit/auditLog'
import { hashPassword, verifyPassword } from './passwords'

export interface UserRecord {
  id: string
  username: string
  displayName: string
  role: Role
  status: 'active' | 'disabled'
  passwordHash: string
  mustChangePassword: boolean
  failedAttempts: number
  lockedUntil: string | null
  lastLoginAt: string | null
}

export interface UserRepository {
  count(): number
  findByUsername(username: string): UserRecord | null
  findById(id: string): UserRecord | null
  list(): UserRecord[]
  insert(user: { id: string; username: string; displayName: string; role: Role; passwordHash: string; mustChangePassword: boolean }, nowIso: string): void
  update(id: string, fields: Partial<Pick<UserRecord, 'displayName' | 'role' | 'status' | 'passwordHash' | 'mustChangePassword' | 'failedAttempts' | 'lockedUntil' | 'lastLoginAt'>>, nowIso: string): void
}

export interface AdminSession {
  token: string
  userId: string
  role: Role
  lastActivity: number
}

/** Hash de referencia para comparar en tiempo similar cuando el usuario no existe. */
const DUMMY_HASH = hashPassword('usuario-inexistente-0')

export function toAdminUser(user: UserRecord): AdminUser {
  return { id: user.id, username: user.username, displayName: user.displayName, role: user.role, mustChangePassword: user.mustChangePassword }
}

/**
 * Acceso al módulo administrativo (8.11): usuario y contraseña, bloqueo temporal tras intentos
 * fallidos, expiración por inactividad y cambio de contraseña. Las sesiones viven en memoria.
 */
export class AdminAuth {
  private readonly sessions = new Map<string, AdminSession>()

  constructor(
    private readonly users: UserRepository,
    private readonly settings: () => Settings,
    private readonly audit: AuditLog,
    private readonly now: () => Date = () => new Date()
  ) {}

  needsSetup(): boolean {
    return this.users.count() === 0
  }

  /** Cuenta administrativa inicial (RF-USR-002); solo mientras no exista ningún usuario. */
  setup(username: string, displayName: string, password: string): LoginResult {
    if (!this.needsSetup()) return { ok: false, error: 'invalid_credentials' }
    const id = randomUUID()
    this.users.insert({ id, username, displayName, role: 'sysadmin', passwordHash: hashPassword(password), mustChangePassword: false }, this.iso())
    this.audit.record({ level: 'info', category: 'auth', action: 'setup', result: 'ok', actor: { type: 'user', id } })
    return this.login(username, password)
  }

  login(username: string, password: string): LoginResult {
    if (this.needsSetup()) return { ok: false, error: 'setup_required' }
    const { maxFailedLogins, lockoutSeconds } = this.settings().admin
    const user = this.users.findByUsername(username.trim())
    const now = this.now()

    if (user?.lockedUntil && user.lockedUntil > now.toISOString()) {
      this.record('login', 'denied', user.id, { reason: 'locked' })
      return { ok: false, error: 'locked', retryAfterSeconds: Math.ceil((Date.parse(user.lockedUntil) - now.getTime()) / 1000) }
    }

    const valid = verifyPassword(password, user?.passwordHash ?? DUMMY_HASH) && user?.status === 'active'
    if (!user || !valid) {
      if (user) {
        const attempts = user.failedAttempts + 1
        const lock = attempts >= maxFailedLogins
        this.users.update(
          user.id,
          { failedAttempts: lock ? 0 : attempts, lockedUntil: lock ? new Date(now.getTime() + lockoutSeconds * 1000).toISOString() : null },
          this.iso()
        )
        if (lock) this.record('lockout', 'denied', user.id, { attempts })
      }
      // Nunca se registra la contraseña ingresada (RF-AUT-003).
      this.record('login', 'fail', user?.id, { reason: user ? 'wrong_password_or_disabled' : 'unknown_user' })
      return { ok: false, error: 'invalid_credentials' }
    }

    this.users.update(user.id, { failedAttempts: 0, lockedUntil: null, lastLoginAt: this.iso() }, this.iso())
    const token = randomBytes(32).toString('hex')
    this.sessions.set(token, { token, userId: user.id, role: user.role, lastActivity: now.getTime() })
    this.record('login', 'ok', user.id)
    return { ok: true, token, user: toAdminUser(user) }
  }

  /** Valida el token y renueva la actividad; `null` si no existe o expiró (RF-AUT-005). */
  session(token: string): (AdminSession & { user: UserRecord }) | null {
    const session = this.sessions.get(token)
    if (!session) return null
    const timeoutMs = this.settings().admin.sessionTimeoutSeconds * 1000
    const user = this.users.findById(session.userId)
    if (this.now().getTime() - session.lastActivity > timeoutMs || !user || user.status !== 'active') {
      this.sessions.delete(token)
      this.record('session_expired', 'ok', session.userId)
      return null
    }
    session.lastActivity = this.now().getTime()
    session.role = user.role
    return { ...session, user }
  }

  logout(token: string): void {
    const session = this.sessions.get(token)
    if (!session) return
    this.sessions.delete(token)
    this.record('logout', 'ok', session.userId)
  }

  changePassword(userId: string, current: string, next: string): boolean {
    const user = this.users.findById(userId)
    if (!user || !verifyPassword(current, user.passwordHash)) {
      this.record('password_change', 'fail', userId)
      return false
    }
    this.users.update(userId, { passwordHash: hashPassword(next), mustChangePassword: false }, this.iso())
    this.record('password_change', 'ok', userId)
    return true
  }

  /** Cierra las sesiones de un usuario (al desactivarlo o restablecer su contraseña). */
  revokeUser(userId: string): void {
    for (const [token, session] of this.sessions) if (session.userId === userId) this.sessions.delete(token)
  }

  private iso(): string {
    return this.now().toISOString()
  }

  private record(action: string, result: 'ok' | 'fail' | 'denied', userId?: string, detail?: Record<string, unknown>): void {
    this.audit.record({
      level: result === 'ok' ? 'info' : 'warn',
      category: 'auth',
      action,
      result,
      ...(userId ? { actor: { type: 'user' as const, id: userId } } : {}),
      ...(detail ? { detail } : {})
    })
  }
}
