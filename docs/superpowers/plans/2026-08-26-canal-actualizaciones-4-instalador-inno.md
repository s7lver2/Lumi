# Canal de actualizaciones — 4. Instalador Inno Setup (cliente + Indexer)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un instalador `.exe` propio (Inno Setup, no el bundler de Tauri) para el cliente Lumi y para el Indexer, con una UI custom: panel izquierdo persistente (marca + fondo de espacio + lista de pasos) y el contenido de cada página a la derecha — la dirección **C** del mockup (`docs/superpowers/specs/2026-08-26-canal-mockup.html`).

**Architecture:** Tauri v2 empaqueta en NSIS/MSI, no en Inno — así que el instalador es un paso de build aparte: `tauri build --no-bundle` produce el `.exe` desnudo y sus DLLs, e Inno Setup (`ISCC.exe`) los empaqueta con un script `.iss` propio por app. El panel lateral persistente se logra añadiendo controles directamente a `WizardForm` (no a una página concreta) desde `InitializeWizard()` en Pascal Script — así se mantienen visibles en todas las páginas sin redibujarlos. La lógica del panel se factoriza en un `.iss` compartido (`tools/installer/lumi_panel.iss`), incluido por los dos scripts (`#include`), para no duplicar el Pascal entre cliente e Indexer.

**Tech Stack:** Inno Setup 6 (Pascal Script), Tauri CLI (`--no-bundle`), Python (`tools/build.py`).

## Global Constraints

- **Solo Windows.** Cliente e Indexer se publican solo para Windows en esta entrega (decisión ya tomada) — el campo `plataforma` del manifiesto (Plan 1) ya deja hueco para Linux el día que haga falta, sin rediseñar nada.
- **Colores traducidos de DESIGN.md a `TColor` de Windows**, que usa orden de bytes `$BBGGRR` (azul-verde-rojo), no `$RRGGBB`. Cada constante de color en el `.iss` lleva un comentario con el hex original de DESIGN.md para poder auditar la conversión.
- Sin verde en ningún estado — "completado" es blanco (`ColorFg`), igual que en el resto del producto.
- **Este entorno de desarrollo no tiene Inno Setup instalado** (comprobado: `ISCC` no está en el `PATH`). El Task 1 lo instala; la compilación real del `.exe` y su verificación visual son, por naturaleza, un paso que solo se puede hacer en una máquina Windows con Inno Setup — si quien ejecuta este plan no tiene esa posibilidad, debe decirlo explícitamente en vez de dar el paso por hecho.
- No tests — no aplica a Pascal Script ni a un instalador; se verifica compilando y ejecutando el `.exe` a mano.

---

### Task 1: Instalar Inno Setup y el panel lateral compartido

**Files:**
- Create: `tools/installer/lumi_panel.iss`

**Interfaces:**
- Produces: `CrearPanelLateral(NombresPasos: TArrayOfString)` y `ActualizarPasoActivo(PasoActivo: Integer)` en Pascal Script. Los usan Task 2 y Task 3 (un `.iss` por app).

- [ ] **Step 1: Instalar Inno Setup 6**

Con `winget` (viene con Windows 11):

```powershell
winget install --id JRSoftware.InnoSetup -e
```

Si `winget` no está disponible en el entorno, descarga el instalador desde `https://jrsoftware.org/isdl.php` e instálalo a mano — es un paso humano, no automatizable desde este plan.

Verifica:

```bash
"/c/Program Files (x86)/Inno Setup 6/ISCC.exe" /?
```

Expected: imprime la ayuda de línea de comandos de `ISCC`.

- [ ] **Step 2: El panel compartido**

Crea `tools/installer/lumi_panel.iss`:

```pascal
; Panel lateral persistente del instalador: marca, fondo de espacio y lista
; de pasos. Compartido por client/installer/lumi.iss e
; indexer/installer/lumi-indexer.iss vía #include — un solo Pascal, no dos
; copias que puedan divergir.
;
; Colores traducidos de DESIGN.md. TColor de Windows usa $BBGGRR (orden de
; bytes invertido respecto al RGB/hex web), de ahí la conversión en cada
; comentario.

[Code]
const
  // #05070a (space) -> BGR
  ColorSpace = $0A0705;
  // #e8e8e6 (fg) -> BGR
  ColorFg = $E6E8E8;
  // #9a9a95 (muted) -> BGR
  ColorMuted = $959A9A;
  // #6a6c70 (subtle) -> BGR
  ColorSubtle = $706C6A;
  // #85b7eb (draw-fg, "en curso") -> BGR
  ColorDrawFg = $EBB785;
  PanelAncho = 180;

var
  PanelLateral: TPanel;
  PasosLabels: array of TNewStaticText;

// Crea el panel y sus controles. Se llama una vez desde InitializeWizard()
// en cada script concreto, con la lista de nombres de página de esa app.
procedure CrearPanelLateral(NombresPasos: TArrayOfString);
var
  i: Integer;
  marca: TNewStaticText;
  version: TNewStaticText;
begin
  PanelLateral := TPanel.Create(WizardForm);
  PanelLateral.Parent := WizardForm;
  PanelLateral.SetBounds(0, 0, PanelAncho, WizardForm.ClientHeight);
  PanelLateral.Color := ColorSpace;
  PanelLateral.BevelOuter := bvNone;
  // Ancla arriba+abajo para que el panel ocupe toda la altura si la
  // ventana cambia de tamaño (Inno permite redimensionar por defecto).
  PanelLateral.Anchors := [akLeft, akTop, akBottom];

  marca := TNewStaticText.Create(WizardForm);
  marca.Parent := PanelLateral;
  marca.Left := 22;
  marca.Top := 24;
  marca.Caption := '* Lumi';
  marca.Font.Color := ColorFg;
  marca.Font.Size := 11;
  marca.AutoSize := True;

  SetArrayLength(PasosLabels, GetArrayLength(NombresPasos));
  for i := 0 to GetArrayLength(NombresPasos) - 1 do
  begin
    PasosLabels[i] := TNewStaticText.Create(WizardForm);
    PasosLabels[i].Parent := PanelLateral;
    PasosLabels[i].Left := 22;
    PasosLabels[i].Top := 88 + i * 26;
    PasosLabels[i].Caption := NombresPasos[i];
    PasosLabels[i].Font.Color := ColorSubtle;
    PasosLabels[i].AutoSize := True;
  end;

  version := TNewStaticText.Create(WizardForm);
  version.Parent := PanelLateral;
  version.Left := 22;
  version.Anchors := [akLeft, akBottom];
  version.Top := WizardForm.ClientHeight - 40;
  version.Caption := '{#SetupSetting("AppVersion")}';
  version.Font.Color := ColorSubtle;
  version.AutoSize := True;

  // Empuja el contenido normal del wizard (las páginas de Inno) a la
  // derecha del panel — sin esto, el panel se dibujaría ENCIMA del wizard
  // en vez de al lado.
  WizardForm.MainPanel.Left := PanelAncho;
  WizardForm.MainPanel.Width := WizardForm.ClientWidth - PanelAncho;
  if Assigned(WizardForm.WizardBitmapImage) then
    WizardForm.WizardBitmapImage.Visible := False;
  if Assigned(WizardForm.WizardSmallBitmapImage) then
    WizardForm.WizardSmallBitmapImage.Visible := False;
end;

// Se llama desde CurPageChanged en cada script concreto: el paso `activo`
// se pinta en ColorDrawFg (estado "en curso" de DESIGN.md), los anteriores
// en ColorMuted, los siguientes en ColorSubtle.
procedure ActualizarPasoActivo(PasoActivo: Integer);
var
  i: Integer;
begin
  for i := 0 to GetArrayLength(PasosLabels) - 1 do
  begin
    if i < PasoActivo then
      PasosLabels[i].Font.Color := ColorMuted
    else if i = PasoActivo then
      PasosLabels[i].Font.Color := ColorDrawFg
    else
      PasosLabels[i].Font.Color := ColorSubtle;
  end;
end;
```

**Nota honesta:** este Pascal se ha escrito contra la API documentada de Inno Setup (`TPanel`, `TNewStaticText`, `WizardForm.MainPanel`, `WizardForm.WizardBitmapImage`) pero **no se ha podido compilar en este entorno** porque Inno Setup no estaba instalado hasta este mismo paso. La primera compilación real (Task 2, Step 3) es también la primera prueba de que este Pascal es válido — si `ISCC` señala un error de sintaxis o un identificador que no existe en la versión instalada, corrígelo ahí antes de seguir; no asumas que este código es correcto solo por estar escrito.

- [ ] **Step 3: Commit**

```bash
git add tools/installer/lumi_panel.iss
git commit -m "feat: panel lateral compartido del instalador Inno"
```

---

### Task 2: Instalador del cliente

**Files:**
- Create: `client/installer/lumi.iss`
- Modify: `tools/build.py`

**Interfaces:**
- Consumes: `tools/installer/lumi_panel.iss` (Task 1); el binario de `client/src-tauri/target/release/` producido por `tauri build --no-bundle`.
- Produces: `dist/installer/Lumi-<version>-setup.exe`.

- [ ] **Step 1: Construir el binario sin empaquetar**

```bash
cd client && npm run tauri build -- --no-bundle
```

Expected: termina sin error y deja `client/src-tauri/target/release/app.exe` (el nombre del binario es `app.exe`: `[lib] name = "app_lib"` en `client/src-tauri/Cargo.toml`, pero el binario ejecutable real es el que genera `[package] name = "app"` — confírmalo con `ls client/src-tauri/target/release/*.exe` antes de continuar, y ajusta el nombre en el Step 2 si difiere).

- [ ] **Step 2: El script de Inno**

Crea `client/installer/lumi.iss`:

```pascal
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
```

**Sin fichero de licencia todavía:** este script no incluye `LicenseFile=` porque el proyecto no tiene hoy un texto de licencia de usuario final separado de `LICENSE` (AGPL-3.0, pensada para el código fuente, no para un diálogo de aceptación de instalador). Si `LICENSE` no es el texto adecuado para mostrar aquí, ese es un contenido que falta escribir — no lo inventes al ejecutar este paso; dilo y sigue sin esa página (`wpLicense` desaparece sola del asistente si `LicenseFile` no está declarado, así que `CurPageChanged` simplemente no la alcanza).

- [ ] **Step 3: Compilar**

```bash
"/c/Program Files (x86)/Inno Setup 6/ISCC.exe" client/installer/lumi.iss
```

Expected: termina con `Successful compile` y deja `dist/installer/Lumi-0.1.0-setup.exe`. Si Pascal Script señala un error de sintaxis en `lumi_panel.iss` o en este script, corrígelo aquí — es la primera compilación real de ese código (ver la nota honesta del Task 1).

- [ ] **Step 4: Ejecutarlo y comprobar visualmente**

```bash
"dist/installer/Lumi-0.1.0-setup.exe"
```

Expected, comprobado a ojo (no hay forma de automatizar esto sin un framework de UI testing de Windows, fuera de alcance):
- El panel izquierdo (fondo oscuro, marca "Lumi", lista de 4 pasos) se mantiene visible y en el mismo sitio en cada página del asistente.
- El paso correspondiente a la página actual se ve resaltado (más claro) frente a los demás (atenuados).
- El instalador copia el `.exe` y termina sin error en una carpeta de prueba (cancela antes de que se instale de verdad si no quieres dejarlo instalado, o desinstálalo después desde "Aplicaciones" de Windows).

- [ ] **Step 5: Añadir el paso a `tools/build.py`**

Edita `tools/build.py`. Añade una rama nueva al `if`/`elif` de `target` (junto a `"build"`):

```python
    if target == "installer":
        run(["npm", "run", "tauri", "build", "--", "--no-bundle"], cwd=ROOT / "client")
        iscc = r"C:\Program Files (x86)\Inno Setup 6\ISCC.exe"
        run([iscc, str(ROOT / "client" / "installer" / "lumi.iss")])
        return
```

Actualiza también el docstring del módulo, junto a las demás líneas de uso:

```python
"""Dev: arranca lumid y el cliente Tauri, o el Indexer por separado.

  python tools/build.py            lumid en el puerto fijo + cliente
  python tools/build.py indexer    solo el Indexer (no necesita daemon)
  python tools/build.py build      empaqueta los dos (bundler de Tauri)
  python tools/build.py installer  instalador Inno del cliente (Windows)
"""
```

- [ ] **Step 6: Commit**

```bash
git add client/installer/lumi.iss tools/build.py
git commit -m "feat: instalador Inno del cliente"
```

---

### Task 3: Instalador del Indexer

**Files:**
- Create: `indexer/installer/lumi-indexer.iss`
- Modify: `tools/build.py`

**Interfaces:**
- Consumes: `tools/installer/lumi_panel.iss` (Task 1); el binario de `indexer/src-tauri/target/release/`.
- Produces: `dist/installer/Lumi-Indexer-<version>-setup.exe`.

- [ ] **Step 1: Construir el binario sin empaquetar**

```bash
cd indexer && npm run tauri build -- --no-bundle
```

Expected: deja el ejecutable en `indexer/src-tauri/target/release/`. Confirma el nombre real con `ls indexer/src-tauri/target/release/*.exe` (el `[package] name` de `indexer/src-tauri/Cargo.toml` — revisado antes de este plan como `indexer-app`, pero el nombre del `.exe` generado puede no coincidir uno a uno; ajusta el Step 2 al nombre real).

- [ ] **Step 2: El script de Inno**

Crea `indexer/installer/lumi-indexer.iss` — mismo patrón que `client/installer/lumi.iss` del Task 2, con los cinco cambios propios de esta app:

```pascal
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
```

Nota: el Indexer solo tiene 3 pasos (sin "Licencia") porque no hay hoy un texto de licencia de usuario final distinto para él tampoco — misma nota que el Task 2 Step 2, no inventar contenido al ejecutar este paso.

- [ ] **Step 3: Compilar**

```bash
"/c/Program Files (x86)/Inno Setup 6/ISCC.exe" indexer/installer/lumi-indexer.iss
```

Expected: `Successful compile`, `dist/installer/Lumi-Indexer-0.1.0-setup.exe`.

- [ ] **Step 4: Ejecutarlo y comprobar visualmente**

Mismo criterio que el Task 2 Step 4, con 3 pasos en vez de 4.

- [ ] **Step 5: Extender `tools/build.py`**

Edita la rama `"installer"` añadida en el Task 2 Step 5 para construir los dos:

```python
    if target == "installer":
        iscc = r"C:\Program Files (x86)\Inno Setup 6\ISCC.exe"
        run(["npm", "run", "tauri", "build", "--", "--no-bundle"], cwd=ROOT / "client")
        run([iscc, str(ROOT / "client" / "installer" / "lumi.iss")])
        run(["npm", "run", "tauri", "build", "--", "--no-bundle"], cwd=ROOT / "indexer")
        run([iscc, str(ROOT / "indexer" / "installer" / "lumi-indexer.iss")])
        return
```

- [ ] **Step 6: Probar el flujo completo desde cero**

```bash
python tools/build.py installer
```

Expected: los dos `.exe` aparecen en `dist/installer/`.

- [ ] **Step 7: `.gitignore`**

`dist/installer/` son artefactos de build, no código. Confirma que `dist/` ya está en `.gitignore` (raíz del repo, ya presente: `dist/` en la línea correspondiente) — si por lo que sea no cubre esta ruta nueva, añádelo:

```bash
grep -n "^dist" .gitignore || echo "dist/" >> .gitignore
```

- [ ] **Step 8: Commit**

```bash
git add indexer/installer/lumi-indexer.iss tools/build.py .gitignore
git commit -m "feat: instalador Inno del Indexer, tools/build.py installer"
```

---

## Self-Review

**Cobertura de la spec:** Windows-only (Global Constraints), UI custom sin el wizard gris de serie (`WizardBitmapImage.Visible := False` + panel propio), dirección C del mockup — panel izquierdo fijo con marca+pasos, cuerpo cambiante a la derecha (Task 1 + Task 2/3), paso de build propio porque Tauri no empaqueta con Inno (`--no-bundle` + `ISCC`, Task 2/3, wired en `tools/build.py`). Cubierto.

**Placeholders:** ninguno oculto — las dos notas explícitas (Pascal sin compilar hasta el Task 2 Step 3; sin fichero de licencia todavía) son avisos concretos con una instrucción clara de qué hacer, no vaguedad de tipo "TBD".

**Consistencia de tipos:** `CrearPanelLateral`/`ActualizarPasoActivo` se llaman con la misma firma en Task 2 y Task 3 (Task 1 las define). Los nombres de paso (`pasos[]`) son un array de cadenas en Pascal en los tres tasks, sin ningún tipo estructurado adicional que pudiera divergir.

**Riesgo declarado, no escondido:** este plan es el único de los cuatro cuyo código no se pudo verificar contra un compilador real durante su redacción (Inno Setup no estaba instalado). Cada task deja explícito en qué paso ocurre la primera compilación real y qué hacer si falla — no se presenta como "hecho" hasta que ese paso se ejecute de verdad.

---

**Plan complete and saved to `docs/superpowers/plans/2026-08-26-canal-actualizaciones-4-instalador-inno.md`. Two execution options:**

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
