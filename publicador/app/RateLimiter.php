<?php
declare(strict_types=1);

/** Límite simple de solicitudes por minuto y dirección IP; guarda solo una huella de la IP. */
final class RateLimiter
{
    public function __construct(private PDO $pdo, private int $perMinute)
    {
    }

    public function allow(string $ip): bool
    {
        $key = hash('sha256', $ip);
        $window = intdiv(time(), 60);
        $update = $this->pdo->prepare('UPDATE rate_hits SET hits = hits + 1 WHERE hit_key = ? AND window_start = ?');
        $update->execute([$key, $window]);
        if ($update->rowCount() === 0) {
            try {
                $this->pdo->prepare('INSERT INTO rate_hits (hit_key, window_start, hits) VALUES (?, ?, 1)')->execute([$key, $window]);
            } catch (PDOException) {
                $update->execute([$key, $window]);
            }
        }
        $stmt = $this->pdo->prepare('SELECT hits FROM rate_hits WHERE hit_key = ? AND window_start = ?');
        $stmt->execute([$key, $window]);
        return (int) $stmt->fetchColumn() <= $this->perMinute;
    }

    /** Elimina los contadores de ventanas anteriores. */
    public function purge(): void
    {
        $this->pdo->prepare('DELETE FROM rate_hits WHERE window_start < ?')->execute([intdiv(time(), 60) - 1]);
    }
}
