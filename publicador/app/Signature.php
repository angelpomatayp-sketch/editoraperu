<?php
declare(strict_types=1);

/**
 * Firma HMAC-SHA256 de las solicitudes del tótem. El texto firmado es:
 *   MÉTODO \n RUTA \n MARCA_DE_TIEMPO \n SHA256_HEX(CUERPO)
 * Debe coincidir con `signRequest` en src/infra/publication/signature.ts.
 */
final class Signature
{
    public static function canonical(string $method, string $path, string $timestamp, string $body): string
    {
        return strtoupper($method) . "\n" . $path . "\n" . $timestamp . "\n" . hash('sha256', $body);
    }

    public static function sign(string $secret, string $method, string $path, string $timestamp, string $body): string
    {
        return hash_hmac('sha256', self::canonical($method, $path, $timestamp, $body), $secret);
    }

    /** Verifica firma y marca de tiempo; rechaza solicitudes fuera de la ventana de reloj permitida. */
    public static function verify(
        string $secret,
        string $method,
        string $path,
        ?string $timestamp,
        ?string $signature,
        string $body,
        int $maxSkew
    ): bool {
        return self::check($secret, $method, $path, $timestamp, $signature, $body, $maxSkew) === null;
    }

    /**
     * Igual que verify, pero indica por qué se rechaza: 'missing_headers', 'clock_skew' o 'mismatch'.
     * El motivo ayuda a diagnosticar el servidor sin revelar nada de la clave. `null` si es válida.
     */
    public static function check(
        string $secret,
        string $method,
        string $path,
        ?string $timestamp,
        ?string $signature,
        string $body,
        int $maxSkew
    ): ?string {
        if ($timestamp === null || $signature === null || !ctype_digit($timestamp)) {
            return 'missing_headers';
        }
        if (abs(time() - (int) $timestamp) > $maxSkew) {
            return 'clock_skew';
        }
        return hash_equals(self::sign($secret, $method, $path, $timestamp, $body), strtolower($signature)) ? null : 'mismatch';
    }
}
