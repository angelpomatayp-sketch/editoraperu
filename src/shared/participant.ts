import { z } from 'zod'

/** Longitudes provisionales hasta su aprobación (RF-REG-002, pendiente). */
export const NAME_MIN_LENGTH = 2
export const NAME_MAX_LENGTH = 60
export const DNI_LENGTH = 8

/** Letras (con tildes, diéresis y ñ) separadas por un espacio, apóstrofe o guion (RF-REG-002). */
const NAME_PATTERN = /^(?:\p{L}\p{M}*)+(?:[ '’-](?:\p{L}\p{M}*)+)*$/u

/** Quita espacios al inicio y al final y reduce los espacios repetidos. */
export function normalizeName(value: string): string {
  return value.normalize('NFC').trim().replace(/\s+/g, ' ')
}

function nameField(label: string) {
  return z
    .string()
    .transform(normalizeName)
    .pipe(
      z
        .string()
        .min(1, `Ingrese sus ${label}`)
        .min(NAME_MIN_LENGTH, `Sus ${label} deben tener al menos ${NAME_MIN_LENGTH} letras`)
        .max(NAME_MAX_LENGTH, `Sus ${label} no pueden superar ${NAME_MAX_LENGTH} caracteres`)
        .regex(NAME_PATTERN, `Use solo letras en sus ${label}`)
    )
}

export const participantSchema = z.object({
  firstNames: nameField('nombres'),
  lastNames: nameField('apellidos'),
  /** DNI peruano: exactamente ocho dígitos (RF-REG-003). */
  dni: z
    .string()
    .transform((value) => value.trim())
    .pipe(z.string().regex(/^\d{8}$/, `El DNI debe tener ${DNI_LENGTH} dígitos`))
})

export type ParticipantInput = z.input<typeof participantSchema>
export type Participant = z.output<typeof participantSchema>
export type ParticipantField = keyof ParticipantInput
export type ParticipantFieldErrors = Partial<Record<ParticipantField, string>>

export function validateParticipant(
  input: ParticipantInput
): { ok: true; data: Participant } | { ok: false; errors: ParticipantFieldErrors } {
  const parsed = participantSchema.safeParse(input)
  if (parsed.success) return { ok: true, data: parsed.data }
  const errors: ParticipantFieldErrors = {}
  for (const issue of parsed.error.issues) {
    const field = issue.path[0] as ParticipantField
    errors[field] ??= issue.message
  }
  return { ok: false, errors }
}
