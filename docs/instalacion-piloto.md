# Instalación del piloto en el tótem

Instalador: `dist/totem-editora-peru-<versión>-setup.exe` (Windows 10/11 de 64 bits, unos 176 MB).
Es una versión **de prueba**: los textos legales dicen «TEXTO DE PRUEBA». La descarga por QR ya
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

1. Entrar al panel: tocar **5 veces seguidas la esquina superior izquierda** (en menos de 3 s) o,
   con un teclado, **Ctrl+Shift+A**.
2. La primera vez pide crear el **usuario administrador** (guarde la contraseña).
3. Crear la campaña: **Campañas → Nueva campaña**, cargar escenarios y, dentro de cada escenario,
   sus personajes; en **Datos**, «Personajes: Obligatorio u Opcional»; revisar **Ubicación** y
   **Activar**.
4. Si hay varias cámaras, elegir la correcta en **Sistema → Parámetros generales** (nombre de la
   cámara).

Ya vienen incluidos: el protector de pantalla, la imagen de «Toque aquí para participar», el fondo
del recorrido, los textos legales de prueba y la configuración. Mientras no haya campañas con
escenarios, al tocar «Toque aquí» se muestra «Aún no hay escenarios disponibles».

## 3. Salir de la aplicación

Panel → **Sistema → Cerrar la aplicación**. (Alt+F4 está bloqueado en modo kiosco.)

## 4. Actualizar a una versión nueva

1. Cerrar la aplicación desde el panel.
2. Ejecutar el `.exe` nuevo. **Se conservan** campañas, usuarios, configuración y fotos.

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
