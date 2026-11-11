import type { z } from 'zod'
import {
  adminInputs,
  can,
  loginSchema,
  setupSchema,
  type AdminMethod,
  type AdminResult,
  type AdminStatus,
  type LoginResult,
  type SetupResult,
  type Permission,
  type Role
} from '../../shared/admin'
import type { AuditLog } from '../../core/audit/auditLog'
import { toAdminUser, type AdminAuth } from '../../core/auth/adminAuth'
import type { AttractAdmin } from './attractAdmin'
import { AdminError, type ContentAdmin } from './contentAdmin'
import { buildDashboard, type DashboardDeps } from './dashboard'
import type { Maintenance } from './maintenance'
import type { OperationsAdmin } from './operationsAdmin'
import type { SettingsAdmin } from './settingsAdmin'
import type { UsersAdmin } from './usersAdmin'

export interface AdminApiDeps {
  auth: AdminAuth
  content: ContentAdmin
  attract: AttractAdmin
  users: UsersAdmin
  settings: SettingsAdmin
  dashboard: DashboardDeps
  operations: OperationsAdmin
  maintenance: Maintenance
  audit: AuditLog
  /** Cierre controlado de la aplicación (RF-KIO-005). */
  quit: (actorId: string) => void
}

interface Caller {
  userId: string
  token: string
  role: Role
}

type Handler<M extends AdminMethod> = (input: z.output<(typeof adminInputs)[M]>, caller: Caller) => unknown

interface Operation<M extends AdminMethod> {
  /** `null`: cualquier usuario autenticado (su propia sesión). */
  permission: Permission | null
  handler: Handler<M>
}

/** Operaciones disponibles y el permiso que exige cada una (sección 14). */
function operations(deps: AdminApiDeps): { [M in AdminMethod]: Operation<M> } {
  const { content, users, settings, auth, operations: ops, maintenance } = deps
  /** Quien consulta, con o sin acceso a datos personales (RN-008). */
  const viewer = (c: Caller) => ({ userId: c.userId, personal: can(c.role, 'participations.personal') })
  return {
    'session.me': { permission: null, handler: (_i, c) => toAdminUser(deps.auth.session(c.token)!.user) },
    'session.changePassword': {
      permission: null,
      handler: (i, c) => {
        if (!auth.changePassword(c.userId, i.current, i.next)) throw new AdminError('wrong_password', 'La contraseña actual no es correcta')
        return toAdminUser(auth.session(c.token)!.user)
      }
    },
    'session.logout': { permission: null, handler: (_i, c) => auth.logout(c.token) },

    'dashboard.get': { permission: 'dashboard.view', handler: () => buildDashboard(deps.dashboard) },

    'campaigns.list': { permission: 'campaigns.manage', handler: () => content.listCampaigns() },
    'campaigns.get': { permission: 'campaigns.manage', handler: (i) => content.getCampaign(i.id) },
    'campaigns.create': { permission: 'campaigns.manage', handler: (i, c) => content.createCampaign(i.name, c.userId) },
    'campaigns.update': { permission: 'campaigns.manage', handler: (i, c) => content.updateCampaign(i, c.userId) },
    'campaigns.setStatus': { permission: 'campaigns.manage', handler: (i, c) => content.setStatus(i.id, i.status, c.userId) },
    'campaigns.setImage': { permission: 'campaigns.manage', handler: (i, c) => content.setImage(i.id, c.userId) },
    'campaigns.saveLayout': { permission: 'campaigns.manage', handler: (i, c) => content.saveLayout(i, c.userId) },
    'resources.add': { permission: 'campaigns.manage', handler: (i, c) => content.addResource(i, c.userId) },
    'resources.update': { permission: 'campaigns.manage', handler: (i, c) => content.updateResource(i, c.userId) },
    'resources.setAnimation': { permission: 'campaigns.manage', handler: (i, c) => content.setCharacterAnimation(i, c.userId) },
    'resources.clearAnimation': { permission: 'campaigns.manage', handler: (i, c) => content.clearCharacterAnimation(i, c.userId) },
    'resources.updateMotion': { permission: 'campaigns.manage', handler: (i, c) => content.updateCharacterMotion(i, c.userId) },
    'resources.move': { permission: 'campaigns.manage', handler: (i, c) => content.moveResource(i.campaignId, i.resourceId, i.direction, c.userId) },
    'resources.remove': { permission: 'campaigns.manage', handler: (i, c) => content.removeResource(i.campaignId, i.resourceId, c.userId) },

    'media.list': { permission: 'media.manage', handler: () => content.listMedia() },
    'media.add': { permission: 'media.manage', handler: (_i, c) => content.addMedia(c.userId) },
    'media.update': { permission: 'media.manage', handler: (i, c) => content.updateMedia(i, c.userId) },
    'media.move': { permission: 'media.manage', handler: (i, c) => content.moveMedia(i.id, i.direction, c.userId) },
    'media.remove': { permission: 'media.manage', handler: (i, c) => content.removeMedia(i.id, c.userId) },
    'attract.get': { permission: 'media.manage', handler: () => deps.attract.get() },
    'attract.save': { permission: 'media.manage', handler: (i, c) => deps.attract.save(i, c.userId) },
    'attract.setImage': { permission: 'media.manage', handler: (i, c) => deps.attract.setImage(i.kind, c.userId) },
    'attract.clearImage': { permission: 'media.manage', handler: (i, c) => deps.attract.clearImage(i.kind, c.userId) },

    'users.list': { permission: 'users.manage', handler: () => users.list() },
    'users.create': { permission: 'users.manage', handler: (i, c) => users.create(i, c.userId) },
    'users.update': { permission: 'users.manage', handler: (i, c) => users.update(i, c.userId) },
    'users.resetPassword': { permission: 'users.manage', handler: (i, c) => users.resetPassword(i.id, i.password, c.userId) },

    'settings.getPublication': { permission: 'settings.publication', handler: () => settings.getPublication() },
    'settings.savePublication': { permission: 'settings.publication', handler: (i, c) => settings.savePublication(i.baseUrl, i.secret, c.userId) },
    'settings.testPublication': { permission: 'settings.publication', handler: () => settings.testPublication() },
    'settings.getBackground': { permission: 'settings.chroma', handler: () => settings.getBackground() },
    'settings.saveBackground': { permission: 'settings.chroma', handler: (i, c) => settings.saveBackground(i, c.userId) },

    'system.quit': { permission: 'kiosk.exit', handler: (_i, c) => deps.quit(c.userId) },

    'participations.list': { permission: 'participations.view', handler: (i, c) => ops.list(i, i.page, viewer(c)) },
    'participations.get': { permission: 'participations.view', handler: (i, c) => ops.get(i.id, viewer(c)) },
    'participations.photo': { permission: 'participations.personal', handler: (i, c) => ops.photo(i.photoId, viewer(c)) },
    'participations.delete': { permission: 'participations.delete', handler: (i, c) => ops.delete(i.id, i.reason, viewer(c)) },
    'publication.retry': { permission: 'publication.retry', handler: (i, c) => ops.retry(i.photoId, viewer(c)) },

    'reports.participations': { permission: 'reports.export', handler: (i, c) => ops.exportParticipations(i, viewer(c)) },
    'reports.summary': { permission: 'reports.export', handler: (i) => ops.summary(i) },
    'reports.audit': { permission: 'audit.view', handler: (i, c) => ops.exportAudit(i, true, viewer(c)) },

    'audit.list': { permission: 'audit.viewContent', handler: (i, c) => ops.auditPage(i, i.page, can(c.role, 'audit.view')) },

    'settings.getGeneral': { permission: 'settings.general', handler: () => settings.getGeneral() },
    'settings.saveGeneral': { permission: 'settings.general', handler: (i, c) => settings.saveGeneral(i, c.userId) },
    'settings.exportConfig': { permission: 'settings.general', handler: (_i, c) => maintenance.exportConfig(c.userId) },
    'settings.importConfig': { permission: 'settings.general', handler: (_i, c) => maintenance.importConfig(c.userId) },

    'maintenance.status': { permission: 'maintenance.backup', handler: () => maintenance.status() },
    'maintenance.backup': { permission: 'maintenance.backup', handler: (i, c) => maintenance.backup(i.includePhotos, c.userId) },
    'maintenance.runRetention': { permission: 'settings.general', handler: (_i, c) => maintenance.runRetention({ type: 'user', id: c.userId }) }
  }
}

function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? 'Datos inválidos'
}

/**
 * Punto de entrada del panel desde la interfaz. Toda operación pasa por aquí: se valida el token,
 * se renueva la sesión, se verifica el permiso del rol y los datos de entrada (RF-AUT-006).
 */
export class AdminApi {
  private readonly ops: ReturnType<typeof operations>

  constructor(private readonly deps: AdminApiDeps) {
    this.ops = operations(deps)
  }

  status(): AdminStatus {
    return { setupRequired: this.deps.auth.needsSetup() }
  }

  setup(payload: unknown): SetupResult {
    const parsed = setupSchema.safeParse(payload)
    if (!parsed.success) return { ok: false, error: 'invalid_input', message: firstIssue(parsed.error) }
    return this.deps.auth.setup(parsed.data.username, parsed.data.displayName, parsed.data.password)
  }

  login(payload: unknown): LoginResult {
    const parsed = loginSchema.safeParse(payload)
    if (!parsed.success) return { ok: false, error: 'invalid_credentials' }
    return this.deps.auth.login(parsed.data.username, parsed.data.password)
  }

  async invoke(token: unknown, method: unknown, payload: unknown): Promise<AdminResult<unknown>> {
    const session = typeof token === 'string' ? this.deps.auth.session(token) : null
    if (!session) return { ok: false, error: 'session_expired', message: 'La sesión expiró. Ingrese nuevamente.' }
    if (typeof method !== 'string' || !Object.hasOwn(this.ops, method)) {
      return { ok: false, error: 'unknown_method', message: 'Operación no disponible' }
    }
    const name = method as AdminMethod
    const op = this.ops[name] as Operation<AdminMethod>

    if (op.permission && !can(session.role, op.permission)) {
      this.deps.audit.record({
        level: 'warn',
        category: 'auth',
        action: 'permission',
        result: 'denied',
        actor: { type: 'user', id: session.userId },
        detail: { method: name }
      })
      return { ok: false, error: 'forbidden', message: 'Su rol no tiene permiso para esta operación' }
    }
    // Con contraseña temporal, solo se permite cambiarla (RF-USR-002, RF-AUT-004).
    if (session.user.mustChangePassword && !name.startsWith('session.')) {
      return { ok: false, error: 'password_change_required', message: 'Debe cambiar su contraseña antes de continuar' }
    }

    const parsed = adminInputs[name].safeParse(payload ?? {})
    if (!parsed.success) return { ok: false, error: 'invalid_input', message: firstIssue(parsed.error) }

    try {
      const data = await op.handler(parsed.data as never, { userId: session.userId, token: session.token, role: session.role })
      return { ok: true, data: data ?? null }
    } catch (error) {
      if (error instanceof AdminError) return { ok: false, error: error.code, message: error.message }
      this.deps.audit.record({
        level: 'error',
        category: 'system',
        action: 'admin.error',
        result: 'fail',
        actor: { type: 'user', id: session.userId },
        detail: { method: name, error }
      })
      return { ok: false, error: 'server_error', message: 'Ocurrió un error inesperado; quedó registrado en la bitácora' }
    }
  }
}
