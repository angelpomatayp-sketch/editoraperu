# Lista de verificación en el tótem

Pruebas que **no** pueden hacerse en el equipo de desarrollo porque dependen del hardware final, de
Windows en modo kiosco o del servidor de producción. Se ejecutan en la Fase 9, con el instalador
generado, y se repiten en la marcha blanca (Fase 10).

Para cada prueba se anotan la fecha, el responsable, el resultado (Aprobado / Observado / Rechazado)
y la evidencia (foto, video o archivo).

## Equipo y Windows

| Id | Prueba | Cómo | Resultado esperado | Resultado |
|---|---|---|---|---|
| T-01 | Inicio automático | Encender el equipo sin intervenir | La aplicación abre sola en pantalla completa y muestra la atracción (RF-KIO-001) | |
| T-02 | Restricción del escritorio | Probar gestos de borde, deslizar desde los lados, mantener presionado, teclado táctil del sistema | El participante no llega al escritorio ni a otras aplicaciones (RF-KIO-003, CA-001) | |
| T-03 | Teclas de sistema | Con un teclado conectado: Alt+F4, Alt+Tab, Win, Ctrl+Alt+Supr | Ninguna saca al participante de la aplicación; Ctrl+Alt+Supr solo lo resuelve la política de Windows (PD-013) | |
| T-04 | Cierre controlado | Acción reservada → panel → cerrar con credenciales | Solo un usuario autorizado cierra la aplicación (RF-KIO-005) | |

## Pantalla y cámara

| Id | Prueba | Cómo | Resultado esperado | Resultado |
|---|---|---|---|---|
| T-05 | Uso táctil en 55" | Recorrido completo por personas de distinta estatura | Todos los botones se alcanzan y responden al primer toque; el teclado en pantalla es cómodo (RNF-002) | |
| T-06 | Videos de atracción | Dejar la atracción 2 h con los videos finales | Reproducción fluida, sin pantallas negras ni saltos (RF-MUL-003) | |
| T-07 | Recursos reales | Cargar escenarios, personajes y marcos de Editora Perú desde el panel | Se validan y se ven bien en la vista previa y en la foto final | |
| T-08 | Cámara 4K real | Abrir la vista previa; desconectar y reconectar el cable USB | Vista previa fluida; mensaje controlado al desconectar; vuelve al reintentar (CA-005) | |
| T-09 | Captura con la luz del local | Fotos con 1, 2 y 3 personas, de día y de noche | Persona nítida, colores naturales, recorte limpio de cabello y bordes | |
| T-10 | Combinaciones aprobadas | Una foto por cada escenario con cada personaje y marco | Sin deformaciones, capas en el orden correcto, resolución aprobada (CA-006, PD-005) | |

## Red y servidor de producción

| Id | Prueba | Cómo | Resultado esperado | Resultado |
|---|---|---|---|---|
| T-11 | Publicación en cPanel | Recorrido completo con el servicio en el dominio final | El QR aparece y abre la foto correcta; se registra el tiempo desde «Continuar» con la red del local | |
| T-12 | QR desde teléfonos | Escanear con Android e iPhone usando **datos móviles** (sin Wi-Fi) | Abre la foto por HTTPS, se descarga; un token alterado o vencido muestra la página genérica (CA-007) | |
| T-13 | Corte de Internet | Desconectar la red, hacer 2 participaciones, reconectar | Sin QR inválido; ambas fotos se publican solas al volver la conexión (CA-008) | |
| T-14 | Corte de energía | Apagar el equipo a la fuerza durante la captura y durante la publicación | Al encender vuelve a la atracción; base íntegra; nada se publica dos veces (CA-012) | |

## Operación

| Id | Prueba | Cómo | Resultado esperado | Resultado |
|---|---|---|---|---|
| T-15 | CSV en Excel | Exportar participaciones y abrirlas en el Excel de Editora Perú | Tildes y ñ correctas, columnas separadas, sin fórmulas ejecutadas (CA-010) | |
| T-16 | Operación continua | Dejar el tótem 16 h con uso intermitente | Sin cierres, memoria estable, disco y temperatura dentro de lo normal (RNF-004) | |
| T-17 | Tiempos en el hardware final | Medir con cronómetro: toque en la atracción → cámara; «Tomar foto» → resultado; «Continuar» → QR | Registrar los valores para fijar el objetivo de RNF-003 (PD-014) | |
| T-18 | Respaldo y restauración | Crear un respaldo desde el panel y restaurarlo en otra carpeta | Base, contenido y configuración completos, sin claves (RF-ALM-005) | |

Referencia del equipo de desarrollo (cámara simulada a 3840×2160): inicio 1,7 s (primer arranque);
«Tomar foto» → resultado 5,8 s, con 3 s de cuenta regresiva; «Continuar» → QR 0,3 s con el servicio local.
