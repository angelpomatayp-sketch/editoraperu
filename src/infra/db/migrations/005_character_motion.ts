import type { Migration } from '../migrator'

/** Movimiento determinista y análisis del área visible de cada personaje. */
export const migration005: Migration = {
  version: 5,
  name: 'character_motion',
  sql: `
    ALTER TABLE resources ADD COLUMN entry_direction TEXT NOT NULL DEFAULT 'auto'
      CHECK (entry_direction IN ('auto', 'left', 'right'));
    ALTER TABLE resources ADD COLUMN content_bounds_json TEXT;
    ALTER TABLE resources ADD COLUMN anchor_x REAL NOT NULL DEFAULT 0.5;
    ALTER TABLE resources ADD COLUMN anchor_y REAL NOT NULL DEFAULT 1;
    ALTER TABLE resources ADD COLUMN character_analysis_checked INTEGER NOT NULL DEFAULT 0;
  `
}
