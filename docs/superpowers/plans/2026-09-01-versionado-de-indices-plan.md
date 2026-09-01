# Versionado de índices — plan de implementación

> Spec: [2026-09-01-versionado-de-indices-design.md](../specs/2026-09-01-versionado-de-indices-design.md).
> Proyecto: Lumi Indexer (`indexer/`, `indexer/src-tauri/`, `crates/lumi-index/`).

**Goal:** Colapsar `numero_version` a una sola línea de tiempo por índice. Un índice de trabajo
crece sin límite ni clonado; "versión" pasa a significar únicamente "el corte publicado número
N", con publicación incremental automática (solo la diferencia desde el corte anterior).

**Arquitectura:** Se borra el clonado (`versions.rs`, `crear_version`/`clonar_version`, la
columna `viene_de`, el "techo" que impedía a un hijo indexar fuera del territorio de su padre).
`publicar()` gana lógica de diferencia: guarda cada ficha publicada localmente
(`propias_fichas`), y al publicar de nuevo compara contra la última guardada para incluir solo
teselas/capas nuevas. `Ficha` gana `version_anterior: Option<String>` para encadenar hacia atrás.

**Tech Stack:** Rust (Tauri backend, SQLite vía `rusqlite`), TypeScript/React (frontend).

## Global Constraints

- **No tests unless explicitly requested** (convención del proyecto, `CLAUDE.md` /
  `workflow/PROJECT-CONVENTIONS.md`) — la única excepción existente es
  `cargo test -p lumi-proto`, que esta spec no toca. Los tests YA EXISTENTES que cubren el
  clonado (`store.rs`, ver Tarea 1) se BORRAN junto con el código que prueban, no se dejan
  huérfanos ni se adaptan.
- **`ponytail`**: no añadir abstracciones nuevas más allá de lo que esta spec pide. No crear
  tipos genéricos "por si acaso" para representar `(modelo, version)` — ese problema es de otra
  spec (ver "Fuera de alcance" en el diseño) y no se toca aquí.
- Compilar y verificar tras cada tarea: `cargo build -p lumi-index` y
  `cargo build --manifest-path indexer/src-tauri/Cargo.toml` para Rust,
  `cd indexer && npx tsc -b --noEmit` para TypeScript. Ningún paso queda sin verificar.
- Idioma de comentarios y mensajes de commit: español, mismo estilo que el resto del repo
  (explican el PORQUÉ, no el qué).
- Un solo commit al final de todo el plan (convención del proyecto: "un commit por feature
  terminada", no commits intermedios) — NO commitear tarea a tarea.

---

### Tarea 1: Borrar el clonado de versiones

**Files:**
- Modify: `indexer/src-tauri/src/store.rs`
- Delete: `indexer/src-tauri/src/versions.rs`
- Modify: `indexer/src-tauri/src/lib.rs`
- Modify: `indexer/src-tauri/src/main.rs` (o donde esté el `mod versions;` y el registro del
  comando `version_crear` en `tauri::generate_handler![...]`)

**Interfaces:**
- Produces: `Almacen::genealogia(indice_id) -> Result<u32>` (antes devolvía
  `(Option<i64>, u32)` — el primer elemento, `viene_de`, desaparece; el segundo,
  `numero_version`, se queda igual).

- [ ] **Paso 1.1 — `store.rs`: quitar `viene_de`, simplificar `genealogia`, borrar el clonado**

  Borrar por completo:
  - `pub struct ClonVersion { ... }` (líneas 204-213 en la lectura actual).
  - `pub fn crear_version(&self, padre_id: i64, nombre: &str, slug: &str, numero_version: u32) -> Result<i64>`
    (línea 392 y su cuerpo).
  - `pub fn clonar_version(&self, padre_id: i64, nueva_id: i64) -> Result<ClonVersion>`
    (línea 634 y su cuerpo, hasta el `Ok(ClonVersion { imagenes, vectores_hechos })` de la línea
    741).
  - Los dos tests que cubren esto (`crear_version_no_toca_al_padre_y_encadena_el_numero`,
    línea ~1703, y `clonar_version_copia_el_contenido_logico_del_padre`, línea ~1720) — el
    proyecto no deja tests huérfanos de código borrado.

  Cambiar `genealogia`:
  ```rust
  /// `numero_version` de un índice — cuántas veces se ha publicado. `1` para
  /// cualquier índice que no se haya publicado todavía.
  pub fn genealogia(&self, indice_id: i64) -> Result<u32> {
      self.0.lock().unwrap().query_row(
          "SELECT numero_version FROM indices WHERE id = ?1",
          [indice_id],
          |r| r.get(0),
      ).map_err(Into::into)
  }
  ```
  (firma exacta a confirmar contra el cuerpo real de la función actual — el cambio es: quitar
  `viene_de` del `SELECT` y del tipo de retorno, todo lo demás igual).

  Dejar la columna física `viene_de` en el `ALTER TABLE` de la migración (línea 256) tal cual
  está — no se borra una columna SQLite existente sin necesidad; simplemente deja de leerse y
  escribirse en ningún sitio del código Rust. Comentar la línea de la migración explicando que
  ya no se usa:
  ```rust
  // `viene_de` ya no se escribe ni se lee — el clonado de versiones se quitó
  // (spec de versionado 2026-09-01). Se deja la columna física porque borrar
  // una columna SQLite existente no compensa el riesgo frente a simplemente
  // no tocarla.
  "ALTER TABLE indices ADD COLUMN viene_de INTEGER REFERENCES indices(id)",
  ```

- [ ] **Paso 1.2 — Borrar `indexer/src-tauri/src/versions.rs` entero**

  El archivo completo (`crear`, `hardlinkear_ficheros`, `duplicar_vectores`) deja de tener
  ninguna función que lo llame tras el paso 1.3. Borrar el fichero y su `mod versions;`
  (buscar en `main.rs` o `lib.rs`, donde estén declarados los módulos del crate).

- [ ] **Paso 1.3 — `lib.rs`: borrar el comando Tauri y limpiar `viene_de`/el techo**

  Borrar el comando:
  ```rust
  /// «Crear versión nueva»: clona un índice sellado en una fila nueva, abierta,
  /// con el mismo contenido lógico. Ver `versions::crear`.
  #[tauri::command]
  async fn version_crear(estado: tauri::State<'_, Estado>, padre_id: i64) -> Result<i64, String> {
      versions::crear(&estado, padre_id).await.map_err(|e| e.to_string())
  }
  ```
  y su entrada en `tauri::generate_handler![...]` (en `main.rs`).

  Borrar `exige_dentro_del_techo` entera (líneas 370-397) y sus tres llamadas:
  - `territorio_heredar` (línea 737): quitar la línea `exige_dentro_del_techo(&estado, indice_id, &quadkeys)?;`.
  - `descarga_arrancar` (línea 810): quitar la línea `exige_dentro_del_techo(&estado, indice_id, &todas_las_quadkeys)?;`.
  - El sellado (función que contiene el bloque de las líneas 1024-1050): reemplazar
    ```rust
    let (viene_de, _) = almacen.genealogia(indice_id).map_err(|e| e.to_string())?;
    let fuera_de_techo = if viene_de.is_some() {
        // ... cálculo del hueco ...
    } else {
        Vec::new()
    };
    let informe = package::Informe { filas: esperadas, por_modelo, cuadra, fuera_de_techo };
    ```
    por
    ```rust
    let informe = package::Informe { filas: esperadas, por_modelo, cuadra };
    ```

  En `DetalleIndice` (struct, líneas 430-442): quitar el campo `viene_de: Option<i64>` y su
  doc-comment sobre genealogía; `numero_version` se queda. En `indice_detalle` (línea 445-466):
  cambiar
  ```rust
  let (viene_de, numero_version) = estado.almacen.genealogia(id).map_err(|e| e.to_string())?;
  Ok(DetalleIndice { ..., numero_version, viene_de })
  ```
  por
  ```rust
  let numero_version = estado.almacen.genealogia(id).map_err(|e| e.to_string())?;
  Ok(DetalleIndice { ..., numero_version })
  ```

  En `territorio_clasificar` (línea 660-724): quitar el parámetro `indice_id: Option<i64>` de la
  firma del comando (ya no hace falta, el techo que lo justificaba desaparece) y todo el bloque
  ```rust
  if let Some(id) = indice_id {
      let (viene_de, _) = estado.almacen.genealogia(id).map_err(|e| e.to_string())?;
      if viene_de.is_some() {
          // ... pintar el techo ...
      }
  }
  ```
  (líneas 699-718).

**Steps 1.1-1.3 se verifican juntas** (el crate no compila en un estado intermedio consistente):

- [ ] **Paso 1.4 — Compilar**

  Run: `cargo build --manifest-path indexer/src-tauri/Cargo.toml`
  Expected: compila sin error. Cualquier referencia residual a `viene_de`/`ClonVersion`/
  `versions::`/`exige_dentro_del_techo` que el compilador señale es una llamada que faltó por
  actualizar en este mismo paso.

---

### Tarea 2: `package.rs` — quitar `fuera_de_techo` del informe de sellado

**Files:**
- Modify: `indexer/src-tauri/src/package.rs`

**Interfaces:**
- Consumes: nada de la Tarea 1 (independiente en compilación, pero lógicamente sigue a 1.3 porque
  `lib.rs` construye este struct).
- Produces: `Informe` sin el campo `fuera_de_techo` — la Tarea 1 ya asume esta forma.

- [ ] **Paso 2.1 — Quitar el campo y su comprobación**

  En `pub struct Informe` (líneas 20-33): borrar
  ```rust
  /// Quadkeys con imágenes que NO tenían fila en `teselas` al nacer esta
  /// versión — el techo de la spec de versiones, sección 4. Vacío para
  /// cualquier índice que no venga de otro (`viene_de` es `NULL`). Es la
  /// segunda comprobación, en defensa de profundidad: la primera es
  /// `exige_dentro_del_techo`, al reclamar y al descargar.
  #[serde(default)]
  pub fuera_de_techo: Vec<String>,
  ```

  En `pub fn comprobar(informe: &Informe) -> Result<()>` (líneas 93-111): borrar el bloque
  ```rust
  if !informe.fuera_de_techo.is_empty() {
      bail!(
          "esta versión indexó fuera de su techo — {} no estaban en la versión de la que parte: {}",
          informe.fuera_de_techo.len(),
          informe.fuera_de_techo.join(", "),
      );
  }
  ```

- [ ] **Paso 2.2 — Compilar**

  Run: `cargo build --manifest-path indexer/src-tauri/Cargo.toml`
  Expected: falla en `lib.rs` donde se construye `package::Informe { ..., fuera_de_techo }` —
  eso ya se corrigió en la Tarea 1.3, así que en la práctica Tareas 1 y 2 se hacen en el mismo
  pase antes de compilar la primera vez. Si se hacen en orden estricto, este paso confirma que
  ambas quedaron consistentes entre sí.

---

### Tarea 3: Esquema — historial de publicaciones propias

**Files:**
- Modify: `indexer/src-tauri/src/store.rs`

**Interfaces:**
- Produces:
  - `Almacen::guardar_ficha_propia(&self, indice_id: i64, numero_version: u32, ficha_json: &str, publicada_en: i64) -> Result<()>`
  - `Almacen::ultima_ficha_propia(&self, indice_id: i64) -> Result<Option<(u32, String)>>` — la
    de mayor `numero_version` para ese índice, si existe alguna.
  - `Almacen::limpiar_publicaciones_en_curso(&self, indice_id: i64) -> Result<()>` — borra de la
    tabla `publicaciones` las filas de ese índice (ver Tarea 4, punto sobre por qué hace falta).

- [ ] **Paso 3.1 — Tabla `propias_fichas`**

  Añadir al bloque `ESQUEMA` (junto a `CREATE TABLE IF NOT EXISTS publicaciones`, sección de
  `store.rs` alrededor de la línea 132):
  ```sql
  -- La ficha completa de cada corte publicado de UN índice propio (no de
  -- catálogo remoto — eso ya vive en `fichas_remotas`). Guardarla entera es lo
  -- que permite calcular la diferencia al publicar otra vez sin tener que
  -- volver a pedirle nada a GitHub: la verdad de "qué se publicó la vez N"
  -- vive aquí, local.
  CREATE TABLE IF NOT EXISTS propias_fichas (
    indice_id      INTEGER NOT NULL,
    numero_version INTEGER NOT NULL,
    ficha_json     TEXT    NOT NULL,
    publicada_en   INTEGER NOT NULL,
    PRIMARY KEY (indice_id, numero_version)
  );
  ```

- [ ] **Paso 3.2 — Métodos de acceso**

  Junto a `publicacion_apuntar`/`publicacion_marcar_subido`/`publicacion_plan` (líneas
  1476-1523 aprox.):
  ```rust
  /// Guarda la ficha completa de un corte publicado — la fuente de verdad
  /// para calcular la diferencia la próxima vez que se publique este índice.
  pub fn guardar_ficha_propia(
      &self, indice_id: i64, numero_version: u32, ficha_json: &str, publicada_en: i64,
  ) -> Result<()> {
      self.0.lock().unwrap().execute(
          "INSERT OR REPLACE INTO propias_fichas (indice_id, numero_version, ficha_json, publicada_en)
           VALUES (?1, ?2, ?3, ?4)",
          params![indice_id, numero_version, ficha_json, publicada_en],
      )?;
      Ok(())
  }

  /// La última ficha propia publicada de este índice, si hay alguna —
  /// `(numero_version, ficha_json)`. `None` significa "nunca se ha publicado
  /// esto todavía", no "falló al leer".
  pub fn ultima_ficha_propia(&self, indice_id: i64) -> Result<Option<(u32, String)>> {
      Ok(self.0.lock().unwrap().query_row(
          "SELECT numero_version, ficha_json FROM propias_fichas
           WHERE indice_id = ?1 ORDER BY numero_version DESC LIMIT 1",
          [indice_id],
          |r| Ok((r.get(0)?, r.get(1)?)),
      ).optional()?)
  }

  /// Antes de arrancar una publicación nueva (numero_version > 1): las filas
  /// de `publicaciones` de un corte anterior tienen los mismos NOMBRES de
  /// asset (`cuerpo-0.lumidx.enc`, `ficha.json`...) que va a usar este corte,
  /// así que sin borrarlas `ya_subido` las confundiría con trabajo ya hecho
  /// de ESTE corte y se saltaría la subida real.
  pub fn limpiar_publicaciones_en_curso(&self, indice_id: i64) -> Result<()> {
      self.0.lock().unwrap().execute(
          "DELETE FROM publicaciones WHERE indice_id = ?1", [indice_id],
      )?;
      Ok(())
  }
  ```
  Confirmar que `rusqlite::OptionalExtension` (el `.optional()`) ya está importado en el fichero
  (se usa en otros métodos de lectura de esta misma clase) — si no, añadir el `use`.

- [ ] **Paso 3.3 — Compilar**

  Run: `cargo build --manifest-path indexer/src-tauri/Cargo.toml`
  Expected: compila. Estos métodos todavía no los llama nadie (eso es la Tarea 4), así que un
  warning de "método sin usar" en este punto es esperado y se resuelve en la tarea siguiente, no
  hay que silenciarlo aquí.

---

### Tarea 4: `Ficha` gana `version_anterior`

**Files:**
- Modify: `crates/lumi-index/src/ficha.rs`

**Interfaces:**
- Produces: `Ficha.version_anterior: Option<String>`.

- [ ] **Paso 4.1 — Campo nuevo, con el mismo cuidado de compatibilidad que `numero_version`**

  En `pub struct Ficha` (líneas 60-86), justo debajo de `numero_version`:
  ```rust
  /// Etiqueta de release (ver `etiqueta_de` en `publicar.rs`) de la
  /// publicación anterior de este mismo índice, o `None` si esta es la
  /// primera (`numero_version == 1`). Encadena hacia atrás: cada corte
  /// publicado solo lleva su diferencia desde el anterior (spec de
  /// versionado 2026-09-01), así que reconstruir el estado completo de la
  /// versión N requiere poder llegar hasta la 1 siguiendo este campo.
  #[serde(default, skip_serializing_if = "Option::is_none")]
  pub version_anterior: Option<String>,
  ```
  `Option<T>` con `#[serde(default)]` ya deserializa `None` sin el campo presente, y
  `skip_serializing_if = "Option::is_none"` ya omite el campo cuando es `None` — a diferencia de
  `numero_version`, aquí no hace falta una función `es_ninguna`/`version_uno` a medida: el propio
  tipo `Option` cubre el mismo caso (ficha antigua sin el campo, o v1 sin versión anterior) sin
  código extra.

- [ ] **Paso 4.2 — Compilar**

  Run: `cargo build -p lumi-index`
  Expected: falla en cada sitio que construye un `Ficha { ... }` sin el campo nuevo — son
  `publicar.rs` (Tarea 5) y `publicar_capa` (que ya pone `numero_version: 1` explícito, línea
  754 de la lectura actual; ahí basta con añadir `version_anterior: None,` porque una capa suelta
  sobre un cuerpo ajeno nunca encadena versión — no toca nada de la Tarea 5). Confirmar que
  ambos sitios quedan arreglados antes de pasar a la Tarea 5.

---

### Tarea 5: `publicar()` — corte incremental automático

**Files:**
- Modify: `indexer/src-tauri/src/publicar.rs`

**Interfaces:**
- Consumes: `Almacen::genealogia`, `Almacen::ultima_ficha_propia`,
  `Almacen::guardar_ficha_propia`, `Almacen::limpiar_publicaciones_en_curso` (Tareas 1 y 3);
  `Ficha.version_anterior` (Tarea 4).
- Produces: `publicar()` publica solo la diferencia cuando `numero_version > 1`, y bumpea
  `indices.numero_version` tras el éxito.

Este es el cambio central. `publicar()` (líneas 465-639 de la lectura actual) hoy siempre
empaqueta TODAS las quadkeys/capas del índice, cada vez — correcto para la primera publicación,
pero significa "resubir todo otra vez" si se llamara dos veces sobre el mismo índice (algo que
hoy nunca pasa porque cada "versión" es un índice nuevo por clonado; a partir de esta spec, sí
puede pasar).

- [ ] **Paso 5.1 — Leer la ficha anterior y calcular qué es nuevo**

  Justo después de `let (_, numero_version) = almacen.genealogia(indice_id)?;` (línea 486; tras
  la Tarea 1 pasa a ser `let numero_version = almacen.genealogia(indice_id)?;`), añadir:
  ```rust
  // Cuáles quadkeys y qué capas (modelo, version) ya se publicaron en el
  // corte anterior — lo que NO está aquí es lo único que entra en el cuerpo
  // de esta publicación. Ninguna si esta es la primera vez.
  let anterior: Option<(u32, lumi_index::ficha::Ficha)> = almacen
      .ultima_ficha_propia(indice_id)?
      .and_then(|(v, json)| serde_json::from_str(&json).ok().map(|f| (v, f)));
  let quadkeys_ya_publicadas: std::collections::HashSet<String> = anterior
      .as_ref()
      .map(|(_, f)| f.fuentes_por_quadkey.iter().map(|(qk, _)| qk.clone()).collect())
      .unwrap_or_default();
  let capas_ya_publicadas: std::collections::HashSet<(String, String)> = anterior
      .as_ref()
      .map(|(_, f)| f.capas.iter().map(|c| (c.modelo.clone(), c.version.clone())).collect())
      .unwrap_or_default();
  let etiqueta_anterior: Option<String> =
      anterior.as_ref().map(|(v, _)| etiqueta_de(&paquete, *v));

  // Los nombres de asset de un corte anterior (`cuerpo-0.lumidx.enc`,
  // `ficha.json`...) colisionan con los de este — sin limpiar, `ya_subido`
  // (más abajo) los confundiría con trabajo ya hecho de ESTE corte.
  if numero_version > 1 {
      almacen.limpiar_publicaciones_en_curso(indice_id)?;
  }
  ```
  Nota de orden: `paquete` (el nombre del directorio del paquete sellado) ya está calculado unas
  líneas antes (línea 481) — este bloque va DESPUÉS de esa asignación, no antes.

- [ ] **Paso 5.2 — Filtrar quadkeys nuevas antes de trocear**

  El bloque que construye `por_qk`/`fuentes_por_quadkey` (líneas 525-537) itera
  `almacen.imagenes_de_indice(indice_id)?` sin distinguir qué es nuevo. Cambiar el filtro para
  que solo entren quadkeys que NO estén en `quadkeys_ya_publicadas`:
  ```rust
  let mut por_qk: BTreeMap<String, Vec<String>> = BTreeMap::new();
  let mut fuentes_por_quadkey: Vec<(String, Vec<String>)> = Vec::new();
  for (id, r, qk) in almacen.imagenes_de_indice(indice_id)? {
      if !viajan.contains(&id) || quadkeys_ya_publicadas.contains(&qk) {
          continue;
      }
      if let Some(n) = Path::new(&r).file_name() {
          por_qk.entry(qk).or_default().push(n.to_string_lossy().to_string());
      }
  }
  for qk in por_qk.keys() {
      fuentes_por_quadkey.push((qk.clone(), crate::package::fuentes_que_viajan(&publicables, qk)));
  }
  ```

- [ ] **Paso 5.3 — Filtrar capas nuevas**

  El bucle `for (modelo, version, dims) in modelos_del_paquete(&raiz)` (línea 566): añadir al
  principio del cuerpo del bucle
  ```rust
  if capas_ya_publicadas.contains(&(modelo.clone(), version.clone())) {
      continue;
  }
  ```

- [ ] **Paso 5.4 — `Ficha.fuentes_por_quadkey` de esta publicación NO debe perder el histórico**

  Importante: `fuentes_por_quadkey` en la `Ficha` final (construida más abajo, línea 623) debe
  seguir describiendo SOLO lo nuevo de este corte (así es como `quadkeys_ya_publicadas` de la
  PRÓXIMA publicación sabrá qué es "lo de esta versión") — no hace falta ningún cambio aquí más
  allá del filtro ya aplicado en el paso 5.2, que ya alimenta esta misma variable. Confirmar que
  no se está concatenando nada del `anterior` en este punto — la ficha de cada corte es
  deliberadamente solo su propia diferencia, no un acumulado.

- [ ] **Paso 5.5 — Poblar `version_anterior` en la `Ficha` final**

  En la construcción de `Ficha { ... }` (línea 607-628), añadir el campo nuevo:
  ```rust
  let mut ficha = Ficha {
      version: 1,
      paquete: paquete.clone(),
      nombre: nombre_indice,
      numero_version,
      version_anterior: etiqueta_anterior,
      autor,
      // ... resto igual ...
  };
  ```

- [ ] **Paso 5.6 — Guardar la ficha propia y bumpear `numero_version` al terminar con éxito**

  Al final de `publicar()`, justo después de
  ```rust
  almacen.publicacion_marcar_subido(indice_id, "ficha.json", &url)?;
  prog.terminar_asset(json.len() as u64);
  ```
  y antes del `Ok(())` final, añadir:
  ```rust
  almacen.guardar_ficha_propia(indice_id, numero_version, &String::from_utf8_lossy(&json), ahora)?;
  almacen.bumpear_numero_version(indice_id)?;
  ```
  (`ahora` ya está en scope — se calculó unas líneas antes, en la línea 606 de la lectura actual,
  como `let ahora: i64 = crate::chrono_ahora().parse().unwrap_or(0);`, para `publicada_en`/
  `vigente_hasta` de la ficha. No hace falta recalcularlo.)
  Esto necesita un método nuevo en `store.rs` (añadirlo en la Tarea 3, paso 3.2, junto a los
  otros): `pub fn bumpear_numero_version(&self, indice_id: i64) -> Result<()>` que hace
  `UPDATE indices SET numero_version = numero_version + 1 WHERE id = ?1`.

  Nota semántica importante para quien implemente: `indices.numero_version` deja de significar
  "la versión de ESTA fila" (ya no tiene sentido, no hay clones) y pasa a significar "el número
  de la PRÓXIMA publicación" — arranca en 1 (nadie ha publicado nunca), y tras la primera
  publicación con éxito pasa a 2, etc. Es lo que ya asume el paso 5.1 al leerlo ANTES de
  publicar (esa lectura es "qué número le toca a este intento"), y coherente con que
  `ultima_ficha_propia` seguirá devolviendo `numero_version = 1` como la más alta hasta que la
  segunda publicación termine con éxito.

- [ ] **Paso 5.7 — Compilar**

  Run: `cargo build --manifest-path indexer/src-tauri/Cargo.toml`
  Expected: compila sin error.

---

### Tarea 6: Frontend — quitar "Crear versión nueva" y el techo del mapa

**Files:**
- Modify: `indexer/src/lib/api.ts`
- Modify: `indexer/src/catalog/IndexDetail.tsx`
- Modify: `indexer/src/App.tsx`
- Modify: `indexer/src/territory/MapCanvas.tsx`
- Modify: `indexer/src/territory/TerritoryView.tsx`

**Interfaces:**
- Consumes: nada del backend Rust directamente — depende de que los comandos Tauri de la Tarea 1
  ya no existan/hayan cambiado de firma, así que esta tarea va DESPUÉS de la 1.

- [ ] **Paso 6.1 — `api.ts`**

  Borrar `versionCrear` (línea 290: `versionCrear: (padreId: number) => invoke<number>("version_crear", { padreId }),`).
  En el tipo de `DetalleIndice` (línea 58-59), borrar `viene_de: number | null;` — `numero_version: number;` se queda.
  En `territorioClasificar` (línea 294), quitar el tercer parámetro `indiceId?: number` de la
  firma y del `invoke(...)` que envuelve.

- [ ] **Paso 6.2 — `IndexDetail.tsx`**

  Borrar:
  - `const [creandoVersion, setCreandoVersion] = useState(false);` (línea 45).
  - La función `crearVersion` (cuerpo en torno a la línea 100, que llama a
    `api.versionCrear(id)` y `onNuevaVersion?.(nuevaId)`).
  - El botón (líneas 163-167):
    ```tsx
    <button onClick={() => void crearVersion()} disabled={creandoVersion}
      ...>
      {creandoVersion ? "Creando versión…" : "Crear versión nueva"}
    </button>
    ```
  - El parámetro `onNuevaVersion` de la firma del componente (línea 22-23) y su doc-comment
    (líneas 19-21).
  - La condición `{detalle.numero_version > 1 && ( ... v{detalle.numero_version} ... )}`
    (línea 208-211) NO se borra — sigue siendo válida (un índice puede seguir teniendo
    `numero_version > 1` tras varias publicaciones incrementales), solo cambia lo que significa.

- [ ] **Paso 6.3 — `App.tsx`**

  Quitar la prop `onNuevaVersion={setIndiceAbierto}` (línea 189) de donde se monta
  `<IndexDetail ... />` — el componente ya no acepta esa prop tras el paso 6.2.

- [ ] **Paso 6.4 — `MapCanvas.tsx`**

  En el handler de click sobre `teselas-relleno` (líneas 220-239 de la lectura actual): el caso
  `if (!paquete)` (líneas 228-231, "Fuera de esta versión") deja de poder ocurrir — ningún
  `Estado::Reclamada` sin techo real vuelve a tener `paquete` vacío tras la Tarea 1. Simplificar:
  ```tsx
  m.on("click", "teselas-relleno", (e) => {
    if (herramientaRef.current !== "mano") return;
    const props = propsDe(e.features?.[0]);
    if (props.estado !== "reclamada") return;
    const paquete = String(props.paquete ?? "");
    const autor = String(props.autor ?? "");
    const nodo = document.createElement("div");
    nodo.className = "font-mono text-[10.5px] leading-relaxed";
    nodo.innerHTML =
      `<b>${autor}</b><br/>${paquete}<br/>` +
      `<span style="opacity:.7">viajará como dependencia de tu índice, no en él</span><br/>` +
      `<button data-reportar style="text-decoration:underline">Reportar</button>`;
    nodo.querySelector("[data-reportar]")?.addEventListener("click", () => {
      void navigator.clipboard.writeText(`desreclamo: ${paquete} (${autor}) — motivo: `);
    });
    // ... resto del handler sin cambios ...
  });
  ```
  Confirmar contra el cuerpo real del handler qué sigue después de la línea 239 (el popup de
  Mapbox u otro renderizado) y conservarlo tal cual, solo colapsando el `if/else` en el `if
  (!paquete)` de arriba.

- [ ] **Paso 6.5 — `TerritoryView.tsx`**

  Línea 53: `setClasificacion(await api.territorioClasificar(p, fichas.map((f) => f.id), indiceId));`
  — quitar el tercer argumento `indiceId` (ya no existe en la firma tras el paso 6.1). Si
  `indiceId` deja de usarse en ningún otro sitio de este componente, quitar también su
  declaración/prop — comprobar con un grep local antes de borrarla.

- [ ] **Paso 6.6 — Verificar**

  Run: `cd indexer && npx tsc -b --noEmit`
  Expected: sin errores.
  Run: `cd indexer && npm run lint`
  Expected: sin errores nuevos respecto a los warnings preexistentes (no hace falta que
  desaparezcan warnings que ya existían antes de este plan).

---

### Tarea 7: Verificación final y commit

- [ ] **Paso 7.1 — Build completo**

  Run: `cargo build --manifest-path indexer/src-tauri/Cargo.toml`
  Run: `cd indexer && npx tsc -b --noEmit && npm run lint`
  Expected: ambos limpios.

- [ ] **Paso 7.2 — Un solo commit**

  ```bash
  git add crates/lumi-index/src/ficha.rs indexer/src-tauri/src/store.rs \
    indexer/src-tauri/src/lib.rs indexer/src-tauri/src/main.rs \
    indexer/src-tauri/src/package.rs indexer/src-tauri/src/publicar.rs \
    indexer/src/lib/api.ts indexer/src/catalog/IndexDetail.tsx indexer/src/App.tsx \
    indexer/src/territory/MapCanvas.tsx indexer/src/territory/TerritoryView.tsx \
    docs/superpowers/specs/2026-09-01-versionado-de-indices-design.md \
    docs/superpowers/plans/2026-09-01-versionado-de-indices-plan.md
  git rm indexer/src-tauri/src/versions.rs
  git commit -m "$(cat <<'EOF'
  feat: versionado de índices pasa a ser un historial de publicaciones, no clones

  "Crear versión nueva" clonaba el índice sellado entero en una fila nueva,
  con un techo duro que le impedía indexar ni una tesela fuera de las que
  tenía el padre al nacer. Confirmado con el operador: el único uso real
  siempre fue crecer, nunca ramificar — así que se colapsa a una sola
  línea de tiempo por índice.

  Un índice de trabajo ahora crece sin límite (proveedor nuevo, área
  nueva, modelo nuevo, cualquier orden) mientras no se publica. Publicar
  calcula automáticamente la diferencia desde el corte anterior (guardado
  en propias_fichas) y empaqueta solo eso, generalizando el mecanismo que
  ya existía para publicar solo una capa de modelo. Ficha.version_anterior
  encadena cada corte con el que le precede.

  Se borra el clonado (versions.rs, crear_version/clonar_version) y el
  techo (fuera_de_techo, el cap de territorio en territorio_clasificar) —
  ninguno protegía nada que el reclamo de territorio entre proyectos
  distintos no protegiera ya.
  EOF
  )"
  ```
