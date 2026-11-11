import type { Migration } from '../migrator'

/**
 * Zona transparente de los escenarios: si un escenario trae un «hueco» transparente, la foto del
 * participante va ahí, debajo del escenario. Se detecta al subirlo; `photo_hole_checked` marca los
 * escenarios ya revisados (los anteriores a esta versión se revisan al iniciar la aplicación).
 */
export const migration003: Migration = {
  version: 3,
  name: 'scenario_photo_hole',
  sql: `
    ALTER TABLE resources ADD COLUMN photo_hole_json TEXT;
    ALTER TABLE resources ADD COLUMN photo_hole_checked INTEGER NOT NULL DEFAULT 0;
  `
}
