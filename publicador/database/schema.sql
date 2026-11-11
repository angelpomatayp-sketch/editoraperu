-- Esquema del servicio de publicación. Compatible con SQLite y MySQL.
-- No guarda nombres, DNI ni consentimientos: solo el identificador técnico, el token y fechas (RN-004).
-- Fechas en UTC con formato ISO 8601 (comparables como texto).

CREATE TABLE IF NOT EXISTS photos (
    id          VARCHAR(64) PRIMARY KEY,   -- identificador de la fotografía en el tótem (idempotencia)
    token       VARCHAR(64) NOT NULL UNIQUE,
    file_name   VARCHAR(80) NOT NULL,
    size_bytes  INTEGER     NOT NULL,
    width       INTEGER     NOT NULL,
    height      INTEGER     NOT NULL,
    created_at  VARCHAR(32) NOT NULL,
    expires_at  VARCHAR(32) NOT NULL,
    deleted_at  VARCHAR(32) NULL,
    downloads   INTEGER     NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS rate_hits (
    hit_key      VARCHAR(64) NOT NULL,     -- huella SHA-256 de la IP; no se guarda la IP
    window_start INTEGER     NOT NULL,
    hits         INTEGER     NOT NULL,
    PRIMARY KEY (hit_key, window_start)
);
