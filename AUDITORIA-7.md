# Auditoría del subsistema 7

Auditoría de solo lectura de `docs/superpowers/plans/2026-08-06-lumi-indexer-7a.md` y
`docs/superpowers/plans/2026-08-07-lumi-indexer-7b.md` contra el código real en
`crates/lumi-index/`, `indexer/src-tauri/src/` e `indexer/src/`. Verificado con lectura de
código, grep dirigido, `cargo test -p lumi-index` (26/26 OK), `cargo test` en
`indexer/src-tauri` (33/33 OK) y `npm run build` del frontend (limpio).

## Resumen

El subsistema 7 está mayoritariamente implementado de verdad: los 59 tests que exigen ambos
planes pasan, los 38 comandos Tauri están todos registrados en `generate_handler!`, ninguno de
los componentes React nuevos (7a ni 7b) está huérfano, y los seis orígenes de red están
realmente cableados en `origins::registro()`. Pero hay **3 huecos bloqueantes** reales, todos
del mismo patrón — una pieza queda escrita y probada en aislamiento pero nadie la llama en el
camino de producción — más 3 molestos y varios cosméticos. El más grave: el paquete sellado
nunca declara qué orígenes cubre cada tesela (`cobertura.json` sigue siendo `{}`), lo que
inutiliza en la práctica todo el mecanismo de herencia por origen que el 7b construyó.

## Huecos reales encontrados

### 1. `cobertura.json` sigue siendo el placeholder `{}` — BLOQUEANTE

El plan 7b (Task 4, y otra vez en Task 13) dice explícitamente: *"Este es el único cambio del
7b sobre código ya terminado"*, y da instrucciones literales de sustituir el `fuentes: vec![]`
provisional por `almacen.fuentes_de_tesela(indice_id, &qk)?` dentro de `paquete_sellar`.

En el código real:
- `Almacen::fuentes_de_tesela` existe y está bien implementada — `indexer/src-tauri/src/store.rs:575` — pero **no se llama desde ningún sitio**.
- `package::fuentes_que_viajan` existe, probada, pero lleva `#[allow(dead_code)]` — `indexer/src-tauri/src/package.rs:179-180` — con un comentario que dice que espera al subsistema 8.
- `paquete_sellar` sigue escribiendo el literal: `indexer/src-tauri/src/lib.rs:517` → `std::fs::write(raiz.join("cobertura.json"), b"{}")`.

Esto contradice directamente lo que el propio plan 7b dice que resuelve, y no es lo mismo que
"la construcción de `TeselaCubierta` real es del subsistema 8" (eso se refiere a que el 7a dejó
`cobertura.json` como placeholder a propósito; el 7b prometía completarlo él mismo y no lo hizo).

**Consecuencia funcional:** todo el mecanismo de `clasificar_por_origen`/`repartir_por_origen`
(Task 4 de `crates/lumi-index/src/coverage.rs`, correctamente implementado y probado) nunca
recibe datos reales que heredar, porque ningún paquete sellado declara sus fuentes por tesela.
La pieza pura funciona; el punto de sellado que la alimentaría está desconectado.

**Gravedad:** bloqueante.

### 2. El filtro barato (`lumi_index::filter::Reglas`) nunca se invoca — BLOQUEANTE

El plan 7b Task 3 implementa `Reglas::por_defecto().evaluar(&Candidata)` como módulo puro, y
Task 12 declara explícitamente `Consumes: lumi_index::filter::{Candidata, Reglas, Veredicto}`.

Verificado con `grep -rn "Candidata|Veredicto|Reglas::por_defecto" indexer/src-tauri/src
indexer/src` → **cero resultados**. Ningún adaptador (`mapillary.rs`, `kartaview.rs`,
`google.rs`, `mapbox.rs`, `commons.rs`, `flickr.rs`) construye una `Candidata` ni evalúa nada
antes de aceptar una foto, y `download.rs` tampoco lo hace al recibir las `Captura` de cada
origen. Lo único parecido a un filtro real es que Flickr pide solo licencias CC permitidas por
parámetro de consulta (`indexer/src-tauri/src/origins/flickr.rs:28`), que no cubre las otras
tres reglas (tamaño mínimo, proporción, precisión de geoetiqueta, categoría de interior).

`review.rs` (la mitad "revisión por excepción" de la Task 12) sí está completa y probada, pero
opera sobre todo lo que llega sin que la mitad "reglas baratas" haya descartado nada antes.

**Consecuencia funcional:** fotos demasiado pequeñas, recortes con proporción extrema,
geoetiquetas imprecisas o con categorías de interior llegan igual a la cola de revisión humana
(o directamente se aceptan en los orígenes que no pasan por revisión), en vez de descartarse
automáticamente como "resultado" tal como diseña el plan.

**Gravedad:** bloqueante.

### 3. `Almacen::anotar_tesela` nunca se llama — la tabla `trabajo` siempre está vacía — BLOQUEANTE

`indexer/src-tauri/src/store.rs:380` define `anotar_tesela`, el único punto del código que hace
`INSERT INTO teselas` (confirmado con `grep -rn "INTO teselas" indexer/src-tauri/src/*.rs` →
un único resultado, dentro de la propia función). Ni el flujo de ingesta del 7a
(`ingest.rs`), ni `territory.rs`, ni el comando `territorio_clasificar`, ni el planificador de
descarga del 7b (`download.rs`, que sólo llama a `descarga_marcar`/`gasto_apuntar`, nunca a
`anotar_tesela`) escriben nunca en esa tabla.

Consecuencia: `Almacen::teselas_trabajo(id)` (que alimenta `porcentajes_trabajo` en
`indexer/src-tauri/src/lib.rs:150` y `:499`, usado tanto en `indice_detalle` como en
`paquete_sellar`) devuelve siempre una lista vacía. La tabla "procedencia del trabajo" del
manifiesto y del catálogo de índices —una de las dos tablas de procedencia que el plan 7a marca
como constraint global ("el porcentaje de procedencia del trabajo suma 100 %")— nunca se rellena
para ningún índice, ni con trabajo hecho aquí, ni heredado local, ni heredado de catálogo.

**Gravedad:** bloqueante.

## Verificado correcto

### 7a (16 tareas — el plan no tiene una Task 17, termina en "Autorrevisión" tras la 16)

| Tarea | Veredicto |
|---|---|
| 1 — Crate y teselas z14 | OK |
| 2 — Cobertura y tres estados | OK |
| 3 — Manifiesto y dos porcentajes | OK (implementación correcta; ver hueco #3 sobre por qué la tabla de trabajo nunca se llena en producción) |
| 4 — Fragmentos de vectores | OK |
| 5 — Legacy v1 | OK |
| 6 — Contrato de embebido + trabajador Python | OK |
| 7 — Esqueleto de la app | OK (desviación cosmética: `TitleBar.tsx` no existe como fichero propio, su lógica está fusionada en `WindowFrame.tsx:91-100`) |
| 8 — SQLite y clave maestra | OK |
| 9 — Redis y Qdrant en 127.0.0.1 | OK |
| 10 — Wizard de aprovisionamiento | OK |
| 11 — Runtime Python y modelos | OK |
| 12 — Cola de lotes | Molesto (ver abajo) |
| 13 — Los dos orígenes locales (carpeta y legacy) | OK |
| 14 — Catálogo de índices | OK (depende de datos que la Task 3/8 no rellenan en producción — ver hueco #3) |
| 15 — Territorio y no indexar dos veces | OK como clasificación; el registro de qué se heredó nunca se persiste (mismo hueco #3) |
| 16 — Sellar, abrir, README | OK salvo `cobertura.json` (hueco #1, que es responsabilidad del 7b, no del 7a) |

### 7b (17 tareas)

| Tarea | Veredicto |
|---|---|
| 1 — Contrato puro y bbox | OK |
| 2 — Presupuesto | OK |
| 3 — Reglas del filtro | OK como módulo puro; nunca se usa en producción (hueco #2) |
| 4 — Cobertura por tesela y origen | OK como lógica; nunca se alimenta con datos reales (hueco #1) |
| 5 — Esquema, gasto y claves | OK |
| 6 — Trait, limitador y origen falso | OK |
| 7 — Mapillary | OK |
| 8 — Muestreo de calles, KartaView, Google | OK |
| 9 — Mapbox, Commons, Flickr | OK |
| 10 — Sondeo con caché de 30 días y estimación | OK |
| 11 — Descarga reanudable | OK (desviación cosmética: no existe `Descarga::correr`, la orquestación va inline en el comando `descarga_arrancar`) |
| 12 — Filtro por reglas y revisión | Hueco #2 (la mitad "revisión por excepción" sí funciona) |
| 13 — Filtro de redistribución al sellar | OK el filtro de qué imagen viaja (`paquete_que_viaja`); hueco #1 en la escritura de `cobertura.json` |
| 14 — Disponibilidad en el mapa | OK |
| 15 — Estimación, confirmación y tope | OK |
| 16 — Descarga y revisión en pantalla | OK |
| 17 — Ajustes de orígenes | OK |

## Código muerto o huérfano

**Componentes React:** ninguno huérfano. Se comprobó cada componente nuevo del 7a y del 7b con
grep de su nombre en todo `indexer/src/`; todos están importados y renderizados
(`AvailabilityPanel`, `EstimateDialog` en `TerritoryView.tsx`; `DownloadView`, `ReviewGrid`,
`OriginsPanel` en `App.tsx`; el resto de catálogo/ingesta/setup igual).

**Comandos Tauri:** los 38 `#[tauri::command]` definidos en `indexer/src-tauri/src/lib.rs`
están todos dentro de `generate_handler![...]` (líneas 606-645). Ninguno huérfano de registro.

Sin embargo, dos comandos están registrados y funcionan pero **sin ningún consumidor en el
frontend**: `cola_progreso` y `cola_pausar` (`lib.rs:110,115`). Se comprobó con grep en todo
`indexer/src/` (incluido `lib/api.ts`) que ninguna función los invoca. `IngestView.tsx` no
enseña ninguna barra de progreso de embebido, así que la cola de embebido —una pieza central
del 7a— no tiene ninguna superficie visible en la interfaz. Gravedad: molesto.

**`#[allow(dead_code)]` encontrados:**

| Ruta:línea | Justificado en comentario | Veredicto |
|---|---|---|
| `indexer/src-tauri/src/queue.rs:61` (`hijo: Child`) | Sí | Legítimo |
| `indexer/src-tauri/src/origins/mod.rs:195,203` (`struct Falso`/`impl Falso`) | Sí | Legítimo |
| `indexer/src-tauri/src/origins/mapillary.rs:42,45` (`URL_TESELAS_VECTORIALES`, `CAPA_VECTORIAL`) | Sí, pero revela una duplicación real: `MapCanvas.tsx:129` tiene la misma URL de Mapillary escrita a mano | Cosmético |
| `indexer/src-tauri/src/origins/commons.rs:45` (`Categoria.title`) | No | Menor — campo deserializado sin leer, sin comentario que lo explique |
| `indexer/src-tauri/src/package.rs:179-180` (`fuentes_que_viajan`) | Comentario dice que espera al subsistema 8 | **No corresponde**: el propio plan 7b dice que esto es su responsabilidad (hueco #1) |

**Otras discrepancias menores respecto a la interfaz prometida (no bloqueantes):**
- `Cola::encolar` (7a Task 12) no existe como función; el bucle redescubre pendientes vía
  `Almacen::lotes_sin_terminar()` en cada iteración — funcionalmente equivalente, cambio no
  documentado.
- `Almacen::descargas_de` (7b Task 5) aparece de facto como `descargas_pendientes` con otra
  firma — cosmético.
- `indexer/src/catalog/IndexDetail.tsx:35` pasa `nombre={String(id)}` al `SealDialog`: el
  diálogo de sellado muestra el número de índice en vez de su nombre real, porque
  `DetalleIndice` (`lib.rs:142-145`) nunca incluye el campo `nombre`. Cosmético.
