import { createHash, randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { DEFAULT_SETTINGS, type Settings } from '../../shared/settings'

/** Aviso específico del servicio; requiere validación institucional del banco y alojamiento. */
export function ensureDefaultConsents(db: DatabaseSync, retention: Settings['retention'] = DEFAULT_SETTINGS.retention): void {
  const retentionText = retention.enabled
    ? `Los archivos fotográficos locales se eliminan al cumplir ${retention.photoDays} días; la limpieza se ejecuta periódicamente y exige un aviso técnico previo de al menos 24 horas, por lo que los archivos antiguos pueden conservarse durante ese margen adicional. Nombres, apellidos y DNI se retiran del registro operativo al cumplir ${retention.personalDataDays} días. La constancia técnica del consentimiento y los respaldos institucionales tienen tratamiento separado; solicite al personal información sobre su conservación.`
    : 'La eliminación automática local está desactivada. Consulte al personal los plazos de conservación y el procedimiento de eliminación antes de participar.'
  const consents = [
    {
      type: 'terms_data', title: 'Información y consentimiento para el servicio fotográfico',
      body: [
        'Responsable: Empresa Peruana de Servicios Editoriales S.A. — Editora Perú, RUC 20100072751, Av. Alfonso Ugarte 873, Cercado de Lima.',
        'El servicio registra nombres, apellidos, DNI, selecciones, fotografía y constancia de aceptación para gestionar esta participación, generar la composición y atender su recuperación o solicitudes sobre sus datos. No se consulta RENIEC ni se verifica la edad mediante el DNI. Sin los campos y aceptaciones requeridos no se puede completar el recorrido actual; puede cancelar antes de confirmar.',
        'La captura y el recorte se realizan en el tótem. Solo la composición final se envía al servicio de alojamiento para su descarga. El enlace no incorpora nombre ni DNI, pero quien obtenga el QR o enlace puede acceder a su fotografía. No lo comparta si no desea que otras personas la vean.',
        retentionText,
        'Si no hay conexión, la fotografía queda guardada localmente para reintentar su publicación dentro del plazo de conservación. No se envía automáticamente por correo o mensajería: puede consultar al personal para recuperar su QR en el tótem.',
        'Puede solicitar información, acceso, rectificación, supresión, oposición o revocación a través de datospersonales@editoraperu.com.pe o de la Mesa de Partes de Editora Perú. Política institucional: https://www.editoraperu.com.pe/PrivacidadEP/Politica_Proteccion_Datos_Personales.pdf. Consulte al personal la identificación del banco de datos y del proveedor/país de alojamiento aplicables a esta campaña; no se presumen aprobados por este aviso.',
        'Si participa una persona menor de edad o actúa en nombre de otra persona, solicite asistencia del personal para gestionar la autorización correspondiente antes de registrar datos o tomar la fotografía. La aceptación en pantalla y el DNI no sustituyen la verificación de representación.',
        'He leído esta información y autorizo el tratamiento descrito para la experiencia fotográfica. Esta aceptación no autoriza publicidad, comunicaciones comerciales ni difusión de mi imagen en redes sociales.'
      ].join('\n\n')
    },
    {
      type: 'image_use', title: 'Autorización para capturar, componer y entregar mi fotografía',
      body: [
        'Autorizo a Editora Perú a capturar mi fotografía y combinarla con el escenario, personaje y demás elementos elegidos, exclusivamente para generar y entregarme la imagen de esta experiencia.',
        'Autorizo su alojamiento temporal para descargarla mediante QR. La pantalla de descarga indica la fecha real de vencimiento; la configuración prevista del servidor es de 72 horas desde la publicación exitosa. El plazo no comienza mientras la fotografía permanezca pendiente sin conexión.',
        'El QR puede mostrarse nuevamente por personal autorizado en el panel del tótem mientras la publicación siga vigente. No es una galería pública, pero cualquier persona que tenga el enlace o QR podrá acceder a la imagen.',
        'Esta autorización no incluye publicar mi fotografía en redes sociales, anuncios ni otras campañas. Esos usos necesitarían una autorización independiente. Para consultas o revocación, contacte a datospersonales@editoraperu.com.pe o al personal responsable de la campaña.'
      ].join('\n\n')
    }
  ]
  const insert = db.prepare(`INSERT INTO consent_versions (id, type, version, title, body, body_sha256, is_required, status, activated_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 1, 'active', ?, ?)`)
  db.exec('SAVEPOINT default_consents')
  try {
    for (const consent of consents) {
      // No sustituir textos institucionales cargados por otra vía.
      if (db.prepare(`SELECT 1 FROM consent_versions WHERE type = ? AND status = 'active' AND version <> '0.1-prueba' AND version NOT LIKE '1.0-totem-%'`).get(consent.type)) continue
      const hash = createHash('sha256').update(consent.body, 'utf8').digest('hex')
      const version = `1.0-totem-${hash.slice(0, 12)}`
      if (db.prepare('SELECT 1 FROM consent_versions WHERE type = ? AND version = ? AND status = ?').get(consent.type, version, 'active')) continue
      db.prepare(`UPDATE consent_versions SET status = 'retired' WHERE type = ? AND status = 'active' AND (version = '0.1-prueba' OR version LIKE '1.0-totem-%')`).run(consent.type)
      const existing = db.prepare('SELECT id FROM consent_versions WHERE type = ? AND version = ?').get(consent.type, version) as { id: string } | undefined
      if (existing) db.prepare("UPDATE consent_versions SET status = 'active' WHERE id = ?").run(existing.id)
      else { const now = new Date().toISOString(); insert.run(randomUUID(), consent.type, version, consent.title, consent.body, hash, now, now) }
    }
    db.exec('RELEASE default_consents')
  } catch (error) { db.exec('ROLLBACK TO default_consents; RELEASE default_consents'); throw error }
}
