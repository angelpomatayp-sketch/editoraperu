# Despliegue del servicio de descarga por QR en cPanel

Subdominio: **https://editora.wowtechperu.com** · cuenta cPanel: `wowtechp`

El servicio recibe las fotos del tótem y entrega a cada participante su página de descarga. No
guarda nombres ni DNI: solo la foto, un identificador técnico y fechas. Los enlaces vencen a las
72 horas (provisional, PD-002).

## Estructura en el servidor

```
/home/wowtechp/editora.wowtechperu.com/
├── app/          código y configuración (config.php con la clave)   ← NO público
├── cron/         limpieza de fotos vencidas                        ← NO público
├── database/     esquema de la base                                ← NO público
├── storage/      fotos y base SQLite (las crea el servicio)        ← NO público
└── public/       ÚNICA carpeta accesible desde internet (raíz del subdominio)
```

## 1. Crear el subdominio

cPanel → **Domains → Create A New Domain**

- Domain: `editora.wowtechperu.com`
- **Share document root: sin marcar**
- **Document Root: `editora.wowtechperu.com/public`** ← agregar `/public` al final
- Enviar.

## 2. PHP

1. **MultiPHP Manager**: marcar `editora.wowtechperu.com` → versión **PHP 8.1 o superior** (probado con 8.2).
2. **Select PHP Version → Extensions** (si su cPanel lo muestra): verificar que estén activas
   **pdo_sqlite** (o **sqlite3**) y **fileinfo**. En la mayoría de servidores ya lo están.

## 3. Certificado HTTPS

**SSL/TLS Status** → marcar `editora.wowtechperu.com` → **Run AutoSSL**. Esperar a que aparezca
con candado verde (puede tardar unos minutos). Sin HTTPS los teléfonos muestran advertencias.

## 4. Subir el servicio

En la laptop se genera con `npm run publicador:paquete` →
`dist\publicador\publicador-instalacion.zip`.

1. **File Manager** → entrar a `/home/wowtechp/editora.wowtechperu.com/`.
2. **Upload** → subir `publicador-instalacion.zip`.
3. Clic derecho en el .zip → **Extract** → en `/home/wowtechp/editora.wowtechperu.com/`.
4. Comprobar que quedaron `app/ cron/ database/ public/ storage/` al mismo nivel. Borrar el .zip.
5. Permisos (normalmente ya vienen así): carpetas **755**, archivos **644**.

> El .zip contiene `app/config.php` con la **clave del tótem**: no compartirlo ni dejarlo en
> carpetas públicas.

## 5. Limpieza automática (cron)

**Cron Jobs** → Common Settings: **Once Per Hour** → Command:

```
php /home/wowtechp/editora.wowtechperu.com/cron/expire.php > /dev/null 2>&1
```

Si su servidor usa varias versiones de PHP, use la ruta de la versión elegida, por ejemplo
`/opt/cpanel/ea-php82/root/usr/bin/php`.

## 6. Comprobar

1. En el navegador: **https://editora.wowtechperu.com/api/v1/health** → debe mostrar
   `{"status":"ok", ...}`.
2. En la laptop: `npm run publicador:verificar`. Sube una imagen de prueba firmada como el tótem,
   revisa página, descarga, enlace alterado, que no se vea la configuración, y la borra al final.
   Todo debe salir con ✔.

### Si algo falla

| Síntoma | Causa probable | Solución |
|---|---|---|
| `/api/v1/health` muestra 404 o la página por defecto del hosting | La raíz del subdominio no es `.../public` | Domains → editar la raíz del subdominio |
| `/api/v1/health` responde `service_unavailable` (503) | Falta `pdo_sqlite` o `storage/` sin permiso de escritura | Activar la extensión; permisos 755 en `storage/` |
| La carga firmada da **403** | ModSecurity del hosting bloquea la imagen o las cabeceras `X-Totem-*` | ModSecurity → desactivar para el subdominio, o pedir al proveedor una excepción para `/api/v1/photos` |
| La carga firmada da **401** | El campo `reason` lo indica: `clock_skew` = reloj del tótem desfasado más de 5 min; `mismatch` = clave distinta o contenido alterado (`body_bytes: 0` = el hosting no entregó la foto); `missing_headers` = el hosting quitó las cabeceras `X-Totem-*` | Sincronizar la hora de Windows; revisar la clave; el tótem ya envía la foto como formulario, que todos los hostings aceptan |
| Advertencia de sitio no seguro | AutoSSL aún no emitió el certificado | Esperar y volver a ejecutar AutoSSL |

## 7. Actualizar (cuando cambie la página de descarga)

En la laptop: `npm run publicador:paquete --actualizacion` → `publicador-actualizacion.zip`.
Subirlo y extraerlo en la misma carpeta, aceptando reemplazar archivos. **No incluye**
`app/config.php` ni `storage/`: la clave y las fotos se conservan.

## 8. Conectar el tótem

Desde la versión 0.2.3 **el instalador ya trae la URL y la clave**: no hay que configurar nada.
Solo para usar otro servicio, en el panel del tótem → **Sistema → Publicación por QR**:
- URL: `https://editora.wowtechperu.com`
- Clave: la de `.data\config\publicador-produccion.json` en la laptop (campo `secret`).
- **Probar conexión**.

Con eso, al terminar cada participación aparece el QR y la foto se descarga desde cualquier
teléfono, con datos móviles o Wi-Fi.
