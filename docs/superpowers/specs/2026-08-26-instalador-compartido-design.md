# Instalador compartido — diseño

## Contexto

La sección 5 de [2026-08-26-canal-de-actualizaciones-design.md](2026-08-26-canal-de-actualizaciones-design.md)
planeaba un instalador Inno Setup por app. Se implementó, y luego se reescribió en NSIS
(`nsDialogs`) buscando control total del fondo — ambos comparten el mismo techo: son wizards
de controles nativos de Windows (notebook de Inno, botones/checkboxes de NSIS), y ese chrome
no se puede recolorear sin owner-draw. El mockup aprobado
([2026-08-26-canal-mockup.html](2026-08-26-canal-mockup.html), dirección "pane a pantalla
completa") solo se puede reproducir pixel a pixel renderizando HTML/CSS de verdad.

Esta spec reemplaza la sección 5 entera por un instalador propio en Tauri (WebView2, mismo
stack que `client/` e `indexer/`) y además cierra un punto que esa spec había dejado fuera de
alcance a propósito — *"actualización automática sin intervención"* — porque el dueño del
proyecto lo pide explícitamente ahora para cliente e Indexer (no para `lumid`, que sigue
gestionado por su owner desde el panel de administración, sin cambios de esta spec).

## Alcance

- Un instalador único, compartido entre Lumi (cliente) y Lumi Indexer, con selección de
  productos.
- Modo interactivo (primera instalación) con la UI exacta del mockup aprobado.
- Modo silencioso (actualización), sin ventana, autodisparado por el propio cliente/Indexer al
  detectar versión nueva.
- Reusa el manifiesto firmado y `lumi-proto::actualizacion` ya construidos — instalar y
  actualizar son el mismo código de descarga/verificación, solo cambia si hay ventana.
- Reporte de errores: log en disco + aviso en la app la próxima vez que abre.

Fuera de alcance (con motivo):

- **`lumid`**: sigue como en la spec del canal — el owner lo actualiza a mano desde el panel.
  No es un instalador Windows, no aplica nada de esto.
- **Auto-actualización del propio instalador** (`installer.exe`): si `lumi-installer` necesita
  un fix, se resuelve republicando el producto — la siguiente
  instalación completa trae el instalador nuevo. No hay canal de update recursivo para el
  propio updater; añadir uno es visible el día que un bug del instalador bloquee
  actualizaciones reales, no antes.
- **Firma Authenticode del `.exe`**: igual que en la spec del canal, es un problema de
  confianza del SO distinto del canal firmado con Ed25519.
- **Linux**: los tres binarios (instalador, cliente, Indexer) son Windows-only hoy, como ya
  decidía la spec del canal.

---

## 1. Estructura

```
crates/lumi-installer/          logica pura, sin UI — nueva crate del workspace
  src/
    manifiesto.rs                 pide/verifica el Manifiesto via lumi-proto::actualizacion
    proceso.rs                    ¿sigue vivo el PID objetivo? esperar-con-tope
    aplicar.rs                    descarga + sha256 → copia → accesos directos → registro
    marca.rs                      lee/escribe la entrada de "ya instalado" (registro de Windows)
    error.rs                      tipo de error compartido + log en disco

installer/                       app Tauri v2 — un solo binario para los dos modos
  src-tauri/
    src/main.rs   mira --silencioso antes de arrancar Tauri: si esta, resuelve la
                  actualizacion sin ventana y sale; si no, abre la UI interactiva normal
    src/silencioso.rs   el camino sin ventana — parsea --producto=cliente|indexer --pid=<n>
                  --version-actual=<x.y.z> --silencioso, sin depender de nada de Tauri/WebView2
    src/comandos.rs     los comandos de la UI interactiva (detectar_instalados, instalar)
  src/          reusa client/src/ui (mismo patron que ya comparten client e indexer)
```

Un solo `.exe` para los dos caminos — no dos binarios separados como se planteó al principio:
más simple de distribuir y de mantener sincronizado, al coste de que la actualización
silenciosa carga (aunque no muestra) el runtime de WebView2 antes de decidir que no hace falta
ventana; con el ahorro de red/CPU real de una actualización (descargar+copiar unos MB) ese coste
es insignificante en la práctica.

`installer.exe` se instala junto a **cualquier** producto elegido, en la carpeta raíz
compartida — el cliente/Indexer no descargan nada para autoactualizarse, ya tienen
`installer.exe` local, solo lo relanzan con `--silencioso`.

`crates/lumi-installer` entra al workspace (`Cargo.toml` raíz); `installer/src-tauri` es un
proyecto Cargo aparte excluido del workspace, igual que `client/src-tauri` e
`indexer/src-tauri` ya lo están.

## 2. Flujo A — primera instalación (interactiva)

1. El investigador descarga `installer.exe` de la web — una sola entrada, sin variantes por
   producto.
2. UI del mockup: Bienvenida → **Productos** (Lumi / Lumi Indexer, cada casilla marcada "Ya
   instalado" si `marca::detectar()` encuentra su entrada de registro; desmarcada por defecto
   en ese caso, pero se puede volver a marcar para reinstalar) → Ubicación (una raíz, por
   defecto `%LocalAppData%\Programs\Lumi`, cada producto en su subcarpeta — `\Cliente` y
   `\Indexer`) → Instalando.
3. "Instalando" pide el manifiesto firmado, resuelve la publicación más nueva de cada producto
   elegido para `windows-x86_64` con `Manifiesto::mas_nueva()`, descarga, verifica `sha256`,
   copia, escribe accesos directos + entrada de registro (`DisplayVersion`, `InstallLocation`).
4. Sin proceso que comprobar aquí — instalación nueva, nada corriendo todavía.

## 3. Flujo B — actualización silenciosa (autodisparada)

1. Cliente/Indexer, en su `comprobar_actualizacion()` ya existente (arranque + botón manual),
   ve una versión más nueva de **sí mismo**.
2. En vez de solo mostrar la cinta: cierra su propia ventana/proceso limpiamente, y lanza
   `installer.exe --producto=cliente --pid=<su-propio-pid> --version-actual=<x.y.z>
   --silencioso` (ya vive en su misma carpeta de instalación) — el mismo binario que la
   instalación interactiva, pero `--silencioso` hace que nunca llegue a arrancar Tauri ni abrir
   ventana.
3. El proceso espera hasta 10s a que ese PID desaparezca de verdad — red de seguridad, no el
   camino principal (el proceso ya se cerró solo en el paso 2). Si sigue vivo pasado el margen,
   aborta sin tocar ningún archivo y registra el error; no fuerza el cierre.
4. Descarga, verifica `sha256`, sustituye los archivos, sale. Sin ventana en ningún momento.
5. Si falla cualquier paso (red, hash, proceso vivo, sin permisos de escritura): se escribe en
   `%LocalAppData%\Lumi\instalador.log` **y** se deja una marca de error que el producto lee al
   arrancar la siguiente vez, mostrando un aviso claro ("No se pudo actualizar a la versión X —
   motivo") reusando el componente de la cinta que ya existe (`ActualizacionBanner.tsx`).
6. Si todo va bien, relanza la nueva versión del producto al terminar.

## 4. Detección de "ya instalado"

Entrada estándar de Windows en
`HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\<AppId>` (mismo patrón que cualquier
instalador de Windows: `DisplayName`, `DisplayVersion`, `InstallLocation`,
`UninstallString`). La usa tanto el instalador interactivo (pintar "Ya instalado") como el
propio producto en runtime (saber dónde vive `installer.exe` junto a él — mismo
`InstallLocation`).

## 5. Errores — resumen

| Situación | Instalación interactiva | Actualización silenciosa |
|---|---|---|
| Sin red | Pantalla de error explícita, botón reintentar | Aborta, log + aviso en la app al abrir |
| Firma del manifiesto inválida | Manifiesto descartado, error explícito | Igual, log + aviso |
| `sha256` no cuadra | Aborta antes de copiar, error explícito | Igual, log + aviso, archivos viejos intactos |
| Proceso objetivo no cierra en 10s | — (no aplica, instalación nueva) | Aborta sin tocar archivos, log + aviso |
| Sin permisos de escritura en destino | Error explícito, sugiere otra carpeta | Log + aviso, versión vieja sigue funcionando |

En todos los casos de actualización silenciosa: la versión anterior sigue intacta y
funcionando hasta que la sustitución del paso 4 se completa entera — no hay estado a medias.

## 6. Qué reemplaza

Esta spec deja sin efecto la sección 5 de la spec del canal de actualizaciones y el trabajo de
esta sesión en NSIS. Al implementar, se retiran: `client/installer/lumi.iss`,
`indexer/installer/lumi-indexer.iss`, `tools/installer/lumi_panel.iss`,
`indexer/installer/lumi-indexer.nsi`, `tools/installer/lumi_panel.nsh`, y el target
`installer` de `tools/build.py` se reescribe para compilar `installer/` (un solo binario) en
vez de invocar ISCC/makensis.
