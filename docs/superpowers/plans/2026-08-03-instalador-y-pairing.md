# Plan de implementación — Instalador CLI y vinculación

> **Para agentes:** SUB-SKILL REQUERIDA: usa `superpowers:subagent-driven-development`
> (recomendado) o `superpowers:executing-plans` para implementar tarea a tarea. Los pasos
> usan casillas (`- [ ]`) para seguimiento.

**Objetivo:** dejar un servidor Lumi instalado, identificable por huella de certificado y
reclamable desde el cliente Tauri, con cuenta de administrador creada y aprovisionamiento
observable en vivo.

**Arquitectura:** monorepo con workspace de Rust. Un crate compartido `lumi-proto` define
formato de clave, tipos de API y criptografía, y lo consumen el daemon, el CLI y el lado
Rust de Tauri, de modo que un desajuste de protocolo no compila. El daemon `lumid` sirve
TLS con certificado autofirmado y expone una API pequeña más dos flujos SSE (telemetría y
log de tareas). El cliente es Tauri v2 con React y Tailwind, reusando los tokens de Lumi v1.

**Stack:** Rust 2021 · axum 0.7 · tokio · rustls · rcgen · rusqlite (bundled) · argon2 ·
chacha20poly1305 · nvml-wrapper · clap · indicatif · Tauri v2 · React 18 · Vite · Tailwind 3

**Spec:** [`2026-08-03-instalador-y-pairing-design.md`](../specs/2026-08-03-instalador-y-pairing-design.md)
**Diseño:** [`DESIGN.md`](../../../DESIGN.md) · mockup aprobado en `../specs/lumi-s1-v3.html`

---

## Restricciones globales

- **Puerto fijo 7717.** Definido en `tools/build.py`. No configurable por entorno.
- **Sin tests salvo los indicados.** `PROJECT-CONVENTIONS.md` los considera gasto
  innecesario. Las tareas con lógica no trivial llevan **una** comprobación ejecutable; las
  mecánicas, ninguna.
- **Un commit por tarea terminada.** Nada de commits intermedios.
- **`ponytail` manda en el código.** Antes de escribir: ¿esto necesita existir? ¿lo cubre la
  stdlib? ¿una dependencia ya instalada? Simplificaciones deliberadas se marcan con un
  comentario `// ponytail:` que nombra el techo y la salida.
- **Copy en español, minúscula en subtítulos.** Sin em dashes (`—`) en texto de interfaz;
  usar comas, dos puntos o paréntesis.
- **Iconos:** `viewBox="0 0 24 24"` siempre, `stroke-width` 1.6–2.0 sin adelgazar al crecer,
  32px máximo, trazo en `fg` salvo cuando el color significa estado. Ver `DESIGN.md`.
- **Movimiento:** solo `ease-out` exponencial, `cubic-bezier(.16,1,.3,1)`. Sin rebote.
  Respetar `prefers-reduced-motion`.
- **Sin colores fuera de la paleta de `DESIGN.md`.** No hay verde.
- **Rutas del servidor:** binario en `/usr/local/bin/lumi`, datos en `/var/lib/lumi/`.

### Desviación deliberada respecto a la spec

La spec nombra dos binarios de host, `lumi-install` y `lumi`. Este plan produce **uno solo**,
`lumi`, con subcomandos (`lumi install`, `lumi key reissue`, `lumi status`). El artefacto que
se descarga es `lumi` y la instalación es `sudo ./lumi install`. Un crate menos, un binario
menos que distribuir, misma superficie. `// ponytail:` la separación se recupera con un
symlink si algún día hace falta un instalador que no dependa del resto.

---

## Estructura de archivos

```
Cargo.toml                        workspace de los tres crates
tools/build.py                    dev: arranca lumid en 7717 y el cliente Tauri
tools/package.py                  zip de todo lo no excluido en .gitignore

crates/lumi-proto/
  src/lib.rs                      re-exports
  src/key.rs                      clave de vinculación, huella, base58
  src/crypto.rs                   contraseñas, secretos, envelope
  src/caps.rs                     matriz de capacidades y motivos
  src/api.rs                      tipos de petición y respuesta

crates/lumid/
  src/main.rs                     arranque, router, escucha TLS
  src/store.rs                    SQLite: esquema y acceso
  src/master.rs                   clave maestra: automática y sellada
  src/tls.rs                      certificado autofirmado y su huella
  src/tasks.rs                    runner con log persistente
  src/telemetry.rs                muestreo NVML y del sistema
  src/routes/hello.rs             GET /v1/hello
  src/routes/claim.rs             POST /v1/claim, POST /v1/admin
  src/routes/auth.rs              POST /v1/auth/login, POST /v1/unseal
  src/routes/tasks.rs             POST /v1/tasks, GET /v1/tasks/:id[/log]
  src/routes/telemetry.rs         GET /v1/telemetry

crates/lumi-cli/
  src/main.rs                     clap: install, key reissue, status
  src/detect.rs                   entorno y hardware
  src/install.rs                  cert, systemd, semilla, emisión de clave
  src/ui.rs                       spinner braille y barra de bloques

client/
  src-tauri/src/main.rs           comandos Tauri, verificador de huella
  src/main.tsx  src/App.tsx
  src/lib/api.ts                  cliente de la API vía invoke
  src/lib/store.ts                zustand: servidor, sesión, telemetría
  src/ui/PlanetBackground.tsx     copiado valor por valor de la v1
  src/ui/Icon.tsx                 set de iconos con el patrón de la v1
  src/ui/TelemetryStrip.tsx
  src/ui/StatusOverlay.tsx        los cuatro estados anómalos
  src/wizard/Wizard.tsx           shell: brandline, stepper, tarjeta
  src/wizard/PairStep.tsx
  src/wizard/AdminStep.tsx
  src/wizard/ProvisionStep.tsx
  src/index.css                   tokens y keyframes
  tailwind.config.ts
```

---

## Tarea 1: Andamiaje del monorepo

**Archivos:**
- Crear: `Cargo.toml`, `rust-toolchain.toml`, `tools/build.py`, `tools/package.py`
- Crear: `crates/lumi-proto/Cargo.toml`, `crates/lumi-proto/src/lib.rs`
- Crear: `crates/lumid/Cargo.toml`, `crates/lumid/src/main.rs`
- Crear: `crates/lumi-cli/Cargo.toml`, `crates/lumi-cli/src/main.rs`

**Interfaces:**
- Produce: workspace compilable con tres crates y los dos scripts de convención.

- [ ] **Paso 1: Crear el workspace**

`Cargo.toml`:

```toml
[workspace]
resolver = "2"
members = ["crates/lumi-proto", "crates/lumid", "crates/lumi-cli"]

[workspace.package]
version = "2.0.0"
edition = "2021"
license = "AGPL-3.0-or-later"

[workspace.dependencies]
lumi-proto = { path = "crates/lumi-proto" }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
anyhow = "1"
thiserror = "2"
sha2 = "0.10"
bs58 = "0.5"
rand = "0.8"
argon2 = "0.5"
chacha20poly1305 = "0.10"
tokio = { version = "1", features = ["full"] }
```

`rust-toolchain.toml`:

```toml
[toolchain]
channel = "1.83"
components = ["rustfmt", "clippy"]
```

- [ ] **Paso 2: Crear los tres crates**

`crates/lumi-proto/Cargo.toml`:

```toml
[package]
name = "lumi-proto"
version.workspace = true
edition.workspace = true

[dependencies]
serde.workspace = true
serde_json.workspace = true
thiserror.workspace = true
sha2.workspace = true
bs58.workspace = true
rand.workspace = true
argon2.workspace = true
chacha20poly1305.workspace = true
```

`crates/lumi-proto/src/lib.rs`:

```rust
pub mod api;
pub mod caps;
pub mod crypto;
pub mod key;

/// Puerto fijo del daemon. No configurable: convención del proyecto.
pub const PORT: u16 = 7717;
```

Crea los cuatro módulos vacíos (`api.rs`, `caps.rs`, `crypto.rs`, `key.rs`) con un
comentario de una línea cada uno; se rellenan en las tareas 2 a 4.

`crates/lumid/Cargo.toml`:

```toml
[package]
name = "lumid"
version.workspace = true
edition.workspace = true

[dependencies]
lumi-proto.workspace = true
serde.workspace = true
serde_json.workspace = true
anyhow.workspace = true
tokio.workspace = true
```

`crates/lumid/src/main.rs`:

```rust
fn main() {
    println!("lumid {}", env!("CARGO_PKG_VERSION"));
}
```

`crates/lumi-cli/Cargo.toml`:

```toml
[package]
name = "lumi-cli"
version.workspace = true
edition.workspace = true

[[bin]]
name = "lumi"
path = "src/main.rs"

[dependencies]
lumi-proto.workspace = true
anyhow.workspace = true
```

`crates/lumi-cli/src/main.rs`:

```rust
fn main() {
    println!("lumi {}", env!("CARGO_PKG_VERSION"));
}
```

- [ ] **Paso 3: Escribir los scripts de convención**

`tools/build.py`:

```python
#!/usr/bin/env python3
"""Dev: compila y arranca lumid en el puerto fijo, y el cliente Tauri."""
import subprocess, sys, os
from pathlib import Path

PORT = 7717
ROOT = Path(__file__).resolve().parent.parent

def run(cmd, **kw):
    print(f"$ {' '.join(cmd)}")
    return subprocess.run(cmd, cwd=ROOT, check=True, **kw)

def main():
    target = sys.argv[1] if len(sys.argv) > 1 else "dev"
    if target == "build":
        run(["cargo", "build", "--release"])
        run(["npm", "run", "tauri", "build"], cwd=ROOT / "client")
        return
    env = {**os.environ, "LUMI_PORT": str(PORT), "LUMI_DATA": str(ROOT / ".dev-data")}
    daemon = subprocess.Popen(["cargo", "run", "-p", "lumid"], cwd=ROOT, env=env)
    try:
        run(["npm", "run", "tauri", "dev"], cwd=ROOT / "client")
    finally:
        daemon.terminate()

if __name__ == "__main__":
    main()
```

`tools/package.py`:

```python
#!/usr/bin/env python3
"""Comprime en zip todo lo no excluido por .gitignore."""
import subprocess, zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

def main():
    files = subprocess.run(
        ["git", "ls-files", "--cached", "--others", "--exclude-standard"],
        cwd=ROOT, capture_output=True, text=True, check=True,
    ).stdout.split("\n")
    out = ROOT / "dist" / "lumi-station.zip"
    out.parent.mkdir(exist_ok=True)
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        for f in filter(None, files):
            z.write(ROOT / f, f)
    print(f"{out}  ({out.stat().st_size // 1024} KB)")

if __name__ == "__main__":
    main()
```

- [ ] **Paso 4: Verificar que compila**

```bash
cargo build
```

Esperado: `Finished dev profile`, tres crates compilados sin avisos.

- [ ] **Paso 5: Commit**

```bash
git add Cargo.toml rust-toolchain.toml crates tools
git commit -m "Andamiaje del monorepo: workspace Rust y scripts de convención"
```

---

## Tarea 2: Clave de vinculación y huella

**Archivos:**
- Modificar: `crates/lumi-proto/src/key.rs`
- Modificar: `crates/lumi-proto/Cargo.toml` (añadir `dev-dependencies` no hace falta)

**Interfaces:**
- Produce:
  - `pub struct PairKey { pub addr: String, pub fingerprint: String, pub secret: String }`
  - `PairKey::generate(addr: &str, cert_der: &[u8]) -> PairKey`
  - `PairKey::parse(s: &str) -> Result<PairKey, KeyError>`
  - `impl Display for PairKey`
  - `pub fn fingerprint(cert_der: &[u8]) -> String`
  - `pub const FP_BYTES: usize = 16;`

- [ ] **Paso 1: Escribir el módulo**

El separador es `_`, no `.`: una IPv4 lleva puntos y romperías el `split`. Se parsea desde
la derecha, así que el campo de dirección puede contener lo que quiera.

`crates/lumi-proto/src/key.rs`:

```rust
//! Clave de vinculación: `lumi1_<host:puerto>_<huella>_<secreto>`.
//!
//! La huella del certificado viaja dentro de la clave, así que el canal fuera
//! de banda por el que el owner la transmite verifica la identidad del
//! servidor. Sin diálogo de "¿confías?".

use rand::RngCore;
use sha2::{Digest, Sha256};
use std::fmt;

/// 128 bits de huella. Suficiente contra un atacante que intente generar un
/// certificado que colisione; 64 bits no lo serían.
pub const FP_BYTES: usize = 16;
/// 160 bits de secreto.
pub const SECRET_BYTES: usize = 20;

const PREFIX: &str = "lumi1";

#[derive(Debug, thiserror::Error, PartialEq)]
pub enum KeyError {
    #[error("la clave no empieza por lumi1_")]
    BadPrefix,
    #[error("la clave no tiene los cuatro campos")]
    BadShape,
    #[error("huella o secreto no son base58 válido")]
    BadEncoding,
    #[error("la huella no mide {FP_BYTES} bytes")]
    BadFingerprintLen,
}

#[derive(Debug, Clone, PartialEq)]
pub struct PairKey {
    pub addr: String,
    pub fingerprint: String,
    pub secret: String,
}

/// SHA-256 del certificado DER, truncado a 128 bits, en base58.
pub fn fingerprint(cert_der: &[u8]) -> String {
    let digest = Sha256::digest(cert_der);
    bs58::encode(&digest[..FP_BYTES]).into_string()
}

impl PairKey {
    pub fn generate(addr: &str, cert_der: &[u8]) -> Self {
        let mut secret = [0u8; SECRET_BYTES];
        rand::thread_rng().fill_bytes(&mut secret);
        Self {
            addr: addr.to_string(),
            fingerprint: fingerprint(cert_der),
            secret: bs58::encode(secret).into_string(),
        }
    }

    pub fn parse(s: &str) -> Result<Self, KeyError> {
        let rest = s.trim().strip_prefix(PREFIX).ok_or(KeyError::BadPrefix)?;
        let rest = rest.strip_prefix('_').ok_or(KeyError::BadPrefix)?;
        // Desde la derecha: el campo de dirección puede llevar puntos y dos puntos.
        let mut it = rest.rsplitn(3, '_');
        let secret = it.next().ok_or(KeyError::BadShape)?;
        let fingerprint = it.next().ok_or(KeyError::BadShape)?;
        let addr = it.next().ok_or(KeyError::BadShape)?;
        if addr.is_empty() || secret.is_empty() {
            return Err(KeyError::BadShape);
        }
        let fp = bs58::decode(fingerprint)
            .into_vec()
            .map_err(|_| KeyError::BadEncoding)?;
        if fp.len() != FP_BYTES {
            return Err(KeyError::BadFingerprintLen);
        }
        bs58::decode(secret)
            .into_vec()
            .map_err(|_| KeyError::BadEncoding)?;
        Ok(Self {
            addr: addr.to_string(),
            fingerprint: fingerprint.to_string(),
            secret: secret.to_string(),
        })
    }

    /// ¿La huella de este certificado es la que anuncia la clave?
    pub fn matches_cert(&self, cert_der: &[u8]) -> bool {
        // Comparación en tiempo constante no hace falta: la huella es pública.
        fingerprint(cert_der) == self.fingerprint
    }
}

impl fmt::Display for PairKey {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{PREFIX}_{}_{}_{}", self.addr, self.fingerprint, self.secret)
    }
}
```

- [ ] **Paso 2: Añadir la comprobación ejecutable**

Es la única de la tarea. Cubre lo que puede romperse en silencio: el ida y vuelta, y que una
IPv4 con puntos no rompa el parseo.

Al final de `key.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrip_con_ipv4_y_rechazo_de_basura() {
        let cert = b"certificado de mentira";
        let k = PairKey::generate("192.168.1.40:7717", cert);
        let s = k.to_string();
        assert_eq!(PairKey::parse(&s).unwrap(), k);
        assert_eq!(PairKey::parse(&s).unwrap().addr, "192.168.1.40:7717");
        assert!(k.matches_cert(cert));
        assert!(!k.matches_cert(b"otro certificado"));
        assert_eq!(PairKey::parse("nope").unwrap_err(), KeyError::BadPrefix);
        assert_eq!(
            PairKey::parse("lumi1_host_short_abc").unwrap_err(),
            KeyError::BadFingerprintLen
        );
    }
}
```

- [ ] **Paso 3: Ejecutar la comprobación**

```bash
cargo test -p lumi-proto key
```

Esperado: `test key::tests::roundtrip_con_ipv4_y_rechazo_de_basura ... ok`

- [ ] **Paso 4: Commit**

```bash
git add crates/lumi-proto/src/key.rs
git commit -m "lumi-proto: formato de clave de vinculación con huella anclada"
```

---

## Tarea 3: Criptografía

**Archivos:**
- Modificar: `crates/lumi-proto/src/crypto.rs`

**Interfaces:**
- Consume: nada.
- Produce:
  - `pub fn hash_password(pw: &str) -> Result<String, CryptoError>` (PHC de Argon2id)
  - `pub fn verify_password(pw: &str, phc: &str) -> bool`
  - `pub struct MasterKey([u8; 32])` con `MasterKey::random()`, `from_bytes`, `as_bytes`
  - `MasterKey::derive(passphrase: &str, salt: &[u8]) -> Result<MasterKey, CryptoError>`
  - `pub fn seal(mk: &MasterKey, plain: &[u8]) -> Vec<u8>` (nonce de 24 B por delante)
  - `pub fn open(mk: &MasterKey, sealed: &[u8]) -> Result<Vec<u8>, CryptoError>`
  - `pub fn new_dek() -> [u8; 32]`

- [ ] **Paso 1: Escribir el módulo**

`crates/lumi-proto/src/crypto.rs`:

```rust
//! Contraseñas, secretos y envelope encryption.
//!
//! No hay cifrado extremo a extremo de imágenes y no se afirma que lo haya:
//! el servidor necesita el píxel en claro para inferir. Esto protege contra
//! disco robado, copia filtrada e instantánea de VM. No contra root en
//! caliente.

use argon2::password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString};
use argon2::Argon2;
use chacha20poly1305::aead::{Aead, KeyInit};
use chacha20poly1305::{XChaCha20Poly1305, XNonce};
use rand::RngCore;

const NONCE_BYTES: usize = 24;

#[derive(Debug, thiserror::Error)]
pub enum CryptoError {
    #[error("argon2: {0}")]
    Argon2(String),
    #[error("no se pudo descifrar: clave incorrecta o dato manipulado")]
    Open,
    #[error("dato sellado demasiado corto")]
    TooShort,
}

pub fn hash_password(pw: &str) -> Result<String, CryptoError> {
    let salt = SaltString::generate(&mut rand::thread_rng());
    Argon2::default()
        .hash_password(pw.as_bytes(), &salt)
        .map(|h| h.to_string())
        .map_err(|e| CryptoError::Argon2(e.to_string()))
}

pub fn verify_password(pw: &str, phc: &str) -> bool {
    PasswordHash::new(phc)
        .map(|h| Argon2::default().verify_password(pw.as_bytes(), &h).is_ok())
        .unwrap_or(false)
}

#[derive(Clone)]
pub struct MasterKey([u8; 32]);

impl MasterKey {
    pub fn random() -> Self {
        let mut k = [0u8; 32];
        rand::thread_rng().fill_bytes(&mut k);
        Self(k)
    }
    pub fn from_bytes(b: [u8; 32]) -> Self {
        Self(b)
    }
    pub fn as_bytes(&self) -> &[u8; 32] {
        &self.0
    }
    /// Modo sellado: la maestra se deriva de la frase del owner.
    pub fn derive(passphrase: &str, salt: &[u8]) -> Result<Self, CryptoError> {
        let mut k = [0u8; 32];
        Argon2::default()
            .hash_password_into(passphrase.as_bytes(), salt, &mut k)
            .map_err(|e| CryptoError::Argon2(e.to_string()))?;
        Ok(Self(k))
    }
}

impl std::fmt::Debug for MasterKey {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("MasterKey(oculta)")
    }
}

/// Nonce aleatorio por delante del ciphertext. Formato: `nonce || ct`.
pub fn seal(mk: &MasterKey, plain: &[u8]) -> Vec<u8> {
    let mut nonce = [0u8; NONCE_BYTES];
    rand::thread_rng().fill_bytes(&mut nonce);
    let ct = XChaCha20Poly1305::new(mk.as_bytes().into())
        .encrypt(XNonce::from_slice(&nonce), plain)
        .expect("xchacha no falla con nonce e input válidos");
    [nonce.as_slice(), &ct].concat()
}

pub fn open(mk: &MasterKey, sealed: &[u8]) -> Result<Vec<u8>, CryptoError> {
    if sealed.len() <= NONCE_BYTES {
        return Err(CryptoError::TooShort);
    }
    let (nonce, ct) = sealed.split_at(NONCE_BYTES);
    XChaCha20Poly1305::new(mk.as_bytes().into())
        .decrypt(XNonce::from_slice(nonce), ct)
        .map_err(|_| CryptoError::Open)
}

/// Clave de datos por proyecto. Se guarda envuelta con `seal`.
pub fn new_dek() -> [u8; 32] {
    let mut k = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut k);
    k
}
```

- [ ] **Paso 2: Añadir la comprobación ejecutable**

Al final de `crypto.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn contrasenas_y_envelope() {
        let phc = hash_password("correcto caballo").unwrap();
        assert!(verify_password("correcto caballo", &phc));
        assert!(!verify_password("otra cosa", &phc));

        let mk = MasterKey::random();
        let dek = new_dek();
        let envuelta = seal(&mk, &dek);
        assert_eq!(open(&mk, &envuelta).unwrap(), dek);
        assert!(open(&MasterKey::random(), &envuelta).is_err());

        // manipular un byte del ciphertext tiene que fallar, no devolver basura
        let mut roto = envuelta.clone();
        *roto.last_mut().unwrap() ^= 1;
        assert!(open(&mk, &roto).is_err());

        // la misma frase con la misma sal da la misma maestra
        let a = MasterKey::derive("frase larga del owner", b"sal de 16 bytes!").unwrap();
        let b = MasterKey::derive("frase larga del owner", b"sal de 16 bytes!").unwrap();
        assert_eq!(a.as_bytes(), b.as_bytes());
    }
}
```

- [ ] **Paso 3: Ejecutar**

```bash
cargo test -p lumi-proto crypto
```

Esperado: `test crypto::tests::contrasenas_y_envelope ... ok`

- [ ] **Paso 4: Commit**

```bash
git add crates/lumi-proto/src/crypto.rs
git commit -m "lumi-proto: contraseñas Argon2id, envelope XChaCha20-Poly1305"
```

---

## Tarea 4: Capacidades y tipos de API

**Archivos:**
- Modificar: `crates/lumi-proto/src/caps.rs`, `crates/lumi-proto/src/api.rs`

**Interfaces:**
- Consume: nada.
- Produce:
  - `pub enum Mode { Native, Docker }`
  - `pub enum CapState { On, Partial, Off }`
  - `pub struct Capability { pub id: &'static str, pub label: &'static str, pub state: CapState, pub reason: Option<String> }`
  - `pub fn matrix(mode: Mode, gpu_count: usize) -> Vec<Capability>`
  - `pub enum DaemonState { Unclaimed, Claimed, Provisioning, Ready }`
  - `pub struct Hello { version, state, mode, locked, fingerprint, capabilities, gpus }`
  - `pub struct GpuInfo { index, name, vram_total_mb, pcie }`
  - `pub struct ClaimReq/ClaimRes/AdminReq/LoginReq/LoginRes/UnsealReq`
  - `pub struct TaskSpec/TaskStatus`, `pub enum TaskKind`
  - `pub struct Sample` (telemetría)

- [ ] **Paso 1: Escribir `caps.rs`**

```rust
//! Matriz de capacidades. Cada recorte lleva su motivo legible, y la interfaz
//! lo muestra allí donde la opción aparece deshabilitada. Nada desaparece en
//! silencio: un solo origen de verdad y la columna del motivo nunca vacía.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Mode {
    Native,
    Docker,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CapState {
    On,
    Partial,
    Off,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Capability {
    pub id: String,
    pub label: String,
    pub state: CapState,
    /// Obligatorio cuando el estado no es `On`. La interfaz lo muestra tal cual.
    pub reason: Option<String>,
}

fn cap(id: &str, label: &str, state: CapState, reason: Option<&str>) -> Capability {
    Capability {
        id: id.into(),
        label: label.into(),
        state,
        reason: reason.map(str::to_string),
    }
}

pub fn matrix(mode: Mode, gpu_count: usize) -> Vec<Capability> {
    let multi = gpu_count > 1;
    match mode {
        Mode::Native => vec![
            cap(
                "shard",
                "Sharding multi-GPU",
                if multi { CapState::On } else { CapState::Off },
                if multi { None } else { Some("Solo hay una GPU en el host.") },
            ),
            cap("offload", "Offload GPU + CPU", CapState::On, None),
            cap("nvml", "Telemetría NVML", CapState::On, None),
            cap("sealed", "Modo sellado", CapState::On, None),
        ],
        Mode::Docker => vec![
            cap(
                "shard",
                "Sharding multi-GPU",
                CapState::Off,
                Some("El contenedor solo recibe gpu0. Requiere --gpus all y acceso directo a /dev/nvidia*."),
            ),
            cap(
                "offload",
                "Offload GPU + CPU",
                CapState::Off,
                Some("Sin cpuset del host no se puede fijar afinidad de núcleos; el offload degradaría en vez de acelerar."),
            ),
            cap(
                "nvml",
                "Telemetría NVML",
                CapState::Partial,
                Some("Uso y VRAM sí; temperatura y potencia requieren --privileged."),
            ),
            cap("sealed", "Modo sellado", CapState::On, None),
        ],
    }
}
```

- [ ] **Paso 2: Escribir `api.rs`**

```rust
//! Tipos del protocolo. Compilados por daemon, CLI y el lado Rust de Tauri:
//! si cambias uno y no el otro, no compila.

use crate::caps::{Capability, Mode};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DaemonState {
    Unclaimed,
    Claimed,
    Provisioning,
    Ready,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GpuInfo {
    pub index: u32,
    pub name: String,
    pub vram_total_mb: u64,
    pub pcie: String,
}

/// `GET /v1/hello`. Sin autenticación: es lo que el cliente lee antes de
/// confiar en nada. Disponible también en estado bloqueado.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Hello {
    pub version: String,
    pub state: DaemonState,
    pub mode: Mode,
    pub locked: bool,
    pub fingerprint: String,
    pub capabilities: Vec<Capability>,
    pub gpus: Vec<GpuInfo>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ClaimReq {
    pub secret: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ClaimRes {
    /// Sesión de vida corta que solo autoriza crear el primer administrador.
    pub bootstrap_token: String,
    pub expires_in_s: u32,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AdminReq {
    pub bootstrap_token: String,
    pub username: String,
    pub password: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct LoginReq {
    pub username: String,
    pub password: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct LoginRes {
    pub token: String,
    pub is_admin: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct UnsealReq {
    pub passphrase: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TaskKind {
    /// venv + torch + CUDA. El paso pesado que justifica el runner.
    InferenceRuntime,
    Database,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TaskSpec {
    pub kind: TaskKind,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskStatus {
    pub id: String,
    pub kind: TaskKind,
    pub running: bool,
    pub exit_code: Option<i32>,
    /// Bytes escritos al log. El cliente se reengancha pidiendo `?from=`.
    pub log_len: u64,
}

/// Una muestra de telemetría. Se emite por SSE cada segundo, también en
/// estado bloqueado: no depende de la clave maestra, y que siga viva
/// demuestra que la máquina está sana y solo falta desbloquear.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Sample {
    pub gpus: Vec<GpuSample>,
    pub cpu_pct: f32,
    pub ram_used_mb: u64,
    pub disk_free_mb: u64,
    pub queue_depth: u32,
    pub queue_paused: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GpuSample {
    pub index: u32,
    pub util_pct: u32,
    pub vram_used_mb: u64,
    pub vram_total_mb: u64,
    pub temp_c: Option<u32>,
}
```

- [ ] **Paso 3: Comprobación ejecutable**

Al final de `caps.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn todo_recorte_lleva_motivo() {
        for mode in [Mode::Native, Mode::Docker] {
            for gpus in [1, 4] {
                for c in matrix(mode, gpus) {
                    if c.state != CapState::On {
                        assert!(
                            c.reason.as_ref().is_some_and(|r| !r.trim().is_empty()),
                            "{:?}/{gpus} GPU: '{}' recortada sin motivo",
                            mode,
                            c.id
                        );
                    }
                }
            }
        }
    }
}
```

- [ ] **Paso 4: Ejecutar**

```bash
cargo test -p lumi-proto caps
```

Esperado: `test caps::tests::todo_recorte_lleva_motivo ... ok`

- [ ] **Paso 5: Commit**

```bash
git add crates/lumi-proto/src
git commit -m "lumi-proto: matriz de capacidades y tipos del protocolo"
```

---

## Tarea 5: Detección de entorno y hardware

**Archivos:**
- Crear: `crates/lumi-cli/src/detect.rs`
- Modificar: `crates/lumi-cli/Cargo.toml`, `crates/lumi-cli/src/main.rs`

**Interfaces:**
- Consume: `lumi_proto::caps::{Mode, matrix}`, `lumi_proto::api::GpuInfo`
- Produce:
  - `pub struct Env { pub os: String, pub kernel: String, pub systemd: Option<String>, pub driver: Option<String>, pub cuda: Option<String>, pub disk_free_mb: u64, pub port_free: bool, pub ufw_active: bool }`
  - `pub fn env() -> Env`
  - `pub fn gpus() -> Vec<GpuInfo>`
  - `pub fn cpu_summary() -> String`

- [ ] **Paso 1: Añadir dependencias**

En `crates/lumi-cli/Cargo.toml`, sección `[dependencies]`:

```toml
nvml-wrapper = "0.10"
sysinfo = "0.32"
clap = { version = "4", features = ["derive"] }
indicatif = "0.17"
console = "0.15"
rcgen = { version = "0.13", features = ["pem"] }
rusqlite = { version = "0.32", features = ["bundled"] }
serde.workspace = true
serde_json.workspace = true
```

- [ ] **Paso 2: Escribir `detect.rs`**

```rust
//! Detección de entorno y hardware. Corre antes de emitir la clave: si el
//! host no puede ejecutar nada, el instalador falla aquí y no se llega a
//! instalar el cliente para descubrirlo.
//!
//! No necesita torch ni Python: NVML y /proc bastan.

use lumi_proto::api::GpuInfo;
use std::net::TcpListener;
use std::process::Command;

pub struct Env {
    pub os: String,
    pub kernel: String,
    pub systemd: Option<String>,
    pub driver: Option<String>,
    pub cuda: Option<String>,
    pub disk_free_mb: u64,
    pub port_free: bool,
    pub ufw_active: bool,
}

fn first_line(cmd: &str, args: &[&str]) -> Option<String> {
    let out = Command::new(cmd).args(args).output().ok()?;
    if !out.status.success() {
        return None;
    }
    String::from_utf8_lossy(&out.stdout)
        .lines()
        .next()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

pub fn env() -> Env {
    let os = std::fs::read_to_string("/etc/os-release")
        .ok()
        .and_then(|s| {
            s.lines()
                .find_map(|l| l.strip_prefix("PRETTY_NAME=").map(|v| v.trim_matches('"').to_string()))
        })
        .unwrap_or_else(|| "desconocido".into());

    let mut sys = sysinfo::Disks::new_with_refreshed_list();
    sys.refresh();
    // ponytail: el disco de /var/lib basta; si el despliegue usa otro punto de
    // montaje para los modelos, se añade un segundo chequeo cuando exista.
    let disk_free_mb = sys
        .list()
        .iter()
        .filter(|d| "/var/lib/lumi".starts_with(&*d.mount_point().to_string_lossy()))
        .map(|d| d.available_space() / 1024 / 1024)
        .max()
        .unwrap_or(0);

    Env {
        os,
        kernel: first_line("uname", &["-r"]).unwrap_or_else(|| "desconocido".into()),
        systemd: first_line("systemctl", &["--version"])
            .and_then(|l| l.split_whitespace().nth(1).map(str::to_string)),
        driver: first_line(
            "nvidia-smi",
            &["--query-gpu=driver_version", "--format=csv,noheader"],
        ),
        cuda: first_line("nvidia-smi", &["--query-gpu=name", "--format=csv,noheader"])
            .and(first_line("nvcc", &["--version"]))
            .or_else(|| {
                first_line("nvidia-smi", &[]).and_then(|_| {
                    Command::new("nvidia-smi")
                        .output()
                        .ok()
                        .and_then(|o| {
                            String::from_utf8_lossy(&o.stdout)
                                .split("CUDA Version:")
                                .nth(1)
                                .and_then(|s| s.split_whitespace().next())
                                .map(str::to_string)
                        })
                })
            }),
        disk_free_mb,
        port_free: TcpListener::bind(("0.0.0.0", lumi_proto::PORT)).is_ok(),
        ufw_active: first_line("ufw", &["status"])
            .map(|l| l.contains("active"))
            .unwrap_or(false),
    }
}

pub fn gpus() -> Vec<GpuInfo> {
    let Ok(nvml) = nvml_wrapper::Nvml::init() else {
        return vec![];
    };
    let count = nvml.device_count().unwrap_or(0);
    (0..count)
        .filter_map(|i| {
            let d = nvml.device_by_index(i).ok()?;
            Some(GpuInfo {
                index: i,
                name: d.name().unwrap_or_else(|_| "GPU".into()),
                vram_total_mb: d.memory_info().ok()?.total / 1024 / 1024,
                pcie: d.pci_info().ok()?.bus_id,
            })
        })
        .collect()
}

pub fn cpu_summary() -> String {
    let mut s = sysinfo::System::new();
    s.refresh_cpu_all();
    s.refresh_memory();
    let brand = s
        .cpus()
        .first()
        .map(|c| c.brand().trim().to_string())
        .unwrap_or_else(|| "CPU".into());
    format!(
        "{brand} · {}t · {} GB RAM",
        s.cpus().len(),
        s.total_memory() / 1024 / 1024 / 1024
    )
}
```

- [ ] **Paso 3: Conectar un subcomando de diagnóstico**

`crates/lumi-cli/src/main.rs`:

```rust
mod detect;

use clap::{Parser, Subcommand};

#[derive(Parser)]
#[command(name = "lumi", version, about = "Servidor Lumi Station")]
struct Cli {
    #[command(subcommand)]
    cmd: Cmd,
}

#[derive(Subcommand)]
enum Cmd {
    /// Instala el daemon y emite la clave de vinculación
    Install,
    /// Muestra el entorno y el hardware detectados
    Status,
}

fn main() -> anyhow::Result<()> {
    match Cli::parse().cmd {
        Cmd::Status => {
            let e = detect::env();
            println!("{} · {}", e.os, e.kernel);
            println!("systemd  {}", e.systemd.as_deref().unwrap_or("ausente"));
            println!("driver   {}", e.driver.as_deref().unwrap_or("ausente"));
            println!("disco    {} MB libres", e.disk_free_mb);
            println!("puerto   {}", if e.port_free { "libre" } else { "ocupado" });
            for g in detect::gpus() {
                println!("gpu{}  {}  {} MB  {}", g.index, g.name, g.vram_total_mb, g.pcie);
            }
            println!("{}", detect::cpu_summary());
        }
        Cmd::Install => println!("pendiente: tarea 6"),
    }
    Ok(())
}
```

- [ ] **Paso 4: Ejecutar contra el host real**

```bash
cargo run -p lumi-cli -- status
```

Esperado en una máquina sin GPU: la línea del sistema operativo y el kernel salen
rellenas, `driver ausente`, ninguna línea `gpu`. En una máquina con NVIDIA: una línea `gpuN`
por tarjeta con VRAM y dirección PCIe reales. Si el sistema operativo sale como
`desconocido`, `/etc/os-release` no existe y no estás en Linux.

- [ ] **Paso 5: Commit**

```bash
git add crates/lumi-cli
git commit -m "lumi-cli: detección de entorno, GPUs y CPU"
```

---

## Tarea 6: Instalación y emisión de la clave

**Archivos:**
- Crear: `crates/lumi-cli/src/ui.rs`, `crates/lumi-cli/src/install.rs`
- Modificar: `crates/lumi-cli/src/main.rs`

**Interfaces:**
- Consume: `detect::{env, gpus, cpu_summary}`, `lumi_proto::key::PairKey`,
  `lumi_proto::crypto::hash_password`, `lumi_proto::caps::{Mode, matrix, CapState}`
- Produce:
  - `ui::step(label: &str) -> ProgressBar` (spinner braille)
  - `ui::bar(label: &str, total: u64) -> ProgressBar` (barra de bloques)
  - `ui::ok(msg: &str)`, `ui::warn(msg: &str)`
  - `install::run(mode: Mode, sealed: bool) -> anyhow::Result<PairKey>`

- [ ] **Paso 1: Escribir `ui.rs`**

```rust
//! Salida de terminal. Spinner braille en la línea activa, check al
//! completar, barra de bloques para descargas. Solo se mueve la línea en
//! curso: lo terminado se queda quieto.

use console::style;
use indicatif::{ProgressBar, ProgressStyle};
use std::time::Duration;

const BRAILLE: &[&str] = &["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

pub fn step(label: &str) -> ProgressBar {
    let pb = ProgressBar::new_spinner();
    pb.set_style(
        ProgressStyle::with_template("  {spinner} {msg}")
            .unwrap()
            .tick_strings(BRAILLE),
    );
    pb.set_message(label.to_string());
    pb.enable_steady_tick(Duration::from_millis(72));
    pb
}

pub fn bar(label: &str, total: u64) -> ProgressBar {
    let pb = ProgressBar::new(total);
    pb.set_style(
        ProgressStyle::with_template(
            "  {msg}\n  {bar:40.cyan/black} {percent:>3}%  {bytes}/{total_bytes} · {binary_bytes_per_sec} · {eta}",
        )
        .unwrap()
        .progress_chars("██░"),
    );
    pb.set_message(label.to_string());
    pb
}

pub fn ok(msg: &str) {
    println!("  {} {msg}", style("✓").green());
}

pub fn warn(msg: &str) {
    println!("  {} {msg}", style("!").yellow());
}

pub fn head(title: &str) {
    println!("\n{}", style(title).bold());
}
```

- [ ] **Paso 2: Escribir `install.rs`**

```rust
//! Instalación: certificado autofirmado, unit de systemd, semilla de la clave
//! maestra y emisión de la clave de vinculación.
//!
//! Deja SOLO el daemon de control. Runtime de inferencia, base de datos y
//! modelos los instala el asistente desde la app: eso es lo que justifica el
//! runner de tareas del servidor.

use crate::{detect, ui};
use anyhow::{bail, Context, Result};
use lumi_proto::caps::{CapState, Mode};
use lumi_proto::crypto::{hash_password, MasterKey};
use lumi_proto::key::PairKey;
use std::fs;
use std::path::Path;
use std::process::Command;

const DATA: &str = "/var/lib/lumi";
const BIN: &str = "/usr/local/bin/lumid";

const UNIT: &str = "\
[Unit]
Description=Lumi Station control daemon
After=network-online.target
Wants=network-online.target

[Service]
ExecStart=/usr/local/bin/lumid
Restart=on-failure
RestartSec=3
User=root
StateDirectory=lumi
Environment=LUMI_DATA=/var/lib/lumi

[Install]
WantedBy=multi-user.target
";

pub fn run(mode: Mode, sealed: bool, passphrase: Option<&str>) -> Result<PairKey> {
    if !Path::new("/run/systemd/system").exists() {
        bail!("este host no usa systemd; instala en modo Docker o en una máquina con systemd");
    }

    ui::head("entorno");
    let e = detect::env();
    ui::ok(&format!("{} · {}", e.os, e.kernel));
    match &e.driver {
        Some(d) => ui::ok(&format!("driver NVIDIA {d}")),
        None => ui::warn("sin driver NVIDIA: el servidor arrancará, pero sin inferencia"),
    }
    if !e.port_free {
        bail!("el puerto {} ya está ocupado", lumi_proto::PORT);
    }
    if e.ufw_active {
        ui::warn("ufw activo: se añadirá la regla para el puerto");
        let _ = Command::new("ufw")
            .args(["allow", &format!("{}/tcp", lumi_proto::PORT)])
            .status();
    }

    ui::head("hardware");
    let gpus = detect::gpus();
    for g in &gpus {
        println!("  gpu{}  {}  {} MB  {}", g.index, g.name, g.vram_total_mb, g.pcie);
    }
    println!("  {}", detect::cpu_summary());

    ui::head("capacidades");
    for c in lumi_proto::caps::matrix(mode, gpus.len()) {
        match c.state {
            CapState::On => ui::ok(&c.label),
            _ => {
                ui::warn(&format!("{} · recortada", c.label));
                if let Some(r) = c.reason {
                    println!("      {r}");
                }
            }
        }
    }

    ui::head("instalación");
    fs::create_dir_all(DATA).context("no se pudo crear /var/lib/lumi")?;

    let pb = ui::step("generando certificado autofirmado");
    let cert = rcgen::generate_simple_self_signed(vec![
        local_ip().unwrap_or_else(|| "localhost".into()),
        "localhost".into(),
    ])
    .context("rcgen falló")?;
    let der = cert.cert.der().to_vec();
    fs::write(format!("{DATA}/cert.der"), &der)?;
    fs::write(format!("{DATA}/key.pem"), cert.key_pair.serialize_pem())?;
    pb.finish_and_clear();
    ui::ok("certificado ed25519 · 10 años");

    let pb = ui::step("sembrando clave maestra");
    seed_master(sealed, passphrase)?;
    pb.finish_and_clear();
    ui::ok(if sealed {
        "clave maestra sellada · se desbloquea desde la app tras cada reinicio"
    } else {
        "clave maestra automática · systemd-creds"
    });

    let pb = ui::step("instalando el daemon");
    let src = std::env::current_exe()?.with_file_name("lumid");
    fs::copy(&src, BIN).with_context(|| format!("no se pudo copiar {src:?} a {BIN}"))?;
    fs::write("/etc/systemd/system/lumid.service", UNIT)?;
    run_ok("systemctl", &["daemon-reload"])?;
    run_ok("systemctl", &["enable", "--now", "lumid.service"])?;
    pb.finish_and_clear();
    ui::ok(&format!("lumid.service activo · escuchando en 0.0.0.0:{}", lumi_proto::PORT));

    let addr = format!("{}:{}", local_ip().unwrap_or_else(|| "127.0.0.1".into()), lumi_proto::PORT);
    let key = PairKey::generate(&addr, &der);
    let db = rusqlite::Connection::open(format!("{DATA}/lumi.db"))?;
    db.execute_batch(
        "CREATE TABLE IF NOT EXISTS pair_key (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            secret_phc TEXT NOT NULL,
            expires_at INTEGER,
            consumed INTEGER NOT NULL DEFAULT 0
        );",
    )?;
    let expires = if std::env::var("LUMI_NO_EXPIRY").is_ok() {
        None
    } else {
        Some(now() + 24 * 3600)
    };
    db.execute(
        "INSERT OR REPLACE INTO pair_key (id, secret_phc, expires_at, consumed) VALUES (1, ?1, ?2, 0)",
        rusqlite::params![hash_password(&key.secret)?, expires],
    )?;

    Ok(key)
}

fn seed_master(sealed: bool, passphrase: Option<&str>) -> Result<()> {
    if sealed {
        let pw = passphrase.context("el modo sellado necesita una frase")?;
        let mut salt = [0u8; 16];
        rand::RngCore::fill_bytes(&mut rand::thread_rng(), &mut salt);
        // Solo se guarda la sal: la maestra se deriva en cada desbloqueo y
        // nunca toca el disco.
        fs::write(format!("{DATA}/master.salt"), salt)?;
        let _ = MasterKey::derive(pw, &salt)?; // valida que la derivación funciona
    } else {
        let mk = MasterKey::random();
        let path = format!("{DATA}/master.cred");
        let out = Command::new("systemd-creds")
            .args(["encrypt", "--name=lumi-master", "-", &path])
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::null())
            .spawn()
            .context("systemd-creds no disponible")?;
        use std::io::Write;
        out.stdin.as_ref().context("stdin")?.write_all(mk.as_bytes())?;
        let st = out.wait_with_output()?;
        if !st.status.success() {
            bail!("systemd-creds encrypt falló");
        }
    }
    Ok(())
}

fn run_ok(cmd: &str, args: &[&str]) -> Result<()> {
    let st = Command::new(cmd).args(args).status()?;
    if !st.success() {
        bail!("{cmd} {} falló", args.join(" "));
    }
    Ok(())
}

fn now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64
}

/// ponytail: primera IPv4 no loopback. Con varias interfaces el owner corrige
/// la dirección en la clave a mano; un selector interactivo se añade si pasa.
fn local_ip() -> Option<String> {
    let out = Command::new("hostname").arg("-I").output().ok()?;
    String::from_utf8_lossy(&out.stdout)
        .split_whitespace()
        .find(|s| s.contains('.') && !s.starts_with("127."))
        .map(str::to_string)
}
```

- [ ] **Paso 3: Conectar el subcomando y la impresión de la clave**

En `crates/lumi-cli/src/main.rs`, reemplaza el brazo `Cmd::Install`:

```rust
mod detect;
mod install;
mod ui;
```

```rust
        Cmd::Install => {
            let mode = if std::path::Path::new("/.dockerenv").exists() {
                lumi_proto::caps::Mode::Docker
            } else {
                lumi_proto::caps::Mode::Native
            };
            let sealed = std::env::var("LUMI_SEALED").is_ok();
            let pass = std::env::var("LUMI_PASSPHRASE").ok();
            let key = install::run(mode, sealed, pass.as_deref())?;
            println!();
            println!("  ────────────────────────────────────────────────────────");
            println!("  Clave de vinculación · un solo uso · caduca en 24 h");
            println!();
            println!("  {key}");
            println!();
            println!("  Solo se muestra ahora. El servidor guarda su hash.");
            println!("  Perdida: lumi key reissue");
            println!("  ────────────────────────────────────────────────────────");
        }
```

Añade el subcomando `Key` al enum y su brazo:

```rust
    /// Revoca la clave anterior y emite otra
    Key {
        #[command(subcommand)]
        action: KeyAction,
    },
```

```rust
#[derive(Subcommand)]
enum KeyAction {
    Reissue,
}
```

```rust
        Cmd::Key { action: KeyAction::Reissue } => {
            let key = install::reissue()?;
            println!("\n  {key}\n");
        }
```

Y en `install.rs`, la función que faltaba:

```rust
/// Tener shell en la máquina ya es prueba de propiedad: no hace falta más
/// ceremonia que ejecutar esto.
pub fn reissue() -> Result<PairKey> {
    let der = fs::read(format!("{DATA}/cert.der")).context("el servidor no está instalado")?;
    let addr = format!(
        "{}:{}",
        local_ip().unwrap_or_else(|| "127.0.0.1".into()),
        lumi_proto::PORT
    );
    let key = PairKey::generate(&addr, &der);
    let db = rusqlite::Connection::open(format!("{DATA}/lumi.db"))?;
    db.execute(
        "INSERT OR REPLACE INTO pair_key (id, secret_phc, expires_at, consumed) VALUES (1, ?1, ?2, 0)",
        rusqlite::params![hash_password(&key.secret)?, now() + 24 * 3600],
    )?;
    Ok(key)
}
```

- [ ] **Paso 4: Verificar en seco**

```bash
cargo build -p lumi-cli && cargo run -p lumi-cli -- install
```

Esperado sin privilegios de root: falla en `no se pudo crear /var/lib/lumi` con ese texto
exacto, después de haber impreso las secciones de entorno, hardware y capacidades. Eso
confirma que la detección y la matriz se ejecutan antes de tocar el disco.

Con `sudo` en una máquina Linux con systemd: llega hasta imprimir la clave y
`systemctl is-active lumid` responde `active`.

- [ ] **Paso 5: Commit**

```bash
git add crates/lumi-cli
git commit -m "lumi-cli: instalación, certificado, unit de systemd y emisión de clave"
```

---

## Tarea 7: Daemon, TLS, almacén y `/v1/hello`

**Archivos:**
- Crear: `crates/lumid/src/store.rs`, `crates/lumid/src/tls.rs`, `crates/lumid/src/routes/mod.rs`, `crates/lumid/src/routes/hello.rs`
- Modificar: `crates/lumid/Cargo.toml`, `crates/lumid/src/main.rs`

**Interfaces:**
- Consume: `lumi_proto::api::{Hello, DaemonState, GpuInfo}`, `lumi_proto::caps::{Mode, matrix}`
- Produce:
  - `pub struct Store` con `Store::open(dir: &Path) -> Result<Store>`,
    `Store::state() -> DaemonState`, `Store::set_state(DaemonState)`,
    `Store::conn() -> MutexGuard<'_, Connection>`
  - `pub struct App { pub store: Arc<Store>, pub fingerprint: String, pub mode: Mode, pub gpus: Vec<GpuInfo>, pub master: Arc<RwLock<Option<MasterKey>>> }`
  - `tls::load(dir: &Path) -> Result<(RustlsConfig, String)>` devuelve config y huella

- [ ] **Paso 1: Dependencias del daemon**

En `crates/lumid/Cargo.toml`, `[dependencies]`:

```toml
axum = "0.7"
axum-server = { version = "0.7", features = ["tls-rustls"] }
tower-http = { version = "0.6", features = ["cors"] }
rusqlite = { version = "0.32", features = ["bundled"] }
nvml-wrapper = "0.10"
sysinfo = "0.32"
tokio-stream = "0.1"
futures = "0.3"
tracing = "0.1"
tracing-subscriber = "0.3"
```

- [ ] **Paso 2: Escribir `store.rs`**

```rust
//! SQLite del plano de control. Una sola conexión bajo mutex: el volumen es
//! de decenas de operaciones por minuto, no de miles por segundo.
//! ponytail: si el plano de control llega a ser el cuello de botella, se pasa
//! a un pool; hoy sería complejidad sin causa.

use anyhow::Result;
use lumi_proto::api::DaemonState;
use rusqlite::Connection;
use std::path::Path;
use std::sync::{Mutex, MutexGuard};

const SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS pair_key (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    secret_phc TEXT NOT NULL,
    expires_at INTEGER,
    consumed INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    password_phc TEXT NOT NULL,
    is_admin INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    running INTEGER NOT NULL,
    exit_code INTEGER,
    started_at INTEGER NOT NULL
);
";

pub struct Store(Mutex<Connection>);

impl Store {
    pub fn open(dir: &Path) -> Result<Self> {
        let c = Connection::open(dir.join("lumi.db"))?;
        c.execute_batch(SCHEMA)?;
        Ok(Self(Mutex::new(c)))
    }

    pub fn conn(&self) -> MutexGuard<'_, Connection> {
        self.0.lock().expect("mutex del store envenenado")
    }

    pub fn state(&self) -> DaemonState {
        let c = self.conn();
        let has_admin: i64 = c
            .query_row("SELECT COUNT(*) FROM users WHERE is_admin = 1", [], |r| r.get(0))
            .unwrap_or(0);
        if has_admin == 0 {
            return DaemonState::Unclaimed;
        }
        let running: i64 = c
            .query_row("SELECT COUNT(*) FROM tasks WHERE running = 1", [], |r| r.get(0))
            .unwrap_or(0);
        if running > 0 {
            return DaemonState::Provisioning;
        }
        match c.query_row("SELECT v FROM meta WHERE k = 'provisioned'", [], |r| {
            r.get::<_, String>(0)
        }) {
            Ok(v) if v == "1" => DaemonState::Ready,
            _ => DaemonState::Claimed,
        }
    }

    pub fn set_meta(&self, k: &str, v: &str) -> Result<()> {
        self.conn()
            .execute("INSERT OR REPLACE INTO meta (k, v) VALUES (?1, ?2)", (k, v))?;
        Ok(())
    }
}
```

- [ ] **Paso 3: Escribir `tls.rs`**

```rust
//! Carga el certificado autofirmado que dejó el instalador y calcula su
//! huella, que es la que el cliente compara contra la que trae la clave.

use anyhow::{Context, Result};
use axum_server::tls_rustls::RustlsConfig;
use std::path::Path;

pub async fn load(dir: &Path) -> Result<(RustlsConfig, String)> {
    let der = std::fs::read(dir.join("cert.der")).context("falta cert.der: ejecuta lumi install")?;
    let fingerprint = lumi_proto::key::fingerprint(&der);
    let pem = pem_wrap(&der);
    let key = std::fs::read(dir.join("key.pem")).context("falta key.pem")?;
    let cfg = RustlsConfig::from_pem(pem.into_bytes(), key).await?;
    Ok((cfg, fingerprint))
}

fn pem_wrap(der: &[u8]) -> String {
    use std::fmt::Write;
    // ponytail: base64 a mano evita una dependencia solo para esto.
    let b64 = base64_std(der);
    let mut s = String::from("-----BEGIN CERTIFICATE-----\n");
    for chunk in b64.as_bytes().chunks(64) {
        let _ = writeln!(s, "{}", std::str::from_utf8(chunk).unwrap());
    }
    s.push_str("-----END CERTIFICATE-----\n");
    s
}

fn base64_std(data: &[u8]) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(data.len().div_ceil(3) * 4);
    for c in data.chunks(3) {
        let b = [c[0], *c.get(1).unwrap_or(&0), *c.get(2).unwrap_or(&0)];
        let n = u32::from_be_bytes([0, b[0], b[1], b[2]]);
        for i in 0..4 {
            if i <= c.len() {
                out.push(T[((n >> (18 - 6 * i)) & 63) as usize] as char);
            } else {
                out.push('=');
            }
        }
    }
    out
}
```

- [ ] **Paso 4: Escribir `routes/hello.rs` y `routes/mod.rs`**

`crates/lumid/src/routes/mod.rs`:

```rust
pub mod hello;
```

`crates/lumid/src/routes/hello.rs`:

```rust
//! Lo primero que lee el cliente, antes de confiar en nada. Sin
//! autenticación, y disponible también con la clave maestra bloqueada.

use crate::App;
use axum::{extract::State, Json};
use lumi_proto::api::Hello;

pub async fn get(State(app): State<App>) -> Json<Hello> {
    Json(Hello {
        version: env!("CARGO_PKG_VERSION").into(),
        state: app.store.state(),
        mode: app.mode,
        locked: app.master.read().await.is_none(),
        fingerprint: app.fingerprint.clone(),
        capabilities: lumi_proto::caps::matrix(app.mode, app.gpus.len()),
        gpus: app.gpus.clone(),
    })
}
```

- [ ] **Paso 5: Escribir `main.rs`**

```rust
mod routes;
mod store;
mod tls;

use axum::{routing::get, Router};
use lumi_proto::api::GpuInfo;
use lumi_proto::caps::Mode;
use lumi_proto::crypto::MasterKey;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::RwLock;

#[derive(Clone)]
pub struct App {
    pub store: Arc<store::Store>,
    pub fingerprint: String,
    pub mode: Mode,
    pub gpus: Vec<GpuInfo>,
    /// `None` significa bloqueado. La telemetría sigue funcionando igual:
    /// no depende de la maestra, y que siga viva demuestra que la máquina
    /// está sana y solo falta desbloquear.
    pub master: Arc<RwLock<Option<MasterKey>>>,
    pub dir: PathBuf,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt::init();
    let dir = PathBuf::from(std::env::var("LUMI_DATA").unwrap_or_else(|_| "/var/lib/lumi".into()));
    std::fs::create_dir_all(&dir)?;

    let (tls_cfg, fingerprint) = tls::load(&dir).await?;
    let app = App {
        store: Arc::new(store::Store::open(&dir)?),
        fingerprint,
        mode: if std::path::Path::new("/.dockerenv").exists() { Mode::Docker } else { Mode::Native },
        gpus: gpus(),
        master: Arc::new(RwLock::new(None)),
        dir: dir.clone(),
    };

    let router = Router::new()
        .route("/v1/hello", get(routes::hello::get))
        .with_state(app);

    let port: u16 = std::env::var("LUMI_PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(lumi_proto::PORT);
    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    tracing::info!("lumid escuchando en https://{addr}");
    axum_server::bind_rustls(addr, tls_cfg)
        .serve(router.into_make_service())
        .await?;
    Ok(())
}

fn gpus() -> Vec<GpuInfo> {
    let Ok(nvml) = nvml_wrapper::Nvml::init() else { return vec![] };
    (0..nvml.device_count().unwrap_or(0))
        .filter_map(|i| {
            let d = nvml.device_by_index(i).ok()?;
            Some(GpuInfo {
                index: i,
                name: d.name().ok()?,
                vram_total_mb: d.memory_info().ok()?.total / 1024 / 1024,
                pcie: d.pci_info().ok()?.bus_id,
            })
        })
        .collect()
}
```

- [ ] **Paso 6: Arrancar y comprobar**

En un directorio de pruebas con el certificado ya generado por la tarea 6 (o copiando
`cert.der` y `key.pem` a `.dev-data/`):

```bash
LUMI_DATA=.dev-data cargo run -p lumid
```

En otra terminal:

```bash
curl -sk https://localhost:7717/v1/hello | python -m json.tool
```

Esperado: JSON con `"state": "unclaimed"`, `"locked": true`, la `fingerprint` y la lista de
capacidades. La huella devuelta debe coincidir con el campo de huella de la clave que
imprimió `lumi install`.

- [ ] **Paso 7: Commit**

```bash
git add crates/lumid
git commit -m "lumid: servidor TLS, almacén SQLite y GET /v1/hello"
```

---

## Tarea 8: Clave maestra, estado bloqueado y desbloqueo

**Archivos:**
- Crear: `crates/lumid/src/master.rs`, `crates/lumid/src/routes/auth.rs`
- Modificar: `crates/lumid/src/main.rs`, `crates/lumid/src/routes/mod.rs`

**Interfaces:**
- Consume: `App`, `lumi_proto::crypto::MasterKey`, `lumi_proto::api::UnsealReq`
- Produce:
  - `master::load_at_boot(dir: &Path) -> Option<MasterKey>` (automática) o `None` (sellada)
  - `master::unseal(dir: &Path, passphrase: &str) -> Result<MasterKey>`
  - `routes::auth::unseal` handler
  - `pub fn is_sealed(dir: &Path) -> bool`

- [ ] **Paso 1: Escribir `master.rs`**

```rust
//! Clave maestra.
//!
//! Automática: 32 bytes en systemd-creds, el servicio arranca solo. Protege
//! del disco robado en frío.
//!
//! Sellada: derivada de la frase del owner. Tras reiniciar, el daemon arranca
//! bloqueado y espera a que un administrador desbloquee desde la app. Protege
//! además contra incautación en caliente.

use anyhow::{bail, Context, Result};
use lumi_proto::crypto::MasterKey;
use std::path::Path;
use std::process::Command;

pub fn is_sealed(dir: &Path) -> bool {
    dir.join("master.salt").exists()
}

/// Devuelve `None` en modo sellado: el daemon arranca bloqueado a propósito.
pub fn load_at_boot(dir: &Path) -> Option<MasterKey> {
    if is_sealed(dir) {
        return None;
    }
    let out = Command::new("systemd-creds")
        .args(["decrypt", "--name=lumi-master"])
        .arg(dir.join("master.cred"))
        .arg("-")
        .output()
        .ok()?;
    if !out.status.success() || out.stdout.len() != 32 {
        return None;
    }
    let mut k = [0u8; 32];
    k.copy_from_slice(&out.stdout);
    Some(MasterKey::from_bytes(k))
}

pub fn unseal(dir: &Path, passphrase: &str) -> Result<MasterKey> {
    if !is_sealed(dir) {
        bail!("este servidor no está en modo sellado");
    }
    let salt = std::fs::read(dir.join("master.salt")).context("falta master.salt")?;
    let mk = MasterKey::derive(passphrase, &salt)?;
    // Comprobante: un blob sellado en la instalación. Si no abre, la frase es
    // incorrecta, y así se distingue de "frase correcta, dato corrupto".
    let probe = dir.join("master.probe");
    if probe.exists() {
        lumi_proto::crypto::open(&mk, &std::fs::read(&probe)?)
            .map_err(|_| anyhow::anyhow!("frase incorrecta"))?;
    } else {
        std::fs::write(&probe, lumi_proto::crypto::seal(&mk, b"lumi"))?;
    }
    Ok(mk)
}
```

- [ ] **Paso 2: Escribir `routes/auth.rs` (solo el desbloqueo por ahora)**

```rust
use crate::{master, App};
use axum::{extract::State, http::StatusCode, Json};
use lumi_proto::api::UnsealReq;

/// Desbloquea la maestra y reanuda la cola. En este subsistema la cola aún no
/// existe; el subsistema 4 engancha aquí su reanudación.
pub async fn unseal(
    State(app): State<App>,
    Json(req): Json<UnsealReq>,
) -> Result<StatusCode, (StatusCode, String)> {
    if app.master.read().await.is_some() {
        return Ok(StatusCode::NO_CONTENT);
    }
    let mk = master::unseal(&app.dir, &req.passphrase)
        .map_err(|e| (StatusCode::UNAUTHORIZED, e.to_string()))?;
    *app.master.write().await = Some(mk);
    tracing::info!("clave maestra desbloqueada");
    Ok(StatusCode::NO_CONTENT)
}
```

- [ ] **Paso 3: Enganchar en `main.rs`**

Añade `mod master;`, `pub mod auth;` en `routes/mod.rs`, y en `main`:

```rust
        master: Arc::new(RwLock::new(master::load_at_boot(&dir))),
```

```rust
    let router = Router::new()
        .route("/v1/hello", get(routes::hello::get))
        .route("/v1/unseal", axum::routing::post(routes::auth::unseal))
        .with_state(app);
```

- [ ] **Paso 4: Comprobar los dos modos**

Modo automático (sin `master.salt`):

```bash
LUMI_DATA=.dev-data cargo run -p lumid
curl -sk https://localhost:7717/v1/hello | grep -o '"locked":[a-z]*'
```

Esperado: `"locked":false` si `systemd-creds` funcionó; `"locked":true` si no hay
systemd-creds en el host de desarrollo, que es lo normal fuera de Linux con systemd.

Modo sellado:

```bash
head -c 16 /dev/urandom > .dev-data/master.salt
LUMI_DATA=.dev-data cargo run -p lumid &
curl -sk https://localhost:7717/v1/hello | grep -o '"locked":[a-z]*'
curl -sk -X POST https://localhost:7717/v1/unseal \
  -H 'content-type: application/json' -d '{"passphrase":"frase del owner"}' -w '%{http_code}\n'
curl -sk https://localhost:7717/v1/hello | grep -o '"locked":[a-z]*'
```

Esperado en orden: `"locked":true` · `204` · `"locked":false`. Repetir el desbloqueo con
otra frase después de reiniciar el daemon debe devolver `401 frase incorrecta`.

- [ ] **Paso 5: Commit**

```bash
git add crates/lumid
git commit -m "lumid: clave maestra automática y sellada, estado bloqueado y desbloqueo"
```

---

## Tarea 9: Canje, administrador y sesión

**Archivos:**
- Crear: `crates/lumid/src/routes/claim.rs`
- Modificar: `crates/lumid/src/routes/auth.rs`, `crates/lumid/src/routes/mod.rs`, `crates/lumid/src/main.rs`

**Interfaces:**
- Consume: `lumi_proto::api::{ClaimReq, ClaimRes, AdminReq, LoginReq, LoginRes}`,
  `lumi_proto::crypto::{hash_password, verify_password}`
- Produce:
  - `routes::claim::claim`, `routes::claim::create_admin`, `routes::auth::login`
  - `pub fn new_token() -> String` en `claim.rs`
  - `pub async fn require_admin(app: &App, token: &str) -> Result<i64, StatusCode>` en `auth.rs`

- [ ] **Paso 1: Escribir `routes/claim.rs`**

```rust
//! Canje de la clave de vinculación.
//!
//! El secreto se marca consumido en la misma transacción en que se valida, así
//! que dos clientes que canjeen a la vez no pueden crear dos administradores.

use crate::App;
use axum::{extract::State, http::StatusCode, Json};
use lumi_proto::api::{AdminReq, ClaimReq, ClaimRes};
use lumi_proto::crypto::{hash_password, verify_password};
use rand::RngCore;

const BOOTSTRAP_TTL_S: u32 = 600;

pub fn new_token() -> String {
    let mut b = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut b);
    bs58::encode(b).into_string()
}

fn now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64
}

pub async fn claim(
    State(app): State<App>,
    Json(req): Json<ClaimReq>,
) -> Result<Json<ClaimRes>, (StatusCode, String)> {
    let bad = |m: &str| (StatusCode::UNAUTHORIZED, m.to_string());
    let token = {
        let c = app.store.conn();
        let (phc, expires, consumed): (String, Option<i64>, i64) = c
            .query_row(
                "SELECT secret_phc, expires_at, consumed FROM pair_key WHERE id = 1",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .map_err(|_| bad("este servidor no tiene clave de vinculación emitida"))?;
        if consumed == 1 {
            return Err(bad("la clave ya se canjeó; entra con tus credenciales"));
        }
        if expires.is_some_and(|e| now() > e) {
            return Err(bad("la clave caducó; ejecuta lumi key reissue en el host"));
        }
        if !verify_password(&req.secret, &phc) {
            return Err(bad("clave incorrecta"));
        }
        let token = new_token();
        c.execute("UPDATE pair_key SET consumed = 1 WHERE id = 1", [])
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        c.execute(
            "INSERT INTO sessions (token, user_id, expires_at) VALUES (?1, 0, ?2)",
            rusqlite::params![token, now() + BOOTSTRAP_TTL_S as i64],
        )
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        token
    };
    Ok(Json(ClaimRes {
        bootstrap_token: token,
        expires_in_s: BOOTSTRAP_TTL_S,
    }))
}

/// La sesión de bootstrap solo autoriza esto. Se consume al usarse.
pub async fn create_admin(
    State(app): State<App>,
    Json(req): Json<AdminReq>,
) -> Result<StatusCode, (StatusCode, String)> {
    if req.username.trim().is_empty() || req.password.len() < 12 {
        return Err((
            StatusCode::BAD_REQUEST,
            "usuario vacío o contraseña de menos de 12 caracteres".into(),
        ));
    }
    let c = app.store.conn();
    let valid: i64 = c
        .query_row(
            "SELECT COUNT(*) FROM sessions WHERE token = ?1 AND user_id = 0 AND expires_at > ?2",
            rusqlite::params![req.bootstrap_token, now()],
            |r| r.get(0),
        )
        .unwrap_or(0);
    if valid == 0 {
        return Err((StatusCode::UNAUTHORIZED, "sesión de bootstrap inválida o caducada".into()));
    }
    let phc = hash_password(&req.password)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    c.execute(
        "INSERT INTO users (username, password_phc, is_admin, created_at) VALUES (?1, ?2, 1, ?3)",
        rusqlite::params![req.username.trim(), phc, now()],
    )
    .map_err(|e| (StatusCode::CONFLICT, e.to_string()))?;
    c.execute("DELETE FROM sessions WHERE token = ?1", [&req.bootstrap_token])
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(StatusCode::CREATED)
}
```

Añade `bs58 = "0.5"` y `rand = "0.8"` a `crates/lumid/Cargo.toml`.

- [ ] **Paso 2: Añadir `login` y `require_admin` a `routes/auth.rs`**

```rust
use crate::routes::claim::new_token;
use lumi_proto::api::{LoginReq, LoginRes};
use lumi_proto::crypto::verify_password;

const SESSION_TTL_S: i64 = 12 * 3600;

pub async fn login(
    State(app): State<App>,
    Json(req): Json<LoginReq>,
) -> Result<Json<LoginRes>, (StatusCode, String)> {
    let c = app.store.conn();
    let row: Result<(i64, String, i64), _> = c.query_row(
        "SELECT id, password_phc, is_admin FROM users WHERE username = ?1",
        [&req.username],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
    );
    // Mismo mensaje para usuario inexistente y contraseña mala: no filtramos
    // qué nombres existen en el servidor.
    let denied = (StatusCode::UNAUTHORIZED, "usuario o contraseña incorrectos".to_string());
    let Ok((id, phc, is_admin)) = row else { return Err(denied) };
    if !verify_password(&req.password, &phc) {
        return Err(denied);
    }
    let token = new_token();
    let exp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64
        + SESSION_TTL_S;
    c.execute(
        "INSERT INTO sessions (token, user_id, expires_at) VALUES (?1, ?2, ?3)",
        rusqlite::params![token, id, exp],
    )
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(LoginRes { token, is_admin: is_admin == 1 }))
}

/// Devuelve el id del usuario si el token es de un administrador vivo.
pub fn require_admin(app: &App, token: &str) -> Result<i64, StatusCode> {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64;
    app.store
        .conn()
        .query_row(
            "SELECT u.id FROM sessions s JOIN users u ON u.id = s.user_id
             WHERE s.token = ?1 AND s.expires_at > ?2 AND u.is_admin = 1",
            rusqlite::params![token, now],
            |r| r.get(0),
        )
        .map_err(|_| StatusCode::UNAUTHORIZED)
}
```

- [ ] **Paso 3: Registrar las rutas**

En `main.rs`:

```rust
    use axum::routing::post;
    let router = Router::new()
        .route("/v1/hello", get(routes::hello::get))
        .route("/v1/claim", post(routes::claim::claim))
        .route("/v1/admin", post(routes::claim::create_admin))
        .route("/v1/auth/login", post(routes::auth::login))
        .route("/v1/unseal", post(routes::auth::unseal))
        .with_state(app);
```

- [ ] **Paso 4: Recorrer el flujo completo a mano**

Con el daemon arrancado y una clave emitida por `lumi install` (o insertada a mano en
`pair_key`), donde `$SECRET` es el último campo de la clave:

```bash
TOK=$(curl -sk -X POST https://localhost:7717/v1/claim -H 'content-type: application/json' \
  -d "{\"secret\":\"$SECRET\"}" | python -c 'import sys,json;print(json.load(sys.stdin)["bootstrap_token"])')
curl -sk -X POST https://localhost:7717/v1/admin -H 'content-type: application/json' \
  -d "{\"bootstrap_token\":\"$TOK\",\"username\":\"inigo\",\"password\":\"contraseña larga\"}" -w '%{http_code}\n'
curl -sk -X POST https://localhost:7717/v1/claim -H 'content-type: application/json' \
  -d "{\"secret\":\"$SECRET\"}" -w '%{http_code}\n'
curl -sk https://localhost:7717/v1/hello | grep -o '"state":"[a-z]*"'
```

Esperado en orden: `201` al crear el administrador · `401` al reintentar el canje, con el
texto «la clave ya se canjeó» · `"state":"claimed"`.

- [ ] **Paso 5: Commit**

```bash
git add crates/lumid
git commit -m "lumid: canje de clave, creación del administrador y sesiones"
```

---

## Tarea 10: Runner de tareas con log reanudable

**Archivos:**
- Crear: `crates/lumid/src/tasks.rs`, `crates/lumid/src/routes/tasks.rs`
- Modificar: `crates/lumid/src/main.rs`, `crates/lumid/src/routes/mod.rs`

**Interfaces:**
- Consume: `App`, `auth::require_admin`, `lumi_proto::api::{TaskSpec, TaskKind, TaskStatus}`
- Produce:
  - `tasks::spawn(app: &App, kind: TaskKind) -> Result<String>` devuelve el id
  - `tasks::status(app: &App, id: &str) -> Option<TaskStatus>`
  - `tasks::log_path(dir: &Path, id: &str) -> PathBuf`
  - handlers `routes::tasks::{create, get, log_sse}`

- [ ] **Paso 1: Escribir `tasks.rs`**

```rust
//! Runner de tareas del servidor.
//!
//! Las instalaciones pesadas (torch, CUDA, base de datos) no son peticiones
//! HTTP largas: corren aquí, escriben a un log persistente y el cliente se
//! engancha y desengancha por offset. Cerrar la app no aborta nada.
//!
//! Es el mismo primitivo que consumirá la cola del subsistema 4.

use crate::App;
use anyhow::Result;
use lumi_proto::api::{TaskKind, TaskStatus};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use tokio::io::{AsyncBufReadExt, BufReader};

pub fn log_path(dir: &Path, id: &str) -> PathBuf {
    dir.join("tasks").join(format!("{id}.log"))
}

fn now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64
}

/// El comando de cada tipo de tarea. Un script por tipo, no un motor de
/// pipelines: hay dos tipos y no se esperan más en este subsistema.
fn command(kind: TaskKind, dir: &Path) -> (String, Vec<String>) {
    let venv = dir.join("venv");
    match kind {
        TaskKind::InferenceRuntime => (
            "/bin/sh".into(),
            vec![
                "-c".into(),
                format!(
                    "set -e; python3 -m venv {v}; {v}/bin/pip install --upgrade pip; \
                     {v}/bin/pip install --retries 5 --timeout 60 \
                     torch --index-url https://download.pytorch.org/whl/cu126",
                    v = venv.display()
                ),
            ],
        ),
        TaskKind::Database => (
            "/bin/sh".into(),
            vec!["-c".into(), "echo 'esquema aplicado por lumid al arrancar'".into()],
        ),
    }
}

pub fn spawn(app: &App, kind: TaskKind) -> Result<String> {
    let id = crate::routes::claim::new_token()[..12].to_string();
    std::fs::create_dir_all(app.dir.join("tasks"))?;
    let path = log_path(&app.dir, &id);
    std::fs::File::create(&path)?;

    app.store.conn().execute(
        "INSERT INTO tasks (id, kind, running, exit_code, started_at) VALUES (?1, ?2, 1, NULL, ?3)",
        rusqlite::params![id, serde_json::to_string(&kind)?, now()],
    )?;

    let (bin, args) = command(kind, &app.dir);
    let store = app.store.clone();
    let id2 = id.clone();
    tokio::spawn(async move {
        let mut child = match tokio::process::Command::new(bin)
            .args(args)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
        {
            Ok(c) => c,
            Err(e) => {
                let _ = append(&path, &format!("FATAL no se pudo lanzar: {e}\n"));
                finish(&store, &id2, Some(-1));
                return;
            }
        };
        // stdout y stderr al mismo log, en orden de llegada: es lo que el
        // operador quiere leer, no dos flujos que casar a mano.
        let out = BufReader::new(child.stdout.take().unwrap());
        let err = BufReader::new(child.stderr.take().unwrap());
        let p1 = path.clone();
        let p2 = path.clone();
        let a = tokio::spawn(async move {
            let mut l = out.lines();
            while let Ok(Some(line)) = l.next_line().await {
                let _ = append(&p1, &format!("{line}\n"));
            }
        });
        let b = tokio::spawn(async move {
            let mut l = err.lines();
            while let Ok(Some(line)) = l.next_line().await {
                let _ = append(&p2, &format!("{line}\n"));
            }
        });
        let code = child.wait().await.ok().and_then(|s| s.code());
        let _ = a.await;
        let _ = b.await;
        finish(&store, &id2, code);
    });
    Ok(id)
}

fn append(path: &Path, line: &str) -> std::io::Result<()> {
    std::fs::OpenOptions::new()
        .append(true)
        .open(path)?
        .write_all(line.as_bytes())
}

fn finish(store: &crate::store::Store, id: &str, code: Option<i32>) {
    let _ = store.conn().execute(
        "UPDATE tasks SET running = 0, exit_code = ?2 WHERE id = ?1",
        rusqlite::params![id, code],
    );
}

pub fn status(app: &App, id: &str) -> Option<TaskStatus> {
    let (kind, running, exit_code): (String, i64, Option<i32>) = app
        .store
        .conn()
        .query_row(
            "SELECT kind, running, exit_code FROM tasks WHERE id = ?1",
            [id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .ok()?;
    Some(TaskStatus {
        id: id.into(),
        kind: serde_json::from_str(&kind).ok()?,
        running: running == 1,
        exit_code,
        log_len: std::fs::metadata(log_path(&app.dir, id)).map(|m| m.len()).unwrap_or(0),
    })
}
```

- [ ] **Paso 2: Escribir `routes/tasks.rs`**

```rust
//! El log se sirve por SSE desde un offset. El cliente que se reengancha
//! manda `?from=<bytes>` y recibe solo lo que se perdió, no el log entero.

use crate::{routes::auth::require_admin, tasks, App};
use axum::extract::{Path, Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::sse::{Event, Sse};
use axum::Json;
use futures::stream::Stream;
use lumi_proto::api::{TaskSpec, TaskStatus};
use serde::Deserialize;
use std::convert::Infallible;
use std::io::{Read, Seek, SeekFrom};
use std::time::Duration;

fn token(h: &HeaderMap) -> String {
    h.get("authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .unwrap_or_default()
        .to_string()
}

pub async fn create(
    State(app): State<App>,
    headers: HeaderMap,
    Json(spec): Json<TaskSpec>,
) -> Result<Json<TaskStatus>, StatusCode> {
    require_admin(&app, &token(&headers))?;
    let id = tasks::spawn(&app, spec.kind).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    tasks::status(&app, &id).map(Json).ok_or(StatusCode::INTERNAL_SERVER_ERROR)
}

pub async fn get(
    State(app): State<App>,
    Path(id): Path<String>,
) -> Result<Json<TaskStatus>, StatusCode> {
    tasks::status(&app, &id).map(Json).ok_or(StatusCode::NOT_FOUND)
}

#[derive(Deserialize)]
pub struct From {
    #[serde(default)]
    from: u64,
}

pub async fn log_sse(
    State(app): State<App>,
    Path(id): Path<String>,
    Query(q): Query<From>,
) -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    let path = tasks::log_path(&app.dir, &id);
    let mut offset = q.from;
    let stream = async_stream::stream! {
        loop {
            let mut buf = String::new();
            if let Ok(mut f) = std::fs::File::open(&path) {
                if f.seek(SeekFrom::Start(offset)).is_ok() {
                    let n = f.read_to_string(&mut buf).unwrap_or(0);
                    offset += n as u64;
                }
            }
            if !buf.is_empty() {
                // El id del evento es el offset: si el cliente se cae, vuelve
                // con ese número y no pierde ni repite una línea.
                yield Ok(Event::default().id(offset.to_string()).data(buf));
            }
            tokio::time::sleep(Duration::from_millis(400)).await;
        }
    };
    Sse::new(stream).keep_alive(axum::response::sse::KeepAlive::default())
}
```

Añade `async-stream = "0.3"` a `crates/lumid/Cargo.toml`.

- [ ] **Paso 3: Registrar las rutas**

```rust
        .route("/v1/tasks", post(routes::tasks::create))
        .route("/v1/tasks/:id", get(routes::tasks::get))
        .route("/v1/tasks/:id/log", get(routes::tasks::log_sse))
```

- [ ] **Paso 4: Probar el reenganche**

Con una sesión de administrador en `$T`:

```bash
ID=$(curl -sk -X POST https://localhost:7717/v1/tasks -H "authorization: Bearer $T" \
  -H 'content-type: application/json' -d '{"kind":"database"}' \
  | python -c 'import sys,json;print(json.load(sys.stdin)["id"])')
curl -skN "https://localhost:7717/v1/tasks/$ID/log?from=0" &
sleep 2 && kill %1
curl -sk "https://localhost:7717/v1/tasks/$ID"
curl -skN "https://localhost:7717/v1/tasks/$ID/log?from=0" | head -3
```

Esperado: el primer SSE emite la línea `esquema aplicado por lumid al arrancar` con un `id:`
igual al número de bytes. Tras matarlo, `GET /v1/tasks/$ID` responde `"running": false` y
`"exit_code": 0`. El segundo enganche desde `from=0` reproduce el log completo, lo que
demuestra que sobrevivió a la desconexión.

- [ ] **Paso 5: Commit**

```bash
git add crates/lumid
git commit -m "lumid: runner de tareas con log persistente y SSE reanudable por offset"
```

---

## Tarea 11: Telemetría por SSE

**Archivos:**
- Crear: `crates/lumid/src/telemetry.rs`, `crates/lumid/src/routes/telemetry.rs`
- Modificar: `crates/lumid/src/main.rs`, `crates/lumid/src/routes/mod.rs`

**Interfaces:**
- Consume: `App`, `lumi_proto::api::{Sample, GpuSample}`
- Produce: `telemetry::sample(app: &App) -> Sample`, handler `routes::telemetry::sse`

- [ ] **Paso 1: Escribir `telemetry.rs`**

```rust
//! Muestreo de hardware. Deliberadamente independiente de la clave maestra:
//! sigue funcionando con el servidor sellado, y que siga viva demuestra que la
//! máquina está sana y solo falta desbloquear.

use crate::App;
use lumi_proto::api::{GpuSample, Sample};

pub fn sample(app: &App) -> Sample {
    let gpus = match nvml_wrapper::Nvml::init() {
        Ok(nvml) => (0..nvml.device_count().unwrap_or(0))
            .filter_map(|i| {
                let d = nvml.device_by_index(i).ok()?;
                let m = d.memory_info().ok()?;
                Some(GpuSample {
                    index: i,
                    util_pct: d.utilization_rates().map(|u| u.gpu).unwrap_or(0),
                    vram_used_mb: m.used / 1024 / 1024,
                    vram_total_mb: m.total / 1024 / 1024,
                    // En Docker sin --privileged esto falla, y por eso la
                    // capacidad `nvml` se anuncia como parcial.
                    temp_c: d
                        .temperature(nvml_wrapper::enum_wrappers::device::TemperatureSensor::Gpu)
                        .ok(),
                })
            })
            .collect(),
        Err(_) => vec![],
    };

    let mut s = sysinfo::System::new();
    s.refresh_cpu_all();
    s.refresh_memory();
    let cpu_pct = if s.cpus().is_empty() {
        0.0
    } else {
        s.cpus().iter().map(|c| c.cpu_usage()).sum::<f32>() / s.cpus().len() as f32
    };
    let disks = sysinfo::Disks::new_with_refreshed_list();
    let disk_free_mb = disks
        .list()
        .iter()
        .map(|d| d.available_space() / 1024 / 1024)
        .max()
        .unwrap_or(0);

    Sample {
        gpus,
        cpu_pct,
        ram_used_mb: s.used_memory() / 1024 / 1024,
        disk_free_mb,
        // La cola llega en el subsistema 4. Hasta entonces, cero y no pausada:
        // la franja ya tiene su celda y no habrá que rediseñarla.
        queue_depth: 0,
        queue_paused: app.master.try_read().map(|m| m.is_none()).unwrap_or(false),
    }
}
```

- [ ] **Paso 2: Escribir `routes/telemetry.rs`**

```rust
use crate::{telemetry, App};
use axum::extract::State;
use axum::response::sse::{Event, KeepAlive, Sse};
use futures::stream::Stream;
use std::convert::Infallible;
use std::time::Duration;

pub async fn sse(State(app): State<App>) -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    let stream = async_stream::stream! {
        loop {
            let s = telemetry::sample(&app);
            yield Ok(Event::default().json_data(&s).unwrap_or_default());
            tokio::time::sleep(Duration::from_secs(1)).await;
        }
    };
    Sse::new(stream).keep_alive(KeepAlive::default())
}
```

- [ ] **Paso 3: Registrar la ruta**

```rust
        .route("/v1/telemetry", get(routes::telemetry::sse))
```

- [ ] **Paso 4: Comprobar que sobrevive al bloqueo**

Con el daemon en modo sellado y sin desbloquear:

```bash
curl -skN https://localhost:7717/v1/telemetry | head -3
```

Esperado: una línea `data: {...}` por segundo, con `"queue_paused":true` y `"cpu_pct"`
distinto de cero. En una máquina sin NVIDIA, `"gpus":[]`, y eso es correcto: la telemetría
del sistema no depende de las GPUs.

- [ ] **Paso 5: Commit**

```bash
git add crates/lumid
git commit -m "lumid: telemetría de GPU, CPU y disco por SSE"
```

---

## Tarea 12: Cliente Tauri, tokens y fondo

**Archivos:**
- Crear: `client/package.json`, `client/vite.config.ts`, `client/tailwind.config.ts`,
  `client/index.html`, `client/src/main.tsx`, `client/src/App.tsx`, `client/src/index.css`
- Crear: `client/src-tauri/Cargo.toml`, `client/src-tauri/tauri.conf.json`,
  `client/src-tauri/src/main.rs`
- Crear: `client/src/ui/PlanetBackground.tsx`

**Interfaces:**
- Produce: aplicación Tauri que arranca mostrando el fondo de planeta a pantalla completa.

- [ ] **Paso 1: Andamiar el proyecto**

```bash
cd client
npm create vite@latest . -- --template react-ts --yes
npm i
npm i -D tailwindcss postcss autoprefixer @tauri-apps/cli
npm i @tauri-apps/api zustand
npx tailwindcss init -p
npx tauri init --app-name "Lumi Station" --window-title "Lumi Station" \
  --frontend-dist ../dist --dev-url http://localhost:5173 \
  --before-dev-command "npm run dev" --before-build-command "npm run build"
```

- [ ] **Paso 2: Escribir `tailwind.config.ts`**

Copiado de la v1. No inventar tokens.

```ts
import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#0e0f11",
        surface: "#15171a",
        panel: "#1a1b1e",
        elevated: "#202226",
        border: "#26282c",
        muted: "#9a9a95",
        subtle: "#6a6c70",
        fg: "#e8e8e6",
        accent: { DEFAULT: "#f2f3f5", fg: "#e8e8e6" },
        draw: { DEFAULT: "#378add", fg: "#85b7eb" },
        warning: { DEFAULT: "#ef9f27", fg: "#efb968" },
        danger: { DEFAULT: "#a33", fg: "#e88f8f" },
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      borderRadius: { card: "12px" },
      transitionTimingFunction: { expo: "cubic-bezier(.16,1,.3,1)" },
    },
  },
  plugins: [],
};
export default config;
```

- [ ] **Paso 3: Escribir `src/index.css`**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

html, body, #root { height: 100%; }
body { background: #0e0f11; color: #e8e8e6; overflow: hidden; }

/* Keyframes heredados de globals.css de la v1. Mismos nombres y tiempos. */
@keyframes lumi-planet-spin { from { transform: translateX(0); } to { transform: translateX(-50%); } }
@keyframes lumi-orbit { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
@keyframes lumi-twinkle { 0%, 100% { opacity: .2; } 50% { opacity: .9; } }
@keyframes lumi-spin { to { transform: rotate(360deg); } }
@keyframes jg-fade-rise { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
@keyframes jg-lock-breathe { 0%, 100% { opacity: .7; transform: scale(1); } 50% { opacity: 1; transform: scale(1.06); } }
@keyframes jg-alert-pulse { 0%, 100% { opacity: .5; } 50% { opacity: 1; } }
@keyframes jg-scan { 0%, 70%, 100% { opacity: .22; } 25% { opacity: 1; } }
@keyframes lumi-tumble-fall {
  0%   { transform: rotate(224deg) translateY(-260px) rotate(-224deg); opacity: 1; }
  10%  { transform: rotate(224deg) translateY(-260px) rotate(-224deg); opacity: 1; }
  78%  { transform: rotate(224deg) translateY(-260px) translate(-96px, 150px); opacity: .5; }
  100% { transform: rotate(224deg) translateY(-260px) translate(-150px, 250px); opacity: 0; }
}
@media (prefers-reduced-motion: reduce) { .lumi-anim { animation: none !important; } }
```

- [ ] **Paso 4: Escribir `src/ui/PlanetBackground.tsx`**

Portado valor por valor del componente de la v1. Prohibido añadir nebulosas, paralaje,
polvo estelar ni luces de ciudad: se probó y rompe la esencia del original.

```tsx
const STARS = [
  { t: "8%", l: "12%", d: "0s" }, { t: "16%", l: "76%", d: ".6s" }, { t: "26%", l: "40%", d: "1.2s" },
  { t: "12%", l: "58%", d: "1.8s" }, { t: "70%", l: "8%", d: ".4s" }, { t: "82%", l: "30%", d: "2.1s" },
  { t: "60%", l: "88%", d: "1.5s" }, { t: "40%", l: "92%", d: ".9s" },
];

const PLANET_TEX =
  "radial-gradient(70px 46px at 8% 32%,rgba(255,255,255,.06),transparent 70%)," +
  "radial-gradient(90px 56px at 26% 64%,rgba(0,0,0,.28),transparent 70%)," +
  "radial-gradient(56px 44px at 44% 40%,rgba(255,255,255,.05),transparent 70%)," +
  "radial-gradient(100px 66px at 62% 72%,rgba(0,0,0,.24),transparent 70%)," +
  "radial-gradient(70px 46px at 58% 32%,rgba(255,255,255,.06),transparent 70%),#3a3f47";

/** `dead` es el estado degradado de la v1: planeta apagado, órbita punteada
 *  ámbar y restos cayendo. Se reutiliza para servidor reiniciando, con error,
 *  sellado o sin conexión. */
export function PlanetBackground({ dead = false }: { dead?: boolean }) {
  return (
    <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden bg-[#05070a]">
      {STARS.map((s, i) => (
        <span key={i} className="lumi-anim absolute h-0.5 w-0.5 rounded-full bg-white"
          style={{ top: s.t, left: s.l, animation: `lumi-twinkle ${dead ? 5 : 3}s ease-in-out ${s.d} infinite`,
                   opacity: dead ? 0.5 : undefined }} />
      ))}
      <div className="absolute -right-40 -bottom-52 h-[520px] w-[520px] overflow-hidden rounded-full"
        style={{ background: "#33383f",
                 boxShadow: "0 0 130px 24px rgba(150,160,175,.10), inset -34px -22px 90px rgba(0,0,0,.65)",
                 filter: dead ? "saturate(0.55) brightness(0.75)" : undefined }}>
        <div className="lumi-anim absolute left-0 top-0 h-full w-[200%]"
          style={{ animation: `lumi-planet-spin ${dead ? 220 : 70}s linear infinite`, background: PLANET_TEX }} />
        <div className="absolute inset-0 rounded-full"
          style={{ background: "radial-gradient(circle at 30% 28%,transparent 42%,rgba(0,0,0,.55) 100%)" }} />
      </div>
      {!dead && (
        <div className="lumi-anim absolute -bottom-32 left-1/2 -ml-[260px] h-[520px] w-[520px]"
          style={{ animation: "lumi-orbit 14s linear infinite" }}>
          <div className="absolute -top-1 left-1/2 -ml-[3px] h-[7px] w-[7px] rounded-full bg-[#f4f6f9]"
            style={{ boxShadow: "0 0 10px 2px rgba(255,255,255,.6)" }} />
        </div>
      )}
      {dead && (
        <>
          <div className="absolute -bottom-32 left-1/2 -ml-[260px] h-[520px] w-[520px] rounded-full"
            style={{ border: "1px dashed rgba(239,159,39,0.22)", clipPath: "polygon(0 0, 100% 0, 100% 62%, 0 62%)" }} />
          {[
            { size: 8, color: "#e88f8f", glow: true, delay: "0s" },
            { size: 6, color: "rgba(239,159,39,0.55)", glow: false, delay: "-0.22s" },
            { size: 4, color: "rgba(239,159,39,0.3)", glow: false, delay: "-0.4s" },
          ].map((dot, i) => (
            <div key={i} className="lumi-anim absolute -bottom-32 left-1/2"
              style={{ marginLeft: -dot.size / 2, top: -4, height: dot.size, width: dot.size,
                       borderRadius: "50%", background: dot.color,
                       boxShadow: dot.glow ? "0 0 9px 2px rgba(239,159,39,0.4)" : "none",
                       animation: `lumi-tumble-fall 4.2s cubic-bezier(.55,0,.75,1) ${dot.delay} infinite` }} />
          ))}
        </>
      )}
    </div>
  );
}
```

- [ ] **Paso 5: Montar `App.tsx`**

```tsx
import { PlanetBackground } from "./ui/PlanetBackground";

export default function App() {
  return (
    <div className="relative h-full overflow-hidden">
      <PlanetBackground />
    </div>
  );
}
```

Y en `src/main.tsx`, importa `./index.css`.

- [ ] **Paso 6: Arrancar**

```bash
cd client && npm run tauri dev
```

Esperado: ventana de escritorio con fondo `#05070a`, ocho estrellas parpadeando, el planeta
girando en la esquina inferior derecha y el satélite orbitando. Compara con el mockup: debe
ser indistinguible.

- [ ] **Paso 7: Commit**

```bash
git add client
git commit -m "Cliente Tauri: andamiaje, tokens de la v1 y fondo de planeta"
```

---

## Tarea 13: Iconos y shell del wizard

**Archivos:**
- Crear: `client/src/ui/Icon.tsx`, `client/src/wizard/Wizard.tsx`

**Interfaces:**
- Consume: nada.
- Produce:
  - `Icon` con `name: "check" | "pause" | "spinner" | "lock" | "alert" | "refresh" | "signal-off" | "chevron"`,
    props `size?: number` (por defecto 13), `className?: string`
  - `Wizard` con props `{ step: number; title: string; subtitle: string; children: ReactNode; onBack?: () => void; onNext?: () => void; nextLabel?: string; nextDisabled?: boolean }`
  - `export const STEPS = ["Vincular","Admin","Runtime","Datos","Modelos","Listo"] as const`

- [ ] **Paso 1: Escribir `Icon.tsx`**

Un solo componente. `viewBox` 24 siempre, `strokeWidth` 1.8 salvo el candado y el check.

```tsx
const PATHS: Record<string, JSX.Element> = {
  check: <path d="M20 6 9 17l-5-5" />,
  pause: <path d="M9 5v14M15 5v14" />,
  spinner: <path d="M21 12a9 9 0 1 1-2.64-6.36" />,
  refresh: <><path d="M21 12a9 9 0 1 1-2.64-6.36" /><path d="M21 3.5V9h-5.5" /></>,
  alert: (
    <>
      <path d="M12 3.2 22.2 20.8H1.8z" />
      <g style={{ animation: "jg-alert-pulse 2.2s ease-in-out infinite" }}>
        <path d="M12 9.8v4.4" />
        <circle cx="12" cy="17.4" r=".6" fill="currentColor" stroke="none" />
      </g>
    </>
  ),
  chevron: <path d="M6 9l6 6 6-6" />,
  "signal-off": (
    <>
      {[
        "M4.5 9.6a12 12 0 0 1 15 0",
        "M7.7 13.1a7.6 7.6 0 0 1 8.6 0",
        "M10.8 16.5a3.2 3.2 0 0 1 2.4 0",
      ].map((d, i) => (
        <path key={d} d={d} style={{ animation: `jg-scan 2.4s ${i * 0.18}s ease-in-out infinite` }} />
      ))}
      <circle cx="12" cy="19.4" r=".6" fill="currentColor" stroke="none" />
      <path d="M3.8 3.8 20.2 20.2" />
    </>
  ),
};

/** El candado es aparte: su arco se anima al abrirse. */
export function LockIcon({ size = 13, open = false, className = "" }:
  { size?: number; open?: boolean; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className={className}
      style={open ? undefined : { animation: "jg-lock-breathe 2.6s ease-in-out infinite" }}>
      <rect x="5" y="11" width="14" height="9" rx="1.5" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4"
        style={{
          transformBox: "fill-box", transformOrigin: "0% 100%",
          transform: open ? "translateY(-2.2px) rotate(-17deg)" : "none",
          transition: "transform .75s cubic-bezier(.16,1,.3,1)",
        }} />
    </svg>
  );
}

export function Icon({ name, size = 13, className = "" }:
  { name: keyof typeof PATHS; size?: number; className?: string }) {
  const spin = name === "spinner" || name === "refresh";
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={name === "check" || name === "chevron" ? 2 : 1.8}
      strokeLinecap="round" strokeLinejoin="round"
      className={`shrink-0 ${className}`}
      style={spin ? { animation: `lumi-spin ${size > 20 ? 2.6 : 1.1}s linear infinite` } : undefined}>
      {PATHS[name]}
    </svg>
  );
}
```

- [ ] **Paso 2: Escribir `Wizard.tsx`**

```tsx
import type { ReactNode } from "react";
import { Icon } from "../ui/Icon";

export const STEPS = ["Vincular", "Admin", "Runtime", "Datos", "Modelos", "Listo"] as const;

export function Wizard({ step, title, subtitle, children, onBack, onNext, nextLabel = "Siguiente", nextDisabled }: {
  step: number; title: string; subtitle: string; children: ReactNode;
  onBack?: () => void; onNext?: () => void; nextLabel?: string; nextDisabled?: boolean;
}) {
  return (
    <div className="relative z-10 mx-auto max-w-xl px-6 py-9">
      <div className="mb-1 flex items-center gap-2.5" style={{ animation: "jg-fade-rise .7s both" }}>
        <span className="text-fg" style={{ animation: "jg-lock-breathe 2.4s ease-in-out infinite" }}>✦</span>
        <span className="text-[17px] font-medium text-fg">{title}</span>
      </div>
      <p className="mb-6 text-xs text-muted" style={{ animation: "jg-fade-rise .7s .06s both" }}>
        Paso {step + 1} de {STEPS.length} · {subtitle}
      </p>

      <div className="relative mb-6 flex items-start justify-between" style={{ animation: "jg-fade-rise .7s .12s both" }}>
        <div className="absolute left-[6%] right-[6%] top-3.5 h-0.5 bg-white/[.09]" />
        <div className="absolute left-[6%] top-3.5 h-0.5 rounded bg-accent transition-[width] duration-[900ms] ease-expo"
          style={{ width: `${(step / (STEPS.length - 1)) * 88}%` }} />
        {STEPS.map((label, i) => {
          const state = i < step ? "done" : i === step ? "now" : "todo";
          return (
            <div key={label} className="relative flex flex-1 flex-col items-center gap-1.5">
              <div className={`flex h-7 w-7 items-center justify-center rounded-full font-mono text-[11px] transition-all duration-500 ease-expo ${
                state === "done" ? "border border-accent bg-accent text-black"
                : state === "now" ? "border-2 border-accent bg-bg text-fg"
                : "border border-white/15 bg-white/5 text-subtle"}`}>
                {state === "done" ? <Icon name="check" size={13} /> : i + 1}
              </div>
              <span className={`text-center text-[10.5px] leading-tight ${i === step ? "text-fg" : "text-subtle"}`}>{label}</span>
            </div>
          );
        })}
      </div>

      <div className="rounded-card border border-white/[.13] bg-[rgba(16,19,25,.66)] p-5 shadow-lg shadow-black/40 backdrop-blur-xl"
        style={{ animation: "jg-fade-rise .8s .18s both" }}>
        {children}
      </div>

      <div className="mt-4 flex items-center justify-between gap-3">
        <button onClick={onBack} disabled={!onBack}
          className="rounded-lg border border-white/15 px-4 py-2 text-xs text-fg transition-transform duration-300 ease-expo active:translate-y-px disabled:opacity-40">
          Atrás
        </button>
        {onNext && (
          <button onClick={onNext} disabled={nextDisabled}
            className="rounded-lg bg-accent px-5 py-2 text-xs font-medium text-black transition-transform duration-300 ease-expo active:translate-y-px disabled:opacity-40">
            {nextLabel}
          </button>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Paso 3: Comprobar visualmente**

Renderiza el wizard vacío en `App.tsx` con `step={0}` y un `<div className="h-24" />` dentro,
arranca `npm run tauri dev` y compara con el mockup: burbujas de 28 px, riel al 6% de margen,
tarjeta de cristal, botones en las esquinas.

- [ ] **Paso 4: Commit**

```bash
git add client/src
git commit -m "Cliente: set de iconos con el patrón de la v1 y shell del wizard"
```

---

## Tarea 14: Paso de vinculación con verificación de huella

**Archivos:**
- Crear: `client/src/lib/api.ts`, `client/src/lib/store.ts`, `client/src/wizard/PairStep.tsx`
- Modificar: `client/src-tauri/src/main.rs`, `client/src-tauri/Cargo.toml`, `client/src/App.tsx`

**Interfaces:**
- Consume: `lumi_proto::key::PairKey`, `lumi_proto::api::Hello`
- Produce:
  - Comando Tauri `pair(key: String) -> Result<Hello, String>`
  - Comando Tauri `request(method, path, body, token) -> Result<String, String>`
  - `api.pair(key)`, `api.post(path, body)`, `api.get(path)` en TypeScript
  - `useServer()` de zustand con `{ key, hello, token, setKey, setHello, setToken }`

- [ ] **Paso 1: Verificador de huella en Rust**

`client/src-tauri/Cargo.toml`, `[dependencies]`:

```toml
lumi-proto = { path = "../../crates/lumi-proto" }
reqwest = { version = "0.12", default-features = false, features = ["json", "rustls-tls-manual-roots", "stream"] }
rustls = "0.23"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
tokio = { version = "1", features = ["full"] }
```

`client/src-tauri/src/main.rs`:

```rust
//! El cliente NO confía en ninguna CA. Solo acepta el certificado cuya huella
//! coincide con la que viene dentro de la clave de vinculación. Si no coincide,
//! aborta: no hay diálogo de "¿confías?", porque ese diálogo es por donde entra
//! el atacante.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use lumi_proto::key::PairKey;
use std::sync::{Arc, Mutex};

#[derive(Debug)]
struct PinnedVerifier {
    fingerprint: String,
}

impl rustls::client::danger::ServerCertVerifier for PinnedVerifier {
    fn verify_server_cert(
        &self,
        end_entity: &rustls::pki_types::CertificateDer<'_>,
        _intermediates: &[rustls::pki_types::CertificateDer<'_>],
        _server_name: &rustls::pki_types::ServerName<'_>,
        _ocsp: &[u8],
        _now: rustls::pki_types::UnixTime,
    ) -> Result<rustls::client::danger::ServerCertVerified, rustls::Error> {
        if lumi_proto::key::fingerprint(end_entity.as_ref()) == self.fingerprint {
            Ok(rustls::client::danger::ServerCertVerified::assertion())
        } else {
            Err(rustls::Error::General("la huella del certificado no coincide".into()))
        }
    }
    fn verify_tls12_signature(
        &self, _m: &[u8], _c: &rustls::pki_types::CertificateDer<'_>,
        _d: &rustls::DigitallySignedStruct,
    ) -> Result<rustls::client::danger::HandshakeSignatureValid, rustls::Error> {
        Ok(rustls::client::danger::HandshakeSignatureValid::assertion())
    }
    fn verify_tls13_signature(
        &self, _m: &[u8], _c: &rustls::pki_types::CertificateDer<'_>,
        _d: &rustls::DigitallySignedStruct,
    ) -> Result<rustls::client::danger::HandshakeSignatureValid, rustls::Error> {
        Ok(rustls::client::danger::HandshakeSignatureValid::assertion())
    }
    fn supported_verify_schemes(&self) -> Vec<rustls::SignatureScheme> {
        rustls::crypto::ring::default_provider().signature_verification_algorithms.supported_schemes()
    }
}

#[derive(Default)]
struct Conn {
    base: Option<String>,
    client: Option<reqwest::Client>,
}

type Shared = Arc<Mutex<Conn>>;

fn client_for(fingerprint: &str) -> Result<reqwest::Client, String> {
    let cfg = rustls::ClientConfig::builder()
        .dangerous()
        .with_custom_certificate_verifier(Arc::new(PinnedVerifier { fingerprint: fingerprint.into() }))
        .with_no_client_auth();
    reqwest::Client::builder()
        .use_preconfigured_tls(cfg)
        .build()
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn pair(key: String, state: tauri::State<'_, Shared>) -> Result<serde_json::Value, String> {
    let pk = PairKey::parse(&key).map_err(|e| e.to_string())?;
    let client = client_for(&pk.fingerprint)?;
    let base = format!("https://{}", pk.addr);
    let hello: serde_json::Value = client
        .get(format!("{base}/v1/hello"))
        .send()
        .await
        .map_err(|e| format!("no se pudo conectar: {e}"))?
        .json()
        .await
        .map_err(|e| e.to_string())?;
    let mut c = state.lock().unwrap();
    c.base = Some(base);
    c.client = Some(client);
    Ok(hello)
}

#[tauri::command]
async fn request(
    method: String, path: String, body: Option<String>, token: Option<String>,
    state: tauri::State<'_, Shared>,
) -> Result<String, String> {
    let (base, client) = {
        let c = state.lock().unwrap();
        (c.base.clone().ok_or("sin servidor vinculado")?, c.client.clone().ok_or("sin cliente")?)
    };
    let mut rb = match method.as_str() {
        "POST" => client.post(format!("{base}{path}")),
        _ => client.get(format!("{base}{path}")),
    };
    if let Some(t) = token {
        rb = rb.bearer_auth(t);
    }
    if let Some(b) = body {
        rb = rb.header("content-type", "application/json").body(b);
    }
    let res = rb.send().await.map_err(|e| e.to_string())?;
    let status = res.status();
    let text = res.text().await.unwrap_or_default();
    if status.is_success() { Ok(text) } else { Err(text) }
}

fn main() {
    rustls::crypto::ring::default_provider().install_default().ok();
    tauri::Builder::default()
        .manage(Shared::default())
        .invoke_handler(tauri::generate_handler![pair, request])
        .run(tauri::generate_context!())
        .expect("error al arrancar Tauri");
}
```

- [ ] **Paso 2: Escribir `src/lib/api.ts` y `src/lib/store.ts`**

`api.ts`:

```ts
import { invoke } from "@tauri-apps/api/core";

export interface Capability { id: string; label: string; state: "on" | "partial" | "off"; reason: string | null }
export interface GpuInfo { index: number; name: string; vram_total_mb: number; pcie: string }
export interface Hello {
  version: string;
  state: "unclaimed" | "claimed" | "provisioning" | "ready";
  mode: "native" | "docker";
  locked: boolean;
  fingerprint: string;
  capabilities: Capability[];
  gpus: GpuInfo[];
}

export const api = {
  pair: (key: string) => invoke<Hello>("pair", { key }),
  get: <T>(path: string, token?: string) =>
    invoke<string>("request", { method: "GET", path, body: null, token }).then(t => JSON.parse(t) as T),
  post: <T>(path: string, body: unknown, token?: string) =>
    invoke<string>("request", { method: "POST", path, body: JSON.stringify(body), token })
      .then(t => (t ? (JSON.parse(t) as T) : (null as T))),
};
```

`store.ts`:

```ts
import { create } from "zustand";
import type { Hello } from "./api";

interface ServerState {
  key: string; hello: Hello | null; token: string | null;
  setKey: (k: string) => void;
  setHello: (h: Hello | null) => void;
  setToken: (t: string | null) => void;
}

export const useServer = create<ServerState>((set) => ({
  key: "", hello: null, token: null,
  setKey: (key) => set({ key }),
  setHello: (hello) => set({ hello }),
  setToken: (token) => set({ token }),
}));
```

- [ ] **Paso 3: Escribir `PairStep.tsx`**

```tsx
import { useState } from "react";
import { api } from "../lib/api";
import { useServer } from "../lib/store";
import { Icon } from "../ui/Icon";

export function PairStep({ onDone }: { onDone: () => void }) {
  const { key, setKey, hello, setHello } = useServer();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function verify() {
    setBusy(true); setError(null);
    try {
      setHello(await api.pair(key.trim()));
    } catch (e) {
      setHello(null);
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  const fp = hello?.fingerprint ?? "";

  return (
    <>
      <label className="mb-[7px] block text-[11px] tracking-[.02em] text-muted">Clave de vinculación</label>
      <input value={key} onChange={(e) => setKey(e.target.value)} onBlur={verify}
        placeholder="lumi1_192.168.1.40:7717_…"
        className="w-full rounded-lg border border-border bg-[#0d0f12] px-3 py-2.5 font-mono text-[12.5px] text-fg outline-none transition-[border-color,box-shadow] duration-300 ease-expo focus:border-white/40 focus:shadow-[0_0_0_3px_rgba(242,243,245,.055)]" />

      {busy && (
        <div className="mt-3.5 flex items-center gap-2.5 text-xs text-muted">
          <Icon name="spinner" /> Verificando identidad del servidor
        </div>
      )}

      {hello && (
        <>
          <div className="my-3 h-px bg-border" />
          <div className="flex items-center gap-2.5 text-xs text-muted">
            <Icon name="check" />
            <span>
              Huella{" "}
              <b className="font-mono font-normal text-fg">
                {[...fp].map((c, i) => (
                  <span key={i} style={{ animation: `jg-fade-rise .4s ${0.3 + i * 0.03}s both` }}>{c}</span>
                ))}
              </b>{" "}
              verificada
            </span>
          </div>
          <p className="mt-2 max-w-[50ch] text-[11px] text-muted">
            Coincide con la que viaja dentro de la clave. Nadie se ha interpuesto en la conexión.
          </p>
        </>
      )}

      {error && (
        <>
          <div className="my-3 h-px bg-border" />
          <div className="flex items-start gap-2.5 text-xs text-danger-fg">
            <Icon name="alert" className="mt-0.5" />
            <span className="text-muted">{error}</span>
          </div>
        </>
      )}
      <button hidden onClick={onDone} />
    </>
  );
}
```

En `App.tsx`, envuélvelo con `Wizard` en `step={0}`, con `onNext` habilitado solo cuando
`hello` no es nulo.

- [ ] **Paso 4: Probar contra el daemon real**

Arranca `lumid` con `LUMI_DATA=.dev-data`, coge la clave que imprimió `lumi install` y
pégala en el campo.

Esperado: aparece la línea de huella verificada, los caracteres entran escalonados y el
botón «Siguiente» se habilita.

Ahora la prueba que importa: edita la clave cambiando **un solo carácter de la huella** y
vuelve a pegarla. Esperado: error `la huella del certificado no coincide`, `hello` sigue
nulo, «Siguiente» deshabilitado. Si esto no falla, el anclaje no está funcionando y el
resto del modelo de confianza es decorativo.

- [ ] **Paso 5: Commit**

```bash
git add client
git commit -m "Cliente: paso de vinculación con anclaje de huella en el verificador TLS"
```

---

## Tarea 15: Franja de telemetría

**Archivos:**
- Crear: `client/src/ui/TelemetryStrip.tsx`
- Modificar: `client/src-tauri/src/main.rs`, `client/src/lib/store.ts`, `client/src/App.tsx`

**Interfaces:**
- Consume: `useServer`, comando Tauri nuevo `start_telemetry`
- Produce:
  - Comando Tauri `start_telemetry(token: String)` que emite el evento `telemetry` con cada `Sample`
  - `TelemetryStrip` con props `{ collapsed: boolean; onToggle: () => void }`
  - `useServer` gana `sample: Sample | null` y `setSample`

- [ ] **Paso 1: Emitir la telemetría como evento de Tauri**

Añade a `client/src-tauri/src/main.rs`:

```rust
/// SSE del daemon reemitido como evento de Tauri. El frontend solo escucha.
#[tauri::command]
async fn start_telemetry(
    token: String, app: tauri::AppHandle, state: tauri::State<'_, Shared>,
) -> Result<(), String> {
    use tauri::Emitter;
    let (base, client) = {
        let c = state.lock().unwrap();
        (c.base.clone().ok_or("sin servidor")?, c.client.clone().ok_or("sin cliente")?)
    };
    tokio::spawn(async move {
        loop {
            let res = client.get(format!("{base}/v1/telemetry")).bearer_auth(&token).send().await;
            let Ok(res) = res else {
                let _ = app.emit("telemetry-down", ());
                tokio::time::sleep(std::time::Duration::from_secs(2)).await;
                continue;
            };
            let mut stream = res.bytes_stream();
            use futures_util::StreamExt;
            let mut buf = String::new();
            while let Some(Ok(chunk)) = stream.next().await {
                buf.push_str(&String::from_utf8_lossy(&chunk));
                while let Some(i) = buf.find("\n\n") {
                    let frame = buf[..i].to_string();
                    buf.drain(..i + 2);
                    if let Some(d) = frame.strip_prefix("data: ") {
                        if let Ok(v) = serde_json::from_str::<serde_json::Value>(d) {
                            let _ = app.emit("telemetry", v);
                        }
                    }
                }
            }
            let _ = app.emit("telemetry-down", ());
        }
    });
    Ok(())
}
```

Añade `futures-util = "0.3"` a `client/src-tauri/Cargo.toml` y registra `start_telemetry` en
`invoke_handler`.

- [ ] **Paso 2: Escribir `TelemetryStrip.tsx`**

```tsx
import { useServer } from "../lib/store";
import { Icon, LockIcon } from "./Icon";

function Cell({ label, children, className = "", style }: {
  label: string; children: React.ReactNode; className?: string; style?: React.CSSProperties;
}) {
  return (
    <div className={`flex min-w-0 flex-col justify-center gap-[5px] border-r border-border px-[15px] py-[11px] last:border-r-0 ${className}`} style={style}>
      <div className="whitespace-nowrap font-mono text-[9.5px] uppercase tracking-[.1em] text-subtle">{label}</div>
      {children}
    </div>
  );
}

function Bar({ pct, tone = "draw" }: { pct: number; tone?: "draw" | "warning" }) {
  return (
    <div className="h-[3px] overflow-hidden rounded-sm bg-white/[.07]">
      <div className={`h-full rounded-sm ${tone === "warning" ? "bg-warning" : "bg-draw"} transition-[width] duration-1000 ease-expo`}
        style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
    </div>
  );
}

export function TelemetryStrip({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const { hello, sample } = useServer();
  if (!hello) return null;
  const addr = hello.fingerprint ? "" : "";
  return (
    <div className={`relative z-20 flex items-stretch border-b border-border bg-surface/95 transition-[height] duration-500 ease-expo ${collapsed ? "h-7" : "h-[70px]"}`}>
      <Cell label="Servidor" className="flex-none basis-[210px]">
        <div className="flex items-center gap-[7px] whitespace-nowrap font-mono text-xs text-fg">
          {hello.locked && <LockIcon size={12} className="text-warning" />}
          <span>{addr || "servidor"}</span>
        </div>
        {!collapsed && (
          <div className={`whitespace-nowrap font-mono text-[10px] ${hello.locked ? "text-warning-fg" : "text-draw-fg"}`}>
            ● {hello.locked ? "sellado" : `verificado · ${hello.mode === "native" ? "nativo" : "docker"}`}
          </div>
        )}
      </Cell>

      {hello.gpus.map((g) => {
        const s = sample?.gpus.find((x) => x.index === g.index);
        const pct = s ? (s.vram_used_mb / Math.max(1, s.vram_total_mb)) * 100 : 0;
        return (
          <Cell key={g.index} label={`gpu${g.index} · ${g.name.replace(/NVIDIA |GeForce /g, "")}`}>
            <div className="whitespace-nowrap font-mono text-xs text-fg">
              {s ? `${s.util_pct}%` : "—"}
              <span className="text-muted">{s ? ` · ${(s.vram_used_mb / 1024).toFixed(1)}/${Math.round(s.vram_total_mb / 1024)}` : ""}</span>
            </div>
            {!collapsed && <Bar pct={pct} />}
          </Cell>
        );
      })}

      <Cell label="Cola" className="flex-none basis-[112px]">
        <div className="font-mono text-sm text-fg">{sample ? sample.queue_depth : "—"}</div>
        {!collapsed && (
          <div className={`font-mono text-[10px] ${sample?.queue_paused ? "text-warning-fg" : "text-subtle"}`}>
            {sample?.queue_paused ? "en pausa" : "sin provisionar"}
          </div>
        )}
      </Cell>

      <button onClick={onToggle} aria-label={collapsed ? "Expandir" : "Colapsar"}
        className="border-l border-border px-3 text-subtle transition-colors hover:text-fg">
        <Icon name="chevron" size={11} className={collapsed ? "" : "rotate-180"} />
      </button>
    </div>
  );
}
```

- [ ] **Paso 3: Escuchar el evento**

En `store.ts` añade `sample: Sample | null` y `setSample`. En `App.tsx`:

```tsx
useEffect(() => {
  const un = listen<Sample>("telemetry", (e) => useServer.getState().setSample(e.payload));
  return () => { un.then((f) => f()); };
}, []);
```

- [ ] **Paso 4: Comprobar**

Vincula contra el daemon, llama a `start_telemetry` tras el login.

Esperado: una celda por GPU actualizándose cada segundo; en una máquina sin NVIDIA solo
aparecen «Servidor» y «Cola», sin celdas vacías. La flecha colapsa la franja a 28 px con la
transición de 500 ms y sin saltos de layout en lo de debajo.

- [ ] **Paso 5: Commit**

```bash
git add client
git commit -m "Cliente: franja de telemetría en vivo, colapsable"
```

---

## Tarea 16: Estados anómalos, paso de administrador y aprovisionamiento

**Archivos:**
- Crear: `client/src/ui/StatusOverlay.tsx`, `client/src/wizard/AdminStep.tsx`, `client/src/wizard/ProvisionStep.tsx`
- Modificar: `client/src/App.tsx`, `client/src-tauri/src/main.rs`

**Interfaces:**
- Consume: `Wizard`, `Icon`, `LockIcon`, `api`, `useServer`
- Produce:
  - `type ServerStatus = "ok" | "reboot" | "error" | "sealed" | "lost"`
  - `StatusOverlay` con props `{ status: Exclude<ServerStatus,"ok">; detail?: string; queue: number; onRetry: () => void; onUnseal: (p: string) => Promise<void> }`
  - `AdminStep` con `{ bootstrapToken: string; onDone: () => void }`
  - `ProvisionStep` con `{ onDone: () => void }`
  - Comando Tauri `start_task_log(id, from)` que emite el evento `task-log`

- [ ] **Paso 1: Escribir `StatusOverlay.tsx`**

No es un componente nuevo: reutiliza la composición del wizard. Misma anchura, misma
brandline con `✦`, misma tarjeta de cristal, misma fila de botones. Solo desaparece el
stepper y se atenúa lo de detrás.

```tsx
import { useState } from "react";
import { Icon, LockIcon } from "./Icon";

type Status = "reboot" | "error" | "sealed" | "lost";

const COPY: Record<Status, { title: string; sub: string }> = {
  reboot: { title: "Reiniciando", sub: "Vuelve solo. Nada perdido." },
  error: { title: "Fallo al arrancar", sub: "Las GPUs no responden. Paso detenido." },
  sealed: { title: "Servidor sellado", sub: "Nada se ha descifrado." },
  lost: { title: "Sin conexión", sub: "Puede ser tu red. Allí todo sigue corriendo." },
};

const TONE: Record<Status, string> = {
  reboot: "text-draw-fg", error: "text-danger-fg", sealed: "text-warning", lost: "text-subtle",
};

function Line({ icon, children, time }: { icon: React.ReactNode; children: React.ReactNode; time?: string }) {
  return (
    <div className="flex items-center gap-2.5 py-1.5 text-xs text-muted">
      {icon}
      <span>{children}</span>
      {time && <span className="ml-auto font-mono text-[10.5px] text-subtle">{time}</span>}
    </div>
  );
}

export function StatusOverlay({ status, detail, queue, onRetry, onUnseal }: {
  status: Status; detail?: string; queue: number;
  onRetry: () => void; onUnseal: (p: string) => Promise<void>;
}) {
  const [pass, setPass] = useState("");
  const [open, setOpen] = useState(false);
  const { title, sub } = COPY[status];
  const tone = TONE[status];

  return (
    <div className="absolute inset-0 z-30 bg-[rgba(5,7,10,.55)] backdrop-blur-[3px]"
      style={{ animation: "jg-fade-rise .5s both" }}>
      <div className="mx-auto max-w-xl px-6 py-9" style={{ animation: "jg-fade-rise .6s both" }}>
        <div className="mb-1 flex items-center gap-2.5">
          <span className="text-fg" style={{ animation: "jg-lock-breathe 2.4s ease-in-out infinite" }}>✦</span>
          <span className="text-[17px] font-medium text-fg">{title}</span>
        </div>
        <p className="mb-6 text-xs text-muted">{sub}</p>

        <div className="rounded-card border border-white/[.13] bg-[rgba(16,19,25,.66)] p-5 shadow-lg shadow-black/40 backdrop-blur-xl">
          <div className={`relative mx-auto mb-4 flex justify-center ${tone}`}>
            <div className="absolute top-0 h-[34px] w-16 rounded-full bg-current opacity-[.13] blur-[18px]" />
            {status === "sealed"
              ? <LockIcon size={32} open={open} className="relative" />
              : <Icon size={32} className="relative"
                  name={status === "reboot" ? "refresh" : status === "error" ? "alert" : "signal-off"} />}
          </div>

          {status === "sealed" ? (
            <>
              <Line icon={<Icon name="pause" className="text-warning" />} time="04:12:44">
                Clave maestra bloqueada · <b className="font-normal text-fg">{queue}</b> esperando
              </Line>
              <div className="my-3 h-px bg-border" />
              <label className="mb-[7px] block text-[11px] text-muted">Frase de desbloqueo</label>
              <input type="password" value={pass} onChange={(e) => setPass(e.target.value)}
                className="w-full rounded-lg border border-border bg-[#0d0f12] px-3 py-2.5 font-mono text-[12.5px] text-fg outline-none focus:border-white/40" />
            </>
          ) : status === "error" ? (
            <>
              <Line icon={<Icon name="pause" className="text-warning" />} time="04:12:31">
                Cola congelada · <b className="font-normal text-fg">{queue}</b>
              </Line>
              <div className="my-3 h-px bg-border" />
              <pre className="overflow-x-auto whitespace-pre rounded-lg border border-border bg-[#08090b] px-3.5 py-3 font-mono text-[11px] leading-[1.7] text-muted">
                {detail ?? "sin salida del daemon"}
              </pre>
            </>
          ) : (
            <>
              <Line icon={<Icon name="pause" className="text-warning" />} time="04:12:07">
                Cola congelada · <b className="font-normal text-fg">{queue}</b>
              </Line>
              <Line icon={<Icon name="spinner" />} time={status === "lost" ? "intento 4" : "18 s"}>
                {status === "lost" ? "Reconectando" : "Esperando"}
              </Line>
            </>
          )}
        </div>

        <div className="mt-4 flex items-center justify-between gap-3">
          <span className="font-mono text-[11px] text-muted">
            {status === "sealed" ? "solo administradores"
              : status === "error" ? "sin reintento automático"
              : "reintento automático"}
          </span>
          <button
            onClick={status === "sealed" ? () => { setOpen(true); void onUnseal(pass); } : onRetry}
            className="rounded-lg bg-accent px-5 py-2 text-xs font-medium text-black transition-transform duration-300 ease-expo active:translate-y-px">
            {status === "sealed" ? "Desbloquear y reanudar" : "Reintentar"}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Paso 2: Escribir `AdminStep.tsx`**

```tsx
import { useState } from "react";
import { api } from "../lib/api";

export function AdminStep({ bootstrapToken, onDone }: { bootstrapToken: string; onDone: () => void }) {
  const [username, setUser] = useState("");
  const [password, setPass] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setError(null);
    try {
      await api.post("/v1/admin", { bootstrap_token: bootstrapToken, username, password });
      onDone();
    } catch (e) {
      setError(String(e));
    }
  }

  return (
    <>
      <div className="grid grid-cols-2 gap-3.5">
        <div>
          <label className="mb-[7px] block text-[11px] text-muted">Usuario</label>
          <input value={username} onChange={(e) => setUser(e.target.value)}
            className="w-full rounded-lg border border-border bg-[#0d0f12] px-3 py-2.5 font-mono text-[12.5px] text-fg outline-none focus:border-white/40" />
        </div>
        <div>
          <label className="mb-[7px] block text-[11px] text-muted">Contraseña</label>
          <input type="password" value={password} onChange={(e) => setPass(e.target.value)}
            className="w-full rounded-lg border border-border bg-[#0d0f12] px-3 py-2.5 font-mono text-[12.5px] text-fg outline-none focus:border-white/40" />
        </div>
      </div>
      <p className="mt-3 max-w-[52ch] text-[11px] text-muted">
        Se almacena con Argon2id. Ni el servidor ni otro administrador podrán leerla: solo
        solicitar que la cambies.
      </p>
      {error && <p className="mt-3 text-[11px] text-danger-fg">{error}</p>}
      <button hidden onClick={submit} id="admin-submit" />
    </>
  );
}
```

Conéctalo desde el `onNext` del `Wizard` llamando a `document.getElementById("admin-submit")?.click()`.

- [ ] **Paso 3: Escribir `ProvisionStep.tsx` y su comando**

En `client/src-tauri/src/main.rs`, un comando gemelo del de telemetría que reemite el log:

```rust
/// Igual que la telemetría, pero para el log de una tarea. El `from` permite
/// reengancharse en el punto exacto en que se cortó.
#[tauri::command]
async fn start_task_log(
    id: String, from: u64, token: String, app: tauri::AppHandle, state: tauri::State<'_, Shared>,
) -> Result<(), String> {
    use futures_util::StreamExt;
    use tauri::Emitter;
    let (base, client) = {
        let c = state.lock().unwrap();
        (c.base.clone().ok_or("sin servidor")?, c.client.clone().ok_or("sin cliente")?)
    };
    tokio::spawn(async move {
        let url = format!("{base}/v1/tasks/{id}/log?from={from}");
        let Ok(res) = client.get(url).bearer_auth(&token).send().await else {
            let _ = app.emit("task-log-down", ());
            return;
        };
        let mut stream = res.bytes_stream();
        let mut buf = String::new();
        while let Some(Ok(chunk)) = stream.next().await {
            buf.push_str(&String::from_utf8_lossy(&chunk));
            while let Some(i) = buf.find("\n\n") {
                let frame = buf[..i].to_string();
                buf.drain(..i + 2);
                let data: String = frame
                    .lines()
                    .filter_map(|l| l.strip_prefix("data: "))
                    .collect::<Vec<_>>()
                    .join("\n");
                if !data.is_empty() {
                    let _ = app.emit("task-log", data);
                }
            }
        }
        let _ = app.emit("task-log-down", ());
    });
    Ok(())
}
```

`ProvisionStep.tsx`:

```tsx
import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { api } from "../lib/api";
import { useServer } from "../lib/store";
import { Icon } from "../ui/Icon";

export function ProvisionStep({ onDone }: { onDone: () => void }) {
  const token = useServer((s) => s.token);
  const [log, setLog] = useState("");
  const [running, setRunning] = useState(false);
  const box = useRef<HTMLPreElement>(null);

  useEffect(() => {
    const un = listen<string>("task-log", (e) => setLog((l) => l + e.payload));
    return () => { un.then((f) => f()); };
  }, []);

  useEffect(() => { box.current?.scrollTo(0, box.current.scrollHeight); }, [log]);

  async function start() {
    const t = await api.post<{ id: string }>("/v1/tasks", { kind: "inference_runtime" }, token!);
    setRunning(true);
    await invoke("start_task_log", { id: t.id, from: 0, token });
  }

  return (
    <>
      <div className="mb-3 flex items-center justify-between">
        <span className="text-xs text-fg">torch 2.5.1 + cu126</span>
        <span className="font-mono text-[11px] text-muted">{running ? "en curso" : "sin iniciar"}</span>
      </div>
      <pre ref={box}
        className="max-h-[132px] overflow-auto whitespace-pre rounded-lg border border-border bg-[#08090b] px-3.5 py-3 font-mono text-[11px] leading-[1.7] text-muted">
        {log || "esperando a lanzar la tarea"}
      </pre>
      <p className="mt-3 max-w-[52ch] text-[11px] text-muted">
        Corre en el servidor. Puedes cerrar la app: al volver te reenganchas a este mismo log.
      </p>
      <div className="mt-4 flex gap-2">
        {!running && (
          <button onClick={start} className="rounded-lg bg-accent px-4 py-2 text-xs font-medium text-black">
            Instalar runtime
          </button>
        )}
        {running && (
          <span className="flex items-center gap-2 text-xs text-muted"><Icon name="spinner" /> Instalando</span>
        )}
      </div>
      <button hidden onClick={onDone} />
    </>
  );
}
```

- [ ] **Paso 4: Cablear los estados en `App.tsx`**

`App.tsx` sondea `/v1/hello` cada 3 s. Si falla dos veces seguidas, `status = "lost"`. Si
responde con `locked: true`, `status = "sealed"`. Si responde pero una tarea terminó con
`exit_code != 0`, `status = "error"` con el final del log como `detail`. Si la conexión se
cae y vuelve a responder en menos de 60 s, `status = "reboot"` mientras tanto.

```tsx
const [status, setStatus] = useState<"ok" | "reboot" | "error" | "sealed" | "lost">("ok");
const fails = useRef(0);

useEffect(() => {
  const t = setInterval(async () => {
    try {
      const h = await api.get<Hello>("/v1/hello");
      useServer.getState().setHello(h);
      const wasDown = fails.current > 0;
      fails.current = 0;
      setStatus(h.locked ? "sealed" : wasDown ? "reboot" : "ok");
    } catch {
      fails.current += 1;
      if (fails.current >= 2) setStatus(fails.current > 20 ? "lost" : "reboot");
    }
  }, 3000);
  return () => clearInterval(t);
}, []);
```

El fondo pasa a `dead` siempre que `status !== "ok"`:

```tsx
<PlanetBackground dead={status !== "ok"} />
```

- [ ] **Paso 5: Probar los cuatro estados contra el daemon real**

```bash
# sellado
head -c 16 /dev/urandom > .dev-data/master.salt && pkill lumid
LUMI_DATA=.dev-data cargo run -p lumid
```

Esperado: el popup de sellado aparece solo, con el candado ámbar respirando y el planeta
apagado. Al introducir la frase y pulsar, el candado se abre en 0.75 s, su color pasa a
blanco, el overlay desaparece y el candado de la franja se va.

```bash
# reinicio
sudo systemctl restart lumid     # o mata y relanza el proceso
```

Esperado: popup de reinicio antes de 6 s, y desaparición automática al volver el daemon.

```bash
# sin conexión
sudo systemctl stop lumid
```

Esperado: popup de reinicio primero y, pasado un minuto de intentos, el de sin conexión con
la señal tachada y los arcos parpadeando en secuencia.

Para el error, lanza una tarea que falle:

```bash
curl -sk -X POST https://localhost:7717/v1/tasks -H "authorization: Bearer $T" \
  -H 'content-type: application/json' -d '{"kind":"inference_runtime"}'
```

En una máquina sin `python3` la tarea sale con código distinto de cero y el popup de error
debe mostrar la salida real del intérprete, no un mensaje genérico.

- [ ] **Paso 6: Commit**

```bash
git add client
git commit -m "Cliente: estados anómalos, creación del administrador y aprovisionamiento en vivo"
```

---

## Autorrevisión

**Cobertura de la spec**

| Sección de la spec | Tareas |
|---|---|
| §3 Componentes, puerto 7717 | 1 |
| §4 Instalación, spinner, matriz de capacidades | 4, 5, 6 |
| §5 Clave, huella de 128 bits, canje, reissue | 2, 6, 9 |
| §6 Estados del daemon | 7 (`Store::state`), 8 (bloqueado) |
| §7 Cifrado, clave maestra, sellado | 3, 6, 8 |
| §8 API y runner de tareas | 7, 8, 9, 10, 11 |
| §9 Franja, wizard, estados anómalos | 12, 13, 14, 15, 16 |
| §10 Errores | 9 (canje), 14 (huella), 16 (los cuatro estados) |

Sin huecos. Lo que la spec deja fuera de alcance (§11) no tiene tareas, que es lo correcto.

**Consistencia de nombres verificada**

`PairKey::generate/parse/matches_cert` · `fingerprint()` en `key.rs` y usada en `tls.rs` y en
el verificador de Tauri · `MasterKey::{random,from_bytes,derive,as_bytes}` · `seal`/`open` ·
`matrix(mode, gpu_count)` · `Store::{open,conn,state,set_meta}` · `tasks::{spawn,status,log_path}` ·
`require_admin(app, token)` · `new_token()` de `claim.rs` reutilizada por `auth.rs` y por
`tasks::spawn` · `Icon`/`LockIcon` con los mismos nombres en las tareas 13, 15 y 16 ·
`useServer` con `key/hello/token/sample`.

**Notas de implementación heredadas**

- El campo `addr` de `TelemetryStrip` está vacío en la tarea 15 porque `Hello` no lleva la
  dirección: viene de la clave. Al cablear la tarea 16, léelo de `useServer().key` con
  `PairKey.parse` del lado TS, o añade `addr` al store al vincular. Lo segundo es más simple.
- `Store::state()` devuelve `Ready` solo cuando existe `meta.provisioned = "1"`. Ese valor lo
  escribirá el último paso del asistente, que pertenece al subsistema 5. Hasta entonces el
  servidor se queda en `Claimed`, y es correcto.

---

## Ejecución

Plan completo y guardado en `docs/superpowers/plans/2026-08-03-instalador-y-pairing.md`. Dos
opciones:

**1. Dirigida por subagentes (recomendada)** — un subagente nuevo por tarea, revisión entre
tareas, iteración rápida.

**2. Ejecución en línea** — las tareas en esta misma sesión con `executing-plans`, por lotes
con puntos de control.
