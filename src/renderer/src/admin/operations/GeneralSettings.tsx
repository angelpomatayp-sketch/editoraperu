import { useEffect, useState } from 'react'
import type { Settings } from '../../../../shared/settings'
import { errorMessage, useAdmin } from '../adminContext'
import { Card, Notice } from '../ui'

type Kind = 'number' | 'boolean' | 'text'

/** Parámetros editables, agrupados, con su descripción (RF-CFG-001). */
const GROUPS: { title: string; fields: [path: string, label: string, kind?: Kind][] }[] = [
  {
    title: 'Sesión pública',
    fields: [
      ['session.inactivityWarningSeconds', 'Segundos sin actividad hasta la advertencia'],
      ['session.inactivityCancelSeconds', 'Segundos de cuenta regresiva de la advertencia'],
      ['experience.skipSingleCampaign', 'Con una sola campaña disponible, entrar directamente', 'boolean']
    ]
  },
  {
    title: 'Captura',
    fields: [
      ['capture.countdownSeconds', 'Cuenta regresiva antes de la foto (s)'],
      ['capture.maxAttempts', 'Intentos fallidos antes de cancelar'],
      ['capture.maxRetakes', 'Repeticiones permitidas de la foto'],
      ['capture.soundEnabled', 'Señales sonoras', 'boolean'],
      ['capture.mirror', 'Vista en espejo', 'boolean'],
      ['capture.cameraLabel', 'Cámara a usar (parte de su nombre; vacío = la primera)', 'text'],
      ['capture.positionHint', 'Aviso «Ubíquese aquí» sobre la zona de la persona hasta que alguien se ubique', 'boolean'],
      ['capture.rotation', 'Rotación de la cámara (grados: 0, 90, 180 o 270), si está montada girada'],
      ['capture.autoFraming', 'Encuadre automático: centrar y agrandar a la persona, de cuerpo entero (con recorte automático del fondo)', 'boolean'],
      ['capture.matchCharacterSize', 'Adaptar el tamaño de la persona al personaje seleccionado (con recorte automático del fondo)', 'boolean'],
      ['capture.levelToCharacter', 'Nivelado automático de usuario con relación al personaje (alinea los pies en la foto final; con recorte automático del fondo)', 'boolean'],
      ['capture.framingPercent', 'Encuadre fijo (%), si no hay encuadre automático: 0 = imagen completa, 100 = llenar la zona (zoom)']
    ]
  },
  {
    title: 'Descarga y publicación',
    fields: [
      ['download.qrDisplaySeconds', 'Segundos que se muestra el QR'],
      ['publication.retryIntervalSeconds', 'Segundos entre reintentos de publicación'],
      ['publication.maxRetries', 'Reintentos máximos de publicación']
    ]
  },
  {
    title: 'Almacenamiento',
    fields: [
      ['storage.minFreeMegabytes', 'Espacio mínimo para iniciar participaciones (MB)'],
      ['storage.warnFreeMegabytes', 'Advertir con espacio libre menor a (MB)']
    ]
  },
  {
    title: 'Seguridad del panel',
    fields: [
      ['admin.sessionTimeoutSeconds', 'Cierre de sesión por inactividad (s)'],
      ['admin.maxFailedLogins', 'Intentos fallidos antes del bloqueo'],
      ['admin.lockoutSeconds', 'Duración del bloqueo (s)']
    ]
  },
  {
    title: 'Aplicación instalada',
    fields: [
      ['kiosk.enabled', 'Modo kiosco a pantalla completa', 'boolean'],
      ['kiosk.autoStart', 'Iniciar con Windows', 'boolean']
    ]
  },
  {
    title: 'Conservación de datos (PD-002)',
    fields: [
      ['retention.enabled', 'Aplicar la política de conservación (solo con aprobación de Editora Perú)', 'boolean'],
      ['retention.photoDays', 'Días que se conservan las fotografías'],
      ['retention.personalDataDays', 'Días que se conservan nombres y DNI']
    ]
  }
]

function getPath(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], obj)
}

function setPath<T>(obj: T, path: string, value: unknown): T {
  const [head, ...rest] = path.split('.')
  const current = obj as Record<string, unknown>
  return { ...current, [head!]: rest.length ? setPath(current[head!], rest.join('.'), value) : value } as T
}

/** Parámetros generales validados antes de aplicarse (RF-CFG-001, RF-CFG-003) y copia de la configuración (RF-CFG-004). */
export function GeneralSettings(): React.JSX.Element {
  const { call } = useAdmin()
  const [settings, setSettings] = useState<Settings | null>(null)
  const [dirty, setDirty] = useState(false)
  const [message, setMessage] = useState<{ kind: 'error' | 'ok' | 'info'; text: string } | null>(null)

  useEffect(() => {
    void call<Settings>('settings.getGeneral').then(setSettings)
  }, [call])

  if (!settings) return <Card title="Configuración general">Cargando…</Card>

  const save = async () => {
    try {
      setSettings(await call<Settings>('settings.saveGeneral', settings))
      setDirty(false)
      setMessage({ kind: 'ok', text: 'Configuración guardada. Los cambios de la experiencia pública se aplican al volver al tótem.' })
    } catch (e) {
      setMessage({ kind: 'error', text: errorMessage(e) })
    }
  }
  const exportConfig = async () => {
    const r = await call<{ saved: boolean }>('settings.exportConfig').catch((e) => (setMessage({ kind: 'error', text: errorMessage(e) }), null))
    if (r?.saved) setMessage({ kind: 'ok', text: 'Configuración exportada (sin claves)' })
  }
  const importConfig = async () => {
    try {
      const imported = await call<Settings | null>('settings.importConfig')
      if (imported) {
        setSettings(imported)
        setDirty(false)
        setMessage({ kind: 'ok', text: 'Configuración restaurada' })
      }
    } catch (e) {
      setMessage({ kind: 'error', text: errorMessage(e) })
    }
  }

  return (
    <Card title="Configuración general">
      {GROUPS.map((group) => (
        <fieldset key={group.title} className="agroup">
          <legend>{group.title}</legend>
          {group.fields.map(([path, label, kind = 'number']) => {
            const value = getPath(settings, path)
            const update = (v: unknown) => {
              setSettings(setPath(settings, path, v))
              setDirty(true)
            }
            return (
              <label key={path} className={kind === 'boolean' ? 'inline' : 'afield afield--row'}>
                {kind === 'boolean' && <input type="checkbox" checked={Boolean(value)} onChange={(e) => update(e.target.checked)} />}
                <span>{label}</span>
                {kind === 'number' && <input type="number" value={Number(value)} onChange={(e) => update(Number(e.target.value))} />}
                {kind === 'text' && <input value={String(value ?? '')} onChange={(e) => update(e.target.value)} />}
              </label>
            )
          })}
        </fieldset>
      ))}
      {settings.retention.enabled && (
        <Notice kind="info">La conservación activada elimina fotografías y anonimiza datos antiguos de forma automática e irreversible.</Notice>
      )}
      {settings.capture.matchCharacterSize && (
        <Notice kind="info">El ajuste al personaje funciona sin activar el encuadre automático general. Usa la altura visible y el apoyo del primer personaje seleccionado, dentro de la zona de la persona. Requiere cuerpo entero y recorte automático del fondo; no modifica el fondo real, el croma ni los escenarios con hueco para la foto. Si no hay una referencia válida, se conserva el encuadre habitual.</Notice>
      )}
      {message && <Notice kind={message.kind}>{message.text}</Notice>}
      <div className="aform__actions">
        <button type="button" className="btn" onClick={() => void exportConfig()}>
          Exportar configuración
        </button>
        <button type="button" className="btn" onClick={() => void importConfig()}>
          Restaurar configuración…
        </button>
        <button type="button" className="btn btn--primary" disabled={!dirty} onClick={() => void save()}>
          Guardar cambios
        </button>
      </div>
    </Card>
  )
}
