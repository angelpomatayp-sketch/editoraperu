import type { AttractIcon as IconName } from '../../../shared/attract'

/** Trazos de cada ícono en una grilla de 24×24, de línea, para las categorías de la pantalla principal. */
const PATHS: Record<IconName, string> = {
  cultura: 'M3 9.5 12 4l9 5.5M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 20.5h18',
  educacion: 'M2.5 9 12 4.5 21.5 9 12 13.5 2.5 9ZM6.5 11v4.5c0 1.6 2.5 3 5.5 3s5.5-1.4 5.5-3V11M21.5 9v5',
  identidad: 'M12 12a3.8 3.8 0 1 0 0-7.6A3.8 3.8 0 0 0 12 12ZM4.5 20.5c0-4 3.4-6.5 7.5-6.5s7.5 2.5 7.5 6.5',
  ciudadania:
    'M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM16.5 11a2.6 2.6 0 1 0 0-5.2 2.6 2.6 0 0 0 0 5.2ZM2.5 19.5c0-3.3 2.5-5.5 5.5-5.5s5.5 2.2 5.5 5.5M14 14.3c.8-.2 1.6-.3 2.5-.3 2.8 0 5 2 5 5.2',
  libro: 'M12 6.5c-2-1.5-5-2-8.5-1.5v13c3.5-.5 6.5 0 8.5 1.5 2-1.5 5-2 8.5-1.5V5c-3.5-.5-6.5 0-8.5 1.5ZM12 6.5v13',
  periodico: 'M4 5h13v14H6a2 2 0 0 1-2-2V5ZM17 9h3v8a2 2 0 0 1-2 2M7 8.5h7M7 12h7M7 15.5h4',
  estrella: 'm12 3.5 2.6 5.4 5.9.8-4.3 4.1 1 5.8-5.2-2.8-5.2 2.8 1-5.8-4.3-4.1 5.9-.8L12 3.5Z',
  corazon: 'M12 20s-7.5-4.4-7.5-10A4.3 4.3 0 0 1 12 7.4 4.3 4.3 0 0 1 19.5 10c0 5.6-7.5 10-7.5 10Z'
}

export function AttractIcon({ name }: { name: IconName }): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  )
}
