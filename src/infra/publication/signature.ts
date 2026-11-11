import { createHash, createHmac } from 'node:crypto'

/**
 * Firma HMAC-SHA256 de una solicitud al servicio de publicación. El texto firmado es:
 *   MÉTODO \n RUTA \n MARCA_DE_TIEMPO \n SHA256_HEX(CUERPO)
 * Debe coincidir con `Signature::canonical` en publicador/app/Signature.php.
 */
export function signRequest(secret: string, method: string, path: string, timestamp: string, body: Uint8Array): string {
  const bodyHash = createHash('sha256').update(body).digest('hex')
  const canonical = `${method.toUpperCase()}\n${path}\n${timestamp}\n${bodyHash}`
  return createHmac('sha256', secret).update(canonical, 'utf8').digest('hex')
}
