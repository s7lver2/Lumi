# Pestaña de Proyectos — diseño

## Contexto

Hoy, un índice se crea suelto (`NewIndexDialog.tsx` → `indice_crear`, `store.rs:323`) y solo se
asocia a un repositorio de GitHub al publicarlo, eligiendo entre los repos propios en el paso 1
de `PublishDialog.tsx`. El repositorio ya lleva buena parte de la infraestructura que hace falta
para "proyecto":

- `publicar::repos()` (`publicar.rs:181-210`) ya lista los repos propios con permiso de escritura,
  marcando cuáles ya llevan la etiqueta `lumi-index` (`ETIQUETA`, `catalogo.rs:20`).
- `etiquetar_repo()` (`publicar.rs:216-247`) ya pone esa etiqueta automáticamente al publicar por
  primera vez en un repo.
- `catalogo::refrescar()` (`catalogo.rs:165-...`) ya descubre repos por esa misma etiqueta vía la
  API de búsqueda de GitHub, y `catalogo::mios()` (`catalogo.rs:355-369`) ya agrupa lo publicado
  POR REPOSITORIO (`RemoteRepos.tsx` lo consume tal cual).

Lo que falta no es el mecanismo de identificación — ya existe — sino invertir CUÁNDO se decide:
hoy el repositorio se elige al final (publicar), y el operador quiere elegirlo al principio (antes
de crear el primer índice), con una pantalla propia que reemplaza a la de Índices.

## Alcance

- Nueva pestaña "Proyectos" (sustituye a "Índices" en `Rail`/`Destino`, `App.tsx`): maestro-detalle
  — columna lateral con buscador + lista de proyectos (mismo esqueleto que `AdminPanel`/
  `ProfileView`/`AjustesView`, grid `[206px_1fr]`), panel derecho con el proyecto seleccionado.
- "Proyecto" = repositorio de GitHub con la etiqueta `lumi-index` (la ya existente, sin cambiar el
  string ni el mecanismo — solo se usa donde antes no se usaba).
- "+ Nuevo proyecto": crea el repo directamente por la API de GitHub (privado por defecto, nombre
  a elegir) y le pone la etiqueta en el momento — no en dos pasos como hoy (crear a mano en GitHub,
  luego publicar y que se etiquete solo).
- Un índice se crea DENTRO de un proyecto ya elegido: `indice_crear` gana un parámetro `proyecto`
  (el `full_name` del repo), fijado al nacer y no editable después — mismo criterio que "nivel a
  embeber", que ya funciona así en `NewIndexDialog.tsx`.
- El panel de detalle de un proyecto muestra: nombre, enlace "Ver en GitHub", cuatro estadísticas
  agregadas (teselas totales, imágenes totales, número de índices, última actividad — sumadas
  sobre TODOS los índices locales de ese proyecto, publicados o no), la lista de sus índices
  (mismo `IndexRow`/`IndexDetail` de siempre), y "+ Nuevo índice" ya scopeado a este proyecto.
- `PublishDialog.tsx` pierde su paso 1 ("elige dónde vive"): el índice ya sabe su proyecto desde
  que nació, así que publicar va directo al repo que le corresponde.

Fuera de alcance (con motivo):

- **Migrar índices existentes sin proyecto**: no hay ninguno en uso real todavía (mismo criterio
  que la spec de versionado) — la columna nueva se deja `NULL`-able para no romper si alguna vez
  hiciera falta, pero no se escribe ruta de migración.
- **Adoptar un repo ya existente como proyecto** (en vez de crear uno nuevo): el operador lo pidió
  explícitamente fuera — "+ Nuevo proyecto" solo crea.
- **Estadísticas de gasto/coste**: confirmado que las cuatro (teselas, imágenes, índices, última
  actividad) bastan por ahora.

---

## 1. Esquema: `indices.proyecto`

En `ESQUEMA`/la migración idempotente de `store.rs` (junto a `viene_de`/`numero_version`,
`store.rs:252-257`):
```sql
ALTER TABLE indices ADD COLUMN proyecto TEXT
```
`proyecto` es el `full_name` del repo (`"usuario/nombre-repo"`), igual que `Repo.nombre` en
`publicar.rs:34`. `NULL` para cualquier índice creado antes de esta spec.

## 2. Backend: comandos nuevos

**`proyectos_lista(testigo) -> Vec<Proyecto>`** (Tauri command, `lib.rs`): envuelve
`publicar::repos()` (ya filtra por permiso de escritura) y, para cada repo con `tiene_etiqueta`,
añade las estadísticas agregadas leyendo `indices` local:
```rust
pub struct Proyecto {
    pub repo: String,
    pub privado: bool,
    pub indices: u32,
    pub teselas: u32,
    pub imagenes: u32,
    /// Epoch del índice de este proyecto con mayor `creado_en`/última
    /// actividad conocida — `None` si el proyecto no tiene índices locales
    /// todavía (repo recién etiquetado a mano, o vacío).
    pub ultima_actividad: Option<i64>,
}
```
Solo se listan los repos con `tiene_etiqueta` — un repo propio sin la etiqueta no es un proyecto
de Lumi, es ruido para esta pantalla (ya es el criterio que aplica `PublishDialog.tsx` para
mostrarlos "arriba" en la lista, aquí se usa para no mostrarlos en absoluto).

**`proyecto_crear(testigo, nombre, privado) -> Proyecto`**: `POST https://api.github.com/user/repos`
con `{ "name": nombre, "private": privado }`, y a continuación la misma llamada que ya hace
`etiquetar_repo()` (`publicar.rs:216`) para ponerle `lumi-index` — se puede llamar directamente a
esa función en vez de duplicar la lógica de "leer topics, añadir si falta, PUT".

**`indice_crear` (`lib.rs:566`, ya existe)**: gana un parámetro `proyecto: String`, pasado a
`store.rs::crear_indice`:
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

**Estadísticas por proyecto**: nueva consulta en `store.rs`, algo como
```rust
pub fn indices_de_proyecto(&self, proyecto: &str) -> Result<Vec<(i64, String, String, String)>>
```
(mismo shape que `listar_indices`, `store.rs:835`, filtrado por `WHERE proyecto = ?1`) — el resto
de las estadísticas (teselas/imágenes) se calculan sumando sobre esos índices con las funciones
que ya existen por índice (`total_imagenes`, `teselas_trabajo`), no hace falta SQL nuevo para eso.

## 3. `publicar.rs`: dejar de preguntar dónde vive

`PublishDialog.tsx` (paso 1, `PublishDialog.tsx:79-126`) desaparece: el índice ya trae su
`proyecto` desde `indice_detalle`/`DetalleIndice`. `publicarArrancar`/`publicar()` sigue recibiendo
`repo: String` (no cambia su firma — sigue siendo válido, solo que ahora el frontend lo rellena
solo con `detalle.proyecto` en vez de pedírselo al operador). `publicar::repos()` deja de usarse
desde `PublishDialog` — lo sigue usando `proyectos_lista` (punto 2, arriba), que es su nuevo
único llamante.

## 4. Frontend

**Nuevos:**
- `indexer/src/projects/ProjectsView.tsx` — el maestro-detalle, sustituye a `IndexList.tsx` como
  destino `"proyectos"` en `Rail`/`App.tsx` (renombrar el `Destino` de `"indices"` a `"proyectos"`
  en todos sus usos — `Rail.tsx`, `App.tsx`).
- `indexer/src/projects/ProjectRow.tsx` — fila de la columna lateral (nombre + repo en mono, sin
  icono-en-caja-de-color — DESIGN.md).
- `indexer/src/projects/ProjectDetail.tsx` — panel derecho: nombre, "Ver en GitHub", las cuatro
  estadísticas, lista de índices del proyecto (reutiliza `IndexRow`), "+ Nuevo índice".
- `indexer/src/projects/NewProjectDialog.tsx` — nombre + privado/público, llama a
  `proyecto_crear`.

**Modificados:**
- `NewIndexDialog.tsx`: gana una prop `proyecto: string` (ya no se llama sin saber en cuál
  proyecto crear), la pasa a `api.indiceCrear(nombre, [elegido], proyecto)`.
- `PublishDialog.tsx`: se quita el paso 1 completo (selector de repo); el paso que hoy es 2 pasa a
  ser el único primer paso.
- `IndexDetail.tsx`: gana un enlace "← Volver a «{proyecto}»" en vez de (o además de) "← Volver" a
  secas, usando el `proyecto` que ya trae `DetalleIndice`.
- `Rail.tsx`/`App.tsx`: `Destino` cambia `"indices"` → `"proyectos"`; el componente montado para
  ese destino pasa de `IndexList` a `ProjectsView`.
- `api.ts`: nuevos tipos `Proyecto`, nuevas funciones `proyectosLista`/`proyectoCrear`;
  `indiceCrear` gana el parámetro `proyecto`; `DetalleIndice` gana el campo `proyecto: string | null`.

**Sin cambios:** `IndexRow.tsx`, `IndexDetail.tsx` (salvo el enlace de vuelta), `CatalogSearch.tsx`,
`RemoteRepos.tsx` (sigue siendo la vista de "lo publicado agrupado por repo", complementaria a
Proyectos — Proyectos es local+publicado, RemoteRepos es solo publicado, con más detalle de
fichas/versiones; se quedan las dos, cada una responde una pregunta distinta).
