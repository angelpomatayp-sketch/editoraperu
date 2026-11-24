# Entrega 0.2.45

## Tótem

Cerrar desde el panel y ejecutar el nuevo instalador encima, sin desinstalar. Se conservan
campañas, usuarios, fotos vigentes y el modelo. Hacer un respaldo previo: la actualización
activa conservación local de 7 días y anonimización de nombres/DNI a los 30 días. Los archivos
fotográficos tienen un aviso técnico de al menos 24 horas antes del borrado; no se borran en
silencio durante el primer arranque. La anonimización de registros antiguos sí aplica al iniciar.
No copiar el proyecto, modelos de desarrollo ni credenciales al escritorio del tótem.

## Servidor (no se actualiza con el instalador de Windows)

Subir el ZIP de actualización de `dist/publicador/` al hosting existente y extraerlo en la raíz
del servicio, no en `public/`. Ese paquete NO incluye `app/config.php` ni `storage/`.
Conservar la clave, base de datos y fotos existentes. Verificar `ttl_hours = 72` en la configuración
del servidor, sin compartir su clave. Mantener el cron cada hora:

```text
php /home/<usuario>/editora.wowtechperu.com/cron/expire.php
```

El código nuevo añade una limpieza de respaldo con tráfico: una vez por hora, con bloqueo y
lotes de hasta 200 fotos vencidas. No sustituye al cron cuando no hay tráfico. No confirma que
el cron del hosting ya esté configurado: comprobarlo en cPanel y revisar su salida/permisos.
El vencimiento impide descargar; borrar físicamente requiere que la limpieza se ejecute.
Los respaldos del hosting y registros técnicos tienen conservación independiente.

## Consentimientos y alcance pendiente

Se reemplazan los avisos genéricos por textos específicos del servicio, con nueva versión/hash.
Nunca se modifica el texto ya aceptado. Se retiran las versiones anteriores administradas por
el código; un texto institucional personalizado activo se respeta. Cambiar la conservación
desde el panel genera una nueva versión del aviso; los registros anteriores mantienen su evidencia.

Base de referencia institucional consultada el 12/11/2026:
https://www.editoraperu.com.pe/PrivacidadEP/Politica_Proteccion_Datos_Personales.pdf
https://andina.pe/agencia/legal/andina-politicas.html

No se declara aprobación legal ni cumplimiento completo: Editora Perú debe validar el banco de
datos aplicable, proveedor/país de alojamiento, necesidad del DNI, plazos de evidencia/respaldos
y procedimiento de consentimiento de menores/representantes. El DNI solo se valida según el
formato actual: no se consulta RENIEC ni se verifica edad o representación.
Aceptar cualquier DNI con formato válido NO resuelve esas obligaciones. El aviso exige
asistencia del personal en esos casos; no hay verificación automática incorporada.

No se autoriza publicidad o difusión en redes sociales. Esos usos quedan fuera de esta aceptación.

## Prueba de aceptación en el equipo real

1. Reiniciar y comprobar inicio y cámara.
2. Con Internet: tomar foto, escanear QR y descargar desde datos móviles.
3. Sin Internet: tomar foto y comprobar aviso de archivo guardado.
4. Recuperar conexión, entrar a Participaciones y reintentar: debe mostrarse QR automáticamente.
5. Ocultar y volver a mostrar QR: no debe subir otra copia. Un enlace vencido no se ofrece.
6. Revisar Resumen y Sistema/Mantenimiento antes de vencer las fotos pendientes.

No se cambiaron modelo, calidad de captura, resolución ni recorte 4K en esta versión.
