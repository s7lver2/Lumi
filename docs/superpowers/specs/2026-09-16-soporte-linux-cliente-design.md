# Soporte Linux (Pop!_OS) para el cliente — diseño

## Contexto

`lumid` ya es multiplataforma (Rust puro, sin dependencia de Windows). El cliente
(`client/`, Tauri v2) es hoy Windows-only por decisión explícita, no por limitación técnica:
[2026-08-26-canal-de-actualizaciones-design.md](2026-08-26-canal-de-actualizaciones-design.md)
y [2026-08-26-instalador-compartido-design.md](2026-08-26-instalador-compartido-design.md)
dejan constancia de que el manifiesto de versiones ya reserva el campo `plataforma` para
`"linux-x86_64"` a propósito, "añadirlo después es publicar un artefacto más, no rediseñar
nada".

Investigación previa a este documento confirma que el cliente es casi enteramente agnóstico
al sistema operativo: la conexión con `lumid` es TLS/HTTP puro (`rustls`/`reqwest`, sin IPC
propio de Windows), el manejo de rutas y de modificadores de teclado (`ctrlKey`/`metaKey`) ya
contempla no-Windows, y el registro del scheme `lumi://` en `client/src-tauri/src/main.rs`
(~línea 1037) ya rama por plataforma. El único bloqueo real es la auto-actualización: el
string de plataforma va fijo a `"windows-x86_64"` (`main.rs:405,412`) y el disparo silencioso
invoca `installer.exe` (`main.rs:494-533`), un instalador compartido con ventana propia
(Tauri/WebView2) documentado como Windows-only.

`crates/lumi-installer` (la lógica de ese instalador) ya separa lo agnóstico de lo específico:
`manifiesto.rs`, `sha256.rs`, `bitacora.rs` y `proceso.rs` no tienen ningún `cfg(windows)`;
solo `marca.rs` (la entrada de "ya instalado" en el registro de Windows) está detrás de
`#[cfg(windows)]`. Esto importa para el diseño: la mitad del trabajo de "instalar una
actualización" ya es reutilizable tal cual.

## Alcance

- Empaquetar el cliente para Linux en dos formatos: **AppImage** (con auto-actualización real)
  y **`.deb`** (instalación/actualización manual).
- Auto-actualización del AppImage con paridad real con Windows: silenciosa, sin pedir
  contraseña de administrador, sin ventana de instalador propia.
- Integración de escritorio del AppImage (entrada en el menú de aplicaciones de Pop!_OS) al
  primer arranque.
- Extender el manifiesto de versiones (sin rediseñarlo) y el flujo de release para publicar
  el artefacto `linux-x86_64` del cliente junto al de Windows.

Fuera de alcance (con su motivo):

- **`.deb` con auto-actualización**: un `.deb` instala en `/usr`, propiedad de root — la app
  no puede reescribirse ahí sin `pkexec`/`sudo`, y pedir contraseña en cada actualización no
  es la paridad "silenciosa" que se busca. El `.deb` es para quien prefiera instalar vía
  gestor de paquetes y actualizar a mano descargando el `.deb` nuevo — igual que cualquier
  `.deb` fuera de un repositorio APT propio (montar un repo APT queda fuera de esta entrega).
- **Portar el instalador compartido (Tauri/WebView2) a Linux**: el AppImage no necesita una
  ventana de instalador propia — el propio cliente descarga, verifica y se reemplaza en
  caliente, como ya hace `lumid` (que tampoco tiene interfaz). Añadir un `installer` con
  webkit2gtk sería mantener dos caminos para resolver lo mismo.
- **`lumid` e Indexer**: sin cambios — `lumid` ya es multiplataforma y se actualiza desde el
  panel de administración; el Indexer sigue Windows-only, no lo pide nadie todavía.
- **Repositorio APT propio / Flatpak / Snap**: un solo formato de auto-actualización
  (AppImage) es suficiente para la paridad pedida; los demás son puertas de distribución, no
  de actualización, y se añaden el día que alguien los pida.
- **Reubicación automática si el usuario mueve el AppImage tras integrarlo**: el `.desktop`
  seguiría apuntando a la ruta vieja — mismo límite que cualquier AppImage autointegrado así,
  documentado aquí como conocido, no resuelto en esta entrega.

---

## 1. Empaquetado

`client/src-tauri/tauri.conf.json` ya tiene `bundle.targets: "all"` — compilando en Linux
(WSL sirve: es Linux real), el bundler de Tauri v2 emite `.AppImage` y `.deb` sin cambios de
configuración. Lo que falta es documentación, no código: un fichero nuevo
(`client/src-tauri/README-linux.md` o una sección en el `README.md` raíz) con los paquetes de
sistema que pide Tauri v2 en Ubuntu/Pop!_OS (`libwebkit2gtk-4.1-dev`, `libgtk-3-dev`,
`librsvg2-dev`, `patchelf`, `build-essential`, entre otros de la lista oficial de Tauri), para
que compilar en WSL no dependa de recordarlos de memoria.

`tools/build.py`/`tools/package.py` no necesitan cambios: ya son Python/`subprocess` puro sin
ramas de Windows más allá del `shutil.which("npm")` que ya funciona igual en Linux.

## 2. El artefacto `linux-x86_64` en el manifiesto y el release

`crates/lumi-proto::actualizacion::Artefacto` ya es `{ plataforma: String, url, bytes,
sha256 }` — sin cambios de esquema. El flujo de release (`release_flow.py`, y el mapa
`PLATAFORMA` que hoy fija `"cliente": "windows-x86_64"`) gana una segunda entrada para el
cliente:

```python
PLATAFORMA = {
    "cliente": {"windows-x86_64": ..., "linux-x86_64": ...},
    "lumid": {"linux-x86_64": ...},  # ya existía
    ...
}
```

Publicar una versión del cliente sube dos artefactos (el `.exe`/instalador de Windows y el
`.AppImage` de Linux) bajo la misma `Publicacion`, firmados con la misma clave Ed25519 de
siempre — el `.deb` NO se publica en el manifiesto (no se autoactualiza, no hay nada que
comprobar contra él); se sube como artefacto de descarga directa en la página de instalación,
fuera del canal de actualizaciones.

## 3. Detección de plataforma en el cliente

`comprobar_actualizacion()` (`main.rs:395`) deja de fijar `"windows-x86_64"` a mano y usa
`cfg(target_os)` real:

```rust
const PLATAFORMA: &str = if cfg!(target_os = "windows") { "windows-x86_64" }
                          else if cfg!(target_os = "linux") { "linux-x86_64" }
                          else { "desconocida" };
```

`"desconocida"` nunca calza contra ningún `Artefacto.plataforma` del manifiesto —
`mas_nueva()`/`version_exacta()` devuelven `None` y el cliente simplemente no ve
actualizaciones, en vez de fallar. Mismo criterio que ya usa el manifiesto para una
plataforma sin artefacto publicado (`mas_nueva_ignora_plataforma_sin_artefacto`, ya
probado).

## 4. Auto-actualización silenciosa en Linux — sin instalador separado

Reemplaza, solo en Linux, el camino de `disparar_actualizacion_silenciosa()` que hoy busca
`installer.exe`. Nuevo módulo `client/src-tauri/src/autoactualizar_linux.rs`, compilado solo
con `#[cfg(target_os = "linux")]`. El manifiesto ya llega verificado desde
`manifiesto_verificado()` (`main.rs:378`, comparte código con el chequeo de Windows, no hay
nada que reverificar aparte); lo que sí se reutiliza tal cual del instalador compartido es
`lumi_installer::sha256` (verificación de integridad del artefacto descargado, ya agnóstica al
SO) y `lumi_installer::bitacora` (el mismo log de "la última actualización silenciosa falló
con este motivo", ya agnóstico) — solo se escribe la parte que hoy no existe para Linux:
aplicar la actualización sobre un AppImage.

Pasos, todos dentro del propio proceso del cliente (sin lanzar nada, sin ventana):

1. `std::env::var("APPIMAGE")` — la variable que el runtime de AppImage deja puesta con la
   ruta del propio fichero en ejecución. Si no está seteada (el cliente no se está
   ejecutando como AppImage — p. ej. un build de desarrollo, o el `.deb`), la actualización
   silenciosa no se ofrece: se cae al aviso de "hay una versión nueva, descárgala" que ya
   existe como red de seguridad (mismo texto que ve hoy quien no tiene `installer.exe`).
2. Descarga el nuevo `.AppImage` a un fichero temporal en el mismo directorio que el actual
   (mismo filesystem: un `rename()` entre directorios distintos puede no ser atómico).
3. Verifica su `sha256` contra el del `Artefacto` del manifiesto (`lumi_installer::sha256`).
4. Le da permiso de ejecución (`fs::set_permissions`, bit `0o755`).
5. Reemplaza el AppImage en ejecución por el nuevo: `rename()` del temporal sobre la ruta de
   `$APPIMAGE` — en Linux, reemplazar un fichero mientras un proceso lo tiene abierto no lo
   rompe (el proceso viejo sigue viendo el inode antiguo hasta que termina); es el mismo
   principio que ya usa `lumid` para reemplazarse en caliente.
6. Relanza: `std::process::Command::new(&ruta_appimage).spawn()`, luego el proceso actual
   sale limpio. A diferencia de Windows (donde `lumi_installer::proceso` espera a que el PID
   viejo termine porque un `.exe` en uso no se puede sobrescribir), en Linux el `rename()` del
   paso 5 ya funcionó aunque el proceso actual siga con el AppImage viejo abierto -- no hace
   falta esperar a nada antes de relanzar, solo después de haber relanzado, cerrar el proceso
   actual.

Si cualquier paso falla (descarga cortada, sha256 no coincide, sin permiso de escritura en el
directorio del AppImage), se escribe el motivo con `lumi_installer::bitacora` — la misma
"marca de error" que hoy lee `error_actualizacion_pendiente()` para avisar una vez al volver a
abrir — y el cliente sigue corriendo con la versión actual, nunca a medio actualizar.

## 5. Integración de escritorio (solo AppImage)

Al arrancar, si `$APPIMAGE` está seteada y `~/.local/share/applications/lumi.desktop` no
existe todavía, el cliente se registra solo (mismo momento que hoy comprueba
`autoarranque_leer`, ver `main.rs:461`):

- Escribe `~/.local/share/applications/lumi.desktop` (`Exec=<ruta actual de $APPIMAGE>`,
  `Icon=lumi`, `Type=Application`, `Categories=Utility;`).
- Copia el icono ya empaquetado (el mismo PNG de 128×128 que usa el bundle de Tauri) a
  `~/.local/share/icons/hicolor/128x128/apps/lumi.png`.

Estándar XDG puro (`xdg-desktop-menu`/las convenciones de `~/.local/share/applications`), sin
depender de que el usuario tenga AppImageLauncher instalado. Si el usuario mueve el AppImage
después, el `.desktop` apunta a la ruta vieja hasta el próximo reemplazo en caliente (que
reescribe el AppImage en el MISMO sitio, así que en el camino normal de auto-actualización
esto ni se nota) — ver el límite documentado en "Fuera de alcance".

## 6. Manejo de errores

- Firma del manifiesto inválida, plataforma sin artefacto, o red caída al comprobar: igual
  que hoy en Windows — no hay actualización que ofrecer, sin aviso alarmante.
- Fallo durante la aplicación (pasos 2-6 de la sección 4): log vía `bitacora`, cliente sigue
  en la versión actual, aviso una sola vez al reabrir.
- `$APPIMAGE` no seteada (no es un AppImage: `.deb`, o build de desarrollo): sin
  auto-actualización, aviso pasivo de "hay una versión nueva" con enlace a la descarga —
  mismo texto que ya existe para cuando falta `installer.exe`.

## Qué no cambia

- `lumid` no se toca — ya es multiplataforma, con su propio artefacto `linux-x86_64` que ya
  existía.
- El instalador compartido Windows/WebView2 (`installer/`) sigue exactamente igual, solo para
  Windows.
- El esquema del manifiesto (`Manifiesto`/`Publicacion`/`Artefacto`) no cambia ni un campo.
- El Indexer sigue Windows-only, sin cambios de esta entrega.
