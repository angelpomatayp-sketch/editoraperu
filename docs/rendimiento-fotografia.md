# Ejecución de fotografía final (0.2.40)

El modelo BiRefNet Portrait FP32, la entrada de 1024 × 1024, el escalado, la máscara,
los colores y el JPEG 4K de calidad 95 se conservan. No se cuantiza ni se cambia de modelo.

Cambios de ejecución:

- ONNX y todo el montaje se ejecutan en un único worker persistente, fuera del hilo principal
  de Electron. El mismo modelo se reutiliza entre participaciones; no hay una copia por foto.
- Hasta 8 hilos de CPU según la disponibilidad del equipo, sin espera activa de los hilos ociosos.
- El refinado reutiliza una tabla auxiliar Float64 en vez de reservar seis por foto. Los cálculos
  y su orden son iguales; hay una prueba de regresión con el hash del resultado anterior.
- Los PNG intermedios usan compresión sin pérdidas de nivel 1. Esto no cambia los píxeles
  ni la compresión del JPEG final.
- La cuenta para posar tiene un valor predeterminado de 10 segundos, aplicado una sola vez
  al actualizar. Después se puede modificar en Sistema.

Los tiempos por etapa quedan en `%LOCALAPPDATA%\EditoraPeruTotem\logs\totem-AAAA-MM-DD.log`
como `composition.timing`: `model_load`, `inference`, `matte`, `refine`, `integration`,
`compose_total`. `model_load` se incluye en `matte` si el modelo no se había cargado;
no se deben sumar etapas que se contienen entre sí. El arranque precarga los pesos en el worker.

## Validación y límites

En la captura 4K local de prueba, 4 hilos tardaron unos 58 segundos en frío y 8 hilos unos
53 segundos; la salida comparada coincidió píxel por píxel. La selección automática tardó
unos 60 segundos: no fue una mejora en este equipo. Con la optimización final, una repetición
dio 54 segundos en frío y 56 con el modelo cargado, sin diferencias en los píxeles respecto de
la referencia. No se demostró una reducción importante ni sostenida de la espera de inferencia.
Son mediciones puntuales de un equipo
con Intel Iris Plus, no del Core 7 240H del tótem.

DirectML se evaluó, pero la inferencia falló por falta de recursos en la gráfica de prueba.
Por eso CPU sigue siendo el valor predeterminado. No se promete una espera de pocos segundos
manteniendo este modelo en CPU. Separar el trabajo evita bloquear el hilo principal, pero
no elimina la carga de CPU, memoria, ventilación o las limitaciones térmicas.

## Comparación reproducible (desarrollo)

Después de compilar, la prueba opcional `tests/integration/imagingPerformance.test.ts` procesa
una captura real en 4K, registra tiempos, comprueba que el hilo principal sigue atendiendo
temporizadores y compara los píxeles. No sube las imágenes a ningún servicio.

Variables: `TOTEM_TEST_PERFORMANCE=1`, `TOTEM_TEST_PHOTO` (original),
`TOTEM_TEST_REFERENCE` (JPEG de referencia), `TOTEM_TEST_ONLY_CPU_THREADS=8`,
`TOTEM_TEST_REPEAT=1` (repetir con el modelo cargado), `TOTEM_TEST_REPORT` (JSON de resultados).
DirectML solo se evalúa si se pide expresamente con `TOTEM_TEST_DML=1`.

La aplicación permite pruebas controladas con `TOTEM_PHOTO_THREADS` y `TOTEM_PHOTO_PROVIDER`;
sin esas variables usa CPU FP32 y hasta 8 hilos. No habilitar DirectML en producción sin validar
el hardware, la memoria, las fotografías y el manejo de fallos en el tótem.
