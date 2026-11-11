/** Pantalla pública ante un fallo esencial: sin detalles técnicos (RF-KIO-001, RNF-007). */
export function ServiceUnavailable(): React.JSX.Element {
  return (
    <main className="screen screen--message">
      <h1>Servicio temporalmente no disponible</h1>
      <p>Estamos trabajando para restablecerlo. Gracias por su comprensión.</p>
    </main>
  )
}
