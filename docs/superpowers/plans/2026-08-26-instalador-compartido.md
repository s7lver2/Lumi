# Instalador compartido — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un instalador Tauri compartido para Lumi (cliente) y Lumi Indexer, con selección de
productos, que reemplaza los intentos de Inno Setup y NSIS de esta sesión, y añade
actualización silenciosa autodisparada por la propia app.

**Architecture:** `crates/lumi-installer` (lógica pura y compartida: manifiesto, verificación
sha256, espera de proceso, marca de "ya instalado", log de errores) + `instalador-cli/` (bin
sin UI, para la actualización silenciosa) + `installer/` (app Tauri con la UI del mockup
aprobado, para la primera instalación). El cliente y el Indexer ganan una llamada nueva que
lanza `instalador-cli.exe` y se cierran, en vez de solo mostrar un enlace de descarga.

**Tech Stack:** Rust (workspace existente), Tauri v2, HTML/CSS/JS estático (sin build de
React — instalador de un solo uso, mismo criterio de "lo más ligero posible" ya aplicado en
esta sesión), `reqwest::blocking`, `sysinfo`, `winreg`, `mslnk`.

## Global Constraints

- Spec de referencia: [docs/superpowers/specs/2026-08-26-instalador-compartido-design.md](../specs/2026-08-26-instalador-compartido-design.md).
  Toda decisión de este plan viene de ahí; si algo no cuadra, la spec manda.
- Mockup aprobado (dirección visual "pane a pantalla completa"), ya en el repo:
  [docs/superpowers/specs/2026-08-26-instalador-pane-mockup.html](../specs/2026-08-26-instalador-pane-mockup.html).
  Ábrelo en un navegador antes del Task 8 — es la referencia exacta de color/tipografía/layout.
- DESIGN.md es la fuente de los tokens de color (ya usados en el mockup: `bg #0e0f11`,
  `space #05070a`, `panel #1a1b1e`, `elevated #202226`, `fg #e8e8e6`, `muted #9a9a95`,
  `subtle #6a6c70`, `draw-fg #85b7eb`). Español para nombres de función, variables y comentarios
  en todo el código nuevo, siguiendo el resto del repo.
- **No tests unless explicitly requested** — excepción ya en marcha en el repo: lógica no
  trivial (aquí: sha256, espera de proceso, marca de registro, log de error) sí lleva test,
  igual que `cargo test -p lumi-proto`. No añadas tests para código mecánico (IO de red, copia
  de archivos, comandos de Tauri).
- Un commit por tarea terminada, no commits intermedios.
- Windows-only — todo este código (`sysinfo`, `winreg`, `mslnk`, rutas `%LocalAppData%`) no
  necesita compilar en otras plataformas; no añadas `#[cfg]` de portabilidad que nadie pidió.
- `crates/lumi-installer` entra al workspace (`Cargo.toml` raíz, `members`). `installer/src-tauri`
  e `instalador-cli` son proyectos Cargo aparte, excluidos del workspace — mismo patrón que
  `client/src-tauri` e `indexer/src-tauri` ya usan (ver comentario en `Cargo.toml` raíz).

---

### Task 1: `lumi-installer` — scaffold, errores, sha256

**Files:**
- Create: `crates/lumi-installer/Cargo.toml`
- Create: `crates/lumi-installer/src/lib.rs`
- Create: `crates/lumi-installer/src/error.rs`
- Create: `crates/lumi-installer/src/sha256.rs`
- Modify: `Cargo.toml:3` (raíz — añadir `"crates/lumi-installer"` a `members`)

**Interfaces:**
- Produces: `lumi_installer::error::InstaladorError` (enum, `Display`, `std::error::Error`),
  `lumi_installer::sha256::{sha256_hex, verificar_sha256}`.

- [ ] **Step 1: Crear el directorio y el `Cargo.toml`**

```bash
mkdir -p "E:/Lumi Station/crates/lumi-installer/src"
```

Escribe `crates/lumi-installer/Cargo.toml`:

```toml
[package]
name = "lumi-installer"
version.workspace = true
edition.workspace = true
license.workspace = true

[dependencies]
lumi-proto = { workspace = true }
sha2 = { workspace = true }
serde = { workspace = true }
serde_json = { workspace = true }
reqwest = { version = "0.12", default-features = false, features = ["blocking", "json", "rustls-tls"] }
```

- [ ] **Step 2: Añadir sysinfo y winreg con `cargo add` (para que resuelvan la versión real más reciente, no una adivinada)**

```bash
cd "E:/Lumi Station/crates/lumi-installer" && cargo add sysinfo && cargo add winreg
```
Expected: ambos se añaden a `[dependencies]` de `crates/lumi-installer/Cargo.toml` con la
última versión estable.

- [ ] **Step 3: Añadir la crate al workspace**

En `E:/Lumi Station/Cargo.toml:3`, cambia:
```toml
members = ["crates/lumi-proto", "crates/lumi-index", "crates/lumid", "crates/lumi-cli"]
```
por:
```toml
members = ["crates/lumi-proto", "crates/lumi-index", "crates/lumid", "crates/lumi-cli", "crates/lumi-installer"]
```

- [ ] **Step 4: Escribir `error.rs`**

```rust
//! Error único para todo `lumi-installer` — lo consumen tanto
//! `instalador-cli` (para decidir el mensaje de log) como los comandos de
//! Tauri de `installer/` (para mostrarlo en la UI).

use std::fmt;

#[derive(Debug)]
pub enum InstaladorError {
    Red(String),
    HashNoCoincide,
    Disco(String),
    Manifiesto(String),
    SinPublicacionNueva,
    SinArtefactoParaPlataforma,
    ProcesoNoCerro,
}

impl fmt::Display for InstaladorError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            InstaladorError::Red(m) => write!(f, "error de red: {m}"),
            InstaladorError::HashNoCoincide => {
                write!(f, "el sha256 descargado no coincide con el del manifiesto")
            }
            InstaladorError::Disco(m) => write!(f, "error de disco: {m}"),
            InstaladorError::Manifiesto(m) => write!(f, "manifiesto inválido: {m}"),
            InstaladorError::SinPublicacionNueva => {
                write!(f, "no hay versión nueva que instalar")
            }
            InstaladorError::SinArtefactoParaPlataforma => {
                write!(f, "el manifiesto no trae artefacto para esta plataforma")
            }
            InstaladorError::ProcesoNoCerro => write!(f, "el proceso objetivo no cerró a tiempo"),
        }
    }
}

impl std::error::Error for InstaladorError {}
```

- [ ] **Step 5: Escribir `sha256.rs` con sus tests**

```rust
//! Verificación de integridad de artefactos descargados — la única pieza
//! de este crate que es lógica pura de verdad, así que es la que lleva
//! tests (ver Global Constraints).

use sha2::{Digest, Sha256};

pub fn sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    format!("{:x}", hasher.finalize())
}

/// Compara sin importar mayúsculas/minúsculas — el manifiesto puede traer
/// el hash en cualquiera de las dos.
pub fn verificar_sha256(bytes: &[u8], esperado: &str) -> bool {
    sha256_hex(bytes).eq_ignore_ascii_case(esperado)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sha256_hex_de_cadena_vacia_es_el_valor_conocido() {
        assert_eq!(
            sha256_hex(b""),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b85"
        );
    }

    #[test]
    fn verificar_sha256_acepta_mayusculas_o_minusculas() {
        let hash = sha256_hex(b"hola");
        assert!(verificar_sha256(b"hola", &hash));
        assert!(verificar_sha256(b"hola", &hash.to_uppercase()));
    }

    #[test]
    fn verificar_sha256_rechaza_hash_distinto() {
        assert!(!verificar_sha256(b"hola", "0000000000000000000000000000000000000000000000000000000000000000"));
    }
}
```

- [ ] **Step 6: Escribir `lib.rs`**

```rust
//! Lógica compartida del instalador de Lumi/Lumi Indexer: la usan tanto
//! `instalador-cli` (actualización silenciosa) como `installer/src-tauri`
//! (primera instalación interactiva). Ver
//! docs/superpowers/specs/2026-08-26-instalador-compartido-design.md.

pub mod error;
pub mod sha256;

pub use error::InstaladorError;
```

- [ ] **Step 7: Compilar y correr los tests**

```bash
cd "E:/Lumi Station" && cargo test -p lumi-installer
```
Expected: `4 passed` (los tests de `sha256.rs`).

- [ ] **Step 8: Commit**

```bash
cd "E:/Lumi Station" && git add Cargo.toml crates/lumi-installer && git commit -m "feat: crear crate lumi-installer con verificacion sha256"
```

---

### Task 2: `proceso.rs` — esperar a que el proceso objetivo cierre

**Files:**
- Create: `crates/lumi-installer/src/proceso.rs`
- Modify: `crates/lumi-installer/src/lib.rs` (añadir `pub mod proceso;`)

**Interfaces:**
- Consumes: nada de tareas anteriores.
- Produces: `lumi_installer::proceso::esperar_cierre(pid: u32, timeout: std::time::Duration) -> bool`.

- [ ] **Step 1: Escribir `proceso.rs` con sus tests**

```rust
//! Red de seguridad antes de sustituir los archivos de un producto: el
//! camino principal es que la propia app se cierre sola antes de lanzar
//! `instalador-cli` (ver spec, Flujo B paso 2) — esto es lo que confirma
//! que de verdad ocurrió, con un margen, antes de tocar ningún archivo.

use std::time::{Duration, Instant};
use sysinfo::{Pid, ProcessesToUpdate, System};

/// Sondea cada 250ms hasta que el proceso `pid` deja de existir, o hasta
/// que pasa `timeout`. `true` = ya no existe (se cerró solo, o nunca
/// existió con ese PID). `false` = seguía vivo cuando se agotó el margen.
pub fn esperar_cierre(pid: u32, timeout: Duration) -> bool {
    let inicio = Instant::now();
    let mut sistema = System::new();
    loop {
        sistema.refresh_processes(ProcessesToUpdate::Some(&[Pid::from_u32(pid)]), true);
        if sistema.process(Pid::from_u32(pid)).is_none() {
            return true;
        }
        if inicio.elapsed() >= timeout {
            return false;
        }
        std::thread::sleep(Duration::from_millis(250));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pid_que_no_existe_devuelve_true_de_inmediato() {
        let inicio = Instant::now();
        assert!(esperar_cierre(999_999, Duration::from_secs(3)));
        // Si de verdad esperó los 3s completos, algo está mal detectando
        // que el PID no existe.
        assert!(inicio.elapsed() < Duration::from_secs(1));
    }

    #[test]
    fn proceso_que_muere_durante_la_espera_se_detecta_antes_del_margen() {
        let mut hijo = std::process::Command::new("cmd")
            .args(["/C", "timeout /T 5"])
            .spawn()
            .expect("no se pudo lanzar el proceso de prueba");
        let pid = hijo.id();
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(300));
            let _ = hijo.kill();
        });
        let inicio = Instant::now();
        assert!(esperar_cierre(pid, Duration::from_secs(4)));
        assert!(inicio.elapsed() < Duration::from_secs(4));
    }

    #[test]
    fn proceso_que_no_muere_agota_el_margen_y_devuelve_false() {
        let mut hijo = std::process::Command::new("cmd")
            .args(["/C", "timeout /T 5"])
            .spawn()
            .expect("no se pudo lanzar el proceso de prueba");
        let pid = hijo.id();
        assert!(!esperar_cierre(pid, Duration::from_millis(500)));
        let _ = hijo.kill();
    }
}
```

- [ ] **Step 2: Registrar el módulo en `lib.rs`**

Añade a `crates/lumi-installer/src/lib.rs`:
```rust
pub mod proceso;
```

- [ ] **Step 3: Compilar y correr los tests**

```bash
cd "E:/Lumi Station" && cargo test -p lumi-installer
```
Expected: `7 passed` (4 de `sha256` + 3 de `proceso`). El test
`proceso_que_no_muere_agota_el_margen_y_devuelve_false` tarda ~0.5s de verdad — es esperado,
no un cuelgue.

- [ ] **Step 4: Commit**

```bash
cd "E:/Lumi Station" && git add crates/lumi-installer && git commit -m "feat: esperar cierre de proceso con margen en lumi-installer"
```

---

### Task 3: `marca.rs` — detectar "ya instalado" en el registro

**Files:**
- Create: `crates/lumi-installer/src/marca.rs`
- Modify: `crates/lumi-installer/src/lib.rs` (añadir `pub mod marca;`)

**Interfaces:**
- Produces: `lumi_installer::marca::Marca { version: String, ruta: PathBuf }`,
  `lumi_installer::marca::escribir(producto: &str, nombre: &str, version: &str, ruta: &Path) -> std::io::Result<()>`,
  `lumi_installer::marca::leer(producto: &str) -> Option<Marca>`.
  `producto` es siempre `"cliente"` o `"indexer"` (mismos strings en minúscula que usa
  `Producto` en `lumi_proto::actualizacion`, pero como `&str` aquí — este módulo no depende de
  ese enum a propósito, es puro registro de Windows).

- [ ] **Step 1: Escribir `marca.rs` con sus tests**

```rust
//! Detección de "ya instalado" vía el registro de Windows — mismo lugar
//! que cualquier instalador de Windows usa
//! (`HKCU\...\Uninstall\<AppId>`), para que Panel de Control/Configuración
//! también vea el producto. Los GUID son los mismos que llevaban los
//! `.iss` de Inno de esta sesión, por continuidad si una máquina ya tenía
//! esa instalación.

use std::path::{Path, PathBuf};
use winreg::enums::HKEY_CURRENT_USER;
use winreg::RegKey;

const RUTA_UNINSTALL: &str = "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Marca {
    pub version: String,
    pub ruta: PathBuf,
}

fn app_id(producto: &str) -> &'static str {
    match producto {
        "cliente" => "{E3B0C442-98FC-4E1B-8C6F-LUMICLIENTE01}",
        "indexer" => "{F4C1D553-99FD-4F2C-9D7A-LUMIINDEXER01}",
        otro => panic!("producto desconocido: {otro}"),
    }
}

pub fn escribir(producto: &str, nombre: &str, version: &str, ruta: &Path) -> std::io::Result<()> {
    escribir_bajo(RUTA_UNINSTALL, producto, nombre, version, ruta)
}

pub fn leer(producto: &str) -> Option<Marca> {
    leer_bajo(RUTA_UNINSTALL, producto)
}

fn escribir_bajo(
    raiz: &str,
    producto: &str,
    nombre: &str,
    version: &str,
    ruta: &Path,
) -> std::io::Result<()> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let clave = format!("{raiz}\\{}", app_id(producto));
    let (key, _) = hkcu.create_subkey(&clave)?;
    key.set_value("DisplayName", &nombre)?;
    key.set_value("DisplayVersion", &version)?;
    key.set_value("InstallLocation", &ruta.to_string_lossy().to_string())?;
    Ok(())
}

fn leer_bajo(raiz: &str, producto: &str) -> Option<Marca> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let clave = format!("{raiz}\\{}", app_id(producto));
    let key = hkcu.open_subkey(&clave).ok()?;
    let version: String = key.get_value("DisplayVersion").ok()?;
    let ruta: String = key.get_value("InstallLocation").ok()?;
    Some(Marca { version, ruta: PathBuf::from(ruta) })
}

#[cfg(test)]
mod tests {
    use super::*;

    // Clave de prueba aparte de la real (RUTA_UNINSTALL) para no tocar el
    // registro de verdad de la máquina que corre los tests.
    const RAIZ_PRUEBA: &str = "Software\\LumiInstallerTests";

    fn limpiar() {
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let _ = hkcu.delete_subkey_all(RAIZ_PRUEBA);
    }

    #[test]
    fn escribe_y_relee_la_misma_marca() {
        limpiar();
        escribir_bajo(RAIZ_PRUEBA, "cliente", "Lumi", "2.3.0", Path::new("C:\\Lumi\\Cliente"))
            .expect("escribir_bajo no deberia fallar");
        let leida = leer_bajo(RAIZ_PRUEBA, "cliente").expect("deberia haber marca");
        assert_eq!(leida.version, "2.3.0");
        assert_eq!(leida.ruta, PathBuf::from("C:\\Lumi\\Cliente"));
        limpiar();
    }

    #[test]
    fn leer_sin_marca_previa_da_none() {
        limpiar();
        assert!(leer_bajo(RAIZ_PRUEBA, "indexer").is_none());
    }

    #[test]
    fn cliente_e_indexer_son_entradas_independientes() {
        limpiar();
        escribir_bajo(RAIZ_PRUEBA, "cliente", "Lumi", "1.0.0", Path::new("C:\\a")).unwrap();
        escribir_bajo(RAIZ_PRUEBA, "indexer", "Lumi Indexer", "1.0.0", Path::new("C:\\b")).unwrap();
        assert_eq!(leer_bajo(RAIZ_PRUEBA, "cliente").unwrap().ruta, PathBuf::from("C:\\a"));
        assert_eq!(leer_bajo(RAIZ_PRUEBA, "indexer").unwrap().ruta, PathBuf::from("C:\\b"));
        limpiar();
    }
}
```

- [ ] **Step 2: Registrar el módulo en `lib.rs`**

Añade a `crates/lumi-installer/src/lib.rs`:
```rust
pub mod marca;
```

- [ ] **Step 3: Compilar y correr los tests**

```bash
cd "E:/Lumi Station" && cargo test -p lumi-installer -- --test-threads=1
```
`--test-threads=1` aquí porque los tests de este módulo comparten la misma clave de registro
de prueba (`RAIZ_PRUEBA`) — en paralelo se pisarían entre sí.
Expected: `10 passed` (4 de `sha256` + 3 de `proceso` + 3 de `marca`).

- [ ] **Step 4: Commit**

```bash
cd "E:/Lumi Station" && git add crates/lumi-installer && git commit -m "feat: deteccion de ya-instalado via registro en lumi-installer"
```

---

### Task 4: `bitacora.rs` — log de errores + marca de error pendiente

**Files:**
- Create: `crates/lumi-installer/src/bitacora.rs`
- Modify: `crates/lumi-installer/src/lib.rs` (añadir `pub mod bitacora;`)

**Interfaces:**
- Produces: `lumi_installer::bitacora::ErrorPendiente { producto: String, version_objetivo: String, motivo: String }`
  (deriva `Serialize, Deserialize`), `lumi_installer::bitacora::registrar(mensaje: &str)`,
  `lumi_installer::bitacora::dejar_marca_error(producto: &str, version_objetivo: &str, motivo: &str)`,
  `lumi_installer::bitacora::leer_y_borrar_marca_error(producto: &str) -> Option<ErrorPendiente>`.

- [ ] **Step 1: Escribir `bitacora.rs` con sus tests**

```rust
//! Log en disco + marca de error pendiente (spec, sección 5: "log en disco
//! **y** aviso en la app la próxima vez que abre"). La carpeta de datos se
//! puede sobreescribir con `LUMI_INSTALADOR_DATOS` — así los tests no
//! tocan el `%LocalAppData%` real de quien corre `cargo test`.

use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Write;
use std::path::PathBuf;

fn carpeta_datos() -> PathBuf {
    if let Ok(v) = std::env::var("LUMI_INSTALADOR_DATOS") {
        return PathBuf::from(v);
    }
    let base = std::env::var("LOCALAPPDATA").unwrap_or_else(|_| ".".into());
    PathBuf::from(base).join("Lumi")
}

fn ruta_log() -> PathBuf {
    carpeta_datos().join("instalador.log")
}

fn ruta_marca_error() -> PathBuf {
    carpeta_datos().join("instalador-error.json")
}

fn marca_de_tiempo() -> String {
    // Segundos desde epoch — suficiente para ordenar líneas de log, sin
    // añadir una dependencia de calendario solo para esto.
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    format!("[{secs}]")
}

pub fn registrar(mensaje: &str) {
    let _ = fs::create_dir_all(carpeta_datos());
    if let Ok(mut f) = fs::OpenOptions::new().create(true).append(true).open(ruta_log()) {
        let _ = writeln!(f, "{} {}", marca_de_tiempo(), mensaje);
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ErrorPendiente {
    pub producto: String,
    pub version_objetivo: String,
    pub motivo: String,
}

pub fn dejar_marca_error(producto: &str, version_objetivo: &str, motivo: &str) {
    registrar(&format!("actualizacion de {producto} a {version_objetivo} fallo: {motivo}"));
    let _ = fs::create_dir_all(carpeta_datos());
    let cuerpo = ErrorPendiente {
        producto: producto.to_string(),
        version_objetivo: version_objetivo.to_string(),
        motivo: motivo.to_string(),
    };
    if let Ok(json) = serde_json::to_string(&cuerpo) {
        let _ = fs::write(ruta_marca_error(), json);
    }
}

/// Se muestra una sola vez: al leerla para `producto`, se borra. Si la
/// marca era para el *otro* producto (mismo equipo, dos apps instaladas),
/// se vuelve a escribir tal cual para que ese otro arranque sí la recoja.
pub fn leer_y_borrar_marca_error(producto: &str) -> Option<ErrorPendiente> {
    let ruta = ruta_marca_error();
    let contenido = fs::read_to_string(&ruta).ok()?;
    let marca: ErrorPendiente = serde_json::from_str(&contenido).ok()?;
    let _ = fs::remove_file(&ruta);
    if marca.producto == producto {
        Some(marca)
    } else {
        if let Ok(json) = serde_json::to_string(&marca) {
            let _ = fs::write(&ruta, json);
        }
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    // Los tests de este módulo mutan la variable de entorno que decide la
    // carpeta de datos — con un Mutex se evita que corran en paralelo y se
    // pisen la carpeta unos a otros.
    static CANDADO: Mutex<()> = Mutex::new(());

    fn carpeta_de_prueba(nombre: &str) -> PathBuf {
        std::env::temp_dir().join(format!("lumi-installer-test-{nombre}-{}", std::process::id()))
    }

    #[test]
    fn marca_error_se_escribe_se_lee_una_vez_y_se_borra() {
        let _guardia = CANDADO.lock().unwrap();
        let tmp = carpeta_de_prueba("bitacora-a");
        std::env::set_var("LUMI_INSTALADOR_DATOS", &tmp);

        dejar_marca_error("cliente", "2.4.0", "sin red");
        let leida = leer_y_borrar_marca_error("cliente").expect("deberia haber marca");
        assert_eq!(leida.version_objetivo, "2.4.0");
        assert_eq!(leida.motivo, "sin red");
        assert!(leer_y_borrar_marca_error("cliente").is_none());

        let _ = fs::remove_dir_all(&tmp);
        std::env::remove_var("LUMI_INSTALADOR_DATOS");
    }

    #[test]
    fn marca_de_otro_producto_no_se_consume_y_sigue_disponible() {
        let _guardia = CANDADO.lock().unwrap();
        let tmp = carpeta_de_prueba("bitacora-b");
        std::env::set_var("LUMI_INSTALADOR_DATOS", &tmp);

        dejar_marca_error("indexer", "0.2.0", "hash no coincide");
        assert!(leer_y_borrar_marca_error("cliente").is_none());
        let leida = leer_y_borrar_marca_error("indexer").expect("deberia seguir para indexer");
        assert_eq!(leida.version_objetivo, "0.2.0");

        let _ = fs::remove_dir_all(&tmp);
        std::env::remove_var("LUMI_INSTALADOR_DATOS");
    }
}
```

- [ ] **Step 2: Registrar el módulo en `lib.rs`**

Añade a `crates/lumi-installer/src/lib.rs`:
```rust
pub mod bitacora;
```

- [ ] **Step 3: Compilar y correr los tests**

```bash
cd "E:/Lumi Station" && cargo test -p lumi-installer -- --test-threads=1
```
Expected: `12 passed`.

- [ ] **Step 4: Commit**

```bash
cd "E:/Lumi Station" && git add crates/lumi-installer && git commit -m "feat: log de errores y marca pendiente en lumi-installer"
```

---

### Task 5: `manifiesto.rs` + `aplicar.rs` — descargar, verificar, copiar

**Files:**
- Create: `crates/lumi-installer/src/manifiesto.rs`
- Create: `crates/lumi-installer/src/aplicar.rs`
- Modify: `crates/lumi-installer/src/lib.rs` (añadir ambos módulos)

**Interfaces:**
- Consumes: `crate::error::InstaladorError`, `crate::sha256::verificar_sha256` (Task 1).
- Produces: `lumi_installer::manifiesto::obtener_verificado() -> Result<lumi_proto::actualizacion::Manifiesto, InstaladorError>`,
  `lumi_installer::aplicar::Fase` (enum: `Descargando`, `Verificando`, `Copiando`),
  `lumi_installer::aplicar::aplicar_producto(publicacion: &lumi_proto::actualizacion::Publicacion, plataforma: &str, destino_exe: &std::path::Path, on_fase: impl Fn(Fase)) -> Result<(), InstaladorError>`.

Sin tests en este task (IO de red y de disco, no lógica pura — ver Global Constraints).

- [ ] **Step 1: Escribir `manifiesto.rs`**

```rust
//! Mismo patrón que `comprobar_actualizacion` en cliente/Indexer
//! (`client/src-tauri/src/main.rs`, `indexer/src-tauri/src/actualizacion.rs`):
//! la URL está duplicada a propósito, es configuración de red de cada
//! binario, no protocolo compartido.

use lumi_proto::actualizacion::Manifiesto;

use crate::error::InstaladorError;

const VERSIONES_URL: &str = "https://lumi-web.vercel.app/api/versiones";

pub fn obtener_verificado() -> Result<Manifiesto, InstaladorError> {
    let manifiesto: Manifiesto = reqwest::blocking::get(VERSIONES_URL)
        .map_err(|e| InstaladorError::Red(e.to_string()))?
        .json()
        .map_err(|e| InstaladorError::Red(e.to_string()))?;
    manifiesto
        .comprobar()
        .map_err(|e| InstaladorError::Manifiesto(e.to_string()))?;
    Ok(manifiesto)
}
```

- [ ] **Step 2: Escribir `aplicar.rs`**

```rust
//! Descarga+verifica+copia el ejecutable de un producto. No crea accesos
//! directos ni entrada de registro — eso solo hace falta en la primera
//! instalación interactiva (`installer/src-tauri`, Task 7), no en cada
//! actualización silenciosa donde ya existen.

use std::fs;
use std::path::Path;

use lumi_proto::actualizacion::Publicacion;

use crate::error::InstaladorError;
use crate::sha256::verificar_sha256;

pub enum Fase {
    Descargando,
    Verificando,
    Copiando,
}

pub fn aplicar_producto(
    publicacion: &Publicacion,
    plataforma: &str,
    destino_exe: &Path,
    on_fase: impl Fn(Fase),
) -> Result<(), InstaladorError> {
    let artefacto = publicacion
        .artefactos
        .iter()
        .find(|a| a.plataforma == plataforma)
        .ok_or(InstaladorError::SinArtefactoParaPlataforma)?;

    on_fase(Fase::Descargando);
    let bytes = reqwest::blocking::get(&artefacto.url)
        .map_err(|e| InstaladorError::Red(e.to_string()))?
        .bytes()
        .map_err(|e| InstaladorError::Red(e.to_string()))?;

    on_fase(Fase::Verificando);
    if !verificar_sha256(&bytes, &artefacto.sha256) {
        return Err(InstaladorError::HashNoCoincide);
    }

    on_fase(Fase::Copiando);
    if let Some(padre) = destino_exe.parent() {
        fs::create_dir_all(padre).map_err(|e| InstaladorError::Disco(e.to_string()))?;
    }
    fs::write(destino_exe, &bytes).map_err(|e| InstaladorError::Disco(e.to_string()))?;

    Ok(())
}
```

- [ ] **Step 3: Registrar los módulos en `lib.rs`**

Añade a `crates/lumi-installer/src/lib.rs`:
```rust
pub mod aplicar;
pub mod manifiesto;
```

- [ ] **Step 4: Compilar**

```bash
cd "E:/Lumi Station" && cargo build -p lumi-installer
```
Expected: compila sin error. (No hay tests nuevos que correr en este task.)

- [ ] **Step 5: Commit**

```bash
cd "E:/Lumi Station" && git add crates/lumi-installer && git commit -m "feat: descarga y verificacion de artefactos en lumi-installer"
```

---

### Task 6: `instalador-cli` — el binario silencioso

**Files:**
- Create: `instalador-cli/Cargo.toml`
- Create: `instalador-cli/src/main.rs`
- Modify: `Cargo.toml:7` (raíz — añadir `"instalador-cli"` a `exclude`)

**Interfaces:**
- Consumes: todo `lumi_installer` (Tasks 1-5).
- Produces: el binario `instalador-cli.exe`, argumentos
  `--producto=<cliente|indexer> --pid=<n> --version-actual=<x.y.z> --silencioso`.

- [ ] **Step 1: Crear el proyecto**

```bash
mkdir -p "E:/Lumi Station/instalador-cli/src"
```

Escribe `instalador-cli/Cargo.toml`:

```toml
[package]
name = "instalador-cli"
version = "0.1.0"
edition = "2021"
license = "AGPL-3.0-or-later"

[[bin]]
name = "instalador-cli"
path = "src/main.rs"

[dependencies]
lumi-installer = { path = "../crates/lumi-installer" }
lumi-proto = { path = "../crates/lumi-proto" }
```

- [ ] **Step 2: Excluirlo del workspace raíz**

En `E:/Lumi Station/Cargo.toml:7`, cambia:
```toml
exclude = ["client/src-tauri", "indexer/src-tauri"]
```
por:
```toml
exclude = ["client/src-tauri", "indexer/src-tauri", "installer/src-tauri", "instalador-cli"]
```
(se añade también `installer/src-tauri` de una vez — Task 7 lo crea, así este Cargo.toml
raíz no hay que volver a tocarlo).

- [ ] **Step 3: Escribir `main.rs`**

```rust
//! Disparo silencioso de una actualización — sin ventana, en milisegundos.
//! El cliente/Indexer lo lanzan y se cierran antes (spec, Flujo B): esto
//! solo confirma que de verdad pasó, con margen, antes de tocar archivos.
//!
//! Uso: instalador-cli --producto=cliente --pid=1234 --version-actual=2.3.0 --silencioso

use std::path::PathBuf;
use std::time::Duration;

use lumi_installer::aplicar::{aplicar_producto, Fase};
use lumi_installer::bitacora;
use lumi_installer::marca;
use lumi_installer::proceso::esperar_cierre;
use lumi_proto::actualizacion::Producto;

struct Args {
    producto: String,
    pid: u32,
    version_actual: String,
}

fn parsear_args() -> Option<Args> {
    let mut producto = None;
    let mut pid = None;
    let mut version_actual = None;
    for arg in std::env::args().skip(1) {
        if let Some(v) = arg.strip_prefix("--producto=") {
            producto = Some(v.to_string());
        } else if let Some(v) = arg.strip_prefix("--pid=") {
            pid = v.parse::<u32>().ok();
        } else if let Some(v) = arg.strip_prefix("--version-actual=") {
            version_actual = Some(v.to_string());
        }
    }
    Some(Args {
        producto: producto?,
        pid: pid?,
        version_actual: version_actual?,
    })
}

fn producto_enum(producto: &str) -> Option<Producto> {
    match producto {
        "cliente" => Some(Producto::Cliente),
        "indexer" => Some(Producto::Indexer),
        _ => None,
    }
}

fn nombre_ejecutable(producto: &str) -> &'static str {
    match producto {
        "cliente" => "app.exe",
        "indexer" => "indexer-app.exe",
        _ => unreachable!(),
    }
}

fn main() {
    let Some(args) = parsear_args() else {
        bitacora::registrar("instalador-cli: argumentos invalidos, abortando");
        std::process::exit(1);
    };

    if !esperar_cierre(args.pid, Duration::from_secs(10)) {
        bitacora::dejar_marca_error(
            &args.producto,
            "desconocida",
            "el proceso anterior no cerro a tiempo",
        );
        std::process::exit(1);
    }

    let Some(marca_previa) = marca::leer(&args.producto) else {
        bitacora::dejar_marca_error(&args.producto, "desconocida", "no se encontro la instalacion previa");
        std::process::exit(1);
    };

    let resultado = (|| -> Result<(), lumi_installer::InstaladorError> {
        let manifiesto = lumi_installer::manifiesto::obtener_verificado()?;
        let Some(producto) = producto_enum(&args.producto) else {
            return Err(lumi_installer::InstaladorError::SinPublicacionNueva);
        };
        let publicacion = manifiesto
            .mas_nueva(producto, &args.version_actual, "windows-x86_64")
            .ok_or(lumi_installer::InstaladorError::SinPublicacionNueva)?
            .clone();

        let destino = marca_previa.ruta.join(nombre_ejecutable(&args.producto));
        aplicar_producto(&publicacion, "windows-x86_64", &destino, |fase| {
            let texto = match fase {
                Fase::Descargando => "descargando",
                Fase::Verificando => "verificando",
                Fase::Copiando => "copiando",
            };
            bitacora::registrar(&format!("{}: {texto}", args.producto));
        })?;

        marca::escribir(
            &args.producto,
            if args.producto == "cliente" { "Lumi" } else { "Lumi Indexer" },
            &publicacion.version,
            &marca_previa.ruta,
        )
        .map_err(|e| lumi_installer::InstaladorError::Disco(e.to_string()))?;

        std::process::Command::new(&destino)
            .spawn()
            .map_err(|e| lumi_installer::InstaladorError::Disco(e.to_string()))?;

        Ok(())
    })();

    match resultado {
        Ok(()) => {
            bitacora::registrar(&format!("{}: actualizacion aplicada", args.producto));
        }
        Err(e) => {
            bitacora::dejar_marca_error(&args.producto, &args.version_actual, &e.to_string());
            std::process::exit(1);
        }
    }
}
```

- [ ] **Step 4: Compilar**

```bash
cd "E:/Lumi Station" && cargo build -p instalador-cli
```
Expected: compila sin error.

- [ ] **Step 5: Probar manualmente que el parseo de argumentos y la espera de proceso no explotan con un PID inexistente**

```bash
cd "E:/Lumi Station" && ./target/debug/instalador-cli.exe --producto=cliente --pid=999999 --version-actual=0.0.1
```
Expected: termina rápido (no se cuelga 10s) con código de salida 1, y
`%LocalAppData%\Lumi\instalador-error.json` existe con `"motivo":"no se encontro la instalacion previa"`
(no hay marca de "cliente" en el registro de esta máquina de desarrollo todavía — es el error
esperado en este punto del plan, confirma que el camino de error funciona de punta a punta).

- [ ] **Step 6: Commit**

```bash
cd "E:/Lumi Station" && git add Cargo.toml instalador-cli && git commit -m "feat: instalador-cli, actualizacion silenciosa sin ventana"
```

---

### Task 7: `installer/` — scaffold Tauri y comandos Rust

**Files:**
- Create: `installer/` (proyecto npm, clonado de `indexer/` y recortado)
- Create: `installer/src-tauri/src/comandos.rs`
- Modify: `installer/src-tauri/src/main.rs`
- Modify: `installer/src-tauri/Cargo.toml`
- Modify: `installer/package.json`, `installer/src-tauri/tauri.conf.json`

**Interfaces:**
- Consumes: `lumi_installer::{marca, manifiesto, aplicar}` (Tasks 1-5).
- Produces: comandos Tauri `detectar_instalados() -> Vec<InfoProducto>`,
  `instalar(productos: Vec<String>, raiz: String) -> Result<(), String>` (emite eventos
  `progreso` con `{ producto: String, fase: String }` mientras corre).

`indexer/` es la plantilla porque no tiene el emparejamiento TLS con `lumid` que sí tiene
`client/` — el instalador no habla con ningún servidor emparejado, solo con el manifiesto en
Vercel y con el disco.

- [ ] **Step 1: Clonar `indexer/` como punto de partida y limpiar lo que no aplica**

```bash
cd "E:/Lumi Station"
cp -r indexer installer
rm -rf installer/node_modules installer/dist installer/src-tauri/target
rm -rf installer/src/catalog installer/src/download installer/src/ingest installer/src/review installer/src/seal installer/src/territory
```

- [ ] **Step 2: Recortar `installer/package.json`**

Lee `installer/package.json`, y cambia el campo `"name"` (probablemente `"lumi-indexer"` o
similar) a `"lumi-installer-ui"`. Deja el resto de scripts (`dev`, `build`, `tauri`) tal cual —
son los mismos de `indexer/`.

- [ ] **Step 3: Recortar `installer/src-tauri/Cargo.toml`**

Reemplaza su contenido completo por:

```toml
[package]
name = "installer"
version = "0.1.0"
description = "Instalador de Lumi y Lumi Indexer"
authors = ["Lumi"]
license = "AGPL-3.0-or-later"
repository = ""
edition = "2021"
rust-version = "1.77.2"

[lib]
name = "installer_lib"
crate-type = ["staticlib", "cdylib", "rlib"]

[build-dependencies]
tauri-build = { version = "2.6.3", features = [] }

[dependencies]
serde_json = "1.0"
serde = { version = "1.0", features = ["derive"] }
log = "0.4"
tauri = { version = "2.11.3", features = [] }
tauri-plugin-log = "2"
tauri-plugin-dialog = "2"
lumi-installer = { path = "../../crates/lumi-installer" }
lumi-proto = { path = "../../crates/lumi-proto" }
```

- [ ] **Step 4: Escribir `installer/src-tauri/src/comandos.rs`**

```rust
//! Los dos comandos que la UI de `installer/src` necesita: qué hay ya
//! instalado (para la pantalla de Productos) y el instalar en sí (para la
//! pantalla de Instalando). Ver
//! docs/superpowers/specs/2026-08-26-instalador-compartido-design.md.

use std::path::PathBuf;

use lumi_installer::aplicar::{aplicar_producto, Fase};
use lumi_installer::marca;
use lumi_proto::actualizacion::Producto;
use tauri::{AppHandle, Emitter};

#[derive(serde::Serialize)]
pub struct InfoProducto {
    pub producto: String,
    pub ya_instalado: bool,
    pub version: Option<String>,
}

#[tauri::command]
pub fn detectar_instalados() -> Vec<InfoProducto> {
    ["cliente", "indexer"]
        .into_iter()
        .map(|p| match marca::leer(p) {
            Some(m) => InfoProducto { producto: p.to_string(), ya_instalado: true, version: Some(m.version) },
            None => InfoProducto { producto: p.to_string(), ya_instalado: false, version: None },
        })
        .collect()
}

fn nombre_ejecutable(producto: &str) -> &'static str {
    match producto {
        "cliente" => "app.exe",
        "indexer" => "indexer-app.exe",
        _ => unreachable!(),
    }
}

fn nombre_mostrado(producto: &str) -> &'static str {
    match producto {
        "cliente" => "Lumi",
        "indexer" => "Lumi Indexer",
        _ => unreachable!(),
    }
}

fn producto_enum(producto: &str) -> Producto {
    match producto {
        "cliente" => Producto::Cliente,
        "indexer" => Producto::Indexer,
        _ => unreachable!(),
    }
}

#[tauri::command]
pub fn instalar(app: AppHandle, productos: Vec<String>, raiz: String) -> Result<(), String> {
    let manifiesto = lumi_installer::manifiesto::obtener_verificado().map_err(|e| e.to_string())?;
    let raiz = PathBuf::from(raiz);

    for producto in &productos {
        let publicacion = manifiesto
            .mas_nueva(producto_enum(producto), "0.0.0", "windows-x86_64")
            .ok_or_else(|| format!("{producto}: sin publicacion disponible"))?
            .clone();

        let carpeta = raiz.join(if producto == "cliente" { "Cliente" } else { "Indexer" });
        let destino = carpeta.join(nombre_ejecutable(producto));

        let producto_evento = producto.clone();
        let app_evento = app.clone();
        aplicar_producto(&publicacion, "windows-x86_64", &destino, move |fase| {
            let texto = match fase {
                Fase::Descargando => "descargando",
                Fase::Verificando => "verificando",
                Fase::Copiando => "copiando",
            };
            let _ = app_evento.emit("progreso", serde_json::json!({
                "producto": producto_evento,
                "fase": texto,
            }));
        })
        .map_err(|e| e.to_string())?;

        marca::escribir(producto, nombre_mostrado(producto), &publicacion.version, &carpeta)
            .map_err(|e| e.to_string())?;

        crear_accesos_directos(producto, &destino)?;
    }

    Ok(())
}

fn crear_accesos_directos(producto: &str, destino_exe: &std::path::Path) -> Result<(), String> {
    let nombre = nombre_mostrado(producto);
    let escritorio = dirs_escritorio()?;
    let enlace = escritorio.join(format!("{nombre}.lnk"));
    mslnk::ShellLink::new(destino_exe)
        .map_err(|e| e.to_string())?
        .create_lnk(&enlace)
        .map_err(|e| e.to_string())?;
    Ok(())
}

fn dirs_escritorio() -> Result<PathBuf, String> {
    std::env::var("USERPROFILE")
        .map(|p| PathBuf::from(p).join("Desktop"))
        .map_err(|_| "no se encontro USERPROFILE".to_string())
}
```

- [ ] **Step 5: Añadir `mslnk` al `Cargo.toml` de `installer/src-tauri`**

```bash
cd "E:/Lumi Station/installer/src-tauri" && cargo add mslnk
```

- [ ] **Step 6: Editar `installer/src-tauri/src/main.rs`**

Lee el archivo primero (viene de la plantilla de `indexer/`, tiene mucho código específico de
Indexer que hay que quitar). Reemplaza su contenido completo por:

```rust
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod comandos;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_log::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![comandos::detectar_instalados, comandos::instalar])
        .run(tauri::generate_context!())
        .expect("error al iniciar el instalador");
}
```

- [ ] **Step 7: Editar `installer/src-tauri/tauri.conf.json`**

Ábrelo y cambia `productName`, `identifier` (algo como `"com.lumi.installer"`),
`mainBinaryName` si existe, y en `app.windows[0]`: `"title": "Instalador de Lumi"`,
`"width": 640`, `"height": 460`, `"resizable": false`. Deja el resto de la estructura (build,
bundle, plugins) tal cual venía de `indexer/`.

- [ ] **Step 8: Compilar el backend de Rust (sin la UI todavía — eso es el Task 8)**

```bash
cd "E:/Lumi Station" && cargo build -p installer
```
Expected: compila sin error. Si falla por algo que la plantilla de `indexer/` dejó
(referencias a módulos borrados en el Step 1), bórralas de `main.rs`/`Cargo.toml` hasta que
compile — el único código que debe quedar es el de este task.

- [ ] **Step 9: Commit**

```bash
cd "E:/Lumi Station" && git add Cargo.toml installer && git commit -m "feat: scaffold del instalador Tauri, comandos detectar_instalados e instalar"
```

---

### Task 8: `installer/` — la interfaz (adaptar el mockup aprobado)

**Files:**
- Modify: `installer/index.html` (o `installer/src/index.html` según dónde haya quedado tras
  el clon — comprueba con `ls installer/*.html installer/src/*.html`)
- Delete: cualquier `.tsx`/`.ts` de React que haya quedado de la plantilla de Indexer bajo
  `installer/src/` (este instalador es HTML/CSS/JS estático, sin build de React — ver Global
  Constraints)
- Modify: `installer/vite.config.ts` si hace falta apuntar al nuevo `index.html`

**Interfaces:**
- Consumes: `detectar_instalados()`, `instalar(productos, raiz)`, evento `progreso` (Task 7).

Antes de este task, abre en un navegador
`docs/superpowers/specs/2026-08-26-instalador-pane-mockup.html` — es la referencia exacta de
layout/color/tipografía que hay que igualar. Este task **añade** una pantalla que el mockup no
tenía (Productos, con las dos casillas) entre Bienvenida y Ubicación, y conecta las demás a
comandos reales en vez de al interruptor de radio buttons de la demo.

- [ ] **Step 1: Vaciar `installer/src/` de sobrantes de React**

```bash
cd "E:/Lumi Station" && find installer/src -type f \( -name "*.tsx" -o -name "*.ts" \) -delete
rm -f installer/src/App.css installer/src/index.css installer/src/main.tsx
```

- [ ] **Step 2: Escribir `installer/index.html`**

Parte del contenido de `docs/superpowers/specs/2026-08-26-instalador-pane-mockup.html` (mismos
tokens de color, misma estructura de `.window`/`.stage`/`.pane`/`.footer`), pero:

- Quita el bloque `<div class="intro">` y `<div class="steps">` (eran controles de demo del
  mockup, no de un instalador real).
- Añade una pantalla nueva `#p1b` "Productos" entre `#p1` (Bienvenida) y lo que era `#p2`
  (renómbralo `#p_ubicacion`), con una casilla por producto.
- Sustituye el `<script>` final por el que integra con Tauri (Step 3).

```html
<title>Instalador de Lumi</title>
<style>
  :root {
    --bg: #0e0f11;
    --space: #05070a;
    --panel: #1a1b1e;
    --elevated: #202226;
    --border: #26282c;
    --fg: #e8e8e6;
    --muted: #9a9a95;
    --subtle: #6a6c70;
    --accent: #f2f3f5;
    --draw-fg: #85b7eb;
    --danger-fg: #e88f8f;
    --font-sans: "Segoe UI", system-ui, sans-serif;
    --font-mono: ui-monospace, "SFMono-Regular", Menlo, monospace;
  }
  * { box-sizing: border-box; }
  html, body { height: 100%; margin: 0; }
  body {
    background: var(--bg);
    color: var(--fg);
    font-family: var(--font-sans);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .stage { position: relative; flex: 1; background: var(--bg); }
  .pane {
    position: absolute; inset: 0; display: none; flex-direction: column;
    align-items: center; padding: 44px 40px 20px;
  }
  .pane.active { display: flex; }
  .brandline { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--subtle); margin-bottom: 32px; align-self: flex-start; }
  .brandline .mark { color: var(--draw-fg); font-size: 14px; }
  .pane-body { width: 100%; max-width: 460px; flex: 1; }
  .pane-body h2 { font-size: 17px; font-weight: 600; margin: 0 0 10px; }
  .pane-body p.desc { font-size: 14px; color: var(--muted); line-height: 1.55; margin: 0 0 28px; max-width: 46ch; }
  .center { text-align: center; }
  .center .pane-body { display: flex; flex-direction: column; align-items: center; }
  .field-label { font-size: 11px; color: var(--muted); margin-bottom: 7px; display: block; }
  .path-row { display: flex; gap: 8px; }
  .path-row .path { flex: 1; border: 1px solid var(--border); background: #0d0f12; border-radius: 8px; padding: 10px 12px; font-family: var(--font-mono); font-size: 12.5px; color: var(--fg); }
  .path-row button.browse { border: 1px solid var(--border); background: var(--elevated); color: var(--fg); border-radius: 8px; padding: 0 16px; font-size: 12px; cursor: pointer; }
  .option-row { display: flex; align-items: center; gap: 10px; padding: 13px 0; border-top: 1px solid var(--border); cursor: pointer; }
  .option-row:last-child { border-bottom: 1px solid var(--border); }
  .checkbox { width: 16px; height: 16px; border-radius: 4px; border: 1px solid var(--border); background: var(--elevated); display: grid; place-items: center; flex-shrink: 0; }
  .checkbox.checked { background: var(--accent); border-color: var(--accent); }
  .checkbox svg { width: 11px; height: 11px; stroke: transparent; stroke-width: 2.4; fill: none; }
  .checkbox.checked svg { stroke: var(--bg); }
  .option-row .label { font-size: 13px; }
  .option-row .sub { font-size: 11.5px; color: var(--subtle); margin-top: 2px; }
  .option-row.disabled { cursor: default; opacity: .55; }
  .progress-track { width: 100%; height: 3px; background: var(--elevated); border-radius: 2px; overflow: hidden; margin-bottom: 14px; }
  .progress-fill { height: 100%; width: 0%; background: var(--draw-fg); border-radius: 2px; transition: width .3s cubic-bezier(.16,1,.3,1); }
  .progress-status { font-family: var(--font-mono); font-size: 11px; color: var(--subtle); }
  .footer { height: 56px; border-top: 1px solid var(--border); display: flex; align-items: center; justify-content: space-between; padding: 0 24px; flex-shrink: 0; }
  .footer .ver { font-family: var(--font-mono); font-size: 10.5px; color: var(--subtle); }
  .footer .actions { display: flex; gap: 10px; }
  .btn { font-size: 12px; border-radius: 8px; padding: 8px 18px; border: none; cursor: pointer; font-family: var(--font-sans); }
  .btn.ghost { background: transparent; color: var(--muted); border: 1px solid var(--border); }
  .btn.primary { background: var(--accent); color: var(--bg); font-weight: 500; }
  .btn:disabled { opacity: .4; cursor: default; }
  .error-box { border: 1px solid var(--danger-fg); background: rgba(232,143,143,.08); border-radius: 8px; padding: 10px 12px; font-size: 12px; color: var(--danger-fg); margin-top: 16px; }
</style>

<div class="stage">
  <div class="pane center active" id="p_bienvenida">
    <div class="brandline"><span class="mark">*</span> Lumi</div>
    <div class="pane-body">
      <h2>Instalar Lumi</h2>
      <p class="desc">Este asistente instala el cliente de investigación y/o Lumi Indexer.</p>
    </div>
  </div>

  <div class="pane" id="p_productos">
    <div class="brandline"><span class="mark">*</span> Lumi</div>
    <div class="pane-body">
      <h2>Productos</h2>
      <p class="desc">Elige qué instalar.</p>
      <div class="option-row" data-producto="cliente">
        <div class="checkbox checked"><svg viewBox="0 0 24 24"><path d="M20 6L9 17l-5-5"/></svg></div>
        <div><div class="label">Lumi</div><div class="sub" data-estado="cliente"></div></div>
      </div>
      <div class="option-row" data-producto="indexer">
        <div class="checkbox checked"><svg viewBox="0 0 24 24"><path d="M20 6L9 17l-5-5"/></svg></div>
        <div><div class="label">Lumi Indexer</div><div class="sub" data-estado="indexer"></div></div>
      </div>
    </div>
  </div>

  <div class="pane" id="p_ubicacion">
    <div class="brandline"><span class="mark">*</span> Lumi</div>
    <div class="pane-body">
      <h2>Carpeta de destino</h2>
      <p class="desc">Cada producto elegido va en su propia subcarpeta.</p>
      <span class="field-label">Ubicación</span>
      <div class="path-row">
        <div class="path" id="ruta-destino">%LocalAppData%\Programs\Lumi</div>
        <button class="browse" id="btn-examinar">Examinar…</button>
      </div>
    </div>
  </div>

  <div class="pane" id="p_instalando">
    <div class="brandline"><span class="mark">*</span> Lumi</div>
    <div class="pane-body">
      <h2 id="titulo-instalando">Instalando</h2>
      <p class="desc" id="desc-instalando">Esto tarda unos segundos.</p>
      <div class="progress-track"><div class="progress-fill" id="barra"></div></div>
      <div class="progress-status" id="estado-texto"></div>
      <div class="error-box" id="caja-error" style="display:none"></div>
    </div>
  </div>
</div>

<div class="footer">
  <span class="ver">0.1.0</span>
  <div class="actions">
    <button class="btn ghost" id="btn-atras">Atrás</button>
    <button class="btn primary" id="btn-siguiente">Siguiente</button>
  </div>
</div>

<script type="module" src="./instalador.js"></script>
```

- [ ] **Step 3: Escribir `installer/instalador.js`**

```javascript
// Import ES real, no `window.__TAURI__` — ese global solo existe si
// `app.withGlobalTauri` está a `true` en tauri.conf.json, y la plantilla
// clonada de `indexer/` no lo tiene así. `@tauri-apps/api` ya es
// dependencia (viene del `package.json` clonado).
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";

const PANTALLAS = ["p_bienvenida", "p_productos", "p_ubicacion", "p_instalando"];
let indice = 0;
let raiz = "%LocalAppData%\\Programs\\Lumi";
const seleccion = new Set(["cliente", "indexer"]);

const btnAtras = document.getElementById("btn-atras");
const btnSiguiente = document.getElementById("btn-siguiente");

function mostrar(i) {
  PANTALLAS.forEach((id, n) => {
    document.getElementById(id).classList.toggle("active", n === i);
  });
  btnAtras.style.visibility = i === 0 ? "hidden" : "visible";
  btnSiguiente.textContent = i === PANTALLAS.length - 1 ? "Instalar" : "Siguiente";
}

document.querySelectorAll(".option-row[data-producto]").forEach((fila) => {
  fila.addEventListener("click", () => {
    const producto = fila.dataset.producto;
    const casilla = fila.querySelector(".checkbox");
    if (seleccion.has(producto)) {
      seleccion.delete(producto);
      casilla.classList.remove("checked");
    } else {
      seleccion.add(producto);
      casilla.classList.add("checked");
    }
  });
});

document.getElementById("btn-examinar").addEventListener("click", async () => {
  const elegida = await open({ directory: true, multiple: false });
  if (elegida) {
    raiz = elegida;
    document.getElementById("ruta-destino").textContent = raiz;
  }
});

async function pintarEstadoInstalados() {
  const info = await invoke("detectar_instalados");
  for (const item of info) {
    const sub = document.querySelector(`[data-estado="${item.producto}"]`);
    if (item.ya_instalado) {
      sub.textContent = `Ya instalado (${item.version})`;
      const fila = document.querySelector(`.option-row[data-producto="${item.producto}"]`);
      fila.querySelector(".checkbox").classList.remove("checked");
      seleccion.delete(item.producto);
    }
  }
}

async function ejecutarInstalacion() {
  document.getElementById("btn-siguiente").disabled = true;
  document.getElementById("btn-atras").style.visibility = "hidden";

  const productos = [...seleccion];
  const cancelarEscucha = await listen("progreso", (evento) => {
    const { producto, fase } = evento.payload;
    document.getElementById("estado-texto").textContent = `${producto}: ${fase}`;
  });

  try {
    await invoke("instalar", { productos, raiz });
    document.getElementById("titulo-instalando").textContent = "Instalación completa";
    document.getElementById("desc-instalando").textContent = "Ya puedes cerrar esta ventana.";
    document.getElementById("barra").style.width = "100%";
    btnSiguiente.textContent = "Finalizar";
    btnSiguiente.disabled = false;
    btnSiguiente.onclick = () => window.close();
  } catch (err) {
    const caja = document.getElementById("caja-error");
    caja.style.display = "block";
    caja.textContent = String(err);
    document.getElementById("desc-instalando").textContent = "La instalación no se completó.";
  } finally {
    cancelarEscucha();
  }
}

btnSiguiente.addEventListener("click", () => {
  if (indice === PANTALLAS.length - 1) {
    ejecutarInstalacion();
    return;
  }
  indice += 1;
  mostrar(indice);
});

btnAtras.addEventListener("click", () => {
  if (indice === 0) return;
  indice -= 1;
  mostrar(indice);
});

mostrar(indice);
pintarEstadoInstalados();
```

- [ ] **Step 4: Ajustar `installer/vite.config.ts` si el `root`/`build.rollupOptions.input` de
  la plantilla de Indexer apuntaba a `src/index.html` en vez de a `index.html` en la raíz**

Comprueba con `cat installer/vite.config.ts`. Si el `input` apunta a otra ruta, corrígelo para
que apunte al `installer/index.html` del Step 2.

- [ ] **Step 5: Levantar el instalador en modo dev y verificar visualmente**

```bash
cd "E:/Lumi Station/installer" && npm install && npm run tauri dev
```
Con la app abierta: navega Bienvenida → Productos (las dos casillas deben aparecer marcadas,
o "Ya instalado" si esta máquina tiene marca de un task anterior) → Ubicación → clic en
"Instalar". Debe verse igual que
`docs/superpowers/specs/2026-08-26-instalador-pane-mockup.html` (fondo oscuro completo en las
cuatro pantallas, sin ningún blanco de Windows). Si el manifiesto real de Vercel aún no tiene
publicaciones para `cliente`/`indexer`, es normal que la instalación termine en la caja de
error roja "sin publicacion disponible" — lo importante en este paso es que la UI se vea
correcta y que el error se muestre de forma legible, no que la descarga tenga éxito.

- [ ] **Step 6: Commit**

```bash
cd "E:/Lumi Station" && git add installer && git commit -m "feat: interfaz del instalador (adaptada del mockup aprobado)"
```

---

### Task 9: Cliente — autoactualización silenciosa + aviso de error

**Files:**
- Modify: `client/src-tauri/src/main.rs:175-210` (la sección de `comprobar_actualizacion`)
- Modify: `client/src/lib/actualizaciones.ts`
- Modify: `client/src/ui/ActualizacionBanner.tsx`
- Modify: `client/src/App.tsx:50-54` (el `useEffect` que llama a `comprobarActualizacion`)

**Interfaces:**
- Consumes: nada de las tareas de Rust anteriores directamente (el cliente lanza
  `instalador-cli.exe` como proceso aparte, no lo linkea).
- Produces: comando Tauri `disparar_actualizacion_silenciosa(version_nueva: String)`, tipo TS
  `EstadoActualizacion` con la variante nueva `{ tipo: "error"; motivo: string }`.

- [ ] **Step 1: Añadir la variante de error al enum de Rust**

En `client/src-tauri/src/main.rs`, la sección que ya existe:
```rust
#[derive(serde::Serialize)]
#[serde(tag = "tipo", rename_all = "lowercase")]
enum EstadoActualizacion {
    Disponible { version: String, notas: String, url: String },
    Retirada,
}
```
Cámbiala por:
```rust
#[derive(serde::Serialize)]
#[serde(tag = "tipo", rename_all = "lowercase")]
enum EstadoActualizacion {
    Disponible { version: String, notas: String, url: String },
    Retirada,
    Error { motivo: String },
}
```

- [ ] **Step 2: Añadir el comando que lee la marca de error pendiente, y el que dispara la
  actualización silenciosa**

Justo debajo de la función `comprobar_actualizacion` existente en
`client/src-tauri/src/main.rs`, añade:

```rust
/// Se llama una vez al arrancar (ver App.tsx) — si `instalador-cli` dejó un
/// error de la última actualización silenciosa, se muestra aquí una sola
/// vez (la lectura ya lo borra).
#[tauri::command]
fn error_actualizacion_pendiente() -> Option<String> {
    lumi_installer::bitacora::leer_y_borrar_marca_error("cliente").map(|e| e.motivo)
}

/// Cierra esta app y lanza `instalador-cli.exe --producto=cliente` con el
/// PID propio, para que aplique `version_nueva` en segundo plano. Vive
/// junto al propio ejecutable — el instalador ya lo dejó ahí en la
/// instalación inicial (ver installer/src-tauri/src/comandos.rs).
#[tauri::command]
fn disparar_actualizacion_silenciosa(app: tauri::AppHandle, version_nueva: String) -> Result<(), String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let carpeta = exe.parent().ok_or("sin carpeta padre")?;
    let instalador = carpeta.join("instalador-cli.exe");
    let pid = std::process::id();
    let version_actual = env!("CARGO_PKG_VERSION");

    std::process::Command::new(instalador)
        .arg(format!("--producto=cliente"))
        .arg(format!("--pid={pid}"))
        .arg(format!("--version-actual={version_actual}"))
        .arg("--silencioso")
        .spawn()
        .map_err(|e| e.to_string())?;

    let _ = version_nueva; // informativo para quien lea el log; instalador-cli vuelve a resolver la version real contra el manifiesto
    app.exit(0);
    Ok(())
}
```

- [ ] **Step 3: Añadir `lumi-installer` como dependencia de `client/src-tauri`**

En `client/src-tauri/Cargo.toml`, añade bajo `[dependencies]`:
```toml
lumi-installer = { path = "../../crates/lumi-installer" }
```

- [ ] **Step 4: Registrar los dos comandos nuevos**

Busca en `client/src-tauri/src/main.rs` la línea (cerca de la 643):
```rust
upload_server_banner_bytes, comprobar_actualizacion
```
Cámbiala por:
```rust
upload_server_banner_bytes, comprobar_actualizacion, error_actualizacion_pendiente, disparar_actualizacion_silenciosa
```

- [ ] **Step 5: Compilar el backend**

```bash
cd "E:/Lumi Station" && cargo build -p app --manifest-path client/src-tauri/Cargo.toml
```
Expected: compila sin error.

- [ ] **Step 6: Actualizar `client/src/lib/actualizaciones.ts`**

Reemplaza su contenido por:

```typescript
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";

export type EstadoActualizacion =
  | { tipo: "disponible"; version: string; notas: string; url: string }
  | { tipo: "retirada" }
  | { tipo: "error"; motivo: string };

/** `null` = no hay nada nuevo. Lanza si no se pudo comprobar (sin red,
 *  manifiesto sin firmar o con firma inválida) — quien llama decide qué
 *  hacer con eso; ver `App.tsx` (silencioso) y `ProfileView.tsx` (visible,
 *  porque ahí sí lo pediste tú). */
export function comprobarActualizacion(): Promise<EstadoActualizacion | null> {
  return invoke<EstadoActualizacion | null>("comprobar_actualizacion");
}

export function abrirDescarga(url: string): Promise<void> {
  return openUrl(url);
}

/** Se llama una vez al arrancar (App.tsx) — si la última actualización
 *  silenciosa falló, esto trae el motivo y lo borra (se muestra una sola
 *  vez). `null` = no hay nada pendiente. */
export function errorActualizacionPendiente(): Promise<string | null> {
  return invoke<string | null>("error_actualizacion_pendiente");
}

/** Cierra esta app y aplica la actualización en segundo plano. No vuelve —
 *  la ventana se cierra dentro del comando de Rust. */
export function dispararActualizacionSilenciosa(versionNueva: string): Promise<void> {
  return invoke("disparar_actualizacion_silenciosa", { versionNueva });
}
```

- [ ] **Step 7: Extender `client/src/ui/ActualizacionBanner.tsx` para la variante de error**

Reemplaza su contenido por:

```tsx
import { abrirDescarga, type EstadoActualizacion } from "../lib/actualizaciones";
import { Icon } from "./Icon";

/** Vive en `ui/`, no en `admin/`, igual que `MantenimientoBanner`: `App.tsx`
 *  la monta una sola vez para toda la app. A diferencia de mantenimiento,
 *  esto no es un estado del servidor: es local y descartable — cerrarla no
 *  vuelve a comprobar hasta el próximo arranque o hasta "Comprobar ahora"
 *  en Perfil. */
export function ActualizacionBanner({ estado, onCerrar }: {
  estado: EstadoActualizacion;
  onCerrar: () => void;
}) {
  const esError = estado.tipo === "error";
  const retirada = estado.tipo === "retirada";
  return (
    <div
      className={`relative flex shrink-0 items-center gap-2.5 border-b px-4 py-2 text-[11px] ${
        esError
          ? "border-danger/25 bg-danger/[.06] text-danger-fg"
          : retirada
          ? "border-warning/25 bg-warning/[.06] text-warning-fg"
          : "border-draw/25 bg-draw/[.06] text-draw-fg"
      }`}
      style={{ animation: "jg-fade-rise .5s cubic-bezier(.16,1,.3,1) both" }}
    >
      <Icon name={esError ? "alert" : retirada ? "alert" : "refresh"} size={13} />
      {esError ? (
        <span className="flex-1 truncate">
          <b className="font-medium text-fg">No se pudo actualizar.</b> {estado.motivo}
        </span>
      ) : retirada ? (
        <span className="flex-1 truncate">
          <b className="font-medium text-fg">Tu versión fue retirada.</b> Actualiza en cuanto puedas.
        </span>
      ) : (
        <span className="flex flex-1 items-baseline gap-2 truncate">
          Versión <b className="font-mono font-medium tabular-nums text-fg">{estado.version}</b> disponible
          <span className="truncate text-subtle">— {estado.notas}</span>
        </span>
      )}
      {!esError && !retirada && estado.url && (
        <button
          onClick={() => void abrirDescarga(estado.url)}
          className="shrink-0 rounded-[6px] border border-border px-2.5 py-1 font-medium text-fg
            transition-colors duration-150 hover:bg-border"
        >
          Ver y descargar
        </button>
      )}
      <button
        onClick={onCerrar}
        aria-label="Cerrar aviso de actualización"
        className="grid h-[26px] w-[26px] shrink-0 place-items-center rounded-[6px] text-subtle
          transition-colors duration-150 hover:bg-border hover:text-fg"
      >
        <Icon name="x" size={13} />
      </button>
    </div>
  );
}
```

- [ ] **Step 8: Disparar la actualización silenciosa y comprobar el error pendiente en
  `client/src/App.tsx`**

Busca el `useEffect` existente (línea ~52):
```tsx
useEffect(() => {
    comprobarActualizacion().then(setActualizacion).catch(() => setActualizacion(null));
  }, []);
```
Cámbialo por:
```tsx
useEffect(() => {
    errorActualizacionPendiente().then((motivo) => {
      if (motivo) setActualizacion({ tipo: "error", motivo });
    });
    comprobarActualizacion().then((estado) => {
      if (estado?.tipo === "disponible") {
        void dispararActualizacionSilenciosa(estado.version);
        return; // la app va a cerrarse; no hace falta pintar nada más
      }
      setActualizacion(estado);
    }).catch(() => setActualizacion(null));
  }, []);
```
Y añade al import existente de `"./lib/actualizaciones"` (línea 18) las dos funciones nuevas:
```tsx
import { comprobarActualizacion, dispararActualizacionSilenciosa, errorActualizacionPendiente, type EstadoActualizacion } from "./lib/actualizaciones";
```

- [ ] **Step 9: Compilar el frontend**

```bash
cd "E:/Lumi Station/client" && npx tsc -b --noEmit
```
Expected: sin errores de tipos.

- [ ] **Step 10: Commit**

```bash
cd "E:/Lumi Station" && git add client && git commit -m "feat: cliente se autoactualiza en silencio y avisa si falla"
```

---

### Task 10: Indexer — mismo cableado que el cliente

**Files:**
- Modify: `indexer/src-tauri/src/actualizacion.rs`
- Modify: `indexer/src-tauri/src/main.rs` (registrar los comandos nuevos)
- Modify: `indexer/src-tauri/Cargo.toml`
- Modify: `indexer/src/lib/actualizaciones.ts` (o la ruta equivalente — comprueba con
  `find indexer/src -iname "actualizacion*"`)
- Modify: `indexer/src/ui/ActualizacionBanner.tsx`
- Modify: el `App.tsx`/equivalente del Indexer donde se llama a `comprobarActualizacion` hoy
  (busca con `grep -rn "comprobarActualizacion\|comprobar_actualizacion" indexer/src`)

Mismo patrón exacto que el Task 9, con dos diferencias: `Producto::Indexer` en vez de
`Producto::Cliente`, y `--producto=indexer` en el comando lanzado. Repite cada Step del Task 9
adaptando esos dos valores y las rutas de archivo del Indexer.

- [ ] **Step 1: Añadir la variante `Error` al `EstadoActualizacion` de
  `indexer/src-tauri/src/actualizacion.rs`**

```rust
#[derive(serde::Serialize)]
#[serde(tag = "tipo", rename_all = "lowercase")]
pub enum EstadoActualizacion {
    Disponible { version: String, notas: String, url: String },
    Retirada,
    Error { motivo: String },
}
```

- [ ] **Step 2: Añadir las dos funciones nuevas al final de `indexer/src-tauri/src/actualizacion.rs`**

```rust
pub fn error_pendiente() -> Option<String> {
    lumi_installer::bitacora::leer_y_borrar_marca_error("indexer").map(|e| e.motivo)
}

pub fn disparar_silenciosa(app: tauri::AppHandle, version_nueva: String) -> Result<(), String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let carpeta = exe.parent().ok_or("sin carpeta padre")?;
    let instalador = carpeta.join("instalador-cli.exe");
    let pid = std::process::id();
    let version_actual = env!("CARGO_PKG_VERSION");

    std::process::Command::new(instalador)
        .arg("--producto=indexer")
        .arg(format!("--pid={pid}"))
        .arg(format!("--version-actual={version_actual}"))
        .arg("--silencioso")
        .spawn()
        .map_err(|e| e.to_string())?;

    let _ = version_nueva;
    app.exit(0);
    Ok(())
}
```

- [ ] **Step 3: Añadir los comandos Tauri correspondientes en `indexer/src-tauri/src/main.rs`**

Busca dónde está registrado el comando `comprobar_actualizacion` existente (probablemente
envuelve a `actualizacion::comprobar()`). Justo al lado, añade:

```rust
#[tauri::command]
fn error_actualizacion_pendiente() -> Option<String> {
    actualizacion::error_pendiente()
}

#[tauri::command]
fn disparar_actualizacion_silenciosa(app: tauri::AppHandle, version_nueva: String) -> Result<(), String> {
    actualizacion::disparar_silenciosa(app, version_nueva)
}
```
Y añade `error_actualizacion_pendiente, disparar_actualizacion_silenciosa` a la lista de
`tauri::generate_handler![...]` existente, igual que en el Task 9 Step 4.

- [ ] **Step 4: Añadir `lumi-installer` a `indexer/src-tauri/Cargo.toml`**

```toml
lumi-installer = { path = "../../crates/lumi-installer" }
```

- [ ] **Step 5: Compilar el backend**

```bash
cd "E:/Lumi Station" && cargo build -p app --manifest-path indexer/src-tauri/Cargo.toml
```
Expected: compila sin error. (El nombre del paquete puede no ser `app` — comprueba
`indexer/src-tauri/Cargo.toml:2` y usa el que corresponda.)

- [ ] **Step 6: Repetir los Steps 6, 7 y 8 del Task 9 en el lado TS del Indexer**

Mismo contenido de `actualizaciones.ts` y `ActualizacionBanner.tsx` que el Task 9 (cámbialos
tal cual, son idénticos), y el mismo cambio de `useEffect` en el punto donde el Indexer llama
hoy a `comprobarActualizacion` (encuéntralo con el `grep` de arriba).

- [ ] **Step 7: Compilar el frontend**

```bash
cd "E:/Lumi Station/indexer" && npx tsc -b --noEmit
```
Expected: sin errores de tipos.

- [ ] **Step 8: Commit**

```bash
cd "E:/Lumi Station" && git add indexer && git commit -m "feat: Indexer se autoactualiza en silencio y avisa si falla"
```

---

### Task 11: `tools/build.py`, limpieza de Inno/NSIS, verificación final

**Files:**
- Modify: `tools/build.py`
- Delete: `client/installer/lumi.iss`, `indexer/installer/lumi-indexer.iss`,
  `tools/installer/lumi_panel.iss`, `indexer/installer/lumi-indexer.nsi`,
  `tools/installer/lumi_panel.nsh`

- [ ] **Step 1: Reescribir el target `installer` de `tools/build.py`**

Lee `tools/build.py` completo primero. Sustituye la función `find_iscc` y la rama
`if target == "installer":` por:

```python
def main():
    target = sys.argv[1] if len(sys.argv) > 1 else "dev"
    if target == "build":
        run(["cargo", "build", "--release"])
        run([NPM, "run", "tauri", "build"], cwd=ROOT / "client")
        run([NPM, "run", "tauri", "build"], cwd=ROOT / "indexer")
        return
    if target == "installer":
        # El instalador compartido reemplaza Inno/NSIS (ver
        # docs/superpowers/specs/2026-08-26-instalador-compartido-design.md):
        # instalador.exe (Tauri) + instalador-cli.exe (sin ventana, lo usan
        # cliente/Indexer para autoactualizarse) se compilan y se dejan
        # junto a cada producto para que ya estén ahí cuando el producto
        # los necesite.
        run(["cargo", "build", "--release", "-p", "instalador-cli"])
        run([NPM, "run", "tauri", "build"], cwd=ROOT / "installer")
        return
```
(deja el resto de `main()` — las ramas `indexer` y la de por defecto — tal cual estaban).

Y elimina por completo la función `find_iscc` (ya no se usa).

- [ ] **Step 2: Actualizar el docstring del módulo**

Cambia la línea:
```python
  python tools/build.py installer  instalador Inno de cliente + Indexer (Windows)
```
por:
```python
  python tools/build.py installer  instalador compartido (Tauri) de cliente + Indexer (Windows)
```

- [ ] **Step 3: Borrar los archivos de Inno Setup y NSIS de esta sesión**

```bash
cd "E:/Lumi Station"
git rm client/installer/lumi.iss indexer/installer/lumi-indexer.iss tools/installer/lumi_panel.iss
git rm indexer/installer/lumi-indexer.nsi tools/installer/lumi_panel.nsh
```

- [ ] **Step 4: Verificación final — workspace completo**

```bash
cd "E:/Lumi Station" && cargo build --release && cargo test -p lumi-proto && cargo test -p lumi-installer -- --test-threads=1
```
Expected: todo compila, `cargo test -p lumi-proto` sigue en verde (sin tocar), y
`cargo test -p lumi-installer` da `12 passed`.

- [ ] **Step 5: Commit**

```bash
cd "E:/Lumi Station" && git add tools/build.py && git commit -m "chore: build.py compila el instalador compartido, retira Inno/NSIS"
```

- [ ] **Step 6: Reporte final**

Deja un resumen corto (en la respuesta al usuario, no en un archivo) de: qué tasks se
completaron, cuántos commits se crearon, y si algún Step no salió exactamente como se
describía aquí (ruta de archivo distinta en la plantilla clonada, nombre de paquete distinto,
etc.) — para que quien revise sepa dónde mirar primero.
