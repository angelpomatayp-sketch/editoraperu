import QRCode from 'qrcode'

/**
 * QR de la URL pública, con margen y contraste suficientes para leerlo desde un teléfono
 * (RF-QR-003). Codifica solo la URL: ningún dato personal ni ruta local.
 */
export function qrDataUrl(url: string): Promise<string> {
  return QRCode.toDataURL(url, {
    errorCorrectionLevel: 'M',
    margin: 4,
    width: 720,
    color: { dark: '#000000', light: '#ffffff' }
  })
}
