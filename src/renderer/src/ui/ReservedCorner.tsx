/** Engranaje para autenticación y X para confirmación de cierre, solo en la pantalla inicial. */
export function ReservedCorner({ onTrigger, onClose }: { onTrigger: () => void; onClose: () => void }): React.JSX.Element {
  const activate = (event: React.MouseEvent, action: () => void) => {
    event.stopPropagation()
    void window.totem.reservedGesture()
    action()
  }
  return (
    <>
      <button type="button" className="reserved-corner home-control home-control--admin" aria-label="Ingresar a administración" title="Administración" onClick={(event) => activate(event, onTrigger)}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="m9.5 3-.6 2.2-1.5.9-2.2-.6-2.5 4.3 1.6 1.6v1.7l-1.6 1.6 2.5 4.3 2.2-.6 1.5.9.6 2.2h5l.6-2.2 1.5-.9 2.2.6 2.5-4.3-1.6-1.6v-1.7l1.6-1.6-2.5-4.3-2.2.6-1.5-.9L14.5 3z" />
          <circle cx="12" cy="12" r="3.2" />
        </svg>
      </button>
      <button type="button" className="home-control home-control--close" aria-label="Cerrar la aplicación" title="Cerrar la aplicación" onClick={(event) => activate(event, onClose)}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
      </button>
    </>
  )
}
