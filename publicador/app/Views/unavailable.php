<?php
$base = rtrim((string) parse_url($config['base_url'] ?? '', PHP_URL_PATH), '/');
$e = static fn (string $v): string => htmlspecialchars($v, ENT_QUOTES, 'UTF-8');
?><!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow">
  <title>Enlace no disponible · Editora Perú</title>
  <link rel="stylesheet" href="<?= $e($base) ?>/assets/style.css">
</head>
<body>
  <main class="page">
    <header class="brand">Editora Perú</header>
    <h1>Enlace no disponible</h1>
    <p>Este enlace no existe o ya venció. Las fotografías están disponibles por un tiempo limitado.</p>
  </main>
</body>
</html>
