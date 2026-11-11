import type { AppStatus } from '../../../shared/ipc'

/** Indicador de diagnóstico visible solo en desarrollo; la ruta de datos se muestra al pasar el puntero. */
export function DevPanel({ status }: { status: AppStatus }): React.JSX.Element {
  const d = status.diagnostics
  const parts = [`DEV v${status.version}`, status.state]
  if (d?.failure) parts.push(`fallo: ${d.failure}`)
  if (d?.schemaVersion !== undefined) parts.push(`esquema ${d.schemaVersion}`)
  if (d?.freeDiskMb !== undefined) parts.push(`${d.freeDiskMb.toLocaleString('es-PE')} MB libres`)
  if (d?.warnings.length) parts.push(`⚠ ${d.warnings.join(' · ')}`)

  return (
    <aside className="dev-panel" aria-label="Diagnóstico de desarrollo" title={d ? `datos: ${d.dataRoot}` : undefined}>
      {parts.join(' · ')}
    </aside>
  )
}
