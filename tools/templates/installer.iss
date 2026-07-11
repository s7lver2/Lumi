; tools/templates/installer.iss
; Placeholders __LUMI_VERSION__, __LUMI_STAGING_DIR__, __LUMI_OUTPUT_DIR__
; are substituted by tools/build.py (plain str.replace) before this is
; written to a temp .iss and compiled with ISCC.exe.

#define MyAppName "Lumi"
#define MyAppVersion "__LUMI_VERSION__"
#define MyAppExeName "lumi.exe"

[Setup]
AppId={{B4B6E4C1-8D9E-4A2E-9C1C-6D9F0F6A1234}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
DefaultDirName={autopf}\Lumi
DefaultGroupName=Lumi
DisableProgramGroupPage=yes
OutputDir=__LUMI_OUTPUT_DIR__
OutputBaseFilename=LumiSetup-{#MyAppVersion}
Compression=lzma2
SolidCompression=yes
ArchitecturesInstallIn64BitMode=x64compatible
UninstallDisplayIcon={app}\{#MyAppExeName}
AppPublisher=Lumi
WizardStyle=modern

[Languages]
Name: "spanish"; MessagesFile: "compiler:Languages\Spanish.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[Messages]
FinishedLabel=Lumi se ha instalado. Al iniciarlo por primera vez se abrirá tu navegador en http://localhost:3000%n%nLa primera vez te llevará automáticamente al asistente de instalación (/setup), que instala los modelos y termina comprobando que el servicio de inferencia y el worker están realmente arrancados.

[Files]
Source: "__LUMI_STAGING_DIR__\*"; DestDir: "{app}"; Flags: recursesubdirs ignoreversion

[Icons]
Name: "{group}\Lumi"; Filename: "{app}\{#MyAppExeName}"
Name: "{autodesktop}\Lumi"; Filename: "{app}\{#MyAppExeName}"

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "Ejecutar Lumi ahora"; Flags: postinstall nowait skipifsilent unchecked

[Code]
var
  DockerFound: Boolean;

function IsToolOnPath(const ToolName, VersionArgs: String): Boolean;
var
  ResultCode: Integer;
begin
  Result := Exec('cmd.exe', '/c ' + ToolName + ' ' + VersionArgs + ' >nul 2>nul', '',
    SW_HIDE, ewWaitUntilTerminated, ResultCode) and (ResultCode = 0);
end;

function InitializeSetup(): Boolean;
var
  NodeFound, PnpmFound, WslFound: Boolean;
  Message: String;
begin
  NodeFound := IsToolOnPath('node', '--version');
  PnpmFound := IsToolOnPath('pnpm', '--version');
  DockerFound := IsToolOnPath('docker', '--version');
  WslFound := IsToolOnPath('wsl', '--status');

  Result := True;

  if (not NodeFound) or (not PnpmFound) then
  begin
    MsgBox('Este instalador necesita Node.js y pnpm en el PATH antes de continuar.' + #13#10 +
           'Instálalos y vuelve a ejecutar este instalador.', mbError, MB_OK);
    Result := False;
    Exit;
  end;

  if not DockerFound then
  begin
    Message := 'No se encontró Docker Desktop, la forma más sencilla de tener Postgres ' +
      '+ pgvector + PostGIS (la base de datos de Lumi).' + #13#10#13#10 +
      'Puedes cancelar e instalar Docker Desktop primero, o continuar si ya tienes ' +
      'un Postgres con esas extensiones configurado manualmente (editarás .env después).' + #13#10#13#10 +
      '¿Continuar sin Docker?';
    if MsgBox(Message, mbConfirmation, MB_YESNO) = IDNO then
    begin
      Result := False;
      Exit;
    end;
  end;

  if WslFound then
    MsgBox('WSL2 detectado — podrás activarlo como entorno de inferencia (más rápido) ' +
           'desde el asistente /setup después de instalar.', mbInformation, MB_OK);
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  ResultCode: Integer;
  EnvExample, EnvFile: String;
begin
  if CurStep = ssPostInstall then
  begin
    EnvExample := ExpandConstant('{app}\.env.example');
    EnvFile := ExpandConstant('{app}\.env');
    if (not FileExists(EnvFile)) and FileExists(EnvExample) then
      FileCopy(EnvExample, EnvFile, False);

    if DockerFound then
      Exec('cmd.exe', '/c docker compose up -d --build db', ExpandConstant('{app}'),
        SW_SHOW, ewWaitUntilTerminated, ResultCode);

    // apps/web and apps/worker ship pre-built (tools/build.py's next build
    // --standalone + esbuild bundle) — only db/'s own small migration-runner
    // dependency set (node-pg-migrate, pg, cross-env) still needs installing.
    Exec('cmd.exe', '/c pnpm install --filter @netryx/db...', ExpandConstant('{app}'),
      SW_SHOW, ewWaitUntilTerminated, ResultCode);
  end;
end;
