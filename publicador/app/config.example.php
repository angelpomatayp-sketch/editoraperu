<?php
/**
 * Configuración del servicio de publicación. Copiar como `config.php` (no se versiona) y completar.
 * En cPanel, `app/` y `storage/` deben quedar fuera de la raíz pública; solo `public/` es accesible.
 */
return [
    // URL pública con la que se arman los enlaces del QR. En producción, HTTPS (RF-QR-002).
    'base_url' => 'https://fotos.dominio.pe',

    // Clave compartida con el tótem para firmar las cargas (HMAC-SHA256). Mínimo 32 caracteres aleatorios.
    'secret' => 'CAMBIAR-POR-UNA-CLAVE-ALEATORIA-DE-AL-MENOS-32-CARACTERES',

    // Base de datos: SQLite por defecto; para MySQL usar 'mysql:host=localhost;dbname=...;charset=utf8mb4'.
    'db_dsn' => 'sqlite:' . __DIR__ . '/../storage/publicador.sqlite',
    'db_user' => null,
    'db_password' => null,

    // Carpeta de fotografías, fuera de la raíz pública (RF-QR-005).
    'storage_dir' => __DIR__ . '/../storage/photos',

    // Horas desde la publicación exitosa; la tarea cron elimina los archivos vencidos.
    'ttl_hours' => 72,

    // Tamaño máximo aceptado por fotografía.
    'max_bytes' => 15 * 1024 * 1024,

    // Solicitudes por minuto y dirección IP a las páginas de descarga.
    'rate_limit_per_minute' => 120,

    // Diferencia máxima de reloj aceptada entre el tótem y el servidor, en segundos.
    'max_clock_skew' => 300,

    'timezone' => 'America/Lima',
];
