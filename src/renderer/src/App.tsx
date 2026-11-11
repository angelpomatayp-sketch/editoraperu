import { useCallback, useEffect, useState } from 'react'
import type { AppStatus, PublicSettings } from '../../shared/ipc'
import { AdminApp } from './admin/AdminApp'
import { PublicFlow } from './public/PublicFlow'
import { ServiceUnavailable } from './public/ServiceUnavailable'
import { DevPanel } from './ui/DevPanel'
import { ReservedCorner } from './ui/ReservedCorner'

interface Loaded {
  status: AppStatus
  settings: PublicSettings | null
}

export function App(): React.JSX.Element {
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [mode, setMode] = useState<'public' | 'admin'>('public')
  /** Cambia al volver del panel, para que la experiencia pública se monte de nuevo con los cambios. */
  const [publicKey, setPublicKey] = useState(0)

  const load = useCallback(() => {
    Promise.all([window.totem.getStatus(), window.totem.getPublicSettings()])
      .then(([status, settings]) => setLoaded({ status, settings }))
      .catch(() => setLoaded({ status: { state: 'unavailable', version: '', isDev: false }, settings: null }))
  }, [])

  useEffect(load, [load])

  // Atajo para el personal con teclado: Ctrl+Shift+A abre el acceso (igual exige usuario y contraseña).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'a') {
        event.preventDefault()
        void window.totem.reservedGesture()
        setMode('admin')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (!loaded) return <div className="screen" />
  const { status, settings } = loaded

  if (mode === 'admin' && settings) {
    return (
      <AdminApp
        timeoutSeconds={settings.adminSessionTimeoutSeconds}
        onExit={() => {
          setMode('public')
          setPublicKey((k) => k + 1)
          load()
        }}
      />
    )
  }

  // La acción reservada solo existe en la pantalla de atracción y en la de servicio no disponible,
  // para no interferir con los botones del recorrido.
  const reserved = <ReservedCorner onTrigger={() => setMode('admin')} visible={status.isDev} />

  return (
    <>
      {status.state === 'ready' && settings ? (
        <PublicFlow key={publicKey} settings={settings} reservedCorner={reserved} />
      ) : (
        <>
          <ServiceUnavailable />
          {reserved}
        </>
      )}
      {status.isDev && <DevPanel status={status} />}
    </>
  )
}
