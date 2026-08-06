# Lumi Indexer (subsistema 7a) — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** una aplicación Tauri independiente que indexa territorio y produce paquetes `.lumidx` sellados, sin repetir nunca trabajo que ya exista en local o publicado.

**Architecture:** el núcleo comprobable vive en `crates/lumi-index` — formato del paquete, quadkeys, cobertura, procedencia, cuantización, lectura del legacy y contrato de embebido — como lógica pura que se prueba sin GPU, sin servicios y sin ventana. Encima, `indexer/` es una app Tauri fina que orquesta tres almacenes (SQLite para la verdad, Redis para la cola y el estado caliente, Qdrant para los vectores) y un trabajador Python persistente. Los subsistemas 8 y 5 dependerán del crate en vez de copiar el formato.

**Tech Stack:** Rust (workspace existente), Tauri v2, React 19 + Vite + Tailwind 3, SQLite (`rusqlite` bundled), Redis (`redis` crate), Qdrant por HTTP (`reqwest`), Python sin dependencias para el trabajador de referencia, Mapbox GL JS.

## Global Constraints

Toda tarea las hereda. Valores copiados literalmente de la spec.

- **Una sola granularidad: la tesela z14.** Es la unidad del fragmento, la de la cobertura y la del porcentaje por territorio. No introducir un segundo nivel de zoom en ningún sitio.
- **Redis y Qdrant escuchan solo en `127.0.0.1`**, con `protected-mode` activo. Nunca en la red, bajo ninguna configuración.
- **Redis es el timbre y el estado caliente; SQLite es la verdad.** Si Redis se vacía se pierde la barra de progreso, nunca el trabajo.
- **`desconocida` es un valor de primera clase** de la fuente, y aparece en los porcentajes. No se adivina, no se oculta, no se normaliza fuera.
- **El porcentaje por territorio puede sumar más de 100 %** y el manifiesto lo dice. El porcentaje por imágenes y el de procedencia del trabajo suman 100 %.
- **Sellar es irreversible** y **se niega a declarar éxito si las filas no cuadran con los vectores**.
- **El fichero original de una carpeta local no se reescribe, ni se recomprime, ni se le quita el EXIF.** Se abre en solo lectura.
- **Las imágenes del índice sí se pueden recomprimir** a la resolución que consume el verificador: son material de referencia, no la prueba de un caso.
- **Ni un color fuera de `DESIGN.md`.** Rampa de neutros (`fg`/`muted`/`subtle`) para los tres tipos de procedencia; `warning` solo para lo desconocido y para el bloqueo. No hay verde.
- **Identificadores, comentarios y mensajes en español.** Los comentarios explican el *porqué*, no el *qué*.
- **`ponytail` manda:** la solución más simple que funcione. Las simplificaciones deliberadas llevan comentario `// ponytail:` nombrando el techo y la salida.
- **Un commit por tarea terminada**, no commits intermedios.
- **Sin tests salvo los que este plan nombra.** Son seis, todos en `crates/lumi-index`, y están donde la lógica no es trivial.

## Estructura de ficheros

```
crates/lumi-index/            NUEVO · núcleo puro, miembro del workspace
  Cargo.toml
  src/
    lib.rs                    reexporta los módulos
    tiles.rs                  quadkey z14, área → teselas
    coverage.rs               cobertura.json, clasificación en tres estados
    manifest.rs               manifiesto del paquete y los dos porcentajes
    vectors.rs                fragmentos .b1/.i8, cuantización, orden
    legacy.rs                 descifrado y validación del paquete v1
    embed.rs                  contrato con el trabajador de embebido

workers/
  lumi_embed.py               NUEVO · trabajador de referencia de embebido

indexer/                      NUEVO · la aplicación
  package.json, index.html, vite.config.ts, tailwind.config.ts,
  postcss.config.js, tsconfig*.json
  src/
    main.tsx, App.tsx, index.css
    ui/                       Icon, PlanetBackground, WindowFrame, TitleBar
    lib/api.ts, lib/store.ts
    setup/                    wizard de aprovisionamiento
    catalog/                  lista de índices, detalle, procedencia
    territory/                mapa, dibujo, clasificación, plan
    ingest/                   diálogos de ingesta, cola, saltadas
    seal/                     sellado
  src-tauri/
    Cargo.toml, tauri.conf.json, build.rs, capabilities/
    src/
      main.rs, lib.rs
      store.rs                SQLite: esquema y consultas
      crypto.rs               clave maestra local
      services.rs             Redis y Qdrant: arrancar, parar, salud
      runtime.rs              venv + torch + pesos, con log persistente
      models.rs               registro de modelos como datos
      qdrant.rs               cliente HTTP
      queue.rs                cola de lotes y trabajador persistente
      ingest.rs               carpeta local y paquete legacy
      territory.rs            clasificación de teselas y plan
      package.rs              sellar y abrir .lumidx

Cargo.toml                    MODIFICAR · añadir el miembro y excluir indexer/src-tauri
tools/build.py                MODIFICAR · arrancar también el Indexer en dev
```

---

### Task 1: Crate `lumi-index` y las teselas

**Files:**
- Create: `crates/lumi-index/Cargo.toml`
- Create: `crates/lumi-index/src/lib.rs`
- Create: `crates/lumi-index/src/tiles.rs`
- Modify: `Cargo.toml` (raíz)

**Interfaces:**
- Consumes: nada.
- Produces: `lumi_index::tiles::{Z, quadkey, quadkey_de, teselas_de_poligono, Punto}`. `Z: u8 = 14`. `quadkey(lat: f64, lng: f64) -> String` devuelve 14 caracteres. `teselas_de_poligono(&[Punto]) -> Vec<String>` devuelve los quadkeys z14 cuyo centro cae dentro del polígono, ordenados y sin repetir.

- [ ] **Step 1: Crear el crate y engancharlo al workspace**

`crates/lumi-index/Cargo.toml`:

```toml
[package]
name = "lumi-index"
version.workspace = true
edition.workspace = true
license.workspace = true

[dependencies]
serde = { workspace = true }
serde_json = { workspace = true }
anyhow = { workspace = true }
sha2 = { workspace = true }
```

En `Cargo.toml` de la raíz, cambiar la línea de `members`:

```toml
members = ["crates/lumi-proto", "crates/lumi-index", "crates/lumid", "crates/lumi-cli"]
```

y la de `exclude`, para que el segundo proyecto Tauri tampoco lo reclame el workspace:

```toml
# ponytail: client/src-tauri e indexer/src-tauri son proyectos Cargo aparte
# (los gestiona `tauri`, no este workspace); sin excluirlos, cargo los reclama
# igual por estar bajo este árbol de directorios.
exclude = ["client/src-tauri", "indexer/src-tauri"]
```

Y añadir a `[workspace.dependencies]`:

```toml
lumi-index = { path = "crates/lumi-index" }
```

- [ ] **Step 2: Escribir el test que falla**

`crates/lumi-index/src/tiles.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn el_quadkey_es_de_catorce_y_el_poligono_da_las_teselas_de_dentro() {
        // Valor de referencia de la implementación de Bing, la misma que usaba
        // `quadkey_z16` en la v1: A Coruña, centro.
        let qk = quadkey(43.3623, -8.4115);
        assert_eq!(qk.len(), Z as usize, "z14 son 14 dígitos: {qk}");
        assert!(qk.chars().all(|c| ('0'..='3').contains(&c)), "{qk}");

        // Dos puntos a menos de un metro caen en la misma tesela.
        assert_eq!(qk, quadkey(43.36230_5, -8.41150_5));

        // La misma latitud a media vuelta del planeta, no.
        assert_ne!(qk, quadkey(43.3623, 171.5885));

        // Un cuadrado pequeño da un puñado de teselas, todas distintas y
        // ordenadas, y su propia esquina inferior izquierda está dentro.
        let cuadro = vec![
            Punto { lat: 43.35, lng: -8.43 },
            Punto { lat: 43.35, lng: -8.39 },
            Punto { lat: 43.38, lng: -8.39 },
            Punto { lat: 43.38, lng: -8.43 },
        ];
        let t = teselas_de_poligono(&cuadro);
        assert!(t.len() > 4, "un cuadro de ~3 km debe dar varias teselas z14: {}", t.len());
        let mut ordenado = t.clone();
        ordenado.sort();
        ordenado.dedup();
        assert_eq!(t, ordenado, "deben venir ordenadas y sin repetir");
        assert!(t.contains(&quadkey(43.3623, -8.4115)));

        // Un punto claramente fuera no aparece.
        assert!(!t.contains(&quadkey(40.4168, -3.7038)));
    }
}
```

- [ ] **Step 3: Ejecutarlo y ver que falla**

Run: `cargo test -p lumi-index el_quadkey_es_de_catorce`
Expected: FAIL — `cannot find function 'quadkey' in this scope`.

- [ ] **Step 4: Implementar las teselas**

Al principio de `crates/lumi-index/src/tiles.rs`, antes del bloque de tests:

```rust
//! Teselas de Web Mercator, siempre a z14.
//!
//! Una sola granularidad en todo el sistema: la tesela z14 es la unidad del
//! fragmento, la de la cobertura y la del porcentaje por territorio. Mezclar
//! dos niveles de zoom obligaría a traducir entre ellos en cada consulta y a
//! explicar cuál manda en cada sitio.

use serde::{Deserialize, Serialize};

/// El único zoom del sistema. No parametrizar: ver el comentario de arriba.
pub const Z: u8 = 14;

/// Límite de Mercator. Más allá la proyección no está definida.
const LAT_MAX: f64 = 85.051_128_78;

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Punto {
    pub lat: f64,
    pub lng: f64,
}

/// Índices de tesela (x, y) a z14.
fn xy(lat: f64, lng: f64) -> (u32, u32) {
    let escala = 1u32 << Z;
    let lat = lat.clamp(-LAT_MAX, LAT_MAX);
    let sen = lat.to_radians().sin();
    let x = (((lng + 180.0) / 360.0) * escala as f64).floor();
    let y = ((0.5 - ((1.0 + sen) / (1.0 - sen)).ln() / (4.0 * std::f64::consts::PI))
        * escala as f64)
        .floor();
    (
        (x.max(0.0) as u32).min(escala - 1),
        (y.max(0.0) as u32).min(escala - 1),
    )
}

/// Quadkey de Bing: se entrelazan el bit de y (valor 2) y el de x (valor 1)
/// desde el nivel más significativo hacia abajo. Idéntico a `quadkey_z16` de
/// la v1 salvo el zoom.
pub fn quadkey_de(x: u32, y: u32) -> String {
    let mut s = String::with_capacity(Z as usize);
    for nivel in (1..=Z).rev() {
        let mascara = 1u32 << (nivel - 1);
        let mut d = b'0';
        if x & mascara != 0 {
            d += 1;
        }
        if y & mascara != 0 {
            d += 2;
        }
        s.push(d as char);
    }
    s
}

pub fn quadkey(lat: f64, lng: f64) -> String {
    let (x, y) = xy(lat, lng);
    quadkey_de(x, y)
}

/// Centro geográfico de una tesela, que es el punto con el que se decide si
/// cae dentro de un polígono.
fn centro(x: u32, y: u32) -> Punto {
    let escala = (1u32 << Z) as f64;
    let lng = (x as f64 + 0.5) / escala * 360.0 - 180.0;
    let n = std::f64::consts::PI * (1.0 - 2.0 * (y as f64 + 0.5) / escala);
    let lat = n.sinh().atan().to_degrees();
    Punto { lat, lng }
}

/// Cruce de rayos, la prueba de punto en polígono de toda la vida. El polígono
/// se cierra solo: no hace falta repetir el primer vértice al final.
fn dentro(p: Punto, poligono: &[Punto]) -> bool {
    let mut d = false;
    let n = poligono.len();
    let mut j = n - 1;
    for i in 0..n {
        let (a, b) = (poligono[i], poligono[j]);
        if (a.lat > p.lat) != (b.lat > p.lat) {
            let corte = (b.lng - a.lng) * (p.lat - a.lat) / (b.lat - a.lat) + a.lng;
            if p.lng < corte {
                d = !d;
            }
        }
        j = i;
    }
    d
}

/// Teselas z14 cuyo CENTRO cae dentro del polígono. Se recorre la caja
/// envolvente y se filtra: es cuadrático sobre la caja, no sobre el planeta.
///
/// ponytail: el criterio es el centro y no la intersección de áreas. Una
/// tesela mordida por el borde entra o no según dónde caiga su centro, lo que
/// puede dejar fuera una franja de hasta media tesela. El techo es ese; la
/// salida, si molesta, es probar también las cuatro esquinas.
pub fn teselas_de_poligono(poligono: &[Punto]) -> Vec<String> {
    if poligono.len() < 3 {
        return Vec::new();
    }
    let (mut lat0, mut lat1) = (f64::MAX, f64::MIN);
    let (mut lng0, mut lng1) = (f64::MAX, f64::MIN);
    for p in poligono {
        lat0 = lat0.min(p.lat);
        lat1 = lat1.max(p.lat);
        lng0 = lng0.min(p.lng);
        lng1 = lng1.max(p.lng);
    }
    // y crece hacia el SUR, así que la esquina superior izquierda es
    // (lat máxima, lng mínima).
    let (x0, y0) = xy(lat1, lng0);
    let (x1, y1) = xy(lat0, lng1);

    let mut fuera = Vec::new();
    for y in y0..=y1 {
        for x in x0..=x1 {
            if dentro(centro(x, y), poligono) {
                fuera.push(quadkey_de(x, y));
            }
        }
    }
    fuera.sort();
    fuera.dedup();
    fuera
}
```

`crates/lumi-index/src/lib.rs`:

```rust
//! El núcleo del Indexer: formato del paquete, teselas, cobertura,
//! procedencia y el contrato con el trabajador de embebido.
//!
//! Vive aparte de la aplicación porque es lógica pura y se prueba sin GPU, sin
//! servicios y sin ventana — y porque los subsistemas 8 y 5 abrirán estos
//! paquetes y deben depender de este crate en vez de copiar el formato.

pub mod tiles;
```

- [ ] **Step 5: Ejecutarlo y ver que pasa**

Run: `cargo test -p lumi-index`
Expected: PASS, 1 test.

- [ ] **Step 6: Commit**

```bash
git add Cargo.toml crates/lumi-index
git commit -m "El crate del indice, y las teselas z14 que lo miden todo"
```

---

### Task 2: Cobertura y clasificación en tres estados

**Files:**
- Create: `crates/lumi-index/src/coverage.rs`
- Modify: `crates/lumi-index/src/lib.rs`

**Interfaces:**
- Consumes: `tiles::Z`.
- Produces: `lumi_index::coverage::{Cobertura, TeselaCubierta, Atribucion, Fuente, Estado, clasificar}`. `clasificar(pedidas: &[String], locales: &[Cobertura], catalogo: &[Cobertura]) -> Vec<(String, Estado)>` devuelve una entrada por tesela pedida, en el mismo orden. Lo local gana sobre el catálogo.

- [ ] **Step 1: Escribir el test que falla**

Al final de `crates/lumi-index/src/coverage.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    fn cob(indice: &str, autor: &str, qks: &[&str]) -> Cobertura {
        Cobertura {
            version: 1,
            indice: indice.into(),
            sellado_en: "2026-07-28T11:04:00Z".into(),
            atribucion: Atribucion {
                autor: autor.into(),
                url: format!("https://github.com/{autor}"),
                licencia: "CC BY-SA 4.0".into(),
            },
            teselas: qks
                .iter()
                .map(|q| TeselaCubierta {
                    quadkey: (*q).into(),
                    sha256: format!("hash-de-{q}"),
                    bytes: 1024,
                    imagenes: 10,
                })
                .collect(),
        }
    }

    #[test]
    fn lo_cubierto_no_se_reindexa_y_lo_local_gana_al_catalogo() {
        let locales = vec![cob("madrid-centro", "yo", &["A", "B"])];
        let catalogo = vec![cob("marta/lumi-costa", "marta", &["B", "C"])];

        let r = clasificar(&["A".into(), "B".into(), "C".into(), "D".into()], &locales, &catalogo);
        assert_eq!(r.len(), 4, "una entrada por tesela pedida, en el mismo orden");
        assert_eq!(r[0].0, "A");
        assert!(matches!(r[0].1, Estado::Local { .. }));
        // B está en los dos. Gana lo local: ya lo tienes, no hay nada que bajar.
        assert!(matches!(r[1].1, Estado::Local { .. }), "lo local gana: {:?}", r[1].1);
        match &r[2].1 {
            Estado::Catalogo { indice, sha256, .. } => {
                assert_eq!(indice, "marta/lumi-costa");
                assert_eq!(sha256, "hash-de-C");
            }
            otro => panic!("C debería venir del catálogo, y vino {otro:?}"),
        }
        assert!(matches!(r[3].1, Estado::Nuevo), "D no existe en ningún sitio");

        // Un área enteramente cubierta no deja NADA que indexar. Es la
        // condición que apaga el indexado entero, así que se comprueba sola.
        let todo = clasificar(&["A".into(), "C".into()], &locales, &catalogo);
        assert_eq!(todo.iter().filter(|(_, e)| matches!(e, Estado::Nuevo)).count(), 0);

        // Y una parcialmente cubierta devuelve exactamente el complemento.
        let nuevas: Vec<_> = r
            .iter()
            .filter(|(_, e)| matches!(e, Estado::Nuevo))
            .map(|(q, _)| q.clone())
            .collect();
        assert_eq!(nuevas, vec!["D".to_string()]);
    }
}
```

- [ ] **Step 2: Ejecutarlo y ver que falla**

Run: `cargo test -p lumi-index lo_cubierto_no_se_reindexa`
Expected: FAIL — el módulo `coverage` no existe.

- [ ] **Step 3: Implementar la cobertura**

Al principio de `crates/lumi-index/src/coverage.rs`:

```rust
//! Quién cubre qué territorio, y la regla de no indexar nunca lo mismo dos
//! veces.
//!
//! `cobertura.json` es lo ÚNICO del subsistema 8 que el 7a construye, y no es
//! trabajo adelantado: el 8 lo va a necesitar exactamente así. El 7a lo escribe
//! al sellar y lo lee al planificar, y el mismo camino de código sirve para los
//! paquetes locales y para los publicados.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Atribucion {
    pub autor: String,
    pub url: String,
    pub licencia: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TeselaCubierta {
    pub quadkey: String,
    /// Hash del fragmento. Es lo que hace que la autoría sea COMPROBABLE y no
    /// una declaración de buena fe: quitar la atribución rompería SHA256SUMS.
    pub sha256: String,
    pub bytes: u64,
    pub imagenes: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Cobertura {
    pub version: u32,
    /// Identificador legible del índice: `madrid-centro` o `marta/lumi-costa`.
    pub indice: String,
    pub sellado_en: String,
    pub atribucion: Atribucion,
    pub teselas: Vec<TeselaCubierta>,
}

/// En qué situación está una tesela que el operador quiere indexar.
#[derive(Debug, Clone, PartialEq)]
pub enum Estado {
    /// Ya en un índice de este equipo. Ni descarga ni GPU: se referencia el
    /// mismo fragmento.
    Local { indice: String, sha256: String },
    /// La cubre un índice publicado. Se descarga su fragmento, con su
    /// atribución pegada.
    Catalogo { indice: String, sha256: String, bytes: u64, atribucion: Atribucion },
    /// No existe en ningún sitio conocido. Es lo único que cuesta cuota y GPU.
    Nuevo,
}

/// Clasifica cada tesela pedida. Devuelve una entrada por tesela y EN EL MISMO
/// ORDEN, para que quien llame pueda cruzarlas con su propia lista sin
/// reordenar.
///
/// Lo local gana sobre el catálogo cuando los dos la tienen: ya está en disco,
/// bajarla otra vez sería exactamente el trabajo que esta función existe para
/// evitar.
pub fn clasificar(
    pedidas: &[String],
    locales: &[Cobertura],
    catalogo: &[Cobertura],
) -> Vec<(String, Estado)> {
    pedidas
        .iter()
        .map(|qk| {
            let estado = buscar_local(qk, locales)
                .or_else(|| buscar_catalogo(qk, catalogo))
                .unwrap_or(Estado::Nuevo);
            (qk.clone(), estado)
        })
        .collect()
}

fn buscar_local(qk: &str, cobs: &[Cobertura]) -> Option<Estado> {
    for c in cobs {
        if let Some(t) = c.teselas.iter().find(|t| t.quadkey == qk) {
            return Some(Estado::Local { indice: c.indice.clone(), sha256: t.sha256.clone() });
        }
    }
    None
}

fn buscar_catalogo(qk: &str, cobs: &[Cobertura]) -> Option<Estado> {
    for c in cobs {
        if let Some(t) = c.teselas.iter().find(|t| t.quadkey == qk) {
            return Some(Estado::Catalogo {
                indice: c.indice.clone(),
                sha256: t.sha256.clone(),
                bytes: t.bytes,
                atribucion: c.atribucion.clone(),
            });
        }
    }
    None
}

/// Cuántas teselas de cada clase, que es lo que la interfaz enseña y lo que
/// decide si el botón de indexar existe siquiera.
pub struct Reparto {
    pub locales: usize,
    pub catalogo: usize,
    pub nuevas: usize,
    pub bytes_a_descargar: u64,
}

pub fn repartir(clasificadas: &[(String, Estado)]) -> Reparto {
    let mut r = Reparto { locales: 0, catalogo: 0, nuevas: 0, bytes_a_descargar: 0 };
    for (_, e) in clasificadas {
        match e {
            Estado::Local { .. } => r.locales += 1,
            Estado::Catalogo { bytes, .. } => {
                r.catalogo += 1;
                r.bytes_a_descargar += bytes;
            }
            Estado::Nuevo => r.nuevas += 1,
        }
    }
    r
}
```

En `crates/lumi-index/src/lib.rs`, añadir bajo `pub mod tiles;`:

```rust
pub mod coverage;
```

- [ ] **Step 4: Ejecutarlo y ver que pasa**

Run: `cargo test -p lumi-index`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add crates/lumi-index
git commit -m "Que teselas ya existen, y por que lo local gana al catalogo"
```

---

### Task 3: El manifiesto y los dos porcentajes

**Files:**
- Create: `crates/lumi-index/src/manifest.rs`
- Modify: `crates/lumi-index/src/lib.rs`

**Interfaces:**
- Consumes: nada de tareas anteriores.
- Produces: `lumi_index::manifest::{Manifiesto, Tipo, FilaImagen, Reparto Imagenes…}` — en concreto `Tipo` (`Calle`/`Cenital`/`Suelta`), `FilaImagen { tipo, fuente, quadkey }`, `TrabajoDe` (`Aqui`/`Local(String)`/`Catalogo(String)`), y `porcentajes(&[FilaImagen]) -> PorcentajesImagenes` y `porcentajes_trabajo(&[(String, TrabajoDe)]) -> Vec<(String, u32, f64)>`.

- [ ] **Step 1: Escribir el test que falla**

Al final de `crates/lumi-index/src/manifest.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    fn fila(tipo: Tipo, fuente: &str, qk: &str) -> FilaImagen {
        FilaImagen { tipo, fuente: fuente.into(), quadkey: qk.into() }
    }

    #[test]
    fn por_imagenes_suma_cien_y_por_territorio_puede_pasarse() {
        // Cuatro imágenes de calle en dos teselas, una cenital que cubre las
        // DOS mismas teselas más una tercera. Por imágenes la calle domina;
        // por territorio la cenital cubre más. Ese es exactamente el caso que
        // justifica enseñar los dos números.
        let filas = vec![
            fila(Tipo::Calle, "mapillary", "A"),
            fila(Tipo::Calle, "mapillary", "A"),
            fila(Tipo::Calle, "mapillary", "B"),
            fila(Tipo::Calle, "desconocida", "B"),
            fila(Tipo::Cenital, "carpeta:dron", "A"),
            fila(Tipo::Cenital, "carpeta:dron", "B"),
            fila(Tipo::Cenital, "carpeta:dron", "C"),
        ];
        let p = porcentajes(&filas);

        // Por imágenes: 4 de 7 y 3 de 7.
        let calle = p.por_tipo.iter().find(|t| t.tipo == Tipo::Calle).unwrap();
        let cenital = p.por_tipo.iter().find(|t| t.tipo == Tipo::Cenital).unwrap();
        assert!((calle.imagenes_pct - 57.14).abs() < 0.01, "{}", calle.imagenes_pct);
        assert!((cenital.imagenes_pct - 42.86).abs() < 0.01, "{}", cenital.imagenes_pct);
        let suma: f64 = p.por_tipo.iter().map(|t| t.imagenes_pct).sum();
        assert!((suma - 100.0).abs() < 0.01, "por imágenes suma 100: {suma}");

        // Por territorio: calle cubre A y B de tres teselas; cenital las tres.
        assert!((calle.territorio_pct - 66.67).abs() < 0.01, "{}", calle.territorio_pct);
        assert!((cenital.territorio_pct - 100.0).abs() < 0.01, "{}", cenital.territorio_pct);
        assert!(p.territorio_suma > 100.0, "debe pasarse de 100: {}", p.territorio_suma);
        assert!((p.territorio_suma - 166.67).abs() < 0.01, "{}", p.territorio_suma);

        // `desconocida` es una fuente como las demás y aparece en la lista.
        let desc = p.por_fuente.iter().find(|f| f.fuente == "desconocida").unwrap();
        assert_eq!(desc.imagenes, 1);

        // El trabajo suma 100 porque una tesela la indexó exactamente uno.
        let trabajo = porcentajes_trabajo(&[
            ("A".into(), TrabajoDe::Aqui),
            ("B".into(), TrabajoDe::Catalogo("marta/lumi-costa".into())),
            ("C".into(), TrabajoDe::Catalogo("marta/lumi-costa".into())),
            ("D".into(), TrabajoDe::Local("madrid-centro".into())),
        ]);
        let suma_t: f64 = trabajo.iter().map(|(_, _, pct)| pct).sum();
        assert!((suma_t - 100.0).abs() < 0.01, "el trabajo suma 100: {suma_t}");
        let marta = trabajo.iter().find(|(o, _, _)| o == "marta/lumi-costa").unwrap();
        assert_eq!(marta.1, 2);
        assert!((marta.2 - 50.0).abs() < 0.01);
    }
}
```

- [ ] **Step 2: Ejecutarlo y ver que falla**

Run: `cargo test -p lumi-index por_imagenes_suma_cien`
Expected: FAIL — el módulo `manifest` no existe.

- [ ] **Step 3: Implementar el manifiesto**

Al principio de `crates/lumi-index/src/manifest.rs`:

```rust
//! El manifiesto del paquete y las DOS procedencias.
//!
//! Son dos preguntas distintas y por eso son dos tablas. La de las imágenes
//! dice de dónde salió el píxel; la del trabajo dice quién pagó por indexarlo.
//! Suman distinto, y que sumen distinto es información: una tesela la indexó
//! exactamente uno, pero dos orígenes de imagen pueden cubrir la misma.

use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};

/// Cómo mira el mundo una imagen. Cerrado, tres valores: determina contra qué
/// verifica bien. Una cenital y una foto de turista no se parecen aunque miren
/// el mismo sitio.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Tipo {
    Calle,
    Cenital,
    Suelta,
}

impl Tipo {
    pub const TODOS: [Tipo; 3] = [Tipo::Calle, Tipo::Cenital, Tipo::Suelta];
}

/// Lo mínimo de una imagen que hace falta para contar procedencia.
#[derive(Debug, Clone, PartialEq)]
pub struct FilaImagen {
    pub tipo: Tipo,
    /// `mapillary`, `carpeta:vuelo-dron`, `desconocida`… `desconocida` es un
    /// valor de primera clase y sale en los porcentajes como cualquier otro.
    pub fuente: String,
    pub quadkey: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PctTipo {
    pub tipo: Tipo,
    pub imagenes: u32,
    pub imagenes_pct: f64,
    pub teselas: u32,
    pub territorio_pct: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PctFuente {
    pub fuente: String,
    pub imagenes: u32,
    pub imagenes_pct: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PorcentajesImagenes {
    pub por_tipo: Vec<PctTipo>,
    pub por_fuente: Vec<PctFuente>,
    pub imagenes_total: u32,
    pub teselas_total: u32,
    /// La suma de `territorio_pct`. Se GUARDA en vez de calcularse al pintar
    /// porque es el número que hay que enseñar tal cual: pasa de 100 y decirlo
    /// es la mitad del sentido de tener esta columna.
    pub territorio_suma: f64,
}

fn pct(parte: u32, total: u32) -> f64 {
    if total == 0 {
        return 0.0;
    }
    (parte as f64) * 100.0 / (total as f64)
}

pub fn porcentajes(filas: &[FilaImagen]) -> PorcentajesImagenes {
    let total = filas.len() as u32;
    let teselas_total = filas.iter().map(|f| f.quadkey.as_str()).collect::<BTreeSet<_>>().len() as u32;

    let mut por_tipo = Vec::new();
    for tipo in Tipo::TODOS {
        let del_tipo: Vec<&FilaImagen> = filas.iter().filter(|f| f.tipo == tipo).collect();
        if del_tipo.is_empty() {
            continue;
        }
        let teselas =
            del_tipo.iter().map(|f| f.quadkey.as_str()).collect::<BTreeSet<_>>().len() as u32;
        por_tipo.push(PctTipo {
            tipo,
            imagenes: del_tipo.len() as u32,
            imagenes_pct: pct(del_tipo.len() as u32, total),
            teselas,
            territorio_pct: pct(teselas, teselas_total),
        });
    }
    let territorio_suma = por_tipo.iter().map(|t| t.territorio_pct).sum();

    let mut cuenta: BTreeMap<&str, u32> = BTreeMap::new();
    for f in filas {
        *cuenta.entry(f.fuente.as_str()).or_default() += 1;
    }
    let por_fuente = cuenta
        .into_iter()
        .map(|(fuente, imagenes)| PctFuente {
            fuente: fuente.to_string(),
            imagenes,
            imagenes_pct: pct(imagenes, total),
        })
        .collect();

    PorcentajesImagenes {
        por_tipo,
        por_fuente,
        imagenes_total: total,
        teselas_total,
        territorio_suma,
    }
}

/// Quién pagó la descarga y la GPU de una tesela.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum TrabajoDe {
    /// Indexada en este equipo, para este índice.
    Aqui,
    /// Heredada de otro índice de este equipo.
    Local(String),
    /// Heredada de un índice publicado por un tercero.
    Catalogo(String),
}

impl TrabajoDe {
    fn etiqueta(&self) -> String {
        match self {
            TrabajoDe::Aqui => "indexado aquí".into(),
            TrabajoDe::Local(i) => format!("de «{i}»"),
            TrabajoDe::Catalogo(i) => i.clone(),
        }
    }
}

/// Devuelve `(etiqueta, teselas, porcentaje)` ordenado de más a menos.
/// **Suma 100 %**: una tesela la indexó exactamente uno, así que aquí no hay
/// solape posible y no hace falta advertir de nada.
pub fn porcentajes_trabajo(teselas: &[(String, TrabajoDe)]) -> Vec<(String, u32, f64)> {
    let total = teselas.len() as u32;
    let mut cuenta: BTreeMap<String, u32> = BTreeMap::new();
    for (_, t) in teselas {
        *cuenta.entry(t.etiqueta()).or_default() += 1;
    }
    let mut v: Vec<(String, u32, f64)> =
        cuenta.into_iter().map(|(k, n)| (k, n, pct(n, total))).collect();
    v.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(&b.0)));
    v
}

/// El `manifiesto.json` del paquete.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Manifiesto {
    pub version: u32,
    pub nombre: String,
    pub slug: String,
    pub sellado_en: String,
    pub version_indexer: String,
    /// Modelos cuyos vectores lleva el paquete, como `("lumi-2", "1.0", 12288)`.
    pub modelos: Vec<(String, String, u32)>,
    pub imagenes: PorcentajesImagenes,
    pub trabajo: Vec<(String, u32, f64)>,
    /// Atribución de terceros, obligatoria y no editable: viaja con los
    /// fragmentos heredados y quitarla rompería SHA256SUMS.
    pub atribuciones: Vec<crate::coverage::Atribucion>,
}
```

En `crates/lumi-index/src/lib.rs`, añadir:

```rust
pub mod manifest;
```

- [ ] **Step 4: Ejecutarlo y ver que pasa**

Run: `cargo test -p lumi-index`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add crates/lumi-index
git commit -m "Las dos procedencias, y por que suman distinto"
```

---

### Task 4: Fragmentos de vectores — cuantización y orden

**Files:**
- Create: `crates/lumi-index/src/vectors.rs`
- Modify: `crates/lumi-index/src/lib.rs`

**Interfaces:**
- Consumes: nada de tareas anteriores.
- Produces: `lumi_index::vectors::{Forma, Cabecera, escribir_b1, escribir_i8, leer_b1, leer_i8, CABECERA_BYTES}`. `escribir_i8(&mut impl Write, &[Vec<f32>]) -> anyhow::Result<()>` y `leer_i8(&mut impl Read) -> anyhow::Result<Vec<Vec<f32>>>` conservan el orden. `CABECERA_BYTES: usize = 32`.

- [ ] **Step 1: Escribir el test que falla**

Al final de `crates/lumi-index/src/vectors.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    /// Vectores normalizados a L2, que es la precondición del formato.
    fn normalizar(mut v: Vec<f32>) -> Vec<f32> {
        let n = v.iter().map(|x| x * x).sum::<f32>().sqrt();
        if n > 0.0 {
            for x in &mut v {
                *x /= n;
            }
        }
        v
    }

    #[test]
    fn el_fragmento_va_y_vuelve_conservando_el_orden() {
        let vs: Vec<Vec<f32>> = vec![
            normalizar(vec![1.0, 0.0, -1.0, 0.5]),
            normalizar(vec![-0.25, 0.75, 0.1, -0.9]),
            normalizar(vec![0.3, 0.3, 0.3, 0.3]),
        ];

        // int8: vuelve casi igual. El error máximo de una escala de 127 sobre
        // un vector normalizado es medio paso, 1/254.
        let mut buf = Vec::new();
        escribir_i8(&mut buf, &vs).unwrap();
        let vuelta = leer_i8(&mut buf.as_slice()).unwrap();
        assert_eq!(vuelta.len(), vs.len(), "mismo número de vectores");
        for (i, (a, b)) in vs.iter().zip(&vuelta).enumerate() {
            for (j, (x, y)) in a.iter().zip(b).enumerate() {
                assert!((x - y).abs() <= 1.0 / 254.0 + 1e-6, "v{i}[{j}]: {x} vs {y}");
            }
        }
        // El orden es el contrato: la fila N del fichero es la imagen N de
        // indice.db. Si se permutara, cada vector quedaría pegado a la imagen
        // equivocada y nadie se enteraría.
        assert!(vuelta[0][0] > vuelta[1][0], "el primero sigue siendo el primero");

        // binario: solo el signo, 1 bit por dimensión.
        let mut buf = Vec::new();
        escribir_b1(&mut buf, &vs).unwrap();
        assert_eq!(
            buf.len(),
            CABECERA_BYTES + 3 * 1,
            "4 dimensiones caben en 1 byte por vector"
        );
        let bits = leer_b1(&mut buf.as_slice()).unwrap();
        assert_eq!(bits.len(), 3);
        assert_eq!(bits[0], vec![true, false, false, true], "signos de v0");
        assert_eq!(bits[1], vec![false, true, true, false], "signos de v1");

        // Una cabecera de otro formato no se traga: es lo que evita leer
        // basura como si fueran vectores.
        let mut roto = buf.clone();
        roto[0] = b'X';
        assert!(leer_b1(&mut roto.as_slice()).is_err());
    }
}
```

- [ ] **Step 2: Ejecutarlo y ver que falla**

Run: `cargo test -p lumi-index el_fragmento_va_y_vuelve`
Expected: FAIL — el módulo `vectors` no existe.

- [ ] **Step 3: Implementar los fragmentos**

Al principio de `crates/lumi-index/src/vectors.rs`:

```rust
//! Los vectores de un fragmento, cuantizados.
//!
//! El elefante del tamaño son los vectores: con lumi-2 a 12288 dimensiones,
//! 200 000 imágenes son ~9.8 GB en float32, ~2.5 GB en int8 y ~0.3 GB en
//! binario. El paquete lleva binario e int8 dentro de cada fragmento, y el
//! float32 como extra opcional.
//!
//! PRECONDICIÓN: los vectores llegan normalizados a L2, así que sus
//! componentes están en [-1, 1] y la escala del int8 es fija (127). Sin esa
//! precondición habría que guardar una escala por fichero, y el formato
//! dejaría de leerse con cinco líneas de código.
//!
//! El ORDEN es el contrato: la fila N del fichero es la imagen N según
//! `indice.db`. Nada más ata un vector a su imagen.

use std::io::{Read, Write};

use anyhow::{bail, Result};

const MAGIA: &[u8; 8] = b"LUMIVEC1";
pub const CABECERA_BYTES: usize = 32;

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Forma {
    /// Un bit por dimensión: solo el signo. Es sobre lo que se busca.
    Binario,
    /// int8 escalar con escala fija 127. Es lo que reescala al binario.
    Int8,
}

impl Forma {
    fn byte(self) -> u8 {
        match self {
            Forma::Binario => 1,
            Forma::Int8 => 2,
        }
    }
    fn de_byte(b: u8) -> Result<Forma> {
        Ok(match b {
            1 => Forma::Binario,
            2 => Forma::Int8,
            otro => bail!("forma de vector desconocida: {otro}"),
        })
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Cabecera {
    pub dims: u32,
    pub cuenta: u32,
    pub forma: Forma,
}

fn escribir_cabecera(w: &mut impl Write, c: Cabecera) -> Result<()> {
    let mut b = [0u8; CABECERA_BYTES];
    b[0..8].copy_from_slice(MAGIA);
    b[8..12].copy_from_slice(&c.dims.to_le_bytes());
    b[12..16].copy_from_slice(&c.cuenta.to_le_bytes());
    b[16] = c.forma.byte();
    w.write_all(&b)?;
    Ok(())
}

pub fn leer_cabecera(r: &mut impl Read) -> Result<Cabecera> {
    let mut b = [0u8; CABECERA_BYTES];
    r.read_exact(&mut b)?;
    if &b[0..8] != MAGIA {
        bail!("esto no es un fragmento de vectores de Lumi");
    }
    Ok(Cabecera {
        dims: u32::from_le_bytes(b[8..12].try_into().unwrap()),
        cuenta: u32::from_le_bytes(b[12..16].try_into().unwrap()),
        forma: Forma::de_byte(b[16])?,
    })
}

fn dims_de(vs: &[Vec<f32>]) -> Result<u32> {
    let Some(primero) = vs.first() else { return Ok(0) };
    let d = primero.len();
    if d == 0 {
        bail!("un vector de cero dimensiones no es un vector");
    }
    if vs.iter().any(|v| v.len() != d) {
        bail!("todos los vectores del fragmento deben tener las mismas dimensiones");
    }
    Ok(d as u32)
}

pub fn escribir_i8(w: &mut impl Write, vs: &[Vec<f32>]) -> Result<()> {
    let dims = dims_de(vs)?;
    escribir_cabecera(w, Cabecera { dims, cuenta: vs.len() as u32, forma: Forma::Int8 })?;
    for v in vs {
        let fila: Vec<u8> =
            v.iter().map(|x| ((x.clamp(-1.0, 1.0) * 127.0).round() as i8) as u8).collect();
        w.write_all(&fila)?;
    }
    Ok(())
}

pub fn leer_i8(r: &mut impl Read) -> Result<Vec<Vec<f32>>> {
    let c = leer_cabecera(r)?;
    if c.forma != Forma::Int8 {
        bail!("se esperaba un fragmento int8");
    }
    let mut fuera = Vec::with_capacity(c.cuenta as usize);
    let mut fila = vec![0u8; c.dims as usize];
    for _ in 0..c.cuenta {
        r.read_exact(&mut fila)?;
        fuera.push(fila.iter().map(|b| (*b as i8) as f32 / 127.0).collect());
    }
    Ok(fuera)
}

pub fn escribir_b1(w: &mut impl Write, vs: &[Vec<f32>]) -> Result<()> {
    let dims = dims_de(vs)?;
    escribir_cabecera(w, Cabecera { dims, cuenta: vs.len() as u32, forma: Forma::Binario })?;
    let bytes_por_vector = (dims as usize + 7) / 8;
    for v in vs {
        let mut fila = vec![0u8; bytes_por_vector];
        for (i, x) in v.iter().enumerate() {
            if *x > 0.0 {
                fila[i / 8] |= 1 << (7 - (i % 8));
            }
        }
        w.write_all(&fila)?;
    }
    Ok(())
}

pub fn leer_b1(r: &mut impl Read) -> Result<Vec<Vec<bool>>> {
    let c = leer_cabecera(r)?;
    if c.forma != Forma::Binario {
        bail!("se esperaba un fragmento binario");
    }
    let bytes_por_vector = (c.dims as usize + 7) / 8;
    let mut fuera = Vec::with_capacity(c.cuenta as usize);
    let mut fila = vec![0u8; bytes_por_vector];
    for _ in 0..c.cuenta {
        r.read_exact(&mut fila)?;
        fuera.push(
            (0..c.dims as usize).map(|i| fila[i / 8] & (1 << (7 - (i % 8))) != 0).collect(),
        );
    }
    Ok(fuera)
}
```

En `crates/lumi-index/src/lib.rs`, añadir:

```rust
pub mod vectors;
```

- [ ] **Step 4: Ejecutarlo y ver que pasa**

Run: `cargo test -p lumi-index`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add crates/lumi-index
git commit -m "Vectores cuantizados, y el orden como unico hilo con su imagen"
```

---

### Task 5: Leer un paquete legacy de la v1

**Files:**
- Create: `crates/lumi-index/src/legacy.rs`
- Modify: `crates/lumi-index/src/lib.rs`
- Modify: `crates/lumi-index/Cargo.toml`
- Modify: `Cargo.toml` (raíz, `[workspace.dependencies]`)

**Interfaces:**
- Consumes: nada de tareas anteriores.
- Produces: `lumi_index::legacy::{CLAVE_COMPARTIDA, Topes, descifrar, nombre_seguro, validar_manifiesto, ManifiestoV1, ImagenV1, ModeloV1}`. `descifrar(&[u8]) -> Result<Vec<u8>>` acepta `iv || authTag || ciphertext`. `validar_manifiesto(&[u8]) -> Result<ManifiestoV1>`.

- [ ] **Step 1: Añadir las dependencias**

En `[workspace.dependencies]` de `Cargo.toml` (raíz):

```toml
aes-gcm = "0.10"
base64 = "0.22"
zip = { version = "2", default-features = false, features = ["deflate"] }
```

En `crates/lumi-index/Cargo.toml`, bajo `[dependencies]`:

```toml
aes-gcm = { workspace = true }
base64 = { workspace = true }
zip = { workspace = true }
```

- [ ] **Step 2: Escribir el test que falla**

Al final de `crates/lumi-index/src/legacy.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use aes_gcm::aead::{Aead, KeyInit, Payload};
    use aes_gcm::{Aes256Gcm, Nonce};

    /// Cifra igual que lo hacía la v1: `iv || authTag || ciphertext`, con el
    /// authTag SEPARADO del texto cifrado. `aes-gcm` lo devuelve pegado al
    /// final, así que hay que moverlo.
    fn cifrar_como_la_v1(claro: &[u8]) -> Vec<u8> {
        let cifra = Aes256Gcm::new_from_slice(&CLAVE_COMPARTIDA).unwrap();
        let iv = [7u8; 12];
        let mut ct = cifra.encrypt(Nonce::from_slice(&iv), Payload { msg: claro, aad: b"" }).unwrap();
        let tag = ct.split_off(ct.len() - 16);
        let mut fuera = iv.to_vec();
        fuera.extend_from_slice(&tag);
        fuera.extend_from_slice(&ct);
        fuera
    }

    #[test]
    fn el_paquete_legacy_se_descifra_y_su_manifiesto_no_se_traga_nada() {
        // Descifrado de ida y vuelta contra el formato real de la v1.
        let claro = br#"{"hola":"mundo"}"#;
        let vuelta = descifrar(&cifrar_como_la_v1(claro)).unwrap();
        assert_eq!(vuelta, claro);
        // Un authTag tocado tiene que fallar, no devolver basura.
        let mut roto = cifrar_como_la_v1(claro);
        roto[13] ^= 0xff;
        assert!(descifrar(&roto).is_err());

        // Nombres: la v1 tenía aquí una escritura de fichero arbitraria.
        // Confirmado en su código: hay panoIds reales que ACABAN en punto, así
        // que el punto suelto se acepta y lo que se rechaza es `..`.
        assert!(nombre_seguro("CAoSFkNJSE0wb2dLRUlDQWdJQ3N6SXI5QkE."));
        assert!(nombre_seguro("a-b_c.1"));
        assert!(!nombre_seguro("../../etc/passwd"));
        assert!(!nombre_seguro("a..b"));
        assert!(!nombre_seguro("a/b"));
        assert!(!nombre_seguro("a\\b"));
        assert!(!nombre_seguro(""));

        // Manifiesto bueno.
        let bueno = br#"{
          "version": 2, "exportedAt": "2026-07-28T11:04:00Z",
          "models": [{"id":"lumi-2","version":"1.0","embeddingDim":4}],
          "areas": [{"geometryWkt":"POLYGON((0 0,1 0,1 1,0 0))","images":[
            {"panoId":"pano1","heading":90,"lat":43.36,"lng":-8.41,
             "embeddings":{"lumi-2":[0.1,0.2,0.3,0.4]},"hasFile":true}
          ],"points":[]}]
        }"#;
        let m = validar_manifiesto(bueno).unwrap();
        assert_eq!(m.models[0].embedding_dim, 4);
        assert_eq!(m.areas[0].images[0].pano_id, "pano1");

        // Y todo lo que tiene que rechazar, uno por uno.
        for (que, json) in [
            ("panoId con traversal", &br#"{"version":2,"exportedAt":"x","models":[{"id":"m","version":"1","embeddingDim":2}],"areas":[{"geometryWkt":"P","images":[{"panoId":"../x","heading":0,"lat":0,"lng":0,"embeddings":{},"hasFile":true}],"points":[]}]}"#[..]),
            ("dimensión que no cuadra", &br#"{"version":2,"exportedAt":"x","models":[{"id":"m","version":"1","embeddingDim":2}],"areas":[{"geometryWkt":"P","images":[{"panoId":"p","heading":0,"lat":0,"lng":0,"embeddings":{"m":[1,2,3]},"hasFile":true}],"points":[]}]}"#[..]),
            ("modelo desconocido", &br#"{"version":2,"exportedAt":"x","models":[{"id":"m","version":"1","embeddingDim":2}],"areas":[{"geometryWkt":"P","images":[{"panoId":"p","heading":0,"lat":0,"lng":0,"embeddings":{"otro":[1,2]},"hasFile":true}],"points":[]}]}"#[..]),
            ("sin modelos", &br#"{"version":2,"exportedAt":"x","models":[],"areas":[]}"#[..]),
            ("latitud imposible", &br#"{"version":2,"exportedAt":"x","models":[{"id":"m","version":"1","embeddingDim":2}],"areas":[{"geometryWkt":"P","images":[{"panoId":"p","heading":0,"lat":91,"lng":0,"embeddings":{},"hasFile":true}],"points":[]}]}"#[..]),
            ("no es json", &b"esto no es json"[..]),
        ] {
            assert!(validar_manifiesto(json).is_err(), "debería rechazarse: {que}");
        }

        // Los topes se miran ANTES de descomprimir, sobre lo declarado.
        let t = Topes::por_defecto();
        assert!(t.comprueba(4_000_000_000, 1_000, 500_000_000).is_err(), "descomprimido pasado");
        assert!(t.comprueba(1_000_000, 999_999_999, 500_000).is_err(), "demasiados ficheros");
        assert!(t.comprueba(1_000_000, 10, 500_000).is_ok());
    }
}
```

- [ ] **Step 3: Ejecutarlo y ver que falla**

Run: `cargo test -p lumi-index el_paquete_legacy_se_descifra`
Expected: FAIL — el módulo `legacy` no existe.

- [ ] **Step 4: Implementar la lectura del legacy**

Al principio de `crates/lumi-index/src/legacy.rs`:

```rust
//! Leer un paquete cifrado del catálogo de datasets de la v1.
//!
//! Formato: assets `bundle.zip.enc` y `metadata.json.enc` de una release de
//! GitHub, AES-256-GCM con `iv || authTag || ciphertext` y una clave de 32
//! bytes incrustada en la aplicación.
//!
//! Esa clave es OFUSCACIÓN frente a quien navegue el repositorio sin la
//! aplicación, NO un límite de seguridad: es extraíble de un proyecto de
//! código abierto por cualquiera que mire. El límite real de confianza es la
//! validación de este módulo. Un paquete descifrado no es un paquete de
//! confianza.

use std::collections::HashMap;

use aes_gcm::aead::{Aead, KeyInit, Payload};
use aes_gcm::{Aes256Gcm, Nonce};
use anyhow::{bail, Context, Result};
use base64::Engine;
use serde::Deserialize;

/// La misma clave que `apps/web/lib/datasets/shared-key.ts` de la v1. Sin ella
/// no se puede abrir nada de lo ya publicado.
pub const CLAVE_COMPARTIDA: [u8; 32] = {
    // Escrita en bytes y no decodificada en tiempo de ejecución para que un
    // fallo de base64 no sea un error de arranque.
    // base64: 8GV57JbzQxrFNF3G/yEyxJ6dsFAZ2GiIHbxe6rK216w=
    [
        0xf0, 0x65, 0x79, 0xec, 0x96, 0xf3, 0x43, 0x1a, 0xc5, 0x34, 0x5d, 0xc6, 0xfe, 0x21, 0x32,
        0xc4, 0x9e, 0x9d, 0xb0, 0x50, 0x19, 0xd8, 0x68, 0x88, 0x1d, 0xbc, 0x5e, 0xea, 0xb2, 0xb6,
        0xd7, 0xac,
    ]
};

/// Comprobación de que la constante de arriba es la clave de la v1. Si alguien
/// la toca, esto lo dice en el mismo `cargo test` y no en producción.
#[test]
fn la_clave_es_la_de_la_v1() {
    let esperada = base64::engine::general_purpose::STANDARD
        .decode("8GV57JbzQxrFNF3G/yEyxJ6dsFAZ2GiIHbxe6rK216w=")
        .unwrap();
    assert_eq!(CLAVE_COMPARTIDA.to_vec(), esperada);
}

const IV_BYTES: usize = 12;
const TAG_BYTES: usize = 16;

/// `iv || authTag || ciphertext`. El authTag va SEPARADO, delante del texto
/// cifrado, que es como lo dejaba `crypto.ts` de la v1; `aes-gcm` lo espera
/// pegado al final, de ahí el reensamblado.
pub fn descifrar(bytes: &[u8]) -> Result<Vec<u8>> {
    if bytes.len() < IV_BYTES + TAG_BYTES {
        bail!("el paquete es más corto que su propia cabecera");
    }
    let iv = &bytes[..IV_BYTES];
    let tag = &bytes[IV_BYTES..IV_BYTES + TAG_BYTES];
    let ct = &bytes[IV_BYTES + TAG_BYTES..];
    let mut pegado = Vec::with_capacity(ct.len() + TAG_BYTES);
    pegado.extend_from_slice(ct);
    pegado.extend_from_slice(tag);

    let cifra = Aes256Gcm::new_from_slice(&CLAVE_COMPARTIDA)?;
    cifra
        .decrypt(Nonce::from_slice(iv), Payload { msg: &pegado, aad: b"" })
        .map_err(|_| anyhow::anyhow!("el authTag no cuadra: el paquete está corrupto o no es de Lumi"))
}

/// Todo nombre que acabe formando una ruta pasa por aquí.
///
/// No se usa una expresión regular con anticipación negativa porque el crate
/// `regex` no las soporta; la comprobación es la misma en dos pasos. El punto
/// suelto se acepta a propósito: hay panoIds reales de Google que terminan en
/// punto, y confirmado en la v1 que rechazarlos rompía paquetes publicados. Lo
/// que se rechaza es `..`, que es lo que de verdad sube por el árbol.
pub fn nombre_seguro(n: &str) -> bool {
    !n.is_empty()
        && !n.contains("..")
        && n.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '.'))
}

/// Topes que se comprueban ANTES de descomprimir, sobre lo que el zip declara
/// en su directorio central. Es la defensa contra una bomba de descompresión:
/// mirarlos después ya sería tarde.
pub struct Topes {
    pub comprimido_max: u64,
    pub descomprimido_max: u64,
    pub ficheros_max: u64,
}

impl Topes {
    pub fn por_defecto() -> Self {
        // 32 GB descomprimido es una ciudad grande con holgura; un millón de
        // ficheros, muchísimo más de lo que produce cualquier área real.
        Self { comprimido_max: 8 << 30, descomprimido_max: 32 << 30, ficheros_max: 1_000_000 }
    }

    pub fn comprueba(&self, comprimido: u64, ficheros: u64, descomprimido: u64) -> Result<()> {
        if comprimido > self.comprimido_max {
            bail!("el paquete comprimido son {comprimido} bytes, por encima del tope");
        }
        if descomprimido > self.descomprimido_max {
            bail!("descomprimido serían {descomprimido} bytes, por encima del tope");
        }
        if ficheros > self.ficheros_max {
            bail!("el paquete declara {ficheros} ficheros, por encima del tope");
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct ModeloV1 {
    pub id: String,
    pub version: String,
    #[serde(rename = "embeddingDim")]
    pub embedding_dim: u32,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ImagenV1 {
    #[serde(rename = "panoId")]
    pub pano_id: String,
    pub heading: i32,
    pub lat: f64,
    pub lng: f64,
    #[serde(rename = "streetViewDate")]
    #[serde(default)]
    pub street_view_date: Option<String>,
    #[serde(default)]
    pub embeddings: HashMap<String, Option<Vec<f32>>>,
    #[serde(rename = "hasFile")]
    #[serde(default)]
    pub has_file: bool,
}

#[derive(Debug, Clone, Deserialize)]
pub struct AreaV1 {
    #[serde(default)]
    pub name: Option<String>,
    #[serde(rename = "geometryWkt")]
    pub geometry_wkt: String,
    pub images: Vec<ImagenV1>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ManifiestoV1 {
    pub version: u32,
    #[serde(rename = "exportedAt")]
    pub exported_at: String,
    pub models: Vec<ModeloV1>,
    pub areas: Vec<AreaV1>,
}

/// Valida el manifiesto descifrado campo a campo. La v1 hacía aquí un cast
/// suelto y por eso necesitó esta función después.
///
/// Lo que se comprueba y por qué:
/// - `models` no vacío y con dimensión positiva: sin eso no se sabe qué mide
///   ningún vector.
/// - cada clave de `embeddings` es un modelo DECLARADO: un bundle malicioso
///   podría anunciar un modelo compatible y traer datos de otro espacio.
/// - la longitud de cada vector cuadra con la dimensión declarada: si
///   coincidiera por casualidad, corrompería el índice en silencio.
/// - `panoId` pasa `nombre_seguro`: acaba siendo una ruta.
/// - lat/lng dentro de rango: un NaN o una latitud de 300 llegan hasta el mapa.
pub fn validar_manifiesto(bytes: &[u8]) -> Result<ManifiestoV1> {
    let m: ManifiestoV1 =
        serde_json::from_slice(bytes).context("el manifiesto no es un JSON con la forma esperada")?;

    if m.models.is_empty() {
        bail!("el manifiesto no declara ningún modelo");
    }
    let mut dims = HashMap::new();
    for (i, modelo) in m.models.iter().enumerate() {
        if modelo.id.is_empty() || modelo.version.is_empty() {
            bail!("models[{i}] tiene id o versión vacíos");
        }
        if modelo.embedding_dim == 0 {
            bail!("models[{i}].embeddingDim tiene que ser positivo");
        }
        dims.insert(modelo.id.clone(), modelo.embedding_dim as usize);
    }

    for (a, area) in m.areas.iter().enumerate() {
        for (i, img) in area.images.iter().enumerate() {
            if !nombre_seguro(&img.pano_id) {
                bail!("areas[{a}].images[{i}].panoId no es un nombre admisible");
            }
            if !(-90.0..=90.0).contains(&img.lat) {
                bail!("areas[{a}].images[{i}].lat no está entre -90 y 90");
            }
            if !(-180.0..=180.0).contains(&img.lng) {
                bail!("areas[{a}].images[{i}].lng no está entre -180 y 180");
            }
            for (modelo, v) in &img.embeddings {
                let Some(d) = dims.get(modelo) else {
                    bail!("areas[{a}].images[{i}] trae embedding de un modelo no declarado: {modelo}");
                };
                if let Some(v) = v {
                    if v.len() != *d {
                        bail!(
                            "areas[{a}].images[{i}].embeddings[{modelo}] mide {} y debería medir {d}",
                            v.len()
                        );
                    }
                }
            }
        }
    }
    Ok(m)
}
```

En `crates/lumi-index/src/lib.rs`, añadir:

```rust
pub mod legacy;
```

- [ ] **Step 5: Ejecutarlo y ver que pasa**

Run: `cargo test -p lumi-index`
Expected: PASS, 6 tests (los cinco anteriores más `la_clave_es_la_de_la_v1`).

- [ ] **Step 6: Commit**

```bash
git add Cargo.toml crates/lumi-index
git commit -m "Abrir un paquete de la v1 sin creerse nada de lo que trae"
```

---

### Task 6: El contrato de embebido y el trabajador de referencia

**Files:**
- Create: `crates/lumi-index/src/embed.rs`
- Create: `workers/lumi_embed.py`
- Modify: `crates/lumi-index/src/lib.rs`

**Interfaces:**
- Consumes: nada de tareas anteriores.
- Produces: `lumi_index::embed::{Lote, MsgEmbed}` y `MsgEmbed::validar(&self) -> Result<(), &'static str>`. El trabajador de referencia vive en `workers/lumi_embed.py` y lee `LUMI_DEVICE` y `LUMI_FAKE_LOAD_S`.

- [ ] **Step 1: Escribir el test que falla**

Al final de `crates/lumi-index/src/embed.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn el_contrato_de_embebido_aguanta_basura_y_cuadra_sus_cuentas() {
        assert!(serde_json::from_str::<MsgEmbed>("esto no es json").is_err());
        assert!(serde_json::from_str::<MsgEmbed>(r#"{"tipo":"inventado"}"#).is_err());

        let l: MsgEmbed =
            serde_json::from_str(r#"{"tipo":"listo","dispositivo":"cuda:0","modelo":null}"#).unwrap();
        assert_eq!(l, MsgEmbed::Listo { dispositivo: "cuda:0".into(), modelo: None });

        // El caso que importa: la cuenta declarada tiene que cuadrar con la
        // lista de imágenes, porque es lo único que ata cada fila del fichero
        // de vectores a su imagen. Si no cuadra, cada vector quedaría pegado a
        // la imagen equivocada y nadie se enteraría nunca.
        let bueno = MsgEmbed::Vectores {
            id: 4,
            dims: 12288,
            cuenta: 2,
            fichero: "/tmp/lote-4.f32".into(),
            imagenes: vec!["/a.jpg".into(), "/b.jpg".into()],
        };
        assert!(bueno.validar().is_ok());

        let descuadrado = MsgEmbed::Vectores {
            id: 4,
            dims: 12288,
            cuenta: 3,
            fichero: "/tmp/lote-4.f32".into(),
            imagenes: vec!["/a.jpg".into(), "/b.jpg".into()],
        };
        assert!(descuadrado.validar().is_err());

        let sin_dims = MsgEmbed::Vectores {
            id: 4,
            dims: 0,
            cuenta: 0,
            fichero: "/tmp/x".into(),
            imagenes: vec![],
        };
        assert!(sin_dims.validar().is_err());

        // Una imagen saltada es un RESULTADO, no una avería: pasa la
        // validación y no se reintenta.
        let s = MsgEmbed::Saltada { id: 4, ruta: "/c.jpg".into(), motivo: "sin coordenadas".into() };
        assert!(s.validar().is_ok());

        let lote = Lote::nuevo(7, "lumi-2".into(), vec!["/a.jpg".into()]);
        let s = serde_json::to_string(&lote).unwrap();
        assert!(s.contains(r#""tipo":"lote""#), "{s}");
        assert_eq!(serde_json::from_str::<Lote>(&s).unwrap(), lote);
    }
}
```

- [ ] **Step 2: Ejecutarlo y ver que falla**

Run: `cargo test -p lumi-index el_contrato_de_embebido`
Expected: FAIL — el módulo `embed` no existe.

- [ ] **Step 3: Implementar el contrato**

Al principio de `crates/lumi-index/src/embed.rs`:

```rust
//! El contrato con el trabajador de embebido: JSON por líneas sobre las
//! tuberías estándar de un proceso hijo.
//!
//! No reutiliza `lumi_proto::worker`. Aquel contrato es «una imagen, dame una
//! coordenada»; este es «este lote de imágenes, dame sus vectores». Forzar los
//! dos por el mismo enum daría un tipo con la mitad de los campos siempre a
//! `None`.
//!
//! Los VECTORES NO VIAJAN POR LA TUBERÍA. Un lote de 32 imágenes con lumi-2
//! son 32 × 12288 flotantes, y en JSON eso son megabytes por línea para algo
//! que se va a escribir a disco de todas formas. El trabajador los escribe en
//! un fichero temporal y contesta con su ruta más el orden de las imágenes; la
//! línea de JSON se queda en unos cientos de bytes.

use serde::{Deserialize, Serialize};

/// Lo que la aplicación manda por `stdin`, una línea por lote.
///
/// Las imágenes viajan como RUTAS y no como bytes: el trabajador corre como el
/// mismo usuario en la misma máquina.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Lote {
    /// Siempre `"lote"`. Va explícito para que añadir órdenes nuevas no rompa
    /// a un trabajador que solo entiende esta.
    pub tipo: String,
    pub id: i64,
    pub modelo: String,
    pub imagenes: Vec<String>,
}

impl Lote {
    pub fn nuevo(id: i64, modelo: String, imagenes: Vec<String>) -> Self {
        Self { tipo: "lote".into(), id, modelo, imagenes }
    }
}

/// Lo que el trabajador contesta por `stdout`. Su `stderr` es el log y no
/// tiene contrato: se guarda tal cual.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "tipo", rename_all = "lowercase")]
pub enum MsgEmbed {
    /// Obligatorio al arrancar, con `modelo: None`, y otra vez cada vez que
    /// cambia de modelo. Sin esta línea, «está cargando pesos» y «se ha
    /// colgado» se ven exactamente igual.
    Listo { dispositivo: String, modelo: Option<String> },
    /// Cuantos quiera. No se persiste: va a Redis y se olvida.
    Progreso { id: i64, hechas: u32, total: u32 },
    /// Los vectores de un lote, en un fichero de float32 crudo. `imagenes` va
    /// EN EL MISMO ORDEN que las filas del fichero: es lo único que ata cada
    /// vector a su imagen.
    Vectores { id: i64, dims: u32, cuenta: u32, fichero: String, imagenes: Vec<String> },
    /// Una imagen que no se puede embeber. Es un RESULTADO, no una avería: se
    /// anota el motivo, se salta y se sigue. No se reintenta, porque
    /// reintentarla solo quema GPU.
    Saltada { id: i64, ruta: String, motivo: String },
    /// El lote entero no se pudo hacer. Tampoco es una avería del proceso: el
    /// trabajador sigue vivo esperando el siguiente.
    Fallo { id: i64, motivo: String },
}

impl MsgEmbed {
    /// Al trabajador se le cree el log, no los datos.
    pub fn validar(&self) -> Result<(), &'static str> {
        let MsgEmbed::Vectores { dims, cuenta, fichero, imagenes, .. } = self else {
            return Ok(());
        };
        if *dims == 0 {
            return Err("un vector de cero dimensiones no es un vector");
        }
        if fichero.is_empty() {
            return Err("no dice dónde dejó los vectores");
        }
        if *cuenta as usize != imagenes.len() {
            return Err("la cuenta de vectores no cuadra con la lista de imágenes");
        }
        Ok(())
    }
}
```

En `crates/lumi-index/src/lib.rs`, añadir:

```rust
pub mod embed;
```

- [ ] **Step 4: Escribir el trabajador de referencia**

`workers/lumi_embed.py`:

```python
#!/usr/bin/env python3
"""Trabajador de referencia de embebido del Lumi Indexer.

No embebe nada: devuelve vectores deterministas derivados de la ruta. Existe
para que el contrato sea ejecutable y no solo un documento — la unica forma de
saber si una frontera aguanta es cruzarla.

El subsistema 7b y el 5 sustituyen `_cargar` y `_embeber` por la carga de pesos
y la inferencia de verdad. No deberia hacer falta tocar nada mas de este
archivo, y nada en absoluto de la aplicacion.

Protocolo: una linea de JSON por mensaje. Entra por stdin, sale por stdout, el
log va por stderr. Los VECTORES NO SALEN POR STDOUT: se escriben en un fichero
temporal de float32 crudo y se contesta con su ruta. Sin dependencias.
"""
import hashlib
import json
import os
import struct
import sys
import tempfile
import time

DISPOSITIVO = os.environ.get("LUMI_DEVICE", "cpu")
CARGA_S = float(os.environ.get("LUMI_FAKE_LOAD_S", "0"))
# Dimensiones de mentira, pequenas a proposito: el contrato no depende del
# tamano y un fichero de 12288 flotantes por imagen no aporta nada a la prueba.
DIMS = int(os.environ.get("LUMI_FAKE_DIMS", "64"))

_modelo = None


def _decir(msg):
    sys.stdout.write(json.dumps(msg, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def _log(txt):
    sys.stderr.write(txt + "\n")
    sys.stderr.flush()


def _cargar(modelo):
    """El subsistema 5 sustituye esto por la carga real de pesos."""
    global _modelo
    if _modelo == modelo:
        return
    _log("cargando modelo %s en %s" % (modelo, DISPOSITIVO))
    time.sleep(CARGA_S)
    _modelo = modelo
    _decir({"tipo": "listo", "dispositivo": DISPOSITIVO, "modelo": _modelo})


def _vector(ruta):
    """El subsistema 5 sustituye esto por la inferencia real.

    Determinista a partir de la ruta y normalizado a L2, que es la precondicion
    del formato de fragmento: sin ella la escala fija de int8 no vale.
    """
    semilla = hashlib.sha256(ruta.encode("utf-8")).digest()
    crudo = [((semilla[i % len(semilla)] / 255.0) - 0.5) for i in range(DIMS)]
    norma = sum(x * x for x in crudo) ** 0.5
    return [x / norma for x in crudo] if norma > 0 else crudo


def _embeber(job):
    rutas, saltadas = [], []
    for ruta in job["imagenes"]:
        if not os.path.exists(ruta):
            saltadas.append((ruta, "no existe el fichero"))
            continue
        if os.path.getsize(ruta) == 0:
            saltadas.append((ruta, "el fichero esta vacio"))
            continue
        rutas.append(ruta)

    for ruta, motivo in saltadas:
        _decir({"tipo": "saltada", "id": job["id"], "ruta": ruta, "motivo": motivo})

    if not rutas:
        return None

    fd, destino = tempfile.mkstemp(prefix="lumi-lote-%d-" % job["id"], suffix=".f32")
    with os.fdopen(fd, "wb") as f:
        for i, ruta in enumerate(rutas):
            f.write(struct.pack("<%df" % DIMS, *_vector(ruta)))
            if (i + 1) % 16 == 0:
                _decir({"tipo": "progreso", "id": job["id"],
                        "hechas": i + 1, "total": len(rutas)})
    return {"tipo": "vectores", "id": job["id"], "dims": DIMS,
            "cuenta": len(rutas), "fichero": destino, "imagenes": rutas}


def main():
    _decir({"tipo": "listo", "dispositivo": DISPOSITIVO, "modelo": None})
    for linea in sys.stdin:
        linea = linea.strip()
        if not linea:
            continue
        try:
            job = json.loads(linea)
        except ValueError:
            _log("linea ilegible, se ignora: %s" % linea[:120])
            continue
        if job.get("tipo") != "lote":
            _log("orden desconocida, se ignora: %s" % job.get("tipo"))
            continue
        try:
            _cargar(job["modelo"])
        except Exception as e:
            # No poder cargar el modelo es un fallo DE ESTE LOTE, no una averia
            # del trabajador: se contesta y se sigue vivo esperando el
            # siguiente, que puede pedir un modelo que si esta.
            _decir({"tipo": "fallo", "id": job["id"],
                    "motivo": "no se pudo cargar el modelo %s: %s" % (job["modelo"], e)})
            continue
        try:
            salida = _embeber(job)
            if salida is not None:
                _decir(salida)
            else:
                _decir({"tipo": "fallo", "id": job["id"],
                        "motivo": "ninguna imagen del lote era utilizable"})
        except Exception as e:
            _decir({"tipo": "fallo", "id": job["id"], "motivo": str(e)})


if __name__ == "__main__":
    main()
```

- [ ] **Step 5: Comprobar que el trabajador contesta**

Run:

```bash
printf '{"tipo":"lote","id":1,"modelo":"lumi-2","imagenes":["workers/lumi_embed.py"]}\n' | python3 -u workers/lumi_embed.py
```

Expected: tres líneas de JSON en `stdout` — un `listo` con `modelo` a `null`, otro `listo` con `"lumi-2"`, y un `vectores` con `"cuenta":1` y una ruta de fichero. En `stderr`, la línea `cargando modelo lumi-2 en cpu`.

- [ ] **Step 6: Ejecutar los tests del crate**

Run: `cargo test -p lumi-index`
Expected: PASS, 7 tests.

- [ ] **Step 7: Commit**

```bash
git add crates/lumi-index workers/lumi_embed.py
git commit -m "El contrato de embebido, con los vectores fuera de la tuberia"
```

---

### Task 7: El esqueleto de la aplicación

**Files:**
- Create: `indexer/package.json`, `indexer/index.html`, `indexer/vite.config.ts`, `indexer/tailwind.config.ts`, `indexer/postcss.config.js`, `indexer/tsconfig.json`, `indexer/tsconfig.app.json`, `indexer/tsconfig.node.json`
- Create: `indexer/src/main.tsx`, `indexer/src/App.tsx`, `indexer/src/index.css`
- Create: `indexer/src/ui/Icon.tsx`, `indexer/src/ui/PlanetBackground.tsx`, `indexer/src/ui/WindowFrame.tsx`, `indexer/src/ui/TitleBar.tsx`
- Create: `indexer/src-tauri/Cargo.toml`, `indexer/src-tauri/tauri.conf.json`, `indexer/src-tauri/build.rs`, `indexer/src-tauri/capabilities/default.json`, `indexer/src-tauri/src/main.rs`, `indexer/src-tauri/src/lib.rs`
- Modify: `tools/build.py`

**Interfaces:**
- Consumes: `lumi-index` (aún no se usa; se declara la dependencia).
- Produces: el comando Tauri `saludo() -> String` que devuelve la versión, y la app arrancable con `python tools/build.py indexer`.

- [ ] **Step 1: Copiar la configuración del cliente**

Copiar sin cambios desde `client/` a `indexer/`: `postcss.config.js`, `tsconfig.json`, `tsconfig.app.json`, `tsconfig.node.json`, `tailwind.config.ts`.

```bash
mkdir -p indexer/src/ui indexer/src/lib indexer/src-tauri/src indexer/src-tauri/capabilities
cp client/postcss.config.js client/tsconfig.json client/tsconfig.app.json \
   client/tsconfig.node.json client/tailwind.config.ts indexer/
```

`tailwind.config.ts` se copia **valor por valor**: los tokens son los mismos y no se introduce ninguno nuevo.

- [ ] **Step 2: Copiar los cuatro componentes de interfaz compartidos**

```bash
cp client/src/ui/Icon.tsx client/src/ui/PlanetBackground.tsx \
   client/src/ui/WindowFrame.tsx client/src/ui/TitleBar.tsx indexer/src/ui/
cp client/src/index.css indexer/src/
```

Después, en `indexer/src/ui/TitleBar.tsx`, cambiar el único literal que nombra el producto: sustituir `Lumi Station` por `Lumi Indexer`.

`Icon.tsx` necesita tres iconos que el Indexer usa y el cliente no. Añadirlos al objeto `PATHS`, respetando el patrón (`viewBox="0 0 24 24"`, trazo 1.6–2.0, sin librería):

```tsx
  territorio: (
    <>
      <path d="M9 3 3 5.5v15L9 18l6 3 6-2.5v-15L15 6z" />
      <path d="M9 3v15M15 6v15" />
    </>
  ),
  ingesta: (
    <>
      <path d="M12 15V3" />
      <path d="M7.5 10.5 12 15l4.5-4.5" />
      <path d="M4 18.5h16" />
    </>
  ),
  pin: (
    <>
      <path d="M12 21s7-5.5 7-11a7 7 0 1 0-14 0c0 5.5 7 11 7 11z" />
      <circle cx="12" cy="10" r="2.4" />
    </>
  ),
```

- [ ] **Step 3: Escribir el manifiesto de npm y el HTML**

`indexer/package.json`:

```json
{
  "name": "indexer",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "lint": "oxlint",
    "preview": "vite preview",
    "tauri": "tauri"
  },
  "dependencies": {
    "@fontsource/inter": "^5.3.0",
    "@tauri-apps/api": "^2.11.1",
    "@tauri-apps/plugin-dialog": "^2",
    "@types/mapbox-gl": "^3.4.1",
    "mapbox-gl": "^3.27.0",
    "react": "^19.2.8",
    "react-dom": "^19.2.8",
    "zustand": "^5.0.14"
  },
  "devDependencies": {
    "@tauri-apps/cli": "^2.11.4",
    "@types/node": "^24.13.3",
    "@types/react": "^19.2.17",
    "@types/react-dom": "^19.2.3",
    "@vitejs/plugin-react": "^6.0.4",
    "autoprefixer": "^10.5.4",
    "oxlint": "^1.75.0",
    "postcss": "^8.5.25",
    "tailwindcss": "^3.4.19",
    "typescript": "~6.0.2",
    "vite": "^8.2.0"
  }
}
```

`indexer/index.html`:

```html
<!doctype html>
<html lang="es">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Lumi Indexer</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`indexer/vite.config.ts`:

```ts
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Puerto fijo y distinto del cliente (5173), para poder tener los dos
// levantados a la vez durante el desarrollo.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: { port: 5273, strictPort: true },
});
```

- [ ] **Step 4: Escribir el lado Rust**

`indexer/src-tauri/Cargo.toml`:

```toml
[package]
name = "indexer-app"
version = "0.1.0"
description = "Lumi Indexer"
edition = "2021"
license = "AGPL-3.0-or-later"
rust-version = "1.77.2"

[lib]
name = "indexer_lib"
crate-type = ["staticlib", "cdylib", "rlib"]

[build-dependencies]
tauri-build = { version = "2.6.3", features = [] }

[dependencies]
tauri = { version = "2.11.3", features = [] }
tauri-plugin-dialog = "2"
tauri-plugin-log = "2"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
anyhow = "1"
log = "0.4"
tokio = { version = "1", features = ["full"] }
lumi-index = { path = "../../crates/lumi-index" }
```

`indexer/src-tauri/build.rs`:

```rust
fn main() {
    tauri_build::build()
}
```

`indexer/src-tauri/tauri.conf.json`:

```json
{
  "$schema": "../node_modules/@tauri-apps/cli/config.schema.json",
  "productName": "Lumi Indexer",
  "version": "0.1.0",
  "identifier": "org.fablableon.lumi.indexer",
  "build": {
    "frontendDist": "../dist",
    "devUrl": "http://localhost:5273",
    "beforeDevCommand": "npm run dev",
    "beforeBuildCommand": "npm run build"
  },
  "app": {
    "windows": [
      {
        "title": "Lumi Indexer",
        "width": 1280,
        "height": 820,
        "minWidth": 900,
        "minHeight": 640,
        "resizable": true,
        "fullscreen": false,
        "decorations": false,
        "transparent": false
      }
    ],
    "security": { "csp": null }
  },
  "bundle": {
    "active": true,
    "targets": "all",
    "icon": ["icons/32x32.png", "icons/128x128.png", "icons/icon.ico"]
  }
}
```

Copiar los iconos del cliente para que el empaquetado no falle:

```bash
cp -r client/src-tauri/icons indexer/src-tauri/icons
```

`indexer/src-tauri/capabilities/default.json`:

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "default",
  "description": "Permisos del Lumi Indexer",
  "windows": ["main"],
  "permissions": ["core:default", "dialog:default"]
}
```

`indexer/src-tauri/src/main.rs`:

```rust
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    indexer_lib::run();
}
```

`indexer/src-tauri/src/lib.rs`:

```rust
//! Lumi Indexer: la aplicación.
//!
//! Independiente de Lumi Station. No se vincula a ningún servidor, no tiene
//! cuentas ni sesiones: es una herramienta de un solo operador sobre su propia
//! máquina. Lo que produce son paquetes `.lumidx` sellados.

/// Versión y plataforma, que es lo primero que la interfaz necesita saber:
/// en Windows el aprovisionamiento tiene que avisar de que Redis va por WSL.
#[tauri::command]
fn saludo() -> serde_json::Value {
    serde_json::json!({
        "version": env!("CARGO_PKG_VERSION"),
        "so": std::env::consts::OS,
    })
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_log::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![saludo])
        .run(tauri::generate_context!())
        .expect("no se pudo arrancar el Lumi Indexer");
}
```

- [ ] **Step 5: Escribir el frontend mínimo**

`indexer/src/main.tsx`:

```tsx
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "./index.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

`indexer/src/App.tsx`:

```tsx
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";

import { PlanetBackground } from "./ui/PlanetBackground";
import { WindowFrame } from "./ui/WindowFrame";

interface Saludo { version: string; so: string }

export function App() {
  const [saludo, setSaludo] = useState<Saludo | null>(null);
  useEffect(() => { void invoke<Saludo>("saludo").then(setSaludo); }, []);

  return (
    <WindowFrame>
      <div className="relative h-full w-full overflow-hidden bg-bg">
        <PlanetBackground />
        <div className="relative z-10 flex h-full items-center justify-center">
          <div className="flex items-center gap-2.5" style={{ animation: "jg-fade-rise .7s both" }}>
            <span className="text-fg">✦</span>
            <span className="text-[17px] font-medium text-fg">Lumi Indexer</span>
            <span className="font-mono text-[9.5px] text-subtle">
              {saludo ? `v${saludo.version} · ${saludo.so}` : "…"}
            </span>
          </div>
        </div>
      </div>
    </WindowFrame>
  );
}
```

- [ ] **Step 6: Enseñarle a `tools/build.py` a arrancar el Indexer**

Sustituir el cuerpo de `main()` en `tools/build.py` por:

```python
def main():
    target = sys.argv[1] if len(sys.argv) > 1 else "dev"
    if target == "build":
        run(["cargo", "build", "--release"])
        run(["npm", "run", "tauri", "build"], cwd=ROOT / "client")
        run(["npm", "run", "tauri", "build"], cwd=ROOT / "indexer")
        return
    if target == "indexer":
        # El Indexer no habla con el daemon: es una app autónoma, así que aquí
        # no se levanta lumid. Levantarlo solo confundiría a quien mire los
        # logs buscando por qué el Indexer no se conecta a nada.
        run(["npm", "run", "tauri", "dev"], cwd=ROOT / "indexer")
        return
    env = {**os.environ, "LUMI_PORT": str(PORT), "LUMI_DATA": str(ROOT / ".dev-data")}
    daemon = subprocess.Popen(["cargo", "run", "-p", "lumid"], cwd=ROOT, env=env)
    try:
        run(["npm", "run", "tauri", "dev"], cwd=ROOT / "client")
    finally:
        daemon.terminate()
```

Y actualizar el docstring del módulo:

```python
"""Dev: arranca lumid y el cliente Tauri, o el Indexer por separado.

  python tools/build.py            lumid en el puerto fijo + cliente
  python tools/build.py indexer    solo el Indexer (no necesita daemon)
  python tools/build.py build      empaqueta los dos
"""
```

- [ ] **Step 7: Comprobar que arranca**

Run:

```bash
cd indexer && npm install && npm run build
```

Expected: `tsc -b` sin errores y `vite build` escribiendo en `indexer/dist`.

Run: `cargo check --manifest-path indexer/src-tauri/Cargo.toml`
Expected: compila sin errores.

- [ ] **Step 8: Commit**

```bash
git add indexer tools/build.py
git commit -m "La ventana del Indexer, con la gramatica visual que ya existe"
```

---

### Task 8: SQLite y la clave maestra local

**Files:**
- Create: `indexer/src-tauri/src/store.rs`
- Create: `indexer/src-tauri/src/crypto.rs`
- Modify: `indexer/src-tauri/src/lib.rs`
- Modify: `indexer/src-tauri/Cargo.toml`

**Interfaces:**
- Consumes: nada.
- Produces: `Almacen::abrir(&Path) -> Result<Almacen>` con el esquema aplicado; `Almacen::crear_indice`, `Almacen::indices`, `Almacen::crear_lote`, `Almacen::insertar_imagen`, `Almacen::filas_procedencia(indice_id) -> Vec<lumi_index::manifest::FilaImagen>`, `Almacen::teselas_trabajo(indice_id) -> Vec<(String, TrabajoDe)>`. `Maestra::abrir_o_crear(&Path)` con `sellar`/`abrir`.

- [ ] **Step 1: Añadir las dependencias**

En `indexer/src-tauri/Cargo.toml`, bajo `[dependencies]`:

```toml
rusqlite = { version = "0.32", features = ["bundled"] }
chacha20poly1305 = "0.10"
rand = "0.8"
```

- [ ] **Step 2: Escribir el esquema y el almacén**

`indexer/src-tauri/src/store.rs`:

```rust
//! SQLite: la verdad.
//!
//! Redis lleva la cola y el estado caliente, pero lo que tiene que sobrevivir a
//! un corte de luz a mitad de una indexación de días está aquí. Si Redis se
//! vacía, la cola se reconstruye leyendo qué imágenes siguen sin vector.

use std::path::Path;
use std::sync::Mutex;

use anyhow::Result;
use lumi_index::manifest::{FilaImagen, Tipo, TrabajoDe};
use rusqlite::{params, Connection};

const ESQUEMA: &str = "
CREATE TABLE IF NOT EXISTS indices (
    id         INTEGER PRIMARY KEY,
    nombre     TEXT NOT NULL,
    slug       TEXT NOT NULL UNIQUE,
    estado     TEXT NOT NULL CHECK (estado IN ('abierto','sellado')),
    ruta       TEXT,
    creado_en  INTEGER NOT NULL,
    sellado_en INTEGER
);

-- Una fila por cada vez que entra material. Cada imagen apunta a su lote, y
-- eso ES la cadena de custodia: no hace falta un campo «cómo llegó esto aquí»,
-- es la fila padre.
CREATE TABLE IF NOT EXISTS lotes (
    id         INTEGER PRIMARY KEY,
    indice_id  INTEGER NOT NULL,
    clase      TEXT NOT NULL CHECK (clase IN ('legacy','carpeta','herencia')),
    origen     TEXT NOT NULL,
    tipo       TEXT CHECK (tipo IN ('calle','cenital','suelta')),
    -- 'desconocida' es un valor como cualquier otro y sale en los porcentajes.
    fuente     TEXT NOT NULL,
    licencia   TEXT,
    atribucion TEXT,
    -- Si la procedencia la dijo el material o la declaró el operador. Un
    -- paquete legacy no la trae, así que la diferencia importa.
    declarada_por_operador INTEGER NOT NULL DEFAULT 0,
    estado     TEXT NOT NULL CHECK (estado IN ('pendiente','en_curso','hecho','error')),
    error      TEXT,
    reintentos INTEGER NOT NULL DEFAULT 0,
    version_indexer TEXT NOT NULL,
    creado_en  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS imagenes (
    id         INTEGER PRIMARY KEY,
    indice_id  INTEGER NOT NULL,
    lote_id    INTEGER NOT NULL,
    ruta       TEXT NOT NULL,
    sha256     TEXT NOT NULL,
    lat        REAL NOT NULL,
    lng        REAL NOT NULL,
    quadkey    TEXT NOT NULL,
    capturada_en TEXT,
    ancho      INTEGER,
    alto       INTEGER,
    -- Motivo por el que se saltó. Es un RESULTADO, no una avería: se anota y
    -- no se reintenta.
    saltada_motivo TEXT,
    creada_en  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS vectores (
    imagen_id INTEGER NOT NULL,
    modelo    TEXT NOT NULL,
    estado    TEXT NOT NULL CHECK (estado IN ('pendiente','hecho','fallo')),
    PRIMARY KEY (imagen_id, modelo)
);

-- Procedencia DEL TRABAJO: quién pagó la descarga y la GPU de cada tesela.
-- Suma 100 % porque una tesela la indexó exactamente uno.
CREATE TABLE IF NOT EXISTS teselas (
    indice_id INTEGER NOT NULL,
    quadkey   TEXT NOT NULL,
    trabajo   TEXT NOT NULL CHECK (trabajo IN ('aqui','local','catalogo')),
    fuente_indice TEXT,
    sha256    TEXT,
    PRIMARY KEY (indice_id, quadkey)
);

CREATE TABLE IF NOT EXISTS ajustes (
    clave  TEXT PRIMARY KEY,
    valor  TEXT,
    sellado BLOB
);

CREATE INDEX IF NOT EXISTS imagenes_por_indice ON imagenes(indice_id);
CREATE INDEX IF NOT EXISTS imagenes_por_quadkey ON imagenes(indice_id, quadkey);
CREATE INDEX IF NOT EXISTS lotes_por_indice ON lotes(indice_id);
CREATE INDEX IF NOT EXISTS vectores_pendientes ON vectores(modelo) WHERE estado = 'pendiente';
";

pub struct Almacen(Mutex<Connection>);

impl Almacen {
    pub fn abrir(dir: &Path) -> Result<Self> {
        std::fs::create_dir_all(dir)?;
        let c = Connection::open(dir.join("indexer.db"))?;
        // WAL: lectores concurrentes junto a un escritor. El volumen de
        // escritura aquí es estado de lote, no una carga transaccional.
        c.execute_batch(
            "PRAGMA journal_mode = WAL;
             PRAGMA busy_timeout = 5000;
             PRAGMA synchronous = NORMAL;",
        )?;
        c.execute_batch(ESQUEMA)?;
        Ok(Self(Mutex::new(c)))
    }

    fn ahora() -> i64 {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0)
    }

    pub fn crear_indice(&self, nombre: &str, slug: &str) -> Result<i64> {
        let c = self.0.lock().unwrap();
        c.execute(
            "INSERT INTO indices (nombre, slug, estado, creado_en) VALUES (?1, ?2, 'abierto', ?3)",
            params![nombre, slug, Self::ahora()],
        )?;
        Ok(c.last_insert_rowid())
    }

    pub fn crear_lote(
        &self,
        indice_id: i64,
        clase: &str,
        origen: &str,
        tipo: Option<&str>,
        fuente: &str,
        licencia: Option<&str>,
        atribucion: Option<&str>,
        declarada_por_operador: bool,
    ) -> Result<i64> {
        let c = self.0.lock().unwrap();
        c.execute(
            "INSERT INTO lotes
               (indice_id, clase, origen, tipo, fuente, licencia, atribucion,
                declarada_por_operador, estado, version_indexer, creado_en)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'pendiente', ?9, ?10)",
            params![
                indice_id,
                clase,
                origen,
                tipo,
                fuente,
                licencia,
                atribucion,
                declarada_por_operador as i32,
                env!("CARGO_PKG_VERSION"),
                Self::ahora()
            ],
        )?;
        Ok(c.last_insert_rowid())
    }

    #[allow(clippy::too_many_arguments)]
    pub fn insertar_imagen(
        &self,
        indice_id: i64,
        lote_id: i64,
        ruta: &str,
        sha256: &str,
        lat: f64,
        lng: f64,
        quadkey: &str,
        modelos_pendientes: &[String],
    ) -> Result<i64> {
        let c = self.0.lock().unwrap();
        c.execute(
            "INSERT INTO imagenes (indice_id, lote_id, ruta, sha256, lat, lng, quadkey, creada_en)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![indice_id, lote_id, ruta, sha256, lat, lng, quadkey, Self::ahora()],
        )?;
        let id = c.last_insert_rowid();
        for m in modelos_pendientes {
            c.execute(
                "INSERT OR IGNORE INTO vectores (imagen_id, modelo, estado)
                 VALUES (?1, ?2, 'pendiente')",
                params![id, m],
            )?;
        }
        Ok(id)
    }

    pub fn marcar_saltada(&self, imagen_id: i64, motivo: &str) -> Result<()> {
        let c = self.0.lock().unwrap();
        c.execute(
            "UPDATE imagenes SET saltada_motivo = ?2 WHERE id = ?1",
            params![imagen_id, motivo],
        )?;
        Ok(())
    }

    /// Lo que la procedencia de imágenes necesita, y nada más. Las saltadas no
    /// cuentan: no forman parte del índice.
    pub fn filas_procedencia(&self, indice_id: i64) -> Result<Vec<FilaImagen>> {
        let c = self.0.lock().unwrap();
        let mut q = c.prepare(
            "SELECT l.tipo, l.fuente, i.quadkey
               FROM imagenes i JOIN lotes l ON l.id = i.lote_id
              WHERE i.indice_id = ?1 AND i.saltada_motivo IS NULL",
        )?;
        let filas = q
            .query_map(params![indice_id], |r| {
                let tipo: Option<String> = r.get(0)?;
                Ok(FilaImagen {
                    tipo: match tipo.as_deref() {
                        Some("cenital") => Tipo::Cenital,
                        Some("suelta") => Tipo::Suelta,
                        _ => Tipo::Calle,
                    },
                    fuente: r.get(1)?,
                    quadkey: r.get(2)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(filas)
    }

    pub fn teselas_trabajo(&self, indice_id: i64) -> Result<Vec<(String, TrabajoDe)>> {
        let c = self.0.lock().unwrap();
        let mut q = c.prepare(
            "SELECT quadkey, trabajo, fuente_indice FROM teselas WHERE indice_id = ?1",
        )?;
        let filas = q
            .query_map(params![indice_id], |r| {
                let qk: String = r.get(0)?;
                let trabajo: String = r.get(1)?;
                let fuente: Option<String> = r.get(2)?;
                let t = match (trabajo.as_str(), fuente) {
                    ("local", Some(f)) => TrabajoDe::Local(f),
                    ("catalogo", Some(f)) => TrabajoDe::Catalogo(f),
                    _ => TrabajoDe::Aqui,
                };
                Ok((qk, t))
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(filas)
    }

    pub fn anotar_tesela(
        &self,
        indice_id: i64,
        quadkey: &str,
        trabajo: &str,
        fuente_indice: Option<&str>,
        sha256: Option<&str>,
    ) -> Result<()> {
        let c = self.0.lock().unwrap();
        c.execute(
            "INSERT OR REPLACE INTO teselas (indice_id, quadkey, trabajo, fuente_indice, sha256)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![indice_id, quadkey, trabajo, fuente_indice, sha256],
        )?;
        Ok(())
    }

    /// Cuántas imágenes de este índice siguen sin vector de este modelo. Es lo
    /// que reconstruye la cola cuando Redis se ha vaciado, y lo que impide
    /// sellar un paquete a medias.
    pub fn sin_vector(&self, indice_id: i64, modelo: &str) -> Result<u32> {
        let c = self.0.lock().unwrap();
        let n: u32 = c.query_row(
            "SELECT COUNT(*) FROM imagenes i JOIN vectores v ON v.imagen_id = i.id
              WHERE i.indice_id = ?1 AND v.modelo = ?2 AND v.estado = 'pendiente'
                AND i.saltada_motivo IS NULL",
            params![indice_id, modelo],
            |r| r.get(0),
        )?;
        Ok(n)
    }
}
```

- [ ] **Step 3: Escribir la clave maestra**

`indexer/src-tauri/src/crypto.rs`:

```rust
//! La clave maestra del equipo: lo que cifra la clave de Mapbox y cualquier
//! otro secreto en `ajustes.sellado`.
//!
//! Es la versión mínima de lo que hace `crates/lumid/src/master.rs`: aquí no
//! hay modo sellado ni desbloqueo remoto, porque no hay servidor que
//! desbloquear. Un fichero de 32 bytes con permisos restrictivos junto a la
//! base de datos.

use std::path::Path;

use anyhow::{bail, Result};
use chacha20poly1305::aead::{Aead, KeyInit, OsRng};
use chacha20poly1305::{AeadCore, XChaCha20Poly1305, XNonce};

pub struct Maestra(XChaCha20Poly1305);

impl Maestra {
    pub fn abrir_o_crear(dir: &Path) -> Result<Self> {
        let ruta = dir.join("maestra.key");
        let bytes = if ruta.exists() {
            std::fs::read(&ruta)?
        } else {
            use rand::RngCore;
            let mut k = [0u8; 32];
            rand::thread_rng().fill_bytes(&mut k);
            std::fs::write(&ruta, k)?;
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                std::fs::set_permissions(&ruta, std::fs::Permissions::from_mode(0o600))?;
            }
            k.to_vec()
        };
        if bytes.len() != 32 {
            bail!("la clave maestra no mide 32 bytes: {} ", bytes.len());
        }
        Ok(Self(XChaCha20Poly1305::new_from_slice(&bytes)?))
    }

    /// Devuelve `nonce || ciphertext`, listo para guardar en un BLOB.
    pub fn sellar(&self, claro: &[u8]) -> Result<Vec<u8>> {
        let nonce = XChaCha20Poly1305::generate_nonce(&mut OsRng);
        let ct = self
            .0
            .encrypt(&nonce, claro)
            .map_err(|_| anyhow::anyhow!("no se pudo cifrar"))?;
        let mut fuera = nonce.to_vec();
        fuera.extend_from_slice(&ct);
        Ok(fuera)
    }

    pub fn abrir(&self, sellado: &[u8]) -> Result<Vec<u8>> {
        if sellado.len() < 24 {
            bail!("el dato cifrado es más corto que su nonce");
        }
        let (nonce, ct) = sellado.split_at(24);
        self.0
            .decrypt(XNonce::from_slice(nonce), ct)
            .map_err(|_| anyhow::anyhow!("no se pudo descifrar: ¿clave maestra distinta?"))
    }
}
```

- [ ] **Step 4: Engancharlos al arranque**

En `indexer/src-tauri/src/lib.rs`, sustituir el contenido por:

```rust
//! Lumi Indexer: la aplicación.
//!
//! Independiente de Lumi Station. No se vincula a ningún servidor, no tiene
//! cuentas ni sesiones: es una herramienta de un solo operador sobre su propia
//! máquina. Lo que produce son paquetes `.lumidx` sellados.

mod crypto;
mod store;

use std::path::PathBuf;

use crypto::Maestra;
use store::Almacen;

pub struct Estado {
    pub dir: PathBuf,
    pub almacen: Almacen,
    pub maestra: Maestra,
}

/// Dónde vive todo. `LUMI_INDEXER_DATA` existe para poder correr una instancia
/// de pruebas sin tocar la del operador.
fn directorio() -> PathBuf {
    if let Ok(d) = std::env::var("LUMI_INDEXER_DATA") {
        return PathBuf::from(d);
    }
    let base = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .unwrap_or_else(|_| ".".into());
    PathBuf::from(base).join(".lumi-indexer")
}

#[tauri::command]
fn saludo(estado: tauri::State<'_, Estado>) -> serde_json::Value {
    serde_json::json!({
        "version": env!("CARGO_PKG_VERSION"),
        "so": std::env::consts::OS,
        "dir": estado.dir.display().to_string(),
    })
}

pub fn run() {
    let dir = directorio();
    let almacen = Almacen::abrir(&dir).expect("no se pudo abrir el almacén");
    let maestra = Maestra::abrir_o_crear(&dir).expect("no se pudo abrir la clave maestra");

    tauri::Builder::default()
        .plugin(tauri_plugin_log::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .manage(Estado { dir, almacen, maestra })
        .invoke_handler(tauri::generate_handler![saludo])
        .run(tauri::generate_context!())
        .expect("no se pudo arrancar el Lumi Indexer");
}
```

Y en `indexer/src/App.tsx`, añadir `dir` a la interfaz y enseñarlo en mono:

```tsx
interface Saludo { version: string; so: string; dir: string }
```

```tsx
            <span className="font-mono text-[9.5px] text-subtle">
              {saludo ? `v${saludo.version} · ${saludo.so} · ${saludo.dir}` : "…"}
            </span>
```

- [ ] **Step 5: Comprobar que arranca y crea el fichero**

Run: `cargo check --manifest-path indexer/src-tauri/Cargo.toml`
Expected: compila.

Run: `LUMI_INDEXER_DATA=/tmp/lumi-idx-prueba python tools/build.py indexer`
Expected: la ventana abre y muestra la ruta. En otra terminal, `ls /tmp/lumi-idx-prueba` lista `indexer.db`, `indexer.db-wal` y `maestra.key`.

- [ ] **Step 6: Commit**

```bash
git add indexer
git commit -m "La verdad en SQLite, y una maestra para los secretos del equipo"
```

---

### Task 9: Redis y Qdrant, en local y solo en local

**Files:**
- Create: `indexer/src-tauri/src/services.rs`
- Create: `indexer/src-tauri/src/qdrant.rs`
- Modify: `indexer/src-tauri/src/lib.rs`
- Modify: `indexer/src-tauri/Cargo.toml`

**Interfaces:**
- Consumes: `Estado.dir`.
- Produces: comandos Tauri `servicios_estado() -> Vec<EstadoServicio>`, `servicios_arrancar() -> Result<(), String>`, `servicios_log(desde: usize) -> LogTrozo`. `EstadoServicio { nombre, vivo, detalle }`. Módulo `qdrant::{Cliente, coleccion_de}`; `coleccion_de("lumi-2", "1.0") == "lumi_img__lumi_2_1_0"`.

- [ ] **Step 1: Añadir las dependencias**

En `indexer/src-tauri/Cargo.toml`:

```toml
redis = { version = "0.27", features = ["tokio-comp"] }
reqwest = { version = "0.12", default-features = false, features = ["json", "rustls-tls"] }
```

- [ ] **Step 2: Escribir el arranque de servicios**

`indexer/src-tauri/src/services.rs`:

```rust
//! Levantar Redis y Qdrant, y saber si están vivos.
//!
//! Los dos escuchan SOLO en 127.0.0.1 y con `protected-mode`. No es una
//! preferencia de despliegue: un almacén de vectores y una cola abiertos a la
//! red en el portátil de un investigador son exactamente lo que este proyecto
//! existe para no hacer.
//!
//! Redis no publica binarios oficiales para Windows. En Linux corre nativo; en
//! Windows el Indexer se instala dentro de WSL, que es la misma postura que
//! ARCHITECTURE.md §7 ya fija para el servidor. Empaquetar Memurai metería una
//! dependencia de terceros con su propia licencia en un proyecto de código
//! abierto.

use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::{Arc, Mutex};

use anyhow::{bail, Result};
use serde::Serialize;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{Child, Command};

pub const REDIS_PUERTO: u16 = 6579;
pub const QDRANT_PUERTO: u16 = 6633;

#[derive(Debug, Clone, Serialize)]
pub struct EstadoServicio {
    pub nombre: String,
    pub vivo: bool,
    pub detalle: String,
}

/// El log de arranque de los dos servicios, en memoria y por líneas. Se sirve
/// por offset igual que el runner del subsistema 1, para que la interfaz pueda
/// engancharse y desengancharse sin perder nada.
#[derive(Default)]
pub struct Log(Mutex<Vec<String>>);

impl Log {
    pub fn apuntar(&self, linea: String) {
        let mut v = self.0.lock().unwrap();
        // ponytail: tope de 2000 líneas en memoria, sin fichero. El techo es
        // que un arranque patológico pierde el principio; la salida, escribirlo
        // a disco como hace el runner del daemon.
        if v.len() >= 2000 {
            v.remove(0);
        }
        v.push(linea);
    }
    pub fn desde(&self, n: usize) -> Vec<String> {
        let v = self.0.lock().unwrap();
        v.iter().skip(n).cloned().collect()
    }
}

pub struct Servicios {
    dir: PathBuf,
    pub log: Arc<Log>,
    hijos: Mutex<Vec<Child>>,
}

/// Escribe un `redis.conf` que no se puede alcanzar desde fuera del equipo.
fn escribir_redis_conf(dir: &Path) -> Result<PathBuf> {
    let datos = dir.join("redis");
    std::fs::create_dir_all(&datos)?;
    let conf = dir.join("redis.conf");
    std::fs::write(
        &conf,
        format!(
            "bind 127.0.0.1\n\
             protected-mode yes\n\
             port {REDIS_PUERTO}\n\
             dir {}\n\
             appendonly yes\n\
             save \"\"\n",
            datos.display()
        ),
    )?;
    Ok(conf)
}

/// Busca un ejecutable probando varios nombres. Misma lección que costó una
/// tarde en el subsistema 4: fijar `python3` a ciegas deja el proceso muerto en
/// cualquier máquina donde se llame de otra forma.
fn buscar(candidatos: &[&str]) -> Option<String> {
    candidatos.iter().find_map(|c| {
        let ok = std::process::Command::new(c)
            .arg("--version")
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .is_ok_and(|s| s.success());
        ok.then(|| (*c).to_string())
    })
}

impl Servicios {
    pub fn nuevo(dir: PathBuf) -> Self {
        Self { dir, log: Arc::new(Log::default()), hijos: Mutex::new(Vec::new()) }
    }

    async fn lanzar(&self, nombre: &'static str, exe: &str, args: Vec<String>) -> Result<()> {
        let mut hijo = Command::new(exe)
            .args(&args)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            // Sin esto, cerrar el Indexer dejaría un Redis y un Qdrant
            // huérfanos ocupando puertos hasta el siguiente reinicio.
            .kill_on_drop(true)
            .spawn()?;

        for tuberia in [hijo.stdout.take().map(|s| Box::new(s) as Box<dyn tokio::io::AsyncRead + Unpin + Send>),
                        hijo.stderr.take().map(|s| Box::new(s) as Box<dyn tokio::io::AsyncRead + Unpin + Send>)]
            .into_iter()
            .flatten()
        {
            let log = self.log.clone();
            tokio::spawn(async move {
                let mut lineas = BufReader::new(tuberia).lines();
                while let Ok(Some(l)) = lineas.next_line().await {
                    log.apuntar(format!("{nombre}: {l}"));
                }
            });
        }
        self.hijos.lock().unwrap().push(hijo);
        Ok(())
    }

    pub async fn arrancar(&self) -> Result<()> {
        if cfg!(windows) {
            bail!(
                "Redis no tiene binario oficial para Windows. El Indexer se instala dentro de WSL; \
                 ver la sección «Linux primero» del README."
            );
        }

        let Some(redis) = buscar(&["redis-server"]) else {
            bail!("no encuentro `redis-server` en el PATH");
        };
        let conf = escribir_redis_conf(&self.dir)?;
        self.log.apuntar(format!("redis: usando {}", conf.display()));
        self.lanzar("redis", &redis, vec![conf.display().to_string()]).await?;

        let Some(qdrant) = buscar(&["qdrant"]) else {
            bail!("no encuentro `qdrant` en el PATH");
        };
        let almacen = self.dir.join("qdrant");
        std::fs::create_dir_all(&almacen)?;
        self.log.apuntar(format!("qdrant: storage en {}", almacen.display()));
        // Qdrant se configura por entorno; se le fija el host explícitamente
        // porque su defecto (0.0.0.0) es justo lo que no queremos.
        let mut cmd = Command::new(&qdrant);
        cmd.env("QDRANT__STORAGE__STORAGE_PATH", &almacen)
            .env("QDRANT__SERVICE__HOST", "127.0.0.1")
            .env("QDRANT__SERVICE__HTTP_PORT", QDRANT_PUERTO.to_string())
            .env("QDRANT__TELEMETRY_DISABLED", "true")
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        let mut hijo = cmd.spawn()?;
        if let Some(s) = hijo.stdout.take() {
            let log = self.log.clone();
            tokio::spawn(async move {
                let mut l = BufReader::new(s).lines();
                while let Ok(Some(x)) = l.next_line().await {
                    log.apuntar(format!("qdrant: {x}"));
                }
            });
        }
        self.hijos.lock().unwrap().push(hijo);
        Ok(())
    }

    pub async fn estado(&self) -> Vec<EstadoServicio> {
        let redis = match redis::Client::open(format!("redis://127.0.0.1:{REDIS_PUERTO}/")) {
            Ok(c) => match c.get_multiplexed_async_connection().await {
                Ok(mut con) => {
                    let pong: redis::RedisResult<String> =
                        redis::cmd("PING").query_async(&mut con).await;
                    match pong {
                        Ok(_) => EstadoServicio {
                            nombre: "Redis".into(),
                            vivo: true,
                            detalle: format!("127.0.0.1:{REDIS_PUERTO}"),
                        },
                        Err(e) => no_vivo("Redis", e.to_string()),
                    }
                }
                Err(e) => no_vivo("Redis", e.to_string()),
            },
            Err(e) => no_vivo("Redis", e.to_string()),
        };

        let url = format!("http://127.0.0.1:{QDRANT_PUERTO}/readyz");
        let qdrant = match reqwest::get(&url).await {
            Ok(r) if r.status().is_success() => EstadoServicio {
                nombre: "Qdrant".into(),
                vivo: true,
                detalle: format!("127.0.0.1:{QDRANT_PUERTO}"),
            },
            Ok(r) => no_vivo("Qdrant", format!("respondió {}", r.status())),
            Err(e) => no_vivo("Qdrant", e.to_string()),
        };

        vec![redis, qdrant]
    }
}

fn no_vivo(nombre: &str, detalle: String) -> EstadoServicio {
    EstadoServicio { nombre: nombre.into(), vivo: false, detalle }
}
```

- [ ] **Step 3: Escribir el cliente de Qdrant**

`indexer/src-tauri/src/qdrant.rs`:

```rust
//! Cliente HTTP mínimo de Qdrant.
//!
//! No se usa el crate oficial: hacen falta cuatro operaciones (crear
//! colección, subir puntos, leer puntos con vector, borrar colección) y el
//! crate arrastra gRPC y su generación de código para eso.
//!
//! Una colección por (modelo, versión). Qdrant NO permite añadir un vector con
//! nombre nuevo a una colección existente —habría que recrearla y reindexar—,
//! así que instalar un modelo es crear una colección y desinstalarlo es
//! borrarla, sin tocar nada más.

use anyhow::{bail, Result};
use serde_json::json;

use crate::services::QDRANT_PUERTO;

/// `lumi-2` + `1.0` → `lumi_img__lumi_2_1_0`. Todo lo que no sea alfanumérico
/// pasa a `_` porque el nombre acaba en una URL.
pub fn coleccion_de(modelo: &str, version: &str) -> String {
    let limpio = |s: &str| {
        s.chars().map(|c| if c.is_ascii_alphanumeric() { c } else { '_' }).collect::<String>()
    };
    format!("lumi_img__{}_{}", limpio(modelo), limpio(version))
}

pub struct Cliente {
    base: String,
    http: reqwest::Client,
}

impl Cliente {
    pub fn nuevo() -> Self {
        Self {
            base: format!("http://127.0.0.1:{QDRANT_PUERTO}"),
            http: reqwest::Client::new(),
        }
    }

    /// Crea la colección si no existe. Cuantización binaria con reescalado
    /// contra los vectores guardados: es la configuración normal de Qdrant para
    /// dimensionalidades altas, no un apaño.
    pub async fn asegurar_coleccion(&self, nombre: &str, dims: u32) -> Result<()> {
        let url = format!("{}/collections/{nombre}", self.base);
        if self.http.get(&url).send().await?.status().is_success() {
            return Ok(());
        }
        let cuerpo = json!({
            "vectors": { "size": dims, "distance": "Cosine" },
            "quantization_config": { "binary": { "always_ram": true } }
        });
        let r = self.http.put(&url).json(&cuerpo).send().await?;
        if !r.status().is_success() {
            bail!("Qdrant rechazó crear «{nombre}»: {}", r.text().await.unwrap_or_default());
        }
        Ok(())
    }

    /// Sube un bloque de puntos. `ids` son los `imagenes.id` de SQLite, que es
    /// lo que ata cada vector a su fila.
    pub async fn subir(
        &self,
        nombre: &str,
        ids: &[i64],
        vectores: &[Vec<f32>],
        quadkeys: &[String],
    ) -> Result<()> {
        if ids.len() != vectores.len() || ids.len() != quadkeys.len() {
            bail!("subir: ids, vectores y quadkeys tienen que venir en paralelo");
        }
        let puntos: Vec<_> = ids
            .iter()
            .zip(vectores)
            .zip(quadkeys)
            .map(|((id, v), qk)| json!({ "id": id, "vector": v, "payload": { "qk": qk } }))
            .collect();
        let url = format!("{}/collections/{nombre}/points?wait=true", self.base);
        let r = self.http.put(&url).json(&json!({ "points": puntos })).send().await?;
        if !r.status().is_success() {
            bail!("Qdrant rechazó los puntos: {}", r.text().await.unwrap_or_default());
        }
        Ok(())
    }

    /// Lee los vectores de una lista de ids, EN EL ORDEN PEDIDO. Es lo que usa
    /// el sellado, y el orden es el contrato del fragmento.
    pub async fn leer(&self, nombre: &str, ids: &[i64]) -> Result<Vec<Vec<f32>>> {
        let url = format!("{}/collections/{nombre}/points", self.base);
        let r = self
            .http
            .post(&url)
            .json(&json!({ "ids": ids, "with_vector": true, "with_payload": false }))
            .send()
            .await?;
        if !r.status().is_success() {
            bail!("Qdrant no devolvió los puntos: {}", r.text().await.unwrap_or_default());
        }
        let v: serde_json::Value = r.json().await?;
        let lista = v["result"].as_array().cloned().unwrap_or_default();
        let mut por_id = std::collections::HashMap::new();
        for p in lista {
            let id = p["id"].as_i64().unwrap_or(-1);
            let vec: Vec<f32> = p["vector"]
                .as_array()
                .map(|a| a.iter().filter_map(|x| x.as_f64().map(|f| f as f32)).collect())
                .unwrap_or_default();
            por_id.insert(id, vec);
        }
        ids.iter()
            .map(|id| {
                por_id
                    .remove(id)
                    .ok_or_else(|| anyhow::anyhow!("Qdrant no tiene vector para la imagen {id}"))
            })
            .collect()
    }
}
```

- [ ] **Step 4: Exponerlos como comandos**

En `indexer/src-tauri/src/lib.rs`, añadir los módulos y los comandos:

```rust
mod qdrant;
mod services;
```

Añadir `servicios: services::Servicios` al struct `Estado`, construirlo en `run()` con `services::Servicios::nuevo(dir.clone())`, y añadir:

```rust
#[tauri::command]
async fn servicios_arrancar(estado: tauri::State<'_, Estado>) -> Result<(), String> {
    estado.servicios.arrancar().await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn servicios_estado(
    estado: tauri::State<'_, Estado>,
) -> Result<Vec<services::EstadoServicio>, String> {
    Ok(estado.servicios.estado().await)
}

#[tauri::command]
fn servicios_log(estado: tauri::State<'_, Estado>, desde: usize) -> Vec<String> {
    estado.servicios.log.desde(desde)
}
```

y registrarlos en `generate_handler![saludo, servicios_arrancar, servicios_estado, servicios_log]`.

- [ ] **Step 5: Comprobar contra servicios reales**

Run: `cargo check --manifest-path indexer/src-tauri/Cargo.toml`
Expected: compila.

Run (con `redis-server` y `qdrant` instalados en el PATH):

```bash
LUMI_INDEXER_DATA=/tmp/lumi-idx-prueba python tools/build.py indexer
```

Expected: al pulsar el botón de arrancar (aún no existe; de momento se comprueba desde la consola del navegador con `__TAURI__.core.invoke("servicios_arrancar")`), `servicios_estado` devuelve los dos con `vivo: true`. Y `redis-cli -h 127.0.0.1 -p 6579 ping` responde `PONG`, mientras que `redis-cli -h <IP de la máquina> -p 6579 ping` **no** conecta.

- [ ] **Step 6: Commit**

```bash
git add indexer
git commit -m "Redis y Qdrant, en local y sin puerta a la red"
```

---

### Task 10: El wizard de aprovisionamiento

**Files:**
- Create: `indexer/src/setup/SetupWizard.tsx`, `indexer/src/setup/Stepper.tsx`, `indexer/src/setup/ServicesStep.tsx`, `indexer/src/setup/LogBox.tsx`
- Create: `indexer/src/lib/api.ts`
- Modify: `indexer/src/App.tsx`

**Interfaces:**
- Consumes: los comandos de la tarea 9.
- Produces: `api.serviciosArrancar()`, `api.serviciosEstado()`, `api.serviciosLog(desde)`; el componente `<SetupWizard onListo={() => …} />`.

- [ ] **Step 1: Escribir el puente**

`indexer/src/lib/api.ts`:

```ts
import { invoke } from "@tauri-apps/api/core";

export interface Saludo { version: string; so: string; dir: string }
export interface EstadoServicio { nombre: string; vivo: boolean; detalle: string }

export const api = {
  saludo: () => invoke<Saludo>("saludo"),
  serviciosArrancar: () => invoke<void>("servicios_arrancar"),
  serviciosEstado: () => invoke<EstadoServicio[]>("servicios_estado"),
  serviciosLog: (desde: number) => invoke<string[]>("servicios_log", { desde }),
};
```

- [ ] **Step 2: Escribir el stepper**

`indexer/src/setup/Stepper.tsx`:

```tsx
import { Icon } from "../ui/Icon";

/** El stepper de burbujas de la v1, mismo vocabulario: hecho en blanco,
 *  en curso con el borde de `draw-fg`, pendiente en `subtle`. No hay verde. */
export function Stepper({ pasos, actual }: { pasos: string[]; actual: number }) {
  return (
    <div className="mb-[18px] flex items-center">
      {pasos.map((p, i) => (
        <div key={p} className="contents">
          {i > 0 && <span className="mb-5 h-px flex-1 bg-border" />}
          <div className="flex w-[104px] flex-col items-center gap-1.5">
            <span
              className={`grid h-[19px] w-[19px] place-items-center rounded-full text-[9.5px] ${
                i < actual
                  ? "bg-fg text-black"
                  : i === actual
                    ? "border border-draw-fg text-draw-fg"
                    : "border border-[#3a3e44] text-subtle"
              }`}
            >
              {i < actual ? <Icon name="check" size={11} /> : i + 1}
            </span>
            <span className={`text-[10.5px] ${i <= actual ? "text-fg" : "text-subtle"}`}>{p}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Escribir el bloque de log**

`indexer/src/setup/LogBox.tsx`:

```tsx
import { useEffect, useRef, useState } from "react";

import { api } from "../lib/api";

/** El log crudo, servido por offset como el runner del subsistema 1: la
 *  interfaz se engancha y se desengancha sin perder líneas. Son gigabytes y
 *  minutos de instalación; una barra sin log es mirar a ciegas. */
export function LogBox() {
  const [lineas, setLineas] = useState<string[]>([]);
  const fondo = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let vivo = true;
    let desde = 0;
    const tick = async () => {
      const nuevas = await api.serviciosLog(desde);
      if (!vivo || nuevas.length === 0) return;
      desde += nuevas.length;
      setLineas((v) => [...v, ...nuevas]);
    };
    void tick();
    const t = setInterval(() => void tick(), 500);
    return () => { vivo = false; clearInterval(t); };
  }, []);

  useEffect(() => { fondo.current?.scrollIntoView({ block: "end" }); }, [lineas]);

  return (
    <div className="mt-[15px] max-h-[132px] overflow-hidden rounded-lg border border-border bg-[#0b0d0f] px-3 py-2.5">
      {lineas.length === 0 && <p className="font-mono text-[10px] text-subtle">sin salida todavía</p>}
      {lineas.map((l, i) => (
        <p key={`${i}-${l}`} className="font-mono text-[10px] leading-[1.85] text-muted">{l}</p>
      ))}
      <div ref={fondo} />
    </div>
  );
}
```

- [ ] **Step 4: Escribir el paso de servicios y el wizard**

`indexer/src/setup/ServicesStep.tsx`:

```tsx
import { useEffect, useState } from "react";

import { api, type EstadoServicio, type Saludo } from "../lib/api";
import { Icon } from "../ui/Icon";
import { LogBox } from "./LogBox";

export function ServicesStep({ saludo, onListo }: { saludo: Saludo; onListo: () => void }) {
  const [servicios, setServicios] = useState<EstadoServicio[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api.serviciosArrancar().catch((e) => setError(String(e)));
    const t = setInterval(() => { void api.serviciosEstado().then(setServicios); }, 800);
    return () => clearInterval(t);
  }, []);

  const todos = servicios.length > 0 && servicios.every((s) => s.vivo);

  return (
    <div className="rounded-card border border-white/[.13] bg-[rgba(16,19,25,.66)] p-[20px_22px] shadow-lg shadow-black/40 backdrop-blur-xl">
      <p className="text-sm text-fg">Levantando los servicios locales</p>
      <p className="mt-[5px] text-[11px] leading-relaxed text-muted">
        Redis para la cola, Qdrant para los vectores. Los dos escuchan solo en{" "}
        <span className="font-mono text-fg">127.0.0.1</span>, nunca en la red.
      </p>

      <div className="mt-4 flex flex-col gap-2">
        {servicios.map((s) => (
          <div key={s.nombre} className="flex items-center gap-2.5">
            <Icon
              name={s.vivo ? "check" : "refresh"}
              size={13}
              className={s.vivo ? "text-fg" : "text-draw-fg"}
            />
            <span className="flex-1 text-xs text-fg">{s.nombre}</span>
            <span className={`font-mono text-[10px] ${s.vivo ? "text-subtle" : "text-draw-fg"}`}>
              {s.vivo ? s.detalle : "arrancando"}
            </span>
          </div>
        ))}
      </div>

      <LogBox />

      {/* El aviso va aquí y no en un manual: es donde el operador se topa con
          el problema. */}
      <div className="mt-[13px] flex items-start gap-[7px]">
        <Icon name="alert" size={12} className="mt-px shrink-0 text-warning-fg" />
        <span className="text-[10.5px] leading-snug text-warning-fg">
          Redis no publica binarios oficiales para Windows. Este equipo es{" "}
          <span className="font-mono">{saludo.so}</span>
          {saludo.so === "windows"
            ? ", así que el Indexer tiene que instalarse dentro de WSL."
            : ", así que corre nativo."}
        </span>
      </div>

      {error && <p className="mt-2.5 text-[11px] text-danger-fg">{error}</p>}

      <div className="mt-[17px] flex items-center justify-between">
        <span className="font-mono text-[9.5px] text-subtle">puedes cerrar: se retoma solo</span>
        <button
          onClick={onListo}
          disabled={!todos}
          className="jg-press rounded-lg bg-accent px-4 py-2 text-[11.5px] font-medium text-black disabled:opacity-40"
        >
          Continuar
        </button>
      </div>
    </div>
  );
}
```

`indexer/src/setup/SetupWizard.tsx`:

```tsx
import { useState } from "react";

import type { Saludo } from "../lib/api";
import { ServicesStep } from "./ServicesStep";
import { Stepper } from "./Stepper";

const PASOS = ["Carpeta", "Servicios", "Runtime", "Modelos"];

/** Misma composición que el wizard del subsistema 1: 552 px, brandline ✦,
 *  stepper de burbujas, tarjeta de cristal. No es un componente nuevo. */
export function SetupWizard({ saludo, onListo }: { saludo: Saludo; onListo: () => void }) {
  // La carpeta ya existe cuando la app arranca (la crea el lado Rust), así que
  // el paso 1 nace hecho y el wizard abre directamente en Servicios.
  const [paso, setPaso] = useState(1);

  return (
    <div className="relative z-10 w-[552px]" style={{ animation: "jg-fade-rise .7s both" }}>
      <div className="mb-5 flex items-center gap-2.5">
        <span className="text-[15px] text-fg">✦</span>
        <span className="text-[17px] font-medium text-fg">Lumi Indexer</span>
        <span className="font-mono text-[9.5px] text-subtle">v{saludo.version}</span>
      </div>
      <Stepper pasos={PASOS} actual={paso} />
      {paso === 1 && <ServicesStep saludo={saludo} onListo={() => setPaso(2)} />}
      {paso >= 2 && (
        // Los pasos 3 y 4 los añade la tarea 11.
        <div className="rounded-card border border-white/[.13] bg-[rgba(16,19,25,.66)] p-[20px_22px] backdrop-blur-xl">
          <p className="text-sm text-fg">Servicios listos</p>
          <p className="mt-[5px] text-[11px] text-muted">El runtime y los modelos llegan en la tarea 11.</p>
          <button onClick={onListo} className="jg-press mt-4 rounded-lg bg-accent px-4 py-2 text-[11.5px] font-medium text-black">
            Entrar
          </button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Enseñarlo en `App.tsx`**

Sustituir `indexer/src/App.tsx` por:

```tsx
import { useEffect, useState } from "react";

import { api, type Saludo } from "./lib/api";
import { SetupWizard } from "./setup/SetupWizard";
import { PlanetBackground } from "./ui/PlanetBackground";
import { WindowFrame } from "./ui/WindowFrame";

export function App() {
  const [saludo, setSaludo] = useState<Saludo | null>(null);
  const [dentro, setDentro] = useState(false);

  useEffect(() => { void api.saludo().then(setSaludo); }, []);

  return (
    <WindowFrame>
      <div className="relative h-full w-full overflow-hidden bg-bg">
        {!dentro && <PlanetBackground />}
        <div className="relative flex h-full items-center justify-center">
          {saludo && !dentro && <SetupWizard saludo={saludo} onListo={() => setDentro(true)} />}
          {dentro && <p className="text-[13px] text-muted">El catálogo llega en la tarea 14.</p>}
        </div>
      </div>
    </WindowFrame>
  );
}
```

- [ ] **Step 6: Comprobar**

Run: `cd indexer && npm run build`
Expected: sin errores de TypeScript.

Run: `LUMI_INDEXER_DATA=/tmp/lumi-idx-prueba python tools/build.py indexer`
Expected: el wizard abre sobre el planeta, arranca los dos servicios, el log va escribiendo líneas, los dos pasan a `check` blanco y «Continuar» se enciende.

- [ ] **Step 7: Commit**

```bash
git add indexer
git commit -m "El wizard del arranque, con el log a la vista y no una barra ciega"
```

---

### Task 11: El runtime de Python y el registro de modelos

**Files:**
- Create: `indexer/src-tauri/src/models.rs`
- Create: `indexer/src-tauri/src/runtime.rs`
- Create: `indexer/modelos/lumi-preview.json`, `indexer/modelos/lumi-2.json`
- Create: `indexer/src/setup/RuntimeStep.tsx`, `indexer/src/setup/ModelsStep.tsx`
- Modify: `indexer/src-tauri/src/lib.rs`, `indexer/src/setup/SetupWizard.tsx`, `indexer/src/lib/api.ts`

**Interfaces:**
- Consumes: `services::Log`, `Estado.dir`.
- Produces: `models::{Modelo, cargar_registro}` con `Modelo { id, nombre, base, version, dims, pesos_url }`; `runtime::{instalar, python_del_venv, esta_instalado}`; comandos `modelos_lista`, `runtime_instalar`, `runtime_listo`.

- [ ] **Step 1: Escribir el registro como datos**

`indexer/modelos/lumi-preview.json`:

```json
{
  "id": "lumi-preview",
  "nombre": "Lumi Preview",
  "base": "MegaLoc (congelado)",
  "version": "1.0",
  "dims": 8448,
  "pesos_url": "https://huggingface.co/gmberton/MegaLoc/resolve/main/megaloc.pth"
}
```

`indexer/modelos/lumi-2.json`:

```json
{
  "id": "lumi-2",
  "nombre": "Lumi 2",
  "base": "BoQ + DINOv2 (congelado)",
  "version": "1.0",
  "dims": 12288,
  "pesos_url": "https://huggingface.co/amaralibey/BoQ/resolve/main/dinov2_boq.pth"
}
```

`indexer/src-tauri/src/models.rs`:

```rust
//! El registro de modelos, que es DATOS y no código.
//!
//! La v1 aprendió esto por las malas: registrar un modelo significaba editar un
//! módulo compartido, y así se perdió una entrada entera en un release. Aquí es
//! un directorio de ficheros JSON, uno por modelo. Un fichero malo cuesta un
//! modelo, nunca la lista.
//!
//! Arranca con `lumi-preview` y `lumi-2` no por nostalgia: son los que llevan
//! dentro los paquetes legacy de la v1, y no soportarlos dejaría huérfano todo
//! lo ya publicado.

use std::path::Path;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Modelo {
    pub id: String,
    pub nombre: String,
    pub base: String,
    pub version: String,
    pub dims: u32,
    pub pesos_url: String,
}

/// Lee todos los `.json` del directorio. Un fichero ilegible o incompleto se
/// registra y se ignora; no tumba el resto de la lista.
pub fn cargar_registro(dir: &Path) -> Vec<Modelo> {
    let Ok(entradas) = std::fs::read_dir(dir) else {
        log::warn!("no hay directorio de modelos en {}", dir.display());
        return Vec::new();
    };
    let mut fuera = Vec::new();
    let mut rutas: Vec<_> = entradas.flatten().map(|e| e.path()).collect();
    rutas.sort();
    for ruta in rutas {
        if ruta.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        match std::fs::read(&ruta).map_err(anyhow::Error::from).and_then(|b| {
            serde_json::from_slice::<Modelo>(&b).map_err(anyhow::Error::from)
        }) {
            Ok(m) if m.dims > 0 && !m.id.is_empty() => fuera.push(m),
            Ok(m) => log::warn!("modelo descartado, id o dims vacíos: {}", m.id),
            Err(e) => log::warn!("modelo descartado, {}: {e}", ruta.display()),
        }
    }
    fuera
}
```

- [ ] **Step 2: Escribir la instalación del runtime**

`indexer/src-tauri/src/runtime.rs`:

```rust
//! El runtime de Python: un venv con torch, y los pesos de los modelos.
//!
//! Mismo problema que ya resolvió el runner del subsistema 1 y misma respuesta:
//! son gigabytes y minutos, así que corre en segundo plano escribiendo a un log
//! por líneas, y cerrar la ventana no aborta nada. Se comprueba `import torch`
//! antes de hacer nada: sin eso, cada arranque recreaba el venv y volvía a
//! invocar pip aunque no hubiera cambiado nada.

use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Arc;

use anyhow::{bail, Result};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

use crate::services::Log;

pub fn venv_de(dir: &Path) -> PathBuf {
    dir.join("runtime").join("venv")
}

/// El intérprete del venv. En Windows vive en `Scripts`, no en `bin`, y aunque
/// el Indexer sea Linux primero esto se corre también bajo WSL con rutas
/// montadas, así que no cuesta nada acertar.
pub fn python_del_venv(dir: &Path) -> PathBuf {
    let v = venv_de(dir);
    if cfg!(windows) { v.join("Scripts").join("python.exe") } else { v.join("bin").join("python3") }
}

pub fn esta_instalado(dir: &Path) -> bool {
    let py = python_del_venv(dir);
    py.exists()
        && std::process::Command::new(&py)
            .args(["-c", "import torch"])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .is_ok_and(|s| s.success())
}

async fn correr(log: &Arc<Log>, etiqueta: &'static str, exe: &Path, args: &[&str]) -> Result<()> {
    log.apuntar(format!("{etiqueta}: {} {}", exe.display(), args.join(" ")));
    let mut hijo = Command::new(exe)
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()?;
    for t in [
        hijo.stdout.take().map(|s| Box::new(s) as Box<dyn tokio::io::AsyncRead + Unpin + Send>),
        hijo.stderr.take().map(|s| Box::new(s) as Box<dyn tokio::io::AsyncRead + Unpin + Send>),
    ]
    .into_iter()
    .flatten()
    {
        let log = log.clone();
        tokio::spawn(async move {
            let mut l = BufReader::new(t).lines();
            while let Ok(Some(x)) = l.next_line().await {
                log.apuntar(format!("{etiqueta}: {x}"));
            }
        });
    }
    let salida = hijo.wait().await?;
    if !salida.success() {
        bail!("{etiqueta} terminó con {salida}");
    }
    Ok(())
}

pub async fn instalar(dir: &Path, log: Arc<Log>) -> Result<()> {
    if esta_instalado(dir) {
        log.apuntar("runtime: ya instalado, nada que hacer".into());
        return Ok(());
    }
    let base = dir.join("runtime");
    std::fs::create_dir_all(&base)?;

    let Some(py) = ["python3", "python"].into_iter().find(|c| {
        std::process::Command::new(c)
            .arg("--version")
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .is_ok_and(|s| s.success())
    }) else {
        bail!("no encuentro un intérprete de Python en el PATH");
    };

    correr(&log, "venv", Path::new(py), &["-m", "venv", &venv_de(dir).display().to_string()]).await?;
    let vpy = python_del_venv(dir);
    correr(&log, "pip", &vpy, &["-m", "pip", "install", "--upgrade", "pip"]).await?;
    correr(
        &log,
        "pip",
        &vpy,
        &[
            "-m", "pip", "install", "--retries", "5", "--timeout", "60",
            "torch", "--index-url", "https://download.pytorch.org/whl/cu126",
        ],
    )
    .await?;
    correr(&log, "pip", &vpy, &["-m", "pip", "install", "pillow", "numpy"]).await?;
    log.apuntar("runtime: instalado".into());
    Ok(())
}
```

- [ ] **Step 3: Exponerlos**

En `indexer/src-tauri/src/lib.rs`, añadir `mod models; mod runtime;`, guardar `modelos: Vec<models::Modelo>` en `Estado` (cargándolos con `models::cargar_registro(&std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../modelos"))`), y añadir:

```rust
#[tauri::command]
fn modelos_lista(estado: tauri::State<'_, Estado>) -> Vec<models::Modelo> {
    estado.modelos.clone()
}

#[tauri::command]
fn runtime_listo(estado: tauri::State<'_, Estado>) -> bool {
    runtime::esta_instalado(&estado.dir)
}

#[tauri::command]
async fn runtime_instalar(estado: tauri::State<'_, Estado>) -> Result<(), String> {
    runtime::instalar(&estado.dir, estado.servicios.log.clone()).await.map_err(|e| e.to_string())
}
```

y registrarlos en `generate_handler!`.

- [ ] **Step 4: Añadir los dos pasos al wizard**

`indexer/src/setup/RuntimeStep.tsx`:

```tsx
import { useEffect, useState } from "react";

import { api } from "../lib/api";
import { Icon } from "../ui/Icon";
import { LogBox } from "./LogBox";

export function RuntimeStep({ onListo }: { onListo: () => void }) {
  const [listo, setListo] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api.runtimeListo().then((l) => {
      if (l) { setListo(true); return; }
      void api.runtimeInstalar().then(() => setListo(true)).catch((e) => setError(String(e)));
    });
  }, []);

  return (
    <div className="rounded-card border border-white/[.13] bg-[rgba(16,19,25,.66)] p-[20px_22px] backdrop-blur-xl">
      <p className="text-sm text-fg">Instalando el runtime</p>
      <p className="mt-[5px] text-[11px] leading-relaxed text-muted">
        Un entorno de Python con torch. Son varios gigabytes: puedes cerrar la ventana, se retoma solo.
      </p>
      <div className="mt-4 flex items-center gap-2.5">
        <Icon name={listo ? "check" : "refresh"} size={13} className={listo ? "text-fg" : "text-draw-fg"} />
        <span className="flex-1 text-xs text-fg">venv + torch</span>
        <span className={`font-mono text-[10px] ${listo ? "text-subtle" : "text-draw-fg"}`}>
          {listo ? "instalado" : "descargando"}
        </span>
      </div>
      <LogBox />
      {error && <p className="mt-2.5 text-[11px] text-danger-fg">{error}</p>}
      <div className="mt-[17px] flex justify-end">
        <button onClick={onListo} disabled={!listo}
          className="jg-press rounded-lg bg-accent px-4 py-2 text-[11.5px] font-medium text-black disabled:opacity-40">
          Continuar
        </button>
      </div>
    </div>
  );
}
```

`indexer/src/setup/ModelsStep.tsx`:

```tsx
import { useEffect, useState } from "react";

import { api, type Modelo } from "../lib/api";
import { Icon } from "../ui/Icon";

export function ModelsStep({ onListo }: { onListo: () => void }) {
  const [modelos, setModelos] = useState<Modelo[]>([]);
  useEffect(() => { void api.modelosLista().then(setModelos); }, []);

  return (
    <div className="rounded-card border border-white/[.13] bg-[rgba(16,19,25,.66)] p-[20px_22px] backdrop-blur-xl">
      <p className="text-sm text-fg">Modelos disponibles</p>
      <p className="mt-[5px] text-[11px] leading-relaxed text-muted">
        Un índice puede llevar vectores de varios a la vez. Los dos de abajo son los que traen dentro
        los paquetes de la v1, así que sin ellos no se podría abrir nada de lo ya publicado.
      </p>
      <div className="mt-4 flex flex-col gap-2">
        {modelos.map((m) => (
          <div key={m.id} className="flex items-center gap-2.5 rounded-lg border border-border px-2.5 py-2">
            <Icon name="layers" size={13} className="text-fg" />
            <span className="flex-1 text-xs text-fg">{m.nombre}</span>
            <span className="font-mono text-[10px] text-subtle">{m.base} · {m.dims}-d · v{m.version}</span>
          </div>
        ))}
      </div>
      <div className="mt-[17px] flex justify-end">
        <button onClick={onListo} className="jg-press rounded-lg bg-accent px-4 py-2 text-[11.5px] font-medium text-black">
          Entrar
        </button>
      </div>
    </div>
  );
}
```

En `indexer/src/lib/api.ts`, añadir:

```ts
export interface Modelo { id: string; nombre: string; base: string; version: string; dims: number; pesos_url: string }
```

y al objeto `api`:

```ts
  modelosLista: () => invoke<Modelo[]>("modelos_lista"),
  runtimeListo: () => invoke<boolean>("runtime_listo"),
  runtimeInstalar: () => invoke<void>("runtime_instalar"),
```

En `SetupWizard.tsx`, sustituir el bloque `{paso >= 2 && …}` por:

```tsx
      {paso === 2 && <RuntimeStep onListo={() => setPaso(3)} />}
      {paso === 3 && <ModelsStep onListo={onListo} />}
```

con sus dos importaciones.

- [ ] **Step 5: Comprobar**

Run: `cd indexer && npm run build && cd .. && cargo check --manifest-path indexer/src-tauri/Cargo.toml`
Expected: los dos sin errores.

Run: `LUMI_INDEXER_DATA=/tmp/lumi-idx-prueba python tools/build.py indexer`
Expected: tras los servicios, el paso de runtime instala el venv escribiendo líneas de pip en el log, y el de modelos lista los dos con sus dimensiones.

Run: `LUMI_INDEXER_DATA=/tmp/lumi-idx-prueba python tools/build.py indexer` (por segunda vez)
Expected: el paso de runtime pasa a `instalado` de inmediato, con la línea `runtime: ya instalado, nada que hacer`. Si vuelve a invocar pip, el atajo de `import torch` está roto.

- [ ] **Step 6: Commit**

```bash
git add indexer
git commit -m "El runtime y los modelos, que son datos y no un modulo compartido"
```

---

### Task 12: La cola de lotes y el trabajador persistente

**Files:**
- Create: `indexer/src-tauri/src/queue.rs`
- Modify: `indexer/src-tauri/src/lib.rs`, `indexer/src-tauri/src/store.rs`
- Test: `crates/lumi-index/src/embed.rs` (segundo test)

**Interfaces:**
- Consumes: `lumi_index::embed::{Lote, MsgEmbed}`, `Almacen`, `qdrant::Cliente`, `runtime::python_del_venv`.
- Produces: `Cola::nueva(...)`, `Cola::encolar(lote_id)`, `Cola::progreso() -> Progreso`, `Cola::pausar(bool)`; comandos `cola_progreso`, `cola_pausar`.
- Añade a `Almacen`: `pendientes_de(indice_id, modelo, limite) -> Vec<(i64, String)>` (id e imagen), `marcar_vector(imagen_id, modelo, estado)`, `lotes_sin_terminar() -> Vec<i64>`, `sumar_reintento(lote_id) -> u32`.

- [ ] **Step 1: Escribir el test que falla**

Añadir al módulo `tests` de `crates/lumi-index/src/embed.rs`:

```rust
    /// La reanudación no es una función: es la consecuencia de que el estado
    /// por imagen viva en SQLite. Aquí se prueba la regla que la hace posible
    /// sin montar una base de datos: un lote que se corta a la mitad deja las
    /// hechas hechas, y lo que queda por hacer es exactamente el complemento.
    #[test]
    fn un_lote_a_medias_reanuda_sin_repetir_lo_hecho() {
        let todas: Vec<String> = (0..10).map(|i| format!("/img/{i}.jpg")).collect();

        // Primera pasada: el trabajador contesta por 4 y luego el proceso muere.
        let primera = MsgEmbed::Vectores {
            id: 1,
            dims: 64,
            cuenta: 4,
            fichero: "/tmp/a.f32".into(),
            imagenes: todas[..4].to_vec(),
        };
        assert!(primera.validar().is_ok());
        let MsgEmbed::Vectores { imagenes: hechas, .. } = &primera else { unreachable!() };

        // Y una saltada, que TAMBIÉN cuenta como resuelta: no se reintenta.
        let saltada = "/img/4.jpg".to_string();

        let quedan: Vec<String> = todas
            .iter()
            .filter(|r| !hechas.contains(r) && **r != saltada)
            .cloned()
            .collect();
        assert_eq!(quedan.len(), 5, "10 menos 4 hechas menos 1 saltada");
        assert_eq!(quedan[0], "/img/5.jpg", "reanuda justo después, sin repetir");
        assert!(!quedan.contains(&saltada), "una saltada no vuelve a la cola");
    }
```

- [ ] **Step 2: Ejecutarlo y ver que falla**

Run: `cargo test -p lumi-index un_lote_a_medias_reanuda`
Expected: FAIL — el test aún no existe en el fichero antes de añadirlo; tras añadirlo, PASS. (Es un test de la regla, no de código nuevo: si pasa a la primera, está cumpliendo su papel de dejar la regla escrita y ejecutable.)

- [ ] **Step 3: Ampliar el almacén**

Añadir a `impl Almacen` en `indexer/src-tauri/src/store.rs`:

```rust
    /// Imágenes de este índice que siguen sin vector de este modelo. Es lo que
    /// reconstruye la cola cuando Redis se ha vaciado: la verdad está aquí, no
    /// en la lista de Redis.
    pub fn pendientes_de(
        &self,
        indice_id: i64,
        modelo: &str,
        limite: u32,
    ) -> Result<Vec<(i64, String)>> {
        let c = self.0.lock().unwrap();
        let mut q = c.prepare(
            "SELECT i.id, i.ruta FROM imagenes i JOIN vectores v ON v.imagen_id = i.id
              WHERE i.indice_id = ?1 AND v.modelo = ?2 AND v.estado = 'pendiente'
                AND i.saltada_motivo IS NULL
              ORDER BY i.id LIMIT ?3",
        )?;
        let filas = q
            .query_map(params![indice_id, modelo, limite], |r| Ok((r.get(0)?, r.get(1)?)))?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(filas)
    }

    pub fn marcar_vector(&self, imagen_id: i64, modelo: &str, estado: &str) -> Result<()> {
        let c = self.0.lock().unwrap();
        c.execute(
            "UPDATE vectores SET estado = ?3 WHERE imagen_id = ?1 AND modelo = ?2",
            params![imagen_id, modelo, estado],
        )?;
        Ok(())
    }

    pub fn estado_lote(&self, lote_id: i64, estado: &str, error: Option<&str>) -> Result<()> {
        let c = self.0.lock().unwrap();
        c.execute(
            "UPDATE lotes SET estado = ?2, error = ?3 WHERE id = ?1",
            params![lote_id, estado, error],
        )?;
        Ok(())
    }

    /// Devuelve el número de reintentos DESPUÉS de sumar uno. Es el contador
    /// que impide el bucle infinito cuando el proceso se muere una y otra vez.
    pub fn sumar_reintento(&self, lote_id: i64) -> Result<u32> {
        let c = self.0.lock().unwrap();
        c.execute("UPDATE lotes SET reintentos = reintentos + 1 WHERE id = ?1", params![lote_id])?;
        let n: u32 =
            c.query_row("SELECT reintentos FROM lotes WHERE id = ?1", params![lote_id], |r| r.get(0))?;
        Ok(n)
    }

    pub fn lotes_sin_terminar(&self) -> Result<Vec<(i64, i64)>> {
        let c = self.0.lock().unwrap();
        let mut q = c.prepare(
            "SELECT id, indice_id FROM lotes WHERE estado IN ('pendiente','en_curso') ORDER BY id",
        )?;
        let filas = q
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(filas)
    }

    pub fn quadkey_de_imagen(&self, imagen_id: i64) -> Result<String> {
        let c = self.0.lock().unwrap();
        Ok(c.query_row("SELECT quadkey FROM imagenes WHERE id = ?1", params![imagen_id], |r| {
            r.get(0)
        })?)
    }
```

- [ ] **Step 4: Escribir la cola**

`indexer/src-tauri/src/queue.rs`:

```rust
//! La cola de lotes y el trabajador que los resuelve.
//!
//! REDIS ES EL TIMBRE Y EL ESTADO CALIENTE; SQLITE ES LA VERDAD. En Redis van
//! la lista de lotes pendientes y el progreso que la interfaz pinta; el estado
//! por imagen está en SQLite. Si Redis se vacía se pierde la barra y nada más:
//! la cola se reconstruye leyendo qué imágenes siguen sin vector.
//!
//! Dos clases de fallo, y no se tratan igual:
//!   - «esta imagen no se puede embeber» es un RESULTADO. Se anota el motivo,
//!     se salta y se sigue. No se reintenta: reintentarla solo quema GPU.
//!   - que el PROCESO se muera es una AVERÍA. El lote vuelve a la cola una vez,
//!     con un contador que impide el bucle infinito.

use std::path::PathBuf;
use std::process::Stdio;
use std::sync::{Arc, Mutex};

use anyhow::{bail, Result};
use lumi_index::embed::{Lote, MsgEmbed};
use serde::Serialize;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, Command};

use crate::qdrant::{coleccion_de, Cliente};
use crate::runtime::python_del_venv;
use crate::services::Log;
use crate::store::Almacen;

/// Imágenes por lote enviado al trabajador. 32 es lo que cabía holgadamente en
/// una GPU de 8 GB con lumi-2 en las pruebas de la v1.
const POR_LOTE: u32 = 32;
/// Reintentos de un lote cuyo proceso murió. Uno: si muere dos veces, el
/// problema no es de suerte.
const REINTENTOS_MAX: u32 = 1;

#[derive(Debug, Clone, Default, Serialize)]
pub struct Progreso {
    pub trabajando: bool,
    pub pausada: bool,
    pub lote_actual: Option<i64>,
    pub hechas: u32,
    pub total: u32,
    pub dispositivo: String,
    pub modelo: Option<String>,
    pub saltadas: u32,
    pub reinicios: u32,
}

pub struct Cola {
    dir: PathBuf,
    almacen: Arc<Almacen>,
    log: Arc<Log>,
    progreso: Arc<Mutex<Progreso>>,
    pausada: Arc<Mutex<bool>>,
}

struct Trabajador {
    hijo: Child,
    entrada: ChildStdin,
    salida: tokio::sync::mpsc::Receiver<MsgEmbed>,
}

/// Arranca el trabajador y deja sus dos tuberías separadas: `stdout` es el
/// contrato, `stderr` es el log. `-u` es obligatorio: sin él Python no suelta
/// una línea hasta que el proceso muere, y «cargando pesos» y «colgado» se ven
/// exactamente igual.
async fn arrancar(dir: &std::path::Path, log: Arc<Log>, dispositivo: &str) -> Result<Trabajador> {
    let py = python_del_venv(dir);
    let script = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../workers/lumi_embed.py");
    if !script.exists() {
        bail!("no encuentro el trabajador en {}", script.display());
    }
    let mut hijo = Command::new(&py)
        .arg("-u")
        .arg(&script)
        .env("LUMI_DEVICE", dispositivo)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()?;

    let entrada = hijo.stdin.take().expect("stdin pedido");
    let stdout = hijo.stdout.take().expect("stdout pedido");
    let stderr = hijo.stderr.take().expect("stderr pedido");

    let (tx, rx) = tokio::sync::mpsc::channel(64);
    tokio::spawn(async move {
        let mut lineas = BufReader::new(stdout).lines();
        while let Ok(Some(l)) = lineas.next_line().await {
            match serde_json::from_str::<MsgEmbed>(&l) {
                // Una línea ilegible se registra y se sigue: un `print` de
                // depuración perdido en el motor no puede tumbar la cola.
                Err(e) => log::warn!("línea ilegible del trabajador ({e}): {}", &l[..l.len().min(160)]),
                Ok(m) => {
                    if let Err(e) = m.validar() {
                        log::warn!("mensaje descartado, {e}");
                        continue;
                    }
                    if tx.send(m).await.is_err() {
                        break;
                    }
                }
            }
        }
    });
    tokio::spawn(async move {
        let mut l = BufReader::new(stderr).lines();
        while let Ok(Some(x)) = l.next_line().await {
            log.apuntar(format!("trabajador: {x}"));
        }
    });

    Ok(Trabajador { hijo, entrada, salida: rx })
}

impl Cola {
    pub fn nueva(dir: PathBuf, almacen: Arc<Almacen>, log: Arc<Log>) -> Arc<Self> {
        Arc::new(Self {
            dir,
            almacen,
            log,
            progreso: Arc::new(Mutex::new(Progreso::default())),
            pausada: Arc::new(Mutex::new(false)),
        })
    }

    pub fn progreso(&self) -> Progreso {
        self.progreso.lock().unwrap().clone()
    }

    /// Pausar termina el lote en curso y no coge el siguiente. Nunca mata
    /// trabajo que ya está corriendo: es la misma regla del subsistema 4.
    pub fn pausar(&self, si: bool) {
        *self.pausada.lock().unwrap() = si;
        self.progreso.lock().unwrap().pausada = si;
    }

    /// Bucle principal. Se lanza una vez al arrancar la app.
    pub fn arrancar_bucle(self: Arc<Self>, modelo: String, dims: u32, version: String) {
        tokio::spawn(async move {
            let qdrant = Cliente::nuevo();
            let coleccion = coleccion_de(&modelo, &version);
            if let Err(e) = qdrant.asegurar_coleccion(&coleccion, dims).await {
                self.log.apuntar(format!("cola: no se pudo preparar Qdrant: {e}"));
                return;
            }
            let mut trabajador: Option<Trabajador> = None;

            loop {
                if *self.pausada.lock().unwrap() {
                    tokio::time::sleep(std::time::Duration::from_millis(600)).await;
                    continue;
                }
                // La verdad está en SQLite: se pregunta a ella, no a Redis.
                let Ok(lotes) = self.almacen.lotes_sin_terminar() else {
                    tokio::time::sleep(std::time::Duration::from_secs(2)).await;
                    continue;
                };
                let Some((lote_id, indice_id)) = lotes.into_iter().next() else {
                    self.progreso.lock().unwrap().trabajando = false;
                    tokio::time::sleep(std::time::Duration::from_secs(2)).await;
                    continue;
                };

                if trabajador.is_none() {
                    match arrancar(&self.dir, self.log.clone(), "cuda:0").await {
                        Ok(t) => trabajador = Some(t),
                        Err(e) => {
                            self.log.apuntar(format!("cola: no arrancó el trabajador: {e}"));
                            tokio::time::sleep(std::time::Duration::from_secs(5)).await;
                            continue;
                        }
                    }
                }

                let vivo = self
                    .resolver_lote(trabajador.as_mut().unwrap(), lote_id, indice_id, &modelo, &coleccion, &qdrant)
                    .await;
                if !vivo {
                    // El proceso murió: AVERÍA. El lote vuelve a la cola una
                    // vez; el contador impide el bucle infinito.
                    trabajador = None;
                    self.progreso.lock().unwrap().reinicios += 1;
                    match self.almacen.sumar_reintento(lote_id) {
                        Ok(n) if n > REINTENTOS_MAX => {
                            let _ = self.almacen.estado_lote(
                                lote_id,
                                "error",
                                Some("el trabajador murió más veces de las permitidas"),
                            );
                        }
                        _ => {}
                    }
                }
            }
        });
    }

    /// Devuelve `false` si el trabajador se murió a mitad.
    async fn resolver_lote(
        &self,
        t: &mut Trabajador,
        lote_id: i64,
        indice_id: i64,
        modelo: &str,
        coleccion: &str,
        qdrant: &Cliente,
    ) -> bool {
        let Ok(pendientes) = self.almacen.pendientes_de(indice_id, modelo, POR_LOTE) else {
            return true;
        };
        if pendientes.is_empty() {
            let _ = self.almacen.estado_lote(lote_id, "hecho", None);
            return true;
        }
        let _ = self.almacen.estado_lote(lote_id, "en_curso", None);
        {
            let mut p = self.progreso.lock().unwrap();
            p.trabajando = true;
            p.lote_actual = Some(lote_id);
            p.hechas = 0;
            p.total = pendientes.len() as u32;
        }

        let por_ruta: std::collections::HashMap<String, i64> =
            pendientes.iter().map(|(id, r)| (r.clone(), *id)).collect();
        let orden = Lote::nuevo(lote_id, modelo.to_string(), pendientes.iter().map(|(_, r)| r.clone()).collect());
        let linea = format!("{}\n", serde_json::to_string(&orden).unwrap());
        if t.entrada.write_all(linea.as_bytes()).await.is_err() {
            return false;
        }
        let _ = t.entrada.flush().await;

        loop {
            let Some(msg) = t.salida.recv().await else { return false };
            match msg {
                MsgEmbed::Listo { dispositivo, modelo } => {
                    let mut p = self.progreso.lock().unwrap();
                    p.dispositivo = dispositivo;
                    p.modelo = modelo;
                }
                MsgEmbed::Progreso { hechas, .. } => {
                    self.progreso.lock().unwrap().hechas = hechas;
                }
                MsgEmbed::Saltada { ruta, motivo, .. } => {
                    // RESULTADO, no avería: se anota y no vuelve a la cola.
                    if let Some(id) = por_ruta.get(&ruta) {
                        let _ = self.almacen.marcar_saltada(*id, &motivo);
                    }
                    self.progreso.lock().unwrap().saltadas += 1;
                }
                MsgEmbed::Fallo { motivo, .. } => {
                    let _ = self.almacen.estado_lote(lote_id, "error", Some(&motivo));
                    return true;
                }
                MsgEmbed::Vectores { dims, cuenta, fichero, imagenes, .. } => {
                    let ok = self
                        .guardar(qdrant, coleccion, &fichero, dims, cuenta, &imagenes, &por_ruta, modelo)
                        .await;
                    // El temporal es del trabajador y ya no hace falta; si se
                    // quedara, una indexación larga llenaría /tmp sola.
                    let _ = std::fs::remove_file(&fichero);
                    if let Err(e) = ok {
                        self.log.apuntar(format!("cola: no se pudieron guardar los vectores: {e}"));
                        let _ = self.almacen.estado_lote(lote_id, "error", Some(&e.to_string()));
                    }
                    return true;
                }
            }
        }
    }

    #[allow(clippy::too_many_arguments)]
    async fn guardar(
        &self,
        qdrant: &Cliente,
        coleccion: &str,
        fichero: &str,
        dims: u32,
        cuenta: u32,
        imagenes: &[String],
        por_ruta: &std::collections::HashMap<String, i64>,
        modelo: &str,
    ) -> Result<()> {
        let bytes = std::fs::read(fichero)?;
        let esperado = cuenta as usize * dims as usize * 4;
        if bytes.len() != esperado {
            bail!("el fichero de vectores mide {} y debería medir {esperado}", bytes.len());
        }
        let mut vectores = Vec::with_capacity(cuenta as usize);
        for i in 0..cuenta as usize {
            let base = i * dims as usize * 4;
            vectores.push(
                (0..dims as usize)
                    .map(|j| {
                        let o = base + j * 4;
                        f32::from_le_bytes(bytes[o..o + 4].try_into().unwrap())
                    })
                    .collect::<Vec<f32>>(),
            );
        }
        let ids: Vec<i64> = imagenes.iter().filter_map(|r| por_ruta.get(r).copied()).collect();
        if ids.len() != vectores.len() {
            bail!("el trabajador devolvió rutas que no había pedido");
        }
        let quadkeys: Vec<String> =
            ids.iter().map(|id| self.almacen.quadkey_de_imagen(*id).unwrap_or_default()).collect();
        qdrant.subir(coleccion, &ids, &vectores, &quadkeys).await?;
        for id in &ids {
            self.almacen.marcar_vector(*id, modelo, "hecho")?;
        }
        Ok(())
    }
}
```

- [ ] **Step 5: Engancharla y exponerla**

En `indexer/src-tauri/src/lib.rs`: `mod queue;`, envolver el almacén en `Arc`, guardar `cola: Arc<queue::Cola>` en `Estado`, lanzar el bucle tras arrancar los servicios, y añadir:

```rust
#[tauri::command]
fn cola_progreso(estado: tauri::State<'_, Estado>) -> queue::Progreso {
    estado.cola.progreso()
}

#[tauri::command]
fn cola_pausar(estado: tauri::State<'_, Estado>, pausada: bool) {
    estado.cola.pausar(pausada);
}
```

- [ ] **Step 6: Comprobar**

Run: `cargo test -p lumi-index && cargo check --manifest-path indexer/src-tauri/Cargo.toml`
Expected: 8 tests en verde y el backend compilando.

- [ ] **Step 7: Commit**

```bash
git add crates/lumi-index indexer
git commit -m "La cola: un resultado se anota, una averia vuelve una sola vez"
```

---

### Task 13: Los dos orígenes locales

**Files:**
- Create: `indexer/src-tauri/src/ingest.rs`
- Create: `indexer/src/ingest/FolderImportDialog.tsx`, `indexer/src/ingest/LegacyImportDialog.tsx`, `indexer/src/ingest/IngestView.tsx`
- Modify: `indexer/src-tauri/src/lib.rs`, `indexer/src-tauri/Cargo.toml`, `indexer/src/lib/api.ts`

**Interfaces:**
- Consumes: `lumi_index::legacy`, `lumi_index::tiles::quadkey`, `Almacen`.
- Produces: comandos `ingesta_carpeta(indice_id, ruta, tipo, fuente, licencia) -> Resumen` e `ingesta_legacy(indice_id, ruta, tipo, fuente, declarada) -> Resumen`, con `Resumen { lote_id, aceptadas, saltadas, con_vector }`.

- [ ] **Step 1: Añadir las dependencias**

En `indexer/src-tauri/Cargo.toml`:

```toml
image = { version = "0.25", default-features = false, features = ["jpeg", "png", "webp"] }
kamadak-exif = "0.5"
sha2 = "0.10"
tempfile = "3"
```

- [ ] **Step 2: Escribir la ingesta**

`indexer/src-tauri/src/ingest.rs`:

```rust
//! Los dos orígenes del 7a: una carpeta del operador y un paquete cifrado de
//! la v1.
//!
//! Todo lo que viene de fuera entra por un directorio de STAGING, y cualquier
//! fallo lo tira entero sin escribir nada. No es paranoia: en la v1 el nombre
//! sin sanear de una imagen era escritura de fichero arbitraria, y aquí el
//! material puede venir del repositorio de un desconocido.

use std::io::Read;
use std::path::{Path, PathBuf};

use anyhow::{bail, Context, Result};
use lumi_index::legacy::{descifrar, nombre_seguro, validar_manifiesto, Topes};
use lumi_index::tiles::quadkey;
use serde::Serialize;
use sha2::{Digest, Sha256};

use crate::store::Almacen;

#[derive(Debug, Clone, Default, Serialize)]
pub struct Resumen {
    pub lote_id: i64,
    pub aceptadas: u32,
    pub saltadas: u32,
    /// Cuántas llegaron ya con vector dentro y por tanto no gastan GPU.
    pub con_vector: u32,
    pub motivos: Vec<String>,
}

fn sha256_de(ruta: &Path) -> Result<String> {
    let mut f = std::fs::File::open(ruta)?;
    let mut h = Sha256::new();
    let mut buf = [0u8; 65536];
    loop {
        let n = f.read(&mut buf)?;
        if n == 0 {
            break;
        }
        h.update(&buf[..n]);
    }
    Ok(format!("{:x}", h.finalize()))
}

/// Coordenadas del EXIF. Devuelve `None` si no las trae, que es un motivo de
/// salto y no un error: una foto sin GPS es material inutilizable para un
/// índice, no un fallo de la herramienta.
fn gps_del_exif(ruta: &Path) -> Option<(f64, f64)> {
    let f = std::fs::File::open(ruta).ok()?;
    let mut lector = std::io::BufReader::new(f);
    let exif = exif::Reader::new().read_from_container(&mut lector).ok()?;

    let grados = |campo: exif::Tag, ref_campo: exif::Tag, positivo: char| -> Option<f64> {
        let v = exif.get_field(campo, exif::In::PRIMARY)?;
        let exif::Value::Rational(ref r) = v.value else { return None };
        if r.len() < 3 {
            return None;
        }
        let d = r[0].to_f64() + r[1].to_f64() / 60.0 + r[2].to_f64() / 3600.0;
        let signo = exif
            .get_field(ref_campo, exif::In::PRIMARY)
            .map(|f| f.display_value().to_string())
            .filter(|s| s.starts_with(positivo))
            .map(|_| 1.0)
            .unwrap_or(-1.0);
        Some(d * signo)
    };

    let lat = grados(exif::Tag::GPSLatitude, exif::Tag::GPSLatitudeRef, 'N')?;
    let lng = grados(exif::Tag::GPSLongitude, exif::Tag::GPSLongitudeRef, 'E')?;
    (-90.0..=90.0).contains(&lat).then_some(())?;
    (-180.0..=180.0).contains(&lng).then_some(())?;
    Some((lat, lng))
}

/// `ruta;lat;lng` o `ruta,lat,lng`, una por línea, con cabecera opcional. Es el
/// hermano del EXIF para material que no lo trae.
fn leer_sidecar(dir: &Path) -> std::collections::HashMap<String, (f64, f64)> {
    let mut m = std::collections::HashMap::new();
    for nombre in ["coordenadas.csv", "coords.csv"] {
        let Ok(txt) = std::fs::read_to_string(dir.join(nombre)) else { continue };
        for linea in txt.lines() {
            let campos: Vec<&str> = linea.split([';', ',']).map(|s| s.trim()).collect();
            if campos.len() < 3 {
                continue;
            }
            let (Ok(lat), Ok(lng)) = (campos[1].parse::<f64>(), campos[2].parse::<f64>()) else {
                continue;
            };
            m.insert(campos[0].to_string(), (lat, lng));
        }
    }
    m
}

/// Ingesta desde una carpeta del operador.
///
/// EL FICHERO ORIGINAL NO SE TOCA: se abre en solo lectura y su ruta es lo que
/// se guarda. No se reescribe, no se recomprime y no se le quita el EXIF —
/// regla de cadena de custodia de ARCHITECTURE.md.
#[allow(clippy::too_many_arguments)]
pub fn desde_carpeta(
    almacen: &Almacen,
    indice_id: i64,
    dir: &Path,
    tipo: &str,
    fuente: &str,
    licencia: Option<&str>,
    modelos: &[String],
) -> Result<Resumen> {
    if !dir.is_dir() {
        bail!("{} no es un directorio", dir.display());
    }
    let lote_id = almacen.crear_lote(
        indice_id,
        "carpeta",
        &dir.display().to_string(),
        Some(tipo),
        fuente,
        licencia,
        None,
        true,
    )?;
    let sidecar = leer_sidecar(dir);
    let mut r = Resumen { lote_id, ..Default::default() };

    for entrada in std::fs::read_dir(dir)?.flatten() {
        let ruta = entrada.path();
        let ext = ruta.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
        if !matches!(ext.as_str(), "jpg" | "jpeg" | "png" | "webp") {
            continue;
        }
        let nombre = ruta.file_name().unwrap().to_string_lossy().to_string();

        // Que decodifique de verdad como imagen. La extensión no basta ni
        // siquiera con material propio: un fichero truncado a mitad de copia
        // pasaría igual.
        let dimensiones = image::image_dimensions(&ruta);
        if dimensiones.is_err() {
            r.saltadas += 1;
            r.motivos.push(format!("{nombre} — no decodifica como imagen"));
            continue;
        }

        let Some((lat, lng)) = gps_del_exif(&ruta).or_else(|| sidecar.get(&nombre).copied()) else {
            r.saltadas += 1;
            r.motivos.push(format!("{nombre} — sin coordenadas: ni EXIF GPS ni fila en el CSV"));
            continue;
        };

        let sha = sha256_de(&ruta)?;
        almacen.insertar_imagen(
            indice_id,
            lote_id,
            &ruta.display().to_string(),
            &sha,
            lat,
            lng,
            &quadkey(lat, lng),
            modelos,
        )?;
        r.aceptadas += 1;
    }
    almacen.estado_lote(lote_id, "pendiente", None)?;
    Ok(r)
}

/// Ingesta desde un paquete cifrado de la v1.
///
/// El manifiesto de la v1 NO lleva procedencia: exporta `panoId`, `heading`,
/// coordenadas, embeddings y poco más, y las columnas `provider`/`attribution`
/// de su base de datos se quedaban fuera. Así que la procedencia la declara el
/// operador o queda como `desconocida`, y en cualquiera de los dos casos sale
/// en los porcentajes.
#[allow(clippy::too_many_arguments)]
pub fn desde_legacy(
    almacen: &Almacen,
    indice_id: i64,
    paquete: &Path,
    tipo: Option<&str>,
    fuente: &str,
    declarada_por_operador: bool,
    modelos: &[String],
    destino_imagenes: &Path,
) -> Result<Resumen> {
    let cifrado = std::fs::read(paquete)?;
    let topes = Topes::por_defecto();
    let zip_bytes = descifrar(&cifrado).context("no se pudo descifrar el paquete")?;

    // Los topes se miran sobre lo DECLARADO en el directorio central, antes de
    // descomprimir nada. Mirarlos después ya sería tarde.
    let cursor = std::io::Cursor::new(&zip_bytes);
    let mut zip = zip::ZipArchive::new(cursor)?;
    let declarado: u64 = (0..zip.len())
        .filter_map(|i| zip.by_index_raw(i).ok().map(|f| f.size()))
        .sum();
    topes.comprueba(cifrado.len() as u64, zip.len() as u64, declarado)?;

    // Todo va a un staging; cualquier fallo lo tira entero.
    let stage = tempfile::Builder::new().prefix("lumidx-stage-").tempdir()?;

    let mut manifiesto_bytes = Vec::new();
    zip.by_name("manifest.json")
        .context("el paquete no trae manifest.json")?
        .read_to_end(&mut manifiesto_bytes)?;
    let manifiesto = validar_manifiesto(&manifiesto_bytes)?;

    let lote_id = almacen.crear_lote(
        indice_id,
        "legacy",
        &paquete.display().to_string(),
        tipo,
        fuente,
        None,
        None,
        declarada_por_operador,
    )?;
    let mut r = Resumen { lote_id, ..Default::default() };
    let conocidos: Vec<String> = modelos.to_vec();
    std::fs::create_dir_all(destino_imagenes)?;

    for area in &manifiesto.areas {
        for img in &area.images {
            if !nombre_seguro(&img.pano_id) {
                r.saltadas += 1;
                r.motivos.push(format!("{} — nombre no admisible", img.pano_id));
                continue;
            }
            let nombre = format!("{}_{}.jpg", img.pano_id, img.heading);
            let en_stage = stage.path().join(&nombre);
            let dentro = format!("images/{nombre}");
            let Ok(mut f) = zip.by_name(&dentro) else {
                r.saltadas += 1;
                r.motivos.push(format!("{nombre} — el manifiesto la declara pero no está en el zip"));
                continue;
            };
            let mut bytes = Vec::new();
            f.read_to_end(&mut bytes)?;
            std::fs::write(&en_stage, &bytes)?;
            if image::image_dimensions(&en_stage).is_err() {
                r.saltadas += 1;
                r.motivos.push(format!("{nombre} — no decodifica como imagen"));
                continue;
            }

            let destino = destino_imagenes.join(&nombre);
            std::fs::rename(&en_stage, &destino).or_else(|_| {
                std::fs::copy(&en_stage, &destino).map(|_| ())
            })?;

            // Los vectores vienen dentro. Si el modelo coincide con uno
            // instalado se dan por hechos; si no, la imagen entra SIN vector y
            // la cola la recoge. Es el mecanismo que la v1 tuvo que inventar a
            // posteriori, aquí desde el principio.
            let trae: Vec<String> = img
                .embeddings
                .iter()
                .filter(|(m, v)| v.is_some() && conocidos.contains(m))
                .map(|(m, _)| m.clone())
                .collect();
            let pendientes: Vec<String> =
                conocidos.iter().filter(|m| !trae.contains(m)).cloned().collect();

            let sha = sha256_de(&destino)?;
            let id = almacen.insertar_imagen(
                indice_id,
                lote_id,
                &destino.display().to_string(),
                &sha,
                img.lat,
                img.lng,
                &quadkey(img.lat, img.lng),
                &pendientes,
            )?;
            for m in &trae {
                almacen.marcar_vector(id, m, "hecho")?;
            }
            if !trae.is_empty() {
                r.con_vector += 1;
            }
            r.aceptadas += 1;
        }
    }
    almacen.estado_lote(lote_id, "pendiente", None)?;
    Ok(r)
}
```

- [ ] **Step 3: Exponerla**

En `indexer/src-tauri/src/lib.rs`, `mod ingest;` y:

```rust
#[tauri::command]
fn ingesta_carpeta(
    estado: tauri::State<'_, Estado>,
    indice_id: i64,
    ruta: String,
    tipo: String,
    fuente: String,
    licencia: Option<String>,
) -> Result<ingest::Resumen, String> {
    let modelos: Vec<String> = estado.modelos.iter().map(|m| m.id.clone()).collect();
    ingest::desde_carpeta(
        &estado.almacen,
        indice_id,
        std::path::Path::new(&ruta),
        &tipo,
        &fuente,
        licencia.as_deref(),
        &modelos,
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
fn ingesta_legacy(
    estado: tauri::State<'_, Estado>,
    indice_id: i64,
    ruta: String,
    tipo: Option<String>,
    fuente: String,
    declarada: bool,
) -> Result<ingest::Resumen, String> {
    let modelos: Vec<String> = estado.modelos.iter().map(|m| m.id.clone()).collect();
    let destino = estado.dir.join("imagenes").join(indice_id.to_string());
    ingest::desde_legacy(
        &estado.almacen,
        indice_id,
        std::path::Path::new(&ruta),
        tipo.as_deref(),
        &fuente,
        declarada,
        &modelos,
        &destino,
    )
    .map_err(|e| e.to_string())
}
```

- [ ] **Step 4: Escribir los diálogos**

`indexer/src/ingest/LegacyImportDialog.tsx`, con el bloque ámbar que pide la procedencia que el paquete no trae:

```tsx
import { open } from "@tauri-apps/plugin-dialog";
import { useState } from "react";

import { api, type Resumen } from "../lib/api";
import { Icon } from "../ui/Icon";

const TIPOS = ["calle", "cenital", "suelta"] as const;

export function LegacyImportDialog({ indiceId, onHecho }: { indiceId: number; onHecho: () => void }) {
  const [ruta, setRuta] = useState<string | null>(null);
  const [tipo, setTipo] = useState<(typeof TIPOS)[number]>("calle");
  const [fuente, setFuente] = useState("desconocida");
  const [resumen, setResumen] = useState<Resumen | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function elegir() {
    const r = await open({ multiple: false, filters: [{ name: "Paquete de la v1", extensions: ["enc"] }] });
    if (typeof r === "string") setRuta(r);
  }

  async function importar() {
    if (!ruta) return;
    setError(null);
    try {
      setResumen(await api.ingestaLegacy(indiceId, ruta, tipo, fuente, fuente !== "desconocida"));
      onHecho();
    } catch (e) { setError(String(e)); }
  }

  return (
    <div className="w-[552px] rounded-card border border-white/[.13] bg-[rgba(16,19,25,.66)] p-[20px_22px] backdrop-blur-xl">
      <div className="flex items-center gap-2.5">
        <span className="text-sm text-fg">✦</span>
        <span className="text-sm font-medium text-fg">Importar un paquete de la v1</span>
      </div>
      <button onClick={() => void elegir()}
        className="jg-press mt-3 w-full rounded-lg border border-border px-3 py-2 text-left font-mono text-[10px] text-muted">
        {ruta ?? "elegir bundle.zip.enc…"}
      </button>

      {/* El manifiesto de la v1 no trae procedencia. No se adivina: se pide. */}
      <div className="mt-4 rounded-lg border border-warning/[.3] bg-warning/[.05] p-3">
        <div className="flex items-start gap-2">
          <Icon name="alert" size={13} className="mt-px shrink-0 text-warning-fg" />
          <div>
            <p className="text-[11.5px] text-warning-fg">Este paquete no dice de dónde salieron sus imágenes</p>
            <p className="mt-1 text-[10.5px] leading-snug text-muted">
              El manifiesto de la v1 lleva coordenadas y vectores, pero no proveedor ni atribución.
              Puedes declararlo tú si lo sabes; quedará anotado como declarado por el operador, no
              leído del material.
            </p>
          </div>
        </div>
        <div className="mt-3 flex gap-2">
          <div className="flex-1">
            <p className="text-[8px] uppercase tracking-[.11em] text-subtle">Tipo</p>
            <div className="mt-1.5 flex gap-1.5">
              {TIPOS.map((t) => (
                <button key={t} onClick={() => setTipo(t)}
                  className={`rounded-md border px-2.5 py-1 text-[11px] ${
                    tipo === t ? "border-white/[.28] text-fg" : "border-border text-subtle"}`}>
                  {t}
                </button>
              ))}
            </div>
          </div>
          <div className="w-[214px]">
            <p className="text-[8px] uppercase tracking-[.11em] text-subtle">Fuente</p>
            <input value={fuente} onChange={(e) => setFuente(e.target.value)}
              className={`mt-1.5 w-full rounded-md border border-border bg-[#0d0f12] px-2.5 py-1.5 text-[11px] outline-none ${
                fuente === "desconocida" ? "text-warning-fg" : "text-fg"}`} />
          </div>
        </div>
      </div>

      {resumen && (
        <p className="mt-3 font-mono text-[10px] text-muted">
          {resumen.aceptadas} aceptadas · {resumen.con_vector} ya traían vector · {resumen.saltadas} saltadas
        </p>
      )}
      {error && <p className="mt-3 text-[11px] text-danger-fg">{error}</p>}

      <div className="mt-4 flex items-center justify-between">
        <span className="font-mono text-[9.5px] text-subtle">los vectores vienen dentro · no se gasta GPU</span>
        <button onClick={() => void importar()} disabled={!ruta}
          className="jg-press rounded-lg bg-accent px-4 py-2 text-[11.5px] font-medium text-black disabled:opacity-40">
          Importar
        </button>
      </div>
    </div>
  );
}
```

`indexer/src/ingest/FolderImportDialog.tsx`: mismo esqueleto, con `open({ directory: true })`, los tres botones de tipo, un campo de fuente que arranca en `carpeta:` y uno de licencia, llamando a `api.ingestaCarpeta`. Añadir bajo los campos la línea que fija la regla:

```tsx
      <p className="mt-3 font-mono text-[9.5px] text-subtle">
        el fichero original no se reescribe, ni se recomprime, ni se le quita el EXIF
      </p>
```

`indexer/src/ingest/IngestView.tsx` monta los dos diálogos tras dos botones y, debajo, la lista de saltadas del resumen con su motivo, cada línea en mono.

En `indexer/src/lib/api.ts`:

```ts
export interface Resumen { lote_id: number; aceptadas: number; saltadas: number; con_vector: number; motivos: string[] }
```

```ts
  ingestaCarpeta: (indiceId: number, ruta: string, tipo: string, fuente: string, licencia: string | null) =>
    invoke<Resumen>("ingesta_carpeta", { indiceId, ruta, tipo, fuente, licencia }),
  ingestaLegacy: (indiceId: number, ruta: string, tipo: string, fuente: string, declarada: boolean) =>
    invoke<Resumen>("ingesta_legacy", { indiceId, ruta, tipo, fuente, declarada }),
```

- [ ] **Step 5: Comprobar contra una carpeta real**

Run: `cargo check --manifest-path indexer/src-tauri/Cargo.toml && cd indexer && npm run build`
Expected: los dos sin errores.

Manual: crear `/tmp/fotos` con dos JPEG con GPS en el EXIF, uno sin GPS y un `.jpg` que en realidad sea texto. Importar la carpeta.
Expected: `aceptadas: 2`, `saltadas: 2`, y los motivos exactos «sin coordenadas: ni EXIF GPS ni fila en el CSV» y «no decodifica como imagen». Comprobar con `ls -la --time-style=full-iso /tmp/fotos` que **ninguna** fecha de modificación cambió.

- [ ] **Step 6: Commit**

```bash
git add indexer
git commit -m "Ingerir una carpeta y un paquete de la v1, sin tocar el original"
```

---

### Task 14: El catálogo de índices y su detalle

**Files:**
- Create: `indexer/src/catalog/IndexList.tsx`, `indexer/src/catalog/IndexRow.tsx`, `indexer/src/catalog/IndexDetail.tsx`, `indexer/src/catalog/ProvenanceBar.tsx`, `indexer/src/catalog/ProvenanceTable.tsx`
- Create: `indexer/src/ui/Rail.tsx`
- Modify: `indexer/src-tauri/src/lib.rs`, `indexer/src/App.tsx`, `indexer/src/lib/api.ts`

**Interfaces:**
- Consumes: `Almacen::filas_procedencia`, `Almacen::teselas_trabajo`, `lumi_index::manifest::{porcentajes, porcentajes_trabajo}`.
- Produces: comandos `indices_lista() -> Vec<ResumenIndice>` e `indice_detalle(id) -> DetalleIndice`; `ResumenIndice { id, nombre, slug, estado, imagenes, teselas, bytes, imagenes_pct: PorcentajesImagenes }`.

- [ ] **Step 1: Exponer los porcentajes**

En `indexer/src-tauri/src/lib.rs`:

```rust
#[derive(serde::Serialize)]
struct DetalleIndice {
    imagenes: lumi_index::manifest::PorcentajesImagenes,
    trabajo: Vec<(String, u32, f64)>,
}

#[tauri::command]
fn indice_detalle(estado: tauri::State<'_, Estado>, id: i64) -> Result<DetalleIndice, String> {
    let filas = estado.almacen.filas_procedencia(id).map_err(|e| e.to_string())?;
    let teselas = estado.almacen.teselas_trabajo(id).map_err(|e| e.to_string())?;
    Ok(DetalleIndice {
        imagenes: lumi_index::manifest::porcentajes(&filas),
        trabajo: lumi_index::manifest::porcentajes_trabajo(&teselas),
    })
}
```

Y `indices_lista`, que devuelve por índice el nombre, el estado y los mismos porcentajes, para que la fila del catálogo pueda pintar su barra sin abrir el detalle.

- [ ] **Step 2: Escribir la barra de procedencia**

`indexer/src/catalog/ProvenanceBar.tsx`:

```tsx
import type { PctTipo } from "../lib/api";

/** La rampa de neutros para los tres tipos reales, y `warning` para lo
 *  desconocido — que no es una categoría más, es una advertencia sobre lo que
 *  el índice no sabe de sí mismo. Ni un color fuera de DESIGN.md. */
const COLOR: Record<string, string> = {
  calle: "bg-fg",
  cenital: "bg-muted",
  suelta: "bg-subtle",
};

export function ProvenanceBar({
  tipos,
  desconocidaPct,
}: {
  tipos: PctTipo[];
  desconocidaPct: number;
}) {
  return (
    <>
      <div className="flex h-[5px] overflow-hidden rounded-[3px] bg-elevated">
        {tipos.map((t) => (
          <i key={t.tipo} className={COLOR[t.tipo]} style={{ width: `${t.imagenes_pct}%` }} />
        ))}
        {desconocidaPct > 0 && <i className="bg-warning" style={{ width: `${desconocidaPct}%` }} />}
      </div>
      <div className="mt-[9px] flex flex-wrap gap-3">
        {tipos.map((t) => (
          <div key={t.tipo} className="flex items-center gap-1.5 text-[10.5px] text-muted">
            <s className={`block h-[7px] w-[7px] rounded-sm no-underline ${COLOR[t.tipo]}`} />
            {t.tipo} <b className="font-mono font-normal text-fg">{t.imagenes_pct.toFixed(0)} %</b>
          </div>
        ))}
        {desconocidaPct > 0 && (
          <div className="flex items-center gap-1.5 text-[10.5px] text-warning-fg">
            <s className="block h-[7px] w-[7px] rounded-sm bg-warning no-underline" />
            desconocida <b className="font-mono font-normal">{desconocidaPct.toFixed(0)} %</b>
          </div>
        )}
      </div>
    </>
  );
}
```

- [ ] **Step 3: Escribir la tabla de las dos procedencias**

`indexer/src/catalog/ProvenanceTable.tsx` pinta dos tablas lado a lado. La de imágenes lleva columnas «Por imágenes» y «Por territorio · z14», y **debajo, siempre, la línea que explica la suma**:

```tsx
      <p className="mt-[9px] font-mono text-[9.5px] text-subtle">
        territorio suma {p.territorio_suma.toFixed(0)} % · dos orígenes pueden cubrir la misma tesela
      </p>
```

La del trabajo lleva «Teselas» y «Cuota», y su propia nota:

```tsx
      <p className="mt-[9px] font-mono text-[9.5px] text-subtle">
        suma 100 % · una tesela la indexó exactamente uno
      </p>
```

- [ ] **Step 4: Escribir el carril, la lista y el detalle**

`indexer/src/ui/Rail.tsx` reproduce el carril de 44 px de `client/src/work/Rail.tsx` con cuatro destinos: `layers` (Índices), `territorio`, `ingesta` y, abajo del todo, los ajustes. El activo lleva `bg-white/[.07]` y la pestaña de 2 px a la izquierda.

`indexer/src/catalog/IndexRow.tsx` es la fila: nombre, la insignia de estado (`sellado` / `indexando`), la insignia ámbar de procedencia desconocida cuando pasa del 0 %, las cuatro cifras en mono, y la `ProvenanceBar`.

`indexer/src/catalog/IndexList.tsx` monta la cabecera con «+ Nuevo índice» y la lista.

`indexer/src/catalog/IndexDetail.tsx` monta la `ProvenanceTable` y, a la derecha, la lista de lotes con su clase, su origen y sus insignias.

- [ ] **Step 5: Enrutarlo en `App.tsx`**

Sustituir el bloque de `dentro` por un `useState<"indices" | "territorio" | "ingesta">("indices")` con el `Rail` a la izquierda y la vista correspondiente a la derecha.

- [ ] **Step 6: Comprobar**

Run: `cd indexer && npm run build`
Expected: sin errores.

Manual: con la carpeta de la tarea 13 ya ingerida, abrir el detalle.
Expected: las dos tablas; la de imágenes con su nota de suma, la del trabajo vacía todavía (no hay teselas anotadas hasta la tarea 15).

- [ ] **Step 7: Commit**

```bash
git add indexer
git commit -m "El catalogo, con la procedencia en la propia fila"
```

---

### Task 15: Territorio, y no indexar nunca lo mismo dos veces

**Files:**
- Create: `indexer/src-tauri/src/territory.rs`
- Create: `indexer/src/territory/TerritoryView.tsx`, `indexer/src/territory/MapCanvas.tsx`, `indexer/src/territory/CoveragePanel.tsx`, `indexer/src/territory/PlanDialog.tsx`, `indexer/src/territory/BlockedDialog.tsx`
- Modify: `indexer/src-tauri/src/lib.rs`, `indexer/src/lib/api.ts`

**Interfaces:**
- Consumes: `lumi_index::tiles::{Punto, teselas_de_poligono}`, `lumi_index::coverage::{Cobertura, clasificar, repartir}`.
- Produces: comandos `territorio_clasificar(poligono: Vec<Punto>) -> Clasificacion` y `mapbox_clave_guardar/leer`. `Clasificacion { teselas: Vec<(String, Estado)>, reparto: Reparto, autores: Vec<(String, u32)> }`.

- [ ] **Step 1: Escribir la clasificación**

`indexer/src-tauri/src/territory.rs`:

```rust
//! Dibujar un área y saber qué parte de ella no hace falta indexar.
//!
//! La cobertura del territorio es planetaria y compartida. Volver a descargar y
//! reembeber una tesela que alguien ya publicó es tirar cuota del proveedor y
//! horas de GPU para llegar al mismo sitio.

use std::path::Path;

use anyhow::Result;
use lumi_index::coverage::{clasificar, repartir, Cobertura, Estado, Reparto};
use lumi_index::tiles::{teselas_de_poligono, Punto};
use serde::Serialize;

#[derive(Serialize)]
pub struct Clasificacion {
    pub teselas: Vec<(String, Estado)>,
    pub locales: usize,
    pub catalogo: usize,
    pub nuevas: usize,
    pub bytes_a_descargar: u64,
    /// Quién publicó lo que se va a heredar, para poder atribuirlo antes de
    /// empezar y no después.
    pub autores: Vec<(String, u32)>,
}

/// Lee el `cobertura.json` de cada paquete instalado. El mismo camino de código
/// sirve para lo local y para lo publicado: la única diferencia es de dónde
/// salen los bytes.
pub fn coberturas_locales(dir_paquetes: &Path) -> Vec<Cobertura> {
    let Ok(entradas) = std::fs::read_dir(dir_paquetes) else { return Vec::new() };
    entradas
        .flatten()
        .filter_map(|e| {
            let c = e.path().join("cobertura.json");
            let bytes = std::fs::read(&c).ok()?;
            match serde_json::from_slice::<Cobertura>(&bytes) {
                Ok(c) => Some(c),
                Err(err) => {
                    log::warn!("cobertura ilegible en {}: {err}", e.path().display());
                    None
                }
            }
        })
        .collect()
}

pub fn clasificar_area(
    poligono: &[Punto],
    locales: &[Cobertura],
    catalogo: &[Cobertura],
) -> Result<Clasificacion> {
    let pedidas = teselas_de_poligono(poligono);
    let teselas = clasificar(&pedidas, locales, catalogo);
    let Reparto { locales: l, catalogo: c, nuevas, bytes_a_descargar } = repartir(&teselas);

    let mut autores: std::collections::BTreeMap<String, u32> = Default::default();
    for (_, e) in &teselas {
        if let Estado::Catalogo { indice, .. } = e {
            *autores.entry(indice.clone()).or_default() += 1;
        }
    }
    let mut autores: Vec<(String, u32)> = autores.into_iter().collect();
    autores.sort_by(|a, b| b.1.cmp(&a.1));

    Ok(Clasificacion {
        teselas,
        locales: l,
        catalogo: c,
        nuevas,
        bytes_a_descargar,
        autores,
    })
}
```

- [ ] **Step 2: Escribir el mapa**

`indexer/src/territory/MapCanvas.tsx` monta Mapbox GL con la clave del operador (leída con `api.mapboxClave()`), estilo `mapbox://styles/mapbox/dark-v11`, y dibuja tres capas:

- el polígono en curso, relleno `rgba(55,138,221,.07)` y borde `#85b7eb` de 1.6 px;
- las teselas clasificadas, como un `FeatureCollection` de polígonos con la propiedad `estado`, pintadas con `fill-color` por expresión: `local` → `rgba(232,232,230,.13)`, `catalogo` → `rgba(55,138,221,.15)`, `nuevo` → `rgba(255,255,255,.015)`;
- sus bordes, con `line-dasharray` **solo** para `nuevo`.

El punteado gris no es ámbar a propósito: una tesela sin indexar es una **ausencia**, no una advertencia, y el ámbar queda reservado para el bloqueo.

La animación de cámara usa la misma curva que el cliente:

```ts
/** Ease-out cúbico, la misma curva que MapCanvas del subsistema 6, para que
 *  los vuelos se sientan igual en las dos aplicaciones. Nunca `essential`:
 *  eso pisa el «reducir movimiento» del sistema operativo. */
const EASE_OUT_CUBIC = (t: number) => 1 - Math.pow(1 - t, 3);
```

- [ ] **Step 3: Escribir el panel de cobertura**

`indexer/src/territory/CoveragePanel.tsx` es el panel derecho de 328 px: superficie y teselas arriba, la barra de tres estados, las tres filas con su cuenta, la lista de quién publicó lo azul, y el bloque de coste con **solo lo punteado**:

```tsx
      <p className="mt-[11px] flex items-start gap-[7px] text-[10.5px] leading-snug text-subtle">
        <Icon name="info" size={12} className="mt-px shrink-0" />
        Las {c.locales + c.catalogo} teselas que ya existen no se vuelven a descargar del
        proveedor ni se vuelven a embeber.
      </p>
```

- [ ] **Step 4: Escribir el bloqueo y el plan**

`indexer/src/territory/BlockedDialog.tsx` se muestra cuando `c.nuevas === 0`. **No lleva un botón de indexar apagado**: un botón deshabilitado dice «podrías, pero no te dejo», y aquí no hay trabajo que hacer. Lleva el icono grande de candado de 32 px en `warning` con su halo, la lista de qué índices la cubren, la salida honesta en letra pequeña, y dos botones: «Ajustar el área» e «Instalar lo que existe».

```tsx
        <p className="mt-[13px] flex items-start gap-[7px] text-[10.5px] leading-snug text-subtle">
          <Icon name="info" size={12} className="mt-px shrink-0" />
          Si crees que el material existente está desfasado, amplía la selección o pide una
          recaptura desde el detalle de la tesela. Lo que no hay es un botón de rehacerlo porque sí.
        </p>
```

`indexer/src/territory/PlanDialog.tsx` muestra los tres grupos **en el orden en que se ejecutan**: primero lo que se adjunta, después lo que se descarga con su atribución y su licencia, y al final lo que se indexa nuevo con sus tres cifras. Cierra con la línea que anticipa el resultado:

```tsx
      <div className="mt-3.5 rounded-lg border border-border bg-[#0b0d0f] px-3 py-2.5">
        <p className="font-mono text-[10px] leading-[1.85] text-muted">
          Al terminar, «{nombre}» será{" "}
          <b className="font-normal text-fg">{heredadoPct} % trabajo heredado</b> y{" "}
          <b className="font-normal text-fg">{100 - heredadoPct} % indexado aquí</b>.<br />
          <em className="not-italic text-subtle">
            Eso queda escrito en el manifiesto y se enseña en el catálogo.
          </em>
        </p>
      </div>
```

Al confirmar, el orden importa: se llama primero a `anotar_tesela` para todas las locales y del catálogo, y solo después se crean los lotes de lo nuevo. **Si el trabajo se interrumpe a la mitad, lo heredado ya está dentro y lo que falta sigue siendo exactamente lo punteado.**

- [ ] **Step 5: Comprobar**

Run: `cargo check --manifest-path indexer/src-tauri/Cargo.toml && cd indexer && npm run build`
Expected: los dos sin errores.

Manual: sellar un índice pequeño (tarea 16) y volver a dibujar la misma zona.
Expected: todas las teselas salen sólidas blancas, el panel dice `0` nuevas, y aparece el diálogo de bloqueo en vez del plan.

- [ ] **Step 6: Commit**

```bash
git add indexer
git commit -m "Dibujar territorio, y negarse a indexar lo que ya existe"
```

---

### Task 16: Sellar, abrir, y el README

**Files:**
- Create: `indexer/src-tauri/src/package.rs`
- Create: `indexer/src/seal/SealDialog.tsx`
- Create: `indexer/README.md`
- Modify: `indexer/src-tauri/src/lib.rs`, `ARCHITECTURE.md`

**Interfaces:**
- Consumes: todo lo anterior.
- Produces: comandos `paquete_sellar(indice_id, destino) -> Result<Informe>` y `paquete_abrir(ruta) -> Result<()>`. `Informe { filas, por_modelo: Vec<(String, u32, u32)>, cuadra: bool }`.

- [ ] **Step 1: Escribir el sellado**

`indexer/src-tauri/src/package.rs`:

```rust
//! Sellar y abrir un paquete `.lumidx`.
//!
//! El paquete es el formato de TRANSPORTE y de ARCHIVO; Qdrant es el almacén de
//! TRABAJO. Un directorio de Qdrant es un formato atado a su versión, no un
//! formato de archivo: dentro de veinte años un fichero plano de float32 se
//! sigue leyendo con cinco líneas de código, y en una herramienta forense eso
//! es la diferencia entre poder defender un resultado y no poder.
//!
//! Sellar es IRREVERSIBLE: un paquete sellado no se sigue llenando.

use std::io::Write;
use std::path::Path;

use anyhow::{bail, Result};
use lumi_index::vectors::{escribir_b1, escribir_i8};
use serde::Serialize;
use sha2::{Digest, Sha256};

#[derive(Debug, Clone, Serialize)]
pub struct Informe {
    pub filas: u32,
    /// `(modelo, filas esperadas, vectores encontrados)`.
    pub por_modelo: Vec<(String, u32, u32)>,
    pub cuadra: bool,
}

/// Cuenta filas contra vectores y NO declara éxito si no cuadran. Es lo que
/// hacía el script de migración de la v1 y es la parte que importa: un paquete
/// sellado a medias es peor que ninguno, porque parece bueno.
pub fn comprobar(informe: &Informe) -> Result<()> {
    if !informe.cuadra {
        let faltan: Vec<String> = informe
            .por_modelo
            .iter()
            .filter(|(_, e, v)| e != v)
            .map(|(m, e, v)| format!("{m}: {v} de {e}"))
            .collect();
        bail!("las filas no cuadran con los vectores — {}", faltan.join("; "));
    }
    Ok(())
}

/// Escribe SHA256SUMS con una línea `<hash>  <ruta relativa>` por fichero,
/// recorriendo el paquete en orden. Es lo que hace comprobable la autoría de un
/// fragmento heredado: quitar su atribución rompería este fichero.
pub fn firmar(raiz: &Path) -> Result<()> {
    let mut lineas = Vec::new();
    recorrer(raiz, raiz, &mut lineas)?;
    lineas.sort();
    let mut f = std::fs::File::create(raiz.join("SHA256SUMS"))?;
    for l in lineas {
        writeln!(f, "{l}")?;
    }
    Ok(())
}

fn recorrer(raiz: &Path, dir: &Path, fuera: &mut Vec<String>) -> Result<()> {
    for e in std::fs::read_dir(dir)?.flatten() {
        let p = e.path();
        if p.is_dir() {
            recorrer(raiz, &p, fuera)?;
            continue;
        }
        if p.file_name().and_then(|n| n.to_str()) == Some("SHA256SUMS") {
            continue;
        }
        let bytes = std::fs::read(&p)?;
        let rel = p.strip_prefix(raiz)?.display().to_string().replace('\\', "/");
        fuera.push(format!("{:x}  {rel}", Sha256::digest(&bytes)));
    }
    Ok(())
}

/// Verifica SHA256SUMS antes de tocar nada. Si un fichero no cuadra, el paquete
/// NO se abre — no se abre «con avisos».
pub fn verificar(raiz: &Path) -> Result<()> {
    let sumas = std::fs::read_to_string(raiz.join("SHA256SUMS"))
        .map_err(|_| anyhow::anyhow!("el paquete no trae SHA256SUMS"))?;
    for linea in sumas.lines() {
        let Some((hash, rel)) = linea.split_once("  ") else {
            bail!("línea ilegible en SHA256SUMS: {linea}");
        };
        let bytes = std::fs::read(raiz.join(rel))
            .map_err(|_| anyhow::anyhow!("SHA256SUMS nombra un fichero que no está: {rel}"))?;
        if format!("{:x}", Sha256::digest(&bytes)) != hash {
            bail!("{rel} no cuadra con su hash: el paquete está alterado o corrupto");
        }
    }
    Ok(())
}

/// Escribe los dos ficheros de vectores de un fragmento.
pub fn escribir_fragmento(dir: &Path, modelo: &str, version: &str, vs: &[Vec<f32>]) -> Result<()> {
    std::fs::create_dir_all(dir)?;
    let base = format!("{modelo}-{version}");
    escribir_b1(&mut std::fs::File::create(dir.join(format!("{base}.b1")))?, vs)?;
    escribir_i8(&mut std::fs::File::create(dir.join(format!("{base}.i8")))?, vs)?;
    Ok(())
}
```

El comando `paquete_sellar` en `lib.rs`: construye el informe con `Almacen::sin_vector` por modelo, llama a `comprobar` y **aborta antes de escribir un solo byte si no cuadra**; después, por cada quadkey del índice, lee sus vectores de Qdrant **en el orden de `indice.db`**, llama a `escribir_fragmento`, copia las imágenes, escribe `manifiesto.json` con `porcentajes` y `porcentajes_trabajo`, escribe `cobertura.json` con el hash de cada fragmento, llama a `firmar`, y marca el índice como `sellado`.

- [ ] **Step 2: Escribir el diálogo**

`indexer/src/seal/SealDialog.tsx` con el icono grande de candado en `warning`, las filas del informe (verde no existe: lo que cuadra va con `check` blanco, lo que no con el triángulo en `danger-fg` y fondo `bg-danger/[.07]`), la línea que explica por qué está apagado, el árbol de lo que se escribirá, y los dos botones — «Terminar de embeber» y «Sellar», este último deshabilitado mientras `!informe.cuadra`.

- [ ] **Step 3: Escribir el README**

`indexer/README.md` con: qué es y qué no (app autónoma, sin cuentas ni servidor), **Linux primero y por qué** (Redis no tiene binario oficial para Windows; en Windows va dentro de WSL), los requisitos previos (`redis-server`, `qdrant` y `python3` en el PATH), cómo arrancarlo (`python tools/build.py indexer`), dónde vive todo (`~/.lumi-indexer`, o `LUMI_INDEXER_DATA`), la estructura de un `.lumidx`, y la regla de no indexar dos veces con su salida pendiente.

- [ ] **Step 4: Cerrar la ficha en `ARCHITECTURE.md`**

En la tabla de §5, cambiar el estado del 7a de `Spec escrita` a `Terminado`.

- [ ] **Step 5: Comprobar de punta a punta**

Run: `cargo test -p lumi-index -p lumi-proto`
Expected: PASS — 8 de `lumi-index` y los de `lumi-proto` que ya existían.

Run: `cargo check --manifest-path indexer/src-tauri/Cargo.toml && cd indexer && npm run build`
Expected: los dos sin errores.

Manual, el camino entero: crear un índice, ingerir `/tmp/fotos`, esperar a que la cola lo embeba, y sellar.
Expected: el diálogo enseña filas y vectores cuadrando, el botón se enciende, y en el destino aparece el `.lumidx` con `manifiesto.json`, `indice.db`, `cobertura.json`, `fragmentos/<quadkey z14>/` y `SHA256SUMS`.

Manual, la negativa: borrar a mano un fichero `.i8` de un fragmento y abrir el paquete.
Expected: se niega a abrirlo nombrando el fichero, sin importar nada.

Manual, la regla: dibujar sobre la zona recién sellada.
Expected: cero teselas nuevas y el diálogo de bloqueo.

- [ ] **Step 6: Commit**

```bash
git add indexer ARCHITECTURE.md
git commit -m "Sellar contando, abrir verificando, y el README que lo explica"
```

---

## Autorrevisión

**Cobertura de la spec.** §1 y §2 → tareas 1 y 7 (el orden y el alcance se materializan en el crate y la app). §3 → tarea 7, con el aviso de Linux en la 9 y la clave de Mapbox en la 15. §4 → tareas 8, 9 y 12. §5 → tareas 1, 4 y 16. §6 → tareas 3, 13 y 14. §7 → tareas 2 y 15. §8 → tareas 5 y 13. §9 → tarea 11. §10 → tarea 12. §11 → tarea 16. §12 → tareas 5, 8, 9 y 13. §13, las seis pruebas → tareas 1 (clasificación en la 2), 3, 4, 5 y 12. §14 y §15 no son trabajo de este plan: son `FUTURO.md` y otras piezas, y la tarea 16 no los toca a propósito.

**Huecos que encontré y cerré al revisar:**

- La prueba 6 de la spec («un área totalmente cubierta devuelve cero teselas nuevas») no tenía tarea propia: estaba implícita en la clasificación. Está ahora dentro del test de la tarea 2, con sus dos asertos explícitos.
- `Almacen::quadkey_de_imagen` la usa la tarea 12 y no estaba declarada en la tarea 8. Añadida en el paso 3 de la tarea 12, que es donde hace falta.
- La tarea 12 dependía de `marcar_saltada`, que sí existe desde la 8, pero de `estado_lote` y `sumar_reintento`, que no. Los tres están ahora en el mismo paso.

**Consistencia de tipos.** `Estado` de `coverage` (tres variantes) y `EstadoServicio` de `services` comparten raíz de nombre pero viven en módulos distintos y no se cruzan en ninguna firma. `TrabajoDe` se define en `manifest` y lo consume `store`; `Cobertura` se define en `coverage` y lo consumen `territory` y `package`. `coleccion_de(modelo, version)` se usa con la misma pareja en las tareas 9, 12 y 16.

