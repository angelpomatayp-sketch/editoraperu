# Plan de pruebas integrales (Fase 8)

Cobertura de las pruebas mínimas (sección 17) y de los criterios de aceptación (sección 13) del README.
Cada punto indica **dónde** se comprueba:

- **U/I:** pruebas unitarias y de integración (`npm test`, 187 pruebas, carpeta `tests/unit` y `tests/integration`).
- **E2E:** pruebas de punta a punta sobre la aplicación compilada, con cámara simulada y el servicio PHP local (`npm run test:e2e`, escenarios E2E-01 a E2E-11, resultados en [resultados-e2e.md](resultados-e2e.md)).
- **Tótem:** solo se puede comprobar en el hardware final o en producción; queda en la [lista de verificación del tótem](checklist-totem.md).

## 1. Cómo ejecutar

```powershell
npm run typecheck      # tipos de toda la aplicación
npm test               # unitarias e integración (Electron como Node)
npm run test:e2e       # compila y recorre la aplicación real; requiere PHP de XAMPP
```

`npm run test:e2e` genera `docs/pruebas/resultados-e2e.md` y las capturas en `docs/pruebas/evidencias/<fecha>/`.
Usa una carpeta de datos temporal: no toca `.data/` ni la configuración del equipo.
Requisitos: `npm run models` ejecutado (modelos de recorte) y `C:\xampp\php\php.exe` disponible.

## 2. Pruebas mínimas (sección 17)

| Prueba mínima | U/I | E2E | Tótem |
|---|---|---|---|
| Inicio automático, cierre controlado y modo kiosco | `bootstrap` (arranque, carpetas, base dañada), `migrator` (migraciones y respaldo previo); `inactivity` (acción reservada) | E2E-01 | Inicio con Windows, bloqueo del escritorio, teclas de sistema (T-01 a T-04) |
| Navegación táctil completa e inactividad | `inactivity` | E2E-02, E2E-04, E2E-05 | Toque real en 55", tamaños y alcance (T-05) |
| Reproducción de imágenes y videos | `attract` (orden, vigencia, archivos faltantes) | E2E-01 | Videos reales en 4K/1080p durante horas (T-06) |
| Gestión y validación de campañas y recursos | `admin` (campaña completa, validación de archivos, archivo vs. eliminación), `campaigns`, `compositionPlan` | E2E-10 (secciones) | Carga de los recursos reales de Editora Perú (T-07) |
| Datos válidos, inválidos y duplicados | `participant` (nombres, DNI, teclado), `registration` | E2E-03 | — (duplicidad pendiente de PD-004) |
| Versionado y evidencia de consentimientos | `registration` (versión exacta aceptada) | E2E-03 | Textos legales aprobados (PD-008) |
| Cámara disponible, desconectada y recuperada | — | E2E-02, E2E-07 | Cámara 4K real, desconexión física y reconexión (T-08) |
| Captura, repetición y error de captura | `capture` (repetición con límite, intentos, resolución mínima), `frameEncoder` | E2E-02 | Iluminación y encuadre reales (T-09) |
| Composición de todas las combinaciones aprobadas | `capture`, `compositionPlan`, `chroma`, `segmentation` | E2E-02 | Revisión visual de cada combinación aprobada (T-10) |
| Publicación exitosa, lenta, fallida y reintentada | `publication` (éxito, fallo, agotar reintentos, reutilización, recuperación) | E2E-02, E2E-06 | Servidor cPanel real con red del local (T-11) |
| QR desde Wi-Fi y datos móviles | — | E2E-02 (red local) | Teléfonos Android e iPhone con datos móviles (T-12) |
| Token válido, inválido, alterado y caducado | `publicador` (página, descarga, tokens inválidos, vencimiento y cron) | E2E-02 (token alterado) | HTTPS del dominio final (T-12) |
| Pérdida y recuperación de Internet | `publication` (publicación inmediata al reconectar) | E2E-06 | Cable o Wi-Fi desconectado de verdad (T-13) |
| Poco espacio y disco lleno | `capture` (sin espacio no captura), `session` | E2E-09 | — |
| Reinicio en distintas etapas del flujo | `publication` (cola en curso recuperada), `bootstrap` | E2E-08 | Corte de energía real (T-14) |
| Autenticación, bloqueo, roles y expiración | `admin`, `passwords` (matriz de permisos) | E2E-10 | — |
| Reportes y protección del CSV | `csv` (BOM, fórmulas), `operations` (columnas por rol) | — | Abrir el CSV en el Excel de Editora Perú (T-15) |
| Retención y eliminación según política | `operations` (conservación, solicitud de eliminación), `publicador` (cron) | — | Política aprobada (PD-002) |
| Limpieza de datos visibles entre sesiones | `session` | E2E-04, E2E-05, E2E-11 | — |

## 3. Criterios de aceptación (sección 13)

| Criterio | Cubierto por | Pendiente en el tótem |
|---|---|---|
| CA-001 Inicio y kiosco | E2E-01, E2E-08; `bootstrap` | Inicio automático con Windows y bloqueo del escritorio (T-01 a T-04) |
| CA-002 Contenido | `admin` (contenido de atracción), `attract`; E2E-10 | Videos finales |
| CA-003 Campañas | `admin` (campaña completa, validación previa), `campaigns` | Recursos finales |
| CA-004 Registro y consentimiento | `participant`, `registration`; E2E-03 | Textos legales aprobados |
| CA-005 Cámara | E2E-02, E2E-07 | Cámara 4K real (T-08, T-09) |
| CA-006 Composición | `capture`, `compositionPlan`, `segmentation`; E2E-02 | Resolución aprobada (PD-005) y revisión visual (T-10) |
| CA-007 QR | `publicador`, `publication`; E2E-02 | Datos móviles y HTTPS del dominio (T-12) |
| CA-008 Operación sin Internet | `publication`; E2E-06 | Corte real de red (T-13) |
| CA-009 Administración | `admin`, `passwords`; E2E-10 | — |
| CA-010 Reportes | `csv`, `operations` | Excel del cliente (T-15) |
| CA-011 Privacidad entre sesiones | `session`; E2E-04, E2E-05, E2E-11; `publicador` (caducidad) | — |
| CA-012 Recuperación | `publication`, `migrator`, `bootstrap`; E2E-08 | Corte de energía (T-14) |

## 4. Criterios de salida de la fase

- `npm run typecheck`, `npm test` y `npm run test:e2e` sin fallos.
- Defectos encontrados corregidos y cubiertos con una prueba.
- Todo lo que no puede probarse en este equipo, listado en la [lista de verificación del tótem](checklist-totem.md) para ejecutarlo en la Fase 9.
