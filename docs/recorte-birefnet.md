# Prueba de recorte fotográfico con BiRefNet Portrait

Desde 0.2.36, el primer inicio descarga BiRefNet Portrait y verifica tamaño y checksum antes
de habilitar la aplicación. Muestra progreso y permite reintentar si falla la conexión.
El modelo se guarda en `%LOCALAPPDATA%\EditoraPeruTotem\models\birefnet-portrait.onnx`
(o en `TOTEM_DATA_DIR/models` si se configuró otra carpeta). Se conserva al actualizar;
desinstalar completamente elimina los datos y el modelo. Los siguientes inicios verifican
el archivo local y no necesitan Internet para el recorte. No se cambia a MODNet en silencio
si falla la descarga: hay que reintentar o salir.

En desarrollo también se puede reutilizar `resources/models/birefnet-portrait.onnx`.
La aplicación mantiene Electron, TypeScript, Sharp y ONNX Runtime; no necesita Python, un
servidor ni enviar fotografías a Internet. MODNet sigue procesando personajes importados.
Si BiRefNet no está instalado, la foto usa MODNet como antes; la bitácora registra la selección
en `segmentation.photo_model`. Un error durante el procesamiento mantiene el comportamiento
de respaldo existente y registra `segmentation_failed`.

## Preparación y prueba

1. Ejecutar `npm run models` para preparar los recursos de desarrollo, o permitir que el primer
   inicio descargue BiRefNet (unos 928 MiB; checksum del export ONNX verificado contra rembg).
2. Ejecutar `npm run dev` y seleccionar recorte automático en Sistema.
3. Tomar una foto con escenario. La vista previa continúa usando MediaPipe; el nuevo modelo
   se aprecia en la composición final, no en la vista previa.
4. Comparar la misma captura original: cabello, brazos cruzados, espacios entre piernas,
   ropa parecida al ambiente y objetos detrás de la persona. Medir también el tiempo de espera
   y la memoria en el tótem antes de distribuir un instalador.

La entrada del modelo es RGB normalizado con medias/desviaciones ImageNet a 1024 × 1024,
según la implementación de rembg. La salida recibe sigmoid y normalización; la máscara vuelve
al tamaño de la foto, con refinado existente a resolución de composición. El RGB conserva
la resolución prevista por la composición (incluidas capturas 4K); una máscara 1024 no implica
reducir la foto a 1024. La guía de baja resolución no rellena ni limita la máscara de BiRefNet.

Prueba opcional del modelo real en PowerShell:

```powershell
$env:TOTEM_TEST_BIREFNET = '1'
$env:TOTEM_TEST_PHOTO = 'C:\ruta\captura-original.jpg'
# Opcional: directorio existente para guardar máscara y PNG con transparencia.
$env:TOTEM_TEST_OUTPUT = 'C:\ruta\comparacion'
npm test -- tests/integration/birefnet.test.ts
```

La prueba registra tiempo y resolución; no certifica calidad visual. BiRefNet necesita más
memoria y CPU que MODNet. No se garantiza un recorte perfecto para cualquier ambiente:
hay que validar capturas reales y el rendimiento del hardware del tótem.

Validación local del 11 de noviembre de 2026: compilación y TypeScript correctos;
pruebas del adaptador, refinado, integración y composición correctas. Dos ejecuciones del
modelo real terminaron correctamente (aproximadamente 64 y 69 segundos en frío, incluyendo
carga y prueba); se observó un proceso de unos 6,7 GB. La captura real local usada mide
720 × 1280, con poca luz y la persona girada: la máscara separó la silueta del ambiente.
Esto no valida todavía cuerpo entero en 4K ni la latencia del tótem. La versión 0.2.35
incluía el modelo en el instalador; desde 0.2.36 se descarga por separado. El archivo y el
procesamiento son iguales: cambia la distribución, no la calidad ni el consumo de memoria.

## Fuentes y licencia

- Modelo orientado a retratos: https://github.com/danielgatis/rembg
- Preprocesado: https://github.com/danielgatis/rembg/blob/main/rembg/sessions/birefnet_general.py
- Export y checksum: https://github.com/danielgatis/rembg/blob/main/rembg/sessions/birefnet_portrait.py
- Proyecto y licencia MIT: https://github.com/ZhengPeng7/BiRefNet

`npm run models` incluye la licencia de BiRefNet junto al modelo para su distribución.
