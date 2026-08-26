# Canal de actualizaciones — 1. Manifiesto firmado + API en Vercel

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un manifiesto de versiones firmado con Ed25519 (`web/releases/versiones.json`), la lógica compartida en `lumi-proto` que lo firma/verifica/compara versiones, la herramienta de línea de comandos para publicarlo, y el endpoint en Vercel que lo sirve.

**Architecture:** `lumi-proto::actualizacion` define el formato y la cadena de confianza (clave pública compilada → firma del documento → `sha256` de cada artefacto). `lumi-cli` gana un subcomando que genera la clave de firma y firma un borrador, reutilizando el mismo código de serialización que luego verifica — así la canonicalización nunca diverge entre firmar y comprobar. `web/` es un proyecto Next.js App Router mínimo cuyo único endpoint real, `/api/versiones`, importa el JSON firmado y lo devuelve tal cual.

**Tech Stack:** Rust (`ed25519-dalek` 2, `base64` 0.22, ya en el workspace), Next.js App Router + TypeScript, Python 3 (`tools/release.py`).

## Global Constraints

- Firma Ed25519 sobre el documento completo con `firma` en cadena vacía — el mismo truco que `Ficha::canonico()` en `crates/lumi-index/src/ficha.rs:92`. Un solo idioma de firma en el proyecto.
- La clave privada de firma **nunca** se commitea ni se sube a Vercel. Vive en `~/.lumi/release.key` (o `%USERPROFILE%\.lumi\release.key` en Windows), generada una vez, fuera de git.
- `Manifiesto::comprobar()` verifica siempre contra la constante `CLAVE_PUBLICA` compilada — nunca contra el campo `clave_publica` del propio documento, o cualquiera podría firmar con su clave y pasar la comprobación.
- Comparación de versiones: `(u32, u32, u32)`, sin sufijos de pre-release. No hay canal beta todavía — no se construye ese soporte por adelantado.
- `GET /api/versiones` no filtra ni acepta parámetros: sirve el documento firmado completo, para que la firma cubra exactamente lo que se entrega.
- No tests salvo en `lumi-proto` (excepción ya establecida en `PROJECT-CONVENTIONS.md`) — ahí sí, porque es lógica no trivial (firma, comparación de versiones).
- Español para prosa/comentarios/UI; el código (identificadores) sigue el idioma ya usado en cada archivo (español en `lumi-proto`/`lumi-cli`, TypeScript también en español donde el archivo ya lo está).

---

### Task 1: `lumi-proto::actualizacion` — tipos, firma, comparación

**Files:**
- Modify: `crates/lumi-proto/Cargo.toml`
- Create: `crates/lumi-proto/src/actualizacion.rs`
- Modify: `crates/lumi-proto/src/lib.rs`

**Interfaces:**
- Produces: `lumi_proto::actualizacion::{Manifiesto, Publicacion, Artefacto, Producto, ActualizacionError, CLAVE_PUBLICA}`, con `Manifiesto::firmar(&mut self, &ed25519_dalek::SigningKey)`, `Manifiesto::comprobar(&self) -> Result<(), ActualizacionError>`, `Manifiesto::mas_nueva(&self, Producto, &str, &str) -> Option<&Publicacion>`, `Manifiesto::version_retirada(&self, Producto, &str) -> bool`. Usado por Task 2 (lumi-cli), y por los Planes 2 y 3 (cliente, Indexer, `lumid`).

- [ ] **Step 1: Declarar las dependencias que faltan**

`lumi-proto` no depende hoy de `ed25519-dalek` ni `base64` (sí `lumi-index`, que ya firma con el mismo esquema). Ambas ya están fijadas en el `Cargo.toml` del workspace.

Edita `crates/lumi-proto/Cargo.toml`:

```toml
[dependencies]
serde.workspace = true
serde_json.workspace = true
thiserror.workspace = true
sha2.workspace = true
bs58.workspace = true
rand.workspace = true
argon2.workspace = true
chacha20poly1305.workspace = true
base64.workspace = true
ed25519-dalek.workspace = true
```

- [ ] **Step 2: Escribir el módulo**

Crea `crates/lumi-proto/src/actualizacion.rs`:

```rust
//! Manifiesto de versiones firmado: lo que los tres binarios (cliente, lumid,
//! Indexer) comparan contra lo que tienen instalado.
//!
//! Firma Ed25519, mismo esquema que `Ficha` en `lumi-index` — un solo
//! idioma de firma en el proyecto, no dos. La cadena de confianza es
//! deliberada: la clave pública va compilada en el binario, firma el
//! manifiesto entero, y el manifiesto contiene el `sha256` de cada
//! artefacto. Ni quien aloja la lista (Vercel) ni quien aloja los bytes
//! (GitHub Releases) son de confianza — solo pueden servir algo viejo,
//! nunca algo falso.

use base64::{engine::general_purpose::STANDARD, Engine};
use ed25519_dalek::{Signature, Signer, SigningKey, Verifier, VerifyingKey};
use serde::{Deserialize, Serialize};

/// Generada una vez con `lumi actualizaciones generar-clave` (crates/lumi-cli)
/// y pegada aquí a mano — ver Task 2 de este plan.
///
/// Placeholder hasta que exista una clave real: con todo-ceros, cualquier
/// firma real falla `VerifyingKey::from_bytes` o `verify`, así que el techo
/// (comprobar() siempre False) es seguro por defecto, no silenciosamente
/// permisivo.
///
/// Rotarla exige una versión puente que sepa validar con la vieja y la
/// nueva a la vez — no está resuelto, es el techo que anota la spec
/// (docs/superpowers/specs/2026-08-26-canal-de-actualizaciones-design.md).
pub const CLAVE_PUBLICA: [u8; 32] = [0u8; 32];

#[derive(Debug, thiserror::Error, PartialEq)]
pub enum ActualizacionError {
    #[error("el manifiesto no está firmado")]
    SinFirmar,
    #[error("la firma no corresponde a este manifiesto")]
    FirmaInvalida,
    #[error("codificación inválida: {0}")]
    Codificacion(String),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Producto {
    Cliente,
    Lumid,
    Indexer,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Artefacto {
    pub plataforma: String,
    pub url: String,
    pub bytes: u64,
    pub sha256: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Publicacion {
    pub producto: Producto,
    pub version: String,
    pub publicado: String,
    pub notas: String,
    pub retirada: bool,
    pub artefactos: Vec<Artefacto>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Manifiesto {
    pub version: u32,
    /// Informativo, no la fuente de verdad — `comprobar()` nunca compara
    /// contra este campo, siempre contra `CLAVE_PUBLICA`.
    #[serde(default)]
    pub clave_publica: String,
    pub publicaciones: Vec<Publicacion>,
    #[serde(default)]
    pub firma: String,
}

impl Manifiesto {
    /// Lo que se firma: el documento con `firma` en cadena vacía. Mismo
    /// truco que `Ficha::canonico()` en `lumi-index`: serializar con la
    /// firma vacía en vez de borrar el campo, para que el formato no
    /// dependa del orden en que serde escriba las claves.
    pub fn canonico(&self) -> Vec<u8> {
        let mut sin = self.clone();
        sin.firma = String::new();
        serde_json::to_vec(&sin).unwrap_or_default()
    }

    pub fn firmar(&mut self, secreta: &SigningKey) {
        self.clave_publica = STANDARD.encode(secreta.verifying_key().to_bytes());
        self.firma = STANDARD.encode(secreta.sign(&self.canonico()).to_bytes());
    }

    /// Verifica contra `CLAVE_PUBLICA` — la única clave de confianza.
    pub fn comprobar(&self) -> Result<(), ActualizacionError> {
        self.verificar_contra(&CLAVE_PUBLICA)
    }

    fn verificar_contra(&self, pk_bytes: &[u8; 32]) -> Result<(), ActualizacionError> {
        if self.firma.is_empty() {
            return Err(ActualizacionError::SinFirmar);
        }
        let sig_bytes: [u8; 64] = STANDARD
            .decode(&self.firma)
            .map_err(|e| ActualizacionError::Codificacion(e.to_string()))?
            .try_into()
            .map_err(|_| ActualizacionError::FirmaInvalida)?;
        let sig = Signature::from_bytes(&sig_bytes);
        let pk = VerifyingKey::from_bytes(pk_bytes)
            .map_err(|e| ActualizacionError::Codificacion(e.to_string()))?;
        pk.verify(&self.canonico(), &sig)
            .map_err(|_| ActualizacionError::FirmaInvalida)
    }

    /// La publicación de `producto` para `plataforma` que sea más nueva que
    /// `version_actual` y no esté retirada. `None` si no hay nada que
    /// ofrecer, sea porque no existe o porque la única candidata está
    /// retirada — para ese caso concreto usa `version_retirada`.
    pub fn mas_nueva(&self, producto: Producto, version_actual: &str, plataforma: &str) -> Option<&Publicacion> {
        self.publicaciones
            .iter()
            .filter(|p| p.producto == producto && !p.retirada)
            .filter(|p| p.artefactos.iter().any(|a| a.plataforma == plataforma))
            .filter(|p| es_mas_nueva(&p.version, version_actual))
            .max_by(|a, b| comparar(&a.version, &b.version))
    }

    /// `true` si la versión instalada aparece en el manifiesto marcada como
    /// retirada. Independiente de que haya o no una más nueva que ofrecer.
    pub fn version_retirada(&self, producto: Producto, version_actual: &str) -> bool {
        self.publicaciones
            .iter()
            .any(|p| p.producto == producto && p.retirada && p.version == version_actual)
    }
}

/// Parseo a tupla de tres enteros. Ponytail: no hay sufijo de pre-release
/// (`-rc1`) — el día que exista un canal beta que lo necesite, se añade
/// entonces, no antes.
fn partes(v: &str) -> (u32, u32, u32) {
    let mut it = v.trim().splitn(3, '.').map(|p| p.parse::<u32>().unwrap_or(0));
    (it.next().unwrap_or(0), it.next().unwrap_or(0), it.next().unwrap_or(0))
}

fn comparar(a: &str, b: &str) -> std::cmp::Ordering {
    partes(a).cmp(&partes(b))
}

fn es_mas_nueva(candidata: &str, actual: &str) -> bool {
    comparar(candidata, actual) == std::cmp::Ordering::Greater
}

#[cfg(test)]
mod tests {
    use super::*;

    fn clave_prueba() -> SigningKey {
        SigningKey::from_bytes(&[7u8; 32])
    }

    fn manifiesto_de_prueba() -> Manifiesto {
        Manifiesto {
            version: 1,
            clave_publica: String::new(),
            publicaciones: vec![Publicacion {
                producto: Producto::Lumid,
                version: "2.1.0".into(),
                publicado: "2026-08-26T10:00:00Z".into(),
                notas: "cola: reintento acotado".into(),
                retirada: false,
                artefactos: vec![Artefacto {
                    plataforma: "linux-x86_64".into(),
                    url: "https://example.invalid/lumid".into(),
                    bytes: 100,
                    sha256: "abc".into(),
                }],
            }],
            firma: String::new(),
        }
    }

    #[test]
    fn firma_valida_pasa_contra_su_propia_clave() {
        let k = clave_prueba();
        let mut m = manifiesto_de_prueba();
        m.firmar(&k);
        assert!(m.verificar_contra(&k.verifying_key().to_bytes()).is_ok());
    }

    #[test]
    fn firma_no_pasa_contra_otra_clave() {
        let k = clave_prueba();
        let otra = SigningKey::from_bytes(&[9u8; 32]);
        let mut m = manifiesto_de_prueba();
        m.firmar(&k);
        assert_eq!(
            m.verificar_contra(&otra.verifying_key().to_bytes()),
            Err(ActualizacionError::FirmaInvalida)
        );
    }

    #[test]
    fn manifiesto_manipulado_tras_firmar_no_pasa() {
        let k = clave_prueba();
        let mut m = manifiesto_de_prueba();
        m.firmar(&k);
        m.publicaciones[0].version = "9.9.9".into();
        assert_eq!(
            m.verificar_contra(&k.verifying_key().to_bytes()),
            Err(ActualizacionError::FirmaInvalida)
        );
    }

    #[test]
    fn sin_firma_falla_con_su_propio_error() {
        let m = manifiesto_de_prueba();
        assert_eq!(m.verificar_contra(&[0u8; 32]), Err(ActualizacionError::SinFirmar));
    }

    #[test]
    fn mas_nueva_ignora_version_igual_o_menor() {
        let m = manifiesto_de_prueba();
        assert!(m.mas_nueva(Producto::Lumid, "2.1.0", "linux-x86_64").is_none());
        assert!(m.mas_nueva(Producto::Lumid, "2.2.0", "linux-x86_64").is_none());
        assert!(m.mas_nueva(Producto::Lumid, "2.0.0", "linux-x86_64").is_some());
    }

    #[test]
    fn mas_nueva_ignora_retirada() {
        let mut m = manifiesto_de_prueba();
        m.publicaciones[0].retirada = true;
        assert!(m.mas_nueva(Producto::Lumid, "2.0.0", "linux-x86_64").is_none());
    }

    #[test]
    fn mas_nueva_ignora_plataforma_sin_artefacto() {
        let m = manifiesto_de_prueba();
        assert!(m.mas_nueva(Producto::Lumid, "2.0.0", "windows-x86_64").is_none());
    }

    #[test]
    fn mas_nueva_ignora_otro_producto() {
        let m = manifiesto_de_prueba();
        assert!(m.mas_nueva(Producto::Cliente, "2.0.0", "linux-x86_64").is_none());
    }

    #[test]
    fn version_retirada_detecta_la_propia_y_solo_esa() {
        let mut m = manifiesto_de_prueba();
        m.publicaciones[0].retirada = true;
        assert!(m.version_retirada(Producto::Lumid, "2.1.0"));
        assert!(!m.version_retirada(Producto::Lumid, "9.9.9"));
        assert!(!m.version_retirada(Producto::Cliente, "2.1.0"));
    }
}
```

- [ ] **Step 3: Registrar el módulo**

Edita `crates/lumi-proto/src/lib.rs`:

```rust
pub mod actualizacion;
pub mod api;
pub mod caps;
pub mod crypto;
pub mod key;
pub mod worker;

/// Puerto fijo del daemon. No configurable: convención del proyecto.
pub const PORT: u16 = 7717;
```

- [ ] **Step 4: Ejecutar los tests**

```bash
cargo test -p lumi-proto actualizacion
```

Expected: 9 tests pasan (`firma_valida_pasa_contra_su_propia_clave`, `firma_no_pasa_contra_otra_clave`, `manifiesto_manipulado_tras_firmar_no_pasa`, `sin_firma_falla_con_su_propio_error`, `mas_nueva_ignora_version_igual_o_menor`, `mas_nueva_ignora_retirada`, `mas_nueva_ignora_plataforma_sin_artefacto`, `mas_nueva_ignora_otro_producto`, `version_retirada_detecta_la_propia_y_solo_esa`).

- [ ] **Step 5: Compilar el workspace entero**

```bash
cargo check
```

Expected: compila sin errores (confirma que ningún otro crate del workspace se rompe al añadir el módulo).

- [ ] **Step 6: Commit**

```bash
git add crates/lumi-proto/Cargo.toml crates/lumi-proto/src/actualizacion.rs crates/lumi-proto/src/lib.rs
git commit -m "feat: manifiesto de versiones firmado en lumi-proto"
```

---

### Task 2: Generar la clave de firma y el comando para publicar

**Files:**
- Modify: `crates/lumi-cli/Cargo.toml`
- Create: `crates/lumi-cli/src/firmar.rs`
- Modify: `crates/lumi-cli/src/main.rs`
- Modify: `crates/lumi-proto/src/actualizacion.rs` (pegar la clave pública real, al final del Step 3 de abajo)

**Interfaces:**
- Consumes: `lumi_proto::actualizacion::{Manifiesto, ActualizacionError}` (Task 1).
- Produces: comando `lumi actualizaciones generar-clave` y `lumi actualizaciones firmar <borrador> <salida>`. Task 4 (tools/release.py) y el Plan de publicación real dependen de este comando.

- [ ] **Step 1: Declarar dependencias**

Edita `crates/lumi-cli/Cargo.toml`, añade a `[dependencies]`:

```toml
ed25519-dalek.workspace = true
base64.workspace = true
```

- [ ] **Step 2: Escribir el módulo**

Crea `crates/lumi-cli/src/firmar.rs`:

```rust
//! Generar y usar la clave que firma el manifiesto de versiones
//! (`web/releases/versiones.json`). La clave privada no sale nunca de la
//! máquina de quien publica: no se sube a Vercel ni se commitea al repo.

use anyhow::{anyhow, Context, Result};
use ed25519_dalek::SigningKey;
use lumi_proto::actualizacion::Manifiesto;
use std::path::{Path, PathBuf};

fn home_dir() -> PathBuf {
    std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .map(PathBuf::from)
        .expect("no se pudo determinar el directorio personal (falta HOME/USERPROFILE)")
}

fn ruta_clave() -> PathBuf {
    home_dir().join(".lumi").join("release.key")
}

pub fn generar_clave() -> Result<()> {
    let ruta = ruta_clave();
    if ruta.exists() {
        return Err(anyhow!(
            "ya existe una clave en {}; bórrala a mano si de verdad quieres una nueva \
             (rotar invalida todo lo firmado con la anterior — ver el techo anotado en \
             CLAVE_PUBLICA, crates/lumi-proto/src/actualizacion.rs)",
            ruta.display()
        ));
    }
    std::fs::create_dir_all(ruta.parent().unwrap())?;
    let secreta = SigningKey::generate(&mut rand::rngs::OsRng);
    std::fs::write(&ruta, secreta.to_bytes())
        .with_context(|| format!("no se pudo escribir {}", ruta.display()))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&ruta, std::fs::Permissions::from_mode(0o600))?;
    }
    let publica = secreta.verifying_key();
    println!("clave privada escrita en {}", ruta.display());
    println!();
    println!("pega esto en crates/lumi-proto/src/actualizacion.rs, reemplazando CLAVE_PUBLICA:");
    println!();
    print!("pub const CLAVE_PUBLICA: [u8; 32] = [");
    for (i, b) in publica.to_bytes().iter().enumerate() {
        if i > 0 {
            print!(", ");
        }
        print!("{b}");
    }
    println!("];");
    Ok(())
}

fn cargar_clave() -> Result<SigningKey> {
    let ruta = ruta_clave();
    let bytes = std::fs::read(&ruta).with_context(|| {
        format!(
            "no se pudo leer {} — ejecuta antes 'lumi actualizaciones generar-clave'",
            ruta.display()
        )
    })?;
    let arr: [u8; 32] = bytes
        .try_into()
        .map_err(|_| anyhow!("la clave en {} no mide 32 bytes", ruta.display()))?;
    Ok(SigningKey::from_bytes(&arr))
}

pub fn firmar(borrador: &Path, salida: &Path) -> Result<()> {
    let texto = std::fs::read_to_string(borrador)
        .with_context(|| format!("no se pudo leer {}", borrador.display()))?;
    let mut manifiesto: Manifiesto = serde_json::from_str(&texto)
        .with_context(|| format!("{} no es un borrador de manifiesto válido", borrador.display()))?;
    let secreta = cargar_clave()?;
    manifiesto.firmar(&secreta);
    let salida_texto = serde_json::to_string_pretty(&manifiesto)?;
    std::fs::write(salida, salida_texto)
        .with_context(|| format!("no se pudo escribir {}", salida.display()))?;
    println!(
        "firmado: {} ({} publicaciones)",
        salida.display(),
        manifiesto.publicaciones.len()
    );
    Ok(())
}
```

- [ ] **Step 3: Registrar el módulo y el subcomando**

Edita `crates/lumi-cli/src/main.rs`. Añade `mod firmar;` junto a los módulos existentes:

```rust
mod admin;
mod detect;
mod firmar;
mod install;
mod ui;
```

Añade `use std::path::PathBuf;` a los imports de cabecera si no está ya.

Añade una rama al `enum Cmd` (junto a `Admin`):

```rust
    /// Escotilla de emergencia sobre cuentas, desde el host
    Admin {
        #[command(subcommand)]
        action: AdminAction,
    },
    /// Firma del manifiesto de versiones (web/releases/versiones.json)
    Actualizaciones {
        #[command(subcommand)]
        action: ActualizacionAction,
    },
```

Añade el nuevo enum de subcomandos, junto a `AdminAction`:

```rust
#[derive(Subcommand)]
enum ActualizacionAction {
    /// Genera la clave Ed25519 que firma releases y la guarda en ~/.lumi/release.key
    GenerarClave,
    /// Firma un borrador de manifiesto y escribe el resultado firmado
    Firmar { borrador: PathBuf, salida: PathBuf },
}
```

Añade la rama de despacho en `fn main()`, junto a las demás ramas de `match Cli::parse().cmd`:

```rust
        Cmd::Actualizaciones { action } => match action {
            ActualizacionAction::GenerarClave => firmar::generar_clave()?,
            ActualizacionAction::Firmar { borrador, salida } => firmar::firmar(&borrador, &salida)?,
        },
```

- [ ] **Step 4: Compilar**

```bash
cargo check -p lumi-cli
```

Expected: compila sin errores.

- [ ] **Step 5: Generar la clave real**

```bash
cargo run -p lumi-cli -- actualizaciones generar-clave
```

Expected: imprime la ruta donde escribió `release.key` y una línea `pub const CLAVE_PUBLICA: [u8; 32] = [...];` con 32 números.

**Copia esa línea** y sustituye la constante placeholder en `crates/lumi-proto/src/actualizacion.rs` (la que hoy dice `[0u8; 32]`).

- [ ] **Step 6: Confirmar que los tests siguen pasando con la clave real**

Los tests de Task 1 firman y verifican con una clave de prueba propia (`verificar_contra`, no `comprobar`), así que no dependen de `CLAVE_PUBLICA` — deben seguir en verde exactamente igual:

```bash
cargo test -p lumi-proto actualizacion
```

Expected: los mismos 9 tests, en verde.

- [ ] **Step 7: Commit**

`~/.lumi/release.key` está fuera del repo (no hay nada que añadir de ahí). Confirma que no aparece en `git status`:

```bash
git status --porcelain | grep -i release.key
```

Expected: sin salida.

```bash
git add crates/lumi-cli/Cargo.toml crates/lumi-cli/src/firmar.rs crates/lumi-cli/src/main.rs crates/lumi-proto/src/actualizacion.rs
git commit -m "feat: comando lumi actualizaciones (generar-clave, firmar)"
```

---

### Task 3: `web/` — proyecto Next.js y el primer manifiesto firmado

**Files:**
- Create: `web/package.json`
- Create: `web/tsconfig.json`
- Create: `web/next.config.mjs`
- Create: `web/.gitignore`
- Create: `web/app/layout.tsx`
- Create: `web/app/page.tsx`
- Create: `web/app/api/versiones/route.ts`
- Create: `web/releases/borrador.json`
- Create: `web/releases/versiones.json` (generado por `lumi actualizaciones firmar`, no a mano)

**Interfaces:**
- Consumes: `lumi actualizaciones firmar` (Task 2).
- Produces: `web/releases/versiones.json`, el fichero que Plan 2 y Plan 3 consumirán vía `GET /api/versiones` una vez desplegado. `web/releases/borrador.json` es el formato de entrada que Task 4 (`tools/release.py`) también deberá producir.

- [ ] **Step 1: `package.json`**

Crea `web/package.json`:

```json
{
  "name": "lumi-web",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start"
  },
  "dependencies": {
    "next": "^15.0.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "typescript": "^5",
    "@types/node": "^22",
    "@types/react": "^19"
  }
}
```

- [ ] **Step 2: Configuración mínima**

Crea `web/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2017",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": false,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

Crea `web/next.config.mjs`:

```js
/** @type {import('next').NextConfig} */
const nextConfig = {};

export default nextConfig;
```

Crea `web/.gitignore`:

```
node_modules
.next
*.local
```

- [ ] **Step 3: Layout y página raíz**

Crea `web/app/layout.tsx`:

```tsx
export const metadata = { title: "Lumi" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
```

Crea `web/app/page.tsx`:

```tsx
export default function Home() {
  return (
    <main>
      <p>Lumi — la web del subsistema 9 todavía no existe. Esta app hoy solo
        sirve el canal de actualizaciones en <code>/api/versiones</code>.</p>
    </main>
  );
}
```

- [ ] **Step 4: El endpoint**

Crea `web/app/api/versiones/route.ts`:

```ts
import { NextResponse } from "next/server";
import manifiesto from "../../../releases/versiones.json";

/// Sin filtrar, sin parámetros: se sirve el documento firmado completo.
/// En cuanto el servidor recortara la respuesta, la firma dejaría de cubrir
/// exactamente lo que se entrega — ver la spec, sección "La API en Vercel".
export async function GET() {
  return NextResponse.json(manifiesto, {
    headers: {
      "cache-control": "public, max-age=300, s-maxage=300",
      "access-control-allow-origin": "*",
    },
  });
}
```

- [ ] **Step 5: El primer borrador y el primer manifiesto firmado**

Crea `web/releases/borrador.json` (vacío: todavía no hay ninguna versión publicada, solo se prueba que la cadena firma/verifica funciona de punta a punta):

```json
{
  "version": 1,
  "publicaciones": []
}
```

Fírmalo con el comando de Task 2:

```bash
cargo run -p lumi-cli -- actualizaciones firmar web/releases/borrador.json web/releases/versiones.json
```

Expected: imprime `firmado: web/releases/versiones.json (0 publicaciones)`.

- [ ] **Step 6: Instalar dependencias y comprobar el build**

```bash
cd web && npm install && npm run build
```

Expected: build de Next.js sin errores. (No hace falta desplegar a Vercel para este plan — el despliegue real es responsabilidad del owner, fuera del alcance de un agente; documentado en el README de abajo.)

- [ ] **Step 7: Verificar el endpoint en local**

```bash
cd web && npm run dev &
sleep 3
curl -s http://localhost:3000/api/versiones | head -c 400
kill %1
```

Expected: JSON con `"version": 1`, `"publicaciones": []`, y un campo `"firma"` no vacío.

- [ ] **Step 8: README mínimo para el despliegue**

Crea `web/README.md`:

```markdown
# Lumi — web

Hoy solo sirve el canal de actualizaciones (`GET /api/versiones`), leído de
`releases/versiones.json`. Es la semilla del subsistema 9 (ver FUTURO.md).

## Publicar una versión nueva

No se edita `versiones.json` a mano. Se firma con la clave de quien
publica (nunca en este repo, nunca en Vercel):

    cargo run -p lumi-cli -- actualizaciones firmar releases/borrador.json releases/versiones.json

O, con los artefactos ya subidos a GitHub Releases, usando el borrador que
`tools/release.py` (en la raíz del monorepo) resuelve por ti.

## Desplegar

Proyecto Vercel apuntando a este directorio (`web/`) dentro del monorepo.
Sin variables de entorno: el manifiesto vive commiteado en el propio repo.
```

- [ ] **Step 9: Commit**

```bash
git add web/
git commit -m "feat: proyecto web en Vercel con el endpoint de versiones"
```

---

### Task 4: `tools/release.py` — publicar sin editar el manifiesto a mano

**Files:**
- Create: `tools/release.py`

**Interfaces:**
- Consumes: `lumi actualizaciones firmar` (Task 2), formato de `web/releases/borrador.json` (Task 3).
- Produces: `web/releases/versiones.json` actualizado. Es el punto de entrada real de publicación para cualquier trabajo futuro que añada versiones de verdad.

- [ ] **Step 1: Escribir el script**

Crea `tools/release.py`:

```python
#!/usr/bin/env python3
"""Publica una version en el canal de actualizaciones.

  python tools/release.py <borrador.json>

El borrador tiene el mismo formato que espera `lumi actualizaciones firmar`,
salvo que cada artefacto puede traer "archivo" (una ruta local) en vez de
"sha256"+"bytes" — este script calcula esos dos campos y los completa antes
de firmar. El calculo de sha256 vive aqui porque es trabajo mecanico; firmar
vive en Rust (`lumi-cli`) porque tiene que usar el mismo codigo de
serializacion que luego verifica, o la canonicalizacion podria divergir
entre Python y Rust.
"""
import hashlib
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SALIDA = ROOT / "web" / "releases" / "versiones.json"


def sha256_de(ruta):
    h = hashlib.sha256()
    with open(ruta, "rb") as f:
        for trozo in iter(lambda: f.read(1 << 20), b""):
            h.update(trozo)
    return h.hexdigest()


def resolver_artefactos(borrador):
    for publicacion in borrador["publicaciones"]:
        for artefacto in publicacion["artefactos"]:
            archivo = artefacto.pop("archivo", None)
            if archivo:
                ruta = Path(archivo)
                artefacto["bytes"] = ruta.stat().st_size
                artefacto["sha256"] = sha256_de(ruta)
    return borrador


def main():
    if len(sys.argv) != 2:
        print(f"uso: {sys.argv[0]} <borrador.json>", file=sys.stderr)
        sys.exit(1)

    borrador_path = Path(sys.argv[1])
    borrador = json.loads(borrador_path.read_text())
    resuelto = resolver_artefactos(borrador)

    resuelto_path = borrador_path.with_name(borrador_path.stem + ".resuelto.json")
    resuelto_path.write_text(json.dumps(resuelto, indent=2))

    subprocess.run(
        [
            "cargo", "run", "-p", "lumi-cli", "--",
            "actualizaciones", "firmar", str(resuelto_path), str(SALIDA),
        ],
        cwd=ROOT,
        check=True,
    )
    print(f"listo: {SALIDA}")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Probarlo de punta a punta con un artefacto falso**

```bash
mkdir -p /tmp/lumi-release-test
echo "contenido de prueba" > /tmp/lumi-release-test/lumid-9.9.9
cat > /tmp/borrador-prueba.json <<'EOF'
{
  "version": 1,
  "publicaciones": [
    {
      "producto": "lumid",
      "version": "9.9.9",
      "publicado": "2026-08-26T00:00:00Z",
      "notas": "prueba de tools/release.py, no una version real",
      "retirada": true,
      "artefactos": [
        { "plataforma": "linux-x86_64", "url": "https://example.invalid/lumid",
          "archivo": "/tmp/lumi-release-test/lumid-9.9.9" }
      ]
    }
  ]
}
EOF
python tools/release.py /tmp/borrador-prueba.json
```

Expected: imprime `firmado: .../web/releases/versiones.json (1 publicaciones)`.

```bash
cat web/releases/versiones.json | python -m json.tool | grep -A2 sha256
```

Expected: un `sha256` de 64 caracteres hexadecimales (el hash real del fichero de prueba).

- [ ] **Step 3: Revertir el manifiesto de prueba al vacío firmado del Task 3**

Este paso de prueba no debe dejar una versión `9.9.9` falsa en el manifiesto real:

```bash
cargo run -p lumi-cli -- actualizaciones firmar web/releases/borrador.json web/releases/versiones.json
git status --porcelain web/releases/versiones.json
```

Expected: sin diferencias (el fichero vuelve a ser el manifiesto vacío del Task 3 — la firma de Ed25519 no es determinista entre ejecuciones, así que el byte a byte puede cambiar aunque el contenido lógico no; si `git status` muestra una diferencia aquí es solo la firma, no un problema).

- [ ] **Step 4: Commit**

```bash
git add tools/release.py web/releases/versiones.json
git commit -m "feat: tools/release.py resuelve artefactos locales antes de firmar"
```

---

## Self-Review

**Cobertura de la spec:** cadena de confianza (Task 1: `comprobar()` siempre contra `CLAVE_PUBLICA`), formato del manifiesto (Task 1: `Manifiesto`/`Publicacion`/`Artefacto`), comparación de versiones y retiradas (Task 1: `mas_nueva`/`version_retirada` + tests), clave privada nunca en el repo (Task 2: `~/.lumi/release.key`, gitignoreado por vivir fuera del repo), endpoint sin filtrar (Task 3), publicar = commit (Task 3 Step 5, Task 4). Cubierto.

**Placeholders:** ninguno — cada paso trae el código completo, incluidos los tests.

**Consistencia de tipos:** `Manifiesto::mas_nueva`/`version_retirada`/`comprobar`/`firmar` se nombran igual en Task 1 (definición), Task 2 (uso desde `lumi-cli`) y en la interfaz declarada de ambos tasks. `ActualizacionError` solo se usa dentro de `lumi-proto`; `lumi-cli` lo propaga como `anyhow::Result`, sin redefinirlo.

---

**Plan complete and saved to `docs/superpowers/plans/2026-08-26-canal-actualizaciones-1-manifiesto.md`. Two execution options:**

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
