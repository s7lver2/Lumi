# Lumi Indexer 8 — Catálogo de índices

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que un índice sellado se pueda publicar cifrado y troceado en un release de GitHub o HuggingFace, que otro operador lo encuentre y sepa que ese territorio ya está cubierto sin volver a comprarlo, y que quien lo instale reciba el paquete y sus dependencias.

**Architecture:** Toda la lógica pura —trocear, firmar, cifrar, resolver el grafo de dependencias— vive en `crates/lumi-index` y se prueba sin red, sin GPU y sin ventana. El Indexer añade tres módulos que son fontanería sobre esa lógica: `identidad.rs` (quién eres), `publicar.rs` (subir) y `catalogo.rs` (qué hay ahí fuera). La única pieza en Lumi Station es el diálogo que resuelve un grafo antes de descargar. El descubrimiento no tiene servidor: se recorren los repositorios con la etiqueta `lumi-index` y se leen sus fichas, que viajan en claro.

**Tech Stack:** Rust (rusqlite, tokio, reqwest, ed25519-dalek, aes-gcm, Tauri 2), React 19 + TypeScript, Tailwind, Mapbox GL JS.

Spec: [`2026-08-09-lumi-indexer-8-design.md`](../specs/2026-08-09-lumi-indexer-8-design.md).
Maquetas: [`lumi-s8-mockups.html`](../specs/lumi-s8-mockups.html).

## Global Constraints

- Identificadores, comentarios, textos de interfaz y mensajes de commit en **español**. Los comentarios explican el **porqué**, nunca el qué.
- `ponytail`: la solución más simple que funcione. Una simplificación deliberada lleva un comentario `// ponytail:` con el techo que encontró y la salida.
- **No hay verde** en la paleta. «Completado» se representa en blanco (`fg`). Colores solo de la tabla de `DESIGN.md`.
- Todo dato producido por una máquina (quadkeys, bytes, hashes, huellas, timestamps, rutas, códigos) va en `font-mono`.
- Movimiento: solo `ease-out` exponencial `cubic-bezier(.16,1,.3,1)`. Sin rebote, sin animar propiedades de layout, respetando `prefers-reduced-motion`.
- **Nada de `vw`/`vh`** dentro de la aplicación: el `--ui-scale` de `WindowFrame.tsx` las rompe. Diálogos con `position:absolute` y `calc(100% - Npx)` contra su `Overlay`.
- **La ficha viaja en claro; todo lo demás cifrado.** El cifrado es ofuscación frente al alojamiento, **no control de acceso**, y ningún texto de la interfaz puede sugerir lo contrario.
- **La ficha se sube la última.** Mientras falte un asset no se publica, y por tanto el paquete no existe para nadie.
- **La firma se comprueba siempre** al abrir un paquete ajeno. Un fallo aborta esa instalación; no hay «abrir de todas formas».
- **Quien indexa no descarga nada de nadie**: lo reclamado no entra en su índice, entra en su ficha como dependencia.
- Tope de trozo: **1 800 000 000 bytes**, por debajo del límite de 2 GiB por asset de GitHub.
- Vigencia de una ficha: **90 días**; aviso de refresco a falta de **15**.
- Los tests existentes no se rompen. Comandos de verificación: `cargo test -p lumi-index`, `cargo test` en `indexer/src-tauri`, `cargo clippy -- -D warnings`, y en `indexer/`: `npx tsc -b --noEmit && npm run lint && npm run build`.

---

## Estructura de ficheros

**`crates/lumi-index/src/`** — lógica pura, con tests. No conoce la red ni SQLite.

| Fichero | Responsabilidad |
|---|---|
| `troceado.rs` | Repartir quadkeys en trozos bajo un tope de bytes. Nada más. |
| `cifrado.rs` | Cifrar y descifrar un asset con AES-256-GCM. Nada más. |
| `ficha.rs` | La estructura de la ficha, su forma canónica, firmar y comprobar. |
| `grafo.rs` | Resolver dependencias transitivas y sumar el peso. |

**`indexer/src-tauri/src/`** — fontanería.

| Fichero | Responsabilidad |
|---|---|
| `identidad.rs` | Flujo de dispositivo, testigo, clave Ed25519, respaldo, rotación. |
| `publicar.rs` | Componer la ficha, trocear, cifrar y subir con reanudación. |
| `catalogo.rs` | Recorrer por etiqueta, cachear fichas, mapa de cobertura, reclamos. |

**`indexer/src/`** — interfaz.

| Fichero | Responsabilidad |
|---|---|
| `setup/IdentityStep.tsx` | El paso de identidad del setup, saltable. |
| `settings/IdentityPanel.tsx` | Sesión, permisos, clave, respaldo, rotación. |
| `publish/PublishDialog.tsx` | Los tres pasos y el progreso de subida. |
| `catalog/RemoteRepos.tsx` | Repositorios remotos agrupados por repositorio. |
| `catalog/CatalogSearch.tsx` | El buscador y su desplegable. |
| `catalog/ProfileDialog.tsx` | La ficha de perfil de una cuenta. |

**Cortes deliberados:** `publicar.rs` no sabe nada de HTTP de GitHub más allá de subir un asset; la composición de la ficha es de `lumi-index`. `catalogo.rs` no dibuja: expone consultas. Y `IndexDetail.tsx` **no se duplica** para el modo remoto — recibe una marca de solo lectura, igual que ya hace con un índice sellado.

**Punto de corte entre fases:** al terminar la Task 7 el producto ya hace algo completo y útil por sí solo —publicar un índice y verlo listado— sin nada de la fase B. Es el sitio natural para parar, probar de verdad y decidir si seguir.

---

# Fase A — Publicar

## Task 1: Trocear por geografía

Un `.lumidx` con imágenes pasa los 2 GiB por asset que permite GitHub. Se parte, pero por **grupos de quadkeys**, no por bytes ciegos: así cada trozo es autocontenido y quien instale puede quedarse solo con las zonas que le sirvan.

Las quadkeys ordenadas alfabéticamente quedan ordenadas espacialmente —son una curva Z—, así que acumular en orden ya produce trozos geográficamente coherentes sin calcular nada.

**Files:**
- Create: `crates/lumi-index/src/troceado.rs`
- Modify: `crates/lumi-index/src/lib.rs`

**Interfaces:**
- Consumes: nada.
- Produces: `TOPE_TROZO_BYTES: u64`, `struct Trozo { prefijo: String, quadkeys: Vec<String>, bytes: u64 }`, `fn trocear(pesos: &[(String, u64)], tope: u64) -> Vec<Trozo>`.

- [ ] **Step 1: Declarar el módulo**

En `crates/lumi-index/src/lib.rs`, añadir en orden alfabético entre `streets` y `vectors`:

```rust
pub mod troceado;
```

- [ ] **Step 2: Escribir los tests que fallan**

Crear `crates/lumi-index/src/troceado.rs` con **solo** esto:

```rust
//! Repartir las quadkeys de un paquete en trozos que quepan en un asset.

#[cfg(test)]
mod tests {
    use super::*;

    fn pesos(v: &[(&str, u64)]) -> Vec<(String, u64)> {
        v.iter().map(|(q, b)| (q.to_string(), *b)).collect()
    }

    #[test]
    fn ningun_trozo_pasa_del_tope() {
        let p = pesos(&[("0313101", 600), ("0313102", 600), ("0313103", 600), ("0313110", 600)]);
        for t in trocear(&p, 1_000) {
            assert!(t.bytes <= 1_000, "trozo de {} bytes", t.bytes);
        }
    }

    #[test]
    fn cada_quadkey_aparece_exactamente_una_vez() {
        let p = pesos(&[("0313101", 600), ("0313102", 600), ("0313103", 600)]);
        let mut vistas: Vec<String> =
            trocear(&p, 1_000).into_iter().flat_map(|t| t.quadkeys).collect();
        vistas.sort();
        assert_eq!(vistas, vec!["0313101", "0313102", "0313103"]);
    }

    // Una tesela sola más grande que el tope no se puede partir más: el
    // troceado es por geografía, y media tesela no es una unidad instalable.
    // Va sola en su trozo aunque lo desborde, y quien la suba se encontrará
    // con el límite del proveedor — que es un problema honesto y visible.
    #[test]
    fn una_tesela_mas_grande_que_el_tope_va_sola() {
        let p = pesos(&[("0313101", 100), ("0313102", 5_000), ("0313103", 100)]);
        let ts = trocear(&p, 1_000);
        let gorda = ts.iter().find(|t| t.bytes == 5_000).expect("falta el trozo gordo");
        assert_eq!(gorda.quadkeys, vec!["0313102"]);
    }

    #[test]
    fn el_prefijo_nombra_la_zona_comun() {
        let p = pesos(&[("03131010", 10), ("03131011", 10)]);
        assert_eq!(trocear(&p, 1_000)[0].prefijo, "0313101");
    }

    #[test]
    fn sin_quadkeys_no_hay_trozos() {
        assert!(trocear(&[], 1_000).is_empty());
    }
}
```

- [ ] **Step 3: Comprobar que no compila**

Run: `cargo test -p lumi-index troceado`
Expected: FAIL — `cannot find function 'trocear' in this scope`.

- [ ] **Step 4: Implementar**

Añadir **encima** del bloque `#[cfg(test)]` de `crates/lumi-index/src/troceado.rs`:

```rust
use serde::{Deserialize, Serialize};

/// Por debajo del límite de 2 GiB por asset de release de GitHub, con margen
/// para la cabecera de cifrado y para que un redondeo no tire una subida de
/// dos horas.
pub const TOPE_TROZO_BYTES: u64 = 1_800_000_000;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Trozo {
    /// La quadkey más corta que contiene a todas las de dentro. Nombra el
    /// asset, y es lo que hace que un trozo se pueda describir por su zona en
    /// vez de por un número de orden que no significa nada.
    pub prefijo: String,
    pub quadkeys: Vec<String>,
    pub bytes: u64,
}

/// Las quadkeys ordenadas alfabéticamente están ordenadas espacialmente —son
/// una curva Z—, así que acumular en orden ya produce trozos vecinos entre sí
/// sin tener que calcular ninguna distancia.
pub fn trocear(pesos: &[(String, u64)], tope: u64) -> Vec<Trozo> {
    let mut ordenadas: Vec<&(String, u64)> = pesos.iter().collect();
    ordenadas.sort_by(|a, b| a.0.cmp(&b.0));

    let mut trozos: Vec<Trozo> = Vec::new();
    let mut actual: Vec<String> = Vec::new();
    let mut bytes = 0u64;

    for (qk, b) in ordenadas {
        if !actual.is_empty() && bytes + b > tope {
            trozos.push(cerrar(std::mem::take(&mut actual), bytes));
            bytes = 0;
        }
        actual.push(qk.clone());
        bytes += b;
    }
    if !actual.is_empty() {
        trozos.push(cerrar(actual, bytes));
    }
    trozos
}

fn cerrar(quadkeys: Vec<String>, bytes: u64) -> Trozo {
    Trozo { prefijo: prefijo_comun(&quadkeys), quadkeys, bytes }
}

fn prefijo_comun(qs: &[String]) -> String {
    let Some(primera) = qs.first() else { return String::new() };
    let mut largo = primera.len();
    for q in &qs[1..] {
        largo = largo.min(
            primera.chars().zip(q.chars()).take_while(|(a, b)| a == b).count(),
        );
    }
    primera[..largo].to_string()
}
```

- [ ] **Step 5: Comprobar que pasan**

Run: `cargo test -p lumi-index troceado`
Expected: PASS, 5 tests.

- [ ] **Step 6: Commit**

```bash
git add crates/lumi-index/src/troceado.rs crates/lumi-index/src/lib.rs
git commit -m "Trocear por geografia, que es lo que permite instalar solo la zona que interesa"
```

---

## Task 2: Cifrar un asset

Ofuscación frente al alojamiento, no control de acceso: la clave viaja en la ficha y cualquiera con Lumi abre el paquete. Lo que evita es que un rastreador que pase por GitHub se encuentre un corpus de imágenes geolocalizadas servido en bandeja.

`aes-gcm` ya es dependencia de `lumi-index`, así que no entra ninguna caja nueva.

**Files:**
- Create: `crates/lumi-index/src/cifrado.rs`
- Modify: `crates/lumi-index/src/lib.rs`

**Interfaces:**
- Consumes: nada.
- Produces: `fn clave_nueva(semilla: [u8; 32]) -> [u8; 32]`, `fn cifrar(claro: &[u8], clave: &[u8; 32], nonce: [u8; 12]) -> anyhow::Result<Vec<u8>>`, `fn descifrar(sellado: &[u8], clave: &[u8; 32]) -> anyhow::Result<Vec<u8>>`.

- [ ] **Step 1: Declarar el módulo**

En `crates/lumi-index/src/lib.rs`, entre `budget` y `coverage`:

```rust
pub mod cifrado;
```

- [ ] **Step 2: Escribir los tests que fallan**

Crear `crates/lumi-index/src/cifrado.rs` con **solo**:

```rust
//! Cifrado de los assets de un paquete publicado.

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lo_cifrado_vuelve_igual() {
        let clave = clave_nueva([7u8; 32]);
        let sellado = cifrar(b"unas imagenes", &clave, [1u8; 12]).unwrap();
        assert_ne!(&sellado[..], b"unas imagenes");
        assert_eq!(descifrar(&sellado, &clave).unwrap(), b"unas imagenes");
    }

    #[test]
    fn un_byte_alterado_no_se_abre() {
        let clave = clave_nueva([7u8; 32]);
        let mut sellado = cifrar(b"unas imagenes", &clave, [1u8; 12]).unwrap();
        let ultimo = sellado.len() - 1;
        sellado[ultimo] ^= 0x01;
        assert!(descifrar(&sellado, &clave).is_err());
    }

    #[test]
    fn con_otra_clave_no_se_abre() {
        let sellado = cifrar(b"unas imagenes", &clave_nueva([7u8; 32]), [1u8; 12]).unwrap();
        assert!(descifrar(&sellado, &clave_nueva([9u8; 32])).is_err());
    }
}
```

- [ ] **Step 3: Comprobar que no compila**

Run: `cargo test -p lumi-index cifrado`
Expected: FAIL — `cannot find function 'clave_nueva'`.

- [ ] **Step 4: Implementar**

Añadir encima del bloque de tests:

```rust
use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Key, Nonce};
use anyhow::{anyhow, Result};

/// El nonce viaja al principio del fichero. Va delante y no en la ficha
/// porque el asset tiene que poder descifrarse con la ficha y consigo mismo,
/// sin más piezas sueltas que perder.
const NONCE: usize = 12;

/// La semilla la aporta quien llama —el Indexer usa `rand`—, para que este
/// crate siga sin depender de un generador y los tests sean deterministas.
pub fn clave_nueva(semilla: [u8; 32]) -> [u8; 32] {
    semilla
}

pub fn cifrar(claro: &[u8], clave: &[u8; 32], nonce: [u8; NONCE]) -> Result<Vec<u8>> {
    let c = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(clave));
    let ct = c
        .encrypt(Nonce::from_slice(&nonce), claro)
        .map_err(|_| anyhow!("no se pudo cifrar el asset"))?;
    let mut fuera = Vec::with_capacity(NONCE + ct.len());
    fuera.extend_from_slice(&nonce);
    fuera.extend_from_slice(&ct);
    Ok(fuera)
}

pub fn descifrar(sellado: &[u8], clave: &[u8; 32]) -> Result<Vec<u8>> {
    if sellado.len() <= NONCE {
        return Err(anyhow!("el asset está truncado"));
    }
    let c = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(clave));
    c.decrypt(Nonce::from_slice(&sellado[..NONCE]), &sellado[NONCE..])
        .map_err(|_| anyhow!("el asset no se pudo abrir: clave incorrecta o fichero alterado"))
}
```

- [ ] **Step 5: Comprobar que pasan**

Run: `cargo test -p lumi-index cifrado`
Expected: PASS, 3 tests.

- [ ] **Step 6: Commit**

```bash
git add crates/lumi-index/src/cifrado.rs crates/lumi-index/src/lib.rs
git commit -m "Cifrar el asset: no es control de acceso, es que el corpus no viaje en bandeja"
```

---

## Task 3: La ficha, y su firma

La ficha es la pieza que hace posible el subsistema entero: viaja en claro, pesa kilobytes, y con ella se resuelven el buscador, el mapa de cobertura, el reclamo y las dependencias sin descargar un gigabyte.

La firma es Ed25519 y **no se apoya en la cuenta**: un repositorio transferido o un paquete movido de GitHub a HuggingFace perderían su autoría si la identidad fuera la cuenta.

**Files:**
- Create: `crates/lumi-index/src/ficha.rs`
- Modify: `crates/lumi-index/src/lib.rs`, `Cargo.toml`, `crates/lumi-index/Cargo.toml`

**Interfaces:**
- Consumes: `troceado::Trozo` (Task 1).
- Produces: `VIGENCIA_DIAS: i64`, `AVISO_REFRESCO_DIAS: i64`, `struct Asset`, `struct Capa`, `struct Dependencia`, `struct Ficha`, `Ficha::canonico(&self) -> Vec<u8>`, `Ficha::firmar(&mut self, secreta: &[u8; 32]) -> anyhow::Result<()>`, `Ficha::comprobar(&self) -> anyhow::Result<()>`, `Ficha::fuentes_de(&self, quadkey: &str) -> Vec<String>`.

- [ ] **Step 1: Añadir la dependencia de firma**

En `Cargo.toml` (raíz), dentro de `[workspace.dependencies]`, después de `base64`:

```toml
ed25519-dalek = { version = "2", default-features = false, features = ["std", "rand_core"] }
```

En `crates/lumi-index/Cargo.toml`, dentro de `[dependencies]`:

```toml
ed25519-dalek = { workspace = true }
```

- [ ] **Step 2: Declarar el módulo**

En `crates/lumi-index/src/lib.rs`, entre `embed` y `filter`:

```rust
pub mod ficha;
```

- [ ] **Step 3: Escribir los tests que fallan**

Crear `crates/lumi-index/src/ficha.rs` con **solo**:

```rust
//! La ficha en claro de un paquete publicado.

#[cfg(test)]
mod tests {
    use super::*;

    fn secreta() -> [u8; 32] { [42u8; 32] }

    fn ficha_de_prueba() -> Ficha {
        Ficha {
            version: 1,
            paquete: "sevilla-norte".into(),
            nombre: "Sevilla norte".into(),
            autor: "nickespro130".into(),
            alojamiento: "github".into(),
            clave_publica: String::new(),
            publicada_en: "2026-08-09T18:00:00Z".into(),
            vigente_hasta: "2026-11-07T18:00:00Z".into(),
            cifrado: "aa==".into(),
            no_redistribuible: vec!["google".into()],
            fuentes_por_quadkey: vec![("0313101".into(), vec!["mapillary".into()])],
            cuerpos: vec![],
            capas: vec![],
            dependencias: vec![],
            firma: String::new(),
        }
    }

    #[test]
    fn lo_firmado_se_comprueba() {
        let mut f = ficha_de_prueba();
        f.firmar(&secreta()).unwrap();
        assert!(!f.firma.is_empty());
        assert!(!f.clave_publica.is_empty());
        f.comprobar().unwrap();
    }

    #[test]
    fn una_ficha_alterada_no_pasa() {
        let mut f = ficha_de_prueba();
        f.firmar(&secreta()).unwrap();
        f.nombre = "Sevilla sur".into();
        assert!(f.comprobar().is_err());
    }

    // Sin esto, publicar sin firmar y publicar firmado serían indistinguibles
    // para quien instala, que es justo lo que la firma existe para evitar.
    #[test]
    fn una_ficha_sin_firma_no_pasa() {
        assert!(ficha_de_prueba().comprobar().is_err());
    }

    #[test]
    fn la_firma_no_se_firma_a_si_misma() {
        let mut f = ficha_de_prueba();
        f.firmar(&secreta()).unwrap();
        let antes = f.canonico();
        f.firma = "otra cosa".into();
        assert_eq!(antes, f.canonico(), "el canónico no puede incluir la firma");
    }

    #[test]
    fn las_fuentes_de_una_quadkey_salen_de_la_ficha() {
        let f = ficha_de_prueba();
        assert_eq!(f.fuentes_de("0313101"), vec!["mapillary".to_string()]);
        assert!(f.fuentes_de("9999999").is_empty());
    }
}
```

- [ ] **Step 4: Comprobar que no compila**

Run: `cargo test -p lumi-index ficha`
Expected: FAIL — `cannot find struct 'Ficha'`.

- [ ] **Step 5: Implementar**

Añadir encima del bloque de tests:

```rust
use anyhow::{anyhow, Result};
use base64::{engine::general_purpose::STANDARD, Engine};
use ed25519_dalek::{Signature, Signer, SigningKey, Verifier, VerifyingKey};
use serde::{Deserialize, Serialize};

/// Una ficha caduca a los 90 días. No es una fecha de caducidad del paquete:
/// es lo que impide que un reclamo abandonado bloquee territorio para
/// siempre. Refrescarla es resubir kilobytes, no el paquete.
pub const VIGENCIA_DIAS: i64 = 90;
pub const AVISO_REFRESCO_DIAS: i64 = 15;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Asset {
    pub nombre: String,
    pub sha256: String,
    pub bytes: u64,
    pub quadkeys: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Capa {
    pub modelo: String,
    pub version: String,
    pub dims: u32,
    /// Quién la produjo, que no tiene por qué ser el autor del cuerpo.
    pub autor: String,
    pub assets: Vec<Asset>,
}

/// Una zona que este paquete NO cubre porque ya la cubría otro. Es lo único
/// que produce el reclamo por parte de quien indexa: no descarga nada, lo
/// declara.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Dependencia {
    pub quadkeys: Vec<String>,
    pub paquete: String,
    pub autor: String,
    pub url: String,
    pub sha256: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Ficha {
    pub version: u32,
    pub paquete: String,
    pub nombre: String,
    pub autor: String,
    /// "github" o "huggingface". La firma no depende de esto, pero saber de
    /// dónde vino sirve para volver a pedirlo.
    pub alojamiento: String,
    pub clave_publica: String,
    pub publicada_en: String,
    pub vigente_hasta: String,
    /// La clave AES en base64. Viaja aquí a propósito: esto es ofuscación
    /// frente al alojamiento, no control de acceso.
    pub cifrado: String,
    pub no_redistribuible: Vec<String>,
    pub fuentes_por_quadkey: Vec<(String, Vec<String>)>,
    pub cuerpos: Vec<Asset>,
    pub capas: Vec<Capa>,
    pub dependencias: Vec<Dependencia>,
    pub firma: String,
}

impl Ficha {
    /// Lo que se firma: la ficha entera menos la firma. Se serializa con la
    /// firma vacía en vez de borrar el campo para que el formato no dependa
    /// del orden en que serde escriba las claves.
    pub fn canonico(&self) -> Vec<u8> {
        let mut sin = self.clone();
        sin.firma = String::new();
        serde_json::to_vec(&sin).unwrap_or_default()
    }

    pub fn firmar(&mut self, secreta: &[u8; 32]) -> Result<()> {
        let k = SigningKey::from_bytes(secreta);
        self.clave_publica = STANDARD.encode(k.verifying_key().to_bytes());
        self.firma = STANDARD.encode(k.sign(&self.canonico()).to_bytes());
        Ok(())
    }

    pub fn comprobar(&self) -> Result<()> {
        if self.firma.is_empty() || self.clave_publica.is_empty() {
            return Err(anyhow!("la ficha no está firmada"));
        }
        let pk: [u8; 32] = STANDARD
            .decode(&self.clave_publica)?
            .try_into()
            .map_err(|_| anyhow!("la clave pública no mide 32 bytes"))?;
        let sig: [u8; 64] = STANDARD
            .decode(&self.firma)?
            .try_into()
            .map_err(|_| anyhow!("la firma no mide 64 bytes"))?;
        VerifyingKey::from_bytes(&pk)?
            .verify(&self.canonico(), &Signature::from_bytes(&sig))
            .map_err(|_| anyhow!("la firma no corresponde a esta ficha"))
    }

    pub fn fuentes_de(&self, quadkey: &str) -> Vec<String> {
        self.fuentes_por_quadkey
            .iter()
            .find(|(q, _)| q == quadkey)
            .map(|(_, f)| f.clone())
            .unwrap_or_default()
    }
}
```

- [ ] **Step 6: Comprobar que pasan**

Run: `cargo test -p lumi-index ficha`
Expected: PASS, 5 tests.

- [ ] **Step 7: Commit**

```bash
git add Cargo.toml crates/lumi-index/Cargo.toml crates/lumi-index/src/ficha.rs crates/lumi-index/src/lib.rs
git commit -m "La ficha en claro: kilobytes que evitan descargarse gigas para saber que hay dentro"
```

---

## Task 4: Identidad — entrar, y tener una clave

El flujo de dispositivo se elige frente a OAuth con redirección porque un binario de escritorio no puede guardar un secreto de cliente ni levantar un servidor en un puerto arbitrario.

La identidad es **opcional**: sin ella la aplicación funciona entera menos publicar.

**Files:**
- Create: `indexer/src-tauri/src/identidad.rs`
- Modify: `indexer/src-tauri/src/lib.rs`, `indexer/src-tauri/Cargo.toml`

**Interfaces:**
- Consumes: `keys::Claves` y `crypto::Maestra` (ya existen), `crate::store::Almacen`.
- Produces: comandos Tauri `identidad_arrancar(proveedor: String) -> CodigoDispositivo`, `identidad_sondear() -> Option<Sesion>`, `identidad_leer() -> Option<Sesion>`, `identidad_cerrar()`, `identidad_respaldo() -> Vec<String>`, `identidad_rotar()`; y `pub fn leer_clave(claves: &Claves<'_>) -> anyhow::Result<[u8; 32]>`, que es con lo que `publicar.rs` firma la ficha en la Task 6.

- [ ] **Step 1: Añadir dependencias**

En `indexer/src-tauri/Cargo.toml`, dentro de `[dependencies]`:

```toml
ed25519-dalek = { version = "2", default-features = false, features = ["std", "rand_core"] }
bip39 = { version = "2", default-features = false, features = ["spanish"] }
base64 = "0.22"
```

- [ ] **Step 2: Escribir el módulo**

Crear `indexer/src-tauri/src/identidad.rs`:

```rust
//! Quién eres, y con qué firmas.
//!
//! Flujo de dispositivo y no redirección: un binario de escritorio no puede
//! guardar un secreto de cliente, y abrir un puerto local para recibir la
//! vuelta del navegador es un servidor más que mantener y un cortafuegos más
//! que explicar.
//!
//! La cuenta dice DÓNDE vive un paquete; la clave dice QUIÉN lo hizo. Van
//! separadas a propósito: un repositorio transferido no cambia de autor.

use anyhow::{anyhow, Result};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};

use crate::keys::Claves;

/// Aplicación pública registrada para el flujo de dispositivo. No es un
/// secreto: el flujo existe precisamente para no necesitar ninguno.
const CLIENTE_GITHUB: &str = "Iv1.lumi-indexer-device";

pub const AJUSTE_TESTIGO: &str = "identidad_testigo";
pub const AJUSTE_CUENTA: &str = "identidad_cuenta";
pub const AJUSTE_SECRETA: &str = "identidad_clave_secreta";
pub const AJUSTE_ARCHIVADAS: &str = "identidad_claves_archivadas";

#[derive(Serialize, Clone)]
pub struct CodigoDispositivo {
    pub codigo: String,
    pub url: String,
    /// Cada cuántos segundos permite sondear el proveedor.
    pub intervalo: u64,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct Sesion {
    pub proveedor: String,
    pub cuenta: String,
    pub avatar: String,
    pub desde: String,
    pub huella: String,
    pub permisos: Vec<String>,
}

/// La huella que se enseña al usuario. Base58 en grupos de cuatro, igual que
/// el fingerprint del subsistema 1: se compara de un vistazo o no se compara.
pub fn huella(publica: &[u8; 32]) -> String {
    let s = bs58_corto(publica);
    s.as_bytes()
        .chunks(4)
        .map(|c| String::from_utf8_lossy(c).to_string())
        .collect::<Vec<_>>()
        .join("·")
}

fn bs58_corto(b: &[u8; 32]) -> String {
    use sha2::{Digest, Sha256};
    let h = Sha256::digest(b);
    STANDARD.encode(&h[..12]).replace(['+', '/', '='], "")
}

/// Genera clave y respaldo. Las doce palabras son la ÚNICA copia: no hay
/// recuperación, y por eso se enseñan en el mismo momento con una casilla
/// explícita.
pub fn crear_clave(claves: &Claves<'_>) -> Result<Vec<String>> {
    use rand::RngCore;
    let mut entropia = [0u8; 16];
    rand::thread_rng().fill_bytes(&mut entropia);
    let m = bip39::Mnemonic::from_entropy_in(bip39::Language::Spanish, &entropia)?;
    let semilla = m.to_seed("");
    let secreta: [u8; 32] = semilla[..32].try_into().expect("la semilla mide 64 bytes");
    claves.guardar(AJUSTE_SECRETA, &STANDARD.encode(secreta))?;
    Ok(m.words().map(|w| w.to_string()).collect())
}

pub fn leer_clave(claves: &Claves<'_>) -> Result<[u8; 32]> {
    let b64 = claves
        .leer(AJUSTE_SECRETA)?
        .ok_or_else(|| anyhow!("no hay clave de firma: conecta una cuenta en Ajustes"))?;
    STANDARD
        .decode(b64)?
        .try_into()
        .map_err(|_| anyhow!("la clave de firma está corrupta"))
}

/// Rotar archiva la vieja en vez de borrarla: lo ya publicado conserva su
/// firma y se tiene que poder seguir comprobando.
pub fn rotar(claves: &Claves<'_>) -> Result<Vec<String>> {
    if let Some(vieja) = claves.leer(AJUSTE_SECRETA)? {
        let mut archivo: Vec<String> = claves
            .leer(AJUSTE_ARCHIVADAS)?
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default();
        archivo.push(vieja);
        claves.guardar(AJUSTE_ARCHIVADAS, &serde_json::to_string(&archivo)?)?;
    }
    crear_clave(claves)
}

/// Pide un código de dispositivo. `scope` pide exactamente lo que la interfaz
/// enseña en Ajustes, ni un permiso más.
pub async fn arrancar(proveedor: &str) -> Result<CodigoDispositivo> {
    if proveedor != "github" {
        return Err(anyhow!("de momento solo GitHub tiene flujo de dispositivo"));
    }
    #[derive(Deserialize)]
    struct R {
        device_code: String,
        user_code: String,
        verification_uri: String,
        interval: u64,
    }
    let r: R = reqwest::Client::new()
        .post("https://github.com/login/device/code")
        .header("accept", "application/json")
        .form(&[("client_id", CLIENTE_GITHUB), ("scope", "public_repo")])
        .send()
        .await?
        .json()
        .await?;
    // El device_code se guarda en memoria del comando que llama; aquí solo
    // sale lo que el usuario tiene que ver.
    Ok(CodigoDispositivo { codigo: r.user_code, url: r.verification_uri, intervalo: r.interval })
}
```

- [ ] **Step 3: Registrar el módulo y los comandos**

En `indexer/src-tauri/src/lib.rs`, junto al resto de `mod`:

```rust
mod identidad;
```

Añadir a `Estado` el campo que guarda el código en vuelo entre `arrancar` y `sondear`:

```rust
    pub identidad_en_curso: std::sync::Mutex<Option<(String, String)>>, // (proveedor, device_code)
```

inicializado a `None` en `run()`, y registrar en `invoke_handler![...]`:
`identidad_arrancar, identidad_sondear, identidad_leer, identidad_cerrar, identidad_respaldo, identidad_rotar`.

- [ ] **Step 4: Compilar**

Run: `cd indexer/src-tauri && cargo check --message-format=short`
Expected: sin errores.

- [ ] **Step 5: Comprobar que no se rompió nada**

Run: `cd indexer/src-tauri && cargo test`
Expected: PASS, los tests que ya había.

- [ ] **Step 6: Commit**

```bash
git add indexer/src-tauri/src/identidad.rs indexer/src-tauri/src/lib.rs indexer/src-tauri/Cargo.toml
git commit -m "Identidad: la cuenta dice donde vive el paquete, la clave dice quien lo hizo"
```

---

## Task 5: Identidad en la interfaz

Dos sitios: un paso saltable en el setup, y el único lugar donde la identidad se toca. Detalle visual en las maquetas, pantallas 1 y 2.

**Files:**
- Create: `indexer/src/setup/IdentityStep.tsx`, `indexer/src/settings/IdentityPanel.tsx`
- Modify: `indexer/src/lib/api.ts`, `indexer/src/App.tsx`, `indexer/src/settings/SettingsView.tsx`

**Interfaces:**
- Consumes: los comandos de la Task 4.
- Produces: `api.identidadArrancar/Sondear/Leer/Cerrar/Respaldo/Rotar`, tipos `CodigoDispositivo` y `Sesion`; componentes `<IdentityStep onHecho onSaltar />` e `<IdentityPanel />`.

- [ ] **Step 1: Añadir los tipos y las llamadas**

En `indexer/src/lib/api.ts`, junto a los demás tipos:

```ts
export interface CodigoDispositivo { codigo: string; url: string; intervalo: number }
export interface Sesion {
  proveedor: string; cuenta: string; avatar: string;
  desde: string; huella: string; permisos: string[];
}
```

y dentro de `api`:

```ts
  identidadArrancar: (proveedor: string) => invoke<CodigoDispositivo>("identidad_arrancar", { proveedor }),
  identidadSondear: () => invoke<Sesion | null>("identidad_sondear"),
  identidadLeer: () => invoke<Sesion | null>("identidad_leer"),
  identidadCerrar: () => invoke<void>("identidad_cerrar"),
  identidadRespaldo: () => invoke<string[]>("identidad_respaldo"),
  identidadRotar: () => invoke<string[]>("identidad_rotar"),
```

- [ ] **Step 2: Escribir `IdentityStep.tsx`**

Cuatro estados —sin sesión, esperando, conectado con clave nueva, error de red— exactamente como la pantalla 1 de las maquetas. El sondeo usa `setInterval` con `intervalo * 1000`, el mismo patrón de `LegacyImportDialog`, y se limpia en el `return` del `useEffect`. El botón «Continuar» del estado conectado está deshabilitado hasta que la casilla «la he guardado» esté marcada — el respaldo se enseña una sola vez y no hay recuperación.

El enlace «continuar sin cuenta» llama a `onSaltar()` sin más: **sin identidad la aplicación funciona entera menos publicar**, y bloquear el arranque por un login que quizá no se necesita hoy sería un mal cambio.

- [ ] **Step 3: Escribir `IdentityPanel.tsx`**

Bloque de sesión (avatar, cuenta, fecha en `font-mono`, cambiar de cuenta, cerrar sesión) y bloque de clave (huella en `font-mono`, publicaciones firmadas, ver respaldo, rotar). Bajo el botón de rotar, el texto que explica que **lo ya publicado conserva la firma vieja** y sigue siendo válido.

- [ ] **Step 4: Enchufarlo**

En `App.tsx`, insertar `IdentityStep` en el setup después de `ServicesBoot`. En `SettingsView.tsx`, `IdentityPanel` como primer bloque.

- [ ] **Step 5: Verificar**

Run: `cd indexer && npx tsc -b --noEmit && npm run lint && npm run build`
Expected: sin errores.

- [ ] **Step 6: Commit**

```bash
git add indexer/src/setup/IdentityStep.tsx indexer/src/settings/IdentityPanel.tsx indexer/src/lib/api.ts indexer/src/App.tsx indexer/src/settings/SettingsView.tsx
git commit -m "El paso de identidad, saltable: sin cuenta la app funciona entera menos publicar"
```

---

## Task 6: Publicar

Componer la ficha, trocear, cifrar y subir. Trabajo de fondo con el patrón `arrancar`/`progreso` que ya usan descarga, ingesta y sellado.

**El orden de subida es cuerpos → capas → ficha**, y no es un detalle: mientras falte un asset la ficha no se publica, y sin ficha el paquete no existe para nadie. Una subida cortada a mitad es invisible en vez de ser un índice a medias que alguien se encuentra.

**Files:**
- Create: `indexer/src-tauri/src/publicar.rs`
- Modify: `indexer/src-tauri/src/lib.rs`, `indexer/src-tauri/src/store.rs`

**Interfaces:**
- Consumes: `lumi_index::{troceado, cifrado, ficha}` (Tasks 1-3), `identidad::leer_clave` (Task 4), `store::Almacen`.
- Produces: comandos `publicar_repos() -> Vec<Repo>`, `publicar_previsualizar(indice_id: i64) -> Previsualizacion`, `publicar_arrancar(indice_id: i64, repo: String, descargo: bool)`, `publicar_progreso() -> ProgresoPublicacion`, `publicar_continuar(indice_id: i64)`; y `struct ProgresoPublicacion { asset: String, hechos: u32, total: u32, bytes_hechos: u64, bytes_total: u64, terminado: bool, error: Option<String>, registro: Vec<String> }`.

- [ ] **Step 1: La tabla que permite reanudar**

En `store.rs`, dentro del `CREATE TABLE IF NOT EXISTS` del esquema:

```sql
CREATE TABLE IF NOT EXISTS publicaciones (
  indice_id INTEGER NOT NULL,
  asset     TEXT    NOT NULL,
  sha256    TEXT    NOT NULL,
  bytes     INTEGER NOT NULL,
  subido    INTEGER NOT NULL DEFAULT 0,
  url       TEXT,
  PRIMARY KEY (indice_id, asset)
);
```

y los métodos `publicacion_apuntar`, `publicacion_marcar_subido`, `publicacion_pendientes(indice_id)`, siguiendo el patrón exacto de `descarga_marcar`/`descargas_pendientes` que ya existen en el mismo fichero.

- [ ] **Step 2: Escribir `publicar.rs`**

Estructura del módulo, en este orden:

1. `fn previsualizar(almacen, indice_id) -> Previsualizacion` — lee `filas_publicables`, agrupa bytes por quadkey, llama a `troceado::trocear(&pesos, TOPE_TROZO_BYTES)`, y devuelve los trozos con su zona y su peso más las fuentes no redistribuibles que llevan descargo.
2. `async fn publicar(...)` — por cada trozo: empaquetar en zip, `cifrado::cifrar`, subir, apuntar en `publicaciones`. Después las capas. **Al final** compone la `Ficha`, la firma con `identidad::leer_clave` y la sube.
3. `async fn subir_asset(cliente, repo, release, ruta) -> Result<String>` — un `PUT` a `uploads.github.com`, con tres reintentos y espera creciente. Si los tres fallan, se abandona ese asset y el resto queda en `publicaciones` para reanudar.

Guardas obligatorias al principio de `publicar_arrancar`:

```rust
    // Publicar un indice abierto no tiene sentido: el contenido cambiaria
    // bajo los pies del hash que se acaba de firmar.
    if !estado.almacen.indice_sellado(indice_id)? {
        return Err("solo se puede publicar un índice sellado".into());
    }
```

- [ ] **Step 3: Registrar los comandos**

En `lib.rs`: `mod publicar;`, el campo `publicacion: std::sync::Mutex<Option<Arc<publicar::Publicacion>>>` en `Estado` inicializado a `None`, y los cinco comandos en `invoke_handler![...]`.

- [ ] **Step 4: Compilar y probar**

Run: `cd indexer/src-tauri && cargo check --message-format=short && cargo test`
Expected: sin errores, tests en verde.

- [ ] **Step 5: Commit**

```bash
git add indexer/src-tauri/src/publicar.rs indexer/src-tauri/src/lib.rs indexer/src-tauri/src/store.rs
git commit -m "Publicar: la ficha se sube la ultima, para que una subida cortada sea invisible"
```

---

## Task 7: El diálogo de publicar

Tres pasos y ninguna sorpresa: se ve el troceado exacto y el peso antes de subir un byte, igual que se ven los euros antes de descargar. Pantalla 6 de las maquetas.

**Files:**
- Create: `indexer/src/publish/PublishDialog.tsx`
- Modify: `indexer/src/lib/api.ts`, `indexer/src/catalog/IndexDetail.tsx`

**Interfaces:**
- Consumes: los comandos de la Task 6.
- Produces: `<PublishDialog indiceId nombre onHecho />`.

- [ ] **Step 1: Tipos y llamadas**

En `api.ts`: `Repo`, `Previsualizacion`, `ProgresoPublicacion`, y `publicarRepos`, `publicarPrevisualizar`, `publicarArrancar`, `publicarProgreso`, `publicarContinuar`.

- [ ] **Step 2: Escribir el diálogo**

Tres pasos con estado local `paso: 1 | 2 | 3 | "subiendo"`. El paso 3 **solo aparece si hay fuentes no redistribuibles**; si no las hay, el paso 2 lleva directo a publicar.

El descargo del paso 3, literal:

> Sus términos no permiten redistribuirlas. Al publicar, esas imágenes quedan accesibles en un repositorio a tu nombre: **la responsabilidad y cualquier reclamación de retirada son tuyas**, no de Lumi. Si el asset se retira, las teselas que reclama vuelven a quedar libres para todos.

con una casilla obligatoria. El botón «Publicar» está `disabled` mientras no esté marcada.

El estado «subiendo» sondea `publicarProgreso` cada 600 ms, se puede cerrar sin cancelar —la subida sigue de fondo— y el check de cada asset terminado se dibuja con `jg-stroke-draw`.

- [ ] **Step 3: El botón en la ficha del índice**

En `IndexDetail.tsx`, junto a «Sellar», dentro del bloque que ya distingue sellado de abierto:

```tsx
{sellado && (
  <button onClick={() => setPublicando(true)} disabled={!haySesion}
    title={haySesion ? undefined : "conecta una cuenta en Ajustes para publicar"}
    className="jg-press rounded-lg border border-border px-3 py-1.5 text-[11px] text-fg disabled:opacity-40">
    Publicar
  </button>
)}
```

- [ ] **Step 4: Verificar**

Run: `cd indexer && npx tsc -b --noEmit && npm run lint && npm run build`
Expected: sin errores.

- [ ] **Step 5: Commit**

```bash
git add indexer/src/publish/PublishDialog.tsx indexer/src/lib/api.ts indexer/src/catalog/IndexDetail.tsx
git commit -m "El dialogo de publicar: se ve el troceado y el peso antes de subir un byte"
```

> **Punto de corte.** Aquí el producto ya publica un índice sellado de punta a punta. Probar de verdad antes de seguir.

---

# Fase B — Encontrar, reclamar, instalar

## Task 8: El catálogo remoto

Recorrer los repositorios con la etiqueta, traerse **solo las fichas** —kilobytes— y guardarlas. Nunca al mover el mapa: al abrir Territorio, al abrir Índices, y a petición. Misma regla que la capa de disponibilidad del 7b.

**Files:**
- Create: `indexer/src-tauri/src/catalogo.rs`
- Modify: `indexer/src-tauri/src/lib.rs`, `indexer/src-tauri/src/store.rs`

**Interfaces:**
- Consumes: `lumi_index::ficha::Ficha` (Task 3), `identidad` (Task 4).
- Produces: comandos `catalogo_refrescar()`, `catalogo_buscar(texto: String) -> Resultados`, `catalogo_perfil(cuenta: String) -> Perfil`, `catalogo_mios() -> Vec<RepoRemoto>`, `catalogo_reclamos(quadkeys: Vec<String>) -> Vec<Reclamo>`; y `struct Reclamo { quadkey: String, fuente: String, paquete: String, autor: String, url: String, sha256: String }`.

- [ ] **Step 1: Las tablas**

En `store.rs`:

```sql
CREATE TABLE IF NOT EXISTS fichas_remotas (
  paquete TEXT PRIMARY KEY,
  autor   TEXT NOT NULL,
  url     TEXT NOT NULL,
  json    TEXT NOT NULL,
  vista   TEXT NOT NULL,
  viva    INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS cobertura_remota (
  quadkey TEXT NOT NULL,
  fuente  TEXT NOT NULL,
  paquete TEXT NOT NULL,
  PRIMARY KEY (quadkey, fuente, paquete)
);
CREATE TABLE IF NOT EXISTS desreclamos (paquete TEXT PRIMARY KEY, motivo TEXT);
```

`cobertura_remota` se reconstruye entera en cada refresco a partir de `fichas_remotas`: es caché derivada, no verdad. La verdad es la ficha.

- [ ] **Step 2: Escribir `catalogo.rs`**

1. `async fn refrescar(...)` — busca repositorios con `topic:lumi-index`, lista sus releases, descarga cada `ficha.json`, **llama a `f.comprobar()` y descarta la que no pase**, y la guarda.
2. `async fn comprobar_vivos(...)` — una petición de cabecera por asset. **Un 404 marca `viva = 0`**, y con ello el reclamo se cae y las teselas vuelven a `nueva`. Cubre repositorio borrado, pasado a privado o asset retirado, sin intervención humana.
3. `fn caducadas(...)` — fichas cuya `vigente_hasta` ya pasó, que también dejan de reclamar.
4. `fn reclamos(almacen, quadkeys) -> Vec<Reclamo>` — consulta `cobertura_remota` uniendo con `fichas_remotas WHERE viva = 1` y excluyendo `desreclamos`.

Un repositorio privado no necesita código: su ficha no se puede leer, así que nunca entra en `fichas_remotas` y por tanto **no reclama nada**. Es consecuencia del diseño, no una comprobación — pero conviene que quede el comentario, porque parece un olvido y no lo es.

- [ ] **Step 3: La lista de desreclamos**

El único punto de contacto con la web del subsistema 9, y **solo puede quitar**:

```rust
/// La web puede QUITAR reclamos, nunca anadirlos. Esa asimetria es lo que
/// impide que el producto dependa de un servicio: si esto no responde, se usa
/// la ultima lista conocida y todo lo demas sigue funcionando.
const URL_DESRECLAMOS: &str = "http://localhost:8788/desreclamos.json";

pub async fn refrescar_desreclamos(almacen: &Almacen) -> Result<()> {
    let Ok(r) = reqwest::get(URL_DESRECLAMOS).await else { return Ok(()) };
    let lista: Vec<(String, String)> = r.json().await.unwrap_or_default();
    // Firmada por Lumi: una lista sin firma valida no quita nada a nadie.
    almacen.desreclamos_fijar(&lista)
}
```

Mientras el 9 no exista, la URL apunta a una instancia local y un fallo de red **no es un error**: se sigue con lo que hubiera.

- [ ] **Step 4: Compilar y probar**

Run: `cd indexer/src-tauri && cargo check --message-format=short && cargo test`
Expected: sin errores.

- [ ] **Step 4: Commit**

```bash
git add indexer/src-tauri/src/catalogo.rs indexer/src-tauri/src/lib.rs indexer/src-tauri/src/store.rs
git commit -m "El catalogo remoto: solo fichas, y la que no lleva firma valida no entra"
```

---

## Task 9: El reclamo entra en Territorio

Cuarto estado de tesela. El reclamo es **duro** y la unidad es `(quadkey, fuente)`, no la tesela entera: puedes reclamar el Mapillary de una zona y dejar libre su Commons.

**Files:**
- Modify: `crates/lumi-index/src/coverage.rs`, `indexer/src-tauri/src/lib.rs`

**Interfaces:**
- Consumes: `catalogo::Reclamo` (Task 8).
- Produces: `coverage::Estado::Reclamada { paquete: String, autor: String }`, y `fn descontar_reclamadas(clasificadas: &mut Vec<(String, Estado)>, reclamos: &[(String, String)])`.

- [ ] **Step 1: Escribir los tests que fallan**

En `crates/lumi-index/src/coverage.rs`, dentro de su `mod tests`:

```rust
    #[test]
    fn una_tesela_reclamada_sale_del_plan() {
        let mut c = vec![("0313101".to_string(), Estado::Nuevo)];
        descontar_reclamadas(&mut c, &[("0313101".into(), "mapillary".into())]);
        assert!(matches!(c[0].1, Estado::Reclamada { .. }));
    }

    // El reclamo es por (quadkey, fuente): un paquete de una sola fuente no
    // puede cerrar un territorio entero.
    #[test]
    fn reclamar_una_fuente_no_reclama_las_demas() {
        let mut c = vec![("0313101".to_string(), Estado::Nuevo)];
        descontar_reclamadas(&mut c, &[("0313101".into(), "commons".into())]);
        assert!(matches!(c[0].1, Estado::Reclamada { .. }));
        // …y la clasificación por origen mantiene mapillary como nueva.
    }

    #[test]
    fn lo_que_ya_es_local_no_se_reclama() {
        let mut c = vec![("0313101".to_string(), Estado::Local {
            indice: "mio".into(), sha256: "aa".into(),
        })];
        descontar_reclamadas(&mut c, &[("0313101".into(), "mapillary".into())]);
        assert!(matches!(c[0].1, Estado::Local { .. }), "lo tuyo gana sobre lo ajeno");
    }
```

- [ ] **Step 2: Comprobar que fallan**

Run: `cargo test -p lumi-index coverage`
Expected: FAIL — `no variant named 'Reclamada'`.

- [ ] **Step 3: Implementar**

Añadir la variante a `Estado` y la función, que solo pisa `Estado::Nuevo`: lo que ya tienes en local gana siempre sobre lo ajeno.

- [ ] **Step 4: Comprobar que pasan**

Run: `cargo test -p lumi-index`
Expected: PASS, todos.

- [ ] **Step 5: Enchufarlo en `territorio_clasificar`**

En `lib.rs`, tras clasificar y antes de devolver, llamar a `catalogo::reclamos` con las quadkeys del polígono y aplicar `descontar_reclamadas`. Así **el coste en euros que el operador ve ya lleva el descuento**, que es el punto entero.

- [ ] **Step 6: Commit**

```bash
git add crates/lumi-index/src/coverage.rs indexer/src-tauri/src/lib.rs
git commit -m "La tesela reclamada sale del plan antes de estimar, para que el euro que se ve sea el real"
```

---

## Task 10: Territorio, en pantalla

Pantalla 7 de las maquetas. **No hay botón de instalar aquí**: lo reclamado será una dependencia, y quien indexa no descarga nada de nadie.

**Files:**
- Modify: `indexer/src/territory/MapCanvas.tsx`, `indexer/src/territory/AvailabilityPanel.tsx`, `indexer/src/index.css`

- [ ] **Step 1: El cuarto estado en el mapa**

Relleno `rgba(239,159,39,.13)`, borde `rgba(239,159,39,.45)` y rayado diagonal. Entrada con `jg-tile-sweep`: desfase por **distancia al centro del grupo**, no por orden en el DOM — así se abre hacia fuera y se lee como «esta zona entera», que es lo que comunica.

En `index.css`:

```css
@keyframes jg-tile-sweep { from { opacity: 0 } to { opacity: 1 } }
@keyframes jg-strike { to { transform: scaleX(1) } }
@keyframes jg-stroke-draw { to { stroke-dashoffset: 0 } }
```

- [ ] **Step 2: La leyenda y el interruptor**

Cuarta entrada «reclamada por otro» y un interruptor de capa, en la leyenda que ya existe.

- [ ] **Step 3: El panel**

Fila «Reclamadas por otros» con su recuento, el desglose por autor, y el coste con el precio anterior tachado dibujando la línea (`jg-strike`). Los números se interpolan en 520 ms con `font-variant-numeric: tabular-nums` para que el ancho no baile.

Bajo el desglose, y **en lugar de cualquier botón de instalar**:

> Ni las descargas del proveedor ni te descargas sus paquetes: **no entran en tu índice**. Tu ficha declara que esa zona la cubren ellos, y quien instale tu índice desde el catálogo se los baja también.

- [ ] **Step 4: El popup de tesela, y reportar**

Al pulsar una tesela reclamada: quién la cubre, cuándo se publicó, cuántas imágenes tiene ahí, sus fuentes, y **ningún botón de instalar** — en su lugar, la línea «viajará como dependencia de tu índice, no en él».

Debajo, «Reportar», que compone la petición de desreclamo hacia la web. **Qué cuenta como baja calidad lo decide el 9**; aquí solo se manda el paquete y el motivo escrito por el operador.

- [ ] **Step 5: Verificar**

Run: `cd indexer && npx tsc -b --noEmit && npm run lint && npm run build`
Expected: sin errores.

- [ ] **Step 6: Commit**

```bash
git add indexer/src/territory indexer/src/index.css
git commit -m "El reclamo en el mapa: el barrido ensena de donde sale el descuento en vez de decirlo"
```

---

## Task 11: Buscador, repositorios remotos y perfil

Pantallas 3, 4 y 5. **`IndexDetail` no se duplica** para el modo remoto: recibe una marca de solo lectura, el mismo mecanismo que ya usa con un índice sellado.

**Files:**
- Create: `indexer/src/catalog/CatalogSearch.tsx`, `indexer/src/catalog/RemoteRepos.tsx`, `indexer/src/catalog/ProfileDialog.tsx`
- Modify: `indexer/src/catalog/IndexList.tsx`, `indexer/src/catalog/IndexDetail.tsx`, `indexer/src/lib/api.ts`

- [ ] **Step 1: Tipos y llamadas** — `Resultados`, `Perfil`, `RepoRemoto`, y `catalogoBuscar`, `catalogoPerfil`, `catalogoMios`, `catalogoRefrescar`.

- [ ] **Step 2: `CatalogSearch`** — resuelve primero contra el mapa local (instantáneo) y completa con la red. Resultados en dos grupos, índices y cuentas, entrando con desfase de 20 ms. Sin animar la altura del desplegable: eso es layout.

- [ ] **Step 3: `RemoteRepos`** — agrupado **por repositorio**, no por índice, con estado por paquete: `publicado`, `subiendo n/m`, `incompleto` (con «Continuar subida», que llama a `publicarContinuar`), `no disponible`.

- [ ] **Step 4: `ProfileDialog`** — con publicaciones, las estadísticas que salen de las fichas; sin ellas, «esta cuenta no ha publicado nada para Lumi», que no es un error sino una cuenta de GitHub normal.

- [ ] **Step 5: `IndexDetail` en solo lectura** — nueva prop `soloLectura?: boolean` que esconde todo lo que escribe, exactamente como ya hace con `sellado`.

- [ ] **Step 6: Verificar**

Run: `cd indexer && npx tsc -b --noEmit && npm run lint && npm run build`
Expected: sin errores.

- [ ] **Step 7: Commit**

```bash
git add indexer/src/catalog indexer/src/lib/api.ts
git commit -m "Buscar y mirar lo publicado, sin una pantalla paralela que mantener"
```

---

## Task 12: El grafo de dependencias

Lo que no indexas porque ya lo cubría otro se declara. Instalar es descargar el grafo, y ese grafo **es** el árbol de «hecho con la colaboración de»: no se construye aparte.

**Files:**
- Create: `crates/lumi-index/src/grafo.rs`
- Modify: `crates/lumi-index/src/lib.rs`

**Interfaces:**
- Consumes: `ficha::{Ficha, Dependencia}` (Task 3).
- Produces: `struct Nodo { paquete, autor, url, sha256, bytes, quadkeys, profundidad, roto }`, `struct Grafo { nodos: Vec<Nodo>, bytes_total: u64, quadkeys_total: usize, rotas: Vec<String> }`, `fn resolver(raiz: &Ficha, buscar: &dyn Fn(&str) -> Option<Ficha>) -> Grafo`.

- [ ] **Step 1: Declarar el módulo** — `pub mod grafo;` en `lib.rs`, entre `filter` y `legacy`.

- [ ] **Step 2: Escribir los tests que fallan**

Crear `crates/lumi-index/src/grafo.rs` con **solo** el bloque de tests:

```rust
//! Resolver las dependencias de un paquete antes de descargarlo.

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ficha::{Dependencia, Ficha};

    fn ficha(paquete: &str, deps: &[&str]) -> Ficha {
        Ficha {
            version: 1, paquete: paquete.into(), nombre: paquete.into(),
            autor: "quien".into(), alojamiento: "github".into(),
            clave_publica: String::new(), publicada_en: String::new(),
            vigente_hasta: String::new(), cifrado: String::new(),
            no_redistribuible: vec![], fuentes_por_quadkey: vec![],
            cuerpos: vec![], capas: vec![],
            dependencias: deps.iter().map(|d| Dependencia {
                quadkeys: vec![format!("qk-{d}")], paquete: (*d).into(),
                autor: "otro".into(), url: format!("http://x/{d}"), sha256: "aa".into(),
            }).collect(),
            firma: String::new(),
        }
    }

    #[test]
    fn resuelve_en_cadena() {
        let a = ficha("a", &["b"]);
        let g = resolver(&a, &|p| match p {
            "b" => Some(ficha("b", &["c"])),
            "c" => Some(ficha("c", &[])),
            _ => None,
        });
        let nombres: Vec<&str> = g.nodos.iter().map(|n| n.paquete.as_str()).collect();
        assert_eq!(nombres, vec!["a", "b", "c"]);
    }

    // Sin corte, dos paquetes que se citan entre sí cuelgan la instalación.
    #[test]
    fn un_ciclo_no_cuelga() {
        let a = ficha("a", &["b"]);
        let g = resolver(&a, &|p| match p {
            "b" => Some(ficha("b", &["a"])),
            _ => None,
        });
        assert_eq!(g.nodos.len(), 2);
    }

    // Una dependencia muerta no aborta la instalación: se instala lo que hay
    // y se dice qué falta. El indice sirve, incompleto y honesto.
    #[test]
    fn una_dependencia_rota_se_marca_y_no_aborta() {
        let a = ficha("a", &["fantasma"]);
        let g = resolver(&a, &|_| None);
        assert_eq!(g.rotas, vec!["fantasma".to_string()]);
        assert_eq!(g.nodos.len(), 1);
    }

    #[test]
    fn un_paquete_sin_dependencias_es_autonomo() {
        let g = resolver(&ficha("solo", &[]), &|_| None);
        assert_eq!(g.nodos.len(), 1);
        assert!(g.rotas.is_empty());
    }
}
```

- [ ] **Step 3: Comprobar que no compila**

Run: `cargo test -p lumi-index grafo`
Expected: FAIL — `cannot find function 'resolver'`.

- [ ] **Step 4: Implementar** — recorrido en anchura con un `HashSet` de paquetes ya visitados; una dependencia que `buscar` no encuentra va a `rotas` y no aborta; `bytes_total` suma los `cuerpos` de cada nodo.

- [ ] **Step 5: Comprobar que pasan**

Run: `cargo test -p lumi-index grafo`
Expected: PASS, 4 tests.

- [ ] **Step 6: Commit**

```bash
git add crates/lumi-index/src/grafo.rs crates/lumi-index/src/lib.rs
git commit -m "El grafo de dependencias, que es tambien el arbol de con quien se hizo cada indice"
```

---

## Task 13: Declarar dependencias al publicar, y avisar cuando una muere

**Files:**
- Modify: `indexer/src-tauri/src/publicar.rs`, `indexer/src-tauri/src/catalogo.rs`, `indexer/src/catalog/IndexList.tsx`

- [ ] **Step 1: Rellenar `dependencias` en la ficha**

En `publicar.rs`, al componer la `Ficha`: por cada quadkey del área del índice que **no** está en sus propias filas pero **sí** en `cobertura_remota`, una entrada de `ficha::Dependencia` con el paquete, autor, url y sha256 de quien la cubre. Agrupadas por paquete.

- [ ] **Step 2: Detectar las rotas**

En `catalogo.rs`, tras `comprobar_vivos`: para cada índice **propio ya publicado**, cruzar sus dependencias con las fichas marcadas `viva = 0`. Sale gratis porque el refresco ya está pasando por ahí.

Nuevo comando `catalogo_dependencias_rotas() -> Vec<DependenciaRota>` con `{ indice_id, indice, paquete, autor, quadkeys, dias_caida }`.

- [ ] **Step 3: El aviso**

En `IndexList.tsx`, banner ámbar cuando la lista no está vacía, con el texto de la pantalla 10 y el botón «Indexar esa zona», que abre Territorio con esas quadkeys ya seleccionadas — **están libres otra vez**, porque el reclamo cayó con el 404.

- [ ] **Step 4: Verificar**

Run: `cd indexer/src-tauri && cargo check && cd .. && npx tsc -b --noEmit && npm run lint`
Expected: sin errores.

- [ ] **Step 5: Commit**

```bash
git add indexer/src-tauri/src/publicar.rs indexer/src-tauri/src/catalogo.rs indexer/src/catalog/IndexList.tsx
git commit -m "Declarar lo que aportan otros, y enterarse el dia que uno de ellos desaparece"
```

---

## Task 14: Capas de modelo

Un vector **es** el modelo: no hay conversión entre `lumi-2 2.1` y `2.2`. Lo que sí se evita para siempre es volver a comprarle píxeles al proveedor. Publicar una capa nueva no resube ni un byte de imagen.

Como quien no es el autor no tiene permiso de escritura en ese release, **una capa ajena se publica en un repositorio propio** y su ficha apunta al cuerpo original por hash.

**Files:**
- Modify: `indexer/src-tauri/src/publicar.rs`, `indexer/src-tauri/src/catalogo.rs`
- Create: `indexer/src/catalog/ModelLayers.tsx`

- [ ] **Step 1: Publicar una capa suelta**

Comando `publicar_capa_arrancar(cuerpo_sha256: String, modelo: String, repo: String)`: sube solo `capa-*`, con una ficha que lleva `cuerpos: []` y una referencia al cuerpo ajeno.

- [ ] **Step 2: La comprobación por muestreo**

`async fn comprobar_capa(...) -> Result<Muestreo>`: 50 imágenes al azar del cuerpo, embebidas en local con ese modelo, comparadas con la capa. **El modelo es determinista: o casan o no casan.**

Es lo único de todo el subsistema que mira dentro del contenido en vez del envoltorio, y no es opcional ni configurable — un vector envenenado sitúa una foto en el lugar equivocado con confianza alta, que es el peor fallo posible del producto.

- [ ] **Step 3: Dos capas del mismo modelo**

Conviven. Se listan ambas con su autor; gana la que pase el muestreo, y si pasan las dos, la del autor del cuerpo. No se borra ninguna: no hay autoridad que pueda decidir eso.

- [ ] **Step 4: `ModelLayers.tsx`**

Pantalla 8: aviso de modelo nuevo, tabla de índices por modelo, y «Publicar capa» incluso sobre el cuerpo de otra persona. Si no hay capa para tu modelo, «Embeber en local» en vez de rechazar el paquete.

- [ ] **Step 5: Verificar**

Run: `cd indexer/src-tauri && cargo check && cargo test && cd .. && npx tsc -b --noEmit && npm run lint && npm run build`
Expected: sin errores.

- [ ] **Step 6: Commit**

```bash
git add indexer/src-tauri/src/publicar.rs indexer/src-tauri/src/catalogo.rs indexer/src/catalog/ModelLayers.tsx
git commit -m "Un modelo nuevo no se reindexa: se publica una capa sobre un cuerpo que no se toca"
```

---

## Task 15: Instalar en Lumi Station

La única pieza de este subsistema que vive fuera del Indexer. Station **instala**; el Indexer **publica**.

**Files:**
- Create: `client/src/work/InstallDialog.tsx`, `crates/lumid/src/routes/catalogo.rs`
- Modify: `client/src-tauri/Cargo.toml`, `crates/lumid/src/routes/mod.rs`

**Interfaces:**
- Consumes: `lumi_index::grafo::resolver` (Task 12), `lumi_index::ficha::Ficha` (Task 3), `lumi_index::cifrado::descifrar` (Task 2).

- [ ] **Step 1: Resolver antes de descargar** — endpoint que toma una URL de ficha, la trae, llama a `resolver` y devuelve el `Grafo` con el peso sumado.

- [ ] **Step 2: El diálogo** — el árbol con sus conectores, el peso total, el recuento de personas. Los checks se dibujan escalonados. Estado con dependencia rota: aviso ámbar, cobertura `556 / 588`, y «Instalar sin esa zona».

- [ ] **Step 3: Comprobar cada firma al abrir**

```rust
    // Misma postura que el fingerprint del subsistema 1: si no cuadra, se
    // aborta y se dice cual. No hay dialogo de "instalar igualmente" — ese
    // dialogo es la puerta de entrada.
    f.comprobar().map_err(|e| anyhow!("firma invalida en {}: {e}", f.paquete))?;
```

- [ ] **Step 4: Verificar**

Run: `cargo test && cd client && npx tsc -b --noEmit && npm run lint && npm run build`
Expected: sin errores.

- [ ] **Step 5: Commit**

```bash
git add client/src/work/InstallDialog.tsx crates/lumid/src/routes/catalogo.rs crates/lumid/src/routes/mod.rs
git commit -m "Instalar es descargar un grafo, y cada firma se comprueba al abrirlo"
```

---

## Task 16: Cerrar los documentos que este subsistema cambia

Un subsistema que deja contradicciones escritas en los documentos vecinos no está terminado.

**Files:**
- Modify: `ARCHITECTURE.md`, `DESIGN.md`, `FUTURO.md`, `docs/superpowers/specs/2026-08-07-lumi-indexer-7b-design.md`, `docs/superpowers/plans/2026-08-08-lumi-indexer-7c.md`, `CLAUDE.md`

- [ ] **Step 1: `ARCHITECTURE.md` §5** — el 8 pasa a «Terminado», y su descripción crece con identidad, reclamo y dependencias.

- [ ] **Step 2: `DESIGN.md` · Movimiento** — registrar `jg-tile-sweep`, `jg-stroke-draw` y `jg-strike` junto a los keyframes que ya están.

- [ ] **Step 3: La regla que cambia** — «lo no redistribuible no viaja **en absoluto**» queda sustituida por «viaja con advertencia y descargo». Corregirlo en la spec del 7b y en las restricciones globales del plan 7c, **en los dos sitios**: dejarla contradictoria es peor que no haberla cambiado.

- [ ] **Step 4: `FUTURO.md`** — anotar lo que el 8 deja a propósito para el 9: el árbol dibujado, los perfiles ricos y el criterio de calidad para desreclamar.

- [ ] **Step 5: `CLAUDE.md`** — añadir el `.lumidx` publicado (ficha en claro, cuerpos y capas cifrados) junto a la descripción del formato que ya está.

- [ ] **Step 6: Commit**

```bash
git add ARCHITECTURE.md DESIGN.md FUTURO.md CLAUDE.md docs/superpowers
git commit -m "Cerrar los documentos: lo no redistribuible ahora viaja, y estaba escrito lo contrario en dos sitios"
```
