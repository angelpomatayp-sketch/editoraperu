<?php
declare(strict_types=1);

require __DIR__ . '/Signature.php';
require __DIR__ . '/PhotoStore.php';
require __DIR__ . '/RateLimiter.php';

/** Carga la configuración, valida lo esencial y abre la base, creando el esquema si no existe. */
function publicador_boot(): array
{
    // PUBLICADOR_CONFIG permite usar otra configuración (pruebas automatizadas).
    $configFile = getenv('PUBLICADOR_CONFIG') ?: __DIR__ . '/config.php';
    if (!is_file($configFile)) {
        throw new RuntimeException('Falta app/config.php (copiar desde config.example.php)');
    }
    $config = require $configFile;
    if (strlen((string) ($config['secret'] ?? '')) < 32) {
        throw new RuntimeException('La clave compartida debe tener al menos 32 caracteres');
    }
    date_default_timezone_set('UTC');

    // Antes de abrir la base: con SQLite, el archivo vive dentro de storage/.
    if (!is_dir($config['storage_dir'])) {
        mkdir($config['storage_dir'], 0750, true);
    }

    $pdo = new PDO($config['db_dsn'], $config['db_user'] ?? null, $config['db_password'] ?? null, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    ]);
    $schema = file_get_contents(__DIR__ . '/../database/schema.sql');
    foreach (array_filter(array_map('trim', explode(';', preg_replace('/--[^\n]*/', '', $schema)))) as $statement) {
        $pdo->exec($statement);
    }

    // Respaldo del cron: con tráfico, limpia lotes limitados una vez por hora.
    // Sin tráfico sigue siendo necesaria la tarea cron para garantizar la limpieza puntual.
    if (PHP_SAPI !== 'cli') publicador_cleanup_if_due($pdo, $config);
    return [$config, $pdo];
}

function publicador_cleanup_if_due(PDO $pdo, array $config): void
{
    $marker = dirname(rtrim($config['storage_dir'], '/\\')) . DIRECTORY_SEPARATOR . '.publicador-cleanup.lock';
    clearstatcache(true, $marker);
    if (is_file($marker) && filemtime($marker) > time() - 3600) return;
    $lock = @fopen($marker, 'c+');
    if (!$lock) { error_log('Publicador: no se pudo abrir el control de limpieza'); return; }
    if (!flock($lock, LOCK_EX | LOCK_NB)) { fclose($lock); return; }
    try {
        // Otra solicitud pudo completar el trabajo mientras abríamos el archivo.
        rewind($lock);
        $last = (int) stream_get_contents($lock);
        if ($last > time() - 3600) return;
        (new PhotoStore($pdo, $config))->purgeExpired(200);
        (new RateLimiter($pdo, (int) $config['rate_limit_per_minute']))->purge();
        ftruncate($lock, 0);
        rewind($lock);
        fwrite($lock, (string) time());
        fflush($lock);
        touch($marker);
    } catch (Throwable $error) {
        error_log('Publicador: limpieza pendiente; revisar cron y permisos de almacenamiento');
    } finally { flock($lock, LOCK_UN); fclose($lock); }
}

/** Fecha UTC en formato ISO 8601, comparable como texto. */
function utc_now(int $offsetSeconds = 0): string
{
    return gmdate('Y-m-d\TH:i:s\Z', time() + $offsetSeconds);
}
