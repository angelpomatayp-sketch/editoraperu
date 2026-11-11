import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'

const N = 16384
const R = 8
const P = 1
const KEY_LENGTH = 64

/**
 * Derivación segura de contraseñas con scrypt y sal aleatoria por usuario (RF-AUT-002).
 * Formato guardado: `scrypt$N$r$p$sal$derivada` (base64). La contraseña nunca se guarda legible.
 */
export function hashPassword(password: string): string {
  const salt = randomBytes(16)
  const derived = scryptSync(password.normalize('NFC'), salt, KEY_LENGTH, { N, r: R, p: P })
  return ['scrypt', N, R, P, salt.toString('base64'), derived.toString('base64')].join('$')
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, n, r, p, salt, hash] = stored.split('$')
  if (scheme !== 'scrypt' || !n || !r || !p || !salt || !hash) return false
  const expected = Buffer.from(hash, 'base64')
  const derived = scryptSync(password.normalize('NFC'), Buffer.from(salt, 'base64'), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p)
  })
  return timingSafeEqual(derived, expected)
}
