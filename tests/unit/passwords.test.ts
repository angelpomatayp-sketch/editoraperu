import { describe, expect, it } from 'vitest'
import { hashPassword, verifyPassword } from '../../src/core/auth/passwords'
import { can, passwordProblem, ROLE_PERMISSIONS } from '../../src/shared/admin'

describe('contraseñas (RF-AUT-002)', () => {
  it('se guardan derivadas con scrypt y sal, nunca legibles', () => {
    const hash = hashPassword('Clave segura 2026')
    expect(hash).toMatch(/^scrypt\$16384\$8\$1\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/)
    expect(hash).not.toContain('Clave')
    expect(hashPassword('Clave segura 2026')).not.toBe(hash)
  })

  it('verifica la correcta y rechaza las demás', () => {
    const hash = hashPassword('Contraseña1234')
    expect(verifyPassword('Contraseña1234', hash)).toBe(true)
    expect(verifyPassword('contraseña1234', hash)).toBe(false)
    expect(verifyPassword('', hash)).toBe(false)
    expect(verifyPassword('Contraseña1234', 'formato-invalido')).toBe(false)
  })

  it('aplica la política provisional', () => {
    expect(passwordProblem('corta1')).toMatch(/al menos/)
    expect(passwordProblem('solamenteletras')).toMatch(/letras y números/)
    expect(passwordProblem('1234567890')).toMatch(/letras y números/)
    expect(passwordProblem('editora2026')).toBeNull()
  })
})

describe('matriz de permisos (sección 14)', () => {
  it('cada rol tiene solo sus funciones', () => {
    expect(can('content', 'campaigns.manage')).toBe(true)
    expect(can('content', 'users.manage')).toBe(false)
    expect(can('operator', 'campaigns.manage')).toBe(false)
    expect(can('operator', 'kiosk.exit')).toBe(true)
    expect(can('operator', 'settings.publication')).toBe(false)
    expect(can('operator', 'publication.retry')).toBe(true)
    expect(can('content', 'participations.personal')).toBe(false)
    expect(can('content', 'audit.view')).toBe(false)
    expect(can('content', 'audit.viewContent')).toBe(true)
    // El administrador del sistema tiene todos los permisos definidos.
    const all = new Set([...ROLE_PERMISSIONS.content, ...ROLE_PERMISSIONS.operator, ...ROLE_PERMISSIONS.sysadmin])
    expect(new Set(ROLE_PERMISSIONS.sysadmin)).toEqual(all)
  })
})
