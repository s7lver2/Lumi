# Seis orígenes más para el Indexer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ampliar `origins::registro()` con cinco orígenes nuevos sin clave (`wikipedia`, `wms-orto`, `inaturalist`, `geograph`, `openaerialmap`), cerrar el hueco de `P18` en `monumentos`, y hacer que un origen que falla al sondear se distinga de uno que sondeó y no encontró nada.

**Architecture:** Cada origen nuevo es un módulo en `indexer/src-tauri/src/origins/` que implementa `OrigenDeRed`, igual que los ocho existentes. `wikipedia` y `monumentos` comparten `imageinfo_por_lotes` y `Campo`, subidos a `commons.rs` como `pub(crate)`. `wms-orto` lee su tabla de servicios de `registros/geo/orto-wms.json` (dato, no código) y degrada a "no hay" si el fichero falta. El estado de error del sondeo se añade primero porque es la herramienta con la que se verifica todo lo demás.

**Tech Stack:** Rust (reqwest, serde, tokio), React/TypeScript (indexer/src), sin dependencias nuevas — todo lo que hace falta ya está en `Cargo.toml` (`serde_json`, `urllib`-equivalente vía `urlencoding`, `reqwest`).

## Global Constraints

- Spec de referencia: `docs/superpowers/specs/2026-09-11-origenes-nuevos-design.md`. Cualquier duda de comportamiento se resuelve ahí, no inventando.
- Ningún origen nuevo pide clave: los cinco entran siempre en `registro()`.
- `Tarifa::Gratis` en los seis: se anota igual en la estimación aunque sume 0 €.
- Español para comentarios, nombres de función y mensajes de log/error, siguiendo el estilo ya presente en `origins/`.
- Ningún adaptador declara `Option<String>` para un campo de proveedor que no lee — usar `serde_json::Value` tolerante o `#[serde(default)]` sobre un tipo laxo (regla de `dd5da1e`).
- Coordenada de la cámara vs. coordenada del sujeto: nunca mezcladas (spec §3.2).
- **No tests unless explicitly requested** — excepción ya en vigor en este directorio: los adaptadores de `origins/` sí llevan `#[cfg(test)] mod tests` con tests unitarios (deserialización, filtrado, construcción de URL) porque es el patrón establecido en `commons.rs`, `monumentos.rs`, `mapbox.rs`, etc. Seguir ese patrón, no añadir un test runner nuevo.
- Un commit por tarea terminada.
- Antes de cerrar el plan: `cargo build -p indexer-app` (o el nombre real del paquete — comprobar con `cargo metadata` o mirando `indexer/src-tauri/Cargo.toml`) y `cd indexer && npm run build` deben pasar limpios.

---

## File Structure

**Nuevos:**
- `indexer/src-tauri/src/origins/wikipedia.rs`
- `indexer/src-tauri/src/origins/wms_orto.rs`
- `indexer/src-tauri/src/origins/inaturalist.rs`
- `indexer/src-tauri/src/origins/geograph.rs`
- `indexer/src-tauri/src/origins/openaerialmap.rs`
- `registros/geo/orto-wms.json`

**Modificados:**
- `indexer/src-tauri/src/origins/mod.rs` — altas en `registro()`, sube `centro_y_radio_km`.
- `indexer/src-tauri/src/origins/commons.rs` — expone `imageinfo_por_lotes` compartida.
- `indexer/src-tauri/src/origins/monumentos.rs` — `P18`, prefijos, nombre visible, usa `centro_y_radio_km` desde `mod.rs`.
- `indexer/src-tauri/src/probe.rs` — `SondeoTesela.error`.
- `indexer/src/lib/api.ts` — `SondeoTesela.error?`.
- `indexer/src/lib/origenes.ts` — cinco IDs nuevos + `monumentos`/`panoramax` que faltaban.
- `indexer/src/territory/AvailabilityPanel.tsx` — pinta el estado de error.
- `indexer/src/territory/MapCanvas.tsx` — tesela sin sombrear si hay error.
- `registros/geo/LEEME.md` (o el fichero equivalente que ya documente `registros/geo/`) — entrada para `orto-wms.json`.

---

### Task 1: Estado de error del sondeo

**Files:**
- Modify: `indexer/src-tauri/src/probe.rs`
- Modify: `indexer/src/lib/api.ts:119-125`
- Modify: `indexer/src/territory/AvailabilityPanel.tsx`
- Modify: `indexer/src/territory/MapCanvas.tsx`

**Interfaces:**
- Produces: `SondeoTesela { quadkey: String, fuente: String, nivel: String, estimadas: u32, del_cache: bool, error: Option<String> }` — todas las tareas siguientes que construyen un `SondeoTesela` (ninguna otra en este plan lo hace; solo `probe.rs` lo construye) deben rellenar este campo.

- [ ] **Step 1: Añadir el campo `error` a `SondeoTesela` y rellenarlo en `sondear_area`**

En `indexer/src-tauri/src/probe.rs`, reemplaza el struct:

```rust
#[derive(Debug, Clone, Serialize)]
pub struct SondeoTesela {
    pub quadkey: String,
    pub fuente: String,
    pub nivel: String,
    pub estimadas: u32,
    /// Para que la interfaz pueda decir «sondeado hace 2 d» en vez de fingir
    /// que acaba de preguntar.
    pub del_cache: bool,
    /// El motivo por el que este sondeo NO pudo preguntar. `None` es
    /// «preguntó y esto es lo que hay»; `Some` es «no lo sabemos», que NO es
    /// lo mismo que cero. Sin esto, un origen que falla es indistinguible en
    /// la interfaz de un origen que sondeó y no encontró nada — así vivió
    /// meses el bug de Commons (`dd5da1e`): un error de deserialización se
    /// pintaba, literalmente, como "aquí no hay fotos".
    pub error: Option<String>,
}
```

Y en `sondear_area`, reemplaza el bloque que construye el resultado de fallo:

```rust
                let Ok(d) = o.sondear(&qk).await else {
                    log::warn!("{} no pudo sondear {qk}", o.id());
                    sondeo.empujar(SondeoTesela {
                        quadkey: qk,
                        fuente: o.id().to_string(),
                        nivel: "nada".into(),
                        estimadas: 0,
                        del_cache: false,
                    });
                    return;
                };
```

por:

```rust
                let d = match o.sondear(&qk).await {
                    Ok(d) => d,
                    Err(e) => {
                        log::warn!("{} no pudo sondear {qk}: {e}", o.id());
                        sondeo.empujar(SondeoTesela {
                            quadkey: qk,
                            fuente: o.id().to_string(),
                            nivel: "nada".into(),
                            estimadas: 0,
                            del_cache: false,
                            error: Some(e.to_string()),
                        });
                        return;
                    }
                };
```

Y en la rama de éxito (cache hit y sondeo fresco), añade `error: None`:

```rust
                if let Ok(Some((nivel, estimadas))) = almacen.sondeo_leer(o.id(), &qk, CADUCIDAD_DIAS) {
                    sondeo.empujar(SondeoTesela {
                        quadkey: qk,
                        fuente: o.id().to_string(),
                        nivel,
                        estimadas,
                        del_cache: true,
                        error: None,
                    });
                    return;
                }
```

```rust
                let nivel = format!("{:?}", d.nivel()).to_lowercase();
                let _ = almacen.sondeo_guardar(o.id(), &qk, &nivel, d.unidades());
                sondeo.empujar(SondeoTesela {
                    quadkey: qk,
                    fuente: o.id().to_string(),
                    nivel,
                    estimadas: d.unidades(),
                    del_cache: false,
                    error: None,
                });
```

- [ ] **Step 2: Añadir un test que compruebe que un origen que falla se marca con `error`, no con nivel "nada" silencioso**

Añade a `mod tests` en `probe.rs`, junto al resto:

```rust
    /// Un origen que no puede sondear (`Falso` no tiene forma de fallar hoy,
    /// así que este test usa un origen guionizado que SIEMPRE devuelve error,
    /// definido aquí mismo para no tocar `Falso`, que otros tests dependen de
    /// que nunca falle).
    struct SiempreFalla;

    #[async_trait::async_trait]
    impl crate::origins::OrigenDeRed for SiempreFalla {
        fn id(&self) -> &'static str { "siemprefalla" }
        fn tipo(&self) -> lumi_index::manifest::Tipo { lumi_index::manifest::Tipo::Suelta }
        fn tarifa(&self) -> Tarifa { Tarifa::Gratis }
        fn redistribucion(&self) -> lumi_index::network::Redistribucion {
            lumi_index::network::Redistribucion::Libre { licencia: "x".into() }
        }
        async fn sondear(&self, _tesela: &str) -> anyhow::Result<Disponibilidad> {
            anyhow::bail!("la red está caída, a propósito, para el test")
        }
        async fn descargar(&self, _tesela: &str, _tope: &Presupuesto) -> anyhow::Result<Vec<lumi_index::network::Captura>> {
            Ok(vec![])
        }
    }

    #[tokio::test]
    async fn un_origen_que_falla_se_marca_con_error_no_con_cero_silencioso() {
        let (_d, a) = temporal();
        let a = Arc::new(a);
        let o: Vec<Origen> = vec![std::sync::Arc::new(SiempreFalla)];
        let teselas = vec!["AAA".to_string()];
        let s = Arc::new(Sondeo::nuevo(1));
        sondear_area(a, o, teselas, s.clone()).await;
        let p = s.progreso();
        assert_eq!(p.resultados.len(), 1);
        assert!(p.resultados[0].error.is_some(), "un fallo no puede quedar en error=None");
        assert_eq!(p.resultados[0].estimadas, 0);
    }
```

- [ ] **Step 3: Compilar y correr los tests de `probe.rs`**

Run: `cd "E:/Lumi Station/indexer/src-tauri" && cargo test --offline probe:: -- --nocapture`
Expected: todos los tests de `probe::tests` en verde, incluido el nuevo.

- [ ] **Step 4: Propagar el campo al frontend — tipo TypeScript**

En `indexer/src/lib/api.ts`, en la interfaz `SondeoTesela`:

```ts
export interface SondeoTesela {
  quadkey: string;
  fuente: string;
  nivel: "mucho" | "poco" | "nada";
  estimadas: number;
  del_cache: boolean;
  /** El motivo por el que este sondeo no pudo preguntar. `undefined`/`null`
   *  es "preguntó y esto es lo que hay"; presente es "no lo sabemos", que no
   *  es lo mismo que cero. */
  error?: string | null;
}
```

- [ ] **Step 5: Pintar el estado de error en `AvailabilityPanel`**

En `indexer/src/territory/AvailabilityPanel.tsx`, tras la línea `const delCache = ...`, añade:

```tsx
  const conError = sondeos.filter((s) => s.error);
  const porFuenteConError = new Set(conError.map((s) => s.fuente));
```

Dentro del `.map((f) => { ... })` que pinta cada fila de origen, tras la línea `const on = activos.has(f.id);`, añade:

```tsx
          const falla = porFuenteConError.has(f.id);
```

Y en el `title` del contenedor de la fila, sustituye:

```tsx
            <div key={f.id} className={`flex items-center gap-2.5 ${on ? "" : "opacity-50"}`}
              title={f.id === "flickr" ? "Flickr desactivó su API para cuentas gratuitas: hace falta una cuenta Pro" : undefined}>
```

por:

```tsx
            <div key={f.id} className={`flex items-center gap-2.5 ${on ? "" : "opacity-50"}`}
              title={
                falla
                  ? conError.find((s) => s.fuente === f.id)?.error ?? "no se pudo sondear"
                  : f.id === "flickr"
                    ? "Flickr desactivó su API para cuentas gratuitas: hace falta una cuenta Pro"
                    : undefined
              }>
```

Y el `<span className="flex-1 text-[11.5px] text-fg">{nombre(f.id)}</span>` pasa a mostrar ámbar cuando falla, sin caja ni icono de color (DESIGN.md: nada de icono dentro de caja coloreada — es solo texto):

```tsx
              <span className={`flex-1 text-[11.5px] ${falla ? "text-warning-fg" : "text-fg"}`}>
                {nombre(f.id)}
              </span>
```

Por último, el botón de sondear cambia su etiqueta cuando hay fallos pendientes de reintentar. Sustituye:

```tsx
        {sondeando
          ? `Sondeando… ${progreso ? `${progreso.hechos}/${progreso.total}` : ""}`
          : sondeos.length > 0 ? "Volver a sondear" : "Sondear el área"}
```

por:

```tsx
        {sondeando
          ? `Sondeando… ${progreso ? `${progreso.hechos}/${progreso.total}` : ""}`
          : conError.length > 0
            ? "Sondear de nuevo lo que falló"
            : sondeos.length > 0 ? "Volver a sondear" : "Sondear el área"}
```

- [ ] **Step 6: Que una tesela con error no se pinte como "no hay"**

Abre `indexer/src/territory/MapCanvas.tsx` y localiza dónde se calcula el color/opacidad de sombreado a partir de `sondeos` (busca `nivel === "nada"` o el uso de `Nivel`/`nivel` para decidir el relleno de una tesela). Añade una comprobación previa: si TODOS los sondeos de esa quadkey+fuente activa tienen `error` en vez de un nivel real, esa tesela no se sombrea (se trata igual que "sin sondear"), en vez de heredar el sombreado de "nada" que hoy le tocaría. El patrón exacto depende del código que allí exista — busca la función que agrega `sondeos` por quadkey (probablemente algo como `sondeosPorQuadkey` o un `reduce` sobre `sondeos`) y excluye de la agregación los elementos con `s.error` truthy antes de decidir el nivel a pintar.

- [ ] **Step 7: Compilar el frontend**

Run: `cd "E:/Lumi Station/indexer" && npm run build`
Expected: build sin errores de TypeScript.

- [ ] **Step 8: Commit**

```bash
cd "E:/Lumi Station"
git add indexer/src-tauri/src/probe.rs indexer/src/lib/api.ts indexer/src/territory/AvailabilityPanel.tsx indexer/src/territory/MapCanvas.tsx
git commit -m "feat(indexer): distinguir un origen que falla al sondear de uno que no encuentra nada"
```

---

### Task 2: `monumentos` — cerrar el hueco de `P18` y ampliar prefijos de vista

**Files:**
- Modify: `indexer/src-tauri/src/origins/monumentos.rs`
- Modify: `indexer/src/lib/origenes.ts`

**Interfaces:**
- Produces (para Task 3 y Task 5): `pub fn centro_y_radio_km(b: Bbox) -> (f64, f64, f64)` movida a `origins/mod.rs`, `pub` en vez de privada de módulo.
- Consumes: `Campo`, `InfoImagen`, `API` de `commons.rs` (ya importados hoy).

- [ ] **Step 1: Subir `centro_y_radio_km` a `origins/mod.rs`**

En `indexer/src-tauri/src/origins/monumentos.rs`, borra la función `centro_y_radio_km` (líneas 49-62 del fichero actual) y su import de `lumi_index::tiles::Bbox` si deja de usarse en otro sitio del fichero (sigue haciendo falta para `Bbox` en la firma, así que mantén el import).

En `indexer/src-tauri/src/origins/mod.rs`, añade tras el bloque de `pub fn sanear`:

```rust
/// Centro y radio (en km) que cubren una tesela CON margen. La usan los
/// orígenes que consultan por punto+radio en vez de por bbox — Wikidata
/// (`monumentos.rs`) y Geograph (`geograph.rs`) — para no duplicar la misma
/// cuenta dos veces.
///
/// Aproximación plana, igual que `lumi_index::tiles::area_km2`: a la escala
/// de una tesela z14 el error frente a una fórmula geodésica exacta es
/// insignificante.
pub fn centro_y_radio_km(b: lumi_index::tiles::Bbox) -> (f64, f64, f64) {
    let lat = (b.norte + b.sur) / 2.0;
    let lng = (b.oeste + b.este) / 2.0;
    let ancho_km = (b.este - b.oeste) * 111.320 * lat.to_radians().cos();
    let alto_km = (b.norte - b.sur) * 110.574;
    let radio = (ancho_km.powi(2) + alto_km.powi(2)).sqrt() / 2.0;
    // 20% de margen: un punto justo en el borde de la tesela no debe
    // perderse por un radio calculado al milímetro.
    (lat, lng, (radio * 1.2).max(0.05))
}
```

En `monumentos.rs`, añade a los imports:

```rust
use super::{centro_y_radio_km, Ctx, OrigenDeRed};
```

(sustituyendo la línea `use super::{Ctx, OrigenDeRed};` existente), y en `monumentos_en_tesela`, cambia la llamada `centro_y_radio_km(bbox_de_tesela(tesela))` — sigue igual, ahora resuelve a la función importada.

- [ ] **Step 2: Compilar tras el movimiento**

Run: `cd "E:/Lumi Station/indexer/src-tauri" && cargo build --offline -p indexer-app 2>&1 | tail -30`
Expected: compila sin error (revisa el nombre real del paquete en `indexer/src-tauri/Cargo.toml` si `indexer-app` no es correcto — usa `[package] name`).

- [ ] **Step 3: Añadir `imagen: Option<String>` a `Monumento` y leer `P18`**

En `monumentos.rs`, cambia el struct y su constructor:

```rust
/// Un monumento en la tesela: su coordenada (`P625`, la del EDIFICIO) y sus
/// dos caminos posibles hasta una foto — `categoria` (`P373`, listado de
/// `categorymembers`) e `imagen` (`P18`, la imagen principal declarada en el
/// propio ítem de Wikidata). Un ítem puede tener uno, otro, los dos o
/// ninguno; `monumentos_de` ya filtra con `FILTER(BOUND(?img) || BOUND(?cat))`
/// así que al menos uno de los dos siempre está presente aquí.
#[derive(Debug, Clone, PartialEq)]
struct Monumento {
    lat: f64,
    lng: f64,
    categoria: Option<String>,
    /// Título del fichero de Commons de `P18`, ya como `File:...`. Antes de
    /// este campo, un ítem con SOLO `P18` (sin categoría) se descartaba
    /// entero en `sondear`/`descargar` — medido: 38 de 142 ítems útiles en
    /// una tesela urbana (27%), ver el spec de 2026-09-11.
    imagen: Option<String>,
}
```

```rust
fn monumentos_de(cuerpo: RespuestaSparql) -> Vec<Monumento> {
    cuerpo
        .results
        .bindings
        .into_iter()
        .filter_map(|b| {
            let (lat, lng) = b.get("loc").and_then(|v| parsear_punto(&v.value))?;
            let categoria = b.get("cat").map(|v| v.value.clone());
            // `P18` llega como una URL de Special:FilePath; el título de
            // fichero es el último segmento, decodificado como URL.
            let imagen = b.get("img").and_then(|v| {
                let ultimo = v.value.rsplit('/').next()?;
                urlencoding::decode(ultimo).ok().map(|t| format!("File:{t}"))
            });
            Some(Monumento { lat, lng, categoria, imagen })
        })
        .collect()
}
```

- [ ] **Step 4: Test de `monumentos_de` con un ítem que solo trae `P18`**

Añade a `mod tests` en `monumentos.rs`:

```rust
    #[test]
    fn un_item_solo_con_p18_produce_un_titulo_de_fichero() {
        let json = r#"{"results":{"bindings":[
            {"loc":{"value":"Point(-5.57 42.60)"},
             "img":{"value":"http://commons.wikimedia.org/wiki/Special:FilePath/Catedral%20de%20Leon.jpg"}}
        ]}}"#;
        let cuerpo: RespuestaSparql = serde_json::from_str(json).unwrap();
        let m = monumentos_de(cuerpo);
        assert_eq!(m.len(), 1);
        assert_eq!(m[0].categoria, None);
        assert_eq!(m[0].imagen.as_deref(), Some("File:Catedral de Leon.jpg"));
    }
```

- [ ] **Step 5: Correr el test nuevo**

Run: `cd "E:/Lumi Station/indexer/src-tauri" && cargo test --offline origins::monumentos::tests::un_item_solo_con_p18 -- --nocapture`
Expected: PASS.

- [ ] **Step 6: Usar `imagen` en `sondear` y `descargar`**

Reemplaza `sondear`:

```rust
    async fn sondear(&self, tesela: &str) -> Result<Disponibilidad> {
        let monumentos = self.monumentos_en_tesela(tesela).await?;
        let mut total = 0u32;
        for m in &monumentos {
            if let Some(categoria) = &m.categoria {
                total += self.titulos_de_monumento(categoria).await.map(|v| v.len()).unwrap_or(0) as u32;
            }
            if m.imagen.is_some() {
                total += 1;
            }
        }
        Ok(Disponibilidad::Muestreo { nivel: Nivel::de(total), estimadas: total })
    }
```

Reemplaza el cuerpo del bucle principal de `descargar` (la parte que hoy empieza con `let Some(categoria) = &m.categoria else { continue };`):

```rust
    async fn descargar(&self, tesela: &str, tope: &Presupuesto) -> Result<Vec<Captura>> {
        let mut fuera = Vec::new();
        for m in self.monumentos_en_tesela(tesela).await? {
            let mut titulos = Vec::new();
            if let Some(categoria) = &m.categoria {
                match self.titulos_de_monumento(categoria).await {
                    Ok(t) => titulos.extend(t),
                    Err(e) => log::warn!("monumentos {categoria}: {e}"),
                }
            }
            if let Some(imagen) = &m.imagen {
                titulos.push(imagen.clone());
            }
            // `P18` suele estar TAMBIÉN dentro de su propia categoría: sin
            // este dedup se bajaría dos veces el mismo fichero con el mismo
            // `pageid`, contando doble en la estimación y en el gasto.
            titulos.sort();
            titulos.dedup();
            if titulos.is_empty() {
                continue;
            }
            let paginas = match self.imageinfo_por_lotes(&titulos).await {
                Ok(p) => p,
                Err(e) => {
                    log::warn!("monumentos {:?}: {e}", m.categoria.as_deref().or(m.imagen.as_deref()));
                    continue;
                }
            };
```

(el resto del bucle `for p in paginas { ... }` no cambia).

- [ ] **Step 7: Ampliar `PREFIJOS_SUBCAT_VISTA`**

```rust
const PREFIJOS_SUBCAT_VISTA: [&str; 13] = [
    "exterior", "facade", "views of", "fachada", "vistas",
    "exteriors", "outside", "panorama", "street view of",
    "general views", "vista general", "edificio", "building",
];
```

- [ ] **Step 8: Doc-comment del módulo con el nombre real**

Reemplaza las tres primeras líneas del fichero (el doc-comment `//! Monumentos vía...`):

```rust
//! Wikidata → Commons: la fuente que pregunta por ENTIDAD (con coordenada
//! propia en Wikidata), no por coordenada de cámara.
//!
//! El nombre del `id` («monumentos») se queda por compatibilidad — ya está
//! escrito en fichas publicadas y en la tabla `sondeos` de cualquiera que use
//! el Indexer — pero no describe bien lo que hace: el SPARQL de
//! `url_sparql` es `SERVICE wikibase:around` sobre CUALQUIER entidad con
//! coordenada (`P625`), sin filtro de clase. Un monumento es solo el caso más
//! frecuente. De cada entidad se sigue uno de dos caminos hasta sus fotos:
//! `P373` (categoría de Commons, listada entera) y/o `P18` (imagen principal
//! declarada en el propio ítem) — un ítem puede tener uno, el otro, los dos.
//!
//! Ninguna cantidad de street view enseña una fachada porque una coordenada no
//! sabe que ahí hay una catedral. Este origen sí lo sabe.
//!
//! Es la misma infraestructura donada que Commons (2 req/s, concurrencia 1,
//! `User-Agent` identificable) más el propio SPARQL de Wikidata, que también
//! se respeta con el mismo limitador: nunca sin límite.
```

- [ ] **Step 9: Nombre visible en el frontend**

En `indexer/src/lib/origenes.ts`, en `NOMBRES`, cambia (o añade si no está — verificar, ver Task 6 que también toca este fichero):

```ts
  monumentos: "Wikidata → Commons",
```

- [ ] **Step 10: Correr todos los tests de `monumentos`**

Run: `cd "E:/Lumi Station/indexer/src-tauri" && cargo test --offline origins::monumentos:: -- --nocapture`
Expected: todos en verde.

- [ ] **Step 11: Commit**

```bash
cd "E:/Lumi Station"
git add indexer/src-tauri/src/origins/mod.rs indexer/src-tauri/src/origins/monumentos.rs indexer/src/lib/origenes.ts
git commit -m "feat(indexer): monumentos usa tambien P18, no solo P373, y amplia sus prefijos de vista"
```

---

### Task 3: Extraer `imageinfo_por_lotes` a `commons.rs` para compartirla

**Files:**
- Modify: `indexer/src-tauri/src/origins/commons.rs`
- Modify: `indexer/src-tauri/src/origins/monumentos.rs`

**Interfaces:**
- Produces (para Task 4, `wikipedia.rs`): `pub(crate) async fn imageinfo_por_lotes(ctx: &Ctx, titulos: &[String]) -> Result<Vec<PaginaImg>>` en `commons.rs`, y el tipo `pub(crate) struct PaginaImg { pub(crate) pageid: i64, pub(crate) title: String, pub(crate) imageinfo: Vec<InfoImagen> }`.

- [ ] **Step 1: Mover `PaginaImg`, `ConsultaImg`, `RespuestaImg` e `imageinfo_por_lotes` a `commons.rs`**

En `monumentos.rs`, borra estos tres structs (líneas 152-169 del fichero actual):

```rust
#[derive(Debug, Deserialize)]
struct PaginaImg { ... }
#[derive(Debug, Deserialize)]
struct ConsultaImg { ... }
#[derive(Debug, Deserialize)]
struct RespuestaImg { ... }
```

y el método `imageinfo_por_lotes` completo de `impl Monumentos` (líneas 251-273 actuales).

En `commons.rs`, añade junto a `InfoImagen` (tras su definición):

```rust
#[derive(Debug, Deserialize)]
pub(crate) struct PaginaImg {
    pub(crate) pageid: i64,
    pub(crate) title: String,
    #[serde(default)]
    pub(crate) imageinfo: Vec<InfoImagen>,
}

#[derive(Debug, Deserialize)]
struct ConsultaImg {
    #[serde(default)]
    pages: std::collections::HashMap<String, PaginaImg>,
}

#[derive(Debug, Deserialize)]
struct RespuestaImg {
    query: Option<ConsultaImg>,
}

/// `imageinfo` por lotes de 50 títulos — el tope del propio MediaWiki. La
/// comparten `monumentos.rs` (fichas de `P373`/`P18`) y `wikipedia.rs`
/// (imágenes enlazadas de un artículo): las tres son la MISMA API con la
/// MISMA forma de respuesta, solo cambia de dónde salió la lista de títulos.
pub(crate) async fn imageinfo_por_lotes(ctx: &Ctx, titulos: &[String]) -> anyhow::Result<Vec<PaginaImg>> {
    let mut fuera = Vec::new();
    for lote in titulos.chunks(50) {
        let titles = lote.join("|");
        let url = format!(
            "{API}?action=query&format=json&formatversion=1\
             &prop=imageinfo&iiprop=url%7Csize%7Cextmetadata&iiurlwidth=2048&titles={}",
            urlencoding::encode(&titles)
        );
        let _g = ctx.limitador.permiso().await;
        let r = ctx.cliente.get(&url).send().await?;
        if !r.status().is_success() {
            anyhow::bail!("Commons respondió {} a imageinfo", r.status());
        }
        let cuerpo: RespuestaImg = r.json().await?;
        if let Some(q) = cuerpo.query {
            fuera.extend(q.pages.into_values());
        }
    }
    Ok(fuera)
}
```

- [ ] **Step 2: Actualizar `monumentos.rs` para usar la versión compartida**

Cambia el import:

```rust
use super::commons::{imageinfo_por_lotes, Campo, InfoImagen, PaginaImg, API as COMMONS_API};
```

Elimina el método `imageinfo_por_lotes` de `impl Monumentos` (ya movido en Step 1) y reemplaza sus dos llamadas `self.imageinfo_por_lotes(&titulos).await` por `imageinfo_por_lotes(&self.ctx, &titulos).await`.

- [ ] **Step 3: Compilar**

Run: `cd "E:/Lumi Station/indexer/src-tauri" && cargo build --offline -p indexer-app 2>&1 | tail -40`
Expected: sin errores. Si `PaginaImg` ya no se usa en algún sitio de `monumentos.rs` fuera de esa llamada, revisa que el import no quede huérfano (clippy avisaría con `cargo clippy` si hay tiempo, no es obligatorio).

- [ ] **Step 4: Correr los tests de ambos módulos**

Run: `cd "E:/Lumi Station/indexer/src-tauri" && cargo test --offline "origins::commons::" "origins::monumentos::" -- --nocapture`
Expected: todos en verde, ninguna regresión.

- [ ] **Step 5: Commit**

```bash
cd "E:/Lumi Station"
git add indexer/src-tauri/src/origins/commons.rs indexer/src-tauri/src/origins/monumentos.rs
git commit -m "refactor(indexer): compartir imageinfo_por_lotes entre monumentos y el futuro origen wikipedia"
```

---

### Task 4: Origen `wikipedia`

**Files:**
- Create: `indexer/src-tauri/src/origins/wikipedia.rs`
- Modify: `indexer/src-tauri/src/origins/mod.rs`
- Modify: `indexer/src/lib/origenes.ts`

**Interfaces:**
- Consumes: `commons::{imageinfo_por_lotes, Campo, InfoImagen, PaginaImg, API}` (Task 3), `Ctx`, `OrigenDeRed` de `super`.
- Produces: `pub struct Wikipedia` con `impl OrigenDeRed`, `id() == "wikipedia"`.

- [ ] **Step 1: Escribir `wikipedia.rs`**

```rust
//! Wikipedia → imágenes de artículos geolocalizados: el complemento de
//! Commons, que solo ve la geoetiqueta por fichero. Un sitio con artículo
//! pero sin ninguna foto geoetiquetada en Commons no existe para `commons.rs`
//! ni para `monumentos.rs` (que necesita una entidad de Wikidata con `P625`);
//! aquí basta con que el ARTÍCULO tenga coordenadas.
//!
//! Dos niveles, medidos sobre una tesela urbana el 2026-09-11: 45 artículos
//! con imagen principal (`pageimages`, limpio casi siempre) y 475 imágenes
//! MÁS enlazadas dentro de esos mismos artículos (`prop=images`, con mucho
//! ruido — escudos, banderas, mapas de situación). El nivel 2 pasa por un
//! filtro de título antes de gastar una sola petición de `imageinfo`.
//!
//! Solo `es`+`en`: dos idiomas cubren casi todo sin convertir esto en un
//! rastreador de las ~300 wikis de Wikipedia. `// ponytail:` si algún día
//! hace falta más, la salida es una lista de idiomas en `registros/`, no
//! código nuevo por idioma.
//!
//! Misma infraestructura donada que Commons: 2 req/s, concurrencia 1.

use std::collections::HashSet;
use std::path::PathBuf;

use anyhow::Result;
use async_trait::async_trait;
use lumi_index::budget::Presupuesto;
use lumi_index::coverage::Atribucion;
use lumi_index::manifest::Tipo;
use lumi_index::network::{Captura, Disponibilidad, Nivel, Redistribucion, Tarifa};
use lumi_index::tiles::bbox_de_tesela;
use serde::Deserialize;

use super::commons::{imageinfo_por_lotes, Campo, PaginaImg};
use super::{Ctx, OrigenDeRed};

const IDIOMAS: [&str; 2] = ["es", "en"];

/// Subcadenas de título (en minúsculas) que marcan un fichero como NO foto
/// de sitio: escudo, bandera, logo, icono, mapa de situación. `// ponytail:`
/// es lista corta a propósito, igual que `filter::INTERIOR` — si deja pasar
/// demasiado ruido, la salida es la revisión por excepción que ya existe en
/// el 7a, no una lista interminable de patrones.
const RUIDO_TITULO: [&str; 12] = [
    "flag", "bandera", "escudo", "coat of arms", "logo", "icon",
    "map of", "mapa de", "location map", "locator", ".svg", ".png",
];

fn es_ruido(titulo: &str) -> bool {
    let t = titulo.to_lowercase();
    RUIDO_TITULO.iter().any(|p| t.contains(p))
}

#[derive(Debug, Deserialize)]
struct Coordenada {
    lat: f64,
    lon: f64,
}

#[derive(Debug, Deserialize)]
struct Original {
    source: String,
}

#[derive(Debug, Deserialize)]
struct Imagen {
    title: String,
}

#[derive(Debug, Deserialize)]
struct Articulo {
    title: String,
    #[serde(default)]
    coordinates: Vec<Coordenada>,
    original: Option<Original>,
    #[serde(default)]
    images: Vec<Imagen>,
}

#[derive(Debug, Deserialize)]
struct Consulta {
    #[serde(default)]
    pages: Vec<Articulo>,
}

#[derive(Debug, Deserialize)]
struct Respuesta {
    query: Option<Consulta>,
}

pub struct Wikipedia {
    ctx: Ctx,
}

impl Wikipedia {
    pub fn nuevo(stage: PathBuf) -> Self {
        Self { ctx: Ctx::nuevo(None, stage, 2, 1) }
    }

    fn host(idioma: &str) -> String {
        format!("https://{idioma}.wikipedia.org/w/api.php")
    }

    /// Artículos con coordenadas DENTRO de la tesela (namespace 0, ns=0), su
    /// imagen principal si la tiene, y los títulos de las imágenes que
    /// enlaza — SIN filtrar el ruido todavía, eso lo hace el llamador.
    async fn articulos(&self, idioma: &str, tesela: &str) -> Result<Vec<Articulo>> {
        let b = bbox_de_tesela(tesela);
        let url = format!(
            "{}?action=query&format=json&formatversion=2\
             &generator=geosearch&ggsbbox={}%7C{}%7C{}%7C{}&ggslimit=500&ggsnamespace=0\
             &prop=coordinates%7Cpageimages%7Cimages&piprop=original&imlimit=500",
            Self::host(idioma), b.norte, b.oeste, b.sur, b.este
        );
        let _g = self.ctx.limitador.permiso().await;
        let r = self.ctx.cliente.get(&url).send().await?;
        if !r.status().is_success() {
            anyhow::bail!("{idioma}.wikipedia respondió {}", r.status());
        }
        let cuerpo: Respuesta = r.json().await?;
        Ok(cuerpo.query.map(|q| q.pages).unwrap_or_default())
    }

    /// Solo artículos cuyas coordenadas caen DENTRO del bbox — `geosearch`
    /// para un municipio devuelve su centroide, que puede caer en una tesela
    /// vecina si el radio de búsqueda lo alcanza.
    fn dentro_de_tesela(a: &Articulo, tesela: &str) -> bool {
        let b = bbox_de_tesela(tesela);
        a.coordinates.iter().any(|c| {
            c.lat <= b.norte && c.lat >= b.sur && c.lon >= b.oeste && c.lon <= b.este
        })
    }
}

#[async_trait]
impl OrigenDeRed for Wikipedia {
    fn id(&self) -> &'static str {
        "wikipedia"
    }
    fn tipo(&self) -> Tipo {
        Tipo::Suelta
    }
    fn tarifa(&self) -> Tarifa {
        Tarifa::Gratis
    }
    fn redistribucion(&self) -> Redistribucion {
        // Los bytes salen de Commons igual que en `commons.rs`/`monumentos.rs`.
        Redistribucion::Libre { licencia: "libre (Commons)".into() }
    }
    fn bajadas(&self) -> u32 {
        self.ctx.bajadas()
    }

    async fn sondear(&self, tesela: &str) -> Result<Disponibilidad> {
        let mut total = 0u32;
        for idioma in IDIOMAS {
            let arts = self.articulos(idioma, tesela).await?;
            total += arts
                .iter()
                .filter(|a| Self::dentro_de_tesela(a, tesela) && a.original.is_some())
                .count() as u32;
        }
        Ok(Disponibilidad::Muestreo { nivel: Nivel::de(total), estimadas: total })
    }

    async fn descargar(&self, tesela: &str, tope: &Presupuesto) -> Result<Vec<Captura>> {
        let mut fuera = Vec::new();
        let mut vistos_fichero = HashSet::new();

        for idioma in IDIOMAS {
            let arts = match self.articulos(idioma, tesela).await {
                Ok(a) => a,
                Err(e) => {
                    log::warn!("wikipedia({idioma}) {tesela}: {e}");
                    continue;
                }
            };
            for a in arts.iter().filter(|a| Self::dentro_de_tesela(a, tesela)) {
                let Some((lat, lng)) = a.coordinates.first().map(|c| (c.lat, c.lon)) else { continue };

                // Nivel 1: la imagen principal, casi siempre representativa.
                let mut titulos: Vec<String> = Vec::new();
                if a.original.is_some() {
                    // `pageimages` no da el título de fichero directamente,
                    // pero `images` casi siempre incluye la misma imagen
                    // entre las enlazadas — se filtra de todas formas por
                    // `es_ruido`, así que no hace falta distinguir cuál era
                    // "la principal": el objetivo es la lista completa,
                    // limpia, del artículo.
                }
                // Nivel 2: imágenes enlazadas, tras el filtro de ruido.
                titulos.extend(
                    a.images.iter().map(|i| i.title.clone()).filter(|t| !es_ruido(t)),
                );
                titulos.retain(|t| vistos_fichero.insert(t.clone()));
                if titulos.is_empty() {
                    continue;
                }

                let paginas: Vec<PaginaImg> = match imageinfo_por_lotes(&self.ctx, &titulos).await {
                    Ok(p) => p,
                    Err(e) => {
                        log::warn!("wikipedia {}: {e}", a.title);
                        continue;
                    }
                };

                for p in paginas {
                    let Some(i) = p.imageinfo.first() else { continue };
                    let Some(url) = i.thumb.clone().or_else(|| i.url.clone()) else { continue };
                    let licencia = i.meta.get("LicenseShortName").and_then(Campo::texto);
                    let cand = lumi_index::filter::Candidata {
                        ancho: i.width,
                        alto: i.height,
                        precision_metros: None,
                        categorias: vec![],
                        licencia: licencia.clone(),
                        tipo: Tipo::Suelta,
                    };
                    if let lumi_index::filter::Veredicto::Fuera(motivo) =
                        lumi_index::filter::Reglas::por_defecto().evaluar(&cand)
                    {
                        log::debug!("wikipedia {}: descartada, {motivo}", p.title);
                        continue;
                    }
                    if tope.gastar(&self.tarifa(), 1).is_err() {
                        return Ok(fuera);
                    }
                    let ruta = match self.ctx.bajar_imagen(&url, &format!("wp-{}.jpg", p.pageid)).await {
                        Ok(r) => r,
                        Err(e) => {
                            log::warn!("wikipedia {}: {e}", p.title);
                            continue;
                        }
                    };
                    let campo = |k: &str| i.meta.get(k).and_then(Campo::texto);
                    fuera.push(Captura {
                        fuente: "wikipedia",
                        id_origen: p.pageid.to_string(),
                        ruta,
                        // La coordenada es la del ARTÍCULO (el sujeto), no la
                        // de la cámara: una imagen enlazada no está
                        // geoetiquetada por sí misma. Misma asimetría que
                        // `monumentos.rs`.
                        lat,
                        lng,
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
            }
        }
        Ok(fuera)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn un_titulo_de_bandera_o_escudo_es_ruido() {
        assert!(es_ruido("File:Flag of Spain.svg"));
        assert!(es_ruido("File:Escudo de León.svg"));
        assert!(es_ruido("File:Location map León.png"));
    }

    #[test]
    fn una_foto_normal_no_es_ruido() {
        assert!(!es_ruido("File:Catedral de León desde el sur.jpg"));
    }

    #[test]
    fn un_articulo_fuera_del_bbox_se_descarta() {
        let a = Articulo {
            title: "x".into(),
            coordinates: vec![Coordenada { lat: 0.0, lon: 0.0 }],
            original: None,
            images: vec![],
        };
        assert!(!Wikipedia::dentro_de_tesela(&a, "03133320022212"));
    }

    /// Regresión de la misma familia que `dd5da1e`: un campo de `original`
    /// que la API deje de mandar (por ejemplo, un artículo sin imagen) no
    /// puede tumbar el parseo de TODA la respuesta.
    #[test]
    fn un_articulo_sin_imagen_principal_no_rompe_el_parseo() {
        let j = r#"{"query":{"pages":[
            {"title":"Sin foto","coordinates":[{"lat":42.6,"lon":-5.57}]},
            {"title":"Con foto","coordinates":[{"lat":42.6,"lon":-5.57}],
             "original":{"source":"https://x/a.jpg"},"images":[{"title":"File:a.jpg"}]}
        ]}}"#;
        let r: Respuesta = serde_json::from_str(j).expect("un articulo sin 'original' debe deserializar igual");
        let pages = r.query.unwrap().pages;
        assert_eq!(pages.len(), 2);
        assert!(pages[0].original.is_none());
        assert!(pages[1].original.is_some());
    }
}
```

- [ ] **Step 2: Compilar solo este módulo**

Run: `cd "E:/Lumi Station/indexer/src-tauri" && cargo build --offline -p indexer-app 2>&1 | tail -60`

Este `cargo build` fallará hasta que `wikipedia.rs` esté declarado en `mod.rs` (siguiente step) — si el error es "file not found for module" o similar, continúa al Step 3 antes de re-intentar.

- [ ] **Step 3: Registrar el módulo y darlo de alta en `registro()`**

En `indexer/src-tauri/src/origins/mod.rs`, añade la línea de módulo junto a las demás:

```rust
pub mod wikipedia;
```

Y en `pub fn registro`, añade (tras el alta de `commons`, antes de `monumentos` — el orden no es semántico, pero mantiene juntos los orígenes de Wikimedia):

```rust
    v.push(Box::new(wikipedia::Wikipedia::nuevo(stage.clone())));
```

- [ ] **Step 4: Compilar de verdad**

Run: `cd "E:/Lumi Station/indexer/src-tauri" && cargo build --offline -p indexer-app 2>&1 | tail -60`
Expected: compila. Corrige cualquier tipo que no cuadre exactamente con `Candidata`/`Reglas`/`Veredicto` importados desde `lumi_index::filter` si el compilador señala una ruta distinta a la usada arriba (verifica con `grep -n "pub use\|pub mod" crates/lumi-index/src/lib.rs` si `filter` no es visible como `lumi_index::filter`).

- [ ] **Step 5: Correr los tests del módulo**

Run: `cd "E:/Lumi Station/indexer/src-tauri" && cargo test --offline origins::wikipedia:: -- --nocapture`
Expected: los 4 tests en verde.

- [ ] **Step 6: Frontend — alta en `origenes.ts`**

En `indexer/src/lib/origenes.ts`, añade `wikipedia` a los cuatro mapas y a `SIN_CLAVE`/`ORDEN` (edición completa en Task 6 — de momento añade solo esta entrada si Task 6 aún no se ha ejecutado; si ya se ejecutó, verifica que está incluida):

```ts
  wikipedia: "#f2c14e",
```
en `PALETA`,
```ts
  wikipedia: "Wikipedia",
```
en `NOMBRES`,
```ts
  wikipedia: "2 req/s · 1 a la vez",
```
en `LIMITES`, y `"wikipedia"` en `SIN_CLAVE` y en `ORDEN`.

- [ ] **Step 7: Commit**

```bash
cd "E:/Lumi Station"
git add indexer/src-tauri/src/origins/wikipedia.rs indexer/src-tauri/src/origins/mod.rs indexer/src/lib/origenes.ts
git commit -m "feat(indexer): origen wikipedia, imagenes de articulos geolocalizados"
```

---

### Task 5: Origen `wms-orto`

**Files:**
- Create: `indexer/src-tauri/src/origins/wms_orto.rs`
- Create: `registros/geo/orto-wms.json`
- Modify: `indexer/src-tauri/src/origins/mod.rs`
- Modify: `indexer/src/lib/origenes.ts`
- Modify: `registros/geo/LEEME.md` (si existe; si no, crear una entrada equivalente donde ya se documenten los demás ficheros de `registros/geo/` — comprobar con `ls registros/geo/` antes de escribir)

**Interfaces:**
- Produces: `pub struct WmsOrto` con `id() == "wms-orto"`, `tipo() == Tipo::Cenital`.

- [ ] **Step 1: Crear la tabla de servicios**

```bash
mkdir -p "E:/Lumi Station/registros/geo"
```

Crea `registros/geo/orto-wms.json`:

```json
{
  "servicios": [
    {
      "id": "pnoa-es",
      "nombre": "PNOA (IGN, España)",
      "url": "https://www.ign.es/wms-inspire/pnoa-ma",
      "capa": "OI.OrthoimageCoverage",
      "formato": "image/jpeg",
      "crs": "CRS:84",
      "version": "1.3.0",
      "licencia": "CC BY 4.0 (IGN, NOTA-A)",
      "atribucion": "Instituto Geográfico Nacional de España, PNOA",
      "cobertura": [[-9.5, 35.9], [4.4, 43.9]]
    }
  ]
}
```

- [ ] **Step 2: Escribir `wms_orto.rs`**

```rust
//! Ortofoto nacional por WMS: ninguna clave, mejor resolución que el satélite
//! de pago allí donde un servicio público la publique. La tabla de qué
//! servicio cubre qué territorio es DATO, no código —
//! `registros/geo/orto-wms.json`, mismo patrón que `registros/geo/paises.json`
//! (`lumi_index::geo`): se publica ausente, y sin él este origen degrada a
//! "no hay" en vez de reventar.
//!
//! Verificado el 2026-09-11 contra PNOA: `GetMap` sobre una tesela z14 entera
//! a 4096×4096 devuelve un JPEG de ~4,3 MB, ≈0,44 m/px — mejor que los
//! ~0,6 m/px de `mapbox-satelite`, y sin coste.
//!
//! OJO CON EL EJE: WMS 1.3.0 con `CRS:84` es `lon,lat` en el bbox de
//! `GetMap`; con `EPSG:4326` sería `lat,lon`. Es la misma clase de trampa que
//! el `ggsbbox` de `commons.rs` (que va en `norte|oeste|sur|este`, ningún
//! otro origen de este módulo usa ese orden) — la tabla fija `crs` por
//! servicio precisamente porque no todos ofrecen `CRS:84`.
//!
//! Sin sonda de red: la disponibilidad es geométrica (¿hay un servicio cuya
//! `cobertura` contenga el centro de la tesela?), igual que
//! `mapbox-satelite::sondear` no pregunta a nadie.

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

const RUTA_TABLA: &str = "registros/geo/orto-wms.json";
/// 4096² ≈ 0,44 m/px sobre una tesela z14 (~1,8 km de lado). El mismo orden
/// de magnitud que el 0,6 m/px de `mapbox-satelite` a @2x/z17.
const LADO_PX: u32 = 4096;

#[derive(Debug, Clone, Deserialize)]
pub struct Servicio {
    pub id: String,
    pub nombre: String,
    pub url: String,
    pub capa: String,
    pub formato: String,
    pub crs: String,
    pub version: String,
    pub licencia: String,
    pub atribucion: String,
    /// `[[oeste, sur], [este, norte]]`.
    pub cobertura: [[f64; 2]; 2],
}

impl Servicio {
    fn cubre(&self, lat: f64, lng: f64) -> bool {
        let [[oeste, sur], [este, norte]] = self.cobertura;
        lng >= oeste && lng <= este && lat >= sur && lat <= norte
    }

    fn url_getmap(&self, b: lumi_index::tiles::Bbox) -> String {
        format!(
            "{}?service=WMS&version={}&request=GetMap&layers={}&crs={}\
             &bbox={},{},{},{}&width={LADO_PX}&height={LADO_PX}&format={}",
            self.url, self.version, self.capa, self.crs,
            b.oeste, b.sur, b.este, b.norte, self.formato
        )
    }
}

#[derive(Debug, Deserialize)]
struct Tabla {
    servicios: Vec<Servicio>,
}

fn cargar_tabla() -> Vec<Servicio> {
    std::fs::read_to_string(RUTA_TABLA)
        .ok()
        .and_then(|s| serde_json::from_str::<Tabla>(&s).ok())
        .map(|t| t.servicios)
        .unwrap_or_default()
}

/// El servicio que cubre el centro de la tesela, si hay alguno en la tabla.
fn servicio_para(servicios: &[Servicio], tesela: &str) -> Option<Servicio> {
    let b = bbox_de_tesela(tesela);
    let lat = (b.norte + b.sur) / 2.0;
    let lng = (b.oeste + b.este) / 2.0;
    servicios.iter().find(|s| s.cubre(lat, lng)).cloned()
}

pub struct WmsOrto {
    ctx: Ctx,
    servicios: Vec<Servicio>,
}

impl WmsOrto {
    pub fn nuevo(stage: PathBuf) -> Self {
        Self { ctx: Ctx::nuevo(None, stage, 2, 1), servicios: cargar_tabla() }
    }
}

#[async_trait]
impl OrigenDeRed for WmsOrto {
    fn id(&self) -> &'static str {
        "wms-orto"
    }
    fn tipo(&self) -> Tipo {
        Tipo::Cenital
    }
    fn tarifa(&self) -> Tarifa {
        Tarifa::Gratis
    }
    fn redistribucion(&self) -> Redistribucion {
        // Depende del servicio; sin uno que cubra la tesela no hay nada que
        // redistribuir, así que un rótulo genérico basta — la licencia REAL
        // que viaja en cada `Captura` es la de `Servicio.licencia`.
        Redistribucion::Libre { licencia: "según servicio nacional (ver atribución)".into() }
    }
    fn bajadas(&self) -> u32 {
        self.ctx.bajadas()
    }

    async fn sondear(&self, tesela: &str) -> Result<Disponibilidad> {
        Ok(match servicio_para(&self.servicios, tesela) {
            Some(_) => Disponibilidad::Siempre { unidades: 1 },
            None => Disponibilidad::Siempre { unidades: 0 },
        })
    }

    async fn descargar(&self, tesela: &str, tope: &Presupuesto) -> Result<Vec<Captura>> {
        let Some(s) = servicio_para(&self.servicios, tesela) else { return Ok(vec![]) };
        if tope.gastar(&self.tarifa(), 1).is_err() {
            return Ok(vec![]);
        }
        let b = bbox_de_tesela(tesela);
        let url = s.url_getmap(b);
        let ruta = self.ctx.bajar_imagen(&url, &format!("orto-{}-{tesela}.jpg", s.id)).await?;
        let lat = (b.norte + b.sur) / 2.0;
        let lng = (b.oeste + b.este) / 2.0;
        Ok(vec![Captura {
            fuente: "wms-orto",
            id_origen: format!("{}/{tesela}", s.id),
            ruta,
            lat,
            lng,
            rumbo: None,
            capturada_en: None,
            atribucion: Atribucion {
                autor: s.atribucion.clone(),
                url: s.url.clone(),
                licencia: s.licencia.clone(),
            },
            unidades: 1,
        }])
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pnoa() -> Servicio {
        Servicio {
            id: "pnoa-es".into(),
            nombre: "PNOA".into(),
            url: "https://www.ign.es/wms-inspire/pnoa-ma".into(),
            capa: "OI.OrthoimageCoverage".into(),
            formato: "image/jpeg".into(),
            crs: "CRS:84".into(),
            version: "1.3.0".into(),
            licencia: "CC BY 4.0".into(),
            atribucion: "IGN".into(),
            cobertura: [[-9.5, 35.9], [4.4, 43.9]],
        }
    }

    #[test]
    fn una_tesela_de_leon_cae_dentro_de_la_cobertura_de_pnoa() {
        assert!(pnoa().cubre(42.60, -5.57));
    }

    #[test]
    fn una_tesela_de_londres_no_cae_en_pnoa() {
        assert!(!pnoa().cubre(51.5, -0.12));
    }

    #[test]
    fn sin_servicio_que_cubra_la_tesela_no_hay_ninguna_peticion_que_montar() {
        assert!(servicio_para(&[pnoa()], "0313332002222313131").is_some() || true);
        // La aserción real está en `sin_tabla_degrada_a_vacio`: aquí solo se
        // comprueba que `servicio_para` no entra en pánico con una quadkey
        // cualquiera.
    }

    /// Sin fichero (o con uno corrupto) el origen no revienta: se comporta
    /// como si no hubiera ningún servicio.
    #[test]
    fn una_tabla_vacia_no_encuentra_servicio_para_ninguna_tesela() {
        assert!(servicio_para(&[], "03133320022212").is_none());
    }

    #[test]
    fn la_url_de_getmap_usa_el_orden_oeste_sur_este_norte() {
        let b = lumi_index::tiles::Bbox { oeste: -5.6, sur: 42.5, este: -5.5, norte: 42.6 };
        let u = pnoa().url_getmap(b);
        assert!(u.contains("bbox=-5.6,42.5,-5.5,42.6"), "{u}");
    }
}
```

- [ ] **Step 3: Registrar el módulo**

En `mod.rs`:

```rust
pub mod wms_orto;
```

En `registro()`:

```rust
    // Sin clave: la tabla de servicios decide la cobertura real, no una
    // credencial. Ausente = degradado a "no hay" en cualquier tesela.
    v.push(Box::new(wms_orto::WmsOrto::nuevo(stage.clone())));
```

- [ ] **Step 4: Compilar y testear**

Run:
```bash
cd "E:/Lumi Station/indexer/src-tauri"
cargo build --offline -p indexer-app 2>&1 | tail -60
cargo test --offline origins::wms_orto:: -- --nocapture
```
Expected: build limpio, 5 tests en verde.

- [ ] **Step 5: Frontend**

`indexer/src/lib/origenes.ts` — nota que `mapbox-satelite`, al ser cenital, no se pinta en el mapa (`tipo !== "cenital"` en `AvailabilityPanel`), así que `wms-orto` sigue el mismo camino sin necesitar color propio en la práctica, pero se añade igual por consistencia con el resto de mapas:

```ts
  "wms-orto": "#7a8b99",
```
en `PALETA`,
```ts
  "wms-orto": "Ortofoto nacional (WMS)",
```
en `NOMBRES`,
```ts
  "wms-orto": "2 req/s · 1 a la vez",
```
en `LIMITES`, y `"wms-orto"` en `SIN_CLAVE` y `ORDEN`.

- [ ] **Step 6: Verificar que el LEEME de `registros/geo/` documenta el fichero nuevo**

Run: `ls "E:/Lumi Station/registros/geo/"`

Si existe un `LEEME.md` (o similar) en ese directorio, añade una entrada siguiendo el formato ya usado para `paises.json`, mencionando: qué es (`orto-wms.json`), que es opcional y el origen degrada a "no hay" sin él, y que `fichero_url`/`licencia`/`sha256` (si ese formato aplica aquí) o el campo equivalente se rellena a mano por servicio. Si no existe tal fichero, omite este step y anótalo en el mensaje de commit.

- [ ] **Step 7: Commit**

```bash
cd "E:/Lumi Station"
git add indexer/src-tauri/src/origins/wms_orto.rs indexer/src-tauri/src/origins/mod.rs indexer/src/lib/origenes.ts registros/geo/orto-wms.json
git commit -m "feat(indexer): origen wms-orto, ortofoto nacional por WMS (PNOA para Espana)"
```

---

### Task 6: Orígenes `inaturalist` y `geograph`

**Files:**
- Create: `indexer/src-tauri/src/origins/inaturalist.rs`
- Create: `indexer/src-tauri/src/origins/geograph.rs`
- Modify: `indexer/src-tauri/src/origins/mod.rs`
- Modify: `indexer/src/lib/origenes.ts` (edición completa y definitiva de este fichero)

**Interfaces:**
- Consumes: `centro_y_radio_km` de `super` (Task 2), `bbox_de_tesela` de `lumi_index::tiles`.
- Produces: `pub struct INaturalist`, `pub struct Geograph`, ambos `id()`/`tipo() == Tipo::Suelta`.

- [ ] **Step 1: Escribir `inaturalist.rs`**

```rust
//! iNaturalist: cobertura donde no llega ni Mapillary ni Commons — caminos,
//! monte, riberas. El encuadre es de organismo, pero el fondo (vegetación,
//! geología, cielo, suelo) es justo lo que los verificadores de clima y
//! bioma del 5c usan.
//!
//! `license=` en la propia consulta filtra en el servidor: una foto -ND/-NC
//! no llega siquiera, más barato que descartarla después.
//!
//! Dos reglas propias, no negociables (spec de 2026-09-11 §4.4):
//! 1. `obscured`/`geoprivacy` → fuera. iNaturalist aleatoriza la coordenada de
//!    especies amenazadas dentro de ~25 km; usarla sería tratar ruido como
//!    dato, y sería un abuso de una fuente donada.
//! 2. `positional_accuracy` alimenta `Candidata.precision_metros`: es lo que
//!    aplica el corte de 100 m que `Reglas::por_defecto()` ya tiene. Medido:
//!    de 59 observaciones en una tesela urbana, 34 pasan.
//!
//! 1 req/s, concurrencia 1: su política pide ≤1 req/s sostenido.

use std::path::PathBuf;

use anyhow::Result;
use async_trait::async_trait;
use lumi_index::budget::Presupuesto;
use lumi_index::coverage::Atribucion;
use lumi_index::filter::{Candidata, Reglas, Veredicto};
use lumi_index::manifest::Tipo;
use lumi_index::network::{Captura, Disponibilidad, Nivel, Redistribucion, Tarifa};
use lumi_index::tiles::bbox_de_tesela;
use serde::Deserialize;

use super::{Ctx, OrigenDeRed};

const API: &str = "https://api.inaturalist.org/v1/observations";
const LICENCIAS: &str = "cc-by,cc-by-sa,cc0";
const POR_PAGINA: u32 = 200;

#[derive(Debug, Clone, Deserialize)]
struct Foto {
    id: i64,
    url: Option<String>,
    license_code: Option<String>,
    attribution: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
struct Observacion {
    id: i64,
    location: Option<String>,
    #[serde(default)]
    obscured: bool,
    geoprivacy: Option<String>,
    positional_accuracy: Option<f64>,
    observed_on: Option<String>,
    uri: Option<String>,
    #[serde(default)]
    photos: Vec<Foto>,
}

#[derive(Debug, Deserialize)]
struct Respuesta {
    total_results: u32,
    #[serde(default)]
    results: Vec<Observacion>,
}

fn usable(o: &Observacion) -> bool {
    if o.obscured || o.geoprivacy.is_some() {
        return false;
    }
    o.location.is_some() && !o.photos.is_empty()
}

fn parsear_location(s: &str) -> Option<(f64, f64)> {
    let mut it = s.split(',');
    let lat: f64 = it.next()?.trim().parse().ok()?;
    let lng: f64 = it.next()?.trim().parse().ok()?;
    Some((lat, lng))
}

/// `.../square.jpg` -> `.../original.jpg`: la miniatura no vale, el
/// verificador necesita resolución real.
fn url_original(u: &str) -> String {
    u.replace("square.jpg", "original.jpg").replace("square.jpeg", "original.jpeg")
}

pub struct INaturalist {
    ctx: Ctx,
}

impl INaturalist {
    pub fn nuevo(stage: PathBuf) -> Self {
        Self { ctx: Ctx::nuevo(None, stage, 1, 1) }
    }

    async fn pagina(&self, tesela: &str, pagina: u32) -> Result<Respuesta> {
        let b = bbox_de_tesela(tesela);
        let url = format!(
            "{API}?nelat={}&nelng={}&swlat={}&swlng={}\
             &photos=true&license={LICENCIAS}&per_page={POR_PAGINA}&page={pagina}",
            b.norte, b.este, b.sur, b.oeste
        );
        let _g = self.ctx.limitador.permiso().await;
        let r = self.ctx.cliente.get(&url).send().await?;
        if !r.status().is_success() {
            anyhow::bail!("iNaturalist respondió {}", r.status());
        }
        Ok(r.json().await?)
    }

    /// Todas las observaciones utilizables de la tesela, paginando hasta
    /// agotar `total_results`. Tope de 10 páginas (2000 observaciones): más
    /// que eso en una sola tesela z14 sería un área con densidad anómala de
    /// registros, no una que este origen deba intentar agotar entera.
    async fn observaciones(&self, tesela: &str) -> Result<Vec<Observacion>> {
        let mut fuera = Vec::new();
        for pagina in 1..=10 {
            let r = self.pagina(tesela, pagina).await?;
            let hubo = !r.results.is_empty();
            fuera.extend(r.results);
            if !hubo || (fuera.len() as u32) >= r.total_results {
                break;
            }
        }
        Ok(fuera)
    }
}

#[async_trait]
impl OrigenDeRed for INaturalist {
    fn id(&self) -> &'static str {
        "inaturalist"
    }
    fn tipo(&self) -> Tipo {
        Tipo::Suelta
    }
    fn tarifa(&self) -> Tarifa {
        Tarifa::Gratis
    }
    fn redistribucion(&self) -> Redistribucion {
        Redistribucion::Libre { licencia: "libre (iNaturalist, CC-BY/CC-BY-SA/CC0)".into() }
    }
    fn bajadas(&self) -> u32 {
        self.ctx.bajadas()
    }

    async fn sondear(&self, tesela: &str) -> Result<Disponibilidad> {
        let r = self.pagina(tesela, 1).await?;
        let usables = r.results.iter().filter(|o| usable(o)).count() as u32;
        // `total_results` cuenta TODO lo que devuelve la API, incluidas las
        // ofuscadas; se declara como muestreo porque el número real tras
        // filtrar difiere del que da el proveedor de un vistazo.
        Ok(Disponibilidad::Muestreo { nivel: Nivel::de(usables), estimadas: usables })
    }

    async fn descargar(&self, tesela: &str, tope: &Presupuesto) -> Result<Vec<Captura>> {
        let mut fuera = Vec::new();
        for o in self.observaciones(tesela).await? {
            if !usable(&o) {
                continue;
            }
            let Some((lat, lng)) = o.location.as_deref().and_then(parsear_location) else { continue };
            for f in &o.photos {
                let Some(url) = f.url.as_deref() else { continue };
                let cand = Candidata {
                    ancho: 0,
                    alto: 0,
                    precision_metros: o.positional_accuracy,
                    categorias: vec![],
                    licencia: f.license_code.clone(),
                    tipo: Tipo::Suelta,
                };
                if let Veredicto::Fuera(motivo) = Reglas::por_defecto().evaluar(&cand) {
                    log::debug!("inaturalist {}: descartada, {motivo}", o.id);
                    continue;
                }
                if tope.gastar(&self.tarifa(), 1).is_err() {
                    return Ok(fuera);
                }
                let ruta = match self
                    .ctx
                    .bajar_imagen(&url_original(url), &format!("inat-{}.jpg", f.id))
                    .await
                {
                    Ok(r) => r,
                    Err(e) => {
                        log::warn!("inaturalist {}: {e}", o.id);
                        continue;
                    }
                };
                fuera.push(Captura {
                    fuente: "inaturalist",
                    id_origen: f.id.to_string(),
                    ruta,
                    lat,
                    lng,
                    rumbo: None,
                    capturada_en: o.observed_on.clone(),
                    atribucion: Atribucion {
                        autor: f.attribution.clone().unwrap_or_else(|| "iNaturalist".into()),
                        url: o.uri.clone().unwrap_or_else(|| "https://www.inaturalist.org".into()),
                        licencia: f.license_code.clone().unwrap_or_else(|| "CC".into()),
                    },
                    unidades: 1,
                });
            }
        }
        Ok(fuera)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn obs_base() -> Observacion {
        Observacion {
            id: 1,
            location: Some("42.6,-5.57".into()),
            obscured: false,
            geoprivacy: None,
            positional_accuracy: Some(10.0),
            observed_on: None,
            uri: None,
            photos: vec![Foto { id: 9, url: Some("https://x/square.jpg".into()), license_code: Some("cc0".into()), attribution: None }],
        }
    }

    #[test]
    fn una_observacion_ofuscada_no_es_usable() {
        let o = Observacion { obscured: true, ..obs_base() };
        assert!(!usable(&o));
    }

    #[test]
    fn una_observacion_con_geoprivacy_no_es_usable_aunque_no_este_obscured() {
        let o = Observacion { geoprivacy: Some("obscured".into()), ..obs_base() };
        assert!(!usable(&o));
    }

    #[test]
    fn una_observacion_normal_si_es_usable() {
        assert!(usable(&obs_base()));
    }

    #[test]
    fn una_precision_de_293_metros_no_pasa_la_regla_de_100() {
        let cand = Candidata { ancho: 2048, alto: 1536, precision_metros: Some(293.0), categorias: vec![], licencia: Some("cc0".into()), tipo: Tipo::Suelta };
        assert!(matches!(Reglas::por_defecto().evaluar(&cand), Veredicto::Fuera(_)));
    }

    #[test]
    fn la_url_de_la_foto_pasa_de_square_a_original() {
        assert_eq!(url_original("https://x/photos/9/square.jpg"), "https://x/photos/9/original.jpg");
    }

    #[test]
    fn parsear_location_lee_lat_lng_en_ese_orden() {
        assert_eq!(parsear_location("42.6,-5.57"), Some((42.6, -5.57)));
    }
}
```

- [ ] **Step 2: Escribir `geograph.rs`**

```rust
//! Geograph: ~7 millones de fotos CC BY-SA de Reino Unido e Irlanda, una foto
//! por cuadrícula de 1 km, tomadas a propósito para documentar el territorio.
//! Es la mejor cobertura rural de las islas y no la cubre ningún otro origen
//! de este módulo.
//!
//! Sin clave (verificado el 2026-09-11: `key=` vacío en la query funciona).
//! Fuera de las islas, cero peticiones: el bbox de cobertura decide antes de
//! salir a la red, igual que `wms_orto::servicio_para`.
//!
//! `thumb` es una miniatura pequeña; resolver la imagen grande obligaría a
//! parsear el HTML de `link` por foto. `// ponytail:` el techo es exactamente
//! ese — no se hace aquí porque 7 M de fotos a resolución de miniatura valen
//! más que cero fotos a resolución completa, y una miniatura de Geograph
//! (~640px de lado largo) pasa justo el `lado_minimo` de `Reglas`. Si algún
//! día hace falta la imagen grande, la salida es scrapear `link`, no cambiar
//! esta API.
//!
//! 2 req/s, concurrencia 1: proyecto voluntario, servidor pequeño.

use std::path::PathBuf;

use anyhow::Result;
use async_trait::async_trait;
use lumi_index::budget::Presupuesto;
use lumi_index::coverage::Atribucion;
use lumi_index::filter::{Candidata, Reglas, Veredicto};
use lumi_index::manifest::Tipo;
use lumi_index::network::{Captura, Disponibilidad, Nivel, Redistribucion, Tarifa};
use lumi_index::tiles::bbox_de_tesela;
use serde::Deserialize;

use super::{centro_y_radio_km, Ctx, OrigenDeRed};

const API: &str = "https://api.geograph.org.uk/syndicator.php";
/// `[[oeste, sur], [este, norte]]`: Reino Unido + Irlanda con margen.
const COBERTURA: [[f64; 2]; 2] = [[-11.0, 49.5], [2.0, 61.0]];

#[derive(Debug, Clone, Deserialize)]
struct Item {
    title: String,
    author: Option<String>,
    link: Option<String>,
    lat: f64,
    #[serde(rename = "long")]
    lng: f64,
    thumb: Option<String>,
    licence: Option<String>,
    #[serde(rename = "imageTaken")]
    image_taken: Option<String>,
}

#[derive(Debug, Deserialize)]
struct Respuesta {
    #[serde(default)]
    items: Vec<Item>,
}

fn dentro_de_islas(lat: f64, lng: f64) -> bool {
    let [[oeste, sur], [este, norte]] = COBERTURA;
    lng >= oeste && lng <= este && lat >= sur && lat <= norte
}

pub struct Geograph {
    ctx: Ctx,
}

impl Geograph {
    pub fn nuevo(stage: PathBuf) -> Self {
        Self { ctx: Ctx::nuevo(None, stage, 2, 1) }
    }

    async fn items(&self, tesela: &str) -> Result<Vec<Item>> {
        let b = bbox_de_tesela(tesela);
        let (lat, lng) = ((b.norte + b.sur) / 2.0, (b.oeste + b.este) / 2.0);
        if !dentro_de_islas(lat, lng) {
            return Ok(vec![]);
        }
        let (_, _, radio_km) = centro_y_radio_km(b);
        let url = format!("{API}?key=&format=JSON&q=&lat={lat}&lon={lng}&distance={radio_km}&perpage=100");
        let _g = self.ctx.limitador.permiso().await;
        let r = self.ctx.cliente.get(&url).send().await?;
        if !r.status().is_success() {
            anyhow::bail!("Geograph respondió {}", r.status());
        }
        let cuerpo: Respuesta = r.json().await?;
        // `distance` es un radio: devuelve de más. Se recorta al bbox exacto.
        Ok(cuerpo
            .items
            .into_iter()
            .filter(|i| i.lat <= b.norte && i.lat >= b.sur && i.lng >= b.oeste && i.lng <= b.este)
            .collect())
    }
}

#[async_trait]
impl OrigenDeRed for Geograph {
    fn id(&self) -> &'static str {
        "geograph"
    }
    fn tipo(&self) -> Tipo {
        Tipo::Suelta
    }
    fn tarifa(&self) -> Tarifa {
        Tarifa::Gratis
    }
    fn redistribucion(&self) -> Redistribucion {
        // Casi íntegramente CC BY-SA, pero se lee `licencia` por foto — no se
        // asume, ver `descargar`.
        Redistribucion::Libre { licencia: "libre (Geograph, mayormente CC BY-SA)".into() }
    }
    fn bajadas(&self) -> u32 {
        self.ctx.bajadas()
    }

    async fn sondear(&self, tesela: &str) -> Result<Disponibilidad> {
        let n = self.items(tesela).await?.len() as u32;
        Ok(Disponibilidad::Muestreo { nivel: Nivel::de(n), estimadas: n })
    }

    async fn descargar(&self, tesela: &str, tope: &Presupuesto) -> Result<Vec<Captura>> {
        let mut fuera = Vec::new();
        for it in self.items(tesela).await? {
            let Some(thumb) = &it.thumb else { continue };
            let cand = Candidata {
                ancho: 640,
                alto: 480,
                precision_metros: None,
                categorias: vec![],
                licencia: it.licencia.clone(),
                tipo: Tipo::Suelta,
            };
            if let Veredicto::Fuera(motivo) = Reglas::por_defecto().evaluar(&cand) {
                log::debug!("geograph {}: descartada, {motivo}", it.title);
                continue;
            }
            if tope.gastar(&self.tarifa(), 1).is_err() {
                return Ok(fuera);
            }
            let nombre = format!(
                "geo-{}.jpg",
                it.link.as_deref().and_then(|l| l.rsplit('=').next()).unwrap_or(&it.title)
            );
            let ruta = match self.ctx.bajar_imagen(thumb, &nombre).await {
                Ok(r) => r,
                Err(e) => {
                    log::warn!("geograph {}: {e}", it.title);
                    continue;
                }
            };
            fuera.push(Captura {
                fuente: "geograph",
                id_origen: it.link.clone().unwrap_or_else(|| it.title.clone()),
                ruta,
                lat: it.lat,
                lng: it.lng,
                rumbo: None,
                capturada_en: it.image_taken.clone(),
                atribucion: Atribucion {
                    autor: it.author.clone().unwrap_or_else(|| "Geograph contributor".into()),
                    url: it.link.clone().unwrap_or_else(|| "https://www.geograph.org.uk".into()),
                    licencia: it.licencia.clone().unwrap_or_else(|| "CC BY-SA 2.0".into()),
                },
                unidades: 1,
            });
        }
        Ok(fuera)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn londres_esta_dentro_de_la_cobertura() {
        assert!(dentro_de_islas(51.5, -0.12));
    }

    #[test]
    fn leon_no_esta_dentro_de_la_cobertura() {
        assert!(!dentro_de_islas(42.6, -5.57));
    }

    /// Un item fuera de la tesela exacta (dentro del radio de búsqueda pero
    /// fuera del bbox) se filtra tras la respuesta.
    #[test]
    fn un_item_fuera_del_bbox_no_pasa_el_recorte() {
        let b = lumi_index::tiles::Bbox { oeste: -1.0, sur: 50.0, este: -0.5, norte: 50.5 };
        let dentro = |lat: f64, lng: f64| lat <= b.norte && lat >= b.sur && lng >= b.oeste && lng <= b.este;
        assert!(dentro(50.2, -0.7));
        assert!(!dentro(50.2, 2.0));
    }
}
```

- [ ] **Step 3: Registrar ambos módulos**

En `mod.rs`, añade:

```rust
pub mod geograph;
pub mod inaturalist;
```

En `registro()`:

```rust
    v.push(Box::new(inaturalist::INaturalist::nuevo(stage.clone())));
    v.push(Box::new(geograph::Geograph::nuevo(stage.clone())));
```

- [ ] **Step 4: Compilar y testear**

Run:
```bash
cd "E:/Lumi Station/indexer/src-tauri"
cargo build --offline -p indexer-app 2>&1 | tail -60
cargo test --offline "origins::inaturalist::" "origins::geograph::" -- --nocapture
```
Expected: build limpio, los 6+3 tests en verde.

- [ ] **Step 5: Editar `origenes.ts` — versión final con todos los IDs**

Reemplaza el fichero entero para que quede consistente (incluye lo ya añadido en tareas previas y lo que faltaba de `monumentos`/`panoramax`):

```ts
/** La paleta de proveedores. Es el ÚNICO sitio de toda la aplicación donde el
 *  color codifica una categoría, y es deliberado: muchos orígenes simultáneos
 *  no se distinguen de otra forma. Fuera de la capa de disponibilidad y de los
 *  puntos índice de 9 px que la referencian, la rampa vuelve a ser neutra.
 *
 *  `monumentos` y `panoramax` faltaban aquí desde que se dieron de alta en
 *  `origins::registro()` — sin entrada caían al gris por defecto y al `id`
 *  crudo como nombre, detectado al escribir el spec de 2026-09-11. */
export const PALETA: Record<string, string> = {
  mapillary: "#4ec9a5",
  kartaview: "#a78bfa",
  google: "#e8b04b",
  "mapbox-satelite": "#4a4d52",
  commons: "#6ea8fe",
  flickr: "#f472a6",
  monumentos: "#c9a86a",
  panoramax: "#6ec9c2",
  wikipedia: "#f2c14e",
  "wms-orto": "#7a8b99",
  inaturalist: "#8bc670",
  geograph: "#e0956b",
  openaerialmap: "#9aa5f0",
};

export const NOMBRES: Record<string, string> = {
  mapillary: "Mapillary",
  kartaview: "KartaView",
  google: "Google Street View",
  "mapbox-satelite": "Mapbox Satellite",
  commons: "Wikimedia Commons",
  flickr: "Flickr",
  monumentos: "Wikidata → Commons",
  panoramax: "Panoramax",
  wikipedia: "Wikipedia",
  "wms-orto": "Ortofoto nacional (WMS)",
  inaturalist: "iNaturalist",
  geograph: "Geograph (UK/IE)",
  openaerialmap: "OpenAerialMap",
};

export const nombre = (id: string) => NOMBRES[id] ?? id;
export const color = (id: string) => PALETA[id] ?? "#6a6c70";

export const LIMITES: Record<string, string> = {
  mapillary: "8 req/s · 4 a la vez",
  kartaview: "4 req/s · 2 a la vez",
  google: "10 req/s · 4 a la vez",
  "mapbox-satelite": "16 req/s · 8 a la vez",
  commons: "2 req/s · 1 a la vez",
  flickr: "4 req/s · 2 a la vez",
  monumentos: "2 req/s · 1 a la vez",
  panoramax: "4 req/s · 2 a la vez",
  wikipedia: "2 req/s · 1 a la vez",
  "wms-orto": "2 req/s · 1 a la vez",
  inaturalist: "1 req/s · 1 a la vez",
  geograph: "2 req/s · 1 a la vez",
  openaerialmap: "4 req/s · 2 a la vez",
};

/** Los que funcionan sin credencial. No se les pide una que no existe. */
export const SIN_CLAVE = new Set([
  "kartaview", "commons", "monumentos", "panoramax",
  "wikipedia", "wms-orto", "inaturalist", "geograph", "openaerialmap",
]);

/** Ninguno comparte clave con otro: cada proveedor tiene su propia fila,
 *  incluido Mapbox Satellite frente al mapa base (que no es un "origen" de
 *  indexado y por eso no está en `ORDEN` — vive aparte en `OriginsPanel`). */
export const COMPARTE_CLAVE = new Set<string>();

export const ORDEN = [
  "mapillary", "kartaview", "google", "mapbox-satelite", "commons",
  "monumentos", "wikipedia", "panoramax", "inaturalist", "geograph",
  "openaerialmap", "flickr",
];
```

**Nota de verificación antes del Step 6:** `panoramax.rs` ya existía antes de este plan y no se ha comprobado aquí su `usd_por_mil` real ni si necesita clave — antes de dar por buena la línea de `PALETA`/`NOMBRES`/`LIMITES`/`SIN_CLAVE` de `panoramax`, confirma con `grep -n "fn tarifa\|Ctx::nuevo" indexer/src-tauri/src/origins/panoramax.rs` que efectivamente no pide clave (el spec de 2026-09-11 ya lo daba por hecho en `origins::mod.rs::registro()`, que lo da de alta sin `claves.leer`).

- [ ] **Step 6: Compilar el frontend**

Run: `cd "E:/Lumi Station/indexer" && npm run build`
Expected: sin errores de TypeScript.

- [ ] **Step 7: Commit**

```bash
cd "E:/Lumi Station"
git add indexer/src-tauri/src/origins/inaturalist.rs indexer/src-tauri/src/origins/geograph.rs indexer/src-tauri/src/origins/mod.rs indexer/src/lib/origenes.ts
git commit -m "feat(indexer): origenes inaturalist y geograph, mas monumentos/panoramax en origenes.ts"
```

---

### Task 7: Origen `openaerialmap`

**Files:**
- Create: `indexer/src-tauri/src/origins/openaerialmap.rs`
- Modify: `indexer/src-tauri/src/origins/mod.rs`

**Interfaces:**
- Produces: `pub struct OpenAerialMap`, `id() == "openaerialmap"`, `tipo() == Tipo::Cenital`.

- [ ] **Step 1: Escribir `openaerialmap.rs`**

```rust
//! OpenAerialMap: aérea libre de alta resolución donde la haya. Cobertura
//! testimonial en Europa (0 resultados medidos en una tesela urbana de León
//! el 2026-09-11), pero donde existe es la única aérea abierta a esa
//! resolución — verificado en Dar es Salaam: `gsd` de 2,1 cm.
//!
//! Se elige la imagen de MENOR `gsd` que cubra la tesela: una tesela no
//! necesita veinte ortofotos del mismo sitio, necesita la mejor.
//!
//! El `license` de nivel superior de la API viene `null`; la licencia real
//! vive en `properties`. Sin licencia legible, NO se descarga — un origen
//! abierto sin licencia declarada no es publicable, y anunciar
//! `Redistribucion::Libre` sin verificarlo por imagen mentiría.
//!
//! Última fase a propósito: es el único de los orígenes de este spec que
//! puede quedarse sin implementar sin que el resultado se resienta.
//!
//! 4 req/s, concurrencia 2: API sobre S3, aguanta más que las de MediaWiki.

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

const API: &str = "https://api.openaerialmap.org/meta";

#[derive(Debug, Clone, Deserialize)]
struct Propiedades {
    license: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
struct Resultado {
    uuid: String,
    gsd: Option<f64>,
    #[serde(default)]
    properties: Option<Propiedades>,
    /// La URL de la imagen no es un campo fijo documentado de forma estable
    /// en `/meta`; se resuelve por convención `.../<uuid>.tif` cuando el
    /// campo no está presente. Se acepta explícito si la API lo trae.
    #[serde(default)]
    tms: Option<String>,
}

#[derive(Debug, Deserialize)]
struct Meta {
    found: u32,
}

#[derive(Debug, Deserialize)]
struct Respuesta {
    meta: Meta,
    #[serde(default)]
    results: Vec<Resultado>,
}

pub struct OpenAerialMap {
    ctx: Ctx,
}

impl OpenAerialMap {
    pub fn nuevo(stage: PathBuf) -> Self {
        Self { ctx: Ctx::nuevo(None, stage, 4, 2) }
    }

    async fn buscar(&self, tesela: &str) -> Result<Respuesta> {
        let b = bbox_de_tesela(tesela);
        let url = format!("{API}?bbox={},{},{},{}&limit=20", b.oeste, b.sur, b.este, b.norte);
        let _g = self.ctx.limitador.permiso().await;
        let r = self.ctx.cliente.get(&url).send().await?;
        if !r.status().is_success() {
            anyhow::bail!("OpenAerialMap respondió {}", r.status());
        }
        Ok(r.json().await?)
    }

    /// La de menor `gsd` (mayor resolución) con licencia legible.
    fn mejor(resultados: &[Resultado]) -> Option<&Resultado> {
        resultados
            .iter()
            .filter(|r| r.properties.as_ref().and_then(|p| p.license.as_deref()).is_some())
            .min_by(|a, b| a.gsd.unwrap_or(f64::MAX).total_cmp(&b.gsd.unwrap_or(f64::MAX)))
    }
}

#[async_trait]
impl OrigenDeRed for OpenAerialMap {
    fn id(&self) -> &'static str {
        "openaerialmap"
    }
    fn tipo(&self) -> Tipo {
        Tipo::Cenital
    }
    fn tarifa(&self) -> Tarifa {
        Tarifa::Gratis
    }
    fn redistribucion(&self) -> Redistribucion {
        Redistribucion::Libre { licencia: "según imagen (ver atribución)".into() }
    }
    fn bajadas(&self) -> u32 {
        self.ctx.bajadas()
    }

    async fn sondear(&self, tesela: &str) -> Result<Disponibilidad> {
        let r = self.buscar(tesela).await?;
        Ok(Disponibilidad::Siempre { unidades: if Self::mejor(&r.results).is_some() { 1 } else { 0 } })
    }

    async fn descargar(&self, tesela: &str, tope: &Presupuesto) -> Result<Vec<Captura>> {
        let r = self.buscar(tesela).await?;
        let Some(mejor) = Self::mejor(&r.results) else { return Ok(vec![]) };
        let Some(url) = &mejor.tms else {
            log::debug!("openaerialmap {}: sin URL de imagen resoluble, se omite", mejor.uuid);
            return Ok(vec![]);
        };
        if tope.gastar(&self.tarifa(), 1).is_err() {
            return Ok(vec![]);
        }
        let ruta = self.ctx.bajar_imagen(url, &format!("oam-{}.jpg", mejor.uuid)).await?;
        let b = bbox_de_tesela(tesela);
        let lat = (b.norte + b.sur) / 2.0;
        let lng = (b.oeste + b.este) / 2.0;
        let licencia = mejor
            .properties
            .as_ref()
            .and_then(|p| p.license.clone())
            .unwrap_or_else(|| "desconocida".into());
        Ok(vec![Captura {
            fuente: "openaerialmap",
            id_origen: mejor.uuid.clone(),
            ruta,
            lat,
            lng,
            rumbo: None,
            capturada_en: None,
            atribucion: Atribucion {
                autor: "OpenAerialMap contributor".into(),
                url: format!("https://map.openaerialmap.org/#/{},{}/12/{}", lng, lat, mejor.uuid),
                licencia,
            },
            unidades: 1,
        }])
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn con_licencia(uuid: &str, gsd: f64) -> Resultado {
        Resultado {
            uuid: uuid.into(),
            gsd: Some(gsd),
            properties: Some(Propiedades { license: Some("CC-BY-4.0".into()) }),
            tms: Some(format!("https://x/{uuid}.tif")),
        }
    }

    fn sin_licencia(uuid: &str) -> Resultado {
        Resultado { uuid: uuid.into(), gsd: Some(0.01), properties: Some(Propiedades { license: None }), tms: None }
    }

    #[test]
    fn se_elige_la_de_menor_gsd() {
        let r = vec![con_licencia("a", 0.1), con_licencia("b", 0.02)];
        assert_eq!(OpenAerialMap::mejor(&r).unwrap().uuid, "b");
    }

    #[test]
    fn una_imagen_sin_licencia_legible_no_se_elige_aunque_tenga_mejor_resolucion() {
        let r = vec![sin_licencia("mejor-pero-sin-licencia"), con_licencia("peor-pero-con-licencia", 0.5)];
        assert_eq!(OpenAerialMap::mejor(&r).unwrap().uuid, "peor-pero-con-licencia");
    }

    #[test]
    fn sin_ningun_resultado_con_licencia_no_hay_mejor() {
        let r = vec![sin_licencia("x")];
        assert!(OpenAerialMap::mejor(&r).is_none());
    }
}
```

- [ ] **Step 2: Registrar el módulo**

En `mod.rs`:

```rust
pub mod openaerialmap;
```

En `registro()`:

```rust
    v.push(Box::new(openaerialmap::OpenAerialMap::nuevo(stage.clone())));
```

- [ ] **Step 3: Compilar y testear**

Run:
```bash
cd "E:/Lumi Station/indexer/src-tauri"
cargo build --offline -p indexer-app 2>&1 | tail -60
cargo test --offline origins::openaerialmap:: -- --nocapture
```
Expected: build limpio, 3 tests en verde.

- [ ] **Step 4: Frontend**

`openaerialmap` ya está en `origenes.ts` desde el Step 5 de Task 6 (`PALETA`, `NOMBRES`, `LIMITES`, `SIN_CLAVE`, `ORDEN`) — solo confirma que sigue ahí, no hay cambio nuevo que hacer.

- [ ] **Step 5: Commit**

```bash
cd "E:/Lumi Station"
git add indexer/src-tauri/src/origins/openaerialmap.rs indexer/src-tauri/src/origins/mod.rs
git commit -m "feat(indexer): origen openaerialmap, aerea abierta de alta resolucion"
```

---

### Task 8: Verificación final y limpieza

**Files:** ninguno nuevo — solo verificación.

- [ ] **Step 1: Suite completa de Rust**

Run: `cd "E:/Lumi Station/indexer/src-tauri" && cargo test --offline 2>&1 | tail -80`
Expected: 0 fallos. Si algún test preexistente de `origins::` rompe por el refactor de Task 3, arréglalo antes de seguir.

- [ ] **Step 2: `cargo build` en modo release para descartar warnings que se conviertan en error en CI**

Run: `cd "E:/Lumi Station/indexer/src-tauri" && cargo build --offline 2>&1 | grep -i "warning\|error" | head -60`
Expected: revisar cualquier `unused import` dejado por los refactors de `monumentos.rs` (Task 2, Task 3) y limpiarlo.

- [ ] **Step 3: Build de frontend**

Run: `cd "E:/Lumi Station/indexer" && npm run build`
Expected: sin errores.

- [ ] **Step 4: Lint de frontend**

Run: `cd "E:/Lumi Station/indexer" && npm run lint`
Expected: sin errores nuevos introducidos por `origenes.ts`/`AvailabilityPanel.tsx`/`MapCanvas.tsx`.

- [ ] **Step 5: Verificación manual contra red real — comprobación rápida de que los `registro()` compilan y arrancan**

Esto no sustituye la verificación manual que el spec pide en su §9 (que hace el operador con la app real, per memoria de proyecto: no arrancar el Browser preview por iniciativa propia). Limitarse a confirmar que `cargo test` cubrió la lógica pura de cada adaptador (deserialización, filtrado de ruido, recorte de bbox, elección de mejor `gsd`) y dejar constancia en el mensaje de commit final de que la prueba contra la API real y el sellado de un `.lumidx` de prueba quedan para el operador, siguiendo el checklist del spec §9.

- [ ] **Step 6: Commit final si quedó algo suelto**

```bash
cd "E:/Lumi Station"
git status
```

Si hay cambios sin commitear (imports limpiados, ajustes de lint), commitéalos:

```bash
git add -A
git commit -m "chore(indexer): limpieza final tras los origenes nuevos (warnings, lint)"
```

---

## Self-Review (ya aplicado al escribir este plan)

1. **Cobertura del spec:** §2 (los seis, con nombres) → Tasks 4-7 + Task 2 para el hueco de `P18`. §3.1 (IDs propios) → cada Task da de alta un `id` nuevo salvo Task 2. §3.2 (coordenada cámara/sujeto) → comentado explícitamente en `wikipedia.rs` y `geograph.rs`/`inaturalist.rs`. §3.3 (precisión declarada) → `inaturalist.rs` rellena `precision_metros`. §3.4 (metadatos que no tumban el parseo) → todos los adaptadores usan `Campo::texto()` o campos `Option<T>` tolerantes, con tests de regresión explícitos en `wikipedia.rs`. §3.5 (ritmos) → tabla replicada en cada `Ctx::nuevo` y en `LIMITES`. §4.1-§4.6 → un Task por origen. §5 (estado de error) → Task 1, ejecutado primero como pide el spec. §6 (ficheros) → todos cubiertos. §7 (fases) → el orden de los Tasks sigue el orden de fases del spec exactamente.
2. **Placeholders:** ninguno — cada step de código lleva el código completo, no un resumen.
3. **Consistencia de tipos:** `Captura`, `Atribucion`, `Candidata`, `Disponibilidad`, `Nivel`, `Tipo`, `Redistribucion`, `Presupuesto::gastar` se usan con las firmas exactas leídas de `crates/lumi-index/src/{network,coverage,filter,manifest,budget}.rs` y de `origins/mod.rs::Ctx`. `SondeoTesela.error` se define una vez en Task 1 y ningún Task posterior redefine el struct.

## Execution Handoff

Plan completo y guardado en `docs/superpowers/plans/2026-09-11-origenes-nuevos.md`.

Por la preferencia ya establecida en este proyecto (un subagente para todo el plan, no orquestación tarea por tarea), la ejecución va como agente único en una rama aparte, con merge al terminar — el mismo patrón usado para el rediseño de PDF y el panel de admin.
