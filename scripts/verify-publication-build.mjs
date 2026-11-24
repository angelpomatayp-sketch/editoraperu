import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/** Nunca imprime la clave ni el código del paquete. Verifica el valor efectivo de la constante. */
export function verifyPublicationBuild(code) {
  const expected = JSON.parse(readFileSync(resolve('.data/config/publicador-produccion.json'), 'utf8'))
  if (!expected.baseUrl || typeof expected.secret !== 'string' || expected.secret.length < 32) {
    throw new Error('Configuración local del publicador incompleta.')
  }
  if (/BUILT_IN_PUBLICATION\s*=\s*null/.test(code) || !code.includes(JSON.stringify(expected.baseUrl)) || !code.includes(JSON.stringify(expected.secret))) {
    throw new Error('El publicador no está incluido correctamente en la compilación. No distribuya este instalador.')
  }
}
