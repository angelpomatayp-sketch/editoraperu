export type KeyboardLayout = 'alpha' | 'numeric'

interface VirtualKeyboardProps {
  layout: KeyboardLayout
  /** La próxima letra se escribirá en mayúscula (se muestran las teclas así). */
  uppercase: boolean
  /** La tecla Mayús está activada para la próxima letra. */
  shift: boolean
  onKey: (key: string) => void
  onBackspace: () => void
  onShift: () => void
}

const ALPHA_ROWS = [
  ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
  ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l', 'ñ'],
  ['z', 'x', 'c', 'v', 'b', 'n', 'm', "'", '-'],
  ['á', 'é', 'í', 'ó', 'ú', 'ü']
]

const NUMERIC_ROWS = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9']
]

/**
 * Teclado en pantalla para la interfaz táctil (RF-REG-001, RNF-002). Evita depender del teclado
 * físico o del teclado táctil de Windows. Usa `pointerdown` para no quitar el foco del campo.
 */
export function VirtualKeyboard({
  layout,
  uppercase,
  shift,
  onKey,
  onBackspace,
  onShift
}: VirtualKeyboardProps): React.JSX.Element {
  const press = (action: () => void) => (event: React.PointerEvent) => {
    event.preventDefault()
    action()
  }

  if (layout === 'numeric') {
    return (
      <div className="keyboard keyboard--numeric" aria-label="Teclado numérico">
        {NUMERIC_ROWS.map((row) => (
          <div className="keyboard__row" key={row.join('')}>
            {row.map((key) => (
              <button type="button" className="key" key={key} onPointerDown={press(() => onKey(key))}>
                {key}
              </button>
            ))}
          </div>
        ))}
        <div className="keyboard__row">
          <span className="key key--spacer" />
          <button type="button" className="key" onPointerDown={press(() => onKey('0'))}>
            0
          </button>
          <button type="button" className="key key--action" onPointerDown={press(onBackspace)} aria-label="Borrar">
            ⌫
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="keyboard" aria-label="Teclado">
      {ALPHA_ROWS.map((row) => (
        <div className="keyboard__row" key={row.join('')}>
          {row.map((key) => (
            <button type="button" className="key" key={key} onPointerDown={press(() => onKey(key))}>
              {uppercase ? key.toLocaleUpperCase('es-PE') : key}
            </button>
          ))}
        </div>
      ))}
      <div className="keyboard__row">
        <button
          type="button"
          className={`key key--action${shift ? ' key--active' : ''}`}
          onPointerDown={press(onShift)}
          aria-pressed={shift}
        >
          Mayús
        </button>
        <button type="button" className="key key--space" onPointerDown={press(() => onKey(' '))}>
          espacio
        </button>
        <button type="button" className="key key--action" onPointerDown={press(onBackspace)} aria-label="Borrar">
          ⌫
        </button>
      </div>
    </div>
  )
}
