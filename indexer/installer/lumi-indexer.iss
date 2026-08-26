#define MyAppName "Lumi Indexer"
#define MyAppVersion "0.1.0"
#define MyAppPublisher "Lumi"
#define MyAppExeName "indexer-app.exe"

[Setup]
AppId={{F4C1D553-99FD-4F2C-9D7A-LUMIINDEXER01}}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={autopf}\Lumi Indexer
DefaultGroupName=Lumi Indexer
DisableWelcomePage=no
DisableProgramGroupPage=yes
WizardStyle=modern
WizardSizePercent=110
OutputDir=..\..\dist\installer
OutputBaseFilename=Lumi-Indexer-{#MyAppVersion}-setup
Compression=lzma
SolidCompression=yes
SetupIconFile=..\src-tauri\icons\icon.ico
UninstallDisplayIcon={app}\{#MyAppExeName}
PrivilegesRequired=lowest

[Languages]
Name: "spanish"; MessagesFile: "compiler:Languages\Spanish.isl"

[Files]
Source: "..\src-tauri\target\release\{#MyAppExeName}"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\src-tauri\target\release\*.dll"; DestDir: "{app}"; Flags: ignoreversion skipifsourcedoesntexist

[Tasks]
Name: "desktopicon"; Description: "Crear un acceso directo en el escritorio"; GroupDescription: "Accesos directos:"

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{commondesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "Abrir Lumi Indexer"; Flags: nowait postinstall skipifsilent

#include "..\..\tools\installer\lumi_panel.iss"

[Code]
procedure InitializeWizard();
var
  pasos: TArrayOfString;
begin
  SetArrayLength(pasos, 3);
  pasos[0] := 'Ubicacion';
  pasos[1] := 'Opciones';
  pasos[2] := 'Instalar';
  CrearPanelLateral(pasos);
  ActualizarPasoActivo(0);
end;

procedure CurPageChanged(CurPageID: Integer);
begin
  case CurPageID of
    wpSelectDir: ActualizarPasoActivo(0);
    wpSelectTasks: ActualizarPasoActivo(1);
    wpReady, wpPreparing, wpInstalling, wpFinished: ActualizarPasoActivo(2);
  end;
end;
