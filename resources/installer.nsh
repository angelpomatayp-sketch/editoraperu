; Pasos propios del instalador del tótem (electron-builder, NSIS). Instalación por usuario: no
; requiere administrador.
;
; Desinstalar deja el equipo limpio para volver a instalar desde cero:
;   - datos de la aplicación: %LOCALAPPDATA%\EditoraPeruTotem (base, fotos, contenido, bitácoras)
;   - caché de la ventana:    %APPDATA%\EditoraPeruTotem
;   - inicio automático con Windows (entrada "EditoraPeruTotem")
;   - datos de versiones anteriores (0.2.0 a 0.2.3) en C:\ProgramData\EditoraPeruTotem, si se puede
; Al ACTUALIZAR (instalar una versión nueva encima) el instalador ejecuta el desinstalador anterior
; con la marca de actualización: en ese caso no se borra nada.

; Las versiones antiguas conservaban la preferencia de no crear acceso en el escritorio.
; Asegurar el acceso al actualizar también, sin duplicarlo si ya existe.
!macro customInstall
  ${ifNot} ${FileExists} "$newDesktopLink"
    CreateShortCut "$newDesktopLink" "$appExe" "" "$appExe" 0 "" "" "${APP_DESCRIPTION}"
    WinShell::SetLnkAUMI "$newDesktopLink" "${APP_ID}"
  ${endIf}
!macroend

!macro customUnInstall
  ${ifNot} ${isUpdated}
    SetShellVarContext current
    RMDir /r "$LOCALAPPDATA\EditoraPeruTotem"
    RMDir /r "$APPDATA\EditoraPeruTotem"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "EditoraPeruTotem"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "EditoraPeruTotem"
    ReadEnvStr $0 PROGRAMDATA
    ${if} $0 != ""
      RMDir /r "$0\EditoraPeruTotem"
    ${endIf}
  ${endIf}
!macroend
