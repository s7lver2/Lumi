# Motor de inferencia (5-0 y 5a) — Plan de implementación

> **Para trabajadores agénticos:** SUB-SKILL OBLIGATORIA: usa `superpowers:subagent-driven-development` (recomendado) o `superpowers:executing-plans` para implementar este plan tarea a tarea. Los pasos usan casillas (`- [ ]`) para seguimiento.

**Objetivo:** que una imagen entre por el cliente de Lumi Station y salga un punto en el mapa —con sus hipótesis alternativas y la procedencia de cada una— contra un corpus instalado desde el catálogo del subsistema 8.

**Arquitectura:** Station gana Qdrant y la capacidad de instalar un `.lumidx` publicado. El trabajador de Python **solo embebe**; el daemon recupera candidatos, los agrupa por vecindad de tesela y los atribuye a su índice y su autor. La lógica de agrupación es pura y vive en `lumi-index`.

**Stack:** Rust (axum, rusqlite, reqwest, zip), Python sin dependencias para el trabajador, React + Tailwind en `client/`.

**Spec:** [`specs/2026-08-10-motor-inferencia-design.md`](../specs/2026-08-10-motor-inferencia-design.md) · Maquetas: [`specs/lumi-s5-mockups.html`](../specs/lumi-s5-mockups.html)

## Restricciones globales

Los requisitos de cada tarea incluyen implícitamente esta sección.

- **No se escriben tests salvo donde este plan lo diga explícitamente.** `CLAUDE.md` manda sobre el TDD por defecto. La única excepción es la Tarea 11 (agrupación), que es lógica no trivial y la spec §10 ya la justificó.
- **Un commit por tarea terminada**, nunca commits intermedios.
- **`ponytail` gobierna el código**: la solución más simple que funcione. Una simplificación deliberada lleva un comentario `// ponytail:` que nombra el techo con el que choca y la salida.
- **Español** en comentarios, mensajes de commit, copia de interfaz y documentos. Los identificadores de `lumid` van en inglés (`analyses`, `case_id`), que es la convención ya establecida en ese crate; los de `lumi-index` en español.
- **Sin verde en la paleta.** «Hecho» es blanco. Fuente mono para todo lo que produce una máquina (coordenadas, sha256, rutas, bytes). Iconos SVG a mano, sin librería. Solo `ease-out`, nada de `vw`/`vh`.
- **`limits::effective` es la única forma legítima** de leer los límites de un usuario. Nunca leer la tabla `limits` directamente.
- **Ninguna firma se salta.** Ni al instalar la raíz ni al resolver una dependencia. No existe «instalar igualmente».
- **El progreso de un trabajo no se persiste nunca**: se retransmite por SSE y se olvida (regla del subsistema 4).
- Verificación al final de cada tarea: `cargo test && cargo clippy --all-targets -- -D warnings` en la raíz, y `cd client && npx tsc -b --noEmit && npm run lint && npm run build` cuando la tarea toque `client/`.

## Estructura de ficheros

**Crear:**

| Fichero | Responsabilidad |
|---|---|
| `crates/lumi-index/src/agrupar.rs` | Lógica pura: candidatos → grupos → hipótesis. Con tests. |
| `crates/lumid/src/qdrant.rs` | Cliente HTTP de Qdrant para Station: colección, subir, buscar, borrar. |
| `crates/lumid/src/indices/mod.rs` | Instalar un índice: orquestación y estado. |
| `crates/lumid/src/indices/paquete.rs` | Abrir un asset publicado: descargar, verificar, descifrar, descomprimir. |
| `crates/lumid/src/indices/volcar.rs` | Volcar un paquete abierto a disco, SQLite y Qdrant. |
| `crates/lumid/src/routes/indices.rs` | Endpoints de instalar, listar, desinstalar y progreso. |
| `crates/lumid/src/recuperar.rs` | Consulta → candidatos con procedencia → hipótesis. |
| `workers/lumi_geo.py` | El trabajador de geolocalización: solo embebe. |
| `client/src/admin/IndicesPanel.tsx` | Lo instalado, con desinstalar y el botón de instalar. |
| `client/src/admin/InstallFlow.tsx` | Pega la URL, resuelve el grafo y abre `InstallDialog`. |

**Modificar:** `crates/lumi-proto/src/worker.rs`, `crates/lumi-index/src/lib.rs`, `crates/lumid/src/{main.rs,store.rs,lib.rs}`, `crates/lumid/src/queue/{mod.rs,worker.rs}`, `crates/lumid/src/routes/{mod.rs,analyses.rs}`, `client/src/lib/api.ts`, `client/src/work/{InstallDialog.tsx,ResultsDrawer.tsx,MapCanvas.tsx}`, `client/src/App.tsx`.

---

# Fase A · El corpus llega a Station (5-0)

## Task 1: Qdrant en Station

**Files:**
- Create: `crates/lumid/src/qdrant.rs`
- Modify: `crates/lumid/src/lib.rs` (o `main.rs`, donde estén los `mod`), `crates/lumid/Cargo.toml`

**Interfaces:**
- Produce: `qdrant::coleccion_de(modelo, version) -> String`, `qdrant::Cliente::{nuevo, asegurar_coleccion, subir, buscar, borrar}`.

Es el mismo cliente que el Indexer ya tiene en `indexer/src-tauri/src/qdrant.rs`. Se copia en vez de compartirse: `lumi-index` es lógica pura sin red por decisión del 7a, y meter `reqwest` ahí para ahorrar cien líneas rompería esa frontera. **Se añade `buscar`, que el Indexer no necesitaba** — el Indexer escribe vectores, Station los consulta.

- [ ] **Paso 1: El módulo**

```rust
//! Qdrant, del lado de Station. El Indexer escribe vectores; aquí se leen.
//!
//! Una colección por `(modelo, versión)`: los modelos van de 8448 a 12288
//! dimensiones y un vector de uno no significa nada en el espacio de otro.

use anyhow::{anyhow, Result};
use serde::Deserialize;

const BASE: &str = "http://127.0.0.1:6333";

pub fn coleccion_de(modelo: &str, version: &str) -> String {
    format!("lumi_{}_{}", modelo.replace('-', "_"), version.replace('.', "_"))
}

/// Un candidato tal como sale de Qdrant: el `id` es la fila de
/// `reference_images` en SQLite, que es lo que le da procedencia.
#[derive(Debug, Clone)]
pub struct Vecino {
    pub id: i64,
    pub similitud: f32,
}

pub struct Cliente {
    http: reqwest::Client,
}

impl Cliente {
    pub fn nuevo() -> Self {
        Self {
            http: reqwest::Client::builder()
                .connect_timeout(std::time::Duration::from_secs(5))
                .timeout(std::time::Duration::from_secs(120))
                .build()
                .expect("construir el cliente HTTP no debería fallar"),
        }
    }

    pub async fn asegurar_coleccion(&self, nombre: &str, dims: u32) -> Result<()> {
        let existe = self
            .http
            .get(format!("{BASE}/collections/{nombre}"))
            .send()
            .await
            .map(|r| r.status().is_success())
            .unwrap_or(false);
        if existe {
            return Ok(());
        }
        let r = self
            .http
            .put(format!("{BASE}/collections/{nombre}"))
            .json(&serde_json::json!({
                "vectors": { "size": dims, "distance": "Cosine" }
            }))
            .send()
            .await?;
        if !r.status().is_success() {
            return Err(anyhow!("crear la colección {nombre}: {}", r.status()));
        }
        Ok(())
    }

    /// Los `ids` son filas de `reference_images`. El troceado sale del tamaño
    /// REAL del vector y no de un número fijo: cada float viaja como texto en
    /// JSON, así que un lote que vale para 8448 dimensiones revienta con
    /// 12288. Misma lección que costó una tarde en el Indexer.
    pub async fn subir(&self, nombre: &str, ids: &[i64], vectores: &[Vec<f32>]) -> Result<()> {
        const TOPE_BYTES: usize = 16 << 20;
        const BYTES_POR_FLOAT_JSON: usize = 32;
        let dims = vectores.first().map(|v| v.len()).unwrap_or(0).max(1);
        let por_lote = (TOPE_BYTES / (dims * BYTES_POR_FLOAT_JSON)).max(1);

        for trozo in 0..ids.len().div_ceil(por_lote) {
            let desde = trozo * por_lote;
            let hasta = (desde + por_lote).min(ids.len());
            let puntos: Vec<serde_json::Value> = (desde..hasta)
                .map(|i| serde_json::json!({ "id": ids[i], "vector": vectores[i] }))
                .collect();
            let r = self
                .http
                .put(format!("{BASE}/collections/{nombre}/points?wait=true"))
                .json(&serde_json::json!({ "points": puntos }))
                .send()
                .await?;
            if !r.status().is_success() {
                return Err(anyhow!("subir puntos a {nombre}: {}", r.status()));
            }
        }
        Ok(())
    }

    /// Los `limite` vecinos más próximos. Devuelve ids de SQLite, no vectores:
    /// lo que hace falta después es la procedencia, no los números.
    pub async fn buscar(&self, nombre: &str, vector: &[f32], limite: usize) -> Result<Vec<Vecino>> {
        #[derive(Deserialize)]
        struct Punto {
            id: i64,
            score: f32,
        }
        #[derive(Deserialize)]
        struct Respuesta {
            result: Vec<Punto>,
        }
        let r = self
            .http
            .post(format!("{BASE}/collections/{nombre}/points/search"))
            .json(&serde_json::json!({
                "vector": vector, "limit": limite, "with_payload": false
            }))
            .send()
            .await?;
        if !r.status().is_success() {
            return Err(anyhow!("buscar en {nombre}: {}", r.status()));
        }
        let cuerpo: Respuesta = r.json().await?;
        Ok(cuerpo
            .result
            .into_iter()
            .map(|p| Vecino { id: p.id, similitud: p.score })
            .collect())
    }

    /// Al desinstalar un índice. Los puntos de otros índices no se tocan
    /// porque el `id` es la fila de SQLite y es único en toda la aplicación.
    pub async fn borrar(&self, nombre: &str, ids: &[i64]) -> Result<()> {
        let r = self
            .http
            .post(format!("{BASE}/collections/{nombre}/points/delete?wait=true"))
            .json(&serde_json::json!({ "points": ids }))
            .send()
            .await?;
        if !r.status().is_success() {
            return Err(anyhow!("borrar puntos de {nombre}: {}", r.status()));
        }
        Ok(())
    }
}
```

- [ ] **Paso 2: Declararlo** — añadir `mod qdrant;` junto al resto de módulos del daemon.

- [ ] **Paso 3: Verificar**

Run: `cargo clippy -p lumid --all-targets -- -D warnings`
Expected: sin errores.

- [ ] **Paso 4: Commit**

```bash
git add crates/lumid/src/qdrant.rs crates/lumid/src/lib.rs crates/lumid/Cargo.toml
git commit -m "Station habla con Qdrant: escribe el Indexer, aqui se consulta"
```

---

## Task 2: Las tablas del corpus instalado

**Files:**
- Modify: `crates/lumid/src/store.rs`

**Interfaces:**
- Produce: tablas `installed_indices`, `reference_images`, `analysis_hypotheses`.

`reference_images` es la tabla que convierte un punto de Qdrant en algo con procedencia. Sin ella el motor devuelve coordenadas sin poder decir de quién son.

- [ ] **Paso 1: El esquema** — añadir al `CREATE TABLE` que ya existe en `store.rs`, junto a `analyses`:

```sql
CREATE TABLE IF NOT EXISTS installed_indices (
    paquete      TEXT PRIMARY KEY,
    nombre       TEXT NOT NULL,
    autor        TEXT NOT NULL,
    url          TEXT NOT NULL,
    ficha_sha256 TEXT NOT NULL,
    modelo       TEXT NOT NULL,
    version      TEXT NOT NULL,
    teselas      INTEGER NOT NULL,
    bytes        INTEGER NOT NULL,
    -- Qué assets se han volcado ya, uno por línea. Es lo que permite reanudar
    -- por asset: una instalación cortada no vuelve a descargar ni a descifrar
    -- lo que ya está en disco.
    hechos       TEXT NOT NULL DEFAULT '',
    completo     INTEGER NOT NULL DEFAULT 0,
    installed_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS reference_images (
    id      INTEGER PRIMARY KEY,
    paquete TEXT NOT NULL,
    ruta    TEXT NOT NULL,
    lat     REAL NOT NULL,
    lng     REAL NOT NULL,
    quadkey TEXT NOT NULL,
    fuente  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ref_paquete ON reference_images(paquete);
-- Las alternativas. La principal NO se duplica aquí: sigue en las columnas
-- result_* de `analyses`, que el cliente ya lee.
CREATE TABLE IF NOT EXISTS analysis_hypotheses (
    analysis_id INTEGER NOT NULL,
    orden       INTEGER NOT NULL,
    lat         REAL NOT NULL,
    lng         REAL NOT NULL,
    radio_m     REAL NOT NULL,
    peso        REAL NOT NULL,
    indice      TEXT NOT NULL,
    autor       TEXT NOT NULL,
    PRIMARY KEY (analysis_id, orden)
);
```

- [ ] **Paso 2: Verificar**

Run: `cargo test -p lumid && cargo clippy -p lumid --all-targets -- -D warnings`
Expected: sin errores. Las migraciones son `IF NOT EXISTS`, así que una base existente no se rompe.

- [ ] **Paso 3: Commit**

```bash
git add crates/lumid/src/store.rs
git commit -m "Las tablas del corpus: un punto de Qdrant vuelve a tener duenno"
```

---

## Task 3: Abrir un asset publicado

**Files:**
- Create: `crates/lumid/src/indices/mod.rs`, `crates/lumid/src/indices/paquete.rs`
- Modify: `crates/lumid/Cargo.toml` (añadir `zip` y `base64` si no están)

**Interfaces:**
- Consume: `lumi_index::cifrado::descifrar(sellado: &[u8], clave: &[u8; 32]) -> Result<Vec<u8>>`, `lumi_index::ficha::{Ficha, Asset}`.
- Produce: `paquete::traer_y_abrir(cliente, url, sha256_esperado, clave, destino) -> Result<()>`.

- [ ] **Paso 1: `paquete.rs`**

```rust
//! Un asset publicado: bajar, comprobar, descifrar y desplegar.
//!
//! El orden importa. El SHA-256 se comprueba ANTES de descifrar y de abrir el
//! zip: descomprimir algo que no es lo que dijo la ficha es darle de comer al
//! parseador bytes de un desconocido.

use anyhow::{anyhow, Result};
use base64::{engine::general_purpose::STANDARD, Engine};
use sha2::{Digest, Sha256};
use std::path::Path;

/// La clave AES viaja en la ficha, en base64. Eso es deliberado: el cifrado es
/// ofuscación frente al alojamiento, no control de acceso.
pub fn clave_de(cifrado: &str) -> Result<[u8; 32]> {
    let bytes = STANDARD.decode(cifrado)?;
    bytes.try_into().map_err(|_| anyhow!("la clave del paquete no mide 32 bytes"))
}

pub async fn traer_y_abrir(
    http: &reqwest::Client,
    url: &str,
    sha256_esperado: &str,
    clave: &[u8; 32],
    destino: &Path,
) -> Result<()> {
    let sellado = http.get(url).send().await?.error_for_status()?.bytes().await?;

    let visto = format!("{:x}", Sha256::digest(&sellado));
    if visto != sha256_esperado {
        return Err(anyhow!("el asset no coincide con su sha256: dice {sha256_esperado}, es {visto}"));
    }

    let claro = lumi_index::cifrado::descifrar(&sellado, clave)?;
    let destino = destino.to_path_buf();

    // Descomprimir gigabytes es CPU pura: en el hilo async bloquearía el
    // worker de tokio entero y con él las peticiones que no tienen nada que
    // ver. Misma lección que costó el "colgado" al publicar en el 8.
    tokio::task::spawn_blocking(move || -> Result<()> {
        let mut z = zip::ZipArchive::new(std::io::Cursor::new(claro))?;
        std::fs::create_dir_all(&destino)?;
        for i in 0..z.len() {
            let mut f = z.by_index(i)?;
            let Some(rel) = f.enclosed_name() else {
                // Un nombre que se escapa del directorio (`../`) no se abre.
                // `enclosed_name` es justo la comprobación que lo impide.
                continue;
            };
            let salida = destino.join(rel);
            if f.is_dir() {
                std::fs::create_dir_all(&salida)?;
                continue;
            }
            if let Some(p) = salida.parent() {
                std::fs::create_dir_all(p)?;
            }
            let mut w = std::fs::File::create(&salida)?;
            std::io::copy(&mut f, &mut w)?;
        }
        Ok(())
    })
    .await??;
    Ok(())
}
```

- [ ] **Paso 2: `indices/mod.rs`** — de momento solo `pub mod paquete;` y `pub mod volcar;` (el segundo llega en la Tarea 4). Declarar `mod indices;` en el daemon.

- [ ] **Paso 3: Verificar**

Run: `cargo clippy -p lumid --all-targets -- -D warnings`
Expected: sin errores.

- [ ] **Paso 4: Commit**

```bash
git add crates/lumid/src/indices crates/lumid/Cargo.toml crates/lumid/src/lib.rs
git commit -m "Abrir un asset publicado: el sha256 se comprueba antes de descifrar"
```

---

## Task 4: Volcar un paquete abierto

**Files:**
- Create: `crates/lumid/src/indices/volcar.rs`

**Interfaces:**
- Consume: `paquete::traer_y_abrir` (T3), `qdrant::Cliente` (T1), tablas de T2.
- Produce: `volcar::paquete(app, ficha, raiz) -> Result<usize>` — devuelve cuántas imágenes de referencia entraron.

El `.lumidx` abierto trae `indice.db` (SQLite con las filas de imagen), `imagenes/` y `fragmentos/<quadkey>/<modelo>-<version>.{b1,i8}`. Volcar es leer eso y repartirlo entre las tres bases de Station.

- [ ] **Paso 1: El módulo**

```rust
//! De un `.lumidx` abierto a las tres bases de Station.
//!
//! El `id` de `reference_images` es el mismo en SQLite y en Qdrant. Es lo que
//! permite que una búsqueda vectorial devuelva algo con autor, y lo que hace
//! que desinstalar sea borrar por id sin tocar lo de nadie más.

use anyhow::{Context, Result};
use lumi_index::ficha::Ficha;
use std::path::Path;

pub async fn paquete(app: &crate::App, ficha: &Ficha, raiz: &Path) -> Result<usize> {
    // Las filas del índice publicado. `indice.db` es SQLite y viaja dentro del
    // paquete: leerlo es más barato y más fiable que reconstruirlo del EXIF.
    let filas: Vec<(String, f64, f64, String, String)> = {
        let db = rusqlite::Connection::open(raiz.join("indice.db"))
            .context("abrir el indice.db del paquete")?;
        let mut q = db.prepare(
            "SELECT ruta, lat, lng, quadkey, fuente FROM imagenes
              WHERE lat IS NOT NULL AND lng IS NOT NULL",
        )?;
        q.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)))?
            .collect::<Result<Vec<_>, _>>()?
    };

    // Las filas primero: si el proceso muere entre esto y Qdrant, la
    // reanudación vuelve a subir los vectores de este asset y no pasa nada.
    // Al revés —vectores sin fila— dejaría puntos que no se pueden atribuir.
    let mut ids = Vec::with_capacity(filas.len());
    {
        let c = app.store.conn();
        for (ruta, lat, lng, quadkey, fuente) in &filas {
            let abs = raiz.join("imagenes").join(ruta);
            c.execute(
                "INSERT INTO reference_images (paquete, ruta, lat, lng, quadkey, fuente)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                rusqlite::params![
                    &ficha.paquete,
                    abs.to_string_lossy(),
                    lat,
                    lng,
                    quadkey,
                    fuente
                ],
            )?;
            ids.push(c.last_insert_rowid());
        }
    }

    // Los vectores, del fragmento de cada tesela. Una capa por modelo; se toma
    // la primera de la ficha, que es la del autor del cuerpo.
    let Some(capa) = ficha.capas.first() else { return Ok(ids.len()) };
    let coleccion = crate::qdrant::coleccion_de(&capa.modelo, &capa.version);
    let cliente = crate::qdrant::Cliente::nuevo();
    cliente.asegurar_coleccion(&coleccion, capa.dims).await?;

    let vectores = lumi_index::vectors::leer_fragmentos(
        &raiz.join("fragmentos"),
        &capa.modelo,
        &capa.version,
        capa.dims,
    )?;
    // ponytail: se asume que el orden de los vectores del fragmento es el de
    // las filas de `indice.db`, que es como los escribe el sellado del 7a. Si
    // alguna vez dejan de ir a la par, el paquete trae el orden explícito y
    // habría que leerlo — no adivinarlo aquí.
    let n = ids.len().min(vectores.len());
    cliente.subir(&coleccion, &ids[..n], &vectores[..n]).await?;

    Ok(n)
}
```

- [ ] **Paso 2: Comprobar el nombre real del lector de fragmentos**

Run: `grep -n "pub fn" crates/lumi-index/src/vectors.rs`
Si no existe una función que lea todos los fragmentos de un modelo, añadirla ahí (es donde vive el formato) con esta firma: `pub fn leer_fragmentos(dir: &Path, modelo: &str, version: &str, dims: u32) -> Result<Vec<Vec<f32>>>`. **No** leerlos a mano desde `lumid`: el formato `.b1`/`.i8` tiene un solo dueño.

- [ ] **Paso 3: Verificar**

Run: `cargo clippy --all-targets -- -D warnings`
Expected: sin errores.

- [ ] **Paso 4: Commit**

```bash
git add crates/lumid/src/indices/volcar.rs crates/lumi-index/src/vectors.rs
git commit -m "Volcar un paquete: el id de SQLite y el de Qdrant son el mismo, y por eso hay autor"
```

---

## Task 5: Instalar, como tarea de fondo reanudable

**Files:**
- Modify: `crates/lumid/src/indices/mod.rs`

**Interfaces:**
- Consume: `grafo::resolver` (ya existe), `paquete::traer_y_abrir` (T3), `volcar::paquete` (T4).
- Produce: `indices::instalar(app, url) -> Result<()>`, `indices::Progreso`, `indices::progreso(app) -> Progreso`.

- [ ] **Paso 1: El estado y la orquestación**

```rust
//! Instalar un índice del catálogo. Mismo patrón reanudable que descargar y
//! publicar en el Indexer, porque es el mismo problema: gigabytes por una red
//! que se corta.

pub mod paquete;
pub mod volcar;

use anyhow::{anyhow, Result};
use lumi_index::ficha::Ficha;
use serde::Serialize;
use std::sync::{Arc, Mutex};

#[derive(Debug, Clone, Default, Serialize)]
pub struct Progreso {
    pub paquete: String,
    pub asset: String,
    pub hechos: usize,
    pub total: usize,
    pub registro: Vec<String>,
    pub terminado: bool,
    pub error: Option<String>,
    /// Las zonas que este índice daba por cubiertas y que nadie cubre porque
    /// su paquete ya no existe. No se esconden: son respuestas que no van a
    /// llegar nunca.
    pub rotas: Vec<String>,
}

/// Un solo hueco: no tiene sentido instalar dos índices a la vez contra el
/// mismo disco y la misma red, y un hueco único hace que el progreso sea
/// trivial de servir.
pub type EnCurso = Arc<Mutex<Option<Progreso>>>;

async fn traer_ficha(http: &reqwest::Client, url: &str) -> Result<Ficha> {
    let f: Ficha = http.get(url).send().await?.error_for_status()?.json().await?;
    // La firma se comprueba SIEMPRE, en la raíz y en cada dependencia. No hay
    // «instalar igualmente»: ese diálogo es la puerta de entrada.
    f.comprobar().map_err(|e| anyhow!("firma invalida en {}: {e}", f.paquete))?;
    Ok(f)
}

pub async fn instalar(app: crate::App, url: String) -> Result<()> {
    let http = reqwest::Client::new();
    let raiz_ficha = traer_ficha(&http, &url).await?;

    // Las dependencias se traen antes de resolver, igual que en
    // `routes::catalogo`: `resolver` es lógica pura y no puede esperar a la red.
    let mut conocidas: std::collections::HashMap<String, Ficha> = Default::default();
    let mut por_ver: Vec<String> = raiz_ficha.dependencias.iter().map(|d| d.url.clone()).collect();
    while let Some(u) = por_ver.pop() {
        let Ok(f) = traer_ficha(&http, &u).await else { continue };
        if conocidas.contains_key(&f.paquete) {
            continue;
        }
        por_ver.extend(f.dependencias.iter().map(|d| d.url.clone()));
        conocidas.insert(f.paquete.clone(), f);
    }
    let grafo = lumi_index::grafo::resolver(&raiz_ficha, &|p| conocidas.get(p).cloned());

    {
        let mut g = app.indices_en_curso.lock().unwrap();
        *g = Some(Progreso {
            paquete: raiz_ficha.paquete.clone(),
            total: grafo.nodos.len(),
            rotas: grafo.rotas.clone(),
            ..Default::default()
        });
    }

    // De las hojas hacia la raíz: si se corta a la mitad, lo que queda
    // instalado son dependencias completas y no una raíz que apunta al vacío.
    let mut nodos = grafo.nodos.clone();
    nodos.sort_by_key(|n| std::cmp::Reverse(n.profundidad));

    for nodo in nodos {
        if nodo.roto {
            anotar(&app, format!("{} no está disponible, se instala sin esa zona", nodo.paquete));
            avanzar(&app);
            continue;
        }
        let ficha = if nodo.paquete == raiz_ficha.paquete {
            raiz_ficha.clone()
        } else {
            match conocidas.get(&nodo.paquete) {
                Some(f) => f.clone(),
                None => continue,
            }
        };
        if ya_instalado(&app, &ficha.paquete) {
            anotar(&app, format!("{} ya estaba instalado", ficha.paquete));
            avanzar(&app);
            continue;
        }
        instalar_uno(&app, &http, &ficha).await?;
        avanzar(&app);
    }

    if let Some(p) = app.indices_en_curso.lock().unwrap().as_mut() {
        p.terminado = true;
    }
    Ok(())
}

async fn instalar_uno(app: &crate::App, http: &reqwest::Client, ficha: &Ficha) -> Result<()> {
    let clave = paquete::clave_de(&ficha.cifrado)?;
    let raiz = app.dir.join("indices").join(&ficha.paquete);
    let assets: Vec<_> = ficha.cuerpos.iter().chain(ficha.capas.iter().flat_map(|c| &c.assets)).collect();

    for a in assets {
        anotar(app, format!("bajando {}", a.nombre));
        if let Some(p) = &mut app.indices_en_curso.lock().unwrap().as_mut() {
            p.asset = a.nombre.clone();
        }
        paquete::traer_y_abrir(http, &url_de(ficha, &a.nombre), &a.sha256, &clave, &raiz).await?;
    }

    let cuantas = volcar::paquete(app, ficha, &raiz).await?;
    let c = app.store.conn();
    let modelo = ficha.capas.first().map(|c| c.modelo.clone()).unwrap_or_default();
    let version = ficha.capas.first().map(|c| c.version.clone()).unwrap_or_default();
    c.execute(
        "INSERT OR REPLACE INTO installed_indices
           (paquete, nombre, autor, url, ficha_sha256, modelo, version, teselas, bytes, completo, installed_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,1,?10)",
        rusqlite::params![
            &ficha.paquete, &ficha.nombre, &ficha.autor, &url_de(ficha, "ficha.json"),
            "", modelo, version, ficha.fuentes_por_quadkey.len() as i64,
            ficha.cuerpos.iter().map(|a| a.bytes).sum::<u64>() as i64,
            crate::routes::access::now()
        ],
    )?;
    anotar(app, format!("{} · {cuantas} imágenes de referencia", ficha.paquete));
    Ok(())
}
```

- [ ] **Paso 2: Los auxiliares** — `anotar`, `avanzar`, `ya_instalado` y `url_de` en el mismo fichero. `url_de` deriva la URL del asset de la de la ficha (misma carpeta del release, sustituyendo el último segmento). `ya_instalado` consulta `installed_indices` por `completo = 1`.

- [ ] **Paso 3: El hueco en `App`** — añadir `pub indices_en_curso: EnCurso` a la estructura de estado del daemon e inicializarlo a `Arc::new(Mutex::new(None))`.

- [ ] **Paso 4: Verificar**

Run: `cargo clippy --all-targets -- -D warnings`
Expected: sin errores.

- [ ] **Paso 5: Commit**

```bash
git add crates/lumid/src
git commit -m "Instalar de las hojas a la raiz: cortarse a la mitad no deja una raiz que apunta al vacio"
```

---

## Task 6: Los endpoints

**Files:**
- Create: `crates/lumid/src/routes/indices.rs`
- Modify: `crates/lumid/src/routes/mod.rs`, `crates/lumid/src/main.rs`

**Interfaces:**
- Produce: `POST /v1/indices` (instalar), `GET /v1/indices` (listar), `DELETE /v1/indices/:paquete`, `GET /v1/indices/eventos` (SSE).

El progreso va por **SSE**, no por sondeo: es lo que hacen `/v1/tasks/:id/log`, `/v1/telemetry` y `/v1/queue/events`, y la spec §6 se comprometió a ello. Se copia el patrón de `routes::queue::events`. Y se respeta la regla del 4: **el progreso no se persiste nunca**, se retransmite y se olvida.

- [ ] **Paso 1: El módulo** — cuatro handlers. Los cuatro empiezan por `require_admin`, que vive en `routes::auth` (no en `routes::admin`, pese al nombre): instalar gasta disco y red **del servidor**.

```rust
//! Instalar, listar y desinstalar índices. Todo pide administrador: instalar
//! gasta disco y ancho de banda del servidor, así que es una decisión de
//! administración y no de investigación.

use axum::extract::{Path, State};
use axum::http::{HeaderMap, StatusCode};
use axum::Json;
use serde::{Deserialize, Serialize};

#[derive(Deserialize)]
pub struct Peticion {
    pub url: String,
}

#[derive(Serialize)]
pub struct Instalado {
    pub paquete: String,
    pub nombre: String,
    pub autor: String,
    pub teselas: i64,
    pub bytes: i64,
    pub modelo: String,
    pub version: String,
    pub completo: bool,
}

pub async fn instalar(
    State(app): State<crate::App>,
    headers: HeaderMap,
    Json(p): Json<Peticion>,
) -> Result<StatusCode, StatusCode> {
    crate::routes::auth::require_admin(&app, &crate::routes::auth::bearer(&headers))?;
    if app.indices_en_curso.lock().unwrap().as_ref().is_some_and(|p| !p.terminado) {
        // Un solo hueco a propósito: dos instalaciones contra el mismo disco
        // y la misma red no van más rápido, van peor.
        return Err(StatusCode::CONFLICT);
    }
    let a = app.clone();
    tokio::spawn(async move {
        if let Err(e) = crate::indices::instalar(a.clone(), p.url).await {
            if let Some(g) = a.indices_en_curso.lock().unwrap().as_mut() {
                g.error = Some(e.to_string());
                g.terminado = true;
            }
        }
    });
    Ok(StatusCode::ACCEPTED)
}

/// SSE, mismo patrón que `routes::queue::events`: un `Progreso` por tick
/// mientras dure, y se corta al terminar. No se guarda en ninguna parte.
pub async fn eventos(
    State(app): State<crate::App>,
    headers: HeaderMap,
) -> Result<axum::response::Sse<impl futures::Stream<Item = Result<axum::response::sse::Event, std::convert::Infallible>>>, StatusCode> {
    crate::routes::auth::require_admin(&app, &crate::routes::auth::bearer(&headers))?;
    // El cuerpo exacto se copia de `routes::queue::events`, que ya resuelve el
    // keep-alive y el cierre. Aquí solo cambia qué se serializa.
    todo!("copiar la forma de routes::queue::events")
}
```

`todo!()` es lo único de este plan que no lleva el cuerpo escrito, y es a propósito: la forma correcta es la que ya está en `routes::queue::events`, y copiarla mal aquí sería peor que decir de dónde sacarla.

- [ ] **Paso 2: `listar` y `desinstalar`** — `listar` lee `installed_indices`. `desinstalar` borra los puntos de Qdrant por los ids de `reference_images` de ese paquete, borra esas filas, borra la carpeta de `{DATA}/indices/<paquete>` y la fila de `installed_indices`. **En ese orden**: si se corta, lo peor que queda es disco ocupado, nunca puntos que no se pueden atribuir.

- [ ] **Paso 3: Registrar las rutas** en `main.rs`, junto a `/v1/catalogo/grafo`:

```rust
.route("/v1/indices", get(routes::indices::listar).post(routes::indices::instalar))
.route("/v1/indices/eventos", get(routes::indices::eventos))
.route("/v1/indices/:paquete", axum::routing::delete(routes::indices::desinstalar))
```

- [ ] **Paso 4: Verificar**

Run: `cargo clippy --all-targets -- -D warnings`
Expected: sin errores.

- [ ] **Paso 5: Commit**

```bash
git add crates/lumid/src/routes crates/lumid/src/main.rs
git commit -m "Instalar, listar y desinstalar indices, todo tras require_admin"
```

---

## Task 7: La capacidad de instalar

**Files:**
- Modify: `crates/lumi-proto/src/caps.rs`

**Interfaces:**
- Produce: la capacidad `indices` en la matriz, con su `reason` cuando no está `On`.

- [ ] **Paso 1: La entrada** — añadir a los dos brazos de `matrix` (`Native` y `Docker`):

```rust
cap(
    "indices",
    "Instalar índices del catálogo",
    if qdrant_vivo { CapState::On } else { CapState::Off },
    if qdrant_vivo {
        None
    } else {
        Some("Qdrant no responde en 127.0.0.1:6333. Sin él no hay dónde meter los vectores.")
    },
),
```

`matrix` gana un parámetro `qdrant_vivo: bool`. La regla del proyecto es que nada desaparece en silencio: si Qdrant no está, el botón se ve **deshabilitado con el motivo**, no escondido.

- [ ] **Paso 2: Los llamantes** — actualizar quien llame a `matrix` para pasar el nuevo argumento, comprobando Qdrant con una petición a `/collections` con timeout corto.

- [ ] **Paso 3: Verificar**

Run: `cargo test -p lumi-proto && cargo clippy --all-targets -- -D warnings`
Expected: los tests de `caps` siguen pasando; si alguno fija el número de capacidades, actualizarlo.

- [ ] **Paso 4: Commit**

```bash
git add crates/lumi-proto/src/caps.rs crates/lumid/src
git commit -m "Instalar es una capacidad, y sin Qdrant se ve deshabilitada con el motivo"
```

---

## Task 8: La pantalla de índices en el cliente

**Files:**
- Create: `client/src/admin/IndicesPanel.tsx`, `client/src/admin/InstallFlow.tsx`
- Modify: `client/src/lib/api.ts`, `client/src/work/InstallDialog.tsx`, `client/src/App.tsx`

**Interfaces:**
- Consume: `GET/POST /v1/indices`, `GET /v1/indices/progreso`, `DELETE /v1/indices/:paquete`, `GET /v1/catalogo/grafo`.

`InstallDialog` existe desde el 8 y **hasta hoy no lo importaba nadie** (está anotado en `FUTURO.md`). Esta tarea le da la pantalla que le faltaba y cierra ese hueco.

- [ ] **Paso 1: Los tipos y las llamadas** en `client/src/lib/api.ts`:

```ts
export interface IndiceInstalado {
  paquete: string; nombre: string; autor: string;
  teselas: number; bytes: number; modelo: string; version: string; completo: boolean;
}
export interface ProgresoInstalacion {
  paquete: string; asset: string; hechos: number; total: number;
  registro: string[]; terminado: boolean; error: string | null; rotas: string[];
}
```

- [ ] **Paso 2: `IndicesPanel.tsx`** — la lista de la maqueta 3: nombre, chip «firma verificada», `@autor · N teselas · N GiB` en mono, y «Desinstalar». Debajo, la fila de cifras (teselas cubiertas, en disco, vectores, modelo). Arriba a la derecha, «Instalar del catálogo…».

- [ ] **Paso 3: `InstallFlow.tsx`** — pide la URL de la ficha, llama a `/v1/catalogo/grafo`, y con el `Grafo` en la mano abre `InstallDialog`, que ya sabe pintar el árbol y sumar el peso. Al confirmar, `POST /v1/indices` y suscribirse a `/v1/indices/eventos` por SSE, con el mismo puente que el cliente ya usa para `/v1/queue/events`.

- [ ] **Paso 4: Los estados que no se suavizan** — firma inválida: el error del endpoint se enseña tal cual y **no hay botón de continuar**. Dependencia caída: `grafo.rotas` no vacío pinta el aviso ámbar y el botón dice «Instalar sin esa zona».

- [ ] **Paso 5: Colgarlo** en la zona de administración de `App.tsx`, tras la capacidad `indices`.

- [ ] **Paso 6: Verificar**

Run: `cd client && npx tsc -b --noEmit && npm run lint && npm run build`
Expected: sin errores.

- [ ] **Paso 7: Commit**

```bash
git add client/src
git commit -m "InstallDialog por fin tiene puerta: instalar y desinstalar desde administracion"
```

---

# Fase B · El motor (5a)

## Task 9: El contrato crece

**Files:**
- Modify: `crates/lumi-proto/src/worker.rs`

**Interfaces:**
- Produce: `Msg::Vectores`, `Hipotesis`, `Msg::Resultado.alternativas`.

- [ ] **Paso 1: Los tipos**

```rust
/// Una zona candidata con su respaldo. `peso` no es una probabilidad: es
/// cuánto pesa este grupo frente a los demás del mismo análisis.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Hipotesis {
    pub lat: f64,
    pub lng: f64,
    pub radio_m: f64,
    pub peso: f64,
    pub indice: String,
    pub autor: String,
}
```

En `Msg`:

```rust
    /// El trabajador solo embebe: escribe el vector a un fichero y contesta su
    /// ruta. Los flotantes NO salen por stdout, misma razón que en el Indexer.
    Vectores { id: i64, dims: u32, fichero: String },
```

Y `Resultado` gana:

```rust
    Resultado {
        id: i64, lat: f64, lng: f64, radio_m: f64, confianza: f64,
        /// `#[serde(default)]` a propósito: un trabajador que no las mande
        /// —como el de referencia— sigue siendo válido sin tocar una línea.
        #[serde(default)]
        alternativas: Vec<Hipotesis>,
    },
```

- [ ] **Paso 2: Extender `validar`** — cada alternativa pasa por las mismas comprobaciones de rango que la principal. Al trabajador se le cree el log, no los datos, y eso vale igual para la hipótesis número tres.

- [ ] **Paso 3: Extender el test que ya existe** — `el_contrato_aguanta_basura_y_rechaza_numeros_imposibles` debe seguir pasando **sin cambios en sus casos actuales** (esa es la prueba de que `#[serde(default)]` no rompió nada) y ganar un caso: un `Resultado` con una alternativa de latitud 91 se rechaza.

- [ ] **Paso 4: Verificar**

Run: `cargo test -p lumi-proto`
Expected: todos en verde, incluidos los antiguos sin tocar.

- [ ] **Paso 5: Commit**

```bash
git add crates/lumi-proto/src/worker.rs
git commit -m "El contrato aprende a dudar: alternativas, y un trabajador que solo embebe"
```

---

## Task 10: El trabajador que solo embebe

**Files:**
- Create: `workers/lumi_geo.py`

**Interfaces:**
- Consume: `Job { tipo: "trabajo", id, modelo, imagenes[] }`.
- Produce: `{"tipo":"vectores", "id", "dims", "fichero"}`.

Sale de `workers/lumi_embed.py`, que ya hace exactamente esto. Sin dependencias: tiene que arrancar en el intérprete del sistema.

- [ ] **Paso 1: El fichero** — copiar `lumi_embed.py` y adaptarlo: acepta `tipo == "trabajo"` (no `"lote"`) y contesta `vectores` con **un solo** vector, el de la imagen de consulta. La cabecera debe decir, como sus hermanos, que **el 5b sustituye `_cargar` y `_vector`** y nada más.

- [ ] **Paso 2: Probarlo a mano**

```bash
echo '{"tipo":"trabajo","id":1,"modelo":"lumi-2","imagenes":["workers/lumi_geo.py"]}' | python3 workers/lumi_geo.py
```
Expected: una línea `{"tipo": "listo", ...}` y otra `{"tipo": "vectores", "id": 1, "dims": 64, "fichero": "/tmp/..."}`.

- [ ] **Paso 3: Commit**

```bash
git add workers/lumi_geo.py
git commit -m "El trabajador de geolocalizacion: convierte pixeles en un vector y nada mas"
```

---

## Task 11: Agrupar candidatos — la única tarea con tests

**Files:**
- Create: `crates/lumi-index/src/agrupar.rs`
- Modify: `crates/lumi-index/src/lib.rs`

**Interfaces:**
- Produce: `agrupar::Candidato`, `agrupar::Grupo`, `agrupar::en_grupos(&[Candidato]) -> Vec<Grupo>`, `agrupar::confianza(&[Grupo]) -> f64`.

Es lógica pura sobre una lista y por eso **sí lleva tests**: es exactamente el tipo de lógica no trivial que la convención del proyecto quiere probada, igual que `coverage.rs` y `troceado.rs`.

- [ ] **Paso 1: El test que falla primero**

```rust
fn cand(qk: &str, lat: f64, lng: f64, sim: f64, indice: &str, autor: &str) -> Candidato {
    Candidato {
        lat, lng, quadkey: qk.into(), similitud: sim,
        indice: indice.into(), autor: autor.into(),
    }
}

fn grupo(peso: f64) -> Grupo {
    Grupo {
        lat: 0.0, lng: 0.0, radio_m: 100.0, peso,
        candidatos: 1, indice: "A".into(), autor: "@ana".into(),
    }
}

#[test]
fn dos_teselas_contiguas_son_el_mismo_sitio_y_una_lejana_no() {
    let c = vec![
        cand("03131010101010", 43.36, -8.41, 0.90, "A", "@ana"),
        cand("03131010101011", 43.36, -8.40, 0.80, "A", "@ana"),
        cand("12000000000000", 10.00, 20.00, 0.70, "B", "@bea"),
    ];
    let g = en_grupos(&c);
    assert_eq!(g.len(), 2, "las dos contiguas van juntas");
    assert_eq!(g[0].candidatos, 2, "el grupo mayor va primero");
    assert!(g[0].peso > g[1].peso);
    // La atribución sale del candidato que más pesa dentro del grupo.
    assert_eq!(g[0].indice, "A");
    assert_eq!(g[0].autor, "@ana");
}

#[test]
fn la_confianza_compara_los_dos_primeros_no_la_similitud() {
    // Un grupo que dobla al siguiente da 2.0, con independencia de que las
    // similitudes crudas sean 0,9 o 0,4: es lo único comparable entre modelos.
    let g = vec![grupo(4.0), grupo(2.0)];
    assert!((confianza(&g) - 2.0).abs() < 1e-9);
    // Sin competencia, la confianza no es infinita: se topa.
    assert!(confianza(&[grupo(4.0)]) >= 1.0);
}
```

- [ ] **Paso 2: Ejecutarlo y verlo fallar**

Run: `cargo test -p lumi-index agrupar`
Expected: FALLA — `en_grupos` no existe.

- [ ] **Paso 3: La implementación**

```rust
//! De candidatos recuperados a hipótesis.
//!
//! Se agrupa por VECINDAD DE TESELA y no por un radio en metros elegido a
//! dedo: el producto entero habla en teselas z14 desde el 7a, y dos fotos en
//! teselas contiguas están en el mismo sitio por la definición del formato. Un
//! umbral en metros sería un número más que explicar y afinar.

use std::collections::BTreeMap;

use crate::tiles::xy_de_quadkey;

#[derive(Debug, Clone)]
pub struct Candidato {
    pub lat: f64,
    pub lng: f64,
    pub quadkey: String,
    pub similitud: f64,
    pub indice: String,
    pub autor: String,
}

#[derive(Debug, Clone)]
pub struct Grupo {
    pub lat: f64,
    pub lng: f64,
    pub radio_m: f64,
    pub peso: f64,
    pub candidatos: usize,
    pub indice: String,
    pub autor: String,
}

/// Islas contiguas en el plano de teselas: dos candidatos caen en el mismo
/// grupo si sus quadkeys son iguales o vecinos, y los grupos salen de la
/// transitividad de esa relación.
pub fn en_grupos(cands: &[Candidato]) -> Vec<Grupo> {
    let xy: Vec<(i64, i64)> = cands
        .iter()
        .map(|c| {
            let (x, y) = xy_de_quadkey(&c.quadkey);
            (x as i64, y as i64)
        })
        .collect();

    let mut de_celda: BTreeMap<(i64, i64), Vec<usize>> = BTreeMap::new();
    for (i, p) in xy.iter().enumerate() {
        de_celda.entry(*p).or_default().push(i);
    }

    let mut visto = vec![false; cands.len()];
    let mut grupos = Vec::new();
    for raiz in 0..cands.len() {
        if visto[raiz] {
            continue;
        }
        let mut isla = Vec::new();
        let mut pila = vec![raiz];
        visto[raiz] = true;
        while let Some(i) = pila.pop() {
            isla.push(i);
            let (x, y) = xy[i];
            for dx in -1..=1 {
                for dy in -1..=1 {
                    for &j in de_celda.get(&(x + dx, y + dy)).map(|v| &v[..]).unwrap_or(&[]) {
                        if !visto[j] {
                            visto[j] = true;
                            pila.push(j);
                        }
                    }
                }
            }
        }
        grupos.push(resumir(cands, &isla));
    }
    grupos.sort_by(|a, b| b.peso.total_cmp(&a.peso));
    grupos
}

fn resumir(cands: &[Candidato], isla: &[usize]) -> Grupo {
    let peso: f64 = isla.iter().map(|&i| cands[i].similitud).sum();
    // Centroide ponderado: un candidato que se parece más tira más del punto.
    let lat = isla.iter().map(|&i| cands[i].lat * cands[i].similitud).sum::<f64>() / peso.max(1e-9);
    let lng = isla.iter().map(|&i| cands[i].lng * cands[i].similitud).sum::<f64>() / peso.max(1e-9);
    // El radio es la dispersión REAL de sus puntos, no una constante: un grupo
    // apretado tiene que decir que está apretado.
    let radio_m = isla
        .iter()
        .map(|&i| metros_entre(lat, lng, cands[i].lat, cands[i].lng))
        .fold(0.0_f64, f64::max)
        .max(50.0);
    // La atribución sale del candidato de más peso: si dos índices se solapan,
    // el que más aporta es el que responde.
    let mejor = isla
        .iter()
        .copied()
        .max_by(|&a, &b| cands[a].similitud.total_cmp(&cands[b].similitud))
        .unwrap_or(isla[0]);
    Grupo {
        lat,
        lng,
        radio_m,
        peso,
        candidatos: isla.len(),
        indice: cands[mejor].indice.clone(),
        autor: cands[mejor].autor.clone(),
    }
}

/// Cuánto le saca el primero al segundo. NO es la similitud del mejor
/// candidato: una similitud coseno de 0,83 no significa nada para quien lee el
/// informe y no es comparable entre modelos; «el doble que la siguiente» sí, y
/// sigue significando lo mismo cuando el 5b cambie el embebedor.
pub fn confianza(grupos: &[Grupo]) -> f64 {
    match grupos {
        [] => 0.0,
        // Sin competencia no se devuelve infinito: se topa, porque «no hay
        // segundo» puede significar tanto certeza como corpus pobre.
        [_] => 10.0,
        [a, b, ..] => (a.peso / b.peso.max(1e-9)).min(10.0),
    }
}

fn metros_entre(a_lat: f64, a_lng: f64, b_lat: f64, b_lng: f64) -> f64 {
    const R: f64 = 6_371_000.0;
    let dlat = (b_lat - a_lat).to_radians();
    let dlng = (b_lng - a_lng).to_radians();
    let h = (dlat / 2.0).sin().powi(2)
        + a_lat.to_radians().cos() * b_lat.to_radians().cos() * (dlng / 2.0).sin().powi(2);
    2.0 * R * h.sqrt().asin()
}
```

- [ ] **Paso 4: `xy_de_quadkey`** — si `tiles.rs` no lo expone público, exponerlo ahí (el desentrelazado ya está dentro de `bbox_de_tesela`; se extrae y se reutiliza, no se duplica).

- [ ] **Paso 5: Ejecutar los tests**

Run: `cargo test -p lumi-index agrupar`
Expected: PASA.

- [ ] **Paso 6: Commit**

```bash
git add crates/lumi-index/src/agrupar.rs crates/lumi-index/src/lib.rs crates/lumi-index/src/tiles.rs
git commit -m "Agrupar por vecindad de tesela, y una confianza que se puede leer en un informe"
```

---

## Task 12: Recuperar candidatos con su procedencia

**Files:**
- Create: `crates/lumid/src/recuperar.rs`

**Interfaces:**
- Consume: `qdrant::Cliente::buscar` (T1), `reference_images` (T2), `agrupar::{Candidato, en_grupos, confianza}` (T11).
- Produce: `recuperar::hipotesis(app, modelo, vector) -> Result<Vec<Hipotesis>>`.

- [ ] **Paso 1: El módulo**

```rust
//! De un vector de consulta a hipótesis con dueño.

use anyhow::Result;
use lumi_index::agrupar::{confianza, en_grupos, Candidato};
use lumi_proto::worker::Hipotesis;

/// Cuántos vecinos se piden. Constante con nombre y no un ajuste: bastante
/// para que un grupo real se note sobre el ruido, poco para que agrupar sea
/// instantáneo. El 5b lo revisará con datos de verdad delante, que es cuando
/// se puede.
const VECINOS: usize = 64;

pub async fn hipotesis(app: &crate::App, modelo: &str, vector: &[f32]) -> Result<Vec<Hipotesis>> {
    // Qué versión del modelo hay instalada. Si hay varias, se consultan todas:
    // el investigador no tiene por qué saber qué hay en el servidor.
    let colecciones: Vec<String> = {
        let c = app.store.conn();
        let mut q = c.prepare(
            "SELECT DISTINCT version FROM installed_indices WHERE modelo = ?1 AND completo = 1",
        )?;
        q.query_map([modelo], |r| r.get::<_, String>(0))?
            .collect::<Result<Vec<_>, _>>()?
            .into_iter()
            .map(|v| crate::qdrant::coleccion_de(modelo, &v))
            .collect()
    };

    let cliente = crate::qdrant::Cliente::nuevo();
    let mut vecinos = Vec::new();
    for col in &colecciones {
        vecinos.extend(cliente.buscar(col, vector, VECINOS).await.unwrap_or_default());
    }
    if vecinos.is_empty() {
        return Ok(Vec::new());
    }

    // La traducción de punto a procedencia. Es la razón entera de que la
    // recuperación viva aquí y no en Python: esto está en SQLite.
    let cands: Vec<Candidato> = {
        let c = app.store.conn();
        let mut fuera = Vec::new();
        for v in &vecinos {
            let fila = c.query_row(
                "SELECT r.lat, r.lng, r.quadkey, i.nombre, i.autor
                   FROM reference_images r JOIN installed_indices i ON i.paquete = r.paquete
                  WHERE r.id = ?1",
                rusqlite::params![v.id],
                |r| {
                    Ok(Candidato {
                        lat: r.get(0)?,
                        lng: r.get(1)?,
                        quadkey: r.get(2)?,
                        similitud: v.similitud as f64,
                        indice: r.get(3)?,
                        autor: r.get(4)?,
                    })
                },
            );
            if let Ok(c) = fila {
                fuera.push(c);
            }
        }
        fuera
    };

    let grupos = en_grupos(&cands);
    let conf = confianza(&grupos);
    Ok(grupos
        .into_iter()
        .enumerate()
        .map(|(i, g)| Hipotesis {
            lat: g.lat,
            lng: g.lng,
            radio_m: g.radio_m,
            // La principal lleva la confianza comparada; las alternativas, su
            // peso relativo. Son dos preguntas distintas y por eso dos números.
            peso: if i == 0 { conf } else { g.peso },
            indice: g.indice,
            autor: g.autor,
        })
        .collect())
}
```

- [ ] **Paso 2: Verificar**

Run: `cargo clippy --all-targets -- -D warnings`
Expected: sin errores.

- [ ] **Paso 3: Commit**

```bash
git add crates/lumid/src/recuperar.rs crates/lumid/src/lib.rs
git commit -m "Recuperar candidatos y devolverles el nombre de quien los publico"
```

---

## Task 13: La cola aprende a recuperar

**Files:**
- Modify: `crates/lumid/src/queue/worker.rs`, `crates/lumid/src/queue/mod.rs`

**Interfaces:**
- Consume: `recuperar::hipotesis` (T12).
- Produce: `Evento::Vectores`, y el guardado del resultado con sus alternativas.

- [ ] **Paso 1: El evento** — `Evento` gana `Vectores { dispositivo, id, dims, fichero }`, y `Evento::de` lo traduce desde `Msg::Vectores`. `Evento::Resultado` gana `alternativas: Vec<Hipotesis>`.

- [ ] **Paso 2: El consumidor** — donde hoy se maneja `Evento::Resultado`, añadir el manejo de `Evento::Vectores`:

```rust
Evento::Vectores { id, dims, fichero, .. } => {
    // El vector viene por fichero y no por la tubería. Se lee, se borra, y
    // a partir de aquí el trabajo es del daemon: el trabajador ya terminó.
    let v = leer_f32(&fichero, dims);
    let _ = std::fs::remove_file(&fichero);
    let modelo = modelo_del_analisis(&app, id);
    match crate::recuperar::hipotesis(&app, &modelo, &v).await {
        Ok(h) if !h.is_empty() => guardar_resultado(&app, id, &h),
        // Sin candidatos NO es una avería: es una respuesta. Ningún índice
        // instalado cubre nada parecido, y decirlo es más útil que un punto.
        Ok(_) => guardar_fallo(&app, id, "ningún índice instalado cubre esta imagen"),
        Err(e) => guardar_fallo(&app, id, &format!("no se pudo recuperar: {e}")),
    }
}
```

- [ ] **Paso 3: `guardar_resultado`** — escribe la principal en las columnas `result_*` de `analyses` (que ya existen) y las alternativas en `analysis_hypotheses`, en una sola transacción. `state` pasa a `hecho` y `finished_at` se rellena.

- [ ] **Paso 4: Apuntar al trabajador nuevo** — donde el daemon elige el script del trabajador, pasar a `workers/lumi_geo.py`.

- [ ] **Paso 5: Verificar**

Run: `cargo test && cargo clippy --all-targets -- -D warnings`
Expected: sin errores. Los tests de la cola del 4 siguen pasando.

- [ ] **Paso 6: Commit**

```bash
git add crates/lumid/src/queue
git commit -m "La cola recupera cuando el trabajador termina de embeber"
```

---

## Task 14: El resultado sale por la API

**Files:**
- Modify: `crates/lumid/src/routes/analyses.rs`

**Interfaces:**
- Produce: `Analysis.hypotheses: Vec<Hipotesis>` en `GET /v1/cases/:id/analyses` y en `get_one`.

- [ ] **Paso 1: El campo** — `Analysis` gana `hypotheses`, leído de `analysis_hypotheses` por `analysis_id` y ordenado por `orden`. Un análisis sin alternativas devuelve una lista vacía, no `null`: el cliente no debería tener dos casos donde hay uno.

- [ ] **Paso 2: Borrado en cascada** — al borrar un análisis, borrar también sus hipótesis. Un huérfano en esa tabla no rompe nada hoy, pero es basura que crece.

- [ ] **Paso 3: Verificar**

Run: `cargo clippy --all-targets -- -D warnings`
Expected: sin errores.

- [ ] **Paso 4: Commit**

```bash
git add crates/lumid/src/routes/analyses.rs
git commit -m "Las hipotesis viajan con el analisis, y una lista vacia no es null"
```

---

## Task 15: Las hipótesis en pantalla

**Files:**
- Modify: `client/src/lib/api.ts`, `client/src/work/ResultsDrawer.tsx`, `client/src/work/MapCanvas.tsx`

**Interfaces:**
- Consume: `Analysis.hypotheses`.

Maqueta 1 de [`lumi-s5-mockups.html`](../specs/lumi-s5-mockups.html), estados «una domina» y «tres compiten».

- [ ] **Paso 1: El tipo**

```ts
export interface Hipotesis {
  lat: number; lng: number; radio_m: number;
  peso: number; indice: string; autor: string;
}
```

- [ ] **Paso 2: El mapa** — la principal se pinta como hoy; las alternativas con el mismo marcador **perfilado en vez de relleno** y a menor opacidad. `.marker.top` y `.marker.alt` ya existen en el chrome del 6: **no se añade un color por hipótesis**, la jerarquía se dice con relleno y opacidad.

- [ ] **Paso 3: El cajón** — bajo el análisis seleccionado, la lista de hipótesis numeradas: coordenada en mono, `± N m · N candidatos`, la barra de peso, y `índice · @autor`. La primera lleva «Le saca **N,N×** a la siguiente»; con una sola, «Ninguna otra zona reúne votos suficientes para competir».

- [ ] **Paso 4: El caso sin candidatos** — `state === "error"` con el motivo del motor se enseña tal cual. **El mapa no pinta ningún marcador**: un marcador donde no hay respuesta se lee como que la hay.

- [ ] **Paso 5: Verificar**

Run: `cd client && npx tsc -b --noEmit && npm run lint && npm run build`
Expected: sin errores.

- [ ] **Paso 6: Commit**

```bash
git add client/src
git commit -m "Dudar en voz alta: la principal rellena, las alternativas perfiladas"
```

---

# Fase C · Cerrar

## Task 16: Los documentos que este subsistema cambia

Un subsistema que deja contradicciones escritas en los documentos vecinos no está terminado.

**Files:**
- Modify: `ARCHITECTURE.md`, `FUTURO.md`, `CLAUDE.md`, `PRODUCT.md`

- [ ] **Paso 1: `ARCHITECTURE.md` §10** — la frase «El subsistema 5 sustituye `_cargar` y `_resolver` de ese archivo sin tocar el daemon» **deja de ser cierta**. Sustituirla por lo que de verdad pasa: el trabajador solo embebe, el daemon recupera y atribuye, y la razón (la procedencia vive en SQLite). Dejarla contradictoria es peor que no haberla cambiado.

- [ ] **Paso 2: `ARCHITECTURE.md` §5** — el 5 pasa a «5-0 y 5a terminados; 5b pendiente», con el 5b descrito en una frase. La tabla también arrastra un error viejo: **el 7b figura como «Con spec» cuando está terminado desde hace treinta commits en `master`**. Corregirlo de paso.

- [ ] **Paso 3: `FUTURO.md`** — quitar «Sin punto de entrada a instalar dentro de Lumi Station»: la Tarea 8 lo cierra. Añadir lo que este subsistema aparca a propósito: los modelos reales, los verificadores geométricos, elegir corpus por caso, e instalar solo un área.

- [ ] **Paso 4: `CLAUDE.md`** — Station gana Qdrant (no Redis). La tabla de las tres bases ya no vale solo para el Indexer.

- [ ] **Paso 5: `PRODUCT.md`** — un análisis puede devolver más de una respuesta. Cambia qué es el producto y merece una frase.

- [ ] **Paso 6: Commit**

```bash
git add ARCHITECTURE.md FUTURO.md CLAUDE.md PRODUCT.md
git commit -m "Cerrar los documentos: el trabajador ya no resuelve, y el 7b llevaba meses terminado sin que la tabla lo dijera"
```

---

## Cómo se sabe que está hecho

Con Qdrant levantado y un `.lumidx` publicado a mano:

1. Entrar como administrador → **Índices** → «Instalar del catálogo…» → pegar la URL de una ficha.
2. Se ve el árbol con su peso, se confirma, y el progreso avanza asset a asset.
3. Cerrar el diálogo y volver: la instalación sigue. Matar el daemon a mitad y rearrancar: **no vuelve a descargar lo ya volcado**.
4. En un caso, subir una imagen y analizarla.
5. El análisis pasa a `hecho`, el mapa pinta un punto y el cajón enseña la hipótesis con su índice y su autor.
6. Desinstalar el índice y repetir el análisis: ahora contesta «ningún índice instalado cubre esta imagen».

**Las coordenadas serán malas.** El embebedor es el de juguete. Lo que estos seis pasos demuestran es que el camino existe entero y se puede comprobar — acertar es el 5b.
