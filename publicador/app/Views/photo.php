<?php
/** @var string $token */
/** @var DateTimeImmutable $expires */
$base = rtrim((string) parse_url($config['base_url'], PHP_URL_PATH), '/');
$e = static fn (string $v): string => htmlspecialchars($v, ENT_QUOTES, 'UTF-8');
?><!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow">
  <title>Su fotografía · Editora Perú</title>
  <link rel="stylesheet" href="<?= $e($base) ?>/assets/style.css">
</head>
<body>
  <main class="page">
    <header class="brand">Editora Perú</header>
    <h1>¡Aquí está su fotografía!</h1>
    <img class="photo" src="<?= $e($base) ?>/f/<?= $e($token) ?>/image" alt="Su fotografía">
    <a class="button" href="<?= $e($base) ?>/f/<?= $e($token) ?>/download">Descargar fotografía</a>
    <p class="hint">Si la descarga no inicia, mantenga presionada la imagen y elija «Guardar imagen».</p>
    <p class="expires">Disponible hasta el <?= $e($expires->format('d/m/Y')) ?> a las <?= $e($expires->format('H:i')) ?> (hora de Lima).</p>
  </main>
</body>
</html>
