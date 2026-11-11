import { createContext, useContext } from 'react'
import { can, type AdminMethod, type AdminUser, type Permission } from '../../../shared/admin'

export class AdminCallError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message)
    this.name = 'AdminCallError'
  }
}

export interface AdminContextValue {
  user: AdminUser
  call: <T>(method: AdminMethod, payload?: unknown) => Promise<T>
  can: (permission: Permission) => boolean
}

/** Crea la función de llamada al panel; una sesión vencida devuelve al acceso (RF-AUT-005). */
export function adminCaller(token: string, onExpired: () => void) {
  return async <T,>(method: AdminMethod, payload?: unknown): Promise<T> => {
    const result = await window.totem.admin(token, method, payload)
    if (!result.ok) {
      if (result.error === 'session_expired') onExpired()
      throw new AdminCallError(result.error, result.message)
    }
    return result.data as T
  }
}

export function permissionsFor(user: AdminUser) {
  return (permission: Permission) => can(user.role, permission)
}

export const AdminContext = createContext<AdminContextValue | null>(null)

export function useAdmin(): AdminContextValue {
  const value = useContext(AdminContext)
  if (!value) throw new Error('Fuera del panel de administración')
  return value
}

/** Mensaje legible de un error del panel. */
export function errorMessage(error: unknown): string {
  return error instanceof AdminCallError || error instanceof Error ? error.message : 'Ocurrió un error inesperado'
}
