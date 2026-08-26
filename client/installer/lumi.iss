#define MyAppName "Lumi"
#define MyAppVersion "0.1.0"
#define MyAppPublisher "Lumi"
#define MyAppExeName "app.exe"

[Setup]
AppId={{E3B0C442-98FC-4E1B-8C6F-LUMICLIENTE01}}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={autopf}\Lumi
DefaultGroupName=Lumi
DisableWelcomePage=no
DisableProgramGroupPage=yes
WizardStyle=modern
WizardSizePercent=110
OutputDir=..\..\dist\installer
OutputBaseFilename=Lumi-{#MyAppVersion}-setup
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
Filename: "{app}\{#MyAppExeName}"; Description: "Abrir Lumi"; Flags: nowait postinstall skipifsilent

#include "..\..\tools\installer\lumi_panel.iss"

[Code]
procedure InitializeWizard();
var
  pasos: TArrayOfString;
begin
  SetArrayLength(pasos, 4);
  pasos[0] := 'Licencia';
  pasos[1] := 'Ubicacion';
  pasos[2] := 'Opciones';
  pasos[3] := 'Instalar';
  CrearPanelLateral(pasos);
  ActualizarPasoActivo(0);
end;

procedure CurPageChanged(CurPageID: Integer);
begin
  case CurPageID of
    wpLicense: ActualizarPasoActivo(0);
    wpSelectDir: ActualizarPasoActivo(1);
    wpSelectTasks: ActualizarPasoActivo(2);
    wpReady, wpPreparing, wpInstalling, wpFinished: ActualizarPasoActivo(3);
  end;
end;
