# Pestaña de Proyectos — plan de implementación

> Spec: [2026-09-01-pestana-de-proyectos-design.md](../specs/2026-09-01-pestana-de-proyectos-design.md).
> Proyecto: Lumi Indexer (`indexer/`, `indexer/src-tauri/`).

**Goal:** Una pestaña "Proyectos" (repos de GitHub etiquetados `lumi-index`) sustituye a
"Índices" como entrada principal. Un índice se crea DENTRO de un proyecto ya elegido, no suelto;
publicar deja de preguntar dónde vive porque ya lo sabe desde que el índice nació.

**Arquitectura:** `indices` gana una columna `proyecto` (el `full_name` del repo), fijada al
crear el índice. Se reutiliza toda la infraestructura de etiquetado/listado de repos que ya
existe en `publicar.rs`/`catalogo.rs` (`ETIQUETA = "lumi-index"`, `repos()`, `etiquetar_repo()`)
en vez de inventar un mecanismo nuevo — lo único nuevo de verdad es "crear un repo" (hoy solo se
listan los existentes) y las estadísticas agregadas por proyecto.

**Tech Stack:** Rust (Tauri backend, SQLite/`rusqlite`), TypeScript/React (frontend).

## Global Constraints

- **No tests unless explicitly requested** (convención del proyecto).
- **`ponytail`**: reutilizar `publicar::repos()`/`etiquetar_repo()` tal cual — no crear una
  abstracción "Proyecto" en Rust que envuelva `Repo` si con añadir campos calculados alcanza.
- Compilar/verificar tras cada tarea: `cargo build --manifest-path indexer/src-tauri/Cargo.toml`
  y `cd indexer && npx tsc -b --noEmit && npm run lint`.
- Español en comentarios y mensajes de commit.
- Un solo commit al final (convención del proyecto).

---

### Tarea 1: Esquema — `indices.proyecto`

**Files:** Modify `indexer/src-tauri/src/store.rs`

- [ ] **Paso 1.1** — En la migración idempotente (junto a `viene_de`/`numero_version`, buscar el
  bloque `for alter in [...]` alrededor de la línea 252), añadir:
  ```rust
  // Proyecto (repo de GitHub etiquetado `lumi-index`) al que pertenece este
  // índice — spec de pestaña de Proyectos. NULL para cualquier índice creado
  // antes de esto: no hay ninguno en producción, no hace falta migrarlos.
  "ALTER TABLE indices ADD COLUMN proyecto TEXT",
  ```

- [ ] **Paso 1.2** — `crear_indice` (línea ~323): añadir el parámetro `proyecto: &str` y
  escribirlo:
  ```rust
  pub fn crear_indice(&self, nombre: &str, slug: &str, proyecto: &str) -> Result<i64> {
      let c = self.0.lock().unwrap();
      c.execute(
          "INSERT INTO indices (nombre, slug, estado, proyecto, creado_en) VALUES (?1, ?2, 'abierto', ?3, ?4)",
          params![nombre, slug, proyecto, Self::ahora()],
      )?;
      Ok(c.last_insert_rowid())
  }
  ```

- [ ] **Paso 1.3** — Nueva consulta, junto a `listar_indices` (línea ~835):
  ```rust
  /// Los índices de un proyecto (repo con la etiqueta `lumi-index`) —
  /// mismo shape que `listar_indices`, filtrado por proyecto. Es la base
  /// de la lista de índices en el panel de detalle de un proyecto, y de
  /// las estadísticas agregadas (sumadas por quien llame, no aquí).
  pub fn indices_de_proyecto(&self, proyecto: &str) -> Result<Vec<(i64, String, String, String)>> {
      let c = self.0.lock().unwrap();
      let mut q = c.prepare(
          "SELECT id, nombre, slug, estado FROM indices WHERE proyecto = ?1 ORDER BY creado_en DESC",
      )?;
      let filas = q.query_map([proyecto], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))?;
      Ok(filas.flatten().collect())
  }
  ```
  Confirmar contra el cuerpo real de `listar_indices` que el shape `(id, nombre, slug, estado)`
  coincide exactamente (columnas y orden) — copiar su patrón de `query_map` si difiere de lo de
  arriba.

- [ ] **Paso 1.4 — Compilar**: `cargo build --manifest-path indexer/src-tauri/Cargo.toml`.
  Expected: compila (nada llama a estas funciones todavía con el nuevo parámetro — eso es la
  Tarea 2 — así que este paso puede fallar en el único call site existente de `crear_indice`
  hasta que la Tarea 2 lo actualice; si es más simple, hacer Tareas 1 y 2 en el mismo pase antes
  de compilar por primera vez).

---

### Tarea 2: Comandos Tauri — listar/crear proyectos, índice con proyecto

**Files:** Modify `indexer/src-tauri/src/lib.rs`, `indexer/src-tauri/src/publicar.rs`

- [ ] **Paso 2.1** — En `publicar.rs`, junto a `pub struct Repo` (línea ~33), añadir:
  ```rust
  #[derive(Debug, Clone, Serialize)]
  pub struct Proyecto {
      pub repo: String,
      pub privado: bool,
      pub indices: u32,
      pub teselas: u32,
      pub imagenes: u32,
      /// Epoch de la mayor actividad conocida entre sus índices locales —
      /// `None` si el proyecto no tiene índices locales todavía.
      pub ultima_actividad: Option<i64>,
  }
  ```

- [ ] **Paso 2.2** — Nueva función en `publicar.rs`, junto a `repos()` (línea ~181):
  ```rust
  /// Los proyectos: repos propios que YA llevan la etiqueta, con sus
  /// estadísticas agregadas leídas de los índices locales. Un repo propio
  /// sin la etiqueta no es un proyecto de Lumi — no aparece aquí, aunque sí
  /// aparecería en `repos()` (que sigue existiendo para el flujo de "crear
  /// proyecto", que necesita saber si el nombre elegido ya existe).
  pub async fn proyectos(almacen: &Almacen, testigo: &str) -> Result<Vec<Proyecto>> {
      let todos = repos(testigo).await?;
      Ok(todos
          .into_iter()
          .filter(|r| r.tiene_etiqueta)
          .map(|r| {
              let indices = almacen.indices_de_proyecto(&r.nombre).unwrap_or_default();
              let mut teselas = 0u32;
              let mut imagenes = 0u32;
              let mut ultima_actividad: Option<i64> = None;
              for (id, ..) in &indices {
                  teselas += almacen.teselas_trabajo(*id).map(|t| t.len() as u32).unwrap_or(0);
                  imagenes += almacen.total_imagenes(*id).unwrap_or(0);
                  if let Ok(Some(creado)) = almacen.creado_en_de_indice(*id) {
                      ultima_actividad = Some(ultima_actividad.map_or(creado, |u| u.max(creado)));
                  }
              }
              Proyecto {
                  repo: r.nombre, privado: r.privado,
                  indices: indices.len() as u32, teselas, imagenes, ultima_actividad,
              }
          })
          .collect())
  }
  ```
  Nota: `creado_en_de_indice` probablemente no existe todavía — confirmar contra `store.rs` si
  hay ya una forma de leer `creado_en`/`sellado_en` de un índice por id (`filas_procedencia`,
  `indice_detalle`, etc. pueden traerlo indirectamente); si no existe, añadir un método mínimo
  `pub fn creado_en_de_indice(&self, id: i64) -> Result<Option<i64>>` junto a `crear_indice` que
  haga `SELECT creado_en FROM indices WHERE id = ?1` con `.optional()`. Igual de simple sería usar
  directamente `MAX(creado_en)` en una variante SQL de `indices_de_proyecto` que devuelva también
  `creado_en` — usar el criterio que quede más simple una vez visto el resto de `store.rs`.

- [ ] **Paso 2.3** — Nueva función para crear el repo, junto a `etiquetar_repo` (línea ~216):
  ```rust
  /// Crea un repositorio nuevo en GitHub y lo etiqueta en el acto — a
  /// diferencia de publicar en uno ya existente (que se etiqueta la
  /// primera vez que se sube algo), aquí no hay «primera subida» que
  /// dispare el etiquetado solo, así que se hace explícito.
  pub async fn crear_repo(testigo: &str, nombre: &str, privado: bool) -> Result<Proyecto> {
      #[derive(serde::Deserialize)]
      struct R { full_name: String }
      let cliente = cliente_http();
      let r = cliente
          .post("https://api.github.com/user/repos")
          .bearer_auth(testigo)
          .header("user-agent", "lumi-indexer")
          .json(&serde_json::json!({ "name": nombre, "private": privado }))
          .send()
          .await?;
      if !r.status().is_success() {
          bail!("no se pudo crear el repositorio: {}", r.status());
      }
      let creado: R = r.json().await?;
      etiquetar_repo(&cliente, testigo, &creado.full_name).await?;
      Ok(Proyecto {
          repo: creado.full_name, privado, indices: 0, teselas: 0, imagenes: 0, ultima_actividad: None,
      })
  }
  ```
  Confirmar el import de `bail!`/`anyhow` ya presente en el fichero (se usa en otras funciones de
  `publicar.rs`, p. ej. `asegurar_release`).

- [ ] **Paso 2.4** — Comandos Tauri en `lib.rs`, junto a `indice_crear` (línea ~566):
  ```rust
  #[tauri::command]
  async fn proyectos_lista(estado: tauri::State<'_, Estado>, testigo: String) -> Result<Vec<publicar::Proyecto>, String> {
      publicar::proyectos(&estado.almacen, &testigo).await.map_err(|e| e.to_string())
  }

  #[tauri::command]
  async fn proyecto_crear(testigo: String, nombre: String, privado: bool) -> Result<publicar::Proyecto, String> {
      publicar::crear_repo(&testigo, &nombre, privado).await.map_err(|e| e.to_string())
  }
  ```
  Confirmar cómo obtienen `testigo` (el token de GitHub) los comandos existentes que ya llaman a
  `publicar::repos()`/`publicar::publicar()` desde el frontend (buscar `publicarRepos` en
  `lib.rs`) — lo más probable es que el frontend ya lo lea de `identidad_leer`/una sesión
  guardada y lo pase como argumento, igual que aquí; replicar exactamente ese mismo patrón en vez
  de inventar uno nuevo.

  Modificar `indice_crear` (línea 566) para aceptar y pasar `proyecto: String`:
  ```rust
  #[tauri::command]
  fn indice_crear(estado: tauri::State<'_, Estado>, nombre: String, niveles: Vec<String>, proyecto: String) -> Result<i64, String> {
      // ... cuerpo existente, cambiando la llamada a crear_indice para pasar &proyecto ...
  }
  ```

  Registrar `proyectos_lista`/`proyecto_crear` en `tauri::generate_handler![...]` (`main.rs`).

- [ ] **Paso 2.5** — `DetalleIndice` (struct en `lib.rs`, la misma que se tocó en la spec de
  versionado): añadir `proyecto: Option<String>`, leído con
  `estado.almacen.conn().query_row("SELECT proyecto FROM indices WHERE id = ?1", ...)` o el
  método que sea más consistente con cómo ya lee `nombre`/`slug`/`estado` esa misma función
  (`indice_detalle`, revisar su cuerpo actual antes de decidir la forma exacta).

- [ ] **Paso 2.6 — Compilar**: `cargo build --manifest-path indexer/src-tauri/Cargo.toml`.
  Expected: compila.

---

### Tarea 3: `PublishDialog.tsx` — quitar el paso de elegir repo

**Files:** Modify `indexer/src/publish/PublishDialog.tsx`

- [ ] **Paso 3.1** — Leer el componente completo primero (no asumir el plan de la spec sobre su
  estructura interna de pasos sin confirmarla). El paso 1 de hoy (selector de repo,
  `PublishDialog.tsx:79-126` en la lectura de referencia) se borra entero; el componente recibe
  el `proyecto` del índice (ya en `DetalleIndice.proyecto` tras la Tarea 2) como prop desde quien
  lo monta, y arranca directamente en lo que hoy es el paso 2. Ajustar la numeración de pasos
  restante y cualquier botón "Atrás" que asumiera un paso 1 anterior.

- [ ] **Paso 3.2** — `api.publicarArrancar(indiceId, repo, descargo)` sigue llamándose igual, solo
  que `repo` ahora viene de la prop `proyecto` en vez de un `useState` propio rellenado por el
  usuario.

- [ ] **Paso 3.3 — Verificar**: `cd indexer && npx tsc -b --noEmit`.

---

### Tarea 4: Frontend — `ProjectsView`/`ProjectDetail`/`NewProjectDialog`

**Files:**
- Create: `indexer/src/projects/ProjectsView.tsx`
- Create: `indexer/src/projects/ProjectRow.tsx`
- Create: `indexer/src/projects/ProjectDetail.tsx`
- Create: `indexer/src/projects/NewProjectDialog.tsx`
- Modify: `indexer/src/catalog/NewIndexDialog.tsx`
- Modify: `indexer/src/catalog/IndexDetail.tsx`
- Modify: `indexer/src/lib/api.ts`
- Modify: `indexer/src/ui/Rail.tsx`, `indexer/src/App.tsx`
- Delete: `indexer/src/catalog/IndexList.tsx` (su contenido se reparte entre `ProjectsView`/
  `ProjectDetail` — `CatalogSearch`/`RemoteRepos`/`ProfileDialog` que montaba se reubican donde
  corresponda; leer primero qué hace cada uno antes de decidir dónde queda cada pieza).

- [ ] **Paso 4.1 — `api.ts`**: añadir
  ```ts
  export interface Proyecto {
    repo: string; privado: boolean; indices: number; teselas: number;
    imagenes: number; ultima_actividad: number | null;
  }
  ```
  y en `export const api = {...}`:
  ```ts
  proyectosLista: (testigo: string) => invoke<Proyecto[]>("proyectos_lista", { testigo }),
  proyectoCrear: (testigo: string, nombre: string, privado: boolean) =>
    invoke<Proyecto>("proyecto_crear", { testigo, nombre, privado }),
  ```
  (nombres de parámetros a confirmar contra cómo ya se pasa `testigo` a `publicarRepos`/
  `publicarArrancar` en este mismo fichero — replicar ese patrón). Actualizar `indiceCrear` para
  aceptar `proyecto: string` y pasarlo al `invoke`. Añadir `proyecto: string | null` al tipo
  `DetalleIndice`.

- [ ] **Paso 4.2 — `ProjectsView.tsx`**: maestro-detalle, mismo esqueleto de grid `[206px_1fr]`
  que `AdminPanel.tsx`/`ProfileView.tsx`/`AjustesView.tsx` (leer uno de ellos como plantilla
  exacta de clases Tailwind a reutilizar). Estado: lista de `Proyecto[]` (de `proyectosLista`),
  proyecto seleccionado, buscador (filtro por `repo` en cliente, sin llamada nueva). Header de la
  columna lateral: buscador + botón "+ Nuevo proyecto" (abre `NewProjectDialog`).

- [ ] **Paso 4.3 — `ProjectRow.tsx`**: fila de la lista lateral — nombre corto (parte después de
  `/` en `repo`) + `repo` completo en mono debajo, sin icono en caja de color (DESIGN.md).

- [ ] **Paso 4.4 — `ProjectDetail.tsx`**: nombre, enlace `https://github.com/{repo}` ("Ver en
  GitHub ↗"), fila de cuatro estadísticas (mismo patrón visual `n`/`l` que ya exista en algún
  sitio del panel de administración para números grandes — revisar `Stat` en
  `HardwareView.tsx` como posible referencia de estilo), lista de índices del proyecto
  (`api.indicesDeProyecto`/filtrando `proyectosLista` — decidir si hace falta un comando nuevo
  `indices_de_proyecto` expuesto a Tauri o si basta con lo que ya trae `Proyecto`; si el detalle
  de cada índice requiere más que conteo, exponer `indice_lista_de_proyecto` análogo a
  `indices_lista` pero filtrado, reutilizando `Almacen::indices_de_proyecto` de la Tarea 1),
  reutilizando `IndexRow`. Botón "+ Nuevo índice" abre `NewIndexDialog` con `proyecto={repo}`.

- [ ] **Paso 4.5 — `NewProjectDialog.tsx`**: nombre + toggle privado/público (privado por
  defecto), llama a `api.proyectoCrear`, al terminar selecciona el proyecto recién creado.

- [ ] **Paso 4.6 — `NewIndexDialog.tsx`**: añadir prop `proyecto: string` a la firma del
  componente y pasarlo en `api.indiceCrear(nombre.trim(), [elegido], proyecto)`.

- [ ] **Paso 4.7 — `IndexDetail.tsx`**: el botón/enlace de volver (`onVolver`) puede seguir
  igual, pero si `detalle.proyecto` existe, mostrar el nombre del proyecto como contexto (p. ej.
  junto al título) — confirmar contra el layout actual del encabezado antes de decidir la forma
  exacta; no es imprescindible que sea un enlace navegable de vuelta al proyecto si eso complica
  el enrutado de `App.tsx` más de lo que vale para esta pasada.

- [ ] **Paso 4.8 — `Rail.tsx`/`App.tsx`**: renombrar el destino `"indices"` a `"proyectos"` en el
  tipo `Destino` y en cada sitio que lo usa (`App.tsx` ya listado antes: líneas ~31, ~137, ~185,
  ~264, ~296 de la lectura de referencia — confirmar contra el estado real del fichero, no
  asumir que las líneas no se movieron). El componente montado pasa de `IndexList` a
  `ProjectsView`. Actualizar la etiqueta visible en `Rail` de "Índices" a "Proyectos" si la hay.

- [ ] **Paso 4.9 — Borrar `IndexList.tsx`** una vez que `ProjectsView`/`ProjectDetail` cubran
  todo lo que montaba (`CatalogSearch`, `RemoteRepos`, `ProfileDialog`, `NewIndexDialog`,
  el aviso de dependencias rotas) — decidir dónde vive cada pieza (probablemente
  `RemoteRepos`/dependencias-rotas quedan bien en `ProjectsView` como contenido bajo la lista de
  proyectos locales, ya que hablan de lo publicado en general, no de un proyecto concreto).

- [ ] **Paso 4.10 — Verificar**: `cd indexer && npx tsc -b --noEmit && npm run lint`.

---

### Tarea 5: Verificación final y commit

- [ ] **Paso 5.1**: `cargo build --manifest-path indexer/src-tauri/Cargo.toml` y
  `cd indexer && npx tsc -b --noEmit && npm run lint` — ambos limpios.

- [ ] **Paso 5.2**: un solo commit con todos los ficheros tocados/creados/borrados de las Tareas
  1-4 más las specs/plan de esta feature, mensaje:
  ```
  feat: pestaña de Proyectos sustituye a Índices, repo elegido antes de indexar

  Un índice ya no se crea suelto y se le busca repositorio al publicar —
  se crea DENTRO de un proyecto (repo de GitHub etiquetado lumi-index) ya
  elegido, fijado al nacer igual que el nivel a embeber. "+ Nuevo
  proyecto" crea el repo por la API y lo etiqueta en el acto, en vez de
  crearlo a mano en GitHub y esperar a la primera publicación para que se
  etiquete solo.

  Reutiliza la infraestructura de etiquetado/listado de repos que ya
  existía en publicar.rs/catalogo.rs (ETIQUETA, repos(), etiquetar_repo())
  en vez de un mecanismo nuevo — lo único nuevo es crear un repo (antes
  solo se listaban existentes) y las estadísticas agregadas por proyecto.
  PublishDialog deja de preguntar dónde vive: el índice ya lo sabe.

  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
  ```
