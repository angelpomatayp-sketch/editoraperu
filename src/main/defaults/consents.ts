import { createHash, randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'

/**
 * Textos legales incluidos con la aplicación. Son de prueba hasta que Editora Perú entregue los
 * definitivos (PD-008); sin textos activos nadie puede registrarse.
 */
const CONSENTS = [
  {
    type: 'terms_data',
    version: '0.1-prueba',
    title: 'Términos de uso y tratamiento de datos personales',
    body: [
      'TEXTO DE PRUEBA. El texto definitivo será entregado y aprobado por Editora Perú (PD-008).',
      'Al participar, usted autoriza a Editora Perú a registrar sus nombres, apellidos y número de DNI con la finalidad de gestionar su participación en la campaña.',
      'Sus datos se conservarán durante el plazo establecido en la política aprobada y no serán compartidos con terceros fuera de los casos previstos por la normativa aplicable.',
      'Usted puede ejercer sus derechos de acceso, rectificación, cancelación y oposición conforme a la Ley N.° 29733, Ley de Protección de Datos Personales, y su reglamento.'
    ].join('\n\n')
  },
  {
    type: 'image_use',
    version: '0.1-prueba',
    title: 'Autorización de uso de imagen',
    body: [
      'TEXTO DE PRUEBA. El texto definitivo será entregado y aprobado por Editora Perú (PD-008).',
      'Usted autoriza la captura de su fotografía en el tótem y su composición con los elementos gráficos de la campaña seleccionada.',
      'La fotografía se publicará temporalmente para que pueda descargarla mediante un código QR y será eliminada al vencer el plazo establecido.'
    ].join('\n\n')
  }
]

/** Crea los textos legales incluidos si todavía no existen; los ya aceptados nunca se modifican. */
export function ensureDefaultConsents(db: DatabaseSync): void {
  const consentExists = db.prepare('SELECT 1 FROM consent_versions WHERE type = ? AND version = ?')
  const insertConsent = db.prepare(
    `INSERT INTO consent_versions (id, type, version, title, body, body_sha256, is_required, status, activated_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 1, 'active', ?, ?)`
  )
  for (const consent of CONSENTS) {
    if (consentExists.get(consent.type, consent.version)) continue
    const now = new Date().toISOString()
    const hash = createHash('sha256').update(consent.body, 'utf8').digest('hex')
    insertConsent.run(randomUUID(), consent.type, consent.version, consent.title, consent.body, hash, now, now)
  }
}
