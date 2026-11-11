# Informe de la Fase 8: pruebas integrales (local)

**Fecha:** 2026-10-06 · **Entorno:** equipo de desarrollo, Windows 11, cámara simulada de Chromium a 3840×2160, servicio de publicación PHP local (XAMPP). Sin instalador: la aplicación se probó compilada con `electron-vite build`.

## Resultado

| Conjunto | Resultado |
|---|---|
| Tipos (`npm run typecheck`) | Sin errores |
| Unitarias e integración (`npm test`) | 187 de 187 aprobadas (22 archivos) |
| Punta a punta (`npm run test:e2e`) | 11 de 11 escenarios aprobados; ver [resultados-e2e.md](resultados-e2e.md) y las capturas en `evidencias/2026-10-06/` |

La cobertura de la sección 17 y de los criterios CA-001 a CA-012 está en el [plan de pruebas](plan-de-pruebas.md).

## Defectos encontrados y corregidos

| # | Defecto | Cómo se detectó | Corrección | Prueba que lo cubre |
|---|---|---|---|---|
| 1 | Al volver Internet, las fotos pendientes esperaban el intervalo de reintento (hasta minutos) antes de publicarse | E2E-06 | Al recuperar la conexión se procesa toda la cola de inmediato | `publication`: «al recuperar la conexión se publica de inmediato» |
| 2 | Una participación interrumpida por un cierre inesperado quedaba como «registrada» para siempre | E2E-08 | Al arrancar se cierran como canceladas y se registra el evento `interrupted` en la bitácora | E2E-08 |
| 3 | La primera foto con recorte automático esperaba la carga del modelo | Medición de tiempos | El modelo MODNet se carga en segundo plano al iniciar | — (mejora menor) |
| 4 | La vista previa con recorte automático iba a 5 cuadros por segundo y la cuenta regresiva de 3 s duraba más de 4,4 s | Medición de tiempos | El modelo de la vista previa recibe el cuadro reducido a 512 px en lugar del 4K completo (el modelo trabaja a 256 px, sin pérdida de calidad) | Medición: 33 cuadros por segundo; temporizador de 1 s en 1,07 s |
| 5 | Comprimir la foto 4K en la interfaz tardaba unos 2,4 s | Medición de tiempos | La interfaz envía el cuadro sin comprimir y el proceso principal lo guarda como JPEG con sharp (0,1 s) | `frameEncoder` |

## Tiempos medidos

| Tramo | Antes | Después |
|---|---|---|
| Inicio hasta la atracción (primer arranque) | 1,1–1,7 s | 1,7 s |
| Selección, registro y consentimientos (automatizado) | 3,4 s | 3,4 s |
| «Tomar foto» → resultado (incluye 3 s de cuenta regresiva) | 7,8 s | 5,8 s |
| «Continuar» → QR (servicio local) | 0,3 s | 0,3 s |

Dentro de los 2,8 s que siguen a la cuenta regresiva: lectura del cuadro 0,15 s, envío y compresión 0,4 s, guardado y recorte con MODNet más composición 1,4 s, y el resto en pantalla y base de datos.

**Resistencia:** 12 participaciones completas seguidas sin errores ni archivos temporales; memoria de la interfaz de 6,1 a 6,9 MB, nodos y escuchas estables.

## Lo que queda para el tótem

Inicio con Windows, modo kiosco, cámara y pantalla reales, QR por datos móviles con HTTPS, cortes reales de red y energía, Excel del cliente y 16 h de operación continua. Todo está en la [lista de verificación del tótem](checklist-totem.md) y se ejecuta en la Fase 9.

## Decisiones que siguen pendientes

PD-001 (servidor del QR), PD-002 (retención), PD-003 (repeticiones), PD-005 (orientación y resolución final; hoy vertical 1080×1920), PD-009 (roles), PD-011 (respaldo), PD-016 (fondo verde) y PD-017 (aprobación del recorte automático con IA).
