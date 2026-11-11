<?php
declare(strict_types=1);

/**
 * Controlador frontal del servicio de publicación (sección 20.4).
 *   GET    /api/v1/health               Disponibilidad (sin autenticación)
 *   POST   /api/v1/photos               Carga firmada e idempotente de la fotografía final
 *   DELETE /api/v1/photos/{id}          Eliminación anticipada, firmada
 *   GET    /f/{token}                   Página móvil de descarga
 *   GET    /f/{token}/image             Imagen para la página
 *   GET    /f/{token}/download          Descarga como archivo
 */

// Servidor integrado de PHP (desarrollo): los archivos estáticos se sirven directamente.
if (PHP_SAPI === 'cli-server' && is_file(__DIR__ . parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH))) {
    return false;
}

require __DIR__ . '/../app/bootstrap.php';

header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: no-referrer');
header('X-Frame-Options: DENY');
header('X-Robots-Tag: noindex, nofollow');

/**
 * Cabecera de la solicitud. Algunos servidores (proxy, LiteSpeed, FastCGI) no copian las cabeceras
 * propias a $_SERVER; en ese caso se buscan con getallheaders(), sin distinguir mayúsculas.
 */
function request_header(string $name): ?string
{
    $key = 'HTTP_' . strtoupper(str_replace('-', '_', $name));
    if (isset($_SERVER[$key]) && $_SERVER[$key] !== '') {
        return (string) $_SERVER[$key];
    }
    if (function_exists('getallheaders')) {
        foreach (getallheaders() as $header => $value) {
            if (strcasecmp((string) $header, $name) === 0) {
                return (string) $value;
            }
        }
    }
    return null;
}

function json_response(int $status, array $body): void
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode($body, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
}

/** Respuesta genérica: no revela si un token existió, caducó o es inválido (CA-007). */
function unavailable(array $config): void
{
    http_response_code(404);
    header('Cache-Control: no-store');
    header("Content-Security-Policy: default-src 'none'; style-src 'self'; img-src 'self'; frame-ancestors 'none'");
    require __DIR__ . '/../app/Views/unavailable.php';
}

try {
    [$config, $pdo] = publicador_boot();
} catch (Throwable $e) {
    error_log('publicador: ' . $e->getMessage());
    json_response(503, ['error' => 'service_unavailable']);
    return;
}

$store = new PhotoStore($pdo, $config);
$method = $_SERVER['REQUEST_METHOD'];
$path = rawurldecode(parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH) ?? '/');
$basePath = rtrim((string) parse_url($config['base_url'], PHP_URL_PATH), '/');
if ($basePath !== '' && str_starts_with($path, $basePath)) {
    $path = substr($path, strlen($basePath)) ?: '/';
}

try {
    if ($method === 'GET' && $path === '/api/v1/health') {
        json_response(200, ['status' => 'ok', 'time' => utc_now()]);
        return;
    }

    if (str_starts_with($path, '/api/')) {
        // La foto llega como formulario (campo `photo`), que todos los hostings entregan a PHP; se
        // acepta también el cuerpo en bruto. La firma cubre siempre los bytes del JPEG.
        $upload = $_FILES['photo'] ?? null;
        if ($upload !== null && ($upload['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) {
            json_response(413, ['error' => 'invalid_size', 'reason' => 'upload_error_' . (int) $upload['error']]);
            return;
        }
        $body = $upload !== null && is_uploaded_file($upload['tmp_name'])
            ? (string) file_get_contents($upload['tmp_name'])
            : (file_get_contents('php://input') ?: '');
        $signedPath = $basePath . $path;
        $problem = Signature::check(
            $config['secret'],
            $method,
            $signedPath,
            request_header('X-Totem-Timestamp'),
            request_header('X-Totem-Signature'),
            $body,
            (int) $config['max_clock_skew']
        );
        if ($problem !== null) {
            // Ruta y huella del cuerpo tal como llegaron: permiten diagnosticar un servidor que altera
            // la solicitud. No revelan nada de la clave.
            json_response(401, [
                'error' => 'invalid_signature',
                'reason' => $problem,
                'path' => $signedPath,
                'body_sha256' => hash('sha256', $body),
                'body_bytes' => strlen($body),
                'content_length' => $_SERVER['CONTENT_LENGTH'] ?? null,
                'files' => count($_FILES),
            ]);
            return;
        }

        if ($method === 'POST' && $path === '/api/v1/photos') {
            $id = request_header('X-Idempotency-Key') ?? '';
            if (!preg_match('/^[0-9a-f-]{36}$/', $id)) {
                json_response(400, ['error' => 'invalid_id']);
                return;
            }
            if (strlen($body) === 0 || strlen($body) > (int) $config['max_bytes']) {
                json_response(413, ['error' => 'invalid_size']);
                return;
            }
            $info = @getimagesizefromstring($body);
            if (!str_starts_with($body, "\xFF\xD8\xFF") || $info === false || $info[2] !== IMAGETYPE_JPEG) {
                json_response(415, ['error' => 'invalid_image']);
                return;
            }
            $existed = $store->findById($id);
            $row = $store->store($id, $body, (int) $info[0], (int) $info[1]);
            $reused = $existed && $existed['deleted_at'] === null;
            json_response($reused ? 200 : 201, [
                'token' => $row['token'],
                'url' => $store->publicUrl($row),
                'expiresAt' => $row['expires_at'],
            ]);
            return;
        }

        if ($method === 'DELETE' && preg_match('#^/api/v1/photos/([0-9a-f-]{36})$#', $path, $m)) {
            $row = $store->findById($m[1]);
            if ($row && $row['deleted_at'] === null) {
                $store->delete($row);
            }
            http_response_code(204);
            return;
        }

        json_response(404, ['error' => 'not_found']);
        return;
    }

    if ($method === 'GET' && preg_match('#^/f/([^/]+)(/image|/download)?$#', $path, $m)) {
        $limiter = new RateLimiter($pdo, (int) $config['rate_limit_per_minute']);
        if (!$limiter->allow($_SERVER['REMOTE_ADDR'] ?? '')) {
            http_response_code(429);
            header('Retry-After: 60');
            return;
        }
        $row = $store->findActive($m[1]);
        if (!$row || !is_file($store->path($row['file_name']))) {
            unavailable($config);
            return;
        }

        $variant = $m[2] ?? '';
        if ($variant === '') {
            header('Cache-Control: no-store');
            header("Content-Security-Policy: default-src 'none'; style-src 'self'; img-src 'self'; frame-ancestors 'none'");
            $expires = (new DateTimeImmutable($row['expires_at']))->setTimezone(new DateTimeZone($config['timezone']));
            $token = $row['token'];
            require __DIR__ . '/../app/Views/photo.php';
            return;
        }

        header('Content-Type: image/jpeg');
        header('Content-Length: ' . filesize($store->path($row['file_name'])));
        header('Cache-Control: private, max-age=300');
        if ($variant === '/download') {
            header('Content-Disposition: attachment; filename="editora-peru-fotografia.jpg"');
            $store->countDownload($row);
        } else {
            header('Content-Disposition: inline');
        }
        readfile($store->path($row['file_name']));
        return;
    }

    unavailable($config);
} catch (Throwable $e) {
    error_log('publicador: ' . $e->getMessage());
    json_response(500, ['error' => 'server_error']);
}
