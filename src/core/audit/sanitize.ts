/**
 * Elimina valores sensibles antes de escribir en la bitácora (RF-BIT-003).
 * Se aplica por nombre de clave: contraseñas, secretos, tokens y datos personales.
 */
const SENSITIVE_KEY =
  /pass(word)?|contrase|secret|token|hmac|api[-_]?key|credential|dni|document|first_?names?|last_?names?|nombres?|apellidos?/i

export const REDACTED = '[omitido]'

const MAX_DEPTH = 5

export function sanitize(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return '[profundidad excedida]'
  if (value instanceof Error) return { name: value.name, message: value.message }
  if (Array.isArray(value)) return value.map((item) => sanitize(item, depth + 1))
  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value)) {
      result[key] = SENSITIVE_KEY.test(key) ? REDACTED : sanitize(item, depth + 1)
    }
    return result
  }
  return value
}
