import type { Migration } from '../migrator'

/** Duración conocida de GIF para sincronizar el movimiento, la pose y el botón de captura. */
export const migration006: Migration = {
  version: 6,
  name: 'animation_duration',
  sql: `ALTER TABLE resources ADD COLUMN animation_duration_ms INTEGER;`
}
