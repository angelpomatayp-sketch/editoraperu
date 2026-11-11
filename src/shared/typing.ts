const SEPARATORS = /[ '’-]$/

/** La próxima letra va en mayúscula al inicio y después de un espacio, apóstrofe o guion. */
export function shouldAutoCapitalize(value: string): boolean {
  return value === '' || SEPARATORS.test(value)
}

/**
 * Agrega una tecla a un nombre. Aplica la mayúscula automática (invertida si `shift` está activo),
 * evita separadores al inicio o repetidos y respeta la longitud máxima.
 */
export function typeNameKey(value: string, key: string, shift: boolean, maxLength: number): string {
  if (value.length >= maxLength) return value
  if (/^[ '’-]$/.test(key)) return value === '' || SEPARATORS.test(value) ? value : value + key
  const upper = shouldAutoCapitalize(value) !== shift
  return value + (upper ? key.toLocaleUpperCase('es-PE') : key.toLocaleLowerCase('es-PE'))
}

/** Agrega un dígito al DNI respetando la longitud máxima. */
export function typeDigitKey(value: string, key: string, maxLength: number): string {
  return /^\d$/.test(key) && value.length < maxLength ? value + key : value
}
