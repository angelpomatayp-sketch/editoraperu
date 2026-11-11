# Resultados de las pruebas de punta a punta (2026-11-09)

Generado por `npm run test:e2e` sobre la aplicación compilada, con cámara simulada de Chromium y el servicio PHP local.

**10 de 11 escenarios aprobados.**

| Escenario | Resultado | Requisitos | Duración | Observaciones | Evidencias |
|---|---|---|---|---|---|
| E2E-01 Inicio, pantalla de atracción y estado inicial limpio | Aprobado | RF-KIO-001, RF-ATR-001, CA-001 | 2.5 s | Inicio hasta la pantalla de atracción: 1381 ms (primer arranque, crea la base). | [atraccion](evidencias/2026-11-09/E2E-01-atraccion.png) |
| E2E-02 Recorrido completo con publicación y descarga por QR | Aprobado | Sección 7, CA-005, CA-006, CA-007, RF-QR-001 a RF-QR-006 | 20.1 s | Recorrido de selección, registro y consentimientos (automatizado): 3094 ms. Desde «Tomar foto» hasta el resultado (cuenta regresiva de 3 s incluida): 6578 ms. Desde «Continuar» hasta el QR (publicación incluida): 172 ms. Página de descarga 200, descarga como adjunto, token alterado 404, URL sin datos personales. | [camara](evidencias/2026-11-09/E2E-02-camara.png), [resultado](evidencias/2026-11-09/E2E-02-resultado.png), [qr](evidencias/2026-11-09/E2E-02-qr.png) |
| E2E-03 Validaciones del registro y rechazo de consentimientos | Aprobado | RF-REG-002, RF-REG-003, RF-CON-002, RF-CON-004, CA-004 | 7.6 s | Campos vacíos y DNI incompleto rechazados; casillas sin marcar; botón deshabilitado; al rechazar no se guarda ningún dato personal. | [errores](evidencias/2026-11-09/E2E-03-errores.png), [detalle](evidencias/2026-11-09/E2E-03-detalle.png), [rechazo](evidencias/2026-11-09/E2E-03-rechazo.png) |
| E2E-04 Cancelación voluntaria con confirmación | Aprobado | RF-SES-003, RF-SES-004 | 5.9 s | Con datos ingresados se pide confirmación; al confirmar vuelve a la atracción sin datos visibles. | [confirmacion](evidencias/2026-11-09/E2E-04-confirmacion.png) |
| E2E-05 Inactividad: advertencia y cancelación automática | Aprobado | RF-SES-002, CA-011 | 19.0 s | Advertencia a los 10 s con cuenta regresiva; cancelación y regreso a la atracción a los 15 s (tiempos de prueba). | [advertencia](evidencias/2026-11-09/E2E-05-advertencia.png) |
| E2E-06 Sin Internet: sin QR inválido, foto pendiente y publicación al recuperar | Aprobado | RF-QR-008, RF-QR-009, RF-RED-002, CA-008 | 33.7 s | Sin servicio: mensaje sin QR y foto pendiente. Con el servicio disponible se publicó sola en 14 s. | [sin-qr](evidencias/2026-11-09/E2E-06-sin-qr.png) |
| E2E-07 Cámara no disponible | Aprobado | RF-CAP-001, 12.1, CA-005 | 7.3 s | Mensaje público sin detalles técnicos, opción de reintentar y evento en la bitácora. | [sin-camara](evidencias/2026-11-09/E2E-07-sin-camara.png) |
| E2E-08 Cierre inesperado durante la participación y recuperación | Aprobado | RF-KIO-004, 12.6, CA-001, CA-012 | 21.4 s | Tras matar el proceso con la foto compuesta: vuelve a la atracción, base íntegra, participación cerrada como cancelada y registrada, sin temporales. | [tras-reinicio](evidencias/2026-11-09/E2E-08-tras-reinicio.png) |
| E2E-09 Espacio insuficiente en disco | Aprobado | RF-ALM-002, 12.4 | 4.3 s | No se inicia la participación ni se piden datos; se muestra un mensaje para solicitar asistencia. | [sin-espacio](evidencias/2026-11-09/E2E-09-sin-espacio.png) |
| E2E-10 Panel administrativo: acceso, error de contraseña, secciones y salida | Aprobado | RF-AUT-001, RF-AUT-003, CA-009 | 14.6 s | Cuenta inicial, todas las secciones sin errores de interfaz, cierre de sesión y mensaje genérico ante contraseña incorrecta. | [resumen](evidencias/2026-11-09/E2E-10-resumen.png), [acceso-denegado](evidencias/2026-11-09/E2E-10-acceso-denegado.png) |
| E2E-11 Resistencia: participaciones consecutivas | **Falló** | RNF-004, RF-SES-004, CA-011, CA-012 | 133.3 s | los nodos del DOM crecieron de 526 a 2755 | [final](evidencias/2026-11-09/E2E-11-final.png) |

## Tiempos medidos

```json
{
  "startupMs": 1381,
  "registrationFlowMs": 3094,
  "captureToResultMs": 6578,
  "publishToQrMs": 172,
  "endurance": {
    "rounds": 12,
    "heap": [
      {
        "round": 1,
        "heapMb": 6.3,
        "nodes": 526,
        "listeners": 224
      },
      {
        "round": 4,
        "heapMb": 6.8,
        "nodes": 1019,
        "listeners": 356
      },
      {
        "round": 8,
        "heapMb": 7.6,
        "nodes": 1887,
        "listeners": 552
      },
      {
        "round": 12,
        "heapMb": 8.4,
        "nodes": 2755,
        "listeners": 748
      }
    ]
  }
}
```
