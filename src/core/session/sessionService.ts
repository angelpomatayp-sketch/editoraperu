import { randomUUID } from 'node:crypto'
import type { SessionEndReason, StartSessionResult } from '../../shared/ipc'
import type { AuditLog } from '../audit/auditLog'

export type StartCheck = { ok: true } | { ok: false; reason: 'insufficient_disk' | 'unavailable' }

export interface SessionContext {
  id: string
  startedAt: Date
  /** Campaña elegida y versión de su configuración al momento de elegirla (RF-EXP-002, RF-EXP-007). */
  campaign: { id: string; configVersion: number } | null
  participationId: string | null
}

export interface SessionHooks {
  /** Se llama cuando una sesión con participación registrada termina sin completarse. */
  onAbandoned?: (participationId: string, reason: SessionEndReason | 'superseded') => void
  /** Se llama cuando una sesión con participación registrada termina completada. */
  onCompleted?: (participationId: string) => void
}

/**
 * Sesión pública temporal (RF-SES-001). Vive solo en memoria: tras un reinicio no
 * reaparece ninguna participación incompleta (RF-KIO-004).
 */
export class SessionService {
  private active: SessionContext | null = null

  constructor(
    private readonly audit: AuditLog,
    private readonly canStart: () => StartCheck,
    private readonly now: () => Date = () => new Date(),
    private readonly newId: () => string = randomUUID,
    private readonly hooks: SessionHooks = {}
  ) {}

  start(): StartSessionResult {
    const check = this.canStart()
    if (!check.ok) {
      this.audit.record({
        level: 'warn',
        category: 'session',
        action: 'start',
        result: 'denied',
        detail: { reason: check.reason }
      })
      return check
    }

    if (this.active) this.close(this.active, 'superseded')

    this.active = { id: this.newId(), startedAt: this.now(), campaign: null, participationId: null }
    this.audit.record({
      level: 'info',
      category: 'session',
      action: 'start',
      result: 'ok',
      entity: { type: 'session', id: this.active.id }
    })
    return { ok: true, sessionId: this.active.id }
  }

  /** Cierra la sesión indicada. Ignora identificadores que no corresponden a la sesión activa. */
  end(sessionId: string, reason: SessionEndReason): boolean {
    const session = this.get(sessionId)
    if (!session) return false
    this.close(session, reason)
    return true
  }

  currentId(): string | null {
    return this.active?.id ?? null
  }

  /** Contexto de la sesión activa, o `null` si el identificador no corresponde. */
  get(sessionId: string): Readonly<SessionContext> | null {
    return this.active && this.active.id === sessionId ? this.active : null
  }

  /** Registra la campaña elegida. Cambiarla solo es posible antes de registrar la participación. */
  selectCampaign(sessionId: string, campaign: { id: string; configVersion: number }): boolean {
    const session = this.get(sessionId)
    if (!session || session.participationId) return false
    this.active!.campaign = campaign
    return true
  }

  attachParticipation(sessionId: string, participationId: string): boolean {
    const session = this.get(sessionId)
    if (!session || session.participationId) return false
    this.active!.participationId = participationId
    return true
  }

  private close(session: SessionContext, reason: SessionEndReason | 'superseded'): void {
    this.active = null
    if (session.participationId) {
      if (reason === 'completed') this.hooks.onCompleted?.(session.participationId)
      else this.hooks.onAbandoned?.(session.participationId, reason)
    }
    this.audit.record({
      level: 'info',
      category: 'session',
      action: 'end',
      result: 'ok',
      entity: { type: 'session', id: session.id },
      detail: { reason, durationSeconds: Math.round((this.now().getTime() - session.startedAt.getTime()) / 1000) }
    })
  }
}
