import type { Migration } from '../migrator'

export const migration010: Migration = {
  version: 10,
  name: 'delivery_retention',
  sql: `
    CREATE TABLE photo_retention_notices (
      photo_id TEXT PRIMARY KEY REFERENCES photos(id) ON DELETE CASCADE,
      warned_at TEXT NOT NULL
    );
    UPDATE settings SET value_json = json_set(value_json,
      '$.retention.enabled', json('true'), '$.retention.photoDays', 7, '$.retention.personalDataDays', 30)
      WHERE key = 'app' AND json_valid(value_json);
  `
}
