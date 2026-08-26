!define APP_NAME "Lumi Indexer"
!define APP_VERSION "0.1.0"
!define APP_EXE "indexer-app.exe"

!include "nsDialogs.nsh"
!include "LogicLib.nsh"
!include "WinMessages.nsh"

Name "${APP_NAME}"
OutFile "..\..\dist\installer\Lumi-Indexer-${APP_VERSION}-setup.exe"
InstallDir "$LOCALAPPDATA\Programs\Lumi Indexer"
RequestExecutionLevel user
ShowInstDetails hide
BrandingText " "
Icon "..\src-tauri\icons\icon.ico"

Var Dialog
Var DirText
Var DesktopCheck
Var DesktopIconWanted
Var ProgressBar
Var StatusLabel
Var OpenCheck
Var DoneShown

!include "..\..\tools\installer\lumi_panel.nsh"

Page custom PgBienvenidaCreate
Page custom PgUbicacionCreate PgUbicacionLeave
Page custom PgOpcionesCreate PgOpcionesLeave
Page custom PgInstalarCreate

Section "Instalar"
SectionEnd

Function .onInit
  StrCpy $PanelMarca "Lumi Indexer"
  StrCpy $PanelVersion "${APP_VERSION}"
  StrCpy $DesktopIconWanted 1
  StrCpy $DoneShown 0
FunctionEnd

Function .onGUIInit
  Call CrearFuenteTitulo
FunctionEnd

Function PgBienvenidaCreate

  nsDialogs::Create 1018
  Pop $Dialog
  Call DecorarPagina

  ${NSD_CreateLabel} 0 60u 100% 16u "Instalar Lumi Indexer"
  Pop $0
  SetCtlColors $0 ${COLOR_FG} ${COLOR_BG}
  SendMessage $0 ${WM_SETFONT} $FuenteTitulo 1
  ${NSD_AddStyle} $0 0x0001

  ${NSD_CreateLabel} 40u 82u 220u 34u "Construye el corpus de imagenes georreferenciadas que usara el motor de inferencia de Lumi."
  Pop $0
  SetCtlColors $0 ${COLOR_MUTED} ${COLOR_BG}
  ${NSD_AddStyle} $0 0x0001

  nsDialogs::Show
FunctionEnd

Function PgUbicacionCreate

  nsDialogs::Create 1018
  Pop $Dialog
  Call DecorarPagina

  ${CrearTitulo} 20u 60u 260u 16u "Carpeta de destino"

  ${NSD_CreateLabel} 20u 82u 260u 12u "Donde se instalan los archivos del programa."
  Pop $0
  SetCtlColors $0 ${COLOR_MUTED} ${COLOR_BG}

  ${NSD_CreateText} 20u 100u 220u 13u "$InstDir"
  Pop $DirText
  SetCtlColors $DirText ${COLOR_FG} ${COLOR_PANEL}

  ${NSD_CreateButton} 244u 99u 40u 14u "..."
  Pop $0
  SetCtlColors $0 ${COLOR_FG} ${COLOR_ELEV}
  ${NSD_OnClick} $0 PgUbicacionBrowse

  nsDialogs::Show
FunctionEnd

Function PgUbicacionBrowse
  nsDialogs::SelectFolderDialog "Selecciona la carpeta de destino" "$InstDir"
  Pop $0
  ${If} $0 != error
    StrCpy $InstDir $0
    ${NSD_SetText} $DirText "$InstDir"
  ${EndIf}
FunctionEnd

Function PgUbicacionLeave
  ${NSD_GetText} $DirText $InstDir
FunctionEnd

Function PgOpcionesCreate

  nsDialogs::Create 1018
  Pop $Dialog
  Call DecorarPagina

  ${CrearTitulo} 20u 60u 260u 16u "Opciones"

  ${NSD_CreateLabel} 20u 82u 260u 12u "Puedes cambiar esto despues desde ajustes."
  Pop $0
  SetCtlColors $0 ${COLOR_MUTED} ${COLOR_BG}

  ${NSD_CreateCheckbox} 20u 102u 260u 12u "Crear acceso directo en el escritorio"
  Pop $DesktopCheck
  SetCtlColors $DesktopCheck ${COLOR_FG} ${COLOR_BG}
  ${If} $DesktopIconWanted == 1
    ${NSD_Check} $DesktopCheck
  ${EndIf}

  nsDialogs::Show
FunctionEnd

Function PgOpcionesLeave
  ${NSD_GetState} $DesktopCheck $DesktopIconWanted
FunctionEnd

Function PgInstalarCreate

  nsDialogs::Create 1018
  Pop $Dialog
  Call DecorarPagina

  ${NSD_CreateLabel} 20u 60u 260u 16u "Instalando"
  Pop $StatusLabel
  SetCtlColors $StatusLabel ${COLOR_FG} ${COLOR_BG}
  SendMessage $StatusLabel ${WM_SETFONT} $FuenteTitulo 1

  ${NSD_CreateLabel} 20u 82u 260u 12u "Esto tarda unos segundos."
  Pop $0
  SetCtlColors $0 ${COLOR_MUTED} ${COLOR_BG}

  ; ponytail: PBM_SETBARCOLOR no tiene efecto en la barra con tema visual
  ; activo en Windows 10/11 (se probo tambien PBS_SMOOTH + SetWindowTheme
  ; para apagarlo solo en este control, sin cambio) — igual que el fondo
  ; del notebook de Inno, el chrome de esta barra lo pinta el sistema en
  ; una capa que no se puede recolorear sin owner-draw (WM_DRAWITEM). Se
  ; deja el naranja/tema nativo: es un control, no toda la pagina, y solo
  ; se ve un segundo durante la copia real.
  ${NSD_CreateProgressBar} 20u 102u 260u 10u ""
  Pop $ProgressBar

  ${NSD_CreateCheckbox} 20u 124u 260u 12u "Abrir Lumi Indexer al finalizar"
  Pop $OpenCheck
  SetCtlColors $OpenCheck ${COLOR_FG} ${COLOR_BG}
  ${NSD_Check} $OpenCheck
  ShowWindow $OpenCheck ${SW_HIDE}

  ${If} $DoneShown == 1
    ; Se revisita la pagina (el usuario fue a "Atras" y volvio) — los
    ; archivos ya estan copiados, solo se refleja el estado final.
    SendMessage $ProgressBar ${PBM_SETPOS} 100 0
    ${NSD_SetText} $StatusLabel "Instalacion completa"
    ShowWindow $OpenCheck ${SW_SHOW}
    GetDlgItem $0 $HWNDPARENT 1
    SendMessage $0 ${WM_SETTEXT} 0 "STR:Finalizar"
  ${Else}
    GetDlgItem $0 $HWNDPARENT 1
    EnableWindow $0 0
    Call HacerInstalacion
  ${EndIf}

  nsDialogs::Show
FunctionEnd

Function HacerInstalacion
  SetOutPath "$InstDir"
  SendMessage $ProgressBar ${PBM_SETPOS} 20 0
  File "..\src-tauri\target\release\${APP_EXE}"
  SendMessage $ProgressBar ${PBM_SETPOS} 60 0
  File /nonfatal "..\src-tauri\target\release\*.dll"
  SendMessage $ProgressBar ${PBM_SETPOS} 80 0

  CreateDirectory "$SMPROGRAMS\Lumi Indexer"
  CreateShortCut "$SMPROGRAMS\Lumi Indexer\Lumi Indexer.lnk" "$InstDir\${APP_EXE}"
  ${If} $DesktopIconWanted == 1
    CreateShortCut "$DESKTOP\Lumi Indexer.lnk" "$InstDir\${APP_EXE}"
  ${EndIf}
  WriteUninstaller "$InstDir\uninstall.exe"
  SendMessage $ProgressBar ${PBM_SETPOS} 100 0

  StrCpy $DoneShown 1
  ${NSD_SetText} $StatusLabel "Instalacion completa"
  ShowWindow $OpenCheck ${SW_SHOW}

  GetDlgItem $0 $HWNDPARENT 1
  EnableWindow $0 1
  SendMessage $0 ${WM_SETTEXT} 0 "STR:Finalizar"
FunctionEnd

Function un.onInit
FunctionEnd

Section "Uninstall"
  Delete "$InstDir\${APP_EXE}"
  Delete "$InstDir\*.dll"
  Delete "$InstDir\uninstall.exe"
  RMDir "$InstDir"
  Delete "$SMPROGRAMS\Lumi Indexer\Lumi Indexer.lnk"
  RMDir "$SMPROGRAMS\Lumi Indexer"
  Delete "$DESKTOP\Lumi Indexer.lnk"
SectionEnd
