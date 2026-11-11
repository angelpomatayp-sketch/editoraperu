<?php
declare(strict_types=1);

/**
 * Elimina las fotografías vencidas y los contadores antiguos (RF-QR-006).
 * En cPanel, programar como tarea cron cada hora:  php /ruta/publicador/cron/expire.php
 */
if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

require __DIR__ . '/../app/bootstrap.php';

[$config, $pdo] = publicador_boot();
$removed = (new PhotoStore($pdo, $config))->purgeExpired();
(new RateLimiter($pdo, (int) $config['rate_limit_per_minute']))->purge();

echo utc_now() . " fotografías vencidas eliminadas: {$removed}\n";
