import type { Migration } from '../migrator'

/** La cuenta anterior era fija en 7 s; adopta 20 s una sola vez en instalaciones existentes. */
export const migration008: Migration = {
  version: 8,
  name: 'pose_countdown_20_seconds',
  sql: `
    UPDATE settings
    SET value_json = json_set(value_json, '$.capture.countdownSeconds', 20)
    WHERE key = 'app' AND json_valid(value_json);
  `
}
