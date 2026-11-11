import { useEffect, useMemo, useState } from 'react'
import type { AttractMediaItem } from '../../../../shared/ipc'
import defaultStartImage from '../../assets/fondo2.png'

/**
 * Reproduce en ciclo continuo las piezas activas (RF-ATR-001). Una pieza que no se puede
 * reproducir se informa y se omite sin detener el ciclo (RF-ATR-003).
 */
export function AttractPlayer(): React.JSX.Element {
  const [items, setItems] = useState<AttractMediaItem[]>([])
  const [failed, setFailed] = useState<ReadonlySet<string>>(new Set())
  const [index, setIndex] = useState(0)

  useEffect(() => {
    window.totem
      .listAttractMedia()
      .then(setItems)
      .catch(() => setItems([]))
  }, [])

  const playable = useMemo(() => items.filter((item) => !failed.has(item.id)), [items, failed])
  const current = playable.length > 0 ? playable[index % playable.length] : undefined

  const count = playable.length
  const next = (): void => setIndex((i) => (count > 0 ? (i + 1) % count : 0))

  const fail = (item: AttractMediaItem): void => {
    void window.totem.reportMediaError(item.id)
    setFailed((prev) => new Set(prev).add(item.id))
  }

  useEffect(() => {
    if (current?.type !== 'image' || count < 2) return
    const timer = setTimeout(() => setIndex((i) => (i + 1) % count), current.displaySeconds * 1000)
    return () => clearTimeout(timer)
  }, [current, count])

  // Sin contenido cargado en el panel: la imagen incluida con la aplicación.
  if (!current) {
    return (
      <div className="attract__media">
        <img src={defaultStartImage} alt="" draggable={false} />
      </div>
    )
  }

  return (
    <div className="attract__media" key={`${current.id}-${index}`}>
      {current.type === 'image' ? (
        <img src={current.url} alt="" draggable={false} onError={() => fail(current)} />
      ) : (
        <video
          src={current.url}
          autoPlay
          muted
          playsInline
          loop={playable.length === 1}
          onEnded={next}
          onError={() => fail(current)}
        />
      )}
    </div>
  )
}
