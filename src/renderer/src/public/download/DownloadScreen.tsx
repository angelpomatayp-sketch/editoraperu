import { useCallback, useEffect, useRef, useState } from 'react'
import type { PublicSettings } from '../../../../shared/ipc'
import type { PublishResult } from '../../../../shared/publication'

interface DownloadScreenProps {
  sessionId: string
  settings: Pick<PublicSettings, 'download' | 'timezone'>
  onFinish: () => void
}

const UNAVAILABLE_MESSAGE =
  'En este momento no es posible generar el código de descarga. Su fotografía quedó guardada; por favor, consulte al personal.'

const RETRY_DELAY_MS = 2_000

const wait = (milliseconds: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, milliseconds))

/**
 * Pantalla de descarga (RF-QR-004): QR, instrucción breve y plazo de disponibilidad, sin datos
 * personales. Si la publicación falla no se muestra ningún QR (RF-QR-008). Se cierra sola después
 * del tiempo configurado o con "Finalizar" (RF-QR-010).
 */
export function DownloadScreen({ sessionId, settings, onFinish }: DownloadScreenProps): React.JSX.Element {
  const [result, setResult] = useState<PublishResult | null>(null)
  const [secondsLeft, setSecondsLeft] = useState(settings.download.qrDisplaySeconds)
  const [attempt, setAttempt] = useState(1)
  const finished = useRef(false)

  const finish = () => {
    if (finished.current) return
    finished.current = true
    onFinish()
  }

  const publish = useCallback(
    async (automaticRetry: boolean) => {
      setResult(null)
      setAttempt(1)
      let publication: PublishResult
      try {
        publication = await window.totem.publish(sessionId)
      } catch {
        publication = { ok: false, reason: 'offline' }
      }

      if (automaticRetry && !publication.ok && publication.reason === 'offline') {
        setAttempt(2)
        await wait(RETRY_DELAY_MS)
        try {
          publication = await window.totem.publish(sessionId)
        } catch {
          publication = { ok: false, reason: 'offline' }
        }
      }
      setResult(publication)
    },
    [sessionId]
  )

  useEffect(() => {
    void publish(true)
  }, [publish])

  useEffect(() => {
    if (!result) return
    if (secondsLeft <= 0) {
      finish()
      return
    }
    const timer = setTimeout(() => setSecondsLeft((s) => s - 1), 1000)
    return () => clearTimeout(timer)
  })

  if (!result) {
    return (
      <main className="screen" aria-busy="true">
        <h1 className="title">{attempt === 1 ? 'Preparando su código de descarga…' : 'Reintentando la conexión…'}</h1>
        <div className="spinner spinner--inline" role="status" aria-label="Procesando" />
      </main>
    )
  }

  const finishButton = (
    <button type="button" className="touch-button" onClick={finish}>
      Finalizar ({secondsLeft})
    </button>
  )

  if (!result.ok) {
    return (
      <main className="screen screen--message">
        <h1>¡Gracias por participar!</h1>
        <p>{UNAVAILABLE_MESSAGE}</p>
        <div className="footer-actions">
          <button
            type="button"
            className="touch-button touch-button--secondary"
            onClick={() => {
              setSecondsLeft(settings.download.qrDisplaySeconds)
              void publish(false)
            }}
          >
            Reintentar código QR
          </button>
          {finishButton}
        </div>
      </main>
    )
  }

  const expires = new Intl.DateTimeFormat('es-PE', {
    timeZone: settings.timezone,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(result.expiresAt))

  return (
    <main className="screen download">
      <h1 className="title">Escanee el código QR</h1>
      <p className="subtitle">para descargar su fotografía en su teléfono</p>
      <img className="download__qr" src={result.qrDataUrl} alt="Código QR de descarga" draggable={false} />
      <p className="download__expires">Disponible hasta el {expires}</p>
      {finishButton}
    </main>
  )
}
