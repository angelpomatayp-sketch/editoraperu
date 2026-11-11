import { useEffect, useState } from 'react'
import type { AdminAttract } from '../../../shared/admin'
import { ATTRACT_ICON_LABEL, ATTRACT_ICONS, MAX_ATTRACT_TILES, type AttractIcon } from '../../../shared/attract'
import defaultScreensaver from '../assets/fondo1.png'
import { errorMessage, useAdmin } from './adminContext'
import { Card, Notice } from './ui'

/** Pantalla principal: contenido institucional o ciclo de imágenes y videos (RF-ATR-001). */
export function AttractSettings(): React.JSX.Element {
  const { call } = useAdmin()
  const [value, setValue] = useState<AdminAttract | null>(null)
  const [dirty, setDirty] = useState(false)
  const [message, setMessage] = useState<{ kind: 'error' | 'ok'; text: string } | null>(null)

  useEffect(() => {
    void call<AdminAttract>('attract.get').then(setValue)
  }, [call])

  if (!value) return <Card title="Protector de pantalla">Cargando…</Card>

  const change = (changes: Partial<AdminAttract>) => {
    setValue({ ...value, ...changes })
    setDirty(true)
  }
  const run = async (method: 'attract.save' | 'attract.setImage' | 'attract.clearImage', payload: unknown, ok: string) => {
    try {
      const result = await call<AdminAttract | null>(method, payload)
      if (result) {
        setValue(result)
        setMessage({ kind: 'ok', text: ok })
        if (method === 'attract.save') setDirty(false)
      }
    } catch (error) {
      setMessage({ kind: 'error', text: errorMessage(error) })
    }
  }
  const save = () => {
    const { logoUrl: _l, backgroundUrl: _b, logoPath: _lp, backgroundPath: _bp, ...texts } = value
    void run('attract.save', texts, 'Protector de pantalla guardado. Se verá al salir del panel.')
  }
  const setTile = (index: number, changes: Partial<{ icon: AttractIcon; label: string }>) =>
    change({ tiles: value.tiles.map((t, i) => (i === index ? { ...t, ...changes } : t)) })

  const image = (kind: 'logo' | 'background', label: string, url: string | null) => (
    <div className="aitem">
      <div className="aitem__thumb">
        {url ? (
          <img src={url} alt="" />
        ) : kind === 'background' ? (
          <img src={defaultScreensaver} alt="" title="Imagen incluida con la aplicación" />
        ) : (
          <span className="muted">Sin imagen</span>
        )}
      </div>
      <div className="aitem__body">
        <strong>{label}</strong>
      </div>
      <div className="aitem__tools">
        <button type="button" className="btn" onClick={() => void run('attract.setImage', { kind }, `${label} actualizado`)}>
          {url ? 'Cambiar' : 'Cargar'}
        </button>
        {url && (
          <button type="button" className="btn btn--danger" onClick={() => void run('attract.clearImage', { kind }, `${label} quitado`)}>
            Quitar
          </button>
        )}
      </div>
    </div>
  )

  const institutional = value.mode === 'institutional'

  return (
    <Card title="Protector de pantalla">
      <p className="muted">
        El protector se ve al iniciar y al terminar cada participación. Un toque lo lleva a la pantalla «Toque aquí para participar» (con las imágenes y
        videos en ciclo de abajo), que vuelve al protector tras 30 segundos sin uso.
      </p>
      {message && <Notice kind={message.kind}>{message.text}</Notice>}

      <div className="aform__actions aform__actions--start">
        <label className="inline">
          <input type="radio" checked={institutional} onChange={() => change({ mode: 'institutional' })} />
          Con protector de pantalla institucional
        </label>
        <label className="inline">
          <input type="radio" checked={!institutional} onChange={() => change({ mode: 'media' })} />
          Sin protector: directo a «Toque aquí para participar»
        </label>
      </div>

      {institutional && (
        <>
          {image(
            'background',
            value.backgroundUrl ? 'Imagen de fondo (vertical, 1080 × 1920)' : 'Imagen de fondo: la incluida con la aplicación (cargue otra para reemplazarla)',
            value.backgroundUrl
          )}
          <label className="inline">
            <input type="checkbox" checked={value.showTexts} onChange={(e) => change({ showTexts: e.target.checked })} />
            Mostrar logotipo, frase, categorías e invitación sobre la imagen (desactívelo si la imagen ya es el diseño completo: se mostrará sola)
          </label>
          {value.showTexts && (
            <>
              {image('logo', 'Logotipo (PNG con transparencia)', value.logoUrl)}
              <div className="aform">
                <label>
                  Nombre (si no hay logotipo)
                  <input value={value.title} maxLength={60} onChange={(e) => change({ title: e.target.value })} />
                </label>
                <label>
                  Lema bajo el nombre
                  <input value={value.tagline} maxLength={120} onChange={(e) => change({ tagline: e.target.value })} />
                </label>
                <label>
                  Frase principal
                  <input value={value.slogan} maxLength={120} onChange={(e) => change({ slogan: e.target.value })} />
                </label>
              </div>
              <h3>Categorías (hasta {MAX_ATTRACT_TILES})</h3>
              {value.tiles.map((tile, index) => (
                <div key={index} className="aform__actions aform__actions--start">
                  <select value={tile.icon} onChange={(e) => setTile(index, { icon: e.target.value as AttractIcon })}>
                    {ATTRACT_ICONS.map((icon) => (
                      <option key={icon} value={icon}>
                        {ATTRACT_ICON_LABEL[icon]}
                      </option>
                    ))}
                  </select>
                  <input value={tile.label} maxLength={24} onChange={(e) => setTile(index, { label: e.target.value })} aria-label="Texto de la categoría" />
                  <button type="button" className="btn btn--danger" onClick={() => change({ tiles: value.tiles.filter((_, i) => i !== index) })}>
                    Quitar
                  </button>
                </div>
              ))}
              {value.tiles.length < MAX_ATTRACT_TILES && (
                <button type="button" className="btn" onClick={() => change({ tiles: [...value.tiles, { icon: 'libro', label: 'Lectura' }] })}>
                  + Categoría
                </button>
              )}
            </>
          )}
          {value.showTexts && (
            <div className="aform">
              <label>
                Invitación a tocar
                <input value={value.cta} maxLength={60} onChange={(e) => change({ cta: e.target.value })} />
              </label>
            </div>
          )}
        </>
      )}

      <div className="aform__actions">
        {dirty && <span className="muted">Cambios sin guardar</span>}
        <button type="button" className="btn btn--primary" disabled={!dirty || !value.cta.trim() || value.tiles.some((t) => !t.label.trim())} onClick={save}>
          Guardar pantalla principal
        </button>
      </div>
    </Card>
  )
}
