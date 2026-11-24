import type { Migration } from '../migrator'

export const migration009: Migration = {
  version: 9,
  name: 'pose_countdown_10_seconds',
  sql: `UPDATE settings SET value_json = json_set(value_json, '$.capture.countdownSeconds', 10)
        WHERE key = 'app' AND json_valid(value_json);`
}
