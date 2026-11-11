import { randomUUID } from 'node:crypto'
import type { CampaignDetail, Selections } from '../../shared/campaign'
import { autoFrameId, charactersForScenario, maxCharacters } from '../../shared/campaign'
import { validateParticipant, type Participant } from '../../shared/participant'
import type { RegistrationInput, RegistrationResult } from '../../shared/registration'
import type { AuditLog } from '../audit/auditLog'
import type { CampaignCatalog } from '../campaigns/campaignCatalog'
import type { ConsentRepository } from '../consents/consentRepository'
import type { SessionService } from '../session/sessionService'

export interface NewParticipation {
  id: string
  campaignId: string
  campaignConfigVersion: number
  participant: Participant
  selections: Selections
  startedAt: string
  confirmedAt: string
  consents: { versionId: string; accepted: boolean }[]
}

export interface ParticipationRepository {
  /** Guarda la participación y la evidencia de sus consentimientos en una sola transacción. */
  insertWithConsents(participation: NewParticipation): void
  /** Marca como cancelada una participación registrada que no llegó a completarse. */
  markCancelled(participationId: string, finishedAt: string): void
  /** Marca como completada una participación con su fotografía compuesta. */
  markCompleted(participationId: string, finishedAt: string): void
  /**
   * Al iniciar no hay ninguna sesión en curso: las participaciones que quedaron a medias por un
   * cierre inesperado se cierran como canceladas (RF-KIO-004). Devuelve cuántas.
   */
  closeInterrupted(finishedAt: string): number
}

/** Valida las selecciones contra la campaña; devuelve las selecciones normalizadas o `null`. */
export function resolveSelections(detail: CampaignDetail, input: Selections): Selections | null {
  const has = (list: { id: string }[], id: string | null) => id !== null && list.some((o) => o.id === id)

  if (!has(detail.scenarios, input.scenarioId)) return null

  // Personajes: sin repetir, de la campaña y dentro del máximo de posiciones configuradas.
  const characterIds = input.characterIds
  if (characterIds.length > maxCharacters(detail, input.scenarioId)) return null
  if (new Set(characterIds).size !== characterIds.length) return null
  const available = charactersForScenario(detail, input.scenarioId)
  if (!characterIds.every((id) => has(available, id))) return null
  if (detail.characterMode === 'required' && characterIds.length === 0) return null

  let frameId: string | null = null
  const auto = autoFrameId(detail)
  if (auto) {
    if (input.frameId !== null && input.frameId !== auto) return null
    frameId = auto
  } else if (detail.frameMode === 'required') {
    if (!has(detail.frames, input.frameId)) return null
    frameId = input.frameId
  } else if (detail.frameMode === 'optional' && input.frameId !== null) {
    if (!has(detail.frames, input.frameId)) return null
    frameId = input.frameId
  } else if (input.frameId !== null) {
    return null
  }

  return { scenarioId: input.scenarioId, characterIds: [...characterIds], frameId }
}

/**
 * Registro de la participación con sus consentimientos (8.5, 8.6). Todo se valida nuevamente
 * en el proceso principal, sin confiar en la interfaz. Los datos personales se guardan solo
 * cuando se aceptaron todos los consentimientos obligatorios (RN-002).
 */
export class RegistrationService {
  constructor(
    private readonly sessions: SessionService,
    private readonly catalog: CampaignCatalog,
    private readonly consents: ConsentRepository,
    private readonly participations: ParticipationRepository,
    private readonly audit: AuditLog,
    private readonly now: () => Date = () => new Date(),
    private readonly newId: () => string = randomUUID
  ) {}

  register(input: RegistrationInput): RegistrationResult {
    const session = this.sessions.get(input.sessionId)
    if (!session || session.participationId) return this.fail('session_invalid')
    if (!session.campaign || session.campaign.id !== input.campaignId) return this.fail('campaign_unavailable')

    const detail = this.catalog.getDetail(input.campaignId, { allowInactive: true })
    if (!detail) return this.fail('campaign_unavailable')

    const selections = resolveSelections(detail, input.selections)
    if (!selections) return this.fail('invalid_selection')

    const participant = validateParticipant(input.participant)
    if (!participant.ok) return { ok: false, error: 'invalid_data', fields: participant.errors }

    const active = this.consents.listActive()
    const answers = new Map(input.consents.map((c) => [c.versionId, c.accepted]))
    if ([...answers.keys()].some((id) => !active.some((c) => c.id === id))) return this.fail('consent_outdated')
    if (active.some((c) => c.isRequired && answers.get(c.id) !== true)) return this.fail('consent_missing')

    const id = this.newId()
    try {
      this.participations.insertWithConsents({
        id,
        campaignId: detail.id,
        campaignConfigVersion: session.campaign.configVersion,
        participant: participant.data,
        selections,
        startedAt: session.startedAt.toISOString(),
        confirmedAt: this.now().toISOString(),
        consents: active.map((c) => ({ versionId: c.id, accepted: answers.get(c.id) === true }))
      })
    } catch (error) {
      this.audit.record({
        level: 'error',
        category: 'session',
        action: 'participation.register',
        result: 'fail',
        detail: { error }
      })
      return { ok: false, error: 'storage_error' }
    }

    this.sessions.attachParticipation(input.sessionId, id)
    this.audit.record({
      level: 'info',
      category: 'session',
      action: 'participation.register',
      result: 'ok',
      entity: { type: 'participation', id },
      detail: { campaignId: detail.id, consentVersions: active.map((c) => `${c.type}@${c.version}`) }
    })
    return { ok: true, participationId: id }
  }

  private fail(error: Exclude<RegistrationResult, { ok: true }>['error']): RegistrationResult {
    this.audit.record({
      level: 'warn',
      category: 'session',
      action: 'participation.register',
      result: 'denied',
      detail: { reason: error }
    })
    return { ok: false, error }
  }
}
