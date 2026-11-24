<?php
declare(strict_types=1);

/**
 * Fotografías publicadas. Los archivos se guardan fuera de la raíz pública con un nombre aleatorio
 * distinto del token, y solo se entregan a través de PHP (RF-QR-005).
 */
final class PhotoStore
{
    public function __construct(private PDO $pdo, private array $config)
    {
    }

    /** Busca una publicación vigente por su token; `null` si no existe, se eliminó o caducó. */
    public function findActive(string $token): ?array
    {
        if (!self::isTokenFormat($token)) {
            return null;
        }
        $stmt = $this->pdo->prepare('SELECT * FROM photos WHERE token = ? AND deleted_at IS NULL AND expires_at > ?');
        $stmt->execute([$token, utc_now()]);
        $row = $stmt->fetch();
        return $row ?: null;
    }

    public function findById(string $id): ?array
    {
        $stmt = $this->pdo->prepare('SELECT * FROM photos WHERE id = ?');
        $stmt->execute([$id]);
        $row = $stmt->fetch();
        return $row ?: null;
    }

    /**
     * Guarda una fotografía. Es idempotente por identificador: repetir la carga devuelve la misma
     * publicación sin duplicarla (RF-QR-009).
     */
    public function store(string $id, string $jpeg, int $width, int $height): array
    {
        $existing = $this->findById($id);
        if ($existing && $existing['deleted_at'] === null) {
            return $existing;
        }

        $token = rtrim(strtr(base64_encode(random_bytes(32)), '+/', '-_'), '=');
        $fileName = bin2hex(random_bytes(16)) . '.jpg';
        $path = $this->path($fileName);
        if (file_put_contents($path . '.part', $jpeg) === false || !rename($path . '.part', $path)) {
            @unlink($path . '.part');
            throw new RuntimeException('No se pudo guardar la fotografía');
        }

        $row = [
            'id' => $id,
            'token' => $token,
            'file_name' => $fileName,
            'size_bytes' => strlen($jpeg),
            'width' => $width,
            'height' => $height,
            'created_at' => utc_now(),
            'expires_at' => utc_now((int) round(((float) $this->config['ttl_hours']) * 3600)),
            'deleted_at' => null,
            'downloads' => 0,
        ];
        if ($existing) {
            $this->pdo->prepare('DELETE FROM photos WHERE id = ?')->execute([$id]);
        }
        $stmt = $this->pdo->prepare(
            'INSERT INTO photos (id, token, file_name, size_bytes, width, height, created_at, expires_at, deleted_at, downloads)
             VALUES (:id, :token, :file_name, :size_bytes, :width, :height, :created_at, :expires_at, :deleted_at, :downloads)'
        );
        $stmt->execute($row);
        return $row;
    }

    /** Elimina el archivo y marca la publicación como eliminada; conserva solo la constancia técnica. */
    public function delete(array $row): void
    {
        $path = $this->path($row['file_name']);
        if (is_file($path) && !@unlink($path) && is_file($path)) {
            throw new RuntimeException('No se pudo eliminar una fotografía vencida');
        }
        $this->pdo->prepare('UPDATE photos SET deleted_at = ? WHERE id = ?')->execute([utc_now(), $row['id']]);
    }

    /** Elimina las publicaciones vencidas (RF-QR-006). Devuelve cuántas eliminó. */
    public function purgeExpired(int $limit = 0): int
    {
        $sql = 'SELECT * FROM photos WHERE deleted_at IS NULL AND expires_at <= ? ORDER BY expires_at';
        if ($limit > 0) $sql .= ' LIMIT ' . (int) $limit;
        $stmt = $this->pdo->prepare($sql);
        $stmt->execute([utc_now()]);
        $count = 0;
        foreach ($stmt->fetchAll() as $row) {
            $this->delete($row);
            $count++;
        }
        return $count;
    }

    public function countDownload(array $row): void
    {
        $this->pdo->prepare('UPDATE photos SET downloads = downloads + 1 WHERE id = ?')->execute([$row['id']]);
    }

    public function path(string $fileName): string
    {
        return rtrim($this->config['storage_dir'], '/\\') . DIRECTORY_SEPARATOR . basename($fileName);
    }

    public function publicUrl(array $row): string
    {
        return rtrim($this->config['base_url'], '/') . '/f/' . $row['token'];
    }

    public static function isTokenFormat(string $token): bool
    {
        return (bool) preg_match('/^[A-Za-z0-9_-]{43}$/', $token);
    }
}
