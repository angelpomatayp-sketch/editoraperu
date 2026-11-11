import { useEffect, useState } from 'react'
import type { AdminMedia } from '../../../shared/admin'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { errorMessage, useAdmin } from './adminContext'
import { Card, Notice } from './ui'

/** Contenido de la pantalla de atracción: carga, orden, duración, activación y eliminación (8.15). */
export function MediaView(): React.JSX.Element {
  const { call } = useAdmin()
  const [items, setItems] = useState<AdminMedia[]>([])
  const [message, setMessage] = useState<{ kind: 'error' | 'ok'; text: string } | null>(null)
  const [removing, setRemoving] = useState<AdminMedia | null>(null)

  const run = async (method: Parameters<typeof call>[0], payload?: unknown, ok?: string) => {
    try {
      const result = await call<AdminMedia[] | null>(method, payload)
      if (result) setItems(result)
      if (ok && result) setMessage({ kind: 'ok', text: ok })
    } catch (error) {
      setMessage({ kind: 'error', text: errorMessage(error) })
    }
  }

  useEffect(() => {
    void run('media.list')
  }, []) // Solo al abrir.

  const update = (item: AdminMedia, changes: Partial<AdminMedia>) => {
    const next = { ...item, ...changes }
    void run('media.update', { id: item.id, name: next.name, active: next.active, displaySeconds: next.displaySeconds })
  }

  return (
    <Card
      title="Imágenes y videos en ciclo"
      actions={
        <button type="button" className="btn btn--primary" onClick={() => void run('media.add', {}, 'Contenido agregado')}>
          + Agregar imagen o video
        </button>
      }
    >
      <p className="muted">
        Fondo de la pantalla «Toque aquí para participar». Se reproduce en orden. Imágenes JPG, PNG o WebP; videos MP4 o WebM (hasta 300 MB, valores
        provisionales).
      </p>
      {message && <Notice kind={message.kind}>{message.text}</Notice>}
      {items.length === 0 && <Notice kind="info">No hay contenido cargado: se muestra la imagen incluida con la aplicación.</Notice>}
      <ul className="alist">
        {items.map((item, index) => (
          <li key={item.id} className={`aitem${item.active ? '' : ' aitem--off'}`}>
            <div className="aitem__thumb">
              {item.type === 'image' ? <img src={item.url} alt="" /> : <video src={item.url} muted preload="metadata" />}
            </div>
            <div className="aitem__body">
              <input defaultValue={item.name} onBlur={(e) => e.target.value !== item.name && update(item, { name: e.target.value })} aria-label="Nombre" />
              <div className="aitem__row">
                <span className="tag">{item.type === 'image' ? 'Imagen' : 'Video'}</span>
                {item.fileMissing && <span className="tag tag--bad">Falta el archivo</span>}
                {item.type === 'image' && (
                  <label className="inline">
                    Duración
                    <input
                      type="number"
                      min={2}
                      max={120}
                      defaultValue={item.displaySeconds ?? 8}
                      onBlur={(e) => update(item, { displaySeconds: Number(e.target.value) })}
                    />
                    s
                  </label>
                )}
                <label className="inline">
                  <input type="checkbox" checked={item.active} onChange={(e) => update(item, { active: e.target.checked })} />
                  {item.active ? 'Activo' : 'Inactivo'}
                </label>
              </div>
            </div>
            <div className="aitem__tools">
              <button type="button" className="btn btn--icon" disabled={index === 0} onClick={() => void run('media.move', { id: item.id, direction: 'up' })} aria-label="Subir">
                ↑
              </button>
              <button
                type="button"
                className="btn btn--icon"
                disabled={index === items.length - 1}
                onClick={() => void run('media.move', { id: item.id, direction: 'down' })}
                aria-label="Bajar"
              >
                ↓
              </button>
              <button type="button" className="btn btn--danger" onClick={() => setRemoving(item)}>
                Eliminar
              </button>
            </div>
          </li>
        ))}
      </ul>
      {removing && (
        <ConfirmDialog
          title="¿Eliminar este contenido?"
          message={`"${removing.name}" dejará de mostrarse y se eliminará su archivo.`}
          cancelLabel="Cancelar"
          confirmLabel="Eliminar"
          onCancel={() => setRemoving(null)}
          onConfirm={() => {
            void run('media.remove', { id: removing.id }, 'Contenido eliminado')
            setRemoving(null)
          }}
        />
      )}
    </Card>
  )
}
