import type { Migration } from '../migrator'

/** Método aplicado al fondo durante la reproducción de un personaje en video. */
export const migration007: Migration = {
  version: 7,
  name: 'video_background',
  sql: `
    ALTER TABLE resources ADD COLUMN animation_background TEXT NOT NULL DEFAULT 'alpha'
      CHECK (animation_background IN ('alpha', 'chroma', 'segmentation'));
  `
}
