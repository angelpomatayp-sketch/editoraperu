# Instalación del piloto en el tótem

Instalador: `dist/totem-editora-peru-<versión>-setup.exe` (Windows 10/11 de 64 bits, unos 205 MB).
Desde 0.2.45 incluye avisos específicos del servicio, versionados sin alterar aceptaciones previas.
Su validación institucional (banco de datos, alojamiento y procedimiento para menores) sigue pendiente.
La descarga por QR ya
viene configurada (https://editora.wowtechperu.com): con Internet, al final de cada participación
aparece el QR; sin Internet, la foto queda en el tótem y se publica sola al volver la conexión.

## 1. Instalar

1. Iniciar sesión en Windows con la cuenta que usará el tótem (puede ser un usuario estándar: **no
   se necesita contraseña de administrador**).
2. Copiar el `.exe` al tótem y ejecutarlo. Windows puede mostrar «Windows protegió su PC» porque el
   instalador no tiene firma digital: **Más información → Ejecutar de todas formas**.
3. Se instala solo, sin preguntas, y al terminar la aplicación se abre a pantalla completa (modo
   kiosco), configurada para iniciarse sola con Windows en esa cuenta.

Si el equipo tiene una versión anterior a la 0.2.4 (se instalaban para todo el equipo y pedían
administrador), desinstálela primero.

La interfaz es vertical. En el tótem, Windows debe tener la pantalla en **orientación vertical**
(Configuración → Sistema → Pantalla → Orientación de la pantalla → Vertical, si el monitor no la
informa así por sí mismo); entonces ocupa toda la pantalla. En una pantalla horizontal, como la de
una laptop, se ve centrada con franjas negras a los lados.

## 2. Primer uso

1. Entrar al panel: tocar **una vez el engranaje de la esquina superior izquierda** o,
   con un teclado, **Ctrl+Shift+A**.
2. La primera vez pide crear el **usuario administrador** (guarde la contraseña).
3. Crear la campaña: **Campañas → Nueva campaña**, cargar escenarios y, dentro de cada escenario,
   sus personajes; en **Datos**, «Personajes: Obligatorio u Opcional»; revisar **Ubicación** y
   **Activar**.
4. Si hay varias cámaras, elegir la correcta en **Sistema → Parámetros generales** (nombre de la
   cámara).

Desde 0.2.54, el acceso administrativo y la creación de la primera cuenta incluyen teclado en
pantalla. Toque el campo que desea escribir; **Mayús** activa la siguiente letra mayúscula y
**#+=** muestra símbolos (incluidos `@`, `_` y `.`); **ABC** vuelve a las letras. Los números
siempre están disponibles. La contraseña permanece oculta y también se admite teclado físico.
Este cambio no modifica la cámara, el recorte ni la calidad de la fotografía.

En el primer inicio se descarga BiRefNet (aproximadamente 973 MB) con Internet. Se conserva en
actualizaciones; no necesita Node.js, Python ni XAMPP en el tótem.

## Recuperar una fotografía que no se publicó

En **Participaciones**, localizar el registro y tocar **Reintentar publicación**. Al completarse
se muestra un QR grande en el propio panel. Para una foto publicada y vigente, **Mostrar QR**
reutiliza el mismo enlace sin subir otra copia. El QR se oculta a los 90 segundos, al vencer el
enlace o al salir del detalle. No hay que copiar enlaces ni abrir el navegador del tótem.

La política inicial desde 0.2.45 es 7 días para archivos fotográficos locales y 30 días para
nombres/DNI. La actualización aplica esos valores una sola vez; después siguen siendo configurables.
La limpieza se ejecuta al iniciar y cada 6 horas, excluye sesiones aún abiertas y publicaciones
en curso y exige un aviso registrado al menos 24 horas antes de borrar cada foto.
Los archivos antiguos reciben ese margen adicional al actualizar. El panel avisa cuando quedan
fotos sin publicar cerca del vencimiento. El operador debe revisarlas; no hay entrega remota automática.
Los QR publicados siguen disponibles hasta su vencimiento aunque se limpie la copia local.
Respaldos externos y evidencia histórica del consentimiento no se borran mediante esta política.

El servidor conserva las fotos 72 horas desde la publicación exitosa. La limpieza del hosting
se despliega por separado: ver `docs/entrega-0.2.45.md`.

Ya vienen incluidos: el protector de pantalla, la imagen de «Toque aquí para participar», el fondo
del recorrido, los textos legales de prueba y la configuración. Mientras no haya campañas con
escenarios, al tocar «Toque aquí» se muestra «Aún no hay escenarios disponibles».

## 3. Salir de la aplicación

Panel → **Sistema → Cerrar la aplicación**. (Alt+F4 está bloqueado en modo kiosco.)

Desde 0.2.46 también puede tocar la **X de la esquina superior derecha** de la pantalla inicial.
Muestra confirmación con **Cancelar** o **Cerrar aplicación**, sin pedir credenciales. Cualquier
persona con acceso al tótem puede cerrarlo y dejar Windows visible. Cancelar conserva la pantalla.
El engranaje sigue exigiendo usuario y contraseña. El instalador crea un acceso directo con el icono
de Editora Perú y cámara; no cambia la política de inicio automático configurada.

## 4. Actualizar a una versión nueva

1. Cerrar la aplicación desde el panel.
2. Ejecutar el `.exe` nuevo. **Se conservan** campañas, usuarios, configuración y fotos.

### Conservación de detalle y color (0.2.53)

Instalar encima de la versión anterior, sin desinstalar. Campañas, posiciones y calibraciones
guardadas se conservan. En **Sistema → Fondo de la foto** hay dos opciones independientes,
desactivadas por defecto también al actualizar desde una versión anterior:

- **Aplicar ajustes de imagen desde el tótem:** desactivada, el tótem no envía brillo, exposición,
  balance de blancos ni enfoque, ni fuerza modos automáticos. La calibración guardada no se borra;
  activarla permite aplicar solo los valores elegidos aquí. La cámara/controlador aún puede aplicar
  su propio procesamiento. La solicitud de resolución 4K, FPS, rotación y espejo se mantiene.
- **Adaptar brillo y color del participante al escenario y personajes:** desactivada conserva el
  color capturado en las zonas opacas. El recorte, la limpieza de bordes y la sombra siguen funcionando.
  Activarla afecta solo a la composición con recorte; nunca al original ni al fondo real.

Se corrigió el límite de ampliación del encuadre automático: se calcula sobre los píxeles de salida
4K (máximo 2×), no sobre la vista previa HD que podía duplicar ese límite. Se eliminaron los JPEG
intermedios de la ruta sin recorte: ahora son PNG sin pérdida, con un único JPEG final 95/4:4:4
durante la composición. También aplica al fondo real y a la foto dentro de un hueco de escenario.

Para verificar en el tótem: dejar ambas opciones desactivadas, tomar una foto con escenario y otra
con fondo real y revisar los archivos originales/finales a igual escala. Las pruebas automatizadas
comprueban conservación de píxeles opacos, resolución y geometría; no certifican el enfoque,
iluminación ni el detalle óptico de una cámara física.

### Captura original obligatoria en 4K (desde 0.2.52)

La aplicación solicita UHD a la cámara desde la apertura y comprueba la imagen recibida antes
de guardarla: mínimo 3840 × 2160, o 2160 × 3840 con orientación vertical. No amplía una captura
HD para hacerla pasar por 4K. Si la foto del sensor falla, solo se admite el cuadro del vídeo
cuando también alcanza UHD; si ninguno cumple, aparece **No se pudo capturar en 4K** y no se guarda.
El proceso principal vuelve a comprobar el JPEG original y registra su resolución real.

En **Fondo de la foto**, el indicador ahora dice **vista en vivo** y avisa si está por debajo
de 4K. Algunos controladores permiten foto UHD con vídeo de menor resolución: la validación
definitiva es sobre cada fotografía recibida, no sobre las capacidades anunciadas ni sobre el
tamaño del montaje final. Los ajustes de brillo, exposición y enfoque conservan las restricciones
de resolución. La preparación se realiza antes de posar y de iniciar la cuenta regresiva.

Antes de usar con público: cerrar Cámara de Windows u otras aplicaciones de cámara, seleccionar
la cámara del tótem, realizar una toma y comprobar el original en `photos/originals` y el evento
`capture.save` de la bitácora. Si no cumple, revisar conexión, controlador y modos disponibles;
no se ofrece una opción para guardar en HD. Esto no recupera detalle perdido por desenfoque,
movimiento o iluminación, ni certifica que el controlador no interpole internamente.

### Ajuste del participante al personaje (desde 0.2.51)

En **Sistema → Configuración general → Captura**, activar **Adaptar el tamaño de la persona al
personaje seleccionado** y guardar. No exige activar el encuadre automático general. Al actualizar
queda desactivado para conservar el comportamiento anterior.

Con recorte automático del fondo, toma la altura visible y la línea de apoyo del primer personaje
seleccionado, incluidos su tamaño y desplazamiento configurados en la campaña. Amplía o reduce al
participante proporcionalmente, dentro de su zona y con límite de ampliación para cuidar la nitidez.
El ajuste se suaviza y se fija durante los últimos dos segundos de la cuenta; la foto final conserva
esa geometría. Si hay varios participantes, se toma su silueta conjunta, no se redimensionan por separado.

La cámara debe captar el cuerpo entero. Si la silueta toca los bordes, no se fuerza la comparación;
si no hay un personaje de referencia válido, se usa el encuadre habitual. No cambia el fondo real de
la cámara, el modo croma ni los escenarios con hueco para la foto. Si el personaje queda fuera de la
zona disponible, el apoyo y el tamaño del participante se limitan a esa zona.

En el tótem, verificar con una persona cercana y otra más alejada, un personaje reducido y otro más
grande, y una repetición de foto. Comprobar que el tamaño no salte al disparar y coincida con el resultado.

## 5. Desinstalar (deja el equipo limpio)

Configuración de Windows → Aplicaciones → «Totem Editora Peru» → Desinstalar.
Se borra **todo**: la aplicación, los datos (`%LOCALAPPDATA%\EditoraPeruTotem`: base, fotos,
contenido, bitácoras), la caché (`%APPDATA%\EditoraPeruTotem`) y el inicio automático. Una
instalación posterior empieza de cero, sin archivos anteriores.

## 6. Qué verificar en el piloto

| Prueba | Resultado esperado |
|---|---|
| Encender el equipo | La aplicación inicia sola, a pantalla completa, con el protector |
| Tocar el protector | Pasa a «Toque aquí para participar» |
| Recorrido completo con la cámara del tótem | Persona recortada sin el fondo, personaje ubicado a gusto, foto final igual a la vista previa |
| Cancelar en cualquier paso | Vuelve a «Toque aquí para participar» sin datos visibles |
| Dejar de tocar | Advertencia y regreso automático |
| Alt+F4, tecla Windows, gestos de borde | No se sale al escritorio |
| Desinstalar y volver a instalar | Empieza de cero (pide crear el administrador otra vez) |

Problemas: los registros están en `%LOCALAPPDATA%\EditoraPeruTotem\logs`.
