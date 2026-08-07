# Lumi Indexer 7b — orígenes de red · plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** dar al Lumi Indexer seis orígenes de red detrás de un contrato por tesela, con
disponibilidad visible en el mapa, coste estimado y confirmado antes de gastar, descarga
reanudable con atribución, y un filtro de redistribución al publicar.

**Architecture:** lo puro va a `crates/lumi-index` (tipos del contrato, presupuesto, reglas
del filtro, muestreo de calles) y se prueba sin red ni GPU. Lo que habla con internet va a
`indexer/src-tauri/src/origins/`, detrás de un `trait OrigenDeRed` con un origen falso que
permite probar el planificador entero sin salir a la red. El 7b **no toca la cola de
embebido**: deja ficheros en disco y filas en `imagenes`, y la cola del 7a los recoge sola.

**Tech Stack:** Rust 1.77.2, Tauri 2.11, `reqwest` (rustls), `rusqlite` (bundled), React 19 +
Vite + Tailwind 3, Mapbox GL JS 3.

**Spec:** [`2026-08-07-lumi-indexer-7b-design.md`](../specs/2026-08-07-lumi-indexer-7b-design.md).
**Maquetas:** [`lumi-s7b-mockups.html`](../specs/lumi-s7b-mockups.html).

---

## Global Constraints

Todas las tareas heredan esto. Los valores son literales y se copian tal cual.

- **Identificadores, comentarios y mensajes en español.** Los comentarios explican *por qué*,
  no *qué*. Un commit por funcionalidad terminada.
- **`ponytail`:** lo más simple que funciona. Cuando se asume un techo, se escribe un
  comentario `// ponytail:` que nombra el techo **y la salida**.
- **Zoom único z14** (`lumi_index::tiles::Z`). Ninguna tarea introduce otro nivel salvo el
  zoom interno del cenital de Mapbox (z17), que nunca sale del adaptador.
- **El sondeo NUNCA se dispara al mover el mapa.** Solo sobre las teselas del polígono
  dibujado y solo por acción explícita del operador.
- **Solo se apunta en `gasto` lo que el proveedor SIRVIÓ.** Una petición que falla y no
  devuelve imagen no se cobra ni se cuenta. Los sondeos de metadatos de Google son gratuitos
  y no se apuntan nunca.
- **El tope mensual rechaza el trabajo ENTERO.** `gastado + previsto > tope` ⇒ error, nunca
  una descarga parcial.
- **La atribución viaja DENTRO de `Captura`**, no al lado. No puede existir un camino de
  código por el que una imagen llegue a `imagenes` sin ella.
- **Dos clases de fallo, y no se tratan igual.** «esta imagen no se puede bajar o no
  decodifica» es un RESULTADO: se anota el motivo, se salta, no se reintenta nunca. Que se
  caiga el proceso o la red es una AVERÍA: la pareja tesela × origen vuelve **una** vez, con
  el contador `reintentos`.
- **Nada de fuera toca el índice sin pasar por el directorio de paso:** tope de tamaño antes
  de descomprimir, lista blanca de nombres que rechaza `..` en cualquier posición, y cada
  fichero tiene que decodificar de verdad como imagen.
- **Las claves van cifradas** con `Maestra::sellar` en `ajustes.sellado`. Nunca en claro en
  disco, nunca dentro de un paquete, y **redactadas antes de escribir cualquier URL al log**.
- **Un origen sin clave no aparece como disponible.** Ni en el mapa ni en la estimación.
- **Precios exactos:** Google Street View Static `7.00 $/1000 imágenes`; Mapbox Raster Tiles
  `0.75 $/1000 teselas`. Cambio a euros: constante `USD_EUR: f64 = 0.93`.
- **Caducidad de la caché de sondeos: 30 días.**
- **Límites por defecto** (req/s, concurrencia): `mapillary` 8/4, `kartaview` 4/2, `google`
  10/4, `mapbox-satelite` 16/8, `commons` 2/1, `flickr` 4/2.
- **Paleta de proveedores** (`--p-*`), y vive **solo** en la capa de disponibilidad del mapa
  y como punto índice de 9 px en las tablas que la referencian:
  `mapillary #4ec9a5`, `kartaview #a78bfa`, `google #e8b04b`, `mapbox-satelite #4a4d52`,
  `commons #6ea8fe`, `flickr #f472a6`.
- **Ninguna animación con `essential: true`** en la cámara de Mapbox: pisa el «reducir
  movimiento» del sistema.

### Una desviación del spec que este plan ya resuelve

El spec §4 dice que KartaView usa su capa de cobertura **«si al implementarla hay un endpoint
de teselas estable»**, y que si no, cae al lenguaje de muestreo. **Este plan toma la rama de
muestreo**: KartaView no publica un endpoint de teselas documentado y estable, y lo único
firme es `api.openstreetcam.org/1.0/list/nearby-photos/`, que es por punto. Consecuencia
concreta: en el mapa **solo Mapillary sale como puntos exactos**; KartaView se pinta como
sombreado de tesela igual que Google. Las maquetas dibujan puntos para KartaView y en eso van
por delante de lo que se puede construir hoy.

---

## Estructura de ficheros

**`crates/lumi-index/` — puro, sin red, sin async, sin GPU:**

| fichero | responsabilidad | tarea |
|---|---|---|
| `src/tiles.rs` | *(modificar)* añade `bbox_de_tesela` | 1 |
| `src/network.rs` | *(crear)* `Tarifa`, `Redistribucion`, `Nivel`, `Disponibilidad`, `Captura` | 1 |
| `src/budget.rs` | *(crear)* `Presupuesto` (contador vivo), `previsto`, `cabe` | 2 |
| `src/filter.rs` | *(crear)* reglas baratas y su veredicto | 3 |
| `src/streets.rs` | *(crear)* muestreo puro de puntos a lo largo de polilíneas | 8 |
| `src/coverage.rs` | *(modificar)* cobertura y clasificación **por tesela y origen** | 4 |
| `src/lib.rs` | *(modificar)* declara los módulos nuevos | 1,2,3,8 |

**`indexer/src-tauri/src/` — lo que habla con internet y con el disco:**

| fichero | responsabilidad | tarea |
|---|---|---|
| `store.rs` | *(modificar)* tablas `sondeos`, `gasto`, `descargas`, `revision` y sus métodos | 5 |
| `keys.rs` | *(crear)* claves por proveedor, cifradas | 5 |
| `origins/mod.rs` | *(crear)* `trait OrigenDeRed`, `Limitador`, `registro()`, `Falso` | 6 |
| `origins/mapillary.rs` | *(crear)* Graph API por bbox de tesela | 7 |
| `origins/kartaview.rs` | *(crear)* nearby-photos por punto muestreado | 8 |
| `origins/google.rs` | *(crear)* metadatos gratis + estático de pago | 8 |
| `origins/mapbox.rs` | *(crear)* raster z17 dentro de la tesela | 9 |
| `origins/commons.rs` | *(crear)* GeoData por bbox | 9 |
| `origins/flickr.rs` | *(crear)* búsqueda por bbox filtrada a CC | 9 |
| `probe.rs` | *(crear)* sondear un área con caché de 30 días | 10 |
| `spend.rs` | *(crear)* libro de gasto y el guardián del tope | 10 |
| `download.rs` | *(crear)* planificador reanudable por tesela × origen | 11 |
| `review.rs` | *(crear)* filtro por reglas y estados de revisión | 12 |
| `package.rs` | *(modificar)* filtro de redistribución al sellar | 13 |
| `lib.rs` | *(modificar)* comandos Tauri de todo lo anterior | 5,10,11,12,13 |

**`indexer/src/` — la interfaz:**

| fichero | responsabilidad | tarea |
|---|---|---|
| `lib/api.ts` | *(modificar)* tipos y enlaces de los comandos nuevos | 14,15,16,17 |
| `lib/origenes.ts` | *(crear)* la paleta y los nombres, en un solo sitio | 14 |
| `territory/AvailabilityPanel.tsx` | *(crear)* los interruptores y la leyenda | 14 |
| `territory/MapCanvas.tsx` | *(modificar)* capa de puntos y capa de sombreado | 14 |
| `territory/EstimateDialog.tsx` | *(crear)* estimación, confirmación y rechazo por tope | 15 |
| `download/DownloadView.tsx` | *(crear)* progreso por origen y registro | 16 |
| `review/ReviewGrid.tsx` | *(crear)* rejilla de rechazo por excepción | 16 |
| `settings/OriginsPanel.tsx` | *(crear)* claves, límites y tope mensual | 17 |

---

## Task 1: El contrato puro y el bbox de una tesela

**Files:**
- Create: `crates/lumi-index/src/network.rs`
- Modify: `crates/lumi-index/src/tiles.rs` (añadir al final, antes de `#[cfg(test)]`)
- Modify: `crates/lumi-index/src/lib.rs`

**Interfaces:**
- Consumes: `lumi_index::coverage::Atribucion`, `lumi_index::tiles::{Z, quadkey_de}`.
- Produces: `tiles::bbox_de_tesela(qk: &str) -> Bbox`; `tiles::Bbox { oeste, sur, este, norte }`;
  `network::{Tarifa, Redistribucion, Nivel, Disponibilidad, Captura}`.

**Por qué `bbox_de_tesela` importa tanto:** una tesela z14 mide ~0,022° × 0,022°, es decir
~0,0005 grados cuadrados. El tope de área de la Graph API de Mapillary es 0,01 grados
cuadrados, veinte veces más. Eso significa que **una tesela entera cabe en una sola consulta
por bbox** — y por eso el 7b no necesita decodificar teselas vectoriales en Rust para nada:
las vectoriales son solo para pintar en el navegador. La misma bbox le sirve a Commons y a
Flickr.

- [ ] **Step 1: Escribir el test de `bbox_de_tesela` (falla)**

Añadir dentro del `mod tests` que ya existe en `crates/lumi-index/src/tiles.rs`:

```rust
    #[test]
    fn el_bbox_de_una_tesela_la_contiene_y_es_pequeno() {
        // A Coruña. La tesela que contiene el punto tiene que contener el punto.
        let (lat, lng) = (43.3623, -8.4115);
        let qk = quadkey(lat, lng);
        let b = bbox_de_tesela(&qk);
        assert!(b.oeste < lng && lng < b.este, "lng fuera: {b:?}");
        assert!(b.sur < lat && lat < b.norte, "lat fuera: {b:?}");

        // El área en grados cuadrados tiene que quedar MUY por debajo del tope
        // de 0,01 de la Graph API: es lo que permite una consulta por tesela.
        let area = (b.este - b.oeste) * (b.norte - b.sur);
        assert!(area < 0.001, "el bbox mide {area} grados cuadrados, no cabe en una consulta");

        // Y el centro del bbox tiene que devolver la misma tesela: si no, hay
        // un desfase de medio píxel en la proyección.
        let centro_lat = (b.sur + b.norte) / 2.0;
        let centro_lng = (b.oeste + b.este) / 2.0;
        assert_eq!(quadkey(centro_lat, centro_lng), qk);
    }
```

- [ ] **Step 2: Comprobar que falla**

Run: `cargo test -p lumi-index bbox`
Expected: FAIL, `cannot find function bbox_de_tesela in this scope`.

- [ ] **Step 3: Implementar `Bbox` y `bbox_de_tesela`**

Añadir en `crates/lumi-index/src/tiles.rs`, justo antes de `#[cfg(test)]`:

```rust
/// El rectángulo geográfico de una tesela, en grados. El orden de los campos es
/// el de las APIs que lo consumen (Mapillary y Flickr piden `oeste,sur,este,norte`).
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Bbox {
    pub oeste: f64,
    pub sur: f64,
    pub este: f64,
    pub norte: f64,
}

/// Deshace el entrelazado del quadkey y proyecta las dos esquinas de vuelta a
/// grados. Es la inversa exacta de `xy` + `quadkey_de`.
///
/// Una tesela z14 mide ~0,0005 grados cuadrados, veinte veces menos que el tope
/// de área de la Graph API de Mapillary: por eso una tesela entera cabe en una
/// sola consulta y el 7b nunca necesita decodificar teselas vectoriales en Rust.
pub fn bbox_de_tesela(qk: &str) -> Bbox {
    let (mut x, mut y) = (0u32, 0u32);
    for c in qk.chars() {
        let d = c as u32 - '0' as u32;
        x = (x << 1) | (d & 1);
        y = (y << 1) | ((d >> 1) & 1);
    }
    let escala = (1u32 << qk.len().min(31)) as f64;
    let lng_de = |tx: f64| tx / escala * 360.0 - 180.0;
    let lat_de = |ty: f64| {
        let n = std::f64::consts::PI * (1.0 - 2.0 * ty / escala);
        n.sinh().atan().to_degrees()
    };
    Bbox {
        oeste: lng_de(x as f64),
        // y crece hacia el sur, así que `y` es el norte e `y + 1` el sur.
        sur: lat_de(y as f64 + 1.0),
        este: lng_de(x as f64 + 1.0),
        norte: lat_de(y as f64),
    }
}
```

- [ ] **Step 4: Comprobar que pasa**

Run: `cargo test -p lumi-index bbox`
Expected: PASS.

- [ ] **Step 5: Escribir el test del contrato (falla)**

Crear `crates/lumi-index/src/network.rs` con solo su `mod tests` de momento no compila; se
escribe el fichero completo en el paso siguiente. Este test es el que va **al final** de ese
fichero:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    fn atrib() -> crate::coverage::Atribucion {
        crate::coverage::Atribucion {
            autor: "alguien".into(),
            url: "https://example.org/foto/1".into(),
            licencia: "CC BY-SA 4.0".into(),
        }
    }

    #[test]
    fn la_tarifa_cobra_por_unidad_servida_y_lo_gratis_es_cero() {
        assert_eq!(Tarifa::Gratis.coste_usd(9_240), 0.0);
        // 7,00 $/1000 · 9240 imágenes = 64,68 $
        let g = Tarifa::PorUnidad { usd_por_mil: 7.00 };
        assert!((g.coste_usd(9_240) - 64.68).abs() < 1e-9, "{}", g.coste_usd(9_240));
        // 0,75 $/1000 · 6272 teselas = 4,704 $
        let m = Tarifa::PorUnidad { usd_por_mil: 0.75 };
        assert!((m.coste_usd(6_272) - 4.704).abs() < 1e-9);
        assert_eq!(m.coste_usd(0), 0.0, "cero unidades servidas no cuesta nada");
    }

    #[test]
    fn solo_lo_libre_y_lo_permitido_por_imagen_viaja_en_el_paquete() {
        assert!(Redistribucion::Libre { licencia: "CC BY-SA 4.0".into() }.viaja(None));
        assert!(!Redistribucion::SoloLocal.viaja(None));
        assert!(!Redistribucion::SoloLocal.viaja(Some("CC BY 2.0")),
            "SoloLocal no se salva ni con una licencia buena en la propia foto");

        // PorImagen manda a la licencia de la foto. ND y NC no viajan.
        let p = Redistribucion::PorImagen;
        assert!(p.viaja(Some("CC BY 2.0")));
        assert!(p.viaja(Some("CC BY-SA 2.0")));
        assert!(p.viaja(Some("CC0 1.0")));
        assert!(!p.viaja(Some("CC BY-ND 2.0")), "ND prohíbe derivados");
        assert!(!p.viaja(Some("CC BY-NC 2.0")), "NC prohíbe uso comercial");
        assert!(!p.viaja(Some("CC BY-NC-ND 2.0")));
        assert!(!p.viaja(None), "sin licencia conocida no viaja: la duda no publica");
    }

    #[test]
    fn la_disponibilidad_cuenta_unidades_sea_del_tipo_que_sea() {
        assert_eq!(Disponibilidad::Puntos { cuantos: 412 }.unidades(), 412);
        assert_eq!(
            Disponibilidad::Muestreo { nivel: Nivel::Poco, estimadas: 30 }.unidades(),
            30
        );
        assert_eq!(Disponibilidad::Siempre { unidades: 64 }.unidades(), 64);
        // Nada es nada: una tesela sin material no se descarga ni se cobra.
        let nada = Disponibilidad::Muestreo { nivel: Nivel::Nada, estimadas: 0 };
        assert_eq!(nada.unidades(), 0);
        assert!(!nada.hay());
        assert!(Disponibilidad::Puntos { cuantos: 1 }.hay());
        assert!(!Disponibilidad::Puntos { cuantos: 0 }.hay());
    }

    #[test]
    fn una_captura_lleva_su_atribucion_dentro() {
        // El test existe para que el tipo NO pueda construirse sin atribución.
        // Si alguien la hace `Option`, esto deja de compilar y eso es el aviso.
        let c = Captura {
            fuente: "mapillary",
            id_origen: "1234567890".into(),
            ruta: std::path::PathBuf::from("/tmp/stage/1234567890.jpg"),
            lat: 43.3623,
            lng: -8.4115,
            rumbo: Some(182.5),
            capturada_en: Some("2024-05-02T10:12:00Z".into()),
            atribucion: atrib(),
            unidades: 1,
        };
        assert_eq!(c.atribucion.licencia, "CC BY-SA 4.0");
        assert_eq!(c.quadkey(), crate::tiles::quadkey(43.3623, -8.4115));
    }
}
```

- [ ] **Step 6: Implementar `network.rs`**

Crear `crates/lumi-index/src/network.rs` con este contenido **antes** del `mod tests` del
paso anterior:

```rust
//! Los tipos del contrato de un origen de red. Puros: aquí no hay red.
//!
//! El trait que de verdad habla con internet vive en la aplicación
//! (`indexer/src-tauri/src/origins/`), porque es `async` y arrastraría
//! dependencias que este crate no quiere: los subsistemas 8 y 5 dependen de
//! `lumi-index` para LEER paquetes, no para descargarlos.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use crate::coverage::Atribucion;
use crate::tiles::quadkey;

/// Lo que cuesta una unidad servida. «Unidad» significa cosas distintas según
/// el origen —una imagen en Google, una tesela raster en Mapbox— y por eso el
/// tipo no la nombra: cada adaptador sabe qué está contando.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub enum Tarifa {
    Gratis,
    PorUnidad { usd_por_mil: f64 },
}

/// Cambio fijo. ponytail: el techo es que se desactualiza; la salida, pedirlo a
/// un servicio. No se hace porque una herramienta forense que consulta un tipo
/// de cambio en cada estimación es una dependencia de red más por un número que
/// solo sirve para orientar al operador antes de confirmar.
pub const USD_EUR: f64 = 0.93;

impl Tarifa {
    pub fn coste_usd(&self, unidades: u32) -> f64 {
        match self {
            Tarifa::Gratis => 0.0,
            Tarifa::PorUnidad { usd_por_mil } => usd_por_mil * unidades as f64 / 1000.0,
        }
    }
    pub fn coste_eur(&self, unidades: u32) -> f64 {
        self.coste_usd(unidades) * USD_EUR
    }
    pub fn es_gratis(&self) -> bool {
        matches!(self, Tarifa::Gratis)
    }
}

/// Si las imágenes de este origen pueden salir en un paquete publicado.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum Redistribucion {
    /// Licencia conocida y compatible para todo el origen.
    Libre { licencia: String },
    /// Las condiciones del proveedor no permiten redistribuir: Google, Mapbox.
    SoloLocal,
    /// Cada foto trae la suya y hay que mirarla una a una: Flickr.
    PorImagen,
}

impl Redistribucion {
    /// ¿Viaja esta imagen dentro del paquete?
    ///
    /// `SoloLocal` no se salva ni con una licencia buena en la propia foto: lo
    /// que prohíbe redistribuir es el contrato con el proveedor, no la licencia
    /// del píxel. Y sin licencia conocida tampoco viaja — la duda no publica.
    pub fn viaja(&self, licencia_de_la_foto: Option<&str>) -> bool {
        match self {
            Redistribucion::Libre { .. } => true,
            Redistribucion::SoloLocal => false,
            Redistribucion::PorImagen => match licencia_de_la_foto {
                None => false,
                Some(l) => {
                    let l = l.to_ascii_uppercase();
                    !l.contains("-ND") && !l.contains("-NC") && !l.contains("NODERIV")
                }
            },
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Nivel {
    Mucho,
    Poco,
    Nada,
}

impl Nivel {
    /// Los dos cortes que separan los tres niveles del sombreado. No pretenden
    /// ser exactos: el muestreo no sabe contar mejor que esto.
    pub fn de(estimadas: u32) -> Nivel {
        match estimadas {
            0 => Nivel::Nada,
            1..=49 => Nivel::Poco,
            _ => Nivel::Mucho,
        }
    }
}

/// Qué hay en una tesela, y con qué certeza se sabe. Las tres variantes existen
/// porque los proveedores no se pueden sondear igual, y esa asimetría llega
/// hasta el mapa: los `Puntos` se pintan como puntos y el `Muestreo` como
/// sombreado de la tesela entera.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "clase", rename_all = "lowercase")]
pub enum Disponibilidad {
    /// Cuenta exacta del propio proveedor.
    Puntos { cuantos: u32 },
    /// Estimación por muestreo: es lo único que se puede decir del resto.
    Muestreo { nivel: Nivel, estimadas: u32 },
    /// Cobertura global sin sonda: el cenital de Mapbox.
    Siempre { unidades: u32 },
}

impl Disponibilidad {
    pub fn unidades(&self) -> u32 {
        match self {
            Disponibilidad::Puntos { cuantos } => *cuantos,
            Disponibilidad::Muestreo { estimadas, .. } => *estimadas,
            Disponibilidad::Siempre { unidades } => *unidades,
        }
    }
    pub fn hay(&self) -> bool {
        self.unidades() > 0
    }
    pub fn nivel(&self) -> Nivel {
        match self {
            Disponibilidad::Muestreo { nivel, .. } => *nivel,
            otra => Nivel::de(otra.unidades()),
        }
    }
}

/// Una imagen recién bajada, ya en el directorio de paso y verificada.
///
/// La `Atribucion` va DENTRO y no es `Option`: no puede existir un camino de
/// código por el que una imagen llegue al índice sin ella. Era exactamente el
/// agujero de la v1, cuyo manifiesto exportaba `panoId` y coordenadas pero
/// dejaba fuera las columnas de proveedor y atribución.
#[derive(Debug, Clone, PartialEq)]
pub struct Captura {
    pub fuente: &'static str,
    /// El identificador del proveedor: `panoId`, id de foto, ruta de tesela.
    pub id_origen: String,
    pub ruta: PathBuf,
    pub lat: f64,
    pub lng: f64,
    pub rumbo: Option<f32>,
    pub capturada_en: Option<String>,
    pub atribucion: Atribucion,
    /// Lo que esta captura consumió del presupuesto. Casi siempre 1; una tesela
    /// cenital que se compone de varias sub-teselas cuenta las que gastó.
    pub unidades: u32,
}

impl Captura {
    pub fn quadkey(&self) -> String {
        quadkey(self.lat, self.lng)
    }
}
```

- [ ] **Step 7: Declarar los módulos**

En `crates/lumi-index/src/lib.rs`, dejar la lista de módulos así (orden alfabético, como
estaba):

```rust
pub mod coverage;
pub mod embed;
pub mod legacy;
pub mod manifest;
pub mod network;
pub mod tiles;
pub mod vectors;
```

- [ ] **Step 8: Comprobar que pasa todo**

Run: `cargo test -p lumi-index`
Expected: PASS, 12 tests (los 8 de antes más los 4 nuevos).

- [ ] **Step 9: Commit**

```bash
git add crates/lumi-index/src/network.rs crates/lumi-index/src/tiles.rs crates/lumi-index/src/lib.rs
git commit -m "El contrato de un origen de red, y el bbox que hace que quepa en una consulta"
```

---

## Task 2: El presupuesto, que es un contador vivo

**Files:**
- Create: `crates/lumi-index/src/budget.rs`
- Modify: `crates/lumi-index/src/lib.rs`

**Interfaces:**
- Consumes: `network::{Tarifa, USD_EUR}`.
- Produces: `budget::Presupuesto` con `nuevo(eur: f64)`, `restante_eur() -> f64`,
  `gastar(&self, tarifa: &Tarifa, unidades: u32) -> Result<f64, SinSaldo>`, `gastado_eur()`;
  `budget::LineaPrevista { fuente, teselas, unidades, tarifa, coste_eur }`;
  `budget::previsto(&[LineaPrevista]) -> f64`;
  `budget::cabe(gastado_eur, previsto_eur, tope_eur) -> Result<(), ExcedeTope>`;
  `budget::ExcedeTope { gastado_eur, previsto_eur, tope_eur, exceso_eur }`.

La diferencia entre las dos puertas está en los tipos: `cabe` es una comprobación de una vez
que devuelve un error con números para enseñar, y `Presupuesto` es un contador que se
decrementa a cada unidad servida y corta a mitad de la descarga cuando se agota.

- [ ] **Step 1: Escribir los tests (fallan)**

Crear `crates/lumi-index/src/budget.rs` con **solo** esto de momento:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn el_previsto_suma_las_lineas_y_lo_gratis_no_suma() {
        let lineas = vec![
            LineaPrevista::nueva("mapillary", 71, 18_402, Tarifa::Gratis),
            LineaPrevista::nueva("google", 62, 9_240, Tarifa::PorUnidad { usd_por_mil: 7.00 }),
            LineaPrevista::nueva(
                "mapbox-satelite",
                98,
                6_272,
                Tarifa::PorUnidad { usd_por_mil: 0.75 },
            ),
        ];
        // (64,68 + 4,704) $ · 0,93 = 64,2271… €
        let total = previsto(&lineas);
        assert!((total - 64.2271_2).abs() < 1e-3, "{total}");
        assert_eq!(lineas[0].coste_eur, 0.0, "lo gratuito se lista pero no suma");
    }

    #[test]
    fn el_tope_rechaza_el_trabajo_entero_y_dice_cuanto_sobra() {
        assert!(cabe(148.30, 64.21, 400.00).is_ok());
        // Justo en el borde: gastar exactamente el tope todavía cabe.
        assert!(cabe(300.00, 100.00, 400.00).is_ok());

        let e = cabe(371.40, 64.21, 400.00).unwrap_err();
        assert!((e.exceso_eur - 35.61).abs() < 1e-9, "{}", e.exceso_eur);
        assert_eq!(e.tope_eur, 400.00);
        // El mensaje lleva los tres números: es lo que la pantalla enseña.
        let m = e.to_string();
        assert!(m.contains("371.40") && m.contains("64.21") && m.contains("400.00"), "{m}");
    }

    #[test]
    fn el_presupuesto_es_un_contador_y_corta_a_mitad_cuando_se_agota() {
        // 1,00 € da para 1/0,00651 ≈ 153 imágenes de Google (7 $/1000 · 0,93).
        let p = Presupuesto::nuevo(1.00);
        let tarifa = Tarifa::PorUnidad { usd_por_mil: 7.00 };

        for _ in 0..100 {
            p.gastar(&tarifa, 1).expect("las primeras 100 caben de sobra");
        }
        assert!(p.gastado_eur() > 0.64 && p.gastado_eur() < 0.66, "{}", p.gastado_eur());

        // Un lote que no cabe entero se RECHAZA entero: nada de servir media
        // petición. Quien llama para al recibir esto.
        assert!(p.gastar(&tarifa, 1_000).is_err(), "1000 más no caben en lo que queda");
        assert!(p.gastar(&tarifa, 50).is_ok(), "pero 50 sí, y el contador sigue vivo");

        // Lo gratuito nunca agota nada.
        let vacio = Presupuesto::nuevo(0.0);
        assert!(vacio.gastar(&Tarifa::Gratis, 100_000).is_ok());
        assert_eq!(vacio.gastado_eur(), 0.0);
    }
}
```

- [ ] **Step 2: Comprobar que falla**

Run: `cargo test -p lumi-index budget`
Expected: FAIL de compilación, `cannot find type Presupuesto`.

- [ ] **Step 3: Implementar `budget.rs`**

Poner esto **antes** del `mod tests`, y añadir `pub mod budget;` en `lib.rs`:

```rust
//! Las dos puertas del gasto, y son de naturaleza distinta.
//!
//! `cabe` es una BARRERA: se comprueba una vez, antes de empezar, y si no pasa
//! el trabajo se rechaza entero. Media descarga es un índice con agujeros que
//! nadie sabe dónde están.
//!
//! `Presupuesto` es un CONTADOR VIVO que viaja con la descarga y se decrementa
//! por unidad servida. Un origen que se desmadre se queda sin saldo a mitad, en
//! vez de descubrirse al final.

use std::fmt;
use std::sync::Mutex;

use serde::Serialize;

use crate::network::Tarifa;

/// Una fila de la estimación. Lo gratuito TAMBIÉN se lista: hace falta para
/// entender de dónde va a salir cada imagen, aunque sume cero.
#[derive(Debug, Clone, Serialize)]
pub struct LineaPrevista {
    pub fuente: String,
    pub teselas: u32,
    pub unidades: u32,
    pub tarifa: Tarifa,
    pub coste_eur: f64,
}

impl LineaPrevista {
    pub fn nueva(fuente: &str, teselas: u32, unidades: u32, tarifa: Tarifa) -> Self {
        Self { fuente: fuente.to_string(), teselas, unidades, coste_eur: tarifa.coste_eur(unidades), tarifa }
    }
}

pub fn previsto(lineas: &[LineaPrevista]) -> f64 {
    lineas.iter().map(|l| l.coste_eur).sum()
}

#[derive(Debug, Clone, Serialize)]
pub struct ExcedeTope {
    pub gastado_eur: f64,
    pub previsto_eur: f64,
    pub tope_eur: f64,
    pub exceso_eur: f64,
}

impl fmt::Display for ExcedeTope {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "esta descarga pasaría el tope del mes: llevas {:.2} € y sumaría {:.2} €, \
             que son {:.2} € por encima del tope de {:.2} €",
            self.gastado_eur, self.previsto_eur, self.exceso_eur, self.tope_eur
        )
    }
}

impl std::error::Error for ExcedeTope {}

/// `gastado + previsto > tope` rechaza. Igual al tope todavía cabe: el tope es
/// lo que se puede gastar, no lo que no se puede alcanzar.
pub fn cabe(gastado_eur: f64, previsto_eur: f64, tope_eur: f64) -> Result<(), ExcedeTope> {
    let total = gastado_eur + previsto_eur;
    if total > tope_eur {
        return Err(ExcedeTope {
            gastado_eur,
            previsto_eur,
            tope_eur,
            exceso_eur: total - tope_eur,
        });
    }
    Ok(())
}

#[derive(Debug)]
pub struct SinSaldo {
    pub pedido_eur: f64,
    pub restante_eur: f64,
}

impl fmt::Display for SinSaldo {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "sin saldo: hacían falta {:.4} € y quedaban {:.4} €",
            self.pedido_eur, self.restante_eur
        )
    }
}

impl std::error::Error for SinSaldo {}

/// El contador que viaja con la descarga.
///
/// Un lote que no cabe entero se rechaza entero: no se sirve media petición. El
/// adaptador que recibe `SinSaldo` para y devuelve lo que llevara hecho, que es
/// trabajo bueno y ya pagado.
pub struct Presupuesto {
    tope_eur: f64,
    gastado_eur: Mutex<f64>,
}

impl Presupuesto {
    pub fn nuevo(tope_eur: f64) -> Self {
        Self { tope_eur, gastado_eur: Mutex::new(0.0) }
    }

    pub fn gastado_eur(&self) -> f64 {
        *self.gastado_eur.lock().unwrap()
    }

    pub fn restante_eur(&self) -> f64 {
        (self.tope_eur - self.gastado_eur()).max(0.0)
    }

    /// Apunta `unidades` SERVIDAS y devuelve lo que han costado. Lo gratuito
    /// nunca agota nada, así que un origen sin tarifa no necesita presupuesto.
    pub fn gastar(&self, tarifa: &Tarifa, unidades: u32) -> Result<f64, SinSaldo> {
        if tarifa.es_gratis() {
            return Ok(0.0);
        }
        let coste = tarifa.coste_eur(unidades);
        let mut g = self.gastado_eur.lock().unwrap();
        if *g + coste > self.tope_eur {
            return Err(SinSaldo { pedido_eur: coste, restante_eur: (self.tope_eur - *g).max(0.0) });
        }
        *g += coste;
        Ok(coste)
    }
}
```

- [ ] **Step 4: Comprobar que pasa**

Run: `cargo test -p lumi-index budget`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add crates/lumi-index/src/budget.rs crates/lumi-index/src/lib.rs
git commit -m "El presupuesto: una barrera antes de empezar y un contador durante"
```

---

## Task 3: Las reglas del filtro

**Files:**
- Create: `crates/lumi-index/src/filter.rs`
- Modify: `crates/lumi-index/src/lib.rs`

**Interfaces:**
- Produces: `filter::Candidata { ancho, alto, precision_metros, categorias, licencia, tipo }`;
  `filter::Veredicto { Pasa, Fuera(String) }`; `filter::Reglas` con `por_defecto()` y
  `evaluar(&Candidata) -> Veredicto`.

Las reglas son **baratas**: no abren la imagen, deciden con lo que el proveedor ya dijo en su
respuesta JSON. Lo que descartan es un RESULTADO con motivo anotado, nunca una avería, y no
se reintenta.

- [ ] **Step 1: Escribir los tests (fallan)**

Crear `crates/lumi-index/src/filter.rs` con **solo**:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::manifest::Tipo;

    fn buena() -> Candidata {
        Candidata {
            ancho: 2048,
            alto: 1536,
            precision_metros: Some(8.0),
            categorias: vec!["Streets in Lugo".into()],
            licencia: Some("CC BY-SA 4.0".into()),
            tipo: Tipo::Suelta,
        }
    }

    #[test]
    fn una_foto_buena_pasa() {
        assert_eq!(Reglas::por_defecto().evaluar(&buena()), Veredicto::Pasa);
    }

    #[test]
    fn cada_regla_descarta_con_su_motivo_y_el_motivo_es_legible() {
        let r = Reglas::por_defecto();

        let pequena = Candidata { ancho: 320, alto: 240, ..buena() };
        let Veredicto::Fuera(m) = r.evaluar(&pequena) else { panic!("debería caer") };
        assert!(m.contains("pequeña"), "{m}");

        // 4000×300 es un panorama recortado: relación 13:1, inservible.
        let tira = Candidata { ancho: 4000, alto: 300, ..buena() };
        let Veredicto::Fuera(m) = r.evaluar(&tira) else { panic!("debería caer") };
        assert!(m.contains("proporción"), "{m}");

        let imprecisa = Candidata { precision_metros: Some(340.0), ..buena() };
        let Veredicto::Fuera(m) = r.evaluar(&imprecisa) else { panic!("debería caer") };
        assert!(m.contains("geoetiqueta"), "{m}");

        let dentro = Candidata { categorias: vec!["Interiors of churches".into()], ..buena() };
        let Veredicto::Fuera(m) = r.evaluar(&dentro) else { panic!("debería caer") };
        assert!(m.contains("interior"), "{m}");

        let nd = Candidata { licencia: Some("CC BY-ND 2.0".into()), ..buena() };
        let Veredicto::Fuera(m) = r.evaluar(&nd) else { panic!("debería caer") };
        assert!(m.contains("licencia"), "{m}");
    }

    #[test]
    fn sin_precision_declarada_no_se_descarta() {
        // Commons a menudo no dice la precisión. Descartar por lo que el
        // proveedor no dijo tiraría material bueno: eso lo juzga la persona en
        // la revisión, no una regla.
        let c = Candidata { precision_metros: None, ..buena() };
        assert_eq!(Reglas::por_defecto().evaluar(&c), Veredicto::Pasa);
    }

    #[test]
    fn a_las_capturas_sistematicas_no_se_les_aplica_lo_de_las_categorias() {
        // Una panorámica de calle no tiene categorías y su proporción es
        // legítimamente ancha. Las reglas de foto suelta no le pegan.
        let pano = Candidata {
            ancho: 4096,
            alto: 2048,
            precision_metros: None,
            categorias: vec![],
            licencia: Some("CC BY-SA 4.0".into()),
            tipo: Tipo::Calle,
        };
        assert_eq!(Reglas::por_defecto().evaluar(&pano), Veredicto::Pasa);
    }
}
```

- [ ] **Step 2: Comprobar que falla**

Run: `cargo test -p lumi-index filter`
Expected: FAIL de compilación.

- [ ] **Step 3: Implementar `filter.rs`**

Antes del `mod tests`, y añadir `pub mod filter;` a `lib.rs`:

```rust
//! El filtro barato: lo que se puede decidir SIN abrir la imagen, con lo que el
//! propio proveedor ya dijo en su respuesta.
//!
//! Lo que cae aquí es un RESULTADO, no una avería: se anota el motivo, se salta
//! y no se reintenta nunca. Reintentar una foto de un plato de comida la
//! seguiría dejando siendo un plato de comida.
//!
//! Lo que sobrevive va a la revisión por excepción, donde una persona descarta
//! lo que una regla no puede ver.

use crate::manifest::Tipo;

/// Lo que hace falta saber de una foto para juzgarla sin abrirla.
#[derive(Debug, Clone, PartialEq)]
pub struct Candidata {
    pub ancho: u32,
    pub alto: u32,
    /// Lo que el proveedor declara sobre su geoetiqueta. `None` es «no lo dijo»
    /// y no es motivo de descarte.
    pub precision_metros: Option<f64>,
    /// Categorías o etiquetas del proveedor. Vacío en las capturas sistemáticas.
    pub categorias: Vec<String>,
    pub licencia: Option<String>,
    pub tipo: Tipo,
}

#[derive(Debug, Clone, PartialEq)]
pub enum Veredicto {
    Pasa,
    Fuera(String),
}

/// Palabras que en Commons y en Flickr marcan un interior con bastante
/// fiabilidad. Deliberadamente cortas: una lista larga empieza a tirar material
/// bueno, y para eso ya está la revisión.
const INTERIOR: [&str; 6] = ["interior", "indoor", "inside of", "museum of", "nave of", "altar"];

pub struct Reglas {
    pub lado_minimo: u32,
    pub proporcion_maxima: f64,
    pub precision_maxima_m: f64,
}

impl Reglas {
    /// Valores conservadores: descartan lo claramente inservible y dejan pasar
    /// lo dudoso, porque lo dudoso tiene una persona detrás en la revisión y lo
    /// descartado no la tiene.
    pub fn por_defecto() -> Self {
        Self {
            // Por debajo de 640 px de lado no hay fachada que emparejar.
            lado_minimo: 640,
            // 4:1. Un panorama de calle legítimo llega a 2:1; 13:1 es un recorte.
            proporcion_maxima: 4.0,
            // 100 m es media manzana: más allá la coordenada no localiza nada.
            precision_maxima_m: 100.0,
        }
    }

    pub fn evaluar(&self, c: &Candidata) -> Veredicto {
        if c.ancho < self.lado_minimo || c.alto < self.lado_minimo {
            return Veredicto::Fuera(format!(
                "demasiado pequeña: {}×{}, el mínimo es {} de lado",
                c.ancho, c.alto, self.lado_minimo
            ));
        }
        if c.alto > 0 {
            let p = (c.ancho as f64 / c.alto as f64).max(c.alto as f64 / c.ancho as f64);
            if p > self.proporcion_maxima {
                return Veredicto::Fuera(format!("proporción {p:.1}:1, es un recorte"));
            }
        }
        if let Some(m) = c.precision_metros {
            if m > self.precision_maxima_m {
                return Veredicto::Fuera(format!("geoetiqueta imprecisa: ±{m:.0} m"));
            }
        }
        // Las categorías solo existen en las fotos sueltas. Una panorámica de
        // calle no trae ninguna, y aplicarle esta regla no diría nada.
        if c.tipo == Tipo::Suelta {
            let texto = c.categorias.join(" ").to_lowercase();
            if let Some(p) = INTERIOR.iter().find(|p| texto.contains(**p)) {
                return Veredicto::Fuera(format!("categoría de interior: «{p}»"));
            }
        }
        if let Some(l) = &c.licencia {
            let l = l.to_ascii_uppercase();
            if l.contains("-ND") || l.contains("-NC") {
                return Veredicto::Fuera(format!("licencia que no permite publicar: {l}"));
            }
        }
        Veredicto::Pasa
    }
}
```

- [ ] **Step 4: Comprobar que pasa**

Run: `cargo test -p lumi-index filter`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add crates/lumi-index/src/filter.rs crates/lumi-index/src/lib.rs
git commit -m "Las reglas baratas: descartar lo inservible sin abrir la imagen"
```

---

## Task 4: La cobertura pasa a razonar por tesela y origen

**Files:**
- Modify: `crates/lumi-index/src/coverage.rs`
- Modify: `indexer/src-tauri/src/territory.rs`

**Interfaces:**
- Consumes: `coverage::{Cobertura, TeselaCubierta, Estado, Atribucion}` tal como están hoy.
- Produces: `TeselaCubierta` gana `pub fuentes: Vec<String>`;
  `coverage::clasificar_por_origen(pedidas: &[String], fuentes: &[String], locales, catalogo)
  -> Vec<(String, BTreeMap<String, Estado>)>`;
  `coverage::repartir_por_origen(&[...]) -> BTreeMap<String, Reparto>`;
  `territory::Clasificacion` gana `pub por_origen: BTreeMap<String, RepartoSerializable>`.

**Este es el único cambio del 7b sobre código ya terminado.** Quien instala un paquete no
hereda la cobertura no redistribuible de quien lo publicó, así que «¿está indexada esta
tesela?» deja de tener respuesta y pasa a tenerla «¿está indexada esta tesela **en este
origen**?».

`clasificar` se **conserva sin tocar**: el 8 y el 5 la van a usar para la pregunta gruesa, y
romperla no aporta nada.

- [ ] **Step 1: Escribir el test (falla)**

Añadir dentro del `mod tests` que ya existe en `crates/lumi-index/src/coverage.rs`. Reutiliza
el ayudante `cob` que ya está allí, pero hace falta uno nuevo que declare fuentes:

```rust
    fn cob_con_fuentes(indice: &str, autor: &str, qks: &[(&str, &[&str])]) -> Cobertura {
        Cobertura {
            version: 1,
            indice: indice.into(),
            sellado_en: "2026-08-07T09:00:00Z".into(),
            atribucion: Atribucion {
                autor: autor.into(),
                url: format!("https://github.com/{autor}"),
                licencia: "CC BY-SA 4.0".into(),
            },
            teselas: qks
                .iter()
                .map(|(q, fs)| TeselaCubierta {
                    quadkey: (*q).into(),
                    sha256: format!("hash-de-{q}"),
                    bytes: 1024,
                    imagenes: 10,
                    fuentes: fs.iter().map(|f| (*f).to_string()).collect(),
                })
                .collect(),
        }
    }

    #[test]
    fn una_tesela_publicada_sin_google_sigue_siendo_nueva_en_google() {
        // Marta publicó A y B, pero su paquete solo pudo llevar Mapillary:
        // su cobertura de Google no era redistribuible y no viajó.
        let catalogo = vec![cob_con_fuentes(
            "marta/lumi-costa",
            "marta",
            &[("A", &["mapillary"]), ("B", &["mapillary", "commons"])],
        )];
        let fuentes = vec!["mapillary".to_string(), "google".to_string(), "commons".to_string()];

        let r = clasificar_por_origen(&["A".into(), "B".into()], &fuentes, &[], &catalogo);
        assert_eq!(r.len(), 2, "una entrada por tesela pedida, en el mismo orden");
        assert_eq!(r[0].0, "A");

        let a = &r[0].1;
        assert!(matches!(a["mapillary"], Estado::Catalogo { .. }), "A en mapillary ya está");
        assert!(matches!(a["google"], Estado::Nuevo), "A en google NO se hereda");
        assert!(matches!(a["commons"], Estado::Nuevo), "A tampoco trae commons");

        let b = &r[1].1;
        assert!(matches!(b["commons"], Estado::Catalogo { .. }), "B sí trae commons");
        assert!(matches!(b["google"], Estado::Nuevo));

        // El reparto se cuenta por origen, y es lo que la estimación necesita:
        // solo lo `Nuevo` cuesta cuota.
        let rep = repartir_por_origen(&r);
        assert_eq!(rep["mapillary"].nuevas, 0);
        assert_eq!(rep["google"].nuevas, 2, "las dos teselas hay que bajarlas de google");
        assert_eq!(rep["commons"].nuevas, 1);
        assert_eq!(rep["mapillary"].catalogo, 2);
    }

    #[test]
    fn lo_local_sigue_ganando_al_catalogo_tambien_por_origen() {
        let locales = vec![cob_con_fuentes("mio", "yo", &[("A", &["mapillary"])])];
        let catalogo = vec![cob_con_fuentes("otro/x", "otro", &[("A", &["mapillary"])])];
        let r = clasificar_por_origen(&["A".into()], &["mapillary".into()], &locales, &catalogo);
        assert!(matches!(r[0].1["mapillary"], Estado::Local { .. }));
    }
```

- [ ] **Step 2: Comprobar que falla**

Run: `cargo test -p lumi-index coverage`
Expected: FAIL, `struct TeselaCubierta has no field named fuentes`.

- [ ] **Step 3: Añadir `fuentes` a `TeselaCubierta`**

En `crates/lumi-index/src/coverage.rs`, sustituir la struct por:

```rust
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TeselaCubierta {
    pub quadkey: String,
    /// Hash del fragmento. Es lo que hace que la autoría sea COMPROBABLE y no
    /// una declaración de buena fe: quitar la atribución rompería SHA256SUMS.
    pub sha256: String,
    pub bytes: u64,
    pub imagenes: u32,
    /// Los orígenes cuyo material viaja DE VERDAD en este fragmento. Un paquete
    /// no lleva lo no redistribuible, así que heredarlo no cubre esos orígenes
    /// y quien lo instale sigue teniendo que bajarlos.
    ///
    /// `default` porque los paquetes sellados antes del 7b no la traen: para
    /// ellos la lista queda vacía y todos sus orígenes salen como nuevos, que
    /// es la respuesta conservadora y correcta.
    #[serde(default)]
    pub fuentes: Vec<String>,
}
```

- [ ] **Step 4: Implementar la clasificación por origen**

Añadir en el mismo fichero, después de `repartir`:

```rust
/// Igual que `clasificar`, pero respondiendo la pregunta que el 7b necesita:
/// «¿esta tesela, en ESTE origen?». Devuelve un mapa por tesela, en el mismo
/// orden de `pedidas`.
///
/// Un paquete solo cubre los orígenes que declara en `fuentes`, porque es lo
/// único que llevaba dentro. La cobertura no redistribuible del publicador no
/// se hereda, y eso no es un fallo: es lo que su licencia permite.
pub fn clasificar_por_origen(
    pedidas: &[String],
    fuentes: &[String],
    locales: &[Cobertura],
    catalogo: &[Cobertura],
) -> Vec<(String, std::collections::BTreeMap<String, Estado>)> {
    pedidas
        .iter()
        .map(|qk| {
            let mut por_fuente = std::collections::BTreeMap::new();
            for f in fuentes {
                let estado = buscar_local_con(qk, f, locales)
                    .or_else(|| buscar_catalogo_con(qk, f, catalogo))
                    .unwrap_or(Estado::Nuevo);
                por_fuente.insert(f.clone(), estado);
            }
            (qk.clone(), por_fuente)
        })
        .collect()
}

fn buscar_local_con(qk: &str, fuente: &str, cobs: &[Cobertura]) -> Option<Estado> {
    for c in cobs {
        if let Some(t) = c.teselas.iter().find(|t| t.quadkey == qk && t.fuentes.iter().any(|f| f == fuente)) {
            return Some(Estado::Local { indice: c.indice.clone(), sha256: t.sha256.clone() });
        }
    }
    None
}

fn buscar_catalogo_con(qk: &str, fuente: &str, cobs: &[Cobertura]) -> Option<Estado> {
    for c in cobs {
        if let Some(t) = c.teselas.iter().find(|t| t.quadkey == qk && t.fuentes.iter().any(|f| f == fuente)) {
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

/// Un `Reparto` por origen. Es lo que alimenta la estimación: `nuevas` es lo
/// único que cuesta cuota y GPU.
pub fn repartir_por_origen(
    clasificadas: &[(String, std::collections::BTreeMap<String, Estado>)],
) -> std::collections::BTreeMap<String, Reparto> {
    let mut fuera: std::collections::BTreeMap<String, Reparto> = Default::default();
    for (_, por_fuente) in clasificadas {
        for (f, e) in por_fuente {
            let r = fuera
                .entry(f.clone())
                .or_insert(Reparto { locales: 0, catalogo: 0, nuevas: 0, bytes_a_descargar: 0 });
            match e {
                Estado::Local { .. } => r.locales += 1,
                Estado::Catalogo { bytes, .. } => {
                    r.catalogo += 1;
                    r.bytes_a_descargar += bytes;
                }
                Estado::Nuevo => r.nuevas += 1,
            }
        }
    }
    fuera
}
```

- [ ] **Step 5: Arreglar los usos existentes de `TeselaCubierta`**

Run: `cargo check --workspace`

Añadir `fuentes: vec![]` (o la lista real) allí donde el compilador señale la struct
incompleta: el ayudante `cob` del propio `mod tests` de `coverage.rs`, y el sellado en
`indexer/src-tauri/src/lib.rs` (comando `paquete_sellar`), donde la lista correcta es la de
`fuente` distintas de las imágenes de esa tesela — eso se completa en la Task 13; de momento
poner `fuentes: vec![]` con un `// TODO Task 13` NO vale: poner directamente la consulta

```rust
fuentes: almacen.fuentes_de_tesela(indice_id, &qk)?,
```

y declarar el método en el paso siguiente.

- [ ] **Step 6: Añadir `fuentes_de_tesela` al almacén**

En `indexer/src-tauri/src/store.rs`, dentro de `impl Almacen`:

```rust
    /// Las `fuente` distintas de las imágenes NO saltadas de una tesela. Es lo
    /// que `cobertura.json` declara como cubierto por el fragmento, y por tanto
    /// lo que otro operador puede dar por heredado al instalarlo.
    pub fn fuentes_de_tesela(&self, indice_id: i64, quadkey: &str) -> Result<Vec<String>> {
        let c = self.0.lock().unwrap();
        let mut q = c.prepare(
            "SELECT DISTINCT l.fuente
               FROM imagenes i JOIN lotes l ON l.id = i.lote_id
              WHERE i.indice_id = ?1 AND i.quadkey = ?2 AND i.saltada_motivo IS NULL
              ORDER BY l.fuente",
        )?;
        let filas = q
            .query_map(params![indice_id, quadkey], |r| r.get(0))?
            .collect::<Result<Vec<String>, _>>()?;
        Ok(filas)
    }
```

- [ ] **Step 7: Exponer el reparto por origen en `territory.rs`**

En `indexer/src-tauri/src/territory.rs`, añadir el campo a `Clasificacion` y rellenarlo. El
`Reparto` de `lumi-index` no es `Serialize`, así que se traduce a una struct propia:

```rust
#[derive(Serialize)]
pub struct RepartoOrigen {
    pub locales: usize,
    pub catalogo: usize,
    pub nuevas: usize,
}

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
    /// Lo mismo, pero desglosado por origen. Es lo que la estimación del 7b
    /// necesita: una tesela heredada puede seguir estando sin cubrir en algún
    /// origen, porque lo no redistribuible no viaja dentro de un paquete.
    pub por_origen: std::collections::BTreeMap<String, RepartoOrigen>,
}
```

Y en `clasificar_area`, añadir el parámetro `fuentes: &[String]` y al final:

```rust
    let detalle = clasificar_por_origen(&pedidas, fuentes, locales, catalogo);
    let por_origen = repartir_por_origen(&detalle)
        .into_iter()
        .map(|(f, r)| (f, RepartoOrigen { locales: r.locales, catalogo: r.catalogo, nuevas: r.nuevas }))
        .collect();
```

incluyéndolo en el `Clasificacion { .. }` que devuelve. El `use` de arriba pasa a:

```rust
use lumi_index::coverage::{
    clasificar, clasificar_por_origen, repartir, repartir_por_origen, Cobertura, Estado, Reparto,
};
```

- [ ] **Step 8: Ajustar el comando `territorio_clasificar`**

En `indexer/src-tauri/src/lib.rs`, el comando pasa a recibir las fuentes activas:

```rust
#[tauri::command]
async fn territorio_clasificar(
    estado: tauri::State<'_, Estado>,
    poligono: Vec<lumi_index::tiles::Punto>,
    fuentes: Vec<String>,
) -> Result<territory::Clasificacion, String> {
    let locales = territory::coberturas_locales(&estado.dir.join("paquetes"));
    // ponytail: el catálogo remoto es del subsistema 8. Hasta entonces solo hay
    // lo instalado, y la salida es pasar aquí lo que el 8 tenga descargado.
    territory::clasificar_area(&poligono, &fuentes, &locales, &[]).map_err(|e| e.to_string())
}
```

Y en `indexer/src/lib/api.ts`, la firma correspondiente:

```ts
  territorioClasificar: (poligono: Punto[], fuentes: string[]) =>
    invoke<Clasificacion>("territorio_clasificar", { poligono, fuentes }),
```

`TerritoryView.tsx` pasa `[]` de momento; la lista real llega en la Task 14.

- [ ] **Step 9: Comprobar que pasa todo**

Run: `cargo test -p lumi-index && cargo check --workspace && cd indexer && npm run build`
Expected: PASS; 6 tests en `coverage`, workspace limpio, build limpio.

- [ ] **Step 10: Commit**

```bash
git add crates/lumi-index/src/coverage.rs indexer/src-tauri/src/territory.rs indexer/src-tauri/src/store.rs indexer/src-tauri/src/lib.rs indexer/src/lib/api.ts indexer/src/territory/TerritoryView.tsx
git commit -m "La cobertura ya no dice si una tesela esta indexada, sino en que origen"
```

---

## Task 5: El esquema, el libro de gasto y las claves

**Files:**
- Modify: `indexer/src-tauri/src/store.rs`
- Create: `indexer/src-tauri/src/keys.rs`
- Modify: `indexer/src-tauri/src/lib.rs`

**Interfaces:**
- Consumes: `Almacen`, `Maestra`.
- Produces, en `Almacen`: `sondeo_guardar`, `sondeo_leer`, `gasto_apuntar`, `gasto_del_mes`,
  `descarga_estado`, `descarga_marcar`, `descarga_sumar_reintento`, `descargas_de`,
  `revision_marcar`, `revision_pendientes`, `revision_cuentas`.
  En `keys`: `Claves::guardar/leer/hay`, `TOPE_MENSUAL_EUR_POR_DEFECTO`.

- [ ] **Step 1: Escribir el test del almacén (falla)**

Crear `indexer/src-tauri/src/store.rs`… no: **añadir al final** de `store.rs` un módulo de
tests nuevo (hoy el fichero no tiene ninguno):

```rust
#[cfg(test)]
mod tests {
    use super::*;

    fn temporal() -> (tempfile::TempDir, Almacen) {
        let d = tempfile::tempdir().unwrap();
        let a = Almacen::abrir(d.path()).unwrap();
        (d, a)
    }

    #[test]
    fn el_sondeo_se_guarda_y_caduca_a_los_treinta_dias() {
        let (_d, a) = temporal();
        a.sondeo_guardar("google", "03113322013021", "poco", 30).unwrap();

        let fresco = a.sondeo_leer("google", "03113322013021", 30).unwrap();
        assert_eq!(fresco, Some(("poco".to_string(), 30)));

        // Con una ventana de cero días, lo de hace un instante ya está viejo.
        assert_eq!(a.sondeo_leer("google", "03113322013021", 0).unwrap(), None);
        // Y otro origen no se contamina con este.
        assert_eq!(a.sondeo_leer("flickr", "03113322013021", 30).unwrap(), None);
    }

    #[test]
    fn el_gasto_suma_por_dia_y_origen_y_el_mes_los_agrega() {
        let (_d, a) = temporal();
        a.gasto_apuntar("2026-08-07", "google", 1_000, 6.51).unwrap();
        a.gasto_apuntar("2026-08-07", "google", 500, 3.26).unwrap();
        a.gasto_apuntar("2026-08-07", "mapbox-satelite", 2_000, 1.40).unwrap();
        a.gasto_apuntar("2026-07-31", "google", 9_000, 58.59).unwrap();

        let agosto = a.gasto_del_mes("2026-08").unwrap();
        assert!((agosto - 11.17).abs() < 1e-9, "{agosto}");
        // Julio no se mezcla, aunque sea el día de antes.
        let julio = a.gasto_del_mes("2026-07").unwrap();
        assert!((julio - 58.59).abs() < 1e-9, "{julio}");
    }

    #[test]
    fn una_tesela_ya_hecha_no_se_vuelve_a_descargar_ni_a_cobrar() {
        // Esta es LA prueba del 7b: es lo que impide pagar dos veces por lo
        // mismo cuando una descarga se corta a la mitad.
        let (_d, a) = temporal();
        let i = a.crear_indice("lugo-norte", "lugo-norte").unwrap();

        assert_eq!(a.descarga_estado(i, "google", "AAA").unwrap(), None);
        a.descarga_marcar(i, "google", "AAA", "hecho", 148, 148, None).unwrap();
        assert_eq!(a.descarga_estado(i, "google", "AAA").unwrap(), Some("hecho".into()));

        let pendientes = a.descargas_pendientes(i, "google", &["AAA".into(), "BBB".into()]).unwrap();
        assert_eq!(pendientes, vec!["BBB".to_string()], "AAA ya está y no vuelve");

        // Un error SÍ vuelve: es una avería, no un resultado.
        a.descarga_marcar(i, "google", "BBB", "error", 0, 0, Some("se cayó la red")).unwrap();
        let pendientes = a.descargas_pendientes(i, "google", &["AAA".into(), "BBB".into()]).unwrap();
        assert_eq!(pendientes, vec!["BBB".to_string()]);

        // Y el contador de reintentos es lo que impide el bucle infinito.
        assert_eq!(a.descarga_sumar_reintento(i, "google", "BBB").unwrap(), 1);
        assert_eq!(a.descarga_sumar_reintento(i, "google", "BBB").unwrap(), 2);
    }
}
```

Añadir `tempfile` a `[dev-dependencies]` no hace falta: ya está en `[dependencies]` de
`indexer-app`.

- [ ] **Step 2: Comprobar que falla**

Run: `cargo test -p indexer-app store`
Expected: FAIL de compilación, `no method named sondeo_guardar`.

- [ ] **Step 3: Ampliar el esquema**

En `indexer/src-tauri/src/store.rs`, añadir al final de la constante `ESQUEMA`, **antes** de
los `CREATE INDEX`:

```sql
-- La caché de sondeos. Solo la necesitan los orígenes que se sondean por
-- muestreo: los de teselas vectoriales los pinta el navegador y no pasan
-- por aquí.
CREATE TABLE IF NOT EXISTS sondeos (
    fuente      TEXT NOT NULL,
    quadkey     TEXT NOT NULL,
    nivel       TEXT NOT NULL CHECK (nivel IN ('mucho','poco','nada')),
    estimadas   INTEGER NOT NULL,
    sondeado_en INTEGER NOT NULL,
    PRIMARY KEY (fuente, quadkey)
);

-- El libro de gasto. Una fila por día y origen, y NADA SE BORRA: es el
-- registro de lo que se pagó, no un contador que se pueda poner a cero.
CREATE TABLE IF NOT EXISTS gasto (
    dia      TEXT NOT NULL,
    fuente   TEXT NOT NULL,
    unidades INTEGER NOT NULL,
    coste    REAL NOT NULL,
    PRIMARY KEY (dia, fuente)
);

-- La unidad de trabajo de una descarga. Que esto sea una tabla es lo que
-- hace que cortar una descarga a la mitad no cueste dinero al retomarla.
CREATE TABLE IF NOT EXISTS descargas (
    indice_id  INTEGER NOT NULL,
    fuente     TEXT NOT NULL,
    quadkey    TEXT NOT NULL,
    estado     TEXT NOT NULL CHECK (estado IN ('en_curso','hecho','error')),
    imagenes   INTEGER NOT NULL DEFAULT 0,
    unidades   INTEGER NOT NULL DEFAULT 0,
    reintentos INTEGER NOT NULL DEFAULT 0,
    motivo     TEXT,
    PRIMARY KEY (indice_id, fuente, quadkey)
);

CREATE INDEX IF NOT EXISTS gasto_por_mes ON gasto(dia);
```

Y a la tabla `imagenes` le hace falta una columna más. Como `CREATE TABLE IF NOT EXISTS` no
altera una tabla existente, se añade con una migración idempotente justo después del
`execute_batch(ESQUEMA)` en `abrir`:

```rust
        c.execute_batch(ESQUEMA)?;
        // Migración idempotente: `CREATE TABLE IF NOT EXISTS` no toca una tabla
        // que ya existe, así que las columnas nuevas se añaden aparte y se
        // ignora el error de «ya existe». Es la forma más barata de que una
        // base del 7a siga abriendo.
        for alter in [
            // Estado de revisión: NULL en todo lo que no la necesita (calle,
            // cenital), 'pendiente' | 'aceptada' | 'rechazada' en las sueltas.
            "ALTER TABLE imagenes ADD COLUMN revision TEXT",
            // Lo que el proveedor dijo de la propia foto, que es lo que decide
            // si viaja en el paquete cuando la licencia va por imagen.
            "ALTER TABLE imagenes ADD COLUMN licencia TEXT",
            "ALTER TABLE imagenes ADD COLUMN atribucion TEXT",
            "ALTER TABLE imagenes ADD COLUMN id_origen TEXT",
            "ALTER TABLE imagenes ADD COLUMN rumbo REAL",
        ] {
            let _ = c.execute(alter, []);
        }
```

- [ ] **Step 4: Implementar los métodos**

Añadir dentro de `impl Almacen`:

```rust
    // ── Sondeos ──────────────────────────────────────────────────────────

    pub fn sondeo_guardar(&self, fuente: &str, quadkey: &str, nivel: &str, estimadas: u32) -> Result<()> {
        let c = self.0.lock().unwrap();
        c.execute(
            "INSERT OR REPLACE INTO sondeos (fuente, quadkey, nivel, estimadas, sondeado_en)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![fuente, quadkey, nivel, estimadas, Self::ahora()],
        )?;
        Ok(())
    }

    /// `None` si no está o si ya caducó. La caducidad se pasa como parámetro y
    /// no como constante para que el test pueda pedir cero días.
    pub fn sondeo_leer(&self, fuente: &str, quadkey: &str, dias: i64) -> Result<Option<(String, u32)>> {
        let c = self.0.lock().unwrap();
        let corte = Self::ahora() - dias * 86_400;
        Ok(c.query_row(
            "SELECT nivel, estimadas FROM sondeos
              WHERE fuente = ?1 AND quadkey = ?2 AND sondeado_en > ?3",
            params![fuente, quadkey, corte],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .ok())
    }

    // ── Gasto ────────────────────────────────────────────────────────────

    /// Suma sobre la fila del día. `dia` en `YYYY-MM-DD`.
    pub fn gasto_apuntar(&self, dia: &str, fuente: &str, unidades: u32, coste: f64) -> Result<()> {
        let c = self.0.lock().unwrap();
        c.execute(
            "INSERT INTO gasto (dia, fuente, unidades, coste) VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(dia, fuente) DO UPDATE SET
               unidades = unidades + excluded.unidades,
               coste    = coste    + excluded.coste",
            params![dia, fuente, unidades, coste],
        )?;
        Ok(())
    }

    /// `mes` en `YYYY-MM`. El prefijo basta porque `dia` es ISO y ordena solo.
    pub fn gasto_del_mes(&self, mes: &str) -> Result<f64> {
        let c = self.0.lock().unwrap();
        let s: Option<f64> = c.query_row(
            "SELECT SUM(coste) FROM gasto WHERE dia LIKE ?1 || '-%'",
            params![mes],
            |r| r.get(0),
        )?;
        Ok(s.unwrap_or(0.0))
    }

    /// `(fuente, unidades, coste)` del mes, para el desglose de ajustes.
    pub fn gasto_del_mes_por_origen(&self, mes: &str) -> Result<Vec<(String, u32, f64)>> {
        let c = self.0.lock().unwrap();
        let mut q = c.prepare(
            "SELECT fuente, SUM(unidades), SUM(coste) FROM gasto
              WHERE dia LIKE ?1 || '-%' GROUP BY fuente ORDER BY SUM(coste) DESC",
        )?;
        let filas = q
            .query_map(params![mes], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(filas)
    }

    // ── Descargas ────────────────────────────────────────────────────────

    pub fn descarga_estado(&self, indice_id: i64, fuente: &str, quadkey: &str) -> Result<Option<String>> {
        let c = self.0.lock().unwrap();
        Ok(c.query_row(
            "SELECT estado FROM descargas WHERE indice_id = ?1 AND fuente = ?2 AND quadkey = ?3",
            params![indice_id, fuente, quadkey],
            |r| r.get(0),
        )
        .ok())
    }

    #[allow(clippy::too_many_arguments)]
    pub fn descarga_marcar(
        &self,
        indice_id: i64,
        fuente: &str,
        quadkey: &str,
        estado: &str,
        imagenes: u32,
        unidades: u32,
        motivo: Option<&str>,
    ) -> Result<()> {
        let c = self.0.lock().unwrap();
        c.execute(
            "INSERT INTO descargas (indice_id, fuente, quadkey, estado, imagenes, unidades, motivo)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
             ON CONFLICT(indice_id, fuente, quadkey) DO UPDATE SET
               estado = excluded.estado, imagenes = excluded.imagenes,
               unidades = excluded.unidades, motivo = excluded.motivo",
            params![indice_id, fuente, quadkey, estado, imagenes, unidades, motivo],
        )?;
        Ok(())
    }

    /// De las teselas pedidas, las que faltan por bajar de este origen.
    /// **Solo `hecho` excluye.** Un `error` vuelve, porque es una avería; una
    /// tesela `en_curso` de una ejecución anterior también, porque el proceso
    /// murió sin terminarla.
    pub fn descargas_pendientes(
        &self,
        indice_id: i64,
        fuente: &str,
        pedidas: &[String],
    ) -> Result<Vec<String>> {
        let c = self.0.lock().unwrap();
        let mut q = c.prepare(
            "SELECT quadkey FROM descargas
              WHERE indice_id = ?1 AND fuente = ?2 AND estado = 'hecho'",
        )?;
        let hechas: std::collections::HashSet<String> = q
            .query_map(params![indice_id, fuente], |r| r.get(0))?
            .collect::<Result<_, _>>()?;
        Ok(pedidas.iter().filter(|q| !hechas.contains(*q)).cloned().collect())
    }

    pub fn descarga_sumar_reintento(&self, indice_id: i64, fuente: &str, quadkey: &str) -> Result<u32> {
        let c = self.0.lock().unwrap();
        c.execute(
            "UPDATE descargas SET reintentos = reintentos + 1
              WHERE indice_id = ?1 AND fuente = ?2 AND quadkey = ?3",
            params![indice_id, fuente, quadkey],
        )?;
        let n: u32 = c.query_row(
            "SELECT reintentos FROM descargas WHERE indice_id = ?1 AND fuente = ?2 AND quadkey = ?3",
            params![indice_id, fuente, quadkey],
            |r| r.get(0),
        )?;
        Ok(n)
    }
```

- [ ] **Step 5: Comprobar que pasan los tres tests**

Run: `cargo test -p indexer-app store`
Expected: PASS, 3 tests.

- [ ] **Step 6: Implementar `keys.rs`**

Crear `indexer/src-tauri/src/keys.rs`:

```rust
//! Las claves de los proveedores, cifradas con la clave maestra local.
//!
//! Es generalizar lo que el 7a ya hacía con la de Mapbox: la misma `Maestra`,
//! la misma tabla `ajustes`, una fila por proveedor. Nunca en claro en disco y
//! nunca dentro de un paquete.
//!
//! La de Mapbox se COMPARTE entre el mapa y el origen cenital: es la misma
//! cuenta y la misma cuota, y tener dos filas para la misma clave solo crearía
//! la posibilidad de que se desincronicen.

use anyhow::Result;

use crate::crypto::Maestra;
use crate::store::Almacen;

/// Tope mensual por defecto, en euros. Se puede cambiar desde ajustes.
pub const TOPE_MENSUAL_EUR_POR_DEFECTO: f64 = 100.0;

pub const CLAVE_MAPBOX: &str = "mapbox_token";
pub const CLAVE_TOPE: &str = "tope_mensual_eur";

/// La clave de ajuste donde vive el secreto de un proveedor.
pub fn ajuste_de(proveedor: &str) -> String {
    // Mapbox no tiene fila propia: usa la misma que el mapa.
    if proveedor == "mapbox-satelite" {
        return CLAVE_MAPBOX.to_string();
    }
    format!("clave_{proveedor}")
}

pub struct Claves<'a> {
    pub almacen: &'a Almacen,
    pub maestra: &'a Maestra,
}

impl Claves<'_> {
    pub fn guardar(&self, proveedor: &str, clave: &str) -> Result<()> {
        let sellado = self.maestra.sellar(clave.as_bytes())?;
        self.almacen.guardar_ajuste_sellado(&ajuste_de(proveedor), &sellado)
    }

    pub fn leer(&self, proveedor: &str) -> Result<Option<String>> {
        let Some(sellado) = self.almacen.leer_ajuste_sellado(&ajuste_de(proveedor))? else {
            return Ok(None);
        };
        Ok(Some(String::from_utf8(self.maestra.abrir(&sellado)?)?))
    }

    pub fn hay(&self, proveedor: &str) -> bool {
        matches!(self.leer(proveedor), Ok(Some(k)) if !k.is_empty())
    }

    pub fn tope_eur(&self) -> f64 {
        self.almacen
            .leer_ajuste(CLAVE_TOPE)
            .ok()
            .flatten()
            .and_then(|v| v.parse().ok())
            .unwrap_or(TOPE_MENSUAL_EUR_POR_DEFECTO)
    }

    pub fn fijar_tope_eur(&self, eur: f64) -> Result<()> {
        self.almacen.guardar_ajuste(CLAVE_TOPE, &format!("{eur}"))
    }
}

/// Quita el valor de cualquier parámetro que huela a secreto antes de que una
/// URL llegue al log. Flickr y Google Static solo aceptan la clave por
/// parámetro de consulta —no ofrecen cabecera—, así que la URL que se registra
/// tiene que pasar por aquí sí o sí.
pub fn redactar(url: &str) -> String {
    let mut fuera = String::with_capacity(url.len());
    for (i, trozo) in url.split(['?', '&']).enumerate() {
        fuera.push(if i == 0 { ' ' } else if url[..].contains('?') && i == 1 { '?' } else { '&' });
        let secreto = ["key=", "api_key=", "access_token=", "token="]
            .iter()
            .find(|p| trozo.starts_with(**p));
        match secreto {
            Some(p) => {
                fuera.push_str(p);
                fuera.push_str("···");
            }
            None => fuera.push_str(trozo),
        }
    }
    fuera.trim_start().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn la_clave_nunca_llega_entera_al_log() {
        let u = "https://maps.googleapis.com/maps/api/streetview?size=640x640&location=43.3,-8.4&key=AIzaSyREAL";
        let r = redactar(u);
        assert!(!r.contains("AIzaSyREAL"), "{r}");
        assert!(r.contains("key=···"), "{r}");
        // Y lo que no es secreto se conserva: un log sin la ubicación no sirve.
        assert!(r.contains("location=43.3,-8.4"), "{r}");
    }

    #[test]
    fn mapbox_comparte_la_clave_con_el_mapa() {
        assert_eq!(ajuste_de("mapbox-satelite"), CLAVE_MAPBOX);
        assert_eq!(ajuste_de("flickr"), "clave_flickr");
    }
}
```

- [ ] **Step 7: Añadir `leer_ajuste` y `guardar_ajuste` en claro**

`store.rs` solo sabe guardar ajustes sellados; el tope no es un secreto. Dentro de
`impl Almacen`:

```rust
    /// Ajustes que NO son secretos, como el tope mensual. Van en la columna
    /// `valor` y no en `sellado`: cifrar un número que la propia pantalla
    /// enseña sería teatro.
    pub fn guardar_ajuste(&self, clave: &str, valor: &str) -> Result<()> {
        let c = self.0.lock().unwrap();
        c.execute(
            "INSERT INTO ajustes (clave, valor) VALUES (?1, ?2)
             ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor",
            params![clave, valor],
        )?;
        Ok(())
    }

    pub fn leer_ajuste(&self, clave: &str) -> Result<Option<String>> {
        let c = self.0.lock().unwrap();
        Ok(c.query_row("SELECT valor FROM ajustes WHERE clave = ?1", params![clave], |r| r.get(0))
            .ok()
            .flatten())
    }
```

- [ ] **Step 8: Declarar el módulo y comprobar**

En `indexer/src-tauri/src/lib.rs`, añadir `mod keys;` junto a los demás.

Run: `cargo test -p indexer-app`
Expected: PASS, 5 tests (3 de store, 2 de keys).

- [ ] **Step 9: Commit**

```bash
git add indexer/src-tauri/src/store.rs indexer/src-tauri/src/keys.rs indexer/src-tauri/src/lib.rs
git commit -m "Sondeos, gasto, descargas y claves: donde vive lo que no se puede volver a pagar"
```

---

## Task 6: El trait, el limitador y un origen falso

**Files:**
- Create: `indexer/src-tauri/src/origins/mod.rs`
- Modify: `indexer/src-tauri/Cargo.toml`
- Modify: `indexer/src-tauri/src/lib.rs`

**Interfaces:**
- Consumes: `lumi_index::network::*`, `lumi_index::budget::Presupuesto`, `keys::Claves`.
- Produces: `trait OrigenDeRed`; `Limitador::nuevo(req_s, concurrencia)` con `permiso()`;
  `Ctx { cliente: reqwest::Client, clave: Option<String>, stage: PathBuf }`;
  `origins::registro(&Claves, stage: PathBuf) -> Vec<Box<dyn OrigenDeRed>>`;
  `origins::Falso` para pruebas.

El trait vive aquí y no en `lumi-index` a propósito: es `async` y arrastraría `async-trait`,
`reqwest` y `tokio` a un crate que los subsistemas 8 y 5 usan solo para **leer** paquetes.

- [ ] **Step 1: Añadir la dependencia**

En `indexer/src-tauri/Cargo.toml`, sección `[dependencies]`:

```toml
async-trait = "0.1"
urlencoding = "2"
```

- [ ] **Step 2: Escribir el test (falla)**

El test va al final de `origins/mod.rs`, que se crea en el paso siguiente:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use lumi_index::budget::Presupuesto;

    #[tokio::test]
    async fn el_origen_falso_responde_lo_guionizado_y_respeta_el_presupuesto() {
        let f = Falso::nuevo("falso", Tipo::Suelta, Tarifa::PorUnidad { usd_por_mil: 7.00 })
            .con("AAA", 148)
            .con("BBB", 0);

        assert_eq!(f.sondear("AAA").await.unwrap().unidades(), 148);
        assert!(!f.sondear("BBB").await.unwrap().hay());
        assert!(!f.sondear("CCC").await.unwrap().hay(), "lo no guionizado no existe");

        // 148 imágenes a 7 $/1000 · 0,93 son 0,963 €: con 10 € caben.
        let p = Presupuesto::nuevo(10.0);
        let caps = f.descargar("AAA", &p).await.unwrap();
        assert_eq!(caps.len(), 148);
        assert!(caps.iter().all(|c| c.atribucion.autor == "falso"));
        assert!((p.gastado_eur() - 0.963_48).abs() < 1e-4, "{}", p.gastado_eur());

        // Con saldo justo, se para a mitad y devuelve lo que llevaba: eso es
        // trabajo bueno y ya pagado, no se tira.
        let p = Presupuesto::nuevo(0.10);
        let caps = f.descargar("AAA", &p).await.unwrap();
        assert!(caps.len() < 148 && !caps.is_empty(), "bajó {} de 148", caps.len());
        assert!(p.restante_eur() < 0.01);
    }

    #[tokio::test]
    async fn el_limitador_no_deja_pasar_mas_de_su_concurrencia() {
        use std::sync::atomic::{AtomicUsize, Ordering};
        use std::sync::Arc;

        let l = Arc::new(Limitador::nuevo(1000, 2));
        let vivos = Arc::new(AtomicUsize::new(0));
        let pico = Arc::new(AtomicUsize::new(0));

        let mut tareas = Vec::new();
        for _ in 0..12 {
            let (l, vivos, pico) = (l.clone(), vivos.clone(), pico.clone());
            tareas.push(tokio::spawn(async move {
                let _p = l.permiso().await;
                let n = vivos.fetch_add(1, Ordering::SeqCst) + 1;
                pico.fetch_max(n, Ordering::SeqCst);
                tokio::time::sleep(std::time::Duration::from_millis(20)).await;
                vivos.fetch_sub(1, Ordering::SeqCst);
            }));
        }
        for t in tareas {
            t.await.unwrap();
        }
        assert!(pico.load(Ordering::SeqCst) <= 2, "pico de {}", pico.load(Ordering::SeqCst));
    }

    #[test]
    fn el_nombre_que_da_el_proveedor_no_puede_salir_del_directorio() {
        // En la v1 esto mismo era escritura de fichero arbitraria. El `id` de
        // una foto viene de fuera y se mete tal cual en el nombre.
        assert!(!sanear("../../.ssh/authorized_keys").contains('/'));
        assert!(!sanear("../../evil").contains(".."));
        assert!(!sanear("a/b/c.jpg").contains('/'));
        assert!(!sanear("x\\y.jpg").contains('\\'));
        // Y lo normal se conserva legible, que es la mitad de para qué sirve
        // un nombre de fichero.
        assert_eq!(sanear("mly-1234567890.jpg"), "mly-1234567890.jpg");
        assert_eq!(sanear("goo-CAoSLEFG-90.jpg"), "goo-CAoSLEFG-90.jpg");
        // Un nombre imposible cae al hash en vez de quedarse vacío.
        assert!(sanear("").ends_with(".jpg"));
    }
}
```

- [ ] **Step 3: Implementar `origins/mod.rs`**

Crear `indexer/src-tauri/src/origins/mod.rs`:

```rust
//! Los orígenes de red, detrás de un solo contrato.
//!
//! `Falso` no es andamio de pruebas que sobra: es lo que permite probar el
//! planificador, la reanudación y el presupuesto SIN salir a internet ni gastar
//! cuota. Una prueba que necesita red y clave no se corre en cada commit.

pub mod commons;
pub mod flickr;
pub mod google;
pub mod kartaview;
pub mod mapbox;
pub mod mapillary;
pub mod calles;

use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use anyhow::Result;
use async_trait::async_trait;
use lumi_index::budget::Presupuesto;
use lumi_index::manifest::Tipo;
use lumi_index::network::{Captura, Disponibilidad, Redistribucion, Tarifa};
use tokio::sync::Semaphore;

use crate::keys::Claves;

/// Cuánto espera un adaptador antes de darse por vencido con una petición.
pub const TIMEOUT: Duration = Duration::from_secs(30);

#[async_trait]
pub trait OrigenDeRed: Send + Sync {
    fn id(&self) -> &'static str;
    fn tipo(&self) -> Tipo;
    fn tarifa(&self) -> Tarifa;
    fn redistribucion(&self) -> Redistribucion;

    /// Si el sondeo de este origen se puede pintar como puntos exactos. Solo
    /// Mapillary: es el único con teselas vectoriales públicas y estables, y
    /// esa asimetría llega hasta la leyenda del mapa.
    fn puntos_exactos(&self) -> bool {
        false
    }

    /// Qué hay aquí, sin bajar un píxel.
    async fn sondear(&self, tesela: &str) -> Result<Disponibilidad>;

    /// Baja lo que haya contra un presupuesto que NO puede sobrepasar. Si el
    /// presupuesto se agota a mitad, devuelve lo que llevara: es trabajo bueno
    /// y ya pagado.
    async fn descargar(&self, tesela: &str, tope: &Presupuesto) -> Result<Vec<Captura>>;
}

/// Peticiones por segundo y peticiones a la vez. Los dos hacen falta: el
/// semáforo evita abrir cincuenta conexiones y el intervalo evita que las dos
/// permitidas salgan disparadas mil veces por segundo.
pub struct Limitador {
    permisos: Semaphore,
    intervalo: Duration,
    ultima: tokio::sync::Mutex<Option<tokio::time::Instant>>,
}

impl Limitador {
    pub fn nuevo(req_s: u32, concurrencia: usize) -> Self {
        Self {
            permisos: Semaphore::new(concurrencia),
            intervalo: Duration::from_micros(1_000_000 / req_s.max(1) as u64),
            ultima: tokio::sync::Mutex::new(None),
        }
    }

    /// El permiso se suelta al soltar lo devuelto. Un `429` cuesta más tiempo
    /// que la petición que se habría ahorrado yendo deprisa, así que estos
    /// números son conservadores a propósito.
    pub async fn permiso(&self) -> tokio::sync::SemaphorePermit<'_> {
        let p = self.permisos.acquire().await.expect("el semáforo no se cierra");
        let mut u = self.ultima.lock().await;
        if let Some(t) = *u {
            let pasado = t.elapsed();
            if pasado < self.intervalo {
                tokio::time::sleep(self.intervalo - pasado).await;
            }
        }
        *u = Some(tokio::time::Instant::now());
        p
    }
}

/// Sustituye todo lo que `lumi_index::legacy::nombre_seguro` no acepta y deja
/// un nombre que no puede salir de su directorio.
///
/// Se SUSTITUYE en vez de rechazar porque el identificador viene del proveedor
/// y un carácter raro no debería costar la imagen; lo que no se negocia es que
/// el resultado no pueda escapar. La comprobación final es la misma función que
/// el 7a usa para los paquetes legacy, así que las dos puertas coinciden.
pub fn sanear(nombre: &str) -> String {
    let limpio: String = nombre
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '.') { c } else { '_' })
        .collect();
    // `..` sigue siendo posible con puntos legítimos ("a..b.jpg"), y
    // `nombre_seguro` lo rechaza con razón: se colapsan.
    let limpio = limpio.replace("..", "._");
    if lumi_index::legacy::nombre_seguro(&limpio) {
        limpio
    } else {
        // Última red: un nombre vacío o imposible se sustituye por su hash.
        format!("{:x}.jpg", <sha2::Sha256 as sha2::Digest>::digest(nombre.as_bytes()))
    }
}

/// Lo que todo adaptador necesita: un cliente HTTP, su clave si la tiene, y el
/// directorio de paso donde deja lo que baje.
pub struct Ctx {
    pub cliente: reqwest::Client,
    pub clave: Option<String>,
    pub stage: PathBuf,
    pub limitador: Limitador,
}

impl Ctx {
    pub fn nuevo(clave: Option<String>, stage: PathBuf, req_s: u32, conc: usize) -> Self {
        Self {
            cliente: reqwest::Client::builder()
                .timeout(TIMEOUT)
                .user_agent(concat!("LumiIndexer/", env!("CARGO_PKG_VERSION")))
                .build()
                .expect("el cliente HTTP se construye con la configuración por defecto"),
            clave,
            stage,
            limitador: Limitador::nuevo(req_s, conc),
        }
    }

    /// Baja unos bytes y los deja en el directorio de paso. Comprueba que
    /// DECODIFICA como imagen antes de devolver la ruta: la extensión no basta
    /// ni con material propio.
    ///
    /// EL NOMBRE SE SANEA SIEMPRE. Los adaptadores lo componen con el
    /// identificador que da el proveedor (`mly-{id}.jpg`), y ese identificador
    /// viene de fuera: un `id` con `../` escaparía del directorio de paso y
    /// escribiría donde quisiera. En la v1 esto mismo era escritura de fichero
    /// arbitraria, y `nombre_seguro` existe desde el 7a justamente por eso.
    pub async fn bajar_imagen(&self, url: &str, nombre: &str) -> Result<PathBuf> {
        let nombre = sanear(nombre);
        let _p = self.limitador.permiso().await;
        let r = self.cliente.get(url).send().await?;
        if !r.status().is_success() {
            anyhow::bail!("{} respondió {}", crate::keys::redactar(url), r.status());
        }
        let bytes = r.bytes().await?;
        let ruta = self.stage.join(&nombre);
        std::fs::create_dir_all(&self.stage)?;
        std::fs::write(&ruta, &bytes)?;
        if image::image_dimensions(&ruta).is_err() {
            let _ = std::fs::remove_file(&ruta);
            anyhow::bail!("lo que devolvió {} no decodifica como imagen", crate::keys::redactar(url));
        }
        Ok(ruta)
    }
}

/// Todos los orígenes con clave configurada. **Uno sin clave no entra en la
/// lista**: mejor ausente que presente y reventando cuando el gasto ya está
/// confirmado.
pub fn registro(claves: &Claves, stage: PathBuf) -> Vec<Box<dyn OrigenDeRed>> {
    let mut v: Vec<Box<dyn OrigenDeRed>> = Vec::new();
    if let Ok(Some(k)) = claves.leer("mapillary") {
        v.push(Box::new(mapillary::Mapillary::nuevo(k, stage.clone())));
    }
    // KartaView no necesita clave.
    v.push(Box::new(kartaview::KartaView::nuevo(stage.clone())));
    if let Ok(Some(k)) = claves.leer("google") {
        v.push(Box::new(google::Google::nuevo(k, stage.clone())));
    }
    if let Ok(Some(k)) = claves.leer("mapbox-satelite") {
        v.push(Box::new(mapbox::MapboxSatelite::nuevo(k, stage.clone())));
    }
    // Commons tampoco.
    v.push(Box::new(commons::Commons::nuevo(stage.clone())));
    if let Ok(Some(k)) = claves.leer("flickr") {
        v.push(Box::new(flickr::Flickr::nuevo(k, stage)));
    }
    v
}

// ── El origen falso ──────────────────────────────────────────────────────

/// Un origen guionizado. Existe para probar el planificador entero sin red.
pub struct Falso {
    id: &'static str,
    tipo: Tipo,
    tarifa: Tarifa,
    guion: std::collections::HashMap<String, u32>,
}

impl Falso {
    pub fn nuevo(id: &'static str, tipo: Tipo, tarifa: Tarifa) -> Self {
        Self { id, tipo, tarifa, guion: Default::default() }
    }
    pub fn con(mut self, tesela: &str, cuantas: u32) -> Self {
        self.guion.insert(tesela.to_string(), cuantas);
        self
    }
}

#[async_trait]
impl OrigenDeRed for Falso {
    fn id(&self) -> &'static str {
        self.id
    }
    fn tipo(&self) -> Tipo {
        self.tipo
    }
    fn tarifa(&self) -> Tarifa {
        self.tarifa
    }
    fn redistribucion(&self) -> Redistribucion {
        Redistribucion::Libre { licencia: "CC BY-SA 4.0".into() }
    }

    async fn sondear(&self, tesela: &str) -> Result<Disponibilidad> {
        let n = self.guion.get(tesela).copied().unwrap_or(0);
        Ok(Disponibilidad::Muestreo { nivel: lumi_index::network::Nivel::de(n), estimadas: n })
    }

    async fn descargar(&self, tesela: &str, tope: &Presupuesto) -> Result<Vec<Captura>> {
        let n = self.guion.get(tesela).copied().unwrap_or(0);
        let mut fuera = Vec::new();
        for i in 0..n {
            // Se apunta ANTES de "servir": si no cabe, se para y se devuelve lo
            // que llevara. Media petición no existe.
            if tope.gastar(&self.tarifa, 1).is_err() {
                break;
            }
            fuera.push(Captura {
                fuente: self.id,
                id_origen: format!("{tesela}-{i}"),
                ruta: PathBuf::from(format!("/dev/null/{tesela}-{i}.jpg")),
                lat: 43.36,
                lng: -8.41,
                rumbo: Some(0.0),
                capturada_en: None,
                atribucion: lumi_index::coverage::Atribucion {
                    autor: self.id.to_string(),
                    url: format!("https://example.org/{tesela}/{i}"),
                    licencia: "CC BY-SA 4.0".into(),
                },
                unidades: 1,
            });
        }
        Ok(fuera)
    }
}

/// `Arc` para poder compartir un origen entre las tareas concurrentes del
/// planificador sin clonarlo.
pub type Origen = Arc<dyn OrigenDeRed>;
```

- [ ] **Step 4: Crear los seis ficheros vacíos para que compile**

Cada uno con un `//!` de una línea; se rellenan en las tareas 7-9.

```bash
for f in mapillary kartaview google mapbox commons flickr calles; do
  echo "//! Pendiente: se escribe en las tareas 7-9 del plan del 7b." > indexer/src-tauri/src/origins/$f.rs
done
```

Y comentar en `origins/mod.rs` las líneas de `registro` que referencian tipos que aún no
existen, dejando solo `Vec::new()`; se descomentan en cada tarea. Concretamente, sustituir el
cuerpo de `registro` por:

```rust
pub fn registro(_claves: &Claves, _stage: PathBuf) -> Vec<Box<dyn OrigenDeRed>> {
    // ponytail: se va llenando en las tareas 7, 8 y 9. El techo es que hasta
    // entonces el planificador solo puede correr con `Falso`; la salida, las
    // propias tareas.
    Vec::new()
}
```

- [ ] **Step 5: Declarar el módulo y comprobar**

En `lib.rs`, añadir `mod origins;`.

Run: `cargo test -p indexer-app origins`
Expected: PASS, 2 tests.

- [ ] **Step 6: Commit**

```bash
git add indexer/src-tauri/Cargo.toml indexer/src-tauri/src/origins indexer/src-tauri/src/lib.rs
git commit -m "El contrato de red con su limitador, y un origen falso para probar sin gastar"
```

---

## Task 7: Mapillary

**Files:**
- Modify: `indexer/src-tauri/src/origins/mapillary.rs`
- Modify: `indexer/src-tauri/src/origins/mod.rs` (registro)

**Interfaces:**
- Consumes: `Ctx`, `OrigenDeRed`, `lumi_index::tiles::bbox_de_tesela`.
- Produces: `mapillary::Mapillary::nuevo(token: String, stage: PathBuf)`;
  `mapillary::URL_TESELAS_VECTORIALES` y `mapillary::CAPA_VECTORIAL`, que consume la Task 14.

**El detalle que ahorra un módulo entero:** una tesela z14 mide ~0,0005 grados cuadrados y el
tope de área de la Graph API es 0,01. Cabe veinte veces. Así que el backend **no decodifica
teselas vectoriales**: sondea y descarga por bbox con una sola consulta por tesela. Las
vectoriales son solo para que Mapbox GL las pinte en el navegador, y ahí no hay Rust.

- [ ] **Step 1: Escribir el test (falla)**

Al final de `indexer/src-tauri/src/origins/mapillary.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn la_url_de_consulta_lleva_el_bbox_y_nunca_la_clave() {
        let m = Mapillary::nuevo("MLY|SECRETO".into(), std::path::PathBuf::from("/tmp"));
        let u = m.url_consulta("03113322013021");
        assert!(u.contains("graph.mapillary.com/images"), "{u}");
        assert!(u.contains("bbox="), "{u}");
        // Mapillary SÍ ofrece cabecera (`Authorization: OAuth`), así que aquí
        // la regla de «ningún secreto en una ruta» se cumple sin excepción.
        assert!(!u.contains("SECRETO"), "la clave no puede ir en la URL: {u}");
        assert!(!u.contains("access_token"), "{u}");
    }

    #[test]
    fn el_bbox_va_en_el_orden_que_pide_la_graph_api() {
        let m = Mapillary::nuevo("t".into(), std::path::PathBuf::from("/tmp"));
        let qk = lumi_index::tiles::quadkey(43.3623, -8.4115);
        let u = m.url_consulta(&qk);
        let bbox = u.split("bbox=").nth(1).unwrap().split('&').next().unwrap();
        let n: Vec<f64> = bbox.split(',').map(|s| s.parse().unwrap()).collect();
        assert_eq!(n.len(), 4);
        assert!(n[0] < n[2], "oeste antes que este: {bbox}");
        assert!(n[1] < n[3], "sur antes que norte: {bbox}");
        // Y el área cabe de sobra en el tope de 0,01 de la Graph API.
        assert!((n[2] - n[0]) * (n[3] - n[1]) < 0.001, "{bbox}");
    }

    #[test]
    fn una_foto_sin_url_de_imagen_es_un_resultado_y_se_salta() {
        let json = r#"{"data":[
          {"id":"1","thumb_2048_url":"https://x/1.jpg","compass_angle":10.0,
           "geometry":{"type":"Point","coordinates":[-8.41,43.36]},
           "creator":{"username":"ana"},"captured_at":1714646400000},
          {"id":"2","compass_angle":20.0,
           "geometry":{"type":"Point","coordinates":[-8.42,43.37]}}
        ]}"#;
        let r: Respuesta = serde_json::from_str(json).unwrap();
        let utiles: Vec<_> = r.data.iter().filter(|f| f.thumb_2048_url.is_some()).collect();
        assert_eq!(utiles.len(), 1);
        assert_eq!(utiles[0].id, "1");
        assert_eq!(posicion(utiles[0]), Some((43.36, -8.41)), "lat primero, lng después");
    }

    #[test]
    fn la_marca_de_tiempo_sale_en_iso_utc() {
        // 1714646400000 ms = 2024-05-02T10:40:00Z
        assert_eq!(marca_iso(1_714_646_400_000), "2024-05-02T10:40:00Z");
        assert_eq!(marca_iso(0), "1970-01-01T00:00:00Z");
    }
}
```

- [ ] **Step 2: Comprobar que falla**

Run: `cargo test -p indexer-app mapillary`
Expected: FAIL de compilación, `cannot find type Mapillary`.

- [ ] **Step 3: Implementar el adaptador**

Contenido completo de `indexer/src-tauri/src/origins/mapillary.rs`, antes del `mod tests`:

```rust
//! Mapillary. El único origen con puntos exactos, y por dos vías distintas:
//!
//!   - En el NAVEGADOR, sus teselas vectoriales oficiales, que Mapbox GL pinta
//!     como una capa más. Gratis, ya cacheadas, sin pasar por el backend.
//!   - En el BACKEND, la Graph API por bbox. Una tesela z14 mide ~0,0005 grados
//!     cuadrados y el tope de área de la Graph API es 0,01: cabe veinte veces.
//!     Por eso aquí no hace falta decodificar teselas vectoriales en Rust.

use std::path::PathBuf;

use anyhow::Result;
use async_trait::async_trait;
use lumi_index::budget::Presupuesto;
use lumi_index::coverage::Atribucion;
use lumi_index::manifest::Tipo;
use lumi_index::network::{Captura, Disponibilidad, Redistribucion, Tarifa};
use lumi_index::tiles::bbox_de_tesela;
use serde::Deserialize;

use super::{Ctx, OrigenDeRed};

const GRAPH: &str = "https://graph.mapillary.com/images";
const CAMPOS: &str =
    "id,compass_angle,thumb_2048_url,captured_at,creator,computed_geometry,geometry";

/// Tope de fotos por tesela.
///
/// ponytail: la Graph API pagina y esto se queda con la primera página. El
/// techo es que una tesela con más de 2000 fotos se indexa parcialmente; la
/// salida, seguir `paging.next`. No se hace porque 2000 fotos en 2,4 km² ya es
/// cobertura densa, y la segunda página rinde menos que bajar otra tesela.
const LIMITE: u32 = 2000;

/// La plantilla de teselas vectoriales que consume el frontend. Vive aquí y no
/// en el TypeScript para que la URL y la capa estén en el mismo sitio que el
/// adaptador que las explica.
pub const URL_TESELAS_VECTORIALES: &str =
    "https://tiles.mapillary.com/maps/vtp/mly1_public/2/{z}/{x}/{y}";
pub const CAPA_VECTORIAL: &str = "image";

#[derive(Debug, Deserialize)]
pub struct Geometria {
    pub coordinates: [f64; 2],
}

#[derive(Debug, Deserialize)]
pub struct Autor {
    pub username: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct Foto {
    pub id: String,
    pub compass_angle: Option<f32>,
    pub thumb_2048_url: Option<String>,
    pub captured_at: Option<i64>,
    pub creator: Option<Autor>,
    /// Posición refinada por SfM: más exacta que el GPS crudo de `geometry`,
    /// así que se prefiere cuando viene.
    pub computed_geometry: Option<Geometria>,
    pub geometry: Option<Geometria>,
}

#[derive(Debug, Deserialize)]
pub struct Respuesta {
    pub data: Vec<Foto>,
}

/// `(lat, lng)`. GeoJSON las da al revés, y confundirlas coloca A Coruña en
/// mitad del Atlántico sin que nada falle.
pub fn posicion(f: &Foto) -> Option<(f64, f64)> {
    let g = f.computed_geometry.as_ref().or(f.geometry.as_ref())?;
    Some((g.coordinates[1], g.coordinates[0]))
}

pub struct Mapillary {
    ctx: Ctx,
}

impl Mapillary {
    pub fn nuevo(token: String, stage: PathBuf) -> Self {
        Self { ctx: Ctx::nuevo(Some(token), stage, 8, 4) }
    }

    pub fn url_consulta(&self, tesela: &str) -> String {
        let b = bbox_de_tesela(tesela);
        format!(
            "{GRAPH}?fields={CAMPOS}&limit={LIMITE}&bbox={},{},{},{}",
            b.oeste, b.sur, b.este, b.norte
        )
    }

    async fn consultar(&self, tesela: &str) -> Result<Vec<Foto>> {
        let url = self.url_consulta(tesela);
        let _p = self.ctx.limitador.permiso().await;
        let token = self.ctx.clave.as_deref().unwrap_or_default();
        let r = self
            .ctx
            .cliente
            .get(&url)
            .header("Authorization", format!("OAuth {token}"))
            .send()
            .await?;
        if !r.status().is_success() {
            anyhow::bail!("Mapillary respondió {} a {}", r.status(), crate::keys::redactar(&url));
        }
        Ok(r.json::<Respuesta>().await?.data)
    }
}

#[async_trait]
impl OrigenDeRed for Mapillary {
    fn id(&self) -> &'static str {
        "mapillary"
    }
    fn tipo(&self) -> Tipo {
        Tipo::Calle
    }
    fn tarifa(&self) -> Tarifa {
        Tarifa::Gratis
    }
    fn redistribucion(&self) -> Redistribucion {
        Redistribucion::Libre { licencia: "CC BY-SA 4.0".into() }
    }
    fn puntos_exactos(&self) -> bool {
        true
    }

    async fn sondear(&self, tesela: &str) -> Result<Disponibilidad> {
        Ok(Disponibilidad::Puntos { cuantos: self.consultar(tesela).await?.len() as u32 })
    }

    async fn descargar(&self, tesela: &str, tope: &Presupuesto) -> Result<Vec<Captura>> {
        let mut fuera = Vec::new();
        for f in self.consultar(tesela).await? {
            // Los dos casos de abajo son RESULTADOS, no averías: una foto sin
            // URL o sin posición no se puede usar, se salta y no se reintenta.
            let Some(url) = f.thumb_2048_url.clone() else { continue };
            let Some((lat, lng)) = posicion(&f) else { continue };
            if tope.gastar(&self.tarifa(), 1).is_err() {
                break;
            }
            let ruta = match self.ctx.bajar_imagen(&url, &format!("mly-{}.jpg", f.id)).await {
                Ok(r) => r,
                Err(e) => {
                    log::warn!("mapillary {}: {e}", f.id);
                    continue;
                }
            };
            let autor = f.creator.as_ref().and_then(|c| c.username.clone());
            fuera.push(Captura {
                fuente: "mapillary",
                id_origen: f.id.clone(),
                ruta,
                lat,
                lng,
                rumbo: f.compass_angle,
                capturada_en: f.captured_at.map(marca_iso),
                atribucion: Atribucion {
                    autor: autor.unwrap_or_else(|| "Mapillary".into()),
                    url: format!("https://www.mapillary.com/app/?pKey={}", f.id),
                    licencia: "CC BY-SA 4.0".into(),
                },
                unidades: 1,
            });
        }
        Ok(fuera)
    }
}

/// Milisegundos de época a ISO 8601 en UTC, sin arrastrar `chrono` por una
/// función. `capturada_en` es una cadena que solo se guarda y se enseña.
/// El calendario es el `civil_from_days` de Howard Hinnant.
pub fn marca_iso(ms: i64) -> String {
    let s = ms.div_euclid(1000);
    let (dias, resto) = (s.div_euclid(86_400), s.rem_euclid(86_400));
    let z = dias + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    format!(
        "{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}Z",
        resto / 3600,
        (resto % 3600) / 60,
        resto % 60
    )
}
```

- [ ] **Step 4: Añadirlo al registro**

En `origins/mod.rs`, sustituir el cuerpo provisional de `registro` por:

```rust
pub fn registro(claves: &Claves, stage: PathBuf) -> Vec<Box<dyn OrigenDeRed>> {
    let mut v: Vec<Box<dyn OrigenDeRed>> = Vec::new();
    if let Ok(Some(k)) = claves.leer("mapillary") {
        v.push(Box::new(mapillary::Mapillary::nuevo(k, stage.clone())));
    }
    // ponytail: los cinco restantes entran en las tareas 8 y 9.
    let _ = stage;
    v
}
```

- [ ] **Step 5: Comprobar**

Run: `cargo test -p indexer-app mapillary`
Expected: PASS, 4 tests.

- [ ] **Step 6: Commit**

```bash
git add indexer/src-tauri/src/origins/mapillary.rs indexer/src-tauri/src/origins/mod.rs
git commit -m "Mapillary: una sola consulta por tesela, porque el bbox cabe de sobra"
```

---

## Task 8: Muestreo de calles, KartaView y Google

**Files:**
- Create: `crates/lumi-index/src/streets.rs`
- Modify: `crates/lumi-index/src/lib.rs`
- Modify: `indexer/src-tauri/src/origins/calles.rs`
- Modify: `indexer/src-tauri/src/origins/kartaview.rs`
- Modify: `indexer/src-tauri/src/origins/google.rs`
- Modify: `indexer/src-tauri/src/origins/mod.rs`

**Interfaces:**
- Produces: `streets::muestrear(lineas: &[Vec<Punto>], cada_m: f64) -> Vec<Punto>`;
  `streets::haversine_m(a: Punto, b: Punto) -> f64`;
  `calles::puntos_de_tesela(&Ctx, tesela) -> Result<Vec<Punto>>`;
  `calles::muestra_para_sondeo(&[Punto]) -> Vec<Punto>`; `calles::PUNTOS_DE_SONDEO`;
  `kartaview::KartaView::nuevo(stage)`; `google::Google::nuevo(clave, stage)`.

Los tres van juntos porque comparten mecanismo: **ninguno tiene cobertura por tesela**, así
que hay que muestrear puntos a lo largo de las calles y preguntar punto a punto. Por eso los
tres se pintan como sombreado y no como puntos.

- [ ] **Step 1: Escribir el test del muestreo puro (falla)**

Crear `crates/lumi-index/src/streets.rs` con solo:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn la_distancia_es_haversine_de_verdad() {
        // Un grado de latitud son ~111,2 km en cualquier meridiano.
        let d = haversine_m(Punto { lat: 43.0, lng: -8.0 }, Punto { lat: 44.0, lng: -8.0 });
        assert!((d - 111_195.0).abs() < 500.0, "{d}");
        assert_eq!(haversine_m(Punto { lat: 1.0, lng: 1.0 }, Punto { lat: 1.0, lng: 1.0 }), 0.0);
    }

    #[test]
    fn se_muestrea_cada_n_metros_y_el_primer_vertice_siempre_entra() {
        // Una recta de ~1112 m, muestreada cada 100 m.
        let linea = vec![Punto { lat: 43.0, lng: -8.0 }, Punto { lat: 43.01, lng: -8.0 }];
        let p = muestrear(&[linea], 100.0);
        assert!(p.len() >= 11 && p.len() <= 13, "salieron {}", p.len());
        assert_eq!(p[0], Punto { lat: 43.0, lng: -8.0 });
        for v in p.windows(2) {
            let d = haversine_m(v[0], v[1]);
            assert!(d > 80.0 && d < 120.0, "separación de {d} m");
        }
    }

    #[test]
    fn una_calle_mas_corta_que_el_paso_deja_un_punto_y_no_cero() {
        // Si no, un callejón de 20 m no se sondearía nunca y su tesela saldría
        // vacía por un artefacto del muestreo, no por falta de cobertura.
        let corta = vec![Punto { lat: 43.0, lng: -8.0 }, Punto { lat: 43.0001, lng: -8.0 }];
        assert_eq!(muestrear(&[corta], 100.0).len(), 1);
    }

    #[test]
    fn la_esquina_que_comparten_dos_calles_sale_una_sola_vez() {
        // Overpass devuelve la geometría entera de cada vía, y dos vías que se
        // cruzan traen el mismo nodo. Preguntar dos veces por el mismo punto es
        // pagar dos veces en Google.
        let a = vec![Punto { lat: 43.0, lng: -8.0 }, Punto { lat: 43.01, lng: -8.0 }];
        let b = vec![Punto { lat: 43.0, lng: -8.0 }, Punto { lat: 43.0, lng: -7.99 }];
        let p = muestrear(&[a, b], 100.0);
        let n = p.iter().filter(|q| haversine_m(**q, Punto { lat: 43.0, lng: -8.0 }) < 1.0).count();
        assert_eq!(n, 1);
    }
}
```

- [ ] **Step 2: Comprobar que falla**

Run: `cargo test -p lumi-index streets`
Expected: FAIL de compilación.

- [ ] **Step 3: Implementar `streets.rs`**

Antes del `mod tests`, y añadir `pub mod streets;` a `crates/lumi-index/src/lib.rs`:

```rust
//! Muestrear puntos a lo largo de unas calles. Puro: quién trae las calles es
//! asunto del adaptador que llame.
//!
//! Existe porque tres de los seis orígenes no tienen cobertura por tesela y hay
//! que preguntarles punto a punto. Es un ayudante de esos tres y no un concepto
//! del sistema: el cenital y las fotos sueltas no muestrean nada.

use crate::tiles::Punto;

/// Radio medio de la Tierra, en metros.
const R: f64 = 6_371_008.8;

pub fn haversine_m(a: Punto, b: Punto) -> f64 {
    let (la1, la2) = (a.lat.to_radians(), b.lat.to_radians());
    let dla = la2 - la1;
    let dlo = (b.lng - a.lng).to_radians();
    let h = (dla / 2.0).sin().powi(2) + la1.cos() * la2.cos() * (dlo / 2.0).sin().powi(2);
    2.0 * R * h.sqrt().asin()
}

/// Interpolación lineal en grados. A escala de una manzana el error de tratar
/// grados como plano es de centímetros, y al muestreo le basta con caer
/// *sobre* la calle.
fn entre(a: Punto, b: Punto, t: f64) -> Punto {
    Punto { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t }
}

/// Un punto cada `cada_m` metros a lo largo de cada polilínea.
///
/// Los duplicados se colapsan a ~1 m, y una calle más corta que el paso deja
/// **un** punto y no cero. Las dos cosas están razonadas en los tests.
pub fn muestrear(lineas: &[Vec<Punto>], cada_m: f64) -> Vec<Punto> {
    let cada_m = cada_m.max(1.0);
    let mut fuera: Vec<Punto> = Vec::new();
    fn mete(p: Punto, fuera: &mut Vec<Punto>) {
        if !fuera.iter().any(|q| haversine_m(*q, p) < 1.0) {
            fuera.push(p);
        }
    }

    for linea in lineas {
        let Some(primero) = linea.first() else { continue };
        mete(*primero, &mut fuera);
        // `sobrante` es lo ya recorrido desde el último punto emitido, para que
        // el paso sea continuo entre segmentos y no se reinicie en cada vértice.
        let mut sobrante = 0.0;
        for par in linea.windows(2) {
            let (a, b) = (par[0], par[1]);
            let largo = haversine_m(a, b);
            if largo <= f64::EPSILON {
                continue;
            }
            let mut avance = cada_m - sobrante;
            while avance <= largo {
                mete(entre(a, b, avance / largo), &mut fuera);
                avance += cada_m;
            }
            sobrante = (sobrante + largo) % cada_m;
        }
    }
    fuera
}
```

- [ ] **Step 4: Comprobar**

Run: `cargo test -p lumi-index streets`
Expected: PASS, 4 tests.

- [ ] **Step 5: Implementar `calles.rs` con su test**

Contenido completo de `indexer/src-tauri/src/origins/calles.rs`:

```rust
//! De dónde salen las calles de una tesela: Overpass.
//!
//! Es infraestructura donada, así que se le pide poco y despacio. Y se le pide
//! **una vez por tesela**: el resultado sirve para los tres orígenes que
//! muestrean, no uno por origen.

use anyhow::Result;
use lumi_index::tiles::{bbox_de_tesela, Punto};
use serde::Deserialize;

use super::Ctx;

const OVERPASS: &str = "https://overpass-api.de/api/interpreter";

/// Cada cuántos metros se pregunta. 20 m es lo que usaba la v1: más fino
/// devuelve la misma panorámica repetida, más grueso deja huecos de fachada.
pub const PASO_M: f64 = 20.0;

/// Cuántos puntos se sondean de verdad para estimar. Sondear los ~600 puntos de
/// una tesela urbana solo para saber si hay cobertura cuesta casi tanto como
/// bajarla.
///
/// ponytail: la estimación extrapola de esta muestra al total. El techo es que
/// una tesela con cobertura muy desigual se estima mal; la salida, subir el
/// número. Se acepta porque la estimación orienta antes de confirmar, no
/// factura: en el libro de gasto solo entra lo servido.
pub const PUNTOS_DE_SONDEO: usize = 24;

#[derive(Debug, Deserialize)]
struct Nodo {
    lat: f64,
    lon: f64,
}

#[derive(Debug, Deserialize)]
struct Elemento {
    #[serde(default)]
    geometry: Vec<Nodo>,
}

#[derive(Debug, Deserialize)]
struct Respuesta {
    elements: Vec<Elemento>,
}

/// Las vías transitables de una tesela, como polilíneas.
///
/// Overpass devuelve la geometría ENTERA de una vía aunque solo cruce la
/// tesela. No se recorta aquí: el muestreo colapsa duplicados y el planificador
/// sabe a qué tesela pertenece cada foto por su quadkey real.
pub async fn calles_de_tesela(ctx: &Ctx, tesela: &str) -> Result<Vec<Vec<Punto>>> {
    let b = bbox_de_tesela(tesela);
    let consulta = format!(
        "[out:json][timeout:25];\
         way[\"highway\"~\"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|pedestrian|service)$\"]\
         ({},{},{},{});out geom;",
        b.sur, b.oeste, b.norte, b.este
    );
    let _p = ctx.limitador.permiso().await;
    let r = ctx.cliente.post(OVERPASS).body(consulta).send().await?;
    if !r.status().is_success() {
        anyhow::bail!("Overpass respondió {}", r.status());
    }
    Ok(r.json::<Respuesta>()
        .await?
        .elements
        .into_iter()
        .map(|e| e.geometry.into_iter().map(|n| Punto { lat: n.lat, lng: n.lon }).collect())
        .filter(|v: &Vec<Punto>| !v.is_empty())
        .collect())
}

pub async fn puntos_de_tesela(ctx: &Ctx, tesela: &str) -> Result<Vec<Punto>> {
    let lineas = calles_de_tesela(ctx, tesela).await?;
    Ok(lumi_index::streets::muestrear(&lineas, PASO_M))
}

/// Una muestra repartida por toda la tesela, no los primeros N: esos estarían
/// todos en la misma calle y la extrapolación diría cualquier cosa.
pub fn muestra_para_sondeo(puntos: &[Punto]) -> Vec<Punto> {
    if puntos.len() <= PUNTOS_DE_SONDEO {
        return puntos.to_vec();
    }
    let paso = (puntos.len() / PUNTOS_DE_SONDEO).max(1);
    puntos.iter().step_by(paso).take(PUNTOS_DE_SONDEO).copied().collect()
}

/// Extrapola lo encontrado en la muestra al total de puntos de la tesela.
pub fn extrapolar(encontradas: u32, muestra: usize, total: usize) -> u32 {
    if muestra == 0 {
        return 0;
    }
    (encontradas as f64 * total as f64 / muestra as f64).round() as u32
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn la_muestra_se_reparte_por_la_tesela_y_no_se_apelotona() {
        let muchos: Vec<Punto> =
            (0..600).map(|i| Punto { lat: 43.0 + i as f64 * 1e-5, lng: -8.0 }).collect();
        let m = muestra_para_sondeo(&muchos);
        assert_eq!(m.len(), PUNTOS_DE_SONDEO);
        assert_eq!(m[0], muchos[0]);
        // El último de la muestra cae en la segunda mitad. Si estuvieran los 24
        // primeros, todos caerían en la misma calle.
        assert!(m[PUNTOS_DE_SONDEO - 1].lat > 43.0 + 300.0 * 1e-5, "{:?}", m.last());
    }

    #[test]
    fn con_pocos_puntos_se_sondean_todos() {
        let pocos: Vec<Punto> =
            (0..5).map(|i| Punto { lat: 43.0 + i as f64 * 1e-4, lng: -8.0 }).collect();
        assert_eq!(muestra_para_sondeo(&pocos).len(), 5);
    }

    #[test]
    fn la_extrapolacion_escala_y_aguanta_el_cero() {
        assert_eq!(extrapolar(12, 24, 600), 300);
        assert_eq!(extrapolar(0, 24, 600), 0);
        // Una tesela sin calles no divide por cero.
        assert_eq!(extrapolar(0, 0, 0), 0);
    }
}
```

Run: `cargo test -p indexer-app calles` → PASS, 3 tests.

- [ ] **Step 6: Implementar `kartaview.rs`**

Contenido completo de `indexer/src-tauri/src/origins/kartaview.rs`:

```rust
//! KartaView.
//!
//! El spec §4 dejaba abierta la posibilidad de usar su capa de cobertura «si
//! hay un endpoint de teselas estable». No lo hay documentado: lo único firme
//! es `nearby-photos`, que es por punto. Así que KartaView cae al lenguaje de
//! MUESTREO igual que Google, y en el mapa se pinta como sombreado de tesela.
//!
//! El host es `api.openstreetcam.org`, el dominio antiguo que sigue sirviendo:
//! `kartaview.org` devuelve el armazón de su aplicación para rutas arbitrarias
//! en vez de redirigir al nodo de almacenamiento, así que no vale para bajar.

use std::path::PathBuf;

use anyhow::Result;
use async_trait::async_trait;
use lumi_index::budget::Presupuesto;
use lumi_index::coverage::Atribucion;
use lumi_index::manifest::Tipo;
use lumi_index::network::{Captura, Disponibilidad, Nivel, Redistribucion, Tarifa};
use lumi_index::tiles::Punto;
use serde::Deserialize;

use super::calles::{extrapolar, muestra_para_sondeo, puntos_de_tesela};
use super::{Ctx, OrigenDeRed};

const HOST: &str = "https://api.openstreetcam.org";
const RADIO_M: u32 = 20;

#[derive(Debug, Deserialize)]
struct FotoKv {
    id: String,
    heading: Option<String>,
    /// Ruta relativa al host, que redirige al nodo real de almacenamiento.
    name: String,
    date_added: Option<String>,
    username: Option<String>,
}

#[derive(Debug, Deserialize)]
struct RespuestaKv {
    #[serde(rename = "currentPageItems", default)]
    items: Vec<FotoKv>,
}

pub struct KartaView {
    ctx: Ctx,
}

impl KartaView {
    pub fn nuevo(stage: PathBuf) -> Self {
        Self { ctx: Ctx::nuevo(None, stage, 4, 2) }
    }

    async fn cerca_de(&self, p: Punto) -> Result<Vec<FotoKv>> {
        let _g = self.ctx.limitador.permiso().await;
        let cuerpo = format!("lat={}&lng={}&radius={RADIO_M}", p.lat, p.lng);
        let r = self
            .ctx
            .cliente
            .post(format!("{HOST}/1.0/list/nearby-photos/"))
            .header("Content-Type", "application/x-www-form-urlencoded")
            .body(cuerpo)
            .send()
            .await?;
        if !r.status().is_success() {
            anyhow::bail!("KartaView respondió {}", r.status());
        }
        Ok(r.json::<RespuestaKv>().await?.items)
    }
}

#[async_trait]
impl OrigenDeRed for KartaView {
    fn id(&self) -> &'static str {
        "kartaview"
    }
    fn tipo(&self) -> Tipo {
        Tipo::Calle
    }
    fn tarifa(&self) -> Tarifa {
        Tarifa::Gratis
    }
    fn redistribucion(&self) -> Redistribucion {
        Redistribucion::Libre { licencia: "CC BY-SA 4.0".into() }
    }

    async fn sondear(&self, tesela: &str) -> Result<Disponibilidad> {
        let puntos = puntos_de_tesela(&self.ctx, tesela).await?;
        if puntos.is_empty() {
            return Ok(Disponibilidad::Muestreo { nivel: Nivel::Nada, estimadas: 0 });
        }
        let muestra = muestra_para_sondeo(&puntos);
        let mut encontradas = 0u32;
        for p in &muestra {
            encontradas += self.cerca_de(*p).await.unwrap_or_default().len() as u32;
        }
        let estimadas = extrapolar(encontradas, muestra.len(), puntos.len());
        Ok(Disponibilidad::Muestreo { nivel: Nivel::de(estimadas), estimadas })
    }

    async fn descargar(&self, tesela: &str, tope: &Presupuesto) -> Result<Vec<Captura>> {
        let mut fuera = Vec::new();
        let mut vistas = std::collections::HashSet::new();
        for p in puntos_de_tesela(&self.ctx, tesela).await? {
            for f in self.cerca_de(p).await.unwrap_or_default() {
                // Dos puntos a 20 m devuelven la misma foto. Sin esto, la misma
                // imagen entraría dos veces en el índice.
                if !vistas.insert(f.id.clone()) {
                    continue;
                }
                if tope.gastar(&self.tarifa(), 1).is_err() {
                    return Ok(fuera);
                }
                let url = format!("{HOST}/{}", f.name);
                let ruta = match self.ctx.bajar_imagen(&url, &format!("kv-{}.jpg", f.id)).await {
                    Ok(r) => r,
                    Err(e) => {
                        log::warn!("kartaview {}: {e}", f.id);
                        continue;
                    }
                };
                fuera.push(Captura {
                    fuente: "kartaview",
                    id_origen: f.id.clone(),
                    ruta,
                    lat: p.lat,
                    lng: p.lng,
                    rumbo: f.heading.as_deref().and_then(|h| h.parse().ok()),
                    capturada_en: f.date_added.clone().map(|d| d.replace(' ', "T") + "Z"),
                    atribucion: Atribucion {
                        autor: f.username.clone().unwrap_or_else(|| "KartaView".into()),
                        url: format!("https://kartaview.org/details/{}", f.id),
                        licencia: "CC BY-SA 4.0".into(),
                    },
                    unidades: 1,
                });
            }
        }
        Ok(fuera)
    }
}
```

- [ ] **Step 7: Implementar `google.rs`**

Contenido completo de `indexer/src-tauri/src/origins/google.rs`:

```rust
//! Google Street View. El único origen de calle que cuesta dinero, y el que
//! obliga a que exista toda la maquinaria de presupuesto.
//!
//! Dos endpoints, y la diferencia entre ellos es lo que hace que sondear salga
//! gratis: el de METADATOS no cobra y dice si hay panorámica en un punto; el
//! ESTÁTICO cobra 7,00 $/1000 y devuelve el píxel. Se sondea con el primero y
//! se descarga con el segundo, y en el libro de gasto solo entra el segundo.
//!
//! La clave va por parámetro de consulta porque Google no ofrece cabecera para
//! estos dos endpoints. No es un descuido: es lo único que admite. Por eso toda
//! URL pasa por `keys::redactar` antes de tocar un log.

use std::path::PathBuf;

use anyhow::Result;
use async_trait::async_trait;
use lumi_index::budget::Presupuesto;
use lumi_index::coverage::Atribucion;
use lumi_index::manifest::Tipo;
use lumi_index::network::{Captura, Disponibilidad, Nivel, Redistribucion, Tarifa};
use lumi_index::tiles::Punto;
use serde::Deserialize;

use super::calles::{extrapolar, muestra_para_sondeo, puntos_de_tesela};
use super::{Ctx, OrigenDeRed};

const METADATOS: &str = "https://maps.googleapis.com/maps/api/streetview/metadata";
const ESTATICO: &str = "https://maps.googleapis.com/maps/api/streetview";
/// Los cuatro rumbos de la v1: cubren los 360° sin solape con el campo de
/// visión por defecto de 90°.
const RUMBOS: [u32; 4] = [0, 90, 180, 270];
const TAMANO: &str = "640x640";

#[derive(Debug, Deserialize)]
struct Meta {
    status: String,
    pano_id: Option<String>,
    date: Option<String>,
}

pub struct Google {
    ctx: Ctx,
}

impl Google {
    pub fn nuevo(clave: String, stage: PathBuf) -> Self {
        Self { ctx: Ctx::nuevo(Some(clave), stage, 10, 4) }
    }

    fn clave(&self) -> &str {
        self.ctx.clave.as_deref().unwrap_or_default()
    }

    /// GRATUITO. Nunca se apunta en el libro de gasto.
    async fn metadatos(&self, p: Punto) -> Option<Meta> {
        let url = format!("{METADATOS}?location={},{}&key={}", p.lat, p.lng, self.clave());
        let _g = self.ctx.limitador.permiso().await;
        let r = self.ctx.cliente.get(&url).send().await.ok()?;
        let m: Meta = r.json().await.ok()?;
        (m.status == "OK").then_some(m)
    }
}

#[async_trait]
impl OrigenDeRed for Google {
    fn id(&self) -> &'static str {
        "google"
    }
    fn tipo(&self) -> Tipo {
        Tipo::Calle
    }
    fn tarifa(&self) -> Tarifa {
        Tarifa::PorUnidad { usd_por_mil: 7.00 }
    }
    fn redistribucion(&self) -> Redistribucion {
        // Las condiciones de uso no permiten redistribuir estas imágenes. Ni
        // ellas ni sus vectores salen en un paquete publicado.
        Redistribucion::SoloLocal
    }

    async fn sondear(&self, tesela: &str) -> Result<Disponibilidad> {
        let puntos = puntos_de_tesela(&self.ctx, tesela).await?;
        if puntos.is_empty() {
            return Ok(Disponibilidad::Muestreo { nivel: Nivel::Nada, estimadas: 0 });
        }
        let muestra = muestra_para_sondeo(&puntos);
        let mut con_pano = 0u32;
        for p in &muestra {
            if self.metadatos(*p).await.is_some() {
                con_pano += 1;
            }
        }
        // Cada punto con panorámica costará cuatro imágenes al descargar, y es
        // ese número —no el de puntos— el que va a la estimación en euros.
        let cubiertos = extrapolar(con_pano, muestra.len(), puntos.len());
        let estimadas = cubiertos * RUMBOS.len() as u32;
        Ok(Disponibilidad::Muestreo { nivel: Nivel::de(estimadas), estimadas })
    }

    async fn descargar(&self, tesela: &str, tope: &Presupuesto) -> Result<Vec<Captura>> {
        let mut fuera = Vec::new();
        let mut panos = std::collections::HashSet::new();
        for p in puntos_de_tesela(&self.ctx, tesela).await? {
            let Some(meta) = self.metadatos(p).await else { continue };
            let pano = meta.pano_id.clone().unwrap_or_else(|| format!("{},{}", p.lat, p.lng));
            // Dos puntos a 20 m suelen caer en la MISMA panorámica. Sin esto se
            // pagarían cuatro imágenes por punto en vez de por panorámica: es
            // dinero tirado y material duplicado en el índice.
            if !panos.insert(pano.clone()) {
                continue;
            }
            for rumbo in RUMBOS {
                if tope.gastar(&self.tarifa(), 1).is_err() {
                    return Ok(fuera);
                }
                let url = format!(
                    "{ESTATICO}?size={TAMANO}&location={},{}&heading={rumbo}&key={}",
                    p.lat,
                    p.lng,
                    self.clave()
                );
                let nombre = format!("goo-{pano}-{rumbo}.jpg");
                let ruta = match self.ctx.bajar_imagen(&url, &nombre).await {
                    Ok(r) => r,
                    Err(e) => {
                        log::warn!("google {pano}/{rumbo}: {e}");
                        continue;
                    }
                };
                fuera.push(Captura {
                    fuente: "google",
                    id_origen: format!("{pano}:{rumbo}"),
                    ruta,
                    lat: p.lat,
                    lng: p.lng,
                    rumbo: Some(rumbo as f32),
                    capturada_en: meta.date.clone().map(|d| format!("{d}-01T00:00:00Z")),
                    atribucion: Atribucion {
                        autor: "Google".into(),
                        url: format!(
                            "https://www.google.com/maps/@?api=1&map_action=pano&pano={pano}"
                        ),
                        licencia: "Google Maps Platform ToS — no redistribuible".into(),
                    },
                    unidades: 1,
                });
            }
        }
        Ok(fuera)
    }
}
```

- [ ] **Step 8: Añadirlos al registro**

En `origins/mod.rs`, dentro de `registro` y tras el bloque de Mapillary:

```rust
    // KartaView no necesita clave: entra siempre.
    v.push(Box::new(kartaview::KartaView::nuevo(stage.clone())));
    if let Ok(Some(k)) = claves.leer("google") {
        v.push(Box::new(google::Google::nuevo(k, stage.clone())));
    }
```

- [ ] **Step 9: Comprobar**

Run: `cargo test -p lumi-index && cargo test -p indexer-app && cargo clippy -p indexer-app -- -D warnings`
Expected: PASS y clippy limpio.

- [ ] **Step 10: Commit**

```bash
git add crates/lumi-index/src/streets.rs crates/lumi-index/src/lib.rs indexer/src-tauri/src/origins
git commit -m "Los tres que hay que preguntar calle a calle: muestreo, KartaView y Google"
```

---

## Task 9: Mapbox cenital, Commons y Flickr

**Files:**
- Modify: `indexer/src-tauri/src/origins/mapbox.rs`
- Modify: `indexer/src-tauri/src/origins/commons.rs`
- Modify: `indexer/src-tauri/src/origins/flickr.rs`
- Modify: `indexer/src-tauri/src/origins/mod.rs`

**Interfaces:**
- Produces: `mapbox::MapboxSatelite::nuevo(clave, stage)`, `mapbox::subteselas(qk)`,
  `mapbox::{Z_RASTER, POR_TESELA}`; `commons::Commons::nuevo(stage)`;
  `flickr::Flickr::nuevo(clave, stage)`.

Van juntos porque comparten mecanismo: **el bbox de la tesela les basta**, no muestrean nada.

- [ ] **Step 1: Escribir el test del subdivisor (falla)**

Al final de `indexer/src-tauri/src/origins/mapbox.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn una_tesela_z14_se_parte_en_sesenta_y_cuatro_de_z17() {
        let qk = lumi_index::tiles::quadkey(43.3623, -8.4115);
        let hijas = subteselas(&qk);
        // 4^(17-14) = 64. Es el número que sale en la estimación: 98 teselas
        // z14 dan 6272 peticiones raster.
        assert_eq!(hijas.len(), POR_TESELA as usize);
        assert_eq!(hijas.len(), 64);
        assert!(hijas.iter().all(|(z, _, _)| *z == Z_RASTER));
        let unicas: std::collections::HashSet<_> = hijas.iter().collect();
        assert_eq!(unicas.len(), 64, "ninguna se repite");
    }

    #[test]
    fn el_centro_de_una_subtesela_cae_dentro_de_la_tesela_madre() {
        let qk = lumi_index::tiles::quadkey(43.3623, -8.4115);
        for (z, x, y) in subteselas(&qk) {
            let (lat, lng) = centro(z, x, y);
            assert_eq!(lumi_index::tiles::quadkey(lat, lng), qk, "{z}/{x}/{y} se salió");
        }
    }

    #[test]
    fn la_clave_va_en_la_consulta_pero_no_llega_al_log() {
        let m = MapboxSatelite::nuevo("pk.SECRETO".into(), std::path::PathBuf::from("/tmp"));
        let u = m.url_raster(17, 1000, 2000);
        assert!(u.contains("pk.SECRETO"), "Mapbox solo acepta la clave por consulta");
        assert!(!crate::keys::redactar(&u).contains("pk.SECRETO"), "pero al log no llega");
    }
}
```

- [ ] **Step 2: Comprobar que falla**

Run: `cargo test -p indexer-app mapbox`
Expected: FAIL de compilación.

- [ ] **Step 3: Implementar `mapbox.rs`**

```rust
//! El cenital: teselas raster de Mapbox Satellite.
//!
//! No tiene sonda porque no la necesita: la cobertura es global, y decir «hay
//! satélite en todas partes» no informa de nada. Por eso tampoco se pinta en el
//! mapa de disponibilidad.
//!
//! Se baja a z17 con `@2x`, que da ~0,6 m/px: suficiente para emparejar una
//! azotea o el trazado de una calle, y 64 peticiones por tesela z14 en vez de
//! las 256 que costaría z18.
//!
//! La clave es la MISMA que la del mapa: es la misma cuenta y la misma cuota.

use std::path::PathBuf;

use anyhow::Result;
use async_trait::async_trait;
use lumi_index::budget::Presupuesto;
use lumi_index::coverage::Atribucion;
use lumi_index::manifest::Tipo;
use lumi_index::network::{Captura, Disponibilidad, Redistribucion, Tarifa};
use lumi_index::tiles::{bbox_de_tesela, Z};

use super::{Ctx, OrigenDeRed};

/// El único sitio de todo el 7b donde aparece otro zoom, y no sale de aquí.
pub const Z_RASTER: u8 = 17;
/// 4^(Z_RASTER - Z).
pub const POR_TESELA: u32 = 64;

/// Las teselas z17 contenidas en una z14, como `(z, x, y)`.
pub fn subteselas(qk: &str) -> Vec<(u8, u32, u32)> {
    let (mut x, mut y) = (0u32, 0u32);
    for c in qk.chars() {
        let d = c as u32 - '0' as u32;
        x = (x << 1) | (d & 1);
        y = (y << 1) | ((d >> 1) & 1);
    }
    let salto = Z_RASTER - Z;
    let lado = 1u32 << salto;
    let (bx, by) = (x << salto, y << salto);
    let mut fuera = Vec::with_capacity((lado * lado) as usize);
    for dy in 0..lado {
        for dx in 0..lado {
            fuera.push((Z_RASTER, bx + dx, by + dy));
        }
    }
    fuera
}

/// El centro geográfico de una tesela `(z, x, y)`.
pub fn centro(z: u8, x: u32, y: u32) -> (f64, f64) {
    let escala = (1u32 << z) as f64;
    let lng = (x as f64 + 0.5) / escala * 360.0 - 180.0;
    let n = std::f64::consts::PI * (1.0 - 2.0 * (y as f64 + 0.5) / escala);
    (n.sinh().atan().to_degrees(), lng)
}

pub struct MapboxSatelite {
    ctx: Ctx,
}

impl MapboxSatelite {
    pub fn nuevo(clave: String, stage: PathBuf) -> Self {
        Self { ctx: Ctx::nuevo(Some(clave), stage, 16, 8) }
    }

    /// Mapbox solo acepta la clave por parámetro de consulta. Por eso todo lo
    /// que se registre pasa antes por `keys::redactar`.
    pub fn url_raster(&self, z: u8, x: u32, y: u32) -> String {
        format!(
            "https://api.mapbox.com/v4/mapbox.satellite/{z}/{x}/{y}@2x.jpg90?access_token={}",
            self.ctx.clave.as_deref().unwrap_or_default()
        )
    }
}

#[async_trait]
impl OrigenDeRed for MapboxSatelite {
    fn id(&self) -> &'static str {
        "mapbox-satelite"
    }
    fn tipo(&self) -> Tipo {
        Tipo::Cenital
    }
    fn tarifa(&self) -> Tarifa {
        Tarifa::PorUnidad { usd_por_mil: 0.75 }
    }
    fn redistribucion(&self) -> Redistribucion {
        Redistribucion::SoloLocal
    }

    /// Sin sonda y sin red: la cobertura es global. Devolver `Siempre` es lo
    /// que permite estimar sus unidades sin pedir nada a nadie.
    async fn sondear(&self, _tesela: &str) -> Result<Disponibilidad> {
        Ok(Disponibilidad::Siempre { unidades: POR_TESELA })
    }

    async fn descargar(&self, tesela: &str, tope: &Presupuesto) -> Result<Vec<Captura>> {
        let _ = bbox_de_tesela(tesela); // valida que el quadkey es legible
        let mut fuera = Vec::new();
        for (z, x, y) in subteselas(tesela) {
            if tope.gastar(&self.tarifa(), 1).is_err() {
                return Ok(fuera);
            }
            let url = self.url_raster(z, x, y);
            let ruta = match self.ctx.bajar_imagen(&url, &format!("mbx-{z}-{x}-{y}.jpg")).await {
                Ok(r) => r,
                Err(e) => {
                    log::warn!("mapbox {z}/{x}/{y}: {e}");
                    continue;
                }
            };
            let (lat, lng) = centro(z, x, y);
            fuera.push(Captura {
                fuente: "mapbox-satelite",
                id_origen: format!("{z}/{x}/{y}"),
                ruta,
                lat,
                lng,
                // Una cenital no mira a ningún sitio: mira hacia abajo.
                rumbo: None,
                capturada_en: None,
                atribucion: Atribucion {
                    autor: "Mapbox / Maxar".into(),
                    url: "https://www.mapbox.com/about/maps/".into(),
                    licencia: "Mapbox ToS — no redistribuible".into(),
                },
                unidades: 1,
            });
        }
        Ok(fuera)
    }
}
```

- [ ] **Step 4: Implementar `commons.rs`**

```rust
//! Wikimedia Commons. Todo lo de aquí es de licencia libre por definición, así
//! que sus imágenes viajan dentro del paquete con su autor y su licencia.
//!
//! Es infraestructura donada: 2 peticiones por segundo y una a la vez, con el
//! `User-Agent` identificable que `Ctx` ya pone, que es lo que su política pide.

use std::path::PathBuf;

use anyhow::Result;
use async_trait::async_trait;
use lumi_index::budget::Presupuesto;
use lumi_index::coverage::Atribucion;
use lumi_index::manifest::Tipo;
use lumi_index::network::{Captura, Disponibilidad, Nivel, Redistribucion, Tarifa};
use lumi_index::tiles::bbox_de_tesela;
use serde::Deserialize;

use super::{Ctx, OrigenDeRed};

const API: &str = "https://commons.wikimedia.org/w/api.php";
const LIMITE: u32 = 500;

#[derive(Debug, Deserialize)]
struct Coordenada {
    lat: f64,
    lon: f64,
}

#[derive(Debug, Deserialize)]
struct Campo {
    value: Option<String>,
}

#[derive(Debug, Deserialize)]
struct InfoImagen {
    #[serde(rename = "thumburl")]
    thumb: Option<String>,
    url: Option<String>,
    #[serde(rename = "extmetadata", default)]
    meta: std::collections::HashMap<String, Campo>,
}

#[derive(Debug, Deserialize)]
struct Categoria {
    title: String,
}

#[derive(Debug, Deserialize)]
struct Pagina {
    pageid: i64,
    title: String,
    #[serde(default)]
    coordinates: Vec<Coordenada>,
    #[serde(default)]
    imageinfo: Vec<InfoImagen>,
    #[serde(default)]
    categories: Vec<Categoria>,
}

#[derive(Debug, Deserialize)]
struct Consulta {
    #[serde(default)]
    pages: std::collections::HashMap<String, Pagina>,
}

#[derive(Debug, Deserialize)]
struct RespuestaCommons {
    query: Option<Consulta>,
}

pub struct Commons {
    ctx: Ctx,
}

impl Commons {
    pub fn nuevo(stage: PathBuf) -> Self {
        Self { ctx: Ctx::nuevo(None, stage, 2, 1) }
    }

    fn url(&self, tesela: &str) -> String {
        let b = bbox_de_tesela(tesela);
        // El bbox de GeoData va `norte|oeste|sur|este`, que NO es el orden de
        // ninguna otra API de este módulo. Escrito para que nadie lo "corrija".
        format!(
            "{API}?action=query&format=json&formatversion=1\
             &generator=geosearch&ggsbbox={}%7C{}%7C{}%7C{}&ggslimit={LIMITE}&ggsnamespace=6\
             &prop=imageinfo%7Ccoordinates%7Ccategories&iiprop=url%7Cextmetadata&iiurlwidth=2048\
             &cllimit=20",
            b.norte, b.oeste, b.sur, b.este
        )
    }

    async fn paginas(&self, tesela: &str) -> Result<Vec<Pagina>> {
        let url = self.url(tesela);
        let _g = self.ctx.limitador.permiso().await;
        let r = self.ctx.cliente.get(&url).send().await?;
        if !r.status().is_success() {
            anyhow::bail!("Commons respondió {}", r.status());
        }
        Ok(r.json::<RespuestaCommons>()
            .await?
            .query
            .map(|q| q.pages.into_values().collect())
            .unwrap_or_default())
    }
}

#[async_trait]
impl OrigenDeRed for Commons {
    fn id(&self) -> &'static str {
        "commons"
    }
    fn tipo(&self) -> Tipo {
        Tipo::Suelta
    }
    fn tarifa(&self) -> Tarifa {
        Tarifa::Gratis
    }
    fn redistribucion(&self) -> Redistribucion {
        Redistribucion::Libre { licencia: "libre (Commons)".into() }
    }

    async fn sondear(&self, tesela: &str) -> Result<Disponibilidad> {
        let n = self.paginas(tesela).await?.len() as u32;
        // Aunque la cuenta parezca exacta se declara como muestreo: la consulta
        // está topada a 500 y la respuesta no dice si había más.
        Ok(Disponibilidad::Muestreo { nivel: Nivel::de(n), estimadas: n })
    }

    async fn descargar(&self, tesela: &str, tope: &Presupuesto) -> Result<Vec<Captura>> {
        let mut fuera = Vec::new();
        for p in self.paginas(tesela).await? {
            let (Some(c), Some(i)) = (p.coordinates.first(), p.imageinfo.first()) else { continue };
            // Se prefiere la miniatura de 2048: el original de Commons llega a
            // decenas de megapíxeles y el verificador no los usa.
            let Some(url) = i.thumb.clone().or_else(|| i.url.clone()) else { continue };
            if tope.gastar(&self.tarifa(), 1).is_err() {
                break;
            }
            let ruta = match self.ctx.bajar_imagen(&url, &format!("cmn-{}.jpg", p.pageid)).await {
                Ok(r) => r,
                Err(e) => {
                    log::warn!("commons {}: {e}", p.title);
                    continue;
                }
            };
            let campo = |k: &str| i.meta.get(k).and_then(|c| c.value.clone());
            // Las categorías viajan en el `id_origen` no: se guardan para que
            // la Task 12 pueda pasarles las reglas. Aquí se dejan en la URL de
            // atribución, que es donde el operador las puede ir a ver.
            let _ = &p.categories;
            fuera.push(Captura {
                fuente: "commons",
                id_origen: p.pageid.to_string(),
                ruta,
                lat: c.lat,
                lng: c.lon,
                rumbo: None,
                capturada_en: campo("DateTimeOriginal"),
                atribucion: Atribucion {
                    autor: campo("Artist").unwrap_or_else(|| "Wikimedia Commons".into()),
                    url: format!("https://commons.wikimedia.org/?curid={}", p.pageid),
                    licencia: campo("LicenseShortName").unwrap_or_else(|| "libre (Commons)".into()),
                },
                unidades: 1,
            });
        }
        Ok(fuera)
    }
}
```

- [ ] **Step 5: Implementar `flickr.rs`**

```rust
//! Flickr, filtrado a Creative Commons.
//!
//! Es el único origen cuya redistribución va POR IMAGEN: cada foto trae su
//! licencia y hay que arrastrarla y respetarla una a una. Se piden solo los
//! códigos CC que permiten derivados y uso comercial; ND y NC ni se solicitan,
//! y aun así se vuelven a comprobar al sellar — la respuesta de un proveedor no
//! es una garantía.
//!
//! Flickr solo acepta la clave por parámetro de consulta: no ofrece cabecera.
//! Por eso toda URL pasa por `keys::redactar` antes de tocar un log.

use std::path::PathBuf;

use anyhow::Result;
use async_trait::async_trait;
use lumi_index::budget::Presupuesto;
use lumi_index::coverage::Atribucion;
use lumi_index::manifest::Tipo;
use lumi_index::network::{Captura, Disponibilidad, Nivel, Redistribucion, Tarifa};
use lumi_index::tiles::bbox_de_tesela;
use serde::Deserialize;

use super::{Ctx, OrigenDeRed};

const API: &str = "https://api.flickr.com/services/rest/";
/// 4 = CC BY, 5 = CC BY-SA, 7 = dominio público, 9 = CC0, 10 = dominio público
/// de EEUU. Se dejan fuera 1, 2, 3 y 6 a propósito: son las NC y las ND.
const LICENCIAS: &str = "4,5,7,9,10";
const POR_PAGINA: u32 = 250;

pub fn nombre_licencia(id: &str) -> &'static str {
    match id {
        "4" => "CC BY 2.0",
        "5" => "CC BY-SA 2.0",
        "7" => "Dominio público",
        "9" => "CC0 1.0",
        "10" => "Dominio público (EEUU)",
        _ => "desconocida",
    }
}

#[derive(Debug, Deserialize)]
struct FotoFlickr {
    id: String,
    ownername: Option<String>,
    license: Option<String>,
    latitude: Option<String>,
    longitude: Option<String>,
    datetaken: Option<String>,
    url_l: Option<String>,
}

#[derive(Debug, Deserialize)]
struct PaginaFlickr {
    #[serde(default)]
    photo: Vec<FotoFlickr>,
}

#[derive(Debug, Deserialize)]
struct RespuestaFlickr {
    photos: Option<PaginaFlickr>,
}

pub struct Flickr {
    ctx: Ctx,
}

impl Flickr {
    pub fn nuevo(clave: String, stage: PathBuf) -> Self {
        Self { ctx: Ctx::nuevo(Some(clave), stage, 4, 2) }
    }

    fn url(&self, tesela: &str) -> String {
        let b = bbox_de_tesela(tesela);
        format!(
            "{API}?method=flickr.photos.search&format=json&nojsoncallback=1\
             &bbox={},{},{},{}&license={LICENCIAS}&per_page={POR_PAGINA}\
             &extras=geo,license,owner_name,date_taken,url_l&api_key={}",
            b.oeste,
            b.sur,
            b.este,
            b.norte,
            self.ctx.clave.as_deref().unwrap_or_default()
        )
    }

    async fn fotos(&self, tesela: &str) -> Result<Vec<FotoFlickr>> {
        let url = self.url(tesela);
        let _g = self.ctx.limitador.permiso().await;
        let r = self.ctx.cliente.get(&url).send().await?;
        if !r.status().is_success() {
            anyhow::bail!("Flickr respondió {} a {}", r.status(), crate::keys::redactar(&url));
        }
        Ok(r.json::<RespuestaFlickr>().await?.photos.map(|p| p.photo).unwrap_or_default())
    }
}

#[async_trait]
impl OrigenDeRed for Flickr {
    fn id(&self) -> &'static str {
        "flickr"
    }
    fn tipo(&self) -> Tipo {
        Tipo::Suelta
    }
    fn tarifa(&self) -> Tarifa {
        Tarifa::Gratis
    }
    fn redistribucion(&self) -> Redistribucion {
        Redistribucion::PorImagen
    }

    async fn sondear(&self, tesela: &str) -> Result<Disponibilidad> {
        let n = self.fotos(tesela).await?.len() as u32;
        Ok(Disponibilidad::Muestreo { nivel: Nivel::de(n), estimadas: n })
    }

    async fn descargar(&self, tesela: &str, tope: &Presupuesto) -> Result<Vec<Captura>> {
        let mut fuera = Vec::new();
        for f in self.fotos(tesela).await? {
            // Sin URL grande o sin coordenadas no hay nada que indexar: es un
            // resultado, se salta y no se reintenta.
            let Some(url) = f.url_l.clone() else { continue };
            let (Some(lat), Some(lng)) = (
                f.latitude.as_deref().and_then(|s| s.parse::<f64>().ok()),
                f.longitude.as_deref().and_then(|s| s.parse::<f64>().ok()),
            ) else {
                continue;
            };
            // Flickr devuelve 0,0 cuando la foto no está geoetiquetada de
            // verdad. Sin esto, media isla del Golfo de Guinea sería Lugo.
            if lat == 0.0 && lng == 0.0 {
                continue;
            }
            if tope.gastar(&self.tarifa(), 1).is_err() {
                break;
            }
            let ruta = match self.ctx.bajar_imagen(&url, &format!("flk-{}.jpg", f.id)).await {
                Ok(r) => r,
                Err(e) => {
                    log::warn!("flickr {}: {e}", f.id);
                    continue;
                }
            };
            fuera.push(Captura {
                fuente: "flickr",
                id_origen: f.id.clone(),
                ruta,
                lat,
                lng,
                rumbo: None,
                capturada_en: f.datetaken.clone().map(|d| d.replace(' ', "T") + "Z"),
                atribucion: Atribucion {
                    autor: f.ownername.clone().unwrap_or_else(|| "Flickr".into()),
                    url: format!("https://www.flickr.com/photo.gne?id={}", f.id),
                    licencia: nombre_licencia(f.license.as_deref().unwrap_or("")).to_string(),
                },
                unidades: 1,
            });
        }
        Ok(fuera)
    }
}
```

- [ ] **Step 6: Completar el registro**

En `origins/mod.rs`, `registro` queda con los seis bloques tal como se escribió en la Task 6,
y se quita el `let _ = stage;` provisional:

```rust
pub fn registro(claves: &Claves, stage: PathBuf) -> Vec<Box<dyn OrigenDeRed>> {
    let mut v: Vec<Box<dyn OrigenDeRed>> = Vec::new();
    if let Ok(Some(k)) = claves.leer("mapillary") {
        v.push(Box::new(mapillary::Mapillary::nuevo(k, stage.clone())));
    }
    v.push(Box::new(kartaview::KartaView::nuevo(stage.clone())));
    if let Ok(Some(k)) = claves.leer("google") {
        v.push(Box::new(google::Google::nuevo(k, stage.clone())));
    }
    if let Ok(Some(k)) = claves.leer("mapbox-satelite") {
        v.push(Box::new(mapbox::MapboxSatelite::nuevo(k, stage.clone())));
    }
    v.push(Box::new(commons::Commons::nuevo(stage.clone())));
    if let Ok(Some(k)) = claves.leer("flickr") {
        v.push(Box::new(flickr::Flickr::nuevo(k, stage)));
    }
    v
}
```

- [ ] **Step 7: Comprobar**

Run: `cargo test -p indexer-app && cargo clippy -p indexer-app -- -D warnings`
Expected: PASS, clippy limpio.

- [ ] **Step 8: Commit**

```bash
git add indexer/src-tauri/src/origins
git commit -m "Los tres a los que les basta el bbox: cenital, Commons y Flickr"
```

---

## Task 10: Sondear un área y estimar lo que cuesta

**Files:**
- Create: `indexer/src-tauri/src/probe.rs`
- Create: `indexer/src-tauri/src/spend.rs`
- Modify: `indexer/src-tauri/src/lib.rs`

**Interfaces:**
- Consumes: `origins::{registro, Origen}`, `Almacen::{sondeo_leer, sondeo_guardar,
  gasto_del_mes, gasto_apuntar}`, `budget::{LineaPrevista, previsto, cabe}`, `keys::Claves`.
- Produces: `probe::CADUCIDAD_DIAS`; `probe::sondear_area(...) -> Vec<SondeoTesela>`;
  `probe::SondeoTesela { quadkey, fuente, nivel, estimadas, del_cache }`;
  `probe::Estimacion { lineas, total_eur, gastado_eur, tope_eur, cabe, exceso_eur }`;
  `spend::hoy_iso()`, `spend::mes_iso()`, `spend::apuntar(...)`.
  Comandos: `origenes_lista`, `sondear_area`, `estimar_area`.

- [ ] **Step 1: Escribir el test (falla)**

Al final de `indexer/src-tauri/src/probe.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use lumi_index::manifest::Tipo;
    use lumi_index::network::Tarifa;
    use origins::Falso;

    fn temporal() -> (tempfile::TempDir, Almacen) {
        let d = tempfile::tempdir().unwrap();
        let a = Almacen::abrir(d.path()).unwrap();
        (d, a)
    }

    #[tokio::test]
    async fn el_segundo_sondeo_sale_del_cache_y_no_toca_el_origen() {
        let (_d, a) = temporal();
        let o: Vec<Origen> = vec![std::sync::Arc::new(
            Falso::nuevo("falso", Tipo::Suelta, Tarifa::Gratis).con("AAA", 80).con("BBB", 0),
        )];
        let teselas = vec!["AAA".to_string(), "BBB".to_string()];

        let uno = sondear_area(&a, &o, &teselas).await;
        assert_eq!(uno.len(), 2);
        assert!(uno.iter().all(|s| !s.del_cache), "la primera vez se pregunta");
        assert_eq!(uno.iter().find(|s| s.quadkey == "AAA").unwrap().estimadas, 80);

        let dos = sondear_area(&a, &o, &teselas).await;
        assert!(dos.iter().all(|s| s.del_cache), "la segunda sale de la caché");
        assert_eq!(dos.iter().find(|s| s.quadkey == "AAA").unwrap().estimadas, 80);
    }

    #[tokio::test]
    async fn la_estimacion_cuenta_solo_lo_nuevo_y_aplica_el_tope() {
        let (_d, a) = temporal();
        let o: Vec<Origen> = vec![std::sync::Arc::new(
            Falso::nuevo("caro", Tipo::Calle, Tarifa::PorUnidad { usd_por_mil: 7.00 })
                .con("AAA", 1_000)
                .con("BBB", 1_000),
        )];
        // Solo AAA es nueva: BBB ya está cubierta y no debe contar.
        let nuevas = std::collections::BTreeMap::from([(
            "caro".to_string(),
            vec!["AAA".to_string()],
        )]);

        let e = estimar(&a, &o, &nuevas, 400.0).await;
        // 1000 · 7 $/1000 · 0,93 = 6,51 €
        assert!((e.total_eur - 6.51).abs() < 1e-6, "{}", e.total_eur);
        assert_eq!(e.lineas.len(), 1);
        assert_eq!(e.lineas[0].teselas, 1, "BBB no cuenta: ya estaba cubierta");
        assert!(e.cabe);

        // Con un tope ridículo, no cabe y se dice cuánto sobra.
        let e = estimar(&a, &o, &nuevas, 1.0).await;
        assert!(!e.cabe);
        assert!((e.exceso_eur - 5.51).abs() < 1e-6, "{}", e.exceso_eur);
    }

    #[tokio::test]
    async fn el_gasto_ya_hecho_cuenta_contra_el_tope() {
        let (_d, a) = temporal();
        a.gasto_apuntar(&spend::hoy_iso(), "caro", 60_000, 396.0).unwrap();
        let o: Vec<Origen> = vec![std::sync::Arc::new(
            Falso::nuevo("caro", Tipo::Calle, Tarifa::PorUnidad { usd_por_mil: 7.00 })
                .con("AAA", 1_000),
        )];
        let nuevas =
            std::collections::BTreeMap::from([("caro".to_string(), vec!["AAA".to_string()])]);
        let e = estimar(&a, &o, &nuevas, 400.0).await;
        assert!((e.gastado_eur - 396.0).abs() < 1e-9);
        assert!(!e.cabe, "396 + 6,51 pasa de 400");
    }
}
```

- [ ] **Step 2: Comprobar que falla**

Run: `cargo test -p indexer-app probe`
Expected: FAIL de compilación.

- [ ] **Step 3: Implementar `spend.rs`**

```rust
//! El libro de gasto y las dos fechas que lo indexan.
//!
//! Aquí solo entra lo que el proveedor SIRVIÓ. Una petición que falla y no
//! devuelve imagen no se cobra ni se apunta, y los sondeos de metadatos de
//! Google son gratuitos y no pasan nunca por esta función.

use anyhow::Result;

use crate::store::Almacen;

/// `YYYY-MM-DD` en UTC, sin arrastrar `chrono`. Reutiliza el mismo calendario
/// que la marca de tiempo de Mapillary, que ya está escrito y probado.
pub fn hoy_iso() -> String {
    let s = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    crate::origins::mapillary::marca_iso(s * 1000)[..10].to_string()
}

/// `YYYY-MM`.
pub fn mes_iso() -> String {
    hoy_iso()[..7].to_string()
}

pub fn apuntar(almacen: &Almacen, fuente: &str, unidades: u32, coste_eur: f64) -> Result<()> {
    if unidades == 0 && coste_eur == 0.0 {
        return Ok(());
    }
    almacen.gasto_apuntar(&hoy_iso(), fuente, unidades, coste_eur)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn las_dos_fechas_tienen_la_forma_que_la_consulta_espera() {
        let d = hoy_iso();
        assert_eq!(d.len(), 10, "{d}");
        assert_eq!(&d[4..5], "-");
        assert_eq!(mes_iso(), d[..7]);
        // `gasto_del_mes` filtra con `dia LIKE mes || '-%'`, así que el mes
        // tiene que ser prefijo exacto del día o no encontraría nada.
        assert!(d.starts_with(&mes_iso()));
    }
}
```

- [ ] **Step 4: Implementar `probe.rs`**

```rust
//! Sondear un área y decir lo que costaría bajarla.
//!
//! El sondeo alimenta DOS cosas con la misma llamada: los puntitos del mapa y
//! la estimación en euros. Por eso confirmar el gasto antes de bajar sale casi
//! gratis: el trabajo ya estaba hecho.
//!
//! Y solo se sondea lo que se pide, cuando se pide. Nunca al mover el mapa.

use std::collections::BTreeMap;

use lumi_index::budget::{cabe, previsto, LineaPrevista};
use lumi_index::network::Tarifa;
use serde::Serialize;

use crate::origins::{self, Origen};
use crate::spend;
use crate::store::Almacen;

/// La cobertura cambia despacio y volver a sondear cada vez es tirar cuota.
pub const CADUCIDAD_DIAS: i64 = 30;

#[derive(Debug, Clone, Serialize)]
pub struct SondeoTesela {
    pub quadkey: String,
    pub fuente: String,
    pub nivel: String,
    pub estimadas: u32,
    /// Para que la interfaz pueda decir «sondeado hace 2 d» en vez de fingir
    /// que acaba de preguntar.
    pub del_cache: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct Estimacion {
    pub lineas: Vec<LineaPrevista>,
    pub total_eur: f64,
    pub gastado_eur: f64,
    pub tope_eur: f64,
    pub cabe: bool,
    pub exceso_eur: f64,
}

/// Sondea cada tesela contra cada origen, reutilizando lo que esté vigente en
/// la caché.
///
/// Mapillary también pasa por aquí aunque el mapa pinte sus puntos por su
/// cuenta: la estimación necesita su número igual que el de los demás.
pub async fn sondear_area(
    almacen: &Almacen,
    origenes: &[Origen],
    teselas: &[String],
) -> Vec<SondeoTesela> {
    let mut fuera = Vec::new();
    for o in origenes {
        for qk in teselas {
            if let Ok(Some((nivel, estimadas))) = almacen.sondeo_leer(o.id(), qk, CADUCIDAD_DIAS) {
                fuera.push(SondeoTesela {
                    quadkey: qk.clone(),
                    fuente: o.id().to_string(),
                    nivel,
                    estimadas,
                    del_cache: true,
                });
                continue;
            }
            // Un origen que falla al sondear no tumba el área: se anota como
            // «nada» sin guardarlo en caché, para que el siguiente intento
            // vuelva a preguntar en vez de heredar el fallo durante 30 días.
            let Ok(d) = o.sondear(qk).await else {
                log::warn!("{} no pudo sondear {qk}", o.id());
                fuera.push(SondeoTesela {
                    quadkey: qk.clone(),
                    fuente: o.id().to_string(),
                    nivel: "nada".into(),
                    estimadas: 0,
                    del_cache: false,
                });
                continue;
            };
            let nivel = format!("{:?}", d.nivel()).to_lowercase();
            let _ = almacen.sondeo_guardar(o.id(), qk, &nivel, d.unidades());
            fuera.push(SondeoTesela {
                quadkey: qk.clone(),
                fuente: o.id().to_string(),
                nivel,
                estimadas: d.unidades(),
                del_cache: false,
            });
        }
    }
    fuera
}

/// Lo que costaría bajar `nuevas`, que es un mapa `fuente → teselas que ESE
/// origen no tiene cubiertas`. Las cubiertas no entran: ya están pagadas.
pub async fn estimar(
    almacen: &Almacen,
    origenes: &[Origen],
    nuevas: &BTreeMap<String, Vec<String>>,
    tope_eur: f64,
) -> Estimacion {
    let mut lineas = Vec::new();
    for o in origenes {
        let Some(teselas) = nuevas.get(o.id()) else { continue };
        if teselas.is_empty() {
            continue;
        }
        let mut unidades = 0u32;
        for qk in teselas {
            // De la caché si está; si no, se pregunta y se guarda.
            unidades += match almacen.sondeo_leer(o.id(), qk, CADUCIDAD_DIAS) {
                Ok(Some((_, n))) => n,
                _ => match o.sondear(qk).await {
                    Ok(d) => {
                        let nivel = format!("{:?}", d.nivel()).to_lowercase();
                        let _ = almacen.sondeo_guardar(o.id(), qk, &nivel, d.unidades());
                        d.unidades()
                    }
                    Err(_) => 0,
                },
            };
        }
        // Lo gratuito TAMBIÉN se lista aunque sume cero: hace falta para
        // entender de dónde va a salir cada imagen.
        lineas.push(LineaPrevista::nueva(o.id(), teselas.len() as u32, unidades, o.tarifa()));
    }
    lineas.sort_by(|a, b| b.coste_eur.total_cmp(&a.coste_eur));

    let total_eur = previsto(&lineas);
    let gastado_eur = almacen.gasto_del_mes(&spend::mes_iso()).unwrap_or(0.0);
    match cabe(gastado_eur, total_eur, tope_eur) {
        Ok(()) => Estimacion { lineas, total_eur, gastado_eur, tope_eur, cabe: true, exceso_eur: 0.0 },
        Err(e) => Estimacion {
            lineas,
            total_eur,
            gastado_eur,
            tope_eur,
            cabe: false,
            exceso_eur: e.exceso_eur,
        },
    }
}

/// Lo que la interfaz necesita saber de cada origen para pintar los
/// interruptores y la leyenda sin conocer nada del backend.
#[derive(Debug, Clone, Serialize)]
pub struct FichaOrigen {
    pub id: String,
    pub tipo: String,
    pub puntos_exactos: bool,
    pub gratis: bool,
    pub usd_por_mil: f64,
    pub redistribuye: bool,
}

pub fn fichas(origenes: &[Origen]) -> Vec<FichaOrigen> {
    origenes
        .iter()
        .map(|o| FichaOrigen {
            id: o.id().to_string(),
            tipo: format!("{:?}", o.tipo()).to_lowercase(),
            puntos_exactos: o.puntos_exactos(),
            gratis: o.tarifa().es_gratis(),
            usd_por_mil: match o.tarifa() {
                Tarifa::Gratis => 0.0,
                Tarifa::PorUnidad { usd_por_mil } => usd_por_mil,
            },
            redistribuye: !matches!(
                o.redistribucion(),
                lumi_index::network::Redistribucion::SoloLocal
            ),
        })
        .collect()
}
```

- [ ] **Step 5: Los comandos**

En `indexer/src-tauri/src/lib.rs`, añadir `mod probe;` y `mod spend;`, y estos tres comandos.
El registro de orígenes se reconstruye en cada comando a propósito: así una clave recién
guardada surte efecto sin reiniciar.

```rust
fn origenes_de(estado: &Estado) -> Vec<origins::Origen> {
    let claves = keys::Claves { almacen: &estado.almacen, maestra: &estado.maestra };
    origins::registro(&claves, estado.dir.join("stage"))
        .into_iter()
        .map(std::sync::Arc::from)
        .collect()
}

#[tauri::command]
async fn origenes_lista(estado: tauri::State<'_, Estado>) -> Result<Vec<probe::FichaOrigen>, String> {
    Ok(probe::fichas(&origenes_de(&estado)))
}

#[tauri::command]
async fn sondear_area(
    estado: tauri::State<'_, Estado>,
    teselas: Vec<String>,
) -> Result<Vec<probe::SondeoTesela>, String> {
    let o = origenes_de(&estado);
    Ok(probe::sondear_area(&estado.almacen, &o, &teselas).await)
}

#[tauri::command]
async fn estimar_area(
    estado: tauri::State<'_, Estado>,
    nuevas: std::collections::BTreeMap<String, Vec<String>>,
) -> Result<probe::Estimacion, String> {
    let o = origenes_de(&estado);
    let claves = keys::Claves { almacen: &estado.almacen, maestra: &estado.maestra };
    Ok(probe::estimar(&estado.almacen, &o, &nuevas, claves.tope_eur()).await)
}
```

Y añadirlos a `generate_handler!`.

- [ ] **Step 6: Comprobar**

Run: `cargo test -p indexer-app && cargo clippy -p indexer-app -- -D warnings`
Expected: PASS, 4 tests nuevos (3 de probe, 1 de spend).

- [ ] **Step 7: Commit**

```bash
git add indexer/src-tauri/src/probe.rs indexer/src-tauri/src/spend.rs indexer/src-tauri/src/lib.rs
git commit -m "Sondear una vez y que valga para los puntitos y para el precio"
```

---

## Task 11: La descarga, reanudable y sin pagar dos veces

**Files:**
- Create: `indexer/src-tauri/src/download.rs`
- Modify: `indexer/src-tauri/src/lib.rs`

**Interfaces:**
- Consumes: `origins::Origen`, `Presupuesto`, `Almacen::{descargas_pendientes,
  descarga_marcar, descarga_sumar_reintento, crear_lote, insertar_imagen}`, `spend::apuntar`.
- Produces: `download::REINTENTOS_MAX`; `download::Progreso`;
  `download::Descarga::nueva(...)`, `.progreso()`, `.parar()`, `.correr(...)`.
  Comandos: `descarga_arrancar`, `descarga_progreso`, `descarga_parar`.

- [ ] **Step 1: Escribir el test (falla)**

Al final de `indexer/src-tauri/src/download.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use lumi_index::manifest::Tipo;
    use lumi_index::network::Tarifa;
    use origins::Falso;

    fn temporal() -> (tempfile::TempDir, std::sync::Arc<Almacen>) {
        let d = tempfile::tempdir().unwrap();
        let a = std::sync::Arc::new(Almacen::abrir(d.path()).unwrap());
        (d, a)
    }

    #[tokio::test]
    async fn una_tesela_ya_hecha_no_se_vuelve_a_bajar_ni_a_pagar() {
        let (_d, a) = temporal();
        let i = a.crear_indice("x", "x").unwrap();
        let o: Origen = std::sync::Arc::new(
            Falso::nuevo("caro", Tipo::Suelta, Tarifa::PorUnidad { usd_por_mil: 7.00 })
                .con("AAA", 10)
                .con("BBB", 10),
        );

        let d = Descarga::nueva(a.clone(), i, 100.0, &[]);
        d.un_origen(&o, &["AAA".into(), "BBB".into()]).await;
        let primera = d.progreso().gastado_eur;
        assert!(primera > 0.0);
        assert_eq!(d.progreso().teselas_hechas, 2);

        // Segunda pasada sobre las mismas: ni una petición ni un céntimo.
        let d2 = Descarga::nueva(a.clone(), i, 100.0, &[]);
        d2.un_origen(&o, &["AAA".into(), "BBB".into()]).await;
        assert_eq!(d2.progreso().gastado_eur, 0.0, "no se paga dos veces");
        assert_eq!(d2.progreso().teselas_hechas, 0, "no había nada que hacer");
    }

    #[tokio::test]
    async fn el_presupuesto_agotado_para_la_descarga_y_lo_bajado_se_conserva() {
        let (_d, a) = temporal();
        let i = a.crear_indice("x", "x").unwrap();
        let o: Origen = std::sync::Arc::new(
            Falso::nuevo("caro", Tipo::Suelta, Tarifa::PorUnidad { usd_por_mil: 7.00 })
                .con("AAA", 100)
                .con("BBB", 100),
        );
        // 0,10 € da para ~15 imágenes: no llega ni a terminar AAA.
        let d = Descarga::nueva(a.clone(), i, 0.10, &[]);
        d.un_origen(&o, &["AAA".into(), "BBB".into()]).await;

        let p = d.progreso();
        assert!(p.imagenes > 0 && p.imagenes < 200, "bajó {}", p.imagenes);
        assert!(p.sin_saldo, "tiene que quedar dicho que se quedó sin saldo");
        // Y una tesela que se quedó a medias NO queda como hecha: si no, al
        // retomar con más presupuesto se la saltaría para siempre.
        assert_ne!(a.descarga_estado(i, "caro", "AAA").unwrap().as_deref(), Some("hecho"));
    }

    #[tokio::test]
    async fn el_gasto_apuntado_es_el_servido_y_no_el_previsto() {
        let (_d, a) = temporal();
        let i = a.crear_indice("x", "x").unwrap();
        let o: Origen = std::sync::Arc::new(
            Falso::nuevo("caro", Tipo::Suelta, Tarifa::PorUnidad { usd_por_mil: 7.00 })
                .con("AAA", 10),
        );
        Descarga::nueva(a.clone(), i, 100.0, &[]).un_origen(&o, &["AAA".into()]).await;

        // 10 imágenes · 7 $/1000 · 0,93 = 0,0651 €
        let mes = crate::spend::mes_iso();
        let g = a.gasto_del_mes(&mes).unwrap();
        assert!((g - 0.0651).abs() < 1e-6, "{g}");
    }
}
```

- [ ] **Step 2: Comprobar que falla**

Run: `cargo test -p indexer-app download`
Expected: FAIL de compilación.

- [ ] **Step 3: Implementar `download.rs`**

```rust
//! El planificador de descarga.
//!
//! La unidad de trabajo es TESELA × ORIGEN, y se anota al completarse. Eso es
//! lo único que hace que cortar una descarga a la mitad no cueste dinero al
//! retomarla, y es la razón de que exista la tabla `descargas`.
//!
//! Las dos clases de fallo del 7a, tal cual: «esta imagen no se puede bajar» es
//! un RESULTADO que el adaptador ya se saltó; que se caiga la red es una AVERÍA
//! y la tesela vuelve una vez, con contador.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use lumi_index::budget::Presupuesto;
use lumi_index::tiles::quadkey;
use serde::Serialize;

use crate::origins::Origen;
use crate::spend;
use crate::store::Almacen;

/// Reintentos de una tesela cuya descarga se cayó. Uno: si falla dos veces, el
/// problema no es de suerte.
pub const REINTENTOS_MAX: u32 = 1;

#[derive(Debug, Clone, Default, Serialize)]
pub struct Progreso {
    pub trabajando: bool,
    pub teselas_hechas: u32,
    pub teselas_total: u32,
    pub imagenes: u32,
    pub gastado_eur: f64,
    pub sin_saldo: bool,
    /// `(fuente, hechas, total)`, para las barras por origen.
    pub por_origen: Vec<(String, u32, u32)>,
    pub ultimo: String,
}

pub struct Descarga {
    almacen: Arc<Almacen>,
    indice_id: i64,
    tope: Presupuesto,
    modelos: Vec<String>,
    progreso: Mutex<Progreso>,
    parar: AtomicBool,
}

impl Descarga {
    pub fn nueva(almacen: Arc<Almacen>, indice_id: i64, presupuesto_eur: f64, modelos: &[String]) -> Self {
        Self {
            almacen,
            indice_id,
            tope: Presupuesto::nuevo(presupuesto_eur),
            modelos: modelos.to_vec(),
            progreso: Mutex::new(Progreso::default()),
            parar: AtomicBool::new(false),
        }
    }

    pub fn progreso(&self) -> Progreso {
        self.progreso.lock().unwrap().clone()
    }

    /// Parar termina la tesela en curso y no coge la siguiente. Nunca mata
    /// trabajo que ya está pagado: misma regla que la pausa de la cola del 7a.
    pub fn parar(&self) {
        self.parar.store(true, Ordering::SeqCst);
    }

    /// Un origen contra su lista de teselas. Lo que ya está `hecho` ni se pide.
    pub async fn un_origen(&self, o: &Origen, teselas: &[String]) {
        let pendientes = self
            .almacen
            .descargas_pendientes(self.indice_id, o.id(), teselas)
            .unwrap_or_default();
        {
            let mut p = self.progreso.lock().unwrap();
            p.trabajando = true;
            p.teselas_total += pendientes.len() as u32;
            p.por_origen.push((o.id().to_string(), 0, pendientes.len() as u32));
        }

        // Un lote por origen: la fila padre ES la cadena de custodia, y la
        // procedencia del material es el propio origen, no algo que declare
        // nadie. Por eso `declarada_por_operador` va a false.
        let lote_id = match self.almacen.crear_lote(
            self.indice_id,
            "red",
            o.id(),
            Some(&format!("{:?}", o.tipo()).to_lowercase()),
            o.id(),
            None,
            None,
            false,
        ) {
            Ok(l) => l,
            Err(e) => {
                self.anotar(format!("no se pudo crear el lote de {}: {e}", o.id()));
                return;
            }
        };

        for qk in pendientes {
            if self.parar.load(Ordering::SeqCst) || self.progreso().sin_saldo {
                break;
            }
            let _ = self.almacen.descarga_marcar(self.indice_id, o.id(), &qk, "en_curso", 0, 0, None);
            let antes = self.tope.gastado_eur();

            match o.descargar(&qk, &self.tope).await {
                Ok(caps) => {
                    let gastado = self.tope.gastado_eur() - antes;
                    let unidades: u32 = caps.iter().map(|c| c.unidades).sum();
                    let n = caps.len() as u32;
                    for c in &caps {
                        // El quadkey se recalcula de las coordenadas REALES de
                        // la foto: Overpass devuelve vías enteras, así que una
                        // captura puede caer en la tesela de al lado y tiene
                        // que contarse allí.
                        let qk_real = quadkey(c.lat, c.lng);
                        let _ = self.almacen.insertar_imagen_de_red(
                            self.indice_id,
                            lote_id,
                            c,
                            &qk_real,
                            &self.modelos,
                        );
                    }
                    // SOLO SE APUNTA LO SERVIDO.
                    let _ = spend::apuntar(&self.almacen, o.id(), unidades, gastado);

                    // Una tesela que se quedó a medias por falta de saldo NO se
                    // marca como hecha: si no, al retomar con más presupuesto
                    // se la saltaría para siempre.
                    //
                    // El corte se mide contra el COSTE DE UNA UNIDAD y no
                    // contra cero: el adaptador para cuando la siguiente no
                    // cabe, así que casi nunca deja el saldo exactamente a
                    // cero — con `<= 0.0` esto no se detectaría nunca.
                    let unitario = o.tarifa().coste_eur(1);
                    let sin_saldo = unitario > 0.0 && self.tope.restante_eur() < unitario;
                    let estado = if sin_saldo { "error" } else { "hecho" };
                    let motivo = sin_saldo.then_some("se agotó el presupuesto a mitad");
                    let _ = self.almacen.descarga_marcar(
                        self.indice_id, o.id(), &qk, estado, n, unidades, motivo,
                    );

                    let mut p = self.progreso.lock().unwrap();
                    p.imagenes += n;
                    p.gastado_eur = self.tope.gastado_eur();
                    if sin_saldo {
                        p.sin_saldo = true;
                    } else {
                        p.teselas_hechas += 1;
                        if let Some(f) = p.por_origen.iter_mut().find(|(f, _, _)| f == o.id()) {
                            f.1 += 1;
                        }
                    }
                    p.ultimo = format!("{} {qk} · {n} imágenes", o.id());
                }
                Err(e) => {
                    // AVERÍA: vuelve una vez, y el contador impide el bucle.
                    let n = self
                        .almacen
                        .descarga_sumar_reintento(self.indice_id, o.id(), &qk)
                        .unwrap_or(u32::MAX);
                    let definitivo = n > REINTENTOS_MAX;
                    let motivo = if definitivo {
                        format!("falló más veces de las permitidas: {e}")
                    } else {
                        format!("avería, vuelve una vez: {e}")
                    };
                    let _ = self.almacen.descarga_marcar(
                        self.indice_id, o.id(), &qk, "error", 0, 0, Some(&motivo),
                    );
                    self.anotar(format!("{} {qk} · {motivo}", o.id()));
                }
            }
        }

        let _ = self.almacen.estado_lote(lote_id, "pendiente", None);
        self.progreso.lock().unwrap().trabajando = false;
    }

    fn anotar(&self, s: String) {
        log::warn!("{s}");
        self.progreso.lock().unwrap().ultimo = s;
    }
}
```

- [ ] **Step 4: Añadir `insertar_imagen_de_red` al almacén**

En `store.rs`, dentro de `impl Almacen`. Es la variante de `insertar_imagen` que guarda las
columnas nuevas — y la que garantiza que **nada de red entra sin atribución**:

```rust
    /// Inserta una captura de red. A diferencia de `insertar_imagen`, esta
    /// exige la atribución porque `Captura` la lleva dentro y no es opcional:
    /// no hay forma de llamar a esto y quedarse sin ella.
    ///
    /// Las sueltas entran como `revision = 'pendiente'`; las capturas
    /// sistemáticas no pasan por revisión y entran ya aceptadas.
    pub fn insertar_imagen_de_red(
        &self,
        indice_id: i64,
        lote_id: i64,
        c: &lumi_index::network::Captura,
        quadkey: &str,
        modelos: &[String],
    ) -> Result<i64> {
        use lumi_index::manifest::Tipo;
        let revision = if c.fuente == "commons" || c.fuente == "flickr" { "pendiente" } else { "aceptada" };
        let _ = Tipo::Suelta;
        let atrib = serde_json::to_string(&c.atribucion)?;
        let cn = self.0.lock().unwrap();
        cn.execute(
            "INSERT INTO imagenes
               (indice_id, lote_id, ruta, sha256, lat, lng, quadkey, capturada_en,
                revision, licencia, atribucion, id_origen, rumbo, creada_en)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
            params![
                indice_id,
                lote_id,
                c.ruta.display().to_string(),
                // El sha se calcula al sellar; aquí basta el identificador del
                // proveedor, que ya es único y no obliga a releer el fichero.
                format!("origen:{}:{}", c.fuente, c.id_origen),
                c.lat,
                c.lng,
                quadkey,
                c.capturada_en,
                revision,
                c.atribucion.licencia,
                atrib,
                c.id_origen,
                c.rumbo,
                Self::ahora()
            ],
        )?;
        let id = cn.last_insert_rowid();
        for m in modelos {
            cn.execute(
                "INSERT OR IGNORE INTO vectores (imagen_id, modelo, estado) VALUES (?1, ?2, 'pendiente')",
                params![id, m],
            )?;
        }
        Ok(id)
    }
```

`lotes.clase` tiene un `CHECK` que no incluye `'red'`. Como `CHECK` no se puede alterar en
SQLite sin recrear la tabla, se amplía en la constante `ESQUEMA` **y** se añade la migración
para bases ya existentes justo con los demás `ALTER`:

```rust
            // `clase` gana 'red'. En SQLite un CHECK no se altera, así que en
            // una base del 7a se recrea la tabla con el CHECK nuevo. Es barato:
            // `lotes` tiene una fila por tanda de material, no por imagen.
            "ALTER TABLE lotes RENAME TO lotes_viejos",
```

seguido, fuera del bucle de `ALTER`, de:

```rust
        // Solo si la migración de arriba llegó a renombrar algo.
        let hay_viejos: bool = c
            .query_row(
                "SELECT 1 FROM sqlite_master WHERE type='table' AND name='lotes_viejos'",
                [],
                |_| Ok(true),
            )
            .unwrap_or(false);
        if hay_viejos {
            c.execute_batch(ESQUEMA)?; // recrea `lotes` con el CHECK nuevo
            c.execute_batch(
                "INSERT INTO lotes SELECT * FROM lotes_viejos; DROP TABLE lotes_viejos;",
            )?;
        }
```

Y en `ESQUEMA`, la línea del CHECK pasa a:

```sql
    clase      TEXT NOT NULL CHECK (clase IN ('legacy','carpeta','herencia','red')),
```

- [ ] **Step 5: Los comandos**

En `lib.rs`, añadir `mod download;`, un `Mutex<Option<Arc<Descarga>>>` al `Estado`, y:

```rust
#[tauri::command]
async fn descarga_arrancar(
    estado: tauri::State<'_, Estado>,
    indice_id: i64,
    nuevas: std::collections::BTreeMap<String, Vec<String>>,
    presupuesto_eur: f64,
) -> Result<(), String> {
    let origenes = origenes_de(&estado);
    let modelos: Vec<String> = estado.modelos.iter().map(|m| m.id.clone()).collect();
    let d = std::sync::Arc::new(download::Descarga::nueva(
        estado.almacen.clone(),
        indice_id,
        presupuesto_eur,
        &modelos,
    ));
    *estado.descarga.lock().unwrap() = Some(d.clone());
    tauri::async_runtime::spawn(async move {
        for o in &origenes {
            let Some(teselas) = nuevas.get(o.id()) else { continue };
            d.un_origen(o, teselas).await;
        }
    });
    Ok(())
}

#[tauri::command]
async fn descarga_progreso(estado: tauri::State<'_, Estado>) -> Result<download::Progreso, String> {
    Ok(estado.descarga.lock().unwrap().as_ref().map(|d| d.progreso()).unwrap_or_default())
}

#[tauri::command]
async fn descarga_parar(estado: tauri::State<'_, Estado>) -> Result<(), String> {
    if let Some(d) = estado.descarga.lock().unwrap().as_ref() {
        d.parar();
    }
    Ok(())
}
```

- [ ] **Step 6: Comprobar**

Run: `cargo test -p indexer-app && cargo clippy -p indexer-app -- -D warnings`
Expected: PASS, 3 tests nuevos.

- [ ] **Step 7: Commit**

```bash
git add indexer/src-tauri/src/download.rs indexer/src-tauri/src/store.rs indexer/src-tauri/src/lib.rs
git commit -m "Descargar por tesela y origen, para que cortar a la mitad no cueste dinero"
```

---

## Task 12: El filtro y la revisión por excepción

**Files:**
- Create: `indexer/src-tauri/src/review.rs`
- Modify: `indexer/src-tauri/src/store.rs`
- Modify: `indexer/src-tauri/src/lib.rs`

**Interfaces:**
- Consumes: `lumi_index::filter::{Candidata, Reglas, Veredicto}`, `Almacen`.
- Produces: `Almacen::{revision_pendientes, revision_marcar, revision_cuentas}`;
  `review::{Ficha, Cuentas, pendientes, rechazar, aceptar_resto}`.
  Comandos: `revision_pendientes`, `revision_rechazar`, `revision_aceptar_resto`.

Las reglas ya se aplicaron en la descarga a través del adaptador. Lo que hace esta tarea es
la **segunda mitad**: la rejilla donde todo entra aceptado y el operador clica lo malo.

- [ ] **Step 1: Escribir el test (falla)**

Al final de `indexer/src-tauri/src/review.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    fn con_dos_sueltas() -> (tempfile::TempDir, Almacen, i64) {
        let d = tempfile::tempdir().unwrap();
        let a = Almacen::abrir(d.path()).unwrap();
        let i = a.crear_indice("x", "x").unwrap();
        let l = a.crear_lote(i, "red", "commons", Some("suelta"), "commons", None, None, false).unwrap();
        for n in ["a", "b", "c"] {
            a.insertar_imagen_pendiente_de_revision(i, l, n).unwrap();
        }
        (d, a, i)
    }

    #[test]
    fn todo_entra_aceptado_y_solo_sale_lo_que_se_clica() {
        let (_d, a, i) = con_dos_sueltas();
        let p = a.revision_pendientes(i, 100).unwrap();
        assert_eq!(p.len(), 3, "las tres esperan revisión");

        // Rechazar una la saca; las otras dos siguen esperando.
        a.revision_marcar(&[p[0].0], "rechazada").unwrap();
        let c = a.revision_cuentas(i).unwrap();
        assert_eq!(c.rechazadas, 1);
        assert_eq!(c.pendientes, 2);
        assert_eq!(c.aceptadas, 0);

        // Y aceptar el resto cierra la revisión de una vez: es lo que hace que
        // tres mil fotos sean tratables.
        a.revision_aceptar_resto(i).unwrap();
        let c = a.revision_cuentas(i).unwrap();
        assert_eq!(c.pendientes, 0);
        assert_eq!(c.aceptadas, 2);
        assert_eq!(c.rechazadas, 1, "aceptar el resto NO resucita lo rechazado");
    }

    #[test]
    fn una_rechazada_no_se_borra_y_no_se_embebe() {
        let (_d, a, i) = con_dos_sueltas();
        let p = a.revision_pendientes(i, 100).unwrap();
        a.revision_marcar(&[p[0].0], "rechazada").unwrap();
        a.revision_aceptar_resto(i).unwrap();

        // El fichero sigue estando —descartar marca, no borra— pero la imagen
        // ya no entra en el índice, igual que una saltada.
        assert_eq!(a.total_imagenes(i).unwrap(), 2, "la rechazada no cuenta");
        let sigue: i64 = a.contar_filas_imagenes(i).unwrap();
        assert_eq!(sigue, 3, "pero la fila sigue ahí por si cambias de opinión");
    }
}
```

- [ ] **Step 2: Comprobar que falla**

Run: `cargo test -p indexer-app review`
Expected: FAIL de compilación.

- [ ] **Step 3: Los métodos del almacén**

En `store.rs`, dentro de `impl Almacen`:

```rust
    /// `(id, ruta, fuente, licencia)` de las sueltas que esperan revisión.
    pub fn revision_pendientes(&self, indice_id: i64, limite: u32) -> Result<Vec<(i64, String, String, Option<String>)>> {
        let c = self.0.lock().unwrap();
        let mut q = c.prepare(
            "SELECT i.id, i.ruta, l.fuente, i.licencia
               FROM imagenes i JOIN lotes l ON l.id = i.lote_id
              WHERE i.indice_id = ?1 AND i.revision = 'pendiente'
              ORDER BY i.id LIMIT ?2",
        )?;
        let filas = q
            .query_map(params![indice_id, limite], |r| {
                Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(filas)
    }

    pub fn revision_marcar(&self, ids: &[i64], estado: &str) -> Result<()> {
        let c = self.0.lock().unwrap();
        for id in ids {
            c.execute("UPDATE imagenes SET revision = ?2 WHERE id = ?1", params![id, estado])?;
        }
        Ok(())
    }

    /// Cierra la revisión aceptando todo lo que siga pendiente. NO resucita lo
    /// ya rechazado: el `WHERE` lo deja fuera a propósito.
    pub fn revision_aceptar_resto(&self, indice_id: i64) -> Result<u32> {
        let c = self.0.lock().unwrap();
        let n = c.execute(
            "UPDATE imagenes SET revision = 'aceptada'
              WHERE indice_id = ?1 AND revision = 'pendiente'",
            params![indice_id],
        )?;
        Ok(n as u32)
    }

    pub fn revision_cuentas(&self, indice_id: i64) -> Result<Cuentas> {
        let c = self.0.lock().unwrap();
        let de = |e: &str| -> Result<u32> {
            Ok(c.query_row(
                "SELECT COUNT(*) FROM imagenes WHERE indice_id = ?1 AND revision = ?2",
                params![indice_id, e],
                |r| r.get(0),
            )?)
        };
        Ok(Cuentas { pendientes: de("pendiente")?, aceptadas: de("aceptada")?, rechazadas: de("rechazada")? })
    }

    /// Todas las filas de imagen, incluidas las rechazadas y las saltadas. Es
    /// lo que demuestra que descartar MARCA y no borra.
    pub fn contar_filas_imagenes(&self, indice_id: i64) -> Result<i64> {
        let c = self.0.lock().unwrap();
        Ok(c.query_row(
            "SELECT COUNT(*) FROM imagenes WHERE indice_id = ?1",
            params![indice_id],
            |r| r.get(0),
        )?)
    }

    /// Solo para los tests de revisión: una suelta pendiente y nada más.
    #[cfg(test)]
    pub fn insertar_imagen_pendiente_de_revision(&self, indice_id: i64, lote_id: i64, nombre: &str) -> Result<i64> {
        let c = self.0.lock().unwrap();
        c.execute(
            "INSERT INTO imagenes (indice_id, lote_id, ruta, sha256, lat, lng, quadkey, revision, creada_en)
             VALUES (?1, ?2, ?3, ?4, 43.0, -8.0, 'AAA', 'pendiente', ?5)",
            params![indice_id, lote_id, nombre, nombre, Self::ahora()],
        )?;
        Ok(c.last_insert_rowid())
    }
```

Con la struct al principio del fichero:

```rust
#[derive(Debug, Clone, Default, serde::Serialize)]
pub struct Cuentas {
    pub pendientes: u32,
    pub aceptadas: u32,
    pub rechazadas: u32,
}
```

**Y una consecuencia que hay que aplicar en todas partes:** una imagen `rechazada` no forma
parte del índice, igual que una saltada. Añadir `AND (i.revision IS NULL OR i.revision <>
'rechazada')` a las cinco consultas que hoy filtran por `saltada_motivo IS NULL`:
`filas_procedencia`, `sin_vector`, `pendientes_de`, `imagenes_de_indice`, `total_imagenes`,
`vectores_hechos` y `fuentes_de_tesela`. Sin esto se embeberían las rechazadas y saldrían en
el paquete.

- [ ] **Step 4: Implementar `review.rs`**

```rust
//! La revisión por excepción.
//!
//! Las reglas baratas (`lumi_index::filter`) ya corrieron en la descarga. Esto
//! es la otra mitad: TODO llega aceptado por defecto y el operador clica lo
//! malo. Aprobar tres mil fotos de una en una no lo hace nadie dos veces.
//!
//! Solo pasan por aquí las SUELTAS. Una panorámica de calle o una tesela
//! cenital son capturas sistemáticas: no hay nada que juzgar en ellas, y
//! revisar cuatro rumbos por cada punto de cada calle es exactamente el muro
//! que esto intenta evitar.

use anyhow::Result;
use serde::Serialize;

use crate::store::{Almacen, Cuentas};

#[derive(Debug, Clone, Serialize)]
pub struct Ficha {
    pub id: i64,
    pub ruta: String,
    pub fuente: String,
    pub licencia: Option<String>,
}

pub fn pendientes(almacen: &Almacen, indice_id: i64, limite: u32) -> Result<Vec<Ficha>> {
    Ok(almacen
        .revision_pendientes(indice_id, limite)?
        .into_iter()
        .map(|(id, ruta, fuente, licencia)| Ficha { id, ruta, fuente, licencia })
        .collect())
}

/// Descartar MARCA, no borra: en una rejilla de miles, un clic accidental no
/// puede ser irreversible. Una imagen sin vector sigue siendo material
/// recuperable si el operador cambia de opinión.
///
/// `indice_id` va aparte y no se deduce de los ids: una imagen sabe a qué
/// índice pertenece, pero una lista vacía no sabría a cuál devolver las cuentas.
pub fn rechazar(almacen: &Almacen, indice_id: i64, ids: &[i64]) -> Result<Cuentas> {
    almacen.revision_marcar(ids, "rechazada")?;
    almacen.revision_cuentas(indice_id)
}

/// Cierra la revisión. No resucita lo ya rechazado.
pub fn aceptar_resto(almacen: &Almacen, indice_id: i64) -> Result<Cuentas> {
    almacen.revision_aceptar_resto(indice_id)?;
    almacen.revision_cuentas(indice_id)
}
```

- [ ] **Step 5: Los comandos**

En `lib.rs`, `mod review;` y:

```rust
#[tauri::command]
async fn revision_pendientes(
    estado: tauri::State<'_, Estado>,
    indice_id: i64,
) -> Result<Vec<review::Ficha>, String> {
    // 120 caben en la rejilla sin que el navegador se ahogue decodificando
    // miniaturas. La paginación real llega si hace falta.
    review::pendientes(&estado.almacen, indice_id, 120).map_err(|e| e.to_string())
}

#[tauri::command]
async fn revision_rechazar(
    estado: tauri::State<'_, Estado>,
    indice_id: i64,
    ids: Vec<i64>,
) -> Result<store::Cuentas, String> {
    review::rechazar(&estado.almacen, indice_id, &ids).map_err(|e| e.to_string())
}

#[tauri::command]
async fn revision_aceptar_resto(
    estado: tauri::State<'_, Estado>,
    indice_id: i64,
) -> Result<store::Cuentas, String> {
    review::aceptar_resto(&estado.almacen, indice_id).map_err(|e| e.to_string())
}
```

- [ ] **Step 6: Comprobar**

Run: `cargo test -p indexer-app && cargo clippy -p indexer-app -- -D warnings`
Expected: PASS, 2 tests nuevos.

- [ ] **Step 7: Commit**

```bash
git add indexer/src-tauri/src/review.rs indexer/src-tauri/src/store.rs indexer/src-tauri/src/lib.rs
git commit -m "Revisar por excepción: todo entra aceptado y descartar no borra"
```

---

## Task 13: El filtro de redistribución al sellar

**Files:**
- Modify: `indexer/src-tauri/src/package.rs`
- Modify: `indexer/src-tauri/src/store.rs`
- Modify: `indexer/src-tauri/src/lib.rs`

**Interfaces:**
- Consumes: `lumi_index::network::Redistribucion`, `Almacen`.
- Produces: `package::Publicable { fuente, en_el_indice, viajan, motivo }`;
  `package::que_viaja(&[FilaPublicable]) -> Vec<Publicable>`;
  `Almacen::filas_publicables(indice_id) -> Vec<FilaPublicable>`.
  Comando: `paquete_que_viaja`.

**La decisión que hay detrás:** lo tentador es publicar el vector de una imagen no
redistribuible aunque no viaje su píxel. No sirve — el motor verifica geométricamente contra
la imagen, así que un vector sin ella le da al receptor un candidato que no puede verificar
nunca. Así que **lo no redistribuible no se publica, ni imagen ni vector**.

- [ ] **Step 1: Escribir el test (falla)**

Al final de `indexer/src-tauri/src/package.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    fn fila(fuente: &str, licencia: Option<&str>) -> FilaPublicable {
        FilaPublicable {
            id: 1,
            fuente: fuente.into(),
            licencia: licencia.map(|s| s.to_string()),
            quadkey: "AAA".into(),
        }
    }

    #[test]
    fn google_y_mapbox_no_sacan_ni_un_vector() {
        let filas = vec![fila("google", None), fila("mapbox-satelite", None)];
        let r = que_viaja(&filas);
        assert!(r.iter().all(|p| p.viajan == 0), "{r:?}");
        assert!(r.iter().all(|p| p.motivo.contains("no redistribuible")), "{r:?}");
    }

    #[test]
    fn flickr_viaja_foto_a_foto_y_las_nd_o_nc_se_quedan() {
        let filas = vec![
            fila("flickr", Some("CC BY 2.0")),
            fila("flickr", Some("CC BY-SA 2.0")),
            fila("flickr", Some("CC BY-ND 2.0")),
            fila("flickr", Some("CC BY-NC 2.0")),
            fila("flickr", None),
        ];
        let r = que_viaja(&filas);
        assert_eq!(r.len(), 1);
        assert_eq!(r[0].en_el_indice, 5);
        assert_eq!(r[0].viajan, 2, "solo BY y BY-SA");
    }

    #[test]
    fn lo_libre_viaja_entero() {
        let filas = vec![fila("mapillary", None), fila("commons", Some("CC0 1.0"))];
        let r = que_viaja(&filas);
        assert!(r.iter().all(|p| p.viajan == p.en_el_indice), "{r:?}");
    }

    #[test]
    fn las_fuentes_de_una_tesela_son_solo_las_que_de_verdad_viajan() {
        // Es lo que va a `cobertura.json`, y de lo que otro operador va a
        // deducir qué NO tiene que volver a indexar. Meter aquí google sería
        // prometerle una cobertura que su paquete no lleva.
        let filas = vec![
            fila("mapillary", None),
            fila("google", None),
            fila("flickr", Some("CC BY-ND 2.0")),
        ];
        let f = fuentes_que_viajan(&filas, "AAA");
        assert_eq!(f, vec!["mapillary".to_string()]);
    }
}
```

- [ ] **Step 2: Comprobar que falla**

Run: `cargo test -p indexer-app package`
Expected: FAIL de compilación.

- [ ] **Step 3: Implementar en `package.rs`**

Añadir antes del `mod tests`:

```rust
use lumi_index::network::Redistribucion;

/// Lo mínimo de una imagen para decidir si sale del paquete.
#[derive(Debug, Clone)]
pub struct FilaPublicable {
    pub id: i64,
    pub fuente: String,
    pub licencia: Option<String>,
    pub quadkey: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct Publicable {
    pub fuente: String,
    pub en_el_indice: u32,
    pub viajan: u32,
    pub licencia: String,
    pub motivo: String,
}

/// La redistribución de cada origen. Vive aquí y no en el trait porque sellar
/// no necesita construir adaptadores —ni claves, ni red— para saber qué puede
/// publicar: es una propiedad del origen, no de la sesión.
pub fn redistribucion_de(fuente: &str) -> Redistribucion {
    match fuente {
        "google" | "mapbox-satelite" => Redistribucion::SoloLocal,
        "flickr" => Redistribucion::PorImagen,
        "mapillary" | "kartaview" => Redistribucion::Libre { licencia: "CC BY-SA 4.0".into() },
        "commons" => Redistribucion::Libre { licencia: "libre (Commons)".into() },
        // Todo lo demás es material del propio operador (carpeta local, legacy):
        // suyo es y suyo sale.
        _ => Redistribucion::Libre { licencia: "declarada por el operador".into() },
    }
}

/// Una fila por origen con cuántas hay y cuántas salen.
pub fn que_viaja(filas: &[FilaPublicable]) -> Vec<Publicable> {
    let mut por_fuente: std::collections::BTreeMap<&str, (u32, u32)> = Default::default();
    for f in filas {
        let r = redistribucion_de(&f.fuente);
        let e = por_fuente.entry(f.fuente.as_str()).or_default();
        e.0 += 1;
        if r.viaja(f.licencia.as_deref()) {
            e.1 += 1;
        }
    }
    por_fuente
        .into_iter()
        .map(|(fuente, (en_el_indice, viajan))| {
            let r = redistribucion_de(fuente);
            let (licencia, motivo) = match &r {
                Redistribucion::Libre { licencia } => {
                    (licencia.clone(), "libre, con autor por fichero".to_string())
                }
                Redistribucion::SoloLocal => (
                    "no redistribuible".to_string(),
                    "no redistribuible: ni imagen ni vector".to_string(),
                ),
                Redistribucion::PorImagen => (
                    "varía por foto".to_string(),
                    format!("{} con ND o NC se quedan", en_el_indice - viajan),
                ),
            };
            Publicable { fuente: fuente.to_string(), en_el_indice, viajan, licencia, motivo }
        })
        .collect()
}

/// Los orígenes que de verdad viajan en el fragmento de esta tesela.
///
/// Es lo que se escribe en `TeselaCubierta::fuentes`, y de lo que otro operador
/// deducirá qué NO tiene que volver a indexar. Meter aquí un origen cuyo
/// material se quedó fuera sería prometerle una cobertura que el paquete no
/// lleva.
pub fn fuentes_que_viajan(filas: &[FilaPublicable], quadkey: &str) -> Vec<String> {
    let mut fuera: Vec<String> = filas
        .iter()
        .filter(|f| f.quadkey == quadkey)
        .filter(|f| redistribucion_de(&f.fuente).viaja(f.licencia.as_deref()))
        .map(|f| f.fuente.clone())
        .collect();
    fuera.sort();
    fuera.dedup();
    fuera
}
```

- [ ] **Step 4: La consulta que lo alimenta**

En `store.rs`:

```rust
    /// Lo que el sellado necesita para decidir qué sale del paquete. Las
    /// saltadas y las rechazadas no están: no forman parte del índice.
    pub fn filas_publicables(&self, indice_id: i64) -> Result<Vec<crate::package::FilaPublicable>> {
        let c = self.0.lock().unwrap();
        let mut q = c.prepare(
            "SELECT i.id, l.fuente, i.licencia, i.quadkey
               FROM imagenes i JOIN lotes l ON l.id = i.lote_id
              WHERE i.indice_id = ?1 AND i.saltada_motivo IS NULL
                AND (i.revision IS NULL OR i.revision <> 'rechazada')
              ORDER BY i.id",
        )?;
        let filas = q
            .query_map(params![indice_id], |r| {
                Ok(crate::package::FilaPublicable {
                    id: r.get(0)?,
                    fuente: r.get(1)?,
                    licencia: r.get(2)?,
                    quadkey: r.get(3)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(filas)
    }
```

- [ ] **Step 5: Aplicarlo en el sellado**

En el comando `paquete_sellar` de `lib.rs`:

1. Cargar `let publicables = estado.almacen.filas_publicables(indice_id)?;`
2. Al recorrer las imágenes para escribir cada fragmento, **saltar** las que no viajan:
   `if !package::redistribucion_de(&fila.fuente).viaja(fila.licencia.as_deref()) { continue }`
3. Al construir cada `TeselaCubierta`, usar
   `fuentes: package::fuentes_que_viajan(&publicables, &qk)` en vez de
   `almacen.fuentes_de_tesela(...)`, que devolvía también las que no salen.
4. Una tesela que se quede **sin ninguna** imagen publicable no genera fragmento y no entra
   en `cobertura.json`: un fragmento vacío es una promesa de cobertura que no existe.

Y el comando nuevo que alimenta la pantalla:

```rust
#[tauri::command]
async fn paquete_que_viaja(
    estado: tauri::State<'_, Estado>,
    indice_id: i64,
) -> Result<Vec<package::Publicable>, String> {
    let filas = estado.almacen.filas_publicables(indice_id).map_err(|e| e.to_string())?;
    Ok(package::que_viaja(&filas))
}
```

- [ ] **Step 6: Comprobar**

Run: `cargo test -p indexer-app && cargo test -p lumi-index && cargo clippy -p indexer-app -- -D warnings`
Expected: PASS, 4 tests nuevos.

- [ ] **Step 7: Commit**

```bash
git add indexer/src-tauri/src/package.rs indexer/src-tauri/src/store.rs indexer/src-tauri/src/lib.rs
git commit -m "Publicar es un filtro: lo que no puede viajar no sale ni como vector"
```

---

## Task 14: La capa de disponibilidad en el mapa

**Files:**
- Create: `indexer/src/lib/origenes.ts`
- Create: `indexer/src/territory/AvailabilityPanel.tsx`
- Modify: `indexer/src/territory/MapCanvas.tsx`
- Modify: `indexer/src/territory/TerritoryView.tsx`
- Modify: `indexer/src/lib/api.ts`

**Interfaces:**
- Consumes: comandos `origenes_lista`, `sondear_area`, `territorio_clasificar`.
- Produces: `origenes.ts` con `PALETA`, `NOMBRES`, `type FichaOrigen`;
  `AvailabilityPanel` con props `{ fichas, activos, onCambiar, onSondear, sondeando, resumen }`;
  `MapCanvas` gana props `{ activos, sondeos, tokenMapillary }`.

- [ ] **Step 1: Los tipos y la paleta**

Crear `indexer/src/lib/origenes.ts`:

```ts
/** La paleta de proveedores. Es el ÚNICO sitio de toda la aplicación donde el
 *  color codifica una categoría, y es deliberado: cinco orígenes simultáneos no
 *  se distinguen de otra forma. Fuera de la capa de disponibilidad y de los
 *  puntos índice de 9 px que la referencian, la rampa vuelve a ser neutra. */
export const PALETA: Record<string, string> = {
  mapillary: "#4ec9a5",
  kartaview: "#a78bfa",
  google: "#e8b04b",
  "mapbox-satelite": "#4a4d52",
  commons: "#6ea8fe",
  flickr: "#f472a6",
};

export const NOMBRES: Record<string, string> = {
  mapillary: "Mapillary",
  kartaview: "KartaView",
  google: "Google Street View",
  "mapbox-satelite": "Mapbox Satellite",
  commons: "Wikimedia Commons",
  flickr: "Flickr",
};

export const nombre = (id: string) => NOMBRES[id] ?? id;
export const color = (id: string) => PALETA[id] ?? "#6a6c70";
```

En `indexer/src/lib/api.ts`:

```ts
export interface FichaOrigen {
  id: string;
  tipo: "calle" | "cenital" | "suelta";
  puntos_exactos: boolean;
  gratis: boolean;
  usd_por_mil: number;
  redistribuye: boolean;
}
export interface SondeoTesela {
  quadkey: string;
  fuente: string;
  nivel: "mucho" | "poco" | "nada";
  estimadas: number;
  del_cache: boolean;
}
export interface LineaPrevista {
  fuente: string;
  teselas: number;
  unidades: number;
  coste_eur: number;
}
export interface Estimacion {
  lineas: LineaPrevista[];
  total_eur: number;
  gastado_eur: number;
  tope_eur: number;
  cabe: boolean;
  exceso_eur: number;
}
```

y en el objeto `api`:

```ts
  origenesLista: () => invoke<FichaOrigen[]>("origenes_lista"),
  sondearArea: (teselas: string[]) => invoke<SondeoTesela[]>("sondear_area", { teselas }),
  estimarArea: (nuevas: Record<string, string[]>) =>
    invoke<Estimacion>("estimar_area", { nuevas }),
```

- [ ] **Step 2: El panel**

Crear `indexer/src/territory/AvailabilityPanel.tsx`:

```tsx
import { type FichaOrigen, type SondeoTesela } from "../lib/api";
import { color, nombre } from "../lib/origenes";
import { Icon } from "../ui/Icon";

/** Los interruptores de la capa de disponibilidad.
 *
 *  Apagados por defecto, y el aviso de abajo no es decoración: el sondeo NUNCA
 *  se dispara al mover el mapa. Pasear por una ciudad con Google encendido
 *  quemaría cuota sin que nadie lo hubiera decidido. */
export function AvailabilityPanel({
  fichas,
  activos,
  sondeos,
  sondeando,
  onCambiar,
  onSondear,
}: {
  fichas: FichaOrigen[];
  activos: Set<string>;
  sondeos: SondeoTesela[];
  sondeando: boolean;
  onCambiar: (id: string, on: boolean) => void;
  onSondear: () => void;
}) {
  const delCache = sondeos.length > 0 && sondeos.every((s) => s.del_cache);

  return (
    <aside className="absolute left-3 top-3 z-20 w-[286px] rounded-card border border-white/[.13]
      bg-[rgba(16,19,25,.72)] p-[15px_15px_13px] shadow-lg shadow-black/40 backdrop-blur-xl">
      <div className="flex items-center gap-2">
        <span className="flex-1 text-[8.5px] uppercase tracking-[.13em] text-subtle">
          Disponibilidad
        </span>
        {sondeos.length > 0 && (
          <span className="rounded border border-border px-1.5 py-px text-[8.5px] text-subtle">
            {delCache ? "de la caché" : "recién sondeado"}
          </span>
        )}
      </div>

      <div className="mt-3 flex flex-col gap-2.5">
        {fichas.map((f) => {
          const on = activos.has(f.id);
          // Mapbox cenital no se pinta: «hay satélite en todas partes» no
          // informa de nada. Se lista para poder incluirlo en la descarga.
          const pintable = f.tipo !== "cenital";
          return (
            <div key={f.id} className={`flex items-center gap-2.5 ${on ? "" : "opacity-50"}`}>
              <button
                onClick={() => onCambiar(f.id, !on)}
                aria-label={`${on ? "Apagar" : "Encender"} ${nombre(f.id)}`}
                className={`relative h-[15px] w-[26px] shrink-0 rounded-full transition-colors
                  ${on ? "bg-white/20" : "bg-[#2a2d32]"}`}
              >
                <i className={`absolute top-[2px] block h-[11px] w-[11px] rounded-full transition-all
                  ${on ? "left-[13px] bg-fg" : "left-[2px] bg-subtle"}`} />
              </button>
              <span
                className="shrink-0"
                style={{
                  background: color(f.id),
                  width: 9, height: 9,
                  borderRadius: f.puntos_exactos ? 999 : 2,
                  opacity: f.puntos_exactos ? 1 : 0.55,
                }}
              />
              <span className="flex-1 text-[11.5px] text-fg">{nombre(f.id)}</span>
              <span className={`font-mono text-[10px] ${f.gratis ? "text-subtle" : "text-warning-fg"}`}>
                {!pintable ? "global" : f.puntos_exactos ? "exacto" : "muestreo"}
              </span>
            </div>
          );
        })}
      </div>

      <div className="my-3 h-px bg-border" />

      <p className="text-[10.5px] leading-relaxed text-subtle">
        El muestreo solo distingue tres niveles —<b className="font-normal text-fg">hay</b>,{" "}
        <b className="font-normal text-fg">poco</b>, <b className="font-normal text-fg">no hay</b>—
        porque no sabe contar mejor.
      </p>

      <button
        onClick={onSondear}
        disabled={sondeando || activos.size === 0}
        className="jg-press mt-3 w-full rounded-lg border border-border py-[7px] text-[11.5px] text-fg disabled:opacity-40"
      >
        {sondeando ? "Sondeando…" : sondeos.length > 0 ? "Volver a sondear" : "Sondear el área"}
      </button>

      <div className="mt-3 flex items-start gap-2">
        <Icon name="alert" size={12} className="mt-px shrink-0 text-warning-fg" />
        <span className="text-[10.5px] leading-snug text-warning-fg">
          El sondeo <b className="font-normal">no</b> se repite al mover el mapa: solo dentro del
          área dibujada y solo cuando lo pides.
        </span>
      </div>
    </aside>
  );
}
```

- [ ] **Step 3: Las dos capas del mapa**

En `MapCanvas.tsx`, dentro del `m.on("load", …)` y después de las capas de teselas que ya
existen, añadir la capa vectorial de Mapillary y la de sombreado. El token de Mapillary llega
por prop, y **si no hay token la capa no se añade**:

```tsx
        // Mapillary por sus teselas vectoriales oficiales: una petición por
        // tesela de pantalla, gratis, y ya vienen cacheadas. No pasa por el
        // backend, así que Rust no tiene que decodificar nada.
        if (tokenMapillary) {
          m.addSource("mly", {
            type: "vector",
            tiles: [`https://tiles.mapillary.com/maps/vtp/mly1_public/2/{z}/{x}/{y}?access_token=${tokenMapillary}`],
            minzoom: 6,
            maxzoom: 14,
          });
          m.addLayer({
            id: "mly-puntos",
            type: "circle",
            source: "mly",
            "source-layer": "image",
            layout: { visibility: "none" },
            paint: {
              "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 1.2, 16, 2.6],
              "circle-color": "#4ec9a5",
              "circle-opacity": 0.9,
            },
          });
        }

        // El sombreado de los que solo se pueden sondear por muestreo. Una sola
        // fuente para todos: el color sale de la propiedad `fuente` de cada
        // rasgo, así que encender un origen más no añade una capa más.
        m.addSource("sondeos", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        m.addLayer({
          id: "sondeos-relleno",
          type: "fill",
          source: "sondeos",
          paint: {
            "fill-color": ["get", "color"],
            "fill-opacity": ["match", ["get", "nivel"], "mucho", 0.30, "poco", 0.13, 0],
          },
        }, "teselas-borde");
```

Y un efecto que reacciona a los interruptores y a los sondeos:

```tsx
  useEffect(() => {
    const m = mapa.current;
    if (!m || !m.isStyleLoaded()) return;
    if (m.getLayer("mly-puntos")) {
      m.setLayoutProperty("mly-puntos", "visibility", activos.has("mapillary") ? "visible" : "none");
    }
    const src = m.getSource("sondeos") as mapboxgl.GeoJSONSource | undefined;
    if (!src) return;
    // Mapillary ya se pinta como puntos y el cenital no se pinta: los dos
    // quedan fuera del sombreado, o taparían a los demás con una capa que no
    // dice nada.
    src.setData({
      type: "FeatureCollection",
      features: sondeos
        .filter((s) => activos.has(s.fuente) && s.fuente !== "mapillary" && s.fuente !== "mapbox-satelite")
        .map((s) => {
          const f = teselaAPoligono(s.quadkey);
          f.properties = { nivel: s.nivel, color: color(s.fuente) };
          return f;
        }),
    });
  }, [activos, sondeos]);
```

- [ ] **Step 4: Conectarlo en `TerritoryView`**

```tsx
  const [fichas, setFichas] = useState<FichaOrigen[]>([]);
  const [activos, setActivos] = useState<Set<string>>(new Set());
  const [sondeos, setSondeos] = useState<SondeoTesela[]>([]);
  const [sondeando, setSondeando] = useState(false);

  useEffect(() => { void api.origenesLista().then(setFichas); }, []);

  // La clasificación necesita saber contra QUÉ orígenes se pregunta, porque
  // una tesela heredada puede seguir sin cubrir en alguno de ellos.
  async function alTerminarDibujo(p: Punto[]) {
    setDibujo(p);
    setSondeos([]);
    setClasificacion(await api.territorioClasificar(p, fichas.map((f) => f.id)));
  }

  async function sondear() {
    if (!clasificacion) return;
    setSondeando(true);
    try {
      setSondeos(await api.sondearArea(clasificacion.teselas.map(([qk]) => qk)));
    } finally {
      setSondeando(false);
    }
  }
```

Pasando `activos`, `sondeos` y el token de Mapillary a `MapCanvas`, y renderizando
`AvailabilityPanel` solo cuando hay clasificación.

Para el token hace falta un comando más, en `lib.rs`:

```rust
#[tauri::command]
async fn clave_leer(estado: tauri::State<'_, Estado>, proveedor: String) -> Result<Option<String>, String> {
    // Solo se entrega la de Mapillary y la de Mapbox: son las dos que el mapa
    // necesita en el navegador para pedir teselas. Ninguna otra sale de aquí.
    if proveedor != "mapillary" && proveedor != "mapbox-satelite" {
        return Err("esa clave no se entrega al frontend".into());
    }
    let c = keys::Claves { almacen: &estado.almacen, maestra: &estado.maestra };
    c.leer(&proveedor).map_err(|e| e.to_string())
}
```

- [ ] **Step 5: Comprobar**

Run: `cd indexer && npx tsc -b --noEmit && npm run lint && npm run build`
Expected: sin errores.

- [ ] **Step 6: Commit**

```bash
git add indexer/src/lib indexer/src/territory indexer/src-tauri/src/lib.rs
git commit -m "La disponibilidad en el mapa: puntos donde los hay y sombreado donde no"
```

---

## Task 15: Estimar, confirmar y el tope

**Files:**
- Create: `indexer/src/territory/EstimateDialog.tsx`
- Modify: `indexer/src/territory/TerritoryView.tsx`

**Interfaces:**
- Consumes: `api.estimarArea`, `api.descargaArrancar`, `Estimacion`, `PALETA`.
- Produces: `EstimateDialog` con props
  `{ e, onCancelar, onConfirmar(soloGratis: boolean) }`.

- [ ] **Step 1: El diálogo**

Crear `indexer/src/territory/EstimateDialog.tsx`:

```tsx
import { type Estimacion } from "../lib/api";
import { color, nombre } from "../lib/origenes";
import { Icon } from "../ui/Icon";

const eur = (n: number) => `${n.toFixed(2).replace(".", ",")} €`;

/** Antes de descargar. Dos puertas y son distintas: esta confirmación es
 *  INFORMADA —ves el número antes de que se gaste nada— y el tope mensual es
 *  una BARRERA que rechaza el trabajo entero. Media descarga es un índice con
 *  agujeros que nadie sabe dónde están. */
export function EstimateDialog({
  e,
  onCancelar,
  onConfirmar,
}: {
  e: Estimacion;
  onCancelar: () => void;
  onConfirmar: (soloGratis: boolean) => void;
}) {
  const pctGastado = Math.min(100, (e.gastado_eur / e.tope_eur) * 100);
  const pctEsta = Math.min(100 - pctGastado, (e.total_eur / e.tope_eur) * 100);
  const pctFuera = Math.min(100, (e.exceso_eur / e.tope_eur) * 100);
  const hayGratis = e.lineas.some((l) => l.coste_eur === 0);

  return (
    <div className={`w-[600px] rounded-card border bg-[rgba(16,19,25,.72)] p-[22px_24px]
      shadow-lg shadow-black/40 backdrop-blur-xl
      ${e.cabe ? "border-white/[.13]" : "border-danger/45"}`}>
      {e.cabe ? (
        <>
          <p className="text-sm text-fg">Antes de descargar</p>
          <p className="mt-[5px] text-[10.5px] leading-relaxed text-subtle">
            Esto es lo que va a costar, por origen. Lo gratuito también se lista: hace falta para
            entender de dónde va a salir cada imagen.
          </p>
        </>
      ) : (
        <div className="flex items-start gap-2.5">
          <Icon name="alert" size={16} className="mt-0.5 shrink-0 text-danger-fg" />
          <div>
            <p className="text-[13.5px] text-danger-fg">Esta descarga pasaría el tope del mes</p>
            <p className="mt-1.5 text-[10.5px] leading-relaxed text-subtle">
              Llevas <b className="font-normal text-fg">{eur(e.gastado_eur)}</b> gastados y esto
              sumaría <b className="font-normal text-fg">{eur(e.total_eur)}</b>, que son{" "}
              <b className="font-normal text-fg">{eur(e.exceso_eur)}</b> por encima del tope de{" "}
              <b className="font-normal text-fg">{eur(e.tope_eur)}</b>. No se descarga nada.
            </p>
          </div>
        </div>
      )}

      <table className="mt-[18px] w-full border-collapse text-[11.5px]">
        <thead>
          <tr className="text-[8px] uppercase tracking-[.11em] text-subtle">
            <th className="w-2/5 pb-2 text-left font-normal">Origen</th>
            <th className="pb-2 text-left font-normal">Teselas</th>
            <th className="pb-2 text-left font-normal">Unidades</th>
            <th className="pb-2 text-right font-normal">Coste</th>
          </tr>
        </thead>
        <tbody>
          {e.lineas.map((l) => (
            <tr key={l.fuente} className="border-t border-border">
              <td className="py-2">
                <span className="flex items-center gap-2.5">
                  <span className="h-[9px] w-[9px] shrink-0 rounded-full" style={{ background: color(l.fuente) }} />
                  {nombre(l.fuente)}
                </span>
              </td>
              <td className="py-2 font-mono">{l.teselas}</td>
              <td className="py-2 font-mono">{l.unidades.toLocaleString("es")}</td>
              <td className={`py-2 text-right font-mono ${l.coste_eur > 0 ? "text-warning-fg" : "text-subtle"}`}>
                {l.coste_eur > 0 ? eur(l.coste_eur) : "gratis"}
              </td>
            </tr>
          ))}
          <tr className="border-t border-white/20 font-medium">
            <td className="pt-[11px]" colSpan={3}>Total estimado</td>
            <td className="pt-[11px] text-right font-mono">{eur(e.total_eur)}</td>
          </tr>
        </tbody>
      </table>

      <div className="mt-[18px] rounded-[9px] border border-border p-[12px_13px]">
        <div className="flex items-center">
          <span className="flex-1 text-[8px] uppercase tracking-[.11em] text-subtle">
            Presupuesto del mes
          </span>
          <span className="font-mono text-[10.5px] text-muted">
            {eur(e.gastado_eur)} de {eur(e.tope_eur)}
          </span>
        </div>
        <div className="mt-2 flex h-[5px] overflow-hidden rounded-[3px] bg-elevated">
          <i className="block h-full bg-fg" style={{ width: `${pctGastado}%` }} />
          <i className="block h-full bg-warning" style={{ width: `${pctEsta}%` }} />
          {!e.cabe && <i className="block h-full bg-danger" style={{ width: `${pctFuera}%` }} />}
        </div>
        <p className="mt-2 text-[10.5px] text-subtle">
          {e.cabe
            ? `quedarían ${eur(e.tope_eur - e.gastado_eur - e.total_eur)}`
            : "lo rojo es lo que no cabe"}
        </p>
      </div>

      <p className="mt-[13px] text-[10.5px] leading-relaxed text-subtle">
        Solo se apunta lo que el proveedor <b className="font-normal text-fg">sirva de verdad</b>:
        una petición que falla y no devuelve imagen no se cobra ni se cuenta. Y el presupuesto va
        con la descarga como contador vivo, no como una cifra que se mira al empezar.
      </p>

      <div className="mt-[18px] flex justify-end gap-2.5">
        <button onClick={onCancelar} className="jg-press rounded-lg border border-white/15 px-4 py-2 text-[11.5px] text-fg">
          Cancelar
        </button>
        {hayGratis && (
          <button
            onClick={() => onConfirmar(true)}
            className="jg-press rounded-lg border border-white/15 px-4 py-2 text-[11.5px] text-fg"
          >
            Solo los gratuitos · 0,00 €
          </button>
        )}
        <button
          onClick={() => onConfirmar(false)}
          disabled={!e.cabe}
          className="jg-press rounded-lg bg-accent px-4 py-2 text-[11.5px] font-medium text-black disabled:opacity-40"
        >
          Confirmar y descargar · {eur(e.total_eur)}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Conectarlo**

En `TerritoryView.tsx`, tras confirmar el plan del 7a se pide la estimación con el mapa
`fuente → teselas nuevas EN ESE ORIGEN`, que sale de `clasificacion.por_origen` cruzado con
las teselas clasificadas. Y al confirmar:

```tsx
  async function confirmar(soloGratis: boolean) {
    if (!estimacion || !clasificacion) return;
    const activas = soloGratis
      ? new Set(estimacion.lineas.filter((l) => l.coste_eur === 0).map((l) => l.fuente))
      : new Set(estimacion.lineas.map((l) => l.fuente));
    const nuevas = Object.fromEntries(
      Object.entries(nuevasPorOrigen).filter(([f]) => activas.has(f)),
    );
    // El presupuesto que viaja con la descarga es LO ESTIMADO, no lo que queda
    // del mes: así un origen que se desmadre se queda sin saldo en su propio
    // trabajo en vez de comerse el tope entero.
    const presupuesto = soloGratis ? 0 : estimacion.total_eur;
    await api.descargaArrancar(indiceId, nuevas, presupuesto);
    onDescargando();
  }
```

- [ ] **Step 3: Comprobar**

Run: `cd indexer && npx tsc -b --noEmit && npm run lint && npm run build`
Expected: sin errores.

- [ ] **Step 4: Commit**

```bash
git add indexer/src/territory
git commit -m "Ver el precio en euros antes de pagarlo, y un tope que no es un aviso"
```

---

## Task 16: La descarga y la revisión en pantalla

**Files:**
- Create: `indexer/src/download/DownloadView.tsx`
- Create: `indexer/src/review/ReviewGrid.tsx`
- Modify: `indexer/src/lib/api.ts`
- Modify: `indexer/src/App.tsx`

**Interfaces:**
- Consumes: `descarga_progreso`, `descarga_parar`, `revision_pendientes`,
  `revision_rechazar`, `revision_aceptar_resto`.
- Produces: `DownloadView` con props `{ onTerminado }`; `ReviewGrid` con props
  `{ indiceId, onEmbeber }`.

- [ ] **Step 1: Los enlaces**

En `api.ts`:

```ts
export interface ProgresoDescarga {
  trabajando: boolean;
  teselas_hechas: number;
  teselas_total: number;
  imagenes: number;
  gastado_eur: number;
  sin_saldo: boolean;
  por_origen: [string, number, number][];
  ultimo: string;
}
export interface FichaRevision { id: number; ruta: string; fuente: string; licencia: string | null }
export interface Cuentas { pendientes: number; aceptadas: number; rechazadas: number }
```

```ts
  descargaArrancar: (indiceId: number, nuevas: Record<string, string[]>, presupuestoEur: number) =>
    invoke<void>("descarga_arrancar", { indiceId, nuevas, presupuestoEur }),
  descargaProgreso: () => invoke<ProgresoDescarga>("descarga_progreso"),
  descargaParar: () => invoke<void>("descarga_parar"),
  revisionPendientes: (indiceId: number) => invoke<FichaRevision[]>("revision_pendientes", { indiceId }),
  revisionRechazar: (indiceId: number, ids: number[]) =>
    invoke<Cuentas>("revision_rechazar", { indiceId, ids }),
  revisionAceptarResto: (indiceId: number) => invoke<Cuentas>("revision_aceptar_resto", { indiceId }),
```

- [ ] **Step 2: `DownloadView`**

Crear `indexer/src/download/DownloadView.tsx`. El sondeo del progreso **termina** cuando
`trabajando` pasa a false, con la misma lección de `ServicesStep`: un intervalo que no para
nunca inunda el log y miente sobre el estado.

```tsx
import { useEffect, useState } from "react";

import { api, type ProgresoDescarga } from "../lib/api";
import { color, nombre } from "../lib/origenes";

const eur = (n: number) => `${n.toFixed(2).replace(".", ",")} €`;

export function DownloadView({ onTerminado }: { onTerminado: () => void }) {
  const [p, setP] = useState<ProgresoDescarga | null>(null);

  // El sondeo TERMINA cuando la descarga termina. Es la misma lección del paso
  // de servicios: un intervalo eterno inunda el log y miente sobre el estado.
  useEffect(() => {
    let arrancó = false;
    const t = setInterval(() => {
      void api.descargaProgreso().then((x) => {
        setP(x);
        if (x.trabajando) arrancó = true;
        else if (arrancó) { clearInterval(t); onTerminado(); }
      });
    }, 700);
    return () => clearInterval(t);
  }, [onTerminado]);

  if (!p) return null;
  const pct = p.teselas_total ? (p.teselas_hechas / p.teselas_total) * 100 : 0;

  return (
    <div className="flex h-full">
      <div className="flex-1 overflow-hidden p-[20px_22px]">
        <div className="flex items-center">
          <span className="flex-1 text-[13px] text-fg">Bajando imágenes de red</span>
          <span className="font-mono text-[11px] text-muted">
            {p.teselas_hechas} de {p.teselas_total} teselas
          </span>
        </div>
        <div className="mt-2.5 h-1.5 overflow-hidden rounded-[3px] bg-elevated">
          <i className="block h-full bg-fg transition-[width] duration-500" style={{ width: `${pct}%` }} />
        </div>

        <p className="mt-[22px] text-[8.5px] uppercase tracking-[.13em] text-subtle">Por origen</p>
        <table className="mt-2 w-full border-collapse text-[11.5px]">
          <tbody>
            {p.por_origen.map(([f, hechas, total]) => (
              <tr key={f} className="border-t border-border">
                <td className="w-[35%] py-2">
                  <span className="flex items-center gap-2.5">
                    <span className="h-[9px] w-[9px] rounded-full" style={{ background: color(f) }} />
                    {nombre(f)}
                  </span>
                </td>
                <td className="py-2">
                  <span className="block h-[5px] w-[150px] overflow-hidden rounded-[3px] bg-elevated">
                    <i className="block h-full" style={{ width: `${total ? (hechas / total) * 100 : 0}%`, background: color(f) }} />
                  </span>
                </td>
                <td className="py-2 text-right font-mono text-muted">{hechas}/{total}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {p.ultimo && (
          <p className="mt-5 font-mono text-[10px] leading-[1.9] text-muted">{p.ultimo}</p>
        )}
        {p.sin_saldo && (
          <p className="mt-2.5 text-[11px] text-warning-fg">
            El presupuesto se agotó a mitad. Lo bajado está dentro y pagado; las teselas que se
            quedaron sin terminar siguen pendientes y no se han marcado como hechas, así que al
            retomar con más presupuesto continúan por donde iban.
          </p>
        )}
      </div>

      <aside className="w-[300px] border-l border-border bg-[rgba(16,18,21,.5)] p-[20px_18px]">
        <p className="text-[8.5px] uppercase tracking-[.13em] text-subtle">Gasto</p>
        <p className="mt-2 font-mono text-[15px] text-warning-fg">{eur(p.gastado_eur)}</p>
        <p className="mt-2 text-[10.5px] leading-relaxed text-subtle">
          Solo lo servido. Una petición que falla no se cobra ni se apunta.
        </p>

        <div className="my-4 h-px bg-border" />
        <p className="text-[8.5px] uppercase tracking-[.13em] text-subtle">Retomar</p>
        <p className="mt-2 text-[10.5px] leading-relaxed text-subtle">
          Cada pareja <b className="font-normal text-fg">tesela × origen</b> se anota al terminar.
          Si cierras esto a mitad, al volver se sigue por donde iba y{" "}
          <b className="font-normal text-fg">no se vuelve a pagar</b> por nada ya descargado.
        </p>

        <button
          onClick={() => void api.descargaParar()}
          className="jg-press mt-5 w-full rounded-lg border border-border py-[7px] text-[11.5px] text-fg"
        >
          Detener
        </button>
      </aside>
    </div>
  );
}
```

- [ ] **Step 3: `ReviewGrid`**

Crear `indexer/src/review/ReviewGrid.tsx`. Las miniaturas se sirven con
`convertFileSrc` de `@tauri-apps/api/core`, que es lo que permite a la ventana leer un fichero
local sin exponer el sistema de ficheros.

```tsx
import { convertFileSrc } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";

import { api, type Cuentas, type FichaRevision } from "../lib/api";

/** Rechazo por excepción: TODO llega aceptado y tú clicas lo malo. Aprobar tres
 *  mil fotos de una en una no lo hace nadie dos veces.
 *
 *  Descartar MARCA, no borra: en una rejilla de miles un clic accidental no
 *  puede ser irreversible. */
export function ReviewGrid({ indiceId, onEmbeber }: { indiceId: number; onEmbeber: () => void }) {
  const [fichas, setFichas] = useState<FichaRevision[]>([]);
  const [fuera, setFuera] = useState<Set<number>>(new Set());
  const [cuentas, setCuentas] = useState<Cuentas | null>(null);
  const [ultimo, setUltimo] = useState<number | null>(null);

  useEffect(() => { void api.revisionPendientes(indiceId).then(setFichas); }, [indiceId]);

  function clic(i: number, conMayus: boolean) {
    const nuevos = new Set(fuera);
    // Mayúsculas selecciona un rango: es lo que hace tratable descartar
    // veinte seguidas de la misma sesión mala.
    const desde = conMayus && ultimo !== null ? Math.min(ultimo, i) : i;
    const hasta = conMayus && ultimo !== null ? Math.max(ultimo, i) : i;
    for (let k = desde; k <= hasta; k++) {
      const id = fichas[k].id;
      if (nuevos.has(id)) nuevos.delete(id); else nuevos.add(id);
    }
    setUltimo(i);
    setFuera(nuevos);
  }

  async function cerrar() {
    if (fuera.size > 0) await api.revisionRechazar(indiceId, [...fuera]);
    setCuentas(await api.revisionAceptarResto(indiceId));
    onEmbeber();
  }

  return (
    <div className="flex h-full">
      <div className="flex-1 overflow-y-auto p-[16px_18px]">
        <p className="mb-3 text-[10.5px] text-subtle">
          clic para descartar · <b className="font-normal text-fg">May</b>+clic para un rango
        </p>
        <div className="grid grid-cols-6 gap-2.5">
          {fichas.map((f, i) => {
            const no = fuera.has(f.id);
            return (
              <button
                key={f.id}
                onClick={(ev) => clic(i, ev.shiftKey)}
                aria-pressed={no}
                className={`relative aspect-[4/3] overflow-hidden rounded-md border border-border
                  ${no ? "opacity-30 ring-[1.5px] ring-danger" : ""}`}
              >
                <img src={convertFileSrc(f.ruta)} alt="" loading="lazy"
                  className="h-full w-full object-cover" />
                <span className="absolute bottom-1 left-1 rounded-[3px] bg-black/50 px-1 py-px
                  font-mono text-[8px] text-white/75">
                  {f.licencia ?? f.fuente}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <aside className="w-[300px] border-l border-border bg-[rgba(16,18,21,.5)] p-[20px_18px]">
        <p className="text-[8.5px] uppercase tracking-[.13em] text-subtle">Lo que entra al índice</p>
        <div className="mt-3 flex flex-col gap-2 text-[11.5px]">
          <div className="flex"><span className="flex-1">aceptadas</span>
            <span className="font-mono">{fichas.length - fuera.size}</span></div>
          <div className="flex text-danger-fg"><span className="flex-1">fuera por ti</span>
            <span className="font-mono">{fuera.size}</span></div>
        </div>
        <p className="mt-4 text-[10.5px] leading-relaxed text-subtle">
          Descartar aquí <b className="font-normal text-fg">no borra el fichero</b>: lo marca. Una
          imagen sin vector sigue siendo material que se puede recuperar si cambias de opinión.
        </p>
        {cuentas && (
          <p className="mt-3 font-mono text-[10px] text-subtle">
            {cuentas.aceptadas} aceptadas · {cuentas.rechazadas} rechazadas
          </p>
        )}
        <button onClick={() => void cerrar()}
          className="jg-press mt-5 w-full rounded-lg bg-accent py-[7px] text-[11.5px] font-medium text-black">
          Embeber {fichas.length - fuera.size}
        </button>
      </aside>
    </div>
  );
}
```

- [ ] **Step 4: Enrutarlo en `App.tsx`**

`Rail` gana dos destinos, `descarga` y `revision`, y `App` los renderiza. Después de que
`DownloadView` avise de que terminó, se salta a `revision` **solo si hay pendientes** — una
descarga de puro street view no tiene nada que revisar y mandar al operador a una rejilla
vacía sería un paso de más.

- [ ] **Step 5: Comprobar**

Run: `cd indexer && npx tsc -b --noEmit && npm run lint && npm run build`
Expected: sin errores.

- [ ] **Step 6: Commit**

```bash
git add indexer/src
git commit -m "La descarga y la revisión en pantalla, y el sondeo que termina cuando termina"
```

---

## Task 17: Ajustes de orígenes

**Files:**
- Create: `indexer/src/settings/OriginsPanel.tsx`
- Modify: `indexer/src/setup/ServicesPanel.tsx` (pasa a ser una pestaña)
- Modify: `indexer/src/App.tsx`
- Modify: `indexer/src/lib/api.ts`
- Modify: `indexer/src-tauri/src/lib.rs`

**Interfaces:**
- Produces: comandos `clave_guardar`, `clave_hay`, `tope_leer`, `tope_fijar`, `gasto_mes`.
  `OriginsPanel` sin props.

- [ ] **Step 1: Los comandos**

```rust
#[tauri::command]
async fn clave_guardar(
    estado: tauri::State<'_, Estado>,
    proveedor: String,
    clave: String,
) -> Result<(), String> {
    let c = keys::Claves { almacen: &estado.almacen, maestra: &estado.maestra };
    c.guardar(&proveedor, &clave).map_err(|e| e.to_string())
}

/// Se devuelve SI HAY, nunca la clave. La pantalla no necesita el secreto para
/// enseñar «configurada», y entregarlo sería regalarlo al portapapeles de
/// cualquier captura de pantalla.
#[tauri::command]
async fn clave_hay(estado: tauri::State<'_, Estado>, proveedor: String) -> Result<bool, String> {
    let c = keys::Claves { almacen: &estado.almacen, maestra: &estado.maestra };
    Ok(c.hay(&proveedor))
}

#[tauri::command]
async fn tope_leer(estado: tauri::State<'_, Estado>) -> Result<f64, String> {
    let c = keys::Claves { almacen: &estado.almacen, maestra: &estado.maestra };
    Ok(c.tope_eur())
}

#[tauri::command]
async fn tope_fijar(estado: tauri::State<'_, Estado>, eur: f64) -> Result<(), String> {
    if !(0.0..=100_000.0).contains(&eur) {
        return Err("el tope tiene que estar entre 0 y 100 000 €".into());
    }
    let c = keys::Claves { almacen: &estado.almacen, maestra: &estado.maestra };
    c.fijar_tope_eur(eur).map_err(|e| e.to_string())
}

#[tauri::command]
async fn gasto_mes(estado: tauri::State<'_, Estado>) -> Result<(f64, Vec<(String, u32, f64)>), String> {
    let mes = spend::mes_iso();
    let total = estado.almacen.gasto_del_mes(&mes).map_err(|e| e.to_string())?;
    let por = estado.almacen.gasto_del_mes_por_origen(&mes).map_err(|e| e.to_string())?;
    Ok((total, por))
}
```

- [ ] **Step 2: Las constantes que faltan**

Añadir al final de `indexer/src/lib/origenes.ts`. Los límites son fijos y viven aquí porque el
backend no los expone y no hace falta que lo haga: son texto para el operador.

```ts
export const LIMITES: Record<string, string> = {
  mapillary: "8 req/s · 4 a la vez",
  kartaview: "4 req/s · 2 a la vez",
  google: "10 req/s · 4 a la vez",
  "mapbox-satelite": "16 req/s · 8 a la vez",
  commons: "2 req/s · 1 a la vez",
  flickr: "4 req/s · 2 a la vez",
};

/** Los dos que funcionan sin credencial. No se les pide una que no existe. */
export const SIN_CLAVE = new Set(["kartaview", "commons"]);

/** Mapbox no tiene fila propia: comparte la clave con el mapa. */
export const COMPARTE_CLAVE = new Set(["mapbox-satelite"]);

export const ORDEN = [
  "mapillary", "kartaview", "google", "mapbox-satelite", "commons", "flickr",
];
```

- [ ] **Step 3: El panel**

Crear `indexer/src/settings/OriginsPanel.tsx`:

```tsx
import { useEffect, useState } from "react";

import { api } from "../lib/api";
import { COMPARTE_CLAVE, LIMITES, ORDEN, SIN_CLAVE, color, nombre } from "../lib/origenes";

const eur = (n: number) => `${n.toFixed(2).replace(".", ",")} €`;
const PRECIO: Record<string, string> = { google: "7,00 $/1000", "mapbox-satelite": "0,75 $/1000" };

export function OriginsPanel() {
  const [hay, setHay] = useState<Record<string, boolean>>({});
  const [editando, setEditando] = useState<string | null>(null);
  const [valor, setValor] = useState("");
  const [tope, setTope] = useState(0);
  const [topeTexto, setTopeTexto] = useState("");
  const [gastado, setGastado] = useState(0);
  const [error, setError] = useState<string | null>(null);

  async function refrescar() {
    const pares = await Promise.all(
      ORDEN.filter((o) => !SIN_CLAVE.has(o)).map(async (o) => [o, await api.claveHay(o)] as const),
    );
    setHay(Object.fromEntries(pares));
    const t = await api.topeLeer();
    setTope(t);
    setTopeTexto(String(t));
    const [total] = await api.gastoMes();
    setGastado(total);
  }

  useEffect(() => { void refrescar(); }, []);

  async function guardar(o: string) {
    setError(null);
    try {
      await api.claveGuardar(o, valor.trim());
      setEditando(null);
      setValor("");
      await refrescar();
    } catch (e) { setError(String(e)); }
  }

  async function guardarTope() {
    setError(null);
    const n = Number(topeTexto.replace(",", "."));
    if (!Number.isFinite(n)) { setError("el tope tiene que ser un número"); return; }
    try { await api.topeFijar(n); await refrescar(); } catch (e) { setError(String(e)); }
  }

  return (
    <div className="h-full overflow-y-auto p-8">
      <div className="mx-auto max-w-3xl">
        <p className="text-sm text-fg">Orígenes de red</p>
        <p className="mt-[5px] text-[11px] leading-relaxed text-muted">
          Tus claves, en tu máquina, cifradas con la clave maestra local. Nunca salen de aquí ni
          viajan dentro de ningún paquete.
        </p>

        <table className="mt-5 w-full border-collapse text-[11.5px]">
          <thead>
            <tr className="text-[8px] uppercase tracking-[.11em] text-subtle">
              <th className="w-[30%] pb-2 text-left font-normal">Origen</th>
              <th className="pb-2 text-left font-normal">Clave</th>
              <th className="pb-2 text-left font-normal">Límite</th>
              <th className="pb-2 text-right font-normal">Coste</th>
              <th className="w-[16%] pb-2" />
            </tr>
          </thead>
          <tbody>
            {ORDEN.map((o) => {
              const sinClave = SIN_CLAVE.has(o);
              const compartida = COMPARTE_CLAVE.has(o);
              const puesta = sinClave || hay[o];
              return (
                <tr key={o} className={`border-t border-border ${puesta ? "" : "opacity-55"}`}>
                  <td className="py-2">
                    <span className="flex items-center gap-2.5">
                      <span className="h-[9px] w-[9px] rounded-full" style={{ background: color(o) }} />
                      {nombre(o)}
                    </span>
                  </td>
                  <td className="py-2">
                    {editando === o ? (
                      <input
                        type="password"
                        autoComplete="off"
                        autoFocus
                        value={valor}
                        onChange={(e) => setValor(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") void guardar(o); }}
                        placeholder="pega la clave y pulsa Intro"
                        className="w-full rounded border border-border bg-black/30 px-2 py-1
                          font-mono text-[10.5px] text-fg outline-none focus:border-white/30"
                      />
                    ) : sinClave ? (
                      <span className="rounded border border-border px-1.5 py-px text-[8.5px] text-subtle">
                        no necesita
                      </span>
                    ) : compartida ? (
                      <span className="rounded border border-white/[.28] px-1.5 py-px text-[8.5px] text-fg">
                        compartida con el mapa
                      </span>
                    ) : hay[o] ? (
                      <span className="rounded border border-white/[.28] px-1.5 py-px text-[8.5px] text-fg">
                        configurada
                      </span>
                    ) : (
                      <span className="rounded border border-warning/40 px-1.5 py-px text-[8.5px] text-warning-fg">
                        sin configurar
                      </span>
                    )}
                  </td>
                  <td className="py-2 font-mono text-[10.5px] text-muted">
                    {puesta ? LIMITES[o] : "—"}
                  </td>
                  <td className={`py-2 text-right font-mono text-[10.5px] ${PRECIO[o] ? "text-warning-fg" : "text-subtle"}`}>
                    {PRECIO[o] ?? "gratis"}
                  </td>
                  <td className="py-2 text-right">
                    {!sinClave && editando !== o && (
                      <button
                        onClick={() => { setEditando(o); setValor(""); }}
                        className="jg-press rounded-lg border border-white/15 px-[11px] py-[5px] text-[10.5px] text-fg"
                      >
                        {hay[o] || compartida ? "Cambiar" : "Añadir"}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {ORDEN.some((o) => !SIN_CLAVE.has(o) && !hay[o]) && (
          <p className="mt-[11px] text-[10.5px] leading-relaxed text-warning-fg">
            Lo que está sin clave <b className="font-normal">no aparece</b> en la capa de
            disponibilidad ni en la estimación. Mejor ausente que presente y reventando después de
            confirmar el gasto.
          </p>
        )}

        {error && <p className="mt-2.5 text-[11px] text-danger-fg">{error}</p>}

        <div className="mt-6 flex gap-3.5">
          <div className="flex-1 rounded-[10px] border border-border p-[15px_16px]">
            <div className="flex items-center">
              <span className="flex-1 text-[8.5px] uppercase tracking-[.13em] text-subtle">
                Tope mensual
              </span>
              <span className="font-mono text-[11px] text-fg">{eur(tope)}</span>
            </div>
            <div className="mt-[11px] h-1.5 overflow-hidden rounded-[3px] bg-elevated">
              <i className="block h-full bg-fg"
                style={{ width: `${tope ? Math.min(100, (gastado / tope) * 100) : 0}%` }} />
            </div>
            <div className="mt-2 flex">
              <span className="flex-1 text-[10.5px] text-subtle">gastado este mes</span>
              <span className="font-mono text-[11px] text-muted">{eur(gastado)}</span>
            </div>
            <p className="mt-[11px] text-[10.5px] leading-relaxed text-subtle">
              Solo cuenta lo que el proveedor <b className="font-normal text-fg">sirvió</b>. Una
              petición fallida no se cobra ni se apunta. Una fila por día y origen, y nada se borra.
            </p>
            <div className="mt-3 flex gap-2">
              <input
                value={topeTexto}
                onChange={(e) => setTopeTexto(e.target.value)}
                inputMode="decimal"
                aria-label="Tope mensual en euros"
                className="w-24 rounded border border-border bg-black/30 px-2 py-1
                  font-mono text-[10.5px] text-fg outline-none focus:border-white/30"
              />
              <button onClick={() => void guardarTope()}
                className="jg-press rounded-lg border border-white/15 px-[13px] py-[6px] text-[10.5px] text-fg">
                Cambiar el tope
              </button>
            </div>
          </div>

          <div className="flex-1 rounded-[10px] border border-border p-[15px_16px]">
            <p className="text-[8.5px] uppercase tracking-[.13em] text-subtle">Dónde va la clave</p>
            <p className="mt-2.5 text-[10.5px] leading-relaxed text-subtle">
              «Ningún secreto en una ruta» es una regla sobre <b className="font-normal text-fg">nuestras</b>{" "}
              URLs y sigue en pie. Mapillary acepta{" "}
              <span className="font-mono text-fg">Authorization: OAuth</span> y ahí se usa.
            </p>
            <p className="mt-2.5 text-[10.5px] leading-relaxed text-subtle">
              Flickr y Google Static <b className="font-normal text-fg">solo</b> aceptan la clave por
              parámetro de consulta: no hay cabecera que ofrezcan. No es un descuido nuestro, es lo
              único que el proveedor admite — y va escrito para que dentro de seis meses nadie lo lea
              como un olvido. Ninguna clave llega a un log: se redacta antes.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
```

Y los enlaces que faltan en `api.ts`:

```ts
  claveGuardar: (proveedor: string, clave: string) =>
    invoke<void>("clave_guardar", { proveedor, clave }),
  claveHay: (proveedor: string) => invoke<boolean>("clave_hay", { proveedor }),
  topeLeer: () => invoke<number>("tope_leer"),
  topeFijar: (eur: number) => invoke<void>("tope_fijar", { eur }),
  gastoMes: () => invoke<[number, [string, number, number][]]>("gasto_mes"),
```

- [ ] **Step 4: Ajustes con dos pestañas**

En `App.tsx`, el destino `ajustes` pasa de renderizar `ServicesPanel` directamente a
renderizar las dos pestañas:

```tsx
{destino === "ajustes" && saludo && (
  <div className="flex h-full flex-col">
    <div className="flex shrink-0 gap-1 border-b border-border px-6 pt-4">
      {(["servicios", "origenes"] as const).map((t) => (
        <button
          key={t}
          onClick={() => setPestana(t)}
          className={`rounded-t-lg px-3.5 py-2 text-[11.5px] transition-colors
            ${pestana === t ? "bg-white/[.07] text-fg" : "text-subtle hover:text-fg"}`}
        >
          {t === "servicios" ? "Servicios locales" : "Orígenes de red"}
        </button>
      ))}
    </div>
    <div className="min-h-0 flex-1">
      {pestana === "servicios" ? <ServicesPanel so={saludo.so} /> : <OriginsPanel />}
    </div>
  </div>
)}
```

con `const [pestana, setPestana] = useState<"servicios" | "origenes">("servicios");` arriba.

- [ ] **Step 5: Comprobar**

Run: `cd indexer && npx tsc -b --noEmit && npm run lint && npm run build`
Expected: sin errores.

- [ ] **Step 6: Comprobación final de todo**

```bash
cargo test --workspace && cargo clippy --workspace -- -D warnings && cd indexer && npm run build
```

- [ ] **Step 7: Commit**

```bash
git add indexer/src indexer/src-tauri/src/lib.rs
git commit -m "Ajustes de orígenes: claves, límites y el tope del mes"
```

---

## Qué NO cubre este plan, y hay que verificarlo a mano

Nada de lo de abajo se puede comprobar en CI, y el plan no finge lo contrario:

- **Las respuestas reales de los seis proveedores.** Los tests usan `Falso` y JSON fijo. La
  primera vez que se ejecute contra las APIs de verdad puede haber campos que no cuadren.
  Prueba manual con clave real, fuera de CI, tal como fija el spec §13.
- **La capa vectorial de Mapillary en el mapa.** Necesita ventana, token y conexión.
- **Que el gasto apuntado coincida con la factura del proveedor.** El libro registra lo que
  la aplicación contó como servido, que es una estimación fiel pero no una conciliación.
- **KartaView.** Este plan asume que `api.openstreetcam.org/1.0/list/nearby-photos/` sigue
  vivo, que es lo que la v1 confirmó en su momento. Si ha caído, el adaptador se queda sin
  origen y hay que decidir si se retira o se sustituye.

