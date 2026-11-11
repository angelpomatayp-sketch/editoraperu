import { useEffect, useState } from 'react'
import type { PublicationSettingsView } from '../../../shared/admin'
import type { ConnectivityState } from '../../../shared/publication'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { errorMessage, useAdmin } from './adminContext'
import { BackgroundSettings } from './BackgroundSettings'
import { GeneralSettings } from './operations/GeneralSettings'
import { MaintenanceCard } from './operations/MaintenanceCard'
import { Card, Field, Notice } from './ui'

const STATE_TEXT: Record<ConnectivityState, string> = {
  online: 'Conectado: el servicio responde',
  offline: 'Sin acceso: el servicio no responde',
  not_configured: 'No configurado',
  unknown: 'Sin comprobar'
}

/** Servicio de publicación: URL y clave compartida cifrada (RF-CFG-002). */
function PublicationSettings(): React.JSX.Element {
  const { call } = useAdmin()
  const [view, setView] = useState<PublicationSettingsView | null>(null)
  const [baseUrl, setBaseUrl] = useState('')
  const [secret, setSecret] = useState('')
  const [message, setMessage] = useState<{ kind: 'error' | 'ok' | 'info'; text: string } | null>(null)

  useEffect(() => {
    void call<PublicationSettingsView>('settings.getPublication').then((v) => {
      setView(v)
      setBaseUrl(v.baseUrl)
    })
  }, [call])

  const save = async () => {
    try {
      const v = await call<PublicationSettingsView>('settings.savePublication', { baseUrl, secret })
      setView(v)
      setSecret('')
      setMessage({ kind: 'ok', text: 'Configuración guardada' })
    } catch (error) {
      setMessage({ kind: 'error', text: errorMessage(error) })
    }
  }

  const test = async () => {
    setMessage({ kind: 'info', text: 'Comprobando…' })
    try {
      const state = await call<ConnectivityState>('settings.testPublication')
      setMessage({ kind: state === 'online' ? 'ok' : 'error', text: STATE_TEXT[state] })
    } catch (error) {
      setMessage({ kind: 'error', text: errorMessage(error) })
    }
  }

  if (!view) return <Card title="Publicación por QR">Cargando…</Card>

  return (
    <Card title="Publicación por QR">
      {view.devOverride && (
        <Notice kind="info">Desarrollo: se usa el servicio local de «npm run publicador» ({view.devOverride}) en lugar de esta configuración.</Notice>
      )}
      {view.builtInUrl && (
        <Notice kind="info">
          El instalador ya trae el servicio configurado ({view.builtInUrl}) con su clave: no hace falta completar nada. Use estos campos solo para
          cambiar a otro servicio; si los deja vacíos, se usa el incluido.
        </Notice>
      )}
      <div className="aform">
        <Field label="URL del servicio" hint={view.builtInUrl ? `Vacía: se usa ${view.builtInUrl}` : 'Ejemplo: https://fotos.dominio.pe (en producción, HTTPS)'}>
          <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} inputMode="url" autoComplete="off" />
        </Field>
        <Field
          label={`Clave compartida (${view.secretConfigured ? 'configurada' : view.builtInUrl ? 'la incluida en el instalador' : 'sin configurar'})`}
          hint="La misma del archivo config.php del servicio. Déjela vacía para conservar la actual; nunca se vuelve a mostrar."
        >
          <input type="password" value={secret} onChange={(e) => setSecret(e.target.value)} autoComplete="off" />
        </Field>
        {message && <Notice kind={message.kind}>{message.text}</Notice>}
        <div className="aform__actions">
          <button type="button" className="btn" onClick={() => void test()}>
            Probar conexión
          </button>
          <button type="button" className="btn btn--primary" onClick={() => void save()}>
            Guardar
          </button>
        </div>
      </div>
    </Card>
  )
}

/** Sistema: publicación, croma y cierre controlado según el rol. */
export function SystemView(): React.JSX.Element {
  const { can, call } = useAdmin()
  const [confirmQuit, setConfirmQuit] = useState(false)

  return (
    <div className="astack">
      {can('settings.general') && <GeneralSettings />}
      {can('settings.publication') && <PublicationSettings />}
      {can('settings.chroma') && <BackgroundSettings />}
      {can('maintenance.backup') && <MaintenanceCard />}
      {can('kiosk.exit') && (
        <Card title="Aplicación">
          <p className="muted">Cierra la aplicación del tótem de forma controlada; la acción queda registrada (RF-KIO-005).</p>
          <button type="button" className="btn btn--danger" onClick={() => setConfirmQuit(true)}>
            Cerrar la aplicación
          </button>
        </Card>
      )}
      {!can('settings.publication') && !can('settings.chroma') && !can('kiosk.exit') && !can('maintenance.backup') && (
        <Notice kind="info">Su rol no tiene opciones de sistema.</Notice>
      )}
      {confirmQuit && (
        <ConfirmDialog
          title="¿Cerrar la aplicación?"
          message="El tótem dejará de atender al público hasta que se vuelva a iniciar."
          cancelLabel="Cancelar"
          confirmLabel="Cerrar"
          onCancel={() => setConfirmQuit(false)}
          onConfirm={() => void call('system.quit')}
        />
      )}
    </div>
  )
}
