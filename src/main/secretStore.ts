import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { safeStorage } from 'electron'

/**
 * Secretos (por ejemplo, la clave del servicio de publicación) cifrados con la protección de datos
 * de Windows (DPAPI) mediante `safeStorage` (RF-CFG-002). Nunca se devuelven a la interfaz.
 */
export class SecretStore {
  constructor(private readonly file: string) {}

  get(name: string): string | null {
    if (!existsSync(this.file) || !safeStorage.isEncryptionAvailable()) return null
    try {
      const encrypted = (JSON.parse(readFileSync(this.file, 'utf8')) as Record<string, string>)[name]
      return encrypted ? safeStorage.decryptString(Buffer.from(encrypted, 'base64')) : null
    } catch {
      return null
    }
  }

  set(name: string, value: string): void {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('El cifrado del sistema no está disponible')
    const current = existsSync(this.file) ? (JSON.parse(readFileSync(this.file, 'utf8')) as Record<string, string>) : {}
    current[name] = safeStorage.encryptString(value).toString('base64')
    writeFileSync(this.file, JSON.stringify(current, null, 2), 'utf8')
  }
}
