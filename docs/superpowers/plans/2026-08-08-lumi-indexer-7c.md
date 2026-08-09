# Lumi Indexer 7c — cerrar los huecos del subsistema 7

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Conectar las piezas del subsistema 7 que se escribieron y se probaron en aislamiento pero que ningún camino de producción llama, y completar los dos elementos de interfaz que la tabla de ficheros del plan 7b prometía y no se construyeron.

**Architecture:** No hay diseño nuevo. Cada tarea toma una función que ya existe, está probada y no tiene ni una llamada fuera de sus tests, y la enchufa en el punto del flujo donde el plan original decía que iba. El patrón del fallo es siempre el mismo — módulo puro correcto, punto de conexión vacío — así que el arreglo es siempre del mismo tipo: una llamada, sus datos, y un test que falla si alguien la vuelve a desconectar.

**Tech Stack:** Rust (rusqlite, tokio, Tauri 2), React 19 + TypeScript, Tailwind, Mapbox GL JS.

## Global Constraints

- Identificadores, comentarios y mensajes de commit en **español**. Comentarios explican el **porqué**, nunca el qué.
- `ponytail`: la solución más simple que funcione. Sin abstracciones que este plan no pida.
- **No hay verde** en la paleta. "Completado" se representa en blanco (`fg`). Colores solo de la tabla de `DESIGN.md`.
- Todo dato producido por una máquina (quadkeys, bytes, euros, timestamps, hashes, rutas) va en `font-mono`.
- **Solo se apunta en el libro de gasto lo que el proveedor sirvió de verdad.** Una petición fallida no se cobra ni se cuenta.
- **Lo no redistribuible viaja con advertencia y descargo** (regla revisada en el subsistema 8): nunca a escondidas, y siempre imagen y vector juntos — un vector sin su imagen no se puede verificar. *(Corregido por el
  subsistema 8: el contenido sigue sin viajar tal cual, pero la ficha ya no queda muda sobre su
  uso — declara qué fuentes se usaron y publicar exige un descargo explícito del operador. Ver
  `specs/2026-08-07-lumi-indexer-7b-design.md`.)*
- El filtro barato se evalúa **antes de descargar el píxel**. Ese es el motivo de que exista: descartar sin gastar.
- Los tests existentes no se rompen: 26 en `lumi-index`, 33 en `indexer/src-tauri`. Cada tarea los deja en verde o más.
- Comandos de verificación: `cargo test -p lumi-index`, `cargo test` en `indexer/src-tauri`, `cargo clippy -- -D warnings`, y en `indexer/`: `npx tsc -b --noEmit && npm run lint && npm run build`.

## Contexto: de dónde sale este plan

Una auditoría del subsistema 7 contra sus dos planes (`2026-08-06-lumi-indexer-7a.md` y `2026-08-07-lumi-indexer-7b.md`) encontró tres huecos bloqueantes, todos del mismo patrón. El informe completo está en `AUDITORIA-7.md`. Este plan los cierra, más dos incumplimientos de la tabla de ficheros del 7b y varios cosméticos.

Un hallazgo que este plan corrige **sobre el propio plan 7b**: el 7b decía rellenar `cobertura.json` con `almacen.fuentes_de_tesela(...)`. Eso sería un error. `fuentes_de_tesela` devuelve todos los orígenes de la tesela, incluidos aquellos cuyas imágenes NO viajan en el paquete. La función correcta es `package::fuentes_que_viajan`, que ya existe y está probada: declarar un origen cuyo píxel no viaja haría que quien instale el paquete crea que tiene cobertura que no está dentro. Task 4 usa la correcta.

---

## Task 1: El filtro barato en Commons, antes de pagar el ancho de banda

`crates/lumi-index/src/filter.rs` está implementado y probado desde el 7b Task 3, y no tiene ni una llamada en producción. `commons.rs` incluso dejó el hueco escrito, con un comentario a medias y un `let _ = &p.categories;` que existe solo para que el compilador no avise del campo sin usar.

La evaluación va **antes** de `bajar_imagen`, no después: filtrar tras descargar no ahorra nada, y el módulo se llama "reglas baratas" precisamente porque decide con los metadatos del proveedor.

**Files:**
- Modify: `indexer/src-tauri/src/origins/commons.rs`

**Interfaces:**
- Consumes: `lumi_index::filter::{Candidata, Reglas, Veredicto}`; `lumi_index::network::Tipo`
- Produces: nada nuevo hacia fuera. `Commons::descargar` sigue devolviendo `Result<Vec<Captura>>`, con menos elementos.

- [ ] **Step 1: Pedirle a la API los datos que el filtro necesita**

La consulta actual no pide el tamaño de la imagen. Sin `ancho`/`alto` la regla de proporción y la de tamaño mínimo no pueden decidir nada. En `commons.rs`, en la URL de la consulta, añadir `size` a `iiprop`:

Buscar `&iiprop=url%7Cextmetadata&iiurlwidth=2048` y sustituir por:

```rust
             &iiprop=url%7Csize%7Cextmetadata&iiurlwidth=2048\
```

Y añadir los dos campos a `InfoImagen`:

```rust
#[derive(Debug, Deserialize)]
struct InfoImagen {
    #[serde(rename = "thumburl")]
    thumb: Option<String>,
    url: Option<String>,
    #[serde(default)]
    width: u32,
    #[serde(default)]
    height: u32,
    #[serde(rename = "extmetadata", default)]
    meta: std::collections::HashMap<String, Campo>,
}
```

- [ ] **Step 2: Dar a `Categoria.title` su razón de existir**

Tiene un `#[allow(dead_code)]` sin justificar precisamente porque nadie lo leía. Ahora se lee. Sustituir:

```rust
#[derive(Debug, Deserialize)]
struct Categoria {
    #[allow(dead_code)]
    title: String,
}
```

por:

```rust
#[derive(Debug, Deserialize)]
struct Categoria {
    title: String,
}
```

- [ ] **Step 3: Escribir el test que falla**

Añadir al final de `commons.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    /// Una foto de interior con categoría explícita no llega a descargarse.
    /// El test mira la decisión, no la red: `candidata_de` es lo que el
    /// adaptador consulta antes de gastar un byte.
    #[test]
    fn una_foto_de_interior_no_pasa_las_reglas() {
        let c = candidata_de(
            4000,
            3000,
            &["Category:Interior of buildings in Lugo".to_string()],
            Some("CC BY-SA 4.0"),
        );
        assert!(matches!(Reglas::por_defecto().evaluar(&c), Veredicto::Fuera(_)));
    }

    #[test]
    fn una_fachada_normal_si_pasa() {
        let c = candidata_de(2048, 1536, &["Category:Streets in Lugo".to_string()], Some("CC BY-SA 4.0"));
        assert_eq!(Reglas::por_defecto().evaluar(&c), Veredicto::Pasa);
    }

    /// Commons no declara precisión de geoetiqueta, y `None` NO es motivo de
    /// descarte: es «no lo dijo», no «lo dijo mal».
    #[test]
    fn sin_precision_declarada_no_se_descarta() {
        let c = candidata_de(2048, 1536, &[], None);
        assert_eq!(Reglas::por_defecto().evaluar(&c), Veredicto::Pasa);
    }
}
```

- [ ] **Step 4: Ejecutar el test y comprobar que falla**

Run: `cd indexer/src-tauri && cargo test commons::tests`
Expected: FAIL — `cannot find function candidata_de in this scope`

- [ ] **Step 5: Escribir `candidata_de` y llamarla antes de descargar**

Añadir al principio de `commons.rs`, tras los `use`:

```rust
use lumi_index::filter::{Candidata, Reglas, Veredicto};
use lumi_index::network::Tipo;

/// Los metadatos que Commons ya devuelve, en la forma que el filtro entiende.
/// Aparte para poder probar la decisión sin levantar la red.
fn candidata_de(ancho: u32, alto: u32, categorias: &[String], licencia: Option<&str>) -> Candidata {
    Candidata {
        ancho,
        alto,
        // Commons no publica precisión de la geoetiqueta. `None` es «no lo
        // dijo», que no descarta.
        precision_metros: None,
        categorias: categorias.to_vec(),
        licencia: licencia.map(str::to_string),
        tipo: Tipo::Suelta,
    }
}
```

En el bucle de `descargar`, **antes** de la llamada a `self.ctx.bajar_imagen(...)`, insertar la evaluación. Sustituir este bloque:

```rust
            let ruta = match self.ctx.bajar_imagen(&url, &format!("cmn-{}.jpg", p.pageid)).await {
```

por:

```rust
            // Antes de bajar un solo byte: las reglas baratas deciden con lo
            // que el proveedor ya nos ha contado. Filtrar después de la
            // descarga no ahorraría ni ancho de banda ni cuota, que es justo
            // para lo que existe este módulo.
            let cats: Vec<String> = p.categories.iter().map(|c| c.title.clone()).collect();
            let licencia = i.meta.get("LicenseShortName").and_then(|c| c.value.clone());
            let cand = candidata_de(i.width, i.height, &cats, licencia.as_deref());
            if let Veredicto::Fuera(motivo) = Reglas::por_defecto().evaluar(&cand) {
                log::debug!("commons {}: descartada, {motivo}", p.title);
                continue;
            }

            let ruta = match self.ctx.bajar_imagen(&url, &format!("cmn-{}.jpg", p.pageid)).await {
```

Borrar la línea `let _ = &p.categories;` y su comentario a medias, que ya no tienen sentido:

```rust
            // Las categorías viajan en el `id_origen` no: se guardan para que
            // la Task 12 pueda pasarles las reglas. Aquí se dejan en la URL de
            // atribución, que es donde el operador las puede ir a ver.
            let _ = &p.categories;
```

- [ ] **Step 6: Ejecutar los tests y comprobar que pasan**

Run: `cd indexer/src-tauri && cargo test && cargo clippy -- -D warnings`
Expected: 36 passed (33 previos + 3 nuevos); clippy limpio.

- [ ] **Step 7: Commit**

```bash
git add indexer/src-tauri/src/origins/commons.rs
git commit -m "Las reglas baratas de Commons, antes de bajar el pixel y no despues"
```

---

## Task 2: El mismo filtro en Flickr

Flickr ya pide solo licencias CC permitidas por parámetro de consulta, pero eso no cubre ninguna de las otras reglas. Es el origen con más ruido de los seis: fotos de gente, primeros planos e interiores.

**Files:**
- Modify: `indexer/src-tauri/src/origins/flickr.rs`

**Interfaces:**
- Consumes: `lumi_index::filter::{Candidata, Reglas, Veredicto}`; `lumi_index::network::Tipo`
- Produces: nada nuevo. `Flickr::descargar` devuelve menos capturas.

- [ ] **Step 1: Pedir las etiquetas, el tamaño y la precisión**

`extras=geo` ya trae `accuracy`; falta pedir `tags`, y `url_l` devuelve `width_l`/`height_l` que no se estaban deserializando. Buscar:

```rust
             &extras=geo,license,owner_name,date_taken,url_l&api_key={}",
```

y sustituir por:

```rust
             &extras=geo,license,owner_name,date_taken,tags,url_l&api_key={}",
```

Añadir los campos a `FotoFlickr`:

```rust
#[derive(Debug, Deserialize)]
struct FotoFlickr {
    id: String,
    ownername: Option<String>,
    license: Option<String>,
    latitude: Option<String>,
    longitude: Option<String>,
    datetaken: Option<String>,
    url_l: Option<String>,
    #[serde(default)]
    tags: String,
    #[serde(default)]
    width_l: u32,
    #[serde(default)]
    height_l: u32,
    /// 1..16 según Flickr: 16 es nivel de calle, 1 es nivel de país. Se
    /// traduce a metros porque el filtro razona en metros, no en la escala
    /// de un proveedor concreto.
    #[serde(default)]
    accuracy: u32,
}
```

- [ ] **Step 2: Escribir el test que falla**

Añadir al final de `flickr.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    /// 16 es nivel de calle y 11 es nivel de ciudad. La escala de Flickr no
    /// dice metros, así que la traducción es lo que decide si una foto con
    /// geoetiqueta de ciudad entra o no.
    #[test]
    fn la_precision_de_flickr_se_traduce_a_metros() {
        assert!(metros_de_accuracy(16).unwrap() <= 100.0);
        assert!(metros_de_accuracy(11).unwrap() > 100.0);
        // 0 es «no lo dijo», y eso no descarta.
        assert_eq!(metros_de_accuracy(0), None);
    }

    #[test]
    fn una_foto_de_interior_por_etiqueta_no_pasa() {
        let c = candidata_de(3000, 2000, "lugo indoor museum", Some("CC BY 2.0"), 16);
        assert!(matches!(Reglas::por_defecto().evaluar(&c), Veredicto::Fuera(_)));
    }

    #[test]
    fn una_foto_de_calle_con_geoetiqueta_fina_pasa() {
        let c = candidata_de(2048, 1365, "lugo street facade", Some("CC BY 2.0"), 16);
        assert_eq!(Reglas::por_defecto().evaluar(&c), Veredicto::Pasa);
    }

    #[test]
    fn un_recorte_panoramico_extremo_no_pasa() {
        let c = candidata_de(4000, 300, "lugo street", Some("CC BY 2.0"), 16);
        assert!(matches!(Reglas::por_defecto().evaluar(&c), Veredicto::Fuera(_)));
    }
}
```

- [ ] **Step 3: Ejecutar el test y comprobar que falla**

Run: `cd indexer/src-tauri && cargo test flickr::tests`
Expected: FAIL — `cannot find function metros_de_accuracy in this scope`

- [ ] **Step 4: Escribir la traducción y la candidata**

Añadir tras los `use` de `flickr.rs`:

```rust
use lumi_index::filter::{Candidata, Reglas, Veredicto};
use lumi_index::network::Tipo;

/// La escala 1..16 de Flickr, en metros aproximados. Solo importan los
/// tramos alrededor del umbral de 100 m del filtro, así que no hace falta
/// una tabla exacta: 16 es calle, 11 ciudad, y por debajo ya no localiza.
/// `None` para 0, que en Flickr significa «no lo dijo».
fn metros_de_accuracy(a: u32) -> Option<f64> {
    match a {
        0 => None,
        16 => Some(30.0),
        14..=15 => Some(80.0),
        12..=13 => Some(300.0),
        _ => Some(5000.0),
    }
}

/// Los metadatos que Flickr ya devuelve, en la forma que el filtro entiende.
fn candidata_de(ancho: u32, alto: u32, tags: &str, licencia: Option<&str>, accuracy: u32) -> Candidata {
    Candidata {
        ancho,
        alto,
        precision_metros: metros_de_accuracy(accuracy),
        // Flickr da las etiquetas separadas por espacio, no una lista.
        categorias: tags.split_whitespace().map(str::to_string).collect(),
        licencia: licencia.map(str::to_string),
        tipo: Tipo::Suelta,
    }
}
```

- [ ] **Step 5: Llamarla antes de descargar**

En el bucle de `descargar`, localizar la llamada a `self.ctx.bajar_imagen(...)` e insertar justo antes:

```rust
            // Igual que en Commons: se decide con lo que el proveedor ya dijo,
            // antes de gastar el ancho de banda.
            let cand = candidata_de(
                f.width_l,
                f.height_l,
                &f.tags,
                f.license.as_deref().map(nombre_licencia),
                f.accuracy,
            );
            if let Veredicto::Fuera(motivo) = Reglas::por_defecto().evaluar(&cand) {
                log::debug!("flickr {}: descartada, {motivo}", f.id);
                continue;
            }
```

- [ ] **Step 6: Ejecutar los tests y comprobar que pasan**

Run: `cd indexer/src-tauri && cargo test && cargo clippy -- -D warnings`
Expected: 40 passed (36 + 4 nuevos); clippy limpio.

- [ ] **Step 7: Commit**

```bash
git add indexer/src-tauri/src/origins/flickr.rs
git commit -m "Flickr: la escala de precision del proveedor, traducida a metros que el filtro entiende"
```

---

## Task 3: Anotar de quién es el trabajo de cada tesela

`Almacen::anotar_tesela` (`store.rs:380`) es el único `INSERT INTO teselas` del código y **nadie lo llama**. Por eso `teselas_trabajo` devuelve siempre vacío, y por eso la tabla "PROCEDENCIA DEL TRABAJO" sale en blanco tanto en el catálogo como en el manifiesto sellado — incluyendo la constraint global del 7a de que ese porcentaje suma 100 %.

Hay dos momentos en que se sabe de quién es el trabajo: cuando se descarga una tesela aquí (`Aqui`) y cuando se confirma un plan que hereda teselas ya cubiertas (`Local`).

**Files:**
- Modify: `indexer/src-tauri/src/download.rs`
- Modify: `indexer/src-tauri/src/lib.rs` (comando `territorio_heredar`, nuevo)
- Modify: `indexer/src/lib/api.ts`
- Modify: `indexer/src/territory/TerritoryView.tsx`

**Interfaces:**
- Consumes: `Almacen::anotar_tesela(indice_id: i64, quadkey: &str, trabajo: &str, fuente_indice: Option<&str>, sha256: Option<&str>) -> Result<()>`; `Clasificacion` con `teselas: Vec<(String, EstadoTesela)>`
- Produces: comando Tauri `territorio_heredar(indice_id: i64, heredadas: Vec<(String, String, String)>) -> Result<(), String>` donde la tupla es `(quadkey, indice_fuente, sha256)`; en TypeScript `api.territorioHeredar(indiceId: number, heredadas: [string, string, string][]) => Promise<void>`

- [ ] **Step 1: Escribir el test que falla**

Añadir al módulo `tests` de `indexer/src-tauri/src/download.rs`:

```rust
    /// Una tesela descargada aquí queda anotada como trabajo propio. Sin esto
    /// la tabla de procedencia del trabajo está siempre vacía y el manifiesto
    /// miente por omisión.
    #[test]
    fn una_tesela_descargada_queda_anotada_como_trabajo_propio() {
        let d = tempfile::tempdir().unwrap();
        let a = Almacen::abrir(d.path()).unwrap();
        let i = a.crear_indice("x", "x").unwrap();

        a.anotar_tesela(i, "0311332201302", "aqui", None, None).unwrap();

        let t = a.teselas_trabajo(i).unwrap();
        assert_eq!(t.len(), 1);
        assert_eq!(t[0].0, "0311332201302");
        assert!(matches!(t[0].1, lumi_index::manifest::TrabajoDe::Aqui));
    }
```

- [ ] **Step 2: Ejecutar el test y comprobar que pasa ya**

Run: `cd indexer/src-tauri && cargo test una_tesela_descargada_queda_anotada`
Expected: PASS.

Esto es deliberado: `anotar_tesela` funciona, el hueco es que nadie la llama. El test fija el contrato para que el siguiente paso tenga contra qué comprobarse, y el test de integración del Step 3 es el que de verdad falla.

- [ ] **Step 3: Escribir el test de integración que sí falla**

En el mismo módulo `tests` de `download.rs`:

```rust
    /// Lo que de verdad estaba roto: el planificador terminaba una tesela y
    /// no dejaba constancia de quién hizo el trabajo.
    #[tokio::test]
    async fn al_terminar_una_tesela_el_planificador_anota_el_trabajo() {
        let d = tempfile::tempdir().unwrap();
        let a = std::sync::Arc::new(Almacen::abrir(d.path()).unwrap());
        let i = a.crear_indice("x", "x").unwrap();

        // `Falso::nuevo(id, tipo, tarifa)` y `.con(tesela, cuantas)` guionizan
        // qué devuelve cada tesela, sin tocar la red.
        let origen: Box<dyn OrigenDeRed> = Box::new(
            Falso::nuevo("falso", Tipo::Calle, Tarifa::Gratis).con("0311332201302", 3),
        );
        let plan = std::collections::BTreeMap::from([("falso".to_string(), vec!["0311332201302".to_string()])]);
        correr(a.clone(), i, vec![origen], plan, 10.0, vec![]).await;

        let t = a.teselas_trabajo(i).unwrap();
        assert_eq!(t.len(), 1, "la tesela descargada tiene que quedar anotada");
        assert!(matches!(t[0].1, lumi_index::manifest::TrabajoDe::Aqui));
    }
```

Si la orquestación de la descarga sigue inline en el comando `descarga_arrancar` (la auditoría lo señala como desviación cosmética de la Task 11 del 7b), extraerla ahora a una función `pub(crate) async fn correr(...)` en `download.rs` con esa firma es parte de este paso: un planificador que no se puede llamar desde un test no se puede probar.

- [ ] **Step 4: Ejecutar el test y comprobar que falla**

Run: `cd indexer/src-tauri && cargo test al_terminar_una_tesela_el_planificador_anota`
Expected: FAIL — `assertion failed: la tesela descargada tiene que quedar anotada`, `left: 0, right: 1`

- [ ] **Step 5: Anotar la tesela al completarla**

En `download.rs`, en el punto donde una tesela se marca como hecha (justo tras el `descarga_marcar(..., "hecho", ...)`), añadir:

```rust
                    // La procedencia DEL TRABAJO, que es distinta de la de las
                    // imágenes: esta suma 100 % porque una tesela la indexó
                    // exactamente uno. Sin esta línea el manifiesto sale con la
                    // tabla vacía y nadie sabe quién pagó la GPU.
                    let _ = self.almacen.anotar_tesela(self.indice_id, &qk, "aqui", None, None);
```

- [ ] **Step 6: Ejecutar los tests y comprobar que pasan**

Run: `cd indexer/src-tauri && cargo test`
Expected: 42 passed.

- [ ] **Step 7: Añadir el comando para lo heredado**

Lo descargado aquí es `Aqui`; lo que el plan hereda de un índice local es `Local`. En `lib.rs`, junto a `territorio_clasificar`:

```rust
/// Anota como heredadas las teselas que el plan confirmó adjuntar. Se llama al
/// confirmar, no al clasificar: clasificar es mirar, y mirar no cambia de quién
/// es el trabajo.
#[tauri::command]
fn territorio_heredar(
    estado: tauri::State<'_, Estado>,
    indice_id: i64,
    heredadas: Vec<(String, String, String)>,
) -> Result<(), String> {
    for (qk, indice_fuente, sha256) in &heredadas {
        estado
            .almacen
            .anotar_tesela(indice_id, qk, "local", Some(indice_fuente), Some(sha256))
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}
```

Registrarlo en `generate_handler![...]`, junto a `territorio_clasificar`:

```rust
            territorio_clasificar,
            territorio_heredar,
```

- [ ] **Step 8: Enlazarlo desde el frontend**

En `indexer/src/lib/api.ts`, junto a `territorioClasificar`:

```ts
  territorioHeredar: (indiceId: number, heredadas: [string, string, string][]) =>
    invoke<void>("territorio_heredar", { indiceId, heredadas }),
```

En `indexer/src/territory/TerritoryView.tsx`, dentro de `alConfirmarPlan`, antes de pedir la estimación:

```ts
    // Lo heredado se anota PRIMERO: si el operador cierra a mitad de la
    // descarga, lo que ya estaba adjuntado sigue dentro del índice.
    //
    // `flatMap` y no `filter`+`map`: TypeScript no estrecha la unión de
    // `EstadoTesela` a través de un `filter`, así que `e.indice` no compilaría.
    if (indiceId !== undefined) {
      const heredadas = clasificacion.teselas.flatMap(([qk, e]) =>
        e.estado === "local" ? [[qk, e.indice, e.sha256] as [string, string, string]] : [],
      );
      if (heredadas.length > 0) await api.territorioHeredar(indiceId, heredadas);
    }
```

- [ ] **Step 9: Comprobar**

Run: `cd indexer/src-tauri && cargo test && cargo clippy -- -D warnings`
Expected: 42 passed; clippy limpio.

Run: `cd indexer && npx tsc -b --noEmit && npm run lint && npm run build`
Expected: sin errores.

- [ ] **Step 10: Commit**

```bash
git add indexer/src-tauri/src/download.rs indexer/src-tauri/src/lib.rs indexer/src/lib/api.ts indexer/src/territory/TerritoryView.tsx
git commit -m "Anotar de quien es el trabajo de cada tesela, que es lo que hacia que el manifiesto mintiera por omision"
```

---

## Task 4: `cobertura.json` con las teselas de verdad

`paquete_sellar` escribe `std::fs::write(raiz.join("cobertura.json"), b"{}")` — el literal, desde el 7a. El 7b prometió completarlo y no lo hizo, así que todo el mecanismo de herencia por origen que el 7b construyó (`clasificar_por_origen`, `repartir_por_origen`, el campo `fuentes` de `TeselaCubierta`) nunca recibe datos reales.

El dato ya está a mano: `paquete_sellar` construye `por_qk: BTreeMap<String, Vec<(i64, String)>>` con exactamente las filas que viajan, agrupadas por quadkey.

**Files:**
- Modify: `indexer/src-tauri/src/lib.rs` (dentro de `paquete_sellar`)
- Modify: `indexer/src-tauri/src/package.rs` (quitar el `#[allow(dead_code)]`)

**Interfaces:**
- Consumes: `package::fuentes_que_viajan(filas: &[FilaPublicable], quadkey: &str) -> Vec<String>`; `lumi_index::coverage::{Cobertura, TeselaCubierta, Atribucion}`
- Produces: `cobertura.json` con el esquema de `lumi_index::coverage::Cobertura`.

- [ ] **Step 1: Escribir el test que falla**

En el módulo `tests` de `indexer/src-tauri/src/package.rs`:

```rust
    /// `fuentes_que_viajan` y NO `fuentes_de_tesela`: la cobertura describe lo
    /// que hay DENTRO del paquete. Declarar un origen cuyo píxel no viaja haría
    /// que quien lo instale crea que tiene cobertura que no está, y se saltaría
    /// una descarga que sí necesita.
    #[test]
    fn la_cobertura_solo_declara_los_origenes_que_de_verdad_viajan() {
        let filas = vec![
            FilaPublicable { id: 1, fuente: "commons".into(), licencia: Some("CC BY-SA".into()), quadkey: "AAA".into() },
            FilaPublicable { id: 2, fuente: "google".into(), licencia: None, quadkey: "AAA".into() },
        ];
        let f = fuentes_que_viajan(&filas, "AAA");
        assert_eq!(f, vec!["commons".to_string()], "google es SoloLocal y no puede viajar");
    }
```

- [ ] **Step 2: Ejecutar el test y comprobar que pasa**

Run: `cd indexer/src-tauri && cargo test la_cobertura_solo_declara`
Expected: PASS — la función está bien; lo que falta es que alguien la llame.

- [ ] **Step 3: Construir la cobertura al sellar**

En `lib.rs`, dentro de `paquete_sellar`, sustituir:

```rust
    std::fs::write(raiz.join("cobertura.json"), b"{}").map_err(|e| e.to_string())?;
```

por:

```rust
    // Una entrada por quadkey que de verdad viaja. `por_qk` ya está filtrado
    // por `viajan`, así que aquí no hay que volver a decidir nada: solo contar
    // y declarar de dónde salió cada tesela.
    let mut teselas = Vec::with_capacity(por_qk.len());
    for (qk, filas) in &por_qk {
        let dir = raiz.join("fragmentos").join(qk);
        // El tamaño y el hash del fragmento son lo que hace COMPROBABLE la
        // autoría: quitar la atribución rompería SHA256SUMS.
        let (bytes, sha256) = package::medir_fragmento(&dir).map_err(|e| e.to_string())?;
        teselas.push(lumi_index::coverage::TeselaCubierta {
            quadkey: qk.clone(),
            sha256,
            bytes,
            imagenes: filas.len() as u32,
            fuentes: package::fuentes_que_viajan(&publicables, qk),
        });
    }
    let cobertura = lumi_index::coverage::Cobertura {
        version: 1,
        indice: destino.clone(),
        sellado_en: chrono_ahora(),
        atribucion: lumi_index::coverage::Atribucion {
            autor: String::new(),
            url: String::new(),
            licencia: String::new(),
        },
        teselas,
    };
    std::fs::write(
        raiz.join("cobertura.json"),
        serde_json::to_vec_pretty(&cobertura).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
```

- [ ] **Step 4: Escribir `medir_fragmento`**

En `package.rs`, junto a `escribir_fragmento`:

```rust
/// El tamaño total y el hash de un fragmento entero. El hash es de los bytes
/// de todos sus ficheros en orden alfabético, para que dos máquinas que sellen
/// el mismo material saquen el mismo valor.
pub fn medir_fragmento(dir: &Path) -> Result<(u64, String)> {
    use sha2::{Digest, Sha256};

    let mut ficheros: Vec<_> = std::fs::read_dir(dir)?
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| p.is_file())
        .collect();
    ficheros.sort();

    let mut bytes = 0u64;
    let mut h = Sha256::new();
    for f in &ficheros {
        let datos = std::fs::read(f)?;
        bytes += datos.len() as u64;
        h.update(&datos);
    }
    Ok((bytes, format!("{:x}", h.finalize())))
}
```

- [ ] **Step 5: Quitar el `allow(dead_code)` que ya no aplica**

En `package.rs`, borrar el `#[allow(dead_code)]` de `fuentes_que_viajan` y su comentario sobre esperar al subsistema 8, que era incorrecto: el propio plan 7b decía que esto le tocaba a él.

- [ ] **Step 6: Escribir el test de `medir_fragmento`**

En el módulo `tests` de `package.rs`:

```rust
    /// El hash cubre TODOS los ficheros del fragmento, no solo uno: un .b1
    /// intacto con su .i8 manipulado tiene que dar un hash distinto.
    #[test]
    fn el_hash_del_fragmento_cubre_todos_sus_ficheros() {
        let d = tempfile::tempdir().unwrap();
        std::fs::write(d.path().join("m-1.b1"), b"aaaa").unwrap();
        std::fs::write(d.path().join("m-1.i8"), b"bbbb").unwrap();
        let (bytes, h1) = medir_fragmento(d.path()).unwrap();
        assert_eq!(bytes, 8);

        std::fs::write(d.path().join("m-1.i8"), b"cccc").unwrap();
        let (_, h2) = medir_fragmento(d.path()).unwrap();
        assert_ne!(h1, h2);
    }
```

- [ ] **Step 7: Comprobar**

Run: `cd indexer/src-tauri && cargo test && cargo clippy -- -D warnings`
Expected: 44 passed; clippy limpio.

- [ ] **Step 8: Commit**

```bash
git add indexer/src-tauri/src/lib.rs indexer/src-tauri/src/package.rs
git commit -m "El paquete declara que teselas lleva y de que origenes, en vez de un {} vacio"
```

---

## Task 5: La leyenda del mapa

La tabla de ficheros del plan 7b, línea 116, dice: `AvailabilityPanel.tsx` — *"los interruptores **y la leyenda**"*. Los interruptores están; la leyenda no se construyó. Sin ella el mapa muestra tres opacidades distintas del mismo color y nada que diga cuál es cuál.

**Files:**
- Create: `indexer/src/territory/MapLegend.tsx`
- Modify: `indexer/src/territory/TerritoryView.tsx`

**Interfaces:**
- Consumes: `activos: Set<string>` y `color(id)` de `../lib/origenes`
- Produces: `<MapLegend activos={Set<string>} />`

- [ ] **Step 1: Escribir la leyenda**

Crear `indexer/src/territory/MapLegend.tsx`:

```tsx
import { color } from "../lib/origenes";

/** Las cuatro marcas que el mapa puede pintar. Se elige un origen de muestreo
 *  activo para las dos muestras de sombreado, en vez de un color fijo: enseñar
 *  la escala en un color que no está en pantalla no explica nada. */
export function MapLegend({ activos }: { activos: Set<string> }) {
  const deMuestreo = [...activos].find((id) => id !== "mapillary" && id !== "mapbox-satelite");
  const c = deMuestreo ? color(deMuestreo) : "#6a6c70";

  return (
    <div className="absolute bottom-[22px] right-4 z-20 rounded-card border border-white/[.13]
      bg-[rgba(16,19,25,.72)] px-3.5 py-[11px] shadow-lg shadow-black/40 backdrop-blur-xl">
      <p className="text-[8.5px] uppercase tracking-[.13em] text-subtle">Leyenda</p>
      <div className="mt-2.5 flex gap-[18px]">
        <div className="flex flex-col gap-1.5">
          <Marca forma="punto" color={color("mapillary")} texto="punto con foto" />
          <Marca forma="cuadro" color={c} opacidad={0.3} texto="tesela con mucho" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Marca forma="cuadro" color={c} opacidad={0.13} texto="tesela con poco" />
          <Marca forma="punteado" texto="sin indexar por nadie" />
        </div>
      </div>
    </div>
  );
}

function Marca({ forma, color, opacidad, texto }: {
  forma: "punto" | "cuadro" | "punteado";
  color?: string;
  opacidad?: number;
  texto: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <span
        className="shrink-0"
        style={{
          width: 9,
          height: 9,
          borderRadius: forma === "punto" ? 999 : 2,
          background: forma === "punteado" ? "transparent" : color,
          opacity: opacidad ?? 1,
          border: forma === "punteado" ? "1px dashed rgba(154,154,149,.42)" : undefined,
        }}
      />
      <span className="text-[10.5px] text-muted">{texto}</span>
    </div>
  );
}
```

- [ ] **Step 2: Montarla en el territorio**

En `TerritoryView.tsx`, añadir el import junto a los demás de `./`:

```tsx
import { MapLegend } from "./MapLegend";
```

Y renderizarla junto al `AvailabilityPanel`, con la misma condición — la leyenda solo tiene sentido cuando hay algo dibujado que leer:

```tsx
      {clasificacion && !mostrarPlan && <MapLegend activos={activos} />}
```

- [ ] **Step 3: Comprobar**

Run: `cd indexer && npx tsc -b --noEmit && npm run lint && npm run build`
Expected: sin errores.

- [ ] **Step 4: Commit**

```bash
git add indexer/src/territory/MapLegend.tsx indexer/src/territory/TerritoryView.tsx
git commit -m "La leyenda del mapa, sin la que tres opacidades del mismo color no dicen nada"
```

---

## Task 6: El registro de la descarga

La tabla de ficheros del plan 7b, línea 119, dice: `DownloadView.tsx` — *"progreso por origen **y registro**"*. El progreso por origen está; el registro no. Hoy `DownloadView` enseña una sola línea (`p.ultimo`), así que el operador no ve la secuencia de teselas ni las anotaciones que distinguen un **resultado** ("2 no decodifican, se anotan y se saltan") de una **avería** ("avería de red, el lote vuelve una vez"). Esa distinción es una de las decisiones centrales del 7a y ahora mismo es invisible.

El backend ya mantiene el texto en `ProgresoDescarga.ultimo`; lo que falta es guardar la serie en vez del último.

**Files:**
- Modify: `indexer/src-tauri/src/download.rs`
- Modify: `indexer/src/lib/api.ts`
- Modify: `indexer/src/download/DownloadView.tsx`

**Interfaces:**
- Consumes: `ProgresoDescarga`
- Produces: `ProgresoDescarga` gana `pub registro: Vec<String>` (en TypeScript `registro: string[]`), con las líneas más recientes al final. `ultimo` se conserva para no romper a quien ya lo lee.

- [ ] **Step 1: Escribir el test que falla**

En el módulo `tests` de `download.rs`:

```rust
    /// El registro conserva la serie, no solo la última línea, y tiene tope:
    /// una indexación de días no puede crecer sin límite en memoria.
    #[test]
    fn el_registro_conserva_la_serie_y_tiene_tope() {
        let mut p = ProgresoDescarga::default();
        for n in 0..(TOPE_REGISTRO + 20) {
            apuntar_en(&mut p, format!("línea {n}"));
        }
        assert_eq!(p.registro.len(), TOPE_REGISTRO);
        // Se tira lo viejo, no lo nuevo: lo que acaba de pasar es lo que se mira.
        assert_eq!(p.registro.last().unwrap(), &format!("línea {}", TOPE_REGISTRO + 19));
        assert_eq!(p.ultimo, format!("línea {}", TOPE_REGISTRO + 19));
    }
```

- [ ] **Step 2: Ejecutar el test y comprobar que falla**

Run: `cd indexer/src-tauri && cargo test el_registro_conserva_la_serie`
Expected: FAIL — `cannot find value TOPE_REGISTRO in this scope`

- [ ] **Step 3: Implementarlo**

En `download.rs`, añadir la constante y la función junto a la definición de `ProgresoDescarga`:

```rust
/// Mismo criterio que el log de servicios: tope en memoria, sin fichero. El
/// techo es que una descarga patológica pierde el principio; la salida, si
/// alguna vez duele, es escribirlo a disco como hace el runner del daemon.
pub const TOPE_REGISTRO: usize = 500;

fn apuntar_en(p: &mut ProgresoDescarga, linea: String) {
    if p.registro.len() >= TOPE_REGISTRO {
        p.registro.remove(0);
    }
    p.ultimo = linea.clone();
    p.registro.push(linea);
}
```

Añadir el campo a la estructura:

```rust
    pub registro: Vec<String>,
```

Y en el método `anotar` del planificador, sustituir la asignación directa de `ultimo` por la llamada a `apuntar_en`, para que haya un solo sitio que decida cómo se apunta.

- [ ] **Step 4: Ejecutar el test y comprobar que pasa**

Run: `cd indexer/src-tauri && cargo test && cargo clippy -- -D warnings`
Expected: 45 passed; clippy limpio.

- [ ] **Step 5: Añadir el campo al tipo del frontend**

En `indexer/src/lib/api.ts`, dentro de `ProgresoDescarga`:

```ts
  registro: string[];
```

- [ ] **Step 6: Pintarlo**

En `DownloadView.tsx`, sustituir el bloque de `p.ultimo`:

```tsx
        {p.ultimo && (
          <p className="mt-5 font-mono text-[10px] leading-[1.9] text-muted">{p.ultimo}</p>
        )}
```

por el registro con desplazamiento automático:

```tsx
        {p.registro.length > 0 && (
          <>
            <p className="mt-[22px] text-[8.5px] uppercase tracking-[.13em] text-subtle">Registro</p>
            <div className="mt-2 h-[180px] overflow-y-auto rounded-lg border border-border bg-[#0b0d0f] px-3 py-2.5">
              {p.registro.map((l, i) => (
                <p key={i} className="font-mono text-[10px] leading-[1.9] text-muted">{l}</p>
              ))}
              <div ref={(el) => el?.scrollIntoView({ block: "nearest" })} />
            </div>
          </>
        )}
```

- [ ] **Step 7: Comprobar**

Run: `cd indexer && npx tsc -b --noEmit && npm run lint && npm run build`
Expected: sin errores.

- [ ] **Step 8: Commit**

```bash
git add indexer/src-tauri/src/download.rs indexer/src/lib/api.ts indexer/src/download/DownloadView.tsx
git commit -m "El registro de la descarga, que es donde se ve la diferencia entre un resultado y una averia"
```

---

## Task 7: Euros por origen de pago, fotos por origen gratis

Los mockups aprobados (`docs/superpowers/specs/lumi-s7b-mockups.html`, pantalla 3) muestran por cada origen o bien su coste en euros (Google `24,58 €`, Mapbox `4,32 €`) o bien su número de fotos (Commons `598 fotos`). Hoy `DownloadView` solo enseña `hechas/total`, y `ProgresoDescarga.por_origen` es `(fuente, hechas, total)` — ni siquiera transporta el dato.

El gasto por origen ya se apunta en la tabla `gasto` vía `spend::apuntar`. Lo que falta es exponerlo durante la descarga.

**Files:**
- Modify: `indexer/src-tauri/src/download.rs`
- Modify: `indexer/src/lib/api.ts`
- Modify: `indexer/src/download/DownloadView.tsx`

**Interfaces:**
- Consumes: `ProgresoDescarga`
- Produces: `por_origen` pasa de `Vec<(String, u32, u32)>` a `Vec<LineaOrigen>` con `pub struct LineaOrigen { pub fuente: String, pub hechas: u32, pub total: u32, pub imagenes: u32, pub coste_eur: f64 }`. En TypeScript: `interface LineaOrigen { fuente: string; hechas: number; total: number; imagenes: number; coste_eur: number }`.

- [ ] **Step 1: Escribir el test que falla**

En el módulo `tests` de `download.rs`:

```rust
    /// Lo servido y lo gastado se acumulan por origen, no solo en total: sin
    /// esto no se puede decir cuál de los seis se comió el presupuesto.
    #[test]
    fn cada_origen_acumula_sus_imagenes_y_su_coste() {
        let mut p = ProgresoDescarga::default();
        p.por_origen.push(LineaOrigen { fuente: "google".into(), hechas: 0, total: 4, imagenes: 0, coste_eur: 0.0 });

        sumar_a_origen(&mut p, "google", 12, 0.65);
        sumar_a_origen(&mut p, "google", 8, 0.43);

        let l = &p.por_origen[0];
        assert_eq!(l.imagenes, 20);
        assert!((l.coste_eur - 1.08).abs() < 1e-9);
    }
```

- [ ] **Step 2: Ejecutar el test y comprobar que falla**

Run: `cd indexer/src-tauri && cargo test cada_origen_acumula`
Expected: FAIL — `cannot find struct LineaOrigen in this scope`

- [ ] **Step 3: Implementarlo**

En `download.rs`, sustituir el tipo del campo `por_origen` y añadir:

```rust
#[derive(Debug, Clone, Default, serde::Serialize)]
pub struct LineaOrigen {
    pub fuente: String,
    pub hechas: u32,
    pub total: u32,
    /// Cuántas imágenes sirvió de verdad. Es lo que se enseña en los gratuitos,
    /// donde el euro no dice nada.
    pub imagenes: u32,
    pub coste_eur: f64,
}

fn sumar_a_origen(p: &mut ProgresoDescarga, fuente: &str, imagenes: u32, coste_eur: f64) {
    if let Some(l) = p.por_origen.iter_mut().find(|l| l.fuente == fuente) {
        l.imagenes += imagenes;
        l.coste_eur += coste_eur;
    }
}
```

En el planificador, donde hoy se incrementa el contador de teselas hechas, añadir también la llamada a `sumar_a_origen(&mut p, o.id(), n, gastado)` con los valores que ya se calculan (`n` es `caps.len()`, `gastado` es la diferencia de presupuesto).

Actualizar la construcción inicial de `por_origen` para usar la estructura:

```rust
            p.por_origen.push(LineaOrigen {
                fuente: o.id().to_string(),
                hechas: 0,
                total: pendientes.len() as u32,
                imagenes: 0,
                coste_eur: 0.0,
            });
```

- [ ] **Step 4: Ejecutar el test y comprobar que pasa**

Run: `cd indexer/src-tauri && cargo test && cargo clippy -- -D warnings`
Expected: 46 passed; clippy limpio.

- [ ] **Step 5: Actualizar el tipo del frontend**

En `indexer/src/lib/api.ts`:

```ts
export interface LineaOrigen {
  fuente: string; hechas: number; total: number; imagenes: number; coste_eur: number;
}
```

y en `ProgresoDescarga`, sustituir `por_origen: [string, number, number][]` por `por_origen: LineaOrigen[]`.

- [ ] **Step 6: Pintarlo**

En `DownloadView.tsx`, sustituir el `map` de la tabla por origen:

```tsx
            {p.por_origen.map((l) => (
              <tr key={l.fuente} className="border-t border-border">
                <td className="w-[35%] py-2">
                  <span className="flex items-center gap-2.5">
                    <span className="h-[9px] w-[9px] rounded-full" style={{ background: color(l.fuente) }} />
                    {nombre(l.fuente)}
                  </span>
                </td>
                <td className="py-2">
                  <span className="block h-[5px] w-[150px] overflow-hidden rounded-[3px] bg-elevated">
                    <i className="block h-full"
                      style={{ width: `${l.total ? (l.hechas / l.total) * 100 : 0}%`, background: color(l.fuente) }} />
                  </span>
                </td>
                <td className="py-2 text-right font-mono text-muted">{l.hechas}/{l.total}</td>
                {/* En los de pago manda el euro; en los gratuitos el euro es
                    siempre 0,00 y lo que informa es cuánto material trajeron. */}
                <td className={`py-2 text-right font-mono ${l.coste_eur > 0 ? "text-warning-fg" : "text-subtle"}`}>
                  {l.coste_eur > 0 ? eur(l.coste_eur) : `${l.imagenes} fotos`}
                </td>
              </tr>
            ))}
```

- [ ] **Step 7: Comprobar**

Run: `cd indexer && npx tsc -b --noEmit && npm run lint && npm run build`
Expected: sin errores.

- [ ] **Step 8: Commit**

```bash
git add indexer/src-tauri/src/download.rs indexer/src/lib/api.ts indexer/src/download/DownloadView.tsx
git commit -m "Por origen, el euro en los de pago y el material en los gratuitos"
```

---

## Task 8: Filtrar la revisión por fuente

Los mockups (pantalla 4) enseñan una fila de filtros sobre la rejilla: `todas · Commons · 598 · Flickr · 2 049`. Con miles de fotos de dos proveedores mezcladas, revisar sin poder aislar una fuente es innecesariamente costoso: el ruido de Flickr y el de Commons no se parecen, y verlos juntos obliga a cambiar de criterio en cada foto.

**Files:**
- Modify: `indexer/src/review/ReviewGrid.tsx`

**Interfaces:**
- Consumes: `FichaRevision { id, ruta, fuente, licencia }` — ya trae `fuente`.
- Produces: nada hacia fuera.

- [ ] **Step 1: Añadir el estado y el recuento**

En `ReviewGrid.tsx`, junto a los demás `useState`:

```tsx
  const [soloFuente, setSoloFuente] = useState<string | null>(null);
```

Y tras ellos, el recuento por fuente y la lista visible:

```tsx
  // El recuento es sobre TODAS las fichas, no sobre las visibles: un filtro que
  // cambia sus propios números al aplicarse no se puede leer.
  const porFuente = new Map<string, number>();
  for (const f of fichas) porFuente.set(f.fuente, (porFuente.get(f.fuente) ?? 0) + 1);
  const visibles = soloFuente ? fichas.filter((f) => f.fuente === soloFuente) : fichas;
```

- [ ] **Step 2: Pintar la fila de filtros**

Sustituir la línea de ayuda:

```tsx
        <p className="mb-3 text-[10.5px] text-subtle">
          clic para descartar · <b className="font-normal text-fg">May</b>+clic para un rango
        </p>
```

por la fila de filtros más la ayuda:

```tsx
        <div className="mb-3 flex items-center gap-1.5">
          <Chip on={soloFuente === null} onClick={() => setSoloFuente(null)}>
            todas · {fichas.length}
          </Chip>
          {[...porFuente].map(([f, n]) => (
            <Chip key={f} on={soloFuente === f} onClick={() => setSoloFuente(f)}>
              {nombre(f)} · {n}
            </Chip>
          ))}
          <span className="flex-1" />
          <span className="text-[10.5px] text-subtle">
            clic para descartar · <b className="font-normal text-fg">May</b>+clic para un rango
          </span>
        </div>
```

- [ ] **Step 3: Escribir el `Chip` y ajustar la rejilla**

Al final del fichero:

```tsx
function Chip({ on, onClick, children }: {
  on: boolean; onClick: () => void; children: React.ReactNode;
}) {
  return (
    <button onClick={onClick} aria-pressed={on}
      className={`jg-press rounded-lg border px-2.5 py-1 text-[10.5px] transition-colors
        ${on ? "border-white/[.28] text-fg" : "border-border text-subtle hover:text-fg"}`}>
      {children}
    </button>
  );
}
```

Importar `nombre`:

```tsx
import { nombre } from "../lib/origenes";
```

En la rejilla, cambiar `fichas.map(...)` por `visibles.map(...)`.

**Cuidado con el rango:** `clic(i, conMayus)` indexa contra `fichas`, no contra `visibles`. Con el filtro puesto, un `May`+clic descartaría fotos equivocadas. Cambiar la firma para que reciba la lista visible:

```tsx
  function clic(lista: FichaRevision[], i: number, conMayus: boolean) {
    const nuevos = new Set(fuera);
    const desde = conMayus && ultimo !== null ? Math.min(ultimo, i) : i;
    const hasta = conMayus && ultimo !== null ? Math.max(ultimo, i) : i;
    for (let k = desde; k <= hasta; k++) {
      const id = lista[k].id;
      if (nuevos.has(id)) nuevos.delete(id); else nuevos.add(id);
    }
    setUltimo(i);
    setFuera(nuevos);
  }
```

y en el botón: `onClick={(ev) => clic(visibles, i, ev.shiftKey)}`.

Al cambiar de filtro hay que olvidar el ancla del rango, o un `May`+clic uniría dos listas distintas. En cada `setSoloFuente(...)`, llamar también a `setUltimo(null)`.

- [ ] **Step 4: Comprobar**

Run: `cd indexer && npx tsc -b --noEmit && npm run lint && npm run build`
Expected: sin errores.

- [ ] **Step 5: Commit**

```bash
git add indexer/src/review/ReviewGrid.tsx
git commit -m "Filtrar la revision por fuente, porque el ruido de cada proveedor no se parece"
```

---

## Task 9: Dar superficie a la cola de embebido

`cola_progreso` y `cola_pausar` están registrados y funcionan, y **ningún sitio del frontend los llama**. La cola de embebido —pieza central del 7a— corre invisible: el operador ingiere una carpeta, la cola trabaja durante horas contra la GPU, y la interfaz no dice ni que está pasando ni cuánto falta.

**Files:**
- Modify: `indexer/src/lib/api.ts`
- Create: `indexer/src/ui/QueueBar.tsx`
- Modify: `indexer/src/App.tsx`

**Interfaces:**
- Consumes: comandos `cola_progreso` y `cola_pausar` ya registrados en `lib.rs:110,115`
- Produces: `<QueueBar />`, que se pinta sola y no recibe props.

- [ ] **Step 1: Enlazar los comandos**

`queue::Progreso` (`indexer/src-tauri/src/queue.rs:37`) ya está definido y no hay que tocarlo. Su equivalente exacto en `indexer/src/lib/api.ts`:

```ts
export interface ProgresoCola {
  trabajando: boolean;
  pausada: boolean;
  lote_actual: number | null;
  hechas: number;
  total: number;
  dispositivo: string;
  modelo: string | null;
  saltadas: number;
  reinicios: number;
}
```

y los dos enlaces:

```ts
  colaProgreso: () => invoke<ProgresoCola>("cola_progreso"),
  colaPausar: (pausada: boolean) => invoke<void>("cola_pausar", { pausada }),
```

- [ ] **Step 2: Escribir la barra**

Crear `indexer/src/ui/QueueBar.tsx`:

```tsx
import { useEffect, useState } from "react";

import { api, type ProgresoCola } from "../lib/api";

/** La cola de embebido, visible. Aparece solo cuando hay trabajo: una barra
 *  permanente al 100 % es ruido, y el sondeo termina cuando el trabajo
 *  termina — misma lección que el paso de servicios y que la descarga. */
export function QueueBar() {
  const [p, setP] = useState<ProgresoCola | null>(null);

  useEffect(() => {
    const t = setInterval(() => { void api.colaProgreso().then(setP); }, 1200);
    return () => clearInterval(t);
  }, []);

  if (!p || (!p.trabajando && p.hechas === 0)) return null;
  const pct = p.total ? (p.hechas / p.total) * 100 : 0;

  // `pausada` sale del backend, que es quien manda: un estado local aquí sería
  // una segunda fuente de verdad, y quedaría mintiendo en cuanto la cola se
  // pausara por cualquier otra vía.
  async function alternar() {
    await api.colaPausar(!p!.pausada);
    setP(await api.colaProgreso());
  }

  return (
    <div className="flex shrink-0 items-center gap-3 border-t border-border bg-[rgba(16,18,21,.6)] px-4 py-2">
      <span className="text-[10.5px] text-subtle">
        {p.pausada ? "Embebido en pausa" : p.trabajando ? "Embebiendo" : "Embebido al día"}
      </span>
      <span className="h-1 flex-1 overflow-hidden rounded-[2px] bg-elevated">
        <i className="block h-full bg-fg transition-[width] duration-500" style={{ width: `${pct}%` }} />
      </span>
      <span className="font-mono text-[10px] text-muted">{p.hechas}/{p.total}</span>
      {p.saltadas > 0 && (
        // Una saltada es un RESULTADO ya anotado, no un fallo pendiente.
        <span className="font-mono text-[10px] text-subtle">{p.saltadas} saltadas</span>
      )}
      {p.reinicios > 0 && (
        // Un reinicio es una AVERÍA que ya se recuperó. Se enseña porque un
        // trabajador que se muere repetidamente es un síntoma, no un detalle.
        <span className="font-mono text-[10px] text-warning-fg">{p.reinicios} reinicios</span>
      )}
      <button onClick={() => void alternar()}
        className="jg-press rounded-lg border border-border px-2.5 py-1 text-[10.5px] text-fg">
        {p.pausada ? "Reanudar" : "Pausar"}
      </button>
    </div>
  );
}
```

- [ ] **Step 3: Montarla**

En `App.tsx`, importar:

```tsx
import { QueueBar } from "./ui/QueueBar";
```

y colocarla al pie del área de trabajo, dentro del bloque `dentro &&`, envolviendo el contenedor de vistas en una columna:

```tsx
            <div className="absolute inset-y-0 left-11 right-0 flex flex-col">
              <div className="relative min-h-0 flex-1">
                {/* …las vistas existentes, sin cambios… */}
              </div>
              <QueueBar />
            </div>
```

- [ ] **Step 4: Comprobar**

Run: `cd indexer && npx tsc -b --noEmit && npm run lint && npm run build`
Expected: sin errores.

- [ ] **Step 5: Commit**

```bash
git add indexer/src/lib/api.ts indexer/src/ui/QueueBar.tsx indexer/src/App.tsx
git commit -m "La cola de embebido, visible: llevaba desde el 7a corriendo sin que nadie la viera"
```

---

## Task 10: Los cosméticos que quedaron sueltos

Tres restos que la auditoría encontró. Van juntos porque ninguno merece su propio ciclo de revisión.

**Files:**
- Modify: `indexer/src-tauri/src/lib.rs` (struct `DetalleIndice`, comando `indice_detalle`)
- Modify: `indexer/src/lib/api.ts`
- Modify: `indexer/src/catalog/IndexDetail.tsx`
- Modify: `indexer/src/territory/MapCanvas.tsx`
- Modify: `indexer/src-tauri/src/origins/mapillary.rs`

- [ ] **Step 1: Que el diálogo de sellado diga el nombre y no el número**

`IndexDetail.tsx:35` pasa `nombre={String(id)}`, así que el diálogo dice «Sellar «7»». `DetalleIndice` nunca incluyó el nombre.

En `lib.rs`, añadir el campo a la estructura:

```rust
#[derive(serde::Serialize)]
struct DetalleIndice {
    nombre: String,
    imagenes: lumi_index::manifest::PorcentajesImagenes,
    trabajo: Vec<(String, u32, f64)>,
}
```

y rellenarlo en `indice_detalle` leyendo el índice del almacén. Si `Almacen` no expone una lectura de un índice por id, usar la que ya existe para listar y quedarse con el que coincide:

```rust
    let nombre = estado
        .almacen
        .listar_indices()
        .map_err(|e| e.to_string())?
        .into_iter()
        .find(|(i, ..)| *i == id)
        .map(|(_, n, ..)| n)
        .unwrap_or_default();
```

En `api.ts`, añadir `nombre: string;` a `DetalleIndice`. En `IndexDetail.tsx`, sustituir `nombre={String(id)}` por `nombre={detalle.nombre}`.

- [ ] **Step 2: Una sola URL de teselas de Mapillary**

`MapCanvas.tsx` tiene la URL escrita a mano y `mapillary.rs` tiene la misma en una constante marcada `#[allow(dead_code)]` porque nadie la usaba. Dos copias de una URL de un tercero se desincronizan.

El frontend no puede leer una constante de Rust, así que la copia que se queda es la del frontend, y la de Rust se borra. En `mapillary.rs`, eliminar `URL_TESELAS_VECTORIALES` y `CAPA_VECTORIAL` con sus `#[allow(dead_code)]`.

En `MapCanvas.tsx`, dejar constancia de por qué vive ahí, junto a la definición de la fuente `mly`:

```tsx
          // La URL vive aquí y solo aquí: estas teselas las pide el navegador
          // directamente a Mapillary, nunca el backend, así que una constante
          // en Rust solo sería una segunda copia que se desincroniza.
```

- [ ] **Step 3: Comprobar**

Run: `cd indexer/src-tauri && cargo test && cargo clippy -- -D warnings`
Expected: 46 passed; clippy limpio.

Run: `cd indexer && npx tsc -b --noEmit && npm run lint && npm run build`
Expected: sin errores.

- [ ] **Step 4: Commit**

```bash
git add indexer/src-tauri/src/lib.rs indexer/src-tauri/src/origins/mapillary.rs indexer/src/lib/api.ts indexer/src/catalog/IndexDetail.tsx indexer/src/territory/MapCanvas.tsx
git commit -m "El nombre del indice al sellar, y una sola copia de la URL de Mapillary"
```

---

## Qué NO cubre este plan

Igual que el 7b, hay cosas que ninguna suite automática puede certificar y que quedan para verificación manual con clave real y conexión:

- Que los campos que Commons y Flickr devuelven de verdad se llamen como este plan supone (`width`/`height` en `imageinfo` con `iiprop=size`; `width_l`/`height_l`/`accuracy`/`tags` en los `extras` de Flickr). Si un nombre no coincide, `#[serde(default)]` lo deja a cero y el filtro descartaría todo por «demasiado pequeña». **Comprobación obligatoria en la primera descarga real de cada uno de esos dos orígenes.**
- Que el umbral de 100 m traducido desde la escala de Flickr descarte lo que debe y no más.
- Que el `cobertura.json` que ahora sí se escribe lo lea correctamente `territorio_clasificar` al instalar un paquete sellado por otra máquina.
- La franja de la cola de embebido con una GPU de verdad trabajando.

Y una decisión que este plan deja explícitamente fuera: `Cobertura.atribucion` se escribe con los tres campos vacíos. La atribución del índice como obra —quién lo publica, bajo qué licencia— es la pregunta de identidad del publicador que el subsistema 8 (catálogo) tiene que resolver, y rellenarla ahora con un valor inventado sería peor que dejarla vacía.
