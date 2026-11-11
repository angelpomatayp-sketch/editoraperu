import { z } from 'zod'
import { MAX_CHARACTERS } from './campaign'
import type { ParticipantFieldErrors } from './participant'

/** Texto legal vigente mostrado al participante (RF-CON-001). */
export interface ConsentText {
  id: string
  type: string
  version: string
  title: string
  body: string
  isRequired: boolean
}

const id = z.string().min(1).max(64)

/** Datos que la interfaz envía al confirmar el registro y los consentimientos. */
export const registrationInputSchema = z.object({
  sessionId: z.uuid(),
  campaignId: id,
  selections: z.object({
    scenarioId: id,
    characterIds: z.array(id).max(MAX_CHARACTERS),
    frameId: id.nullable()
  }),
  participant: z.object({
    firstNames: z.string().max(200),
    lastNames: z.string().max(200),
    dni: z.string().max(20)
  }),
  consents: z.array(z.object({ versionId: id, accepted: z.boolean() })).max(20)
})

export type RegistrationInput = z.infer<typeof registrationInputSchema>

export type RegistrationError =
  | 'session_invalid'
  | 'campaign_unavailable'
  | 'invalid_selection'
  | 'invalid_data'
  | 'consent_missing'
  | 'consent_outdated'
  | 'storage_error'

export type RegistrationResult =
  | { ok: true; participationId: string }
  | { ok: false; error: RegistrationError; fields?: ParticipantFieldErrors }
