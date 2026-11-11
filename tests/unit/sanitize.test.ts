import { describe, expect, it } from 'vitest'
import { REDACTED, sanitize } from '../../src/core/audit/sanitize'

describe('sanitize (RF-BIT-003)', () => {
  it('omite contraseñas, tokens y datos personales en cualquier nivel', () => {
    const result = sanitize({
      username: 'admin',
      password: 'secreta',
      nested: { dni: '12345678', firstNames: 'Ana', publicToken: 'abc', campaign: 'c1' },
      list: [{ apiKey: 'k', ok: true }]
    })
    expect(result).toEqual({
      username: 'admin',
      password: REDACTED,
      nested: { dni: REDACTED, firstNames: REDACTED, publicToken: REDACTED, campaign: 'c1' },
      list: [{ apiKey: REDACTED, ok: true }]
    })
  })

  it('reduce los errores a nombre y mensaje, sin pila', () => {
    expect(sanitize({ error: new TypeError('fallo') })).toEqual({ error: { name: 'TypeError', message: 'fallo' } })
  })

  it('limita la profundidad', () => {
    const deep = { a: { b: { c: { d: { e: { f: { g: 1 } } } } } } }
    expect(JSON.stringify(sanitize(deep))).toContain('profundidad excedida')
  })
})
