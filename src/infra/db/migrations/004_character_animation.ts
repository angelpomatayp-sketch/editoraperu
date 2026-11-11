import type { Migration } from '../migrator'

/**
 * Animación opcional de personajes. La imagen principal sigue siendo la pose final usada por el
 * compositor; el WebM se usa únicamente en la vista previa y siempre puede faltar o fallar.
 */
export const migration004: Migration = {
  version: 4,
  name: 'character_animation',
  sql: `
    ALTER TABLE resources ADD COLUMN animation_path TEXT;
    ALTER TABLE resources ADD COLUMN animation_format TEXT;
    ALTER TABLE resources ADD COLUMN animation_size_bytes INTEGER;
  `
}
