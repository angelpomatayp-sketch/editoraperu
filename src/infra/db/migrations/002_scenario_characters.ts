import type { Migration } from '../migrator'

/**
 * Personajes por escenario (RF-EXP-004): cada escenario de una campaña tiene sus propios personajes.
 * Una campaña sin filas en esta tabla conserva el comportamiento anterior: todos sus personajes
 * están disponibles con cualquier escenario.
 */
export const migration002: Migration = {
  version: 2,
  name: 'scenario_characters',
  sql: `
    CREATE TABLE scenario_characters (
      campaign_id  TEXT NOT NULL REFERENCES campaigns (id),
      scenario_id  TEXT NOT NULL REFERENCES resources (id),
      character_id TEXT NOT NULL REFERENCES resources (id),
      sort_order   INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (campaign_id, scenario_id, character_id)
    );
    CREATE INDEX idx_scenario_characters_scenario ON scenario_characters (campaign_id, scenario_id, sort_order);
  `
}
