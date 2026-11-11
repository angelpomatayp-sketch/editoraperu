import type { Migration } from '../migrator'

/**
 * Esquema inicial según el modelo conceptual (sección 10).
 * Fechas en ISO 8601 UTC; se presentan en la zona horaria configurada.
 * Identificadores de negocio: UUID aleatorios (RF-REG-004, RF-REG-006).
 */
export const migration001: Migration = {
  version: 1,
  name: 'initial',
  sql: `
    -- 10.7 Usuarios administrativos
    CREATE TABLE users (
      id                   TEXT PRIMARY KEY,
      username             TEXT NOT NULL UNIQUE COLLATE NOCASE,
      display_name         TEXT NOT NULL,
      role                 TEXT NOT NULL CHECK (role IN ('content', 'operator', 'sysadmin')),
      status               TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
      password_hash        TEXT NOT NULL,
      must_change_password INTEGER NOT NULL DEFAULT 1 CHECK (must_change_password IN (0, 1)),
      failed_attempts      INTEGER NOT NULL DEFAULT 0,
      locked_until         TEXT,
      last_login_at        TEXT,
      created_at           TEXT NOT NULL,
      updated_at           TEXT NOT NULL
    );

    -- 10.1 Campañas
    CREATE TABLE campaigns (
      id             TEXT PRIMARY KEY,
      code           TEXT NOT NULL UNIQUE,
      name           TEXT NOT NULL,
      description    TEXT,
      image_path     TEXT,
      status         TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'inactive', 'archived')),
      starts_at      TEXT,
      ends_at        TEXT,
      config_json    TEXT NOT NULL DEFAULT '{}',
      config_version INTEGER NOT NULL DEFAULT 1,
      created_at     TEXT NOT NULL,
      updated_at     TEXT NOT NULL
    );

    -- 10.2 Recursos gráficos
    CREATE TABLE resources (
      id         TEXT PRIMARY KEY,
      type       TEXT NOT NULL CHECK (type IN ('scenario', 'character', 'frame', 'logo', 'other')),
      name       TEXT NOT NULL,
      file_path  TEXT NOT NULL,
      format     TEXT NOT NULL,
      width      INTEGER NOT NULL,
      height     INTEGER NOT NULL,
      size_bytes INTEGER NOT NULL,
      status     TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'archived')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    -- Parámetros de composición de cada recurso dentro de una campaña (RF-CMP-003, RF-REC-004)
    CREATE TABLE campaign_resources (
      campaign_id TEXT NOT NULL REFERENCES campaigns (id),
      resource_id TEXT NOT NULL REFERENCES resources (id),
      layer_order INTEGER NOT NULL DEFAULT 0,
      pos_x       REAL NOT NULL DEFAULT 0,
      pos_y       REAL NOT NULL DEFAULT 0,
      scale       REAL NOT NULL DEFAULT 1,
      crop_json   TEXT,
      is_required INTEGER NOT NULL DEFAULT 0 CHECK (is_required IN (0, 1)),
      sort_order  INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (campaign_id, resource_id)
    );

    -- 10.3 Contenido multimedia de atracción
    CREATE TABLE media_items (
      id               TEXT PRIMARY KEY,
      type             TEXT NOT NULL CHECK (type IN ('image', 'video')),
      name             TEXT NOT NULL,
      file_path        TEXT NOT NULL,
      display_seconds  INTEGER,
      sort_order       INTEGER NOT NULL DEFAULT 0,
      status           TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'archived')),
      starts_at        TEXT,
      ends_at          TEXT,
      campaign_id      TEXT REFERENCES campaigns (id),
      created_at       TEXT NOT NULL,
      updated_at       TEXT NOT NULL
    );

    -- Versiones de textos legales (RF-CON-005)
    CREATE TABLE consent_versions (
      id           TEXT PRIMARY KEY,
      type         TEXT NOT NULL,
      version      TEXT NOT NULL,
      title        TEXT NOT NULL,
      body         TEXT NOT NULL,
      body_sha256  TEXT NOT NULL,
      is_required  INTEGER NOT NULL DEFAULT 1 CHECK (is_required IN (0, 1)),
      status       TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'retired')),
      activated_at TEXT,
      created_at   TEXT NOT NULL,
      UNIQUE (type, version)
    );

    -- 10.4 Participaciones
    CREATE TABLE participations (
      id                      TEXT PRIMARY KEY,
      campaign_id             TEXT NOT NULL REFERENCES campaigns (id),
      campaign_config_version INTEGER NOT NULL,
      first_names             TEXT,
      last_names              TEXT,
      document_type           TEXT NOT NULL DEFAULT 'DNI',
      document_number         TEXT,
      selections_json         TEXT NOT NULL DEFAULT '{}',
      status                  TEXT NOT NULL CHECK (status IN (
                                'registered', 'captured', 'composed', 'completed', 'cancelled', 'failed', 'anonymized')),
      started_at              TEXT NOT NULL,
      confirmed_at            TEXT,
      finished_at             TEXT,
      created_at              TEXT NOT NULL,
      updated_at              TEXT NOT NULL
    );
    CREATE INDEX idx_participations_campaign_started ON participations (campaign_id, started_at);
    CREATE INDEX idx_participations_document ON participations (document_number);

    -- 10.5 Evidencia de consentimientos (RF-CON-003)
    CREATE TABLE consents (
      id                 TEXT PRIMARY KEY,
      participation_id   TEXT NOT NULL REFERENCES participations (id),
      consent_version_id TEXT NOT NULL REFERENCES consent_versions (id),
      accepted           INTEGER NOT NULL CHECK (accepted IN (0, 1)),
      recorded_at        TEXT NOT NULL,
      UNIQUE (participation_id, consent_version_id)
    );

    -- 10.6 Fotografías (RF-FOT-002)
    CREATE TABLE photos (
      id               TEXT PRIMARY KEY,
      participation_id TEXT NOT NULL REFERENCES participations (id),
      kind             TEXT NOT NULL CHECK (kind IN ('original', 'final')),
      file_path        TEXT,
      format           TEXT,
      width            INTEGER,
      height           INTEGER,
      size_bytes       INTEGER,
      status           TEXT NOT NULL CHECK (status IN (
                         'captured', 'composed', 'pending', 'published', 'failed', 'expired', 'deleted')),
      public_token     TEXT UNIQUE,
      public_url       TEXT,
      published_at     TEXT,
      expires_at       TEXT,
      created_at       TEXT NOT NULL,
      updated_at       TEXT NOT NULL
    );
    CREATE INDEX idx_photos_participation ON photos (participation_id);
    CREATE INDEX idx_photos_status ON photos (status);

    -- Cola persistente de publicación (RF-RED-003, RF-QR-009)
    CREATE TABLE publication_queue (
      id              TEXT PRIMARY KEY,
      photo_id        TEXT NOT NULL UNIQUE REFERENCES photos (id),
      idempotency_key TEXT NOT NULL UNIQUE,
      status          TEXT NOT NULL CHECK (status IN ('pending', 'in_progress', 'done', 'failed', 'cancelled')),
      attempts        INTEGER NOT NULL DEFAULT 0,
      next_attempt_at TEXT NOT NULL,
      last_error      TEXT,
      created_at      TEXT NOT NULL,
      updated_at      TEXT NOT NULL
    );
    CREATE INDEX idx_publication_queue_due ON publication_queue (status, next_attempt_at);

    -- 10.8 Bitácora (RF-BIT-003)
    CREATE TABLE audit_events (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      occurred_at TEXT NOT NULL,
      level       TEXT NOT NULL CHECK (level IN ('debug', 'info', 'warn', 'error')),
      category    TEXT NOT NULL,
      action      TEXT NOT NULL,
      result      TEXT NOT NULL,
      actor_type  TEXT NOT NULL,
      actor_id    TEXT,
      entity_type TEXT,
      entity_id   TEXT,
      detail_json TEXT
    );
    CREATE INDEX idx_audit_events_occurred ON audit_events (occurred_at);
    CREATE INDEX idx_audit_events_category ON audit_events (category, occurred_at);

    -- Parámetros generales (RF-CFG-001)
    CREATE TABLE settings (
      key        TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      updated_by TEXT NOT NULL
    );
  `
}
