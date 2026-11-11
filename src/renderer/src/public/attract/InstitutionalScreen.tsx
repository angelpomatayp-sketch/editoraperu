import type { PublicAttract } from '../../../../shared/attract'
import defaultScreensaver from '../../assets/fondo1.png'
import { AttractIcon } from '../../ui/AttractIcon'

/**
 * Pantalla principal con contenido institucional (RF-ATR-001): logotipo o nombre, fondo, frase y
 * categorías. Toda la pantalla invita a tocar; el inicio lo resuelve la pantalla de atracción.
 */
export function InstitutionalScreen({ attract }: { attract: PublicAttract }): React.JSX.Element {
  // Diseño completo como imagen: el cargado en el panel o, si no hay, el incluido con la aplicación.
  if (!attract.showTexts) {
    return (
      <div className="institutional">
        <img className="institutional__background" src={attract.backgroundUrl ?? defaultScreensaver} alt="" draggable={false} />
      </div>
    )
  }

  return (
    <div className="institutional">
      {attract.backgroundUrl ? (
        <img className="institutional__background" src={attract.backgroundUrl} alt="" draggable={false} />
      ) : (
        <div className="institutional__background institutional__background--plain" />
      )}
      <div className="institutional__shade" />

      <header className="institutional__brand">
        {attract.logoUrl ? (
          <img className="institutional__logo" src={attract.logoUrl} alt={attract.title} draggable={false} />
        ) : (
          <>
            {attract.title && <div className="institutional__title">{attract.title}</div>}
            {attract.tagline && <div className="institutional__tagline">{attract.tagline}</div>}
          </>
        )}
      </header>

      <div className="institutional__bottom">
        {attract.slogan && (
          <p className="institutional__slogan">
            {attract.slogan}
            <span className="institutional__stroke" aria-hidden="true" />
          </p>
        )}
        {attract.tiles.length > 0 && (
          <ul className="institutional__tiles">
            {attract.tiles.map((tile, index) => (
              <li key={`${tile.icon}-${index}`} className="institutional__tile">
                <AttractIcon name={tile.icon} />
                <span>{tile.label}</span>
              </li>
            ))}
          </ul>
        )}
        <div className="institutional__cta">{attract.cta}</div>
      </div>
    </div>
  )
}
