# Bibliotecas de Visual C++ incluidas (x64)

ONNX Runtime (recorte de la persona con IA) necesita el entorno de ejecución de Visual C++
2015–2022. En un Windows recién instalado no existe y, sin él, la aplicación se cerraba al arrancar.
Instalar el «Visual C++ Redistributable» exige administrador, así que estas DLL se incluyen junto a
ONNX Runtime («instalación local», permitida por la licencia de redistribución de Microsoft).

| Archivo | Versión |
|---|---|
| msvcp140.dll | 14.51.36247.0 |
| msvcp140_1.dll | 14.51.36247.0 |
| msvcp140_atomic_wait.dll | 14.51.36247.0 |
| vcruntime140.dll | 14.51.36247.0 |
| vcruntime140_1.dll | 14.51.36247.0 |

Las copia `scripts/after-pack.cjs` al generar el instalador (`npm run dist`). Se obtuvieron del
Visual C++ Redistributable x64 instalado en el equipo de desarrollo (`C:\Windows\System32`).
