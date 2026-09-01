# Indexer — Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Arreglar 11 bugs/features del Indexer (`indexer/`): estilo del panel de Actualizaciones, migración de carpeta de datos, hueco de layout en Orígenes, toggles de "añadir capa" sobrantes, mapa de cobertura no-geográfico, barra de publicaciones recientes, solapamiento del panel de disponibilidad con el buscador, pantalla de embebido, redimensionado del mapa al cambiar de pestaña, selector de índice durante embebido, y tooltip de desglose de teselas por origen.

**Architecture:** Todos los cambios viven en `indexer/src` e `indexer/src-tauri`. No tocar `client/` ni `installer/` — otros planes cubren esos árboles en paralelo.

**Tech Stack:** Tauri v2 + React + TypeScript + Tailwind, Mapbox GL JS, SQLite (rusqlite, WAL).

## Global Constraints

- No tests unless explicitly requested (proyecto: `CLAUDE.md`), salvo `cargo test -p lumi-proto` si tocaras ese crate (no aplica en este plan).
- Un commit por tarea terminada, mensaje en español, cuerpo explicando el porqué.
- DESIGN.md: dark-theme-only, sin verde, mono font para datos técnicos, animaciones `cubic-bezier` exponential ease-out, respetar `prefers-reduced-motion`.
- `ponytail`: la solución más simple que funcione.
- Antes de cada commit: `git status --short` y confirmar que solo se staged los archivos propios de esta tarea (otro agente en paralelo puede estar tocando `client/`/`installer/` simultáneamente — no interferir con esos árboles).

---

### Task 1: Estilo y márgenes del panel de Actualizaciones (#54)

**Root cause:** `indexer/src/settings/ActualizacionesPanel.tsx` envuelve todo en `<div className="rounded-card border border-border bg-panel p-[13px_16px]">` — una "tarjeta" pegada a los bordes, sin el shell estándar de página que usan los paneles hermanos.

**Files:** Modify `indexer/src/settings/ActualizacionesPanel.tsx`.

**Steps:**
- [ ] Leer `indexer/src/settings/RendimientoPanel.tsx` (o `OriginsPanel.tsx`/`StoragePanel.tsx`) para confirmar el shell exacto: `<div className="h-full overflow-y-auto p-8"><div className="mx-auto max-w-xl">` (o `max-w-2xl`/`max-w-3xl` según el contenido), más un título `text-sm text-fg` y una descripción `text-[11px] text-muted`.
- [ ] Reemplazar el wrapper actual de `ActualizacionesPanel.tsx` por ese mismo shell, conservando el contenido interno (historial, botón de versión anterior, etc.) sin cambiar su lógica.
- [ ] Verificar visualmente en el dev server que el panel ahora tiene márgenes laterales y coincide con el estilo de los demás paneles de ajustes.
- [ ] Commit: `git add indexer/src/settings/ActualizacionesPanel.tsx` + `git commit -m "fix: panel de Actualizaciones del indexer usa el mismo shell que el resto de ajustes"`.

---

### Task 2: Migración no puede borrar el origen + carpeta actual no se actualiza (#55, #56)

**Root cause confirmado:** `indexer/src-tauri/src/ubicacion.rs:72-101` (`Migracion::arrancar`) copia el árbol y llama `std::fs::remove_dir_all(&origen)` sin liberar antes la conexión SQLite viva (`Almacen` en modo WAL, mantenida abierta durante toda la vida de la app vía `Estado.almacen: Arc<Almacen>`) — Windows rechaza borrar `indexer.db`/`-wal`/`-shm` con `os error 32`. Además, `Estado.dir` es un campo en memoria fijado una sola vez al arrancar; la migración solo actualiza el fichero puntero (`guardar_ubicacion`), nunca `Estado.dir`, así que `ubicacion_leer` sigue devolviendo la ruta vieja hasta reiniciar la app.

**Files:**
- Modify: `indexer/src-tauri/src/ubicacion.rs` (`Migracion::arrancar`)
- Modify: `indexer/src-tauri/src/lib.rs` (donde vive `Estado`, `ubicacion_leer`)
- Modify: `indexer/src/settings/StoragePanel.tsx` (mensaje al usuario)

**Steps:**
- [ ] Leer `store.rs` (`Almacen::abrir`) y `lib.rs` para entender cómo `Estado.almacen` guarda la conexión y si `Almacen`/`rusqlite::Connection` expone algún método de cierre explícito o si basta con soltar el `Arc` (drop) para cerrar el handle del SO.
- [ ] En `Migracion::arrancar`, antes de `remove_dir_all(&origen)`: cerrar/soltar la conexión SQLite activa que apunta a `origen` (si el `Estado`/`Almacen` es accesible desde ahí; si no, exponer un método `Estado::cerrar_almacen()` o similar que haga `drop` explícito del `Arc<Almacen>` y lo deje en `None`/reconstruible). El objetivo mínimo: que no quede ningún handle abierto sobre `origen/indexer.db*` en el momento del `remove_dir_all`.
- [ ] Si tras soltar el handle Windows sigue reportando el archivo en uso (posible por WAL checkpoint pendiente), ejecutar `PRAGMA wal_checkpoint(TRUNCATE)` justo antes de cerrar la conexión, para fusionar el WAL al archivo principal y liberar `-wal`/`-shm`.
- [ ] Si tras todo esto el borrado sigue pudiendo fallar de forma esporádica (otro proceso externo con el handle abierto), no fallar la migración entera por eso: capturar el error de `remove_dir_all`, loguearlo, y devolver éxito con una nota — los datos ya están copiados y esto no debe bloquear al usuario (mismo espíritu que el mensaje que ya se le mostraba antes: "borra el origen a mano cuando quieras").
- [ ] Para #56: tras completar la migración, actualizar `Estado.dir` en memoria a la nueva ruta (reconstruyendo/reabriendo el `Almacen` sobre el nuevo directorio si aún no se ha hecho) para que `ubicacion_leer` devuelva la ruta correcta sin necesidad de reiniciar. Si reabrir el `Almacen` en caliente es arriesgado (otros comandos dependen de él concurrentemente), como mínimo: hacer que `ubicacion_leer` lea siempre del fichero puntero en disco (`ubicacion::leer_ubicacion()`) en vez de depender del campo en memoria potencialmente obsoleto — la opción más simple (ponytail) si reabrir el almacén en caliente resulta complejo.
- [ ] En `StoragePanel.tsx`, si la migración sigue requiriendo reinicio para efectos completos, mantener/clarificar el mensaje existente; si el fix anterior ya lo hace sin reinicio, quitar cualquier aviso de "reinicia la app" que ya no aplique.
- [ ] Probar manualmente: migrar la carpeta de datos con el índice abierto, confirmar que el origen se borra (o falla con log claro sin romper el flujo) y que "Carpeta actual" refleja la nueva ruta inmediatamente.
- [ ] Commit: `git add indexer/src-tauri/src/ubicacion.rs indexer/src-tauri/src/lib.rs indexer/src/settings/StoragePanel.tsx` + `git commit -m "fix: migracion de carpeta libera el handle SQLite antes de borrar el origen y refresca la ruta actual"`.

---

### Task 3: Panel de tope mensual debe rellenar el hueco (#57)

**Root cause confirmado (vía `git show 9fc07b9`):** al quitar la tarjeta "Dónde va la clave" de una fila `flex gap-3.5` de dos columnas en `OriginsPanel.tsx`, la tarjeta restante ("Tope mensual") se quedó con `max-w-sm`, dejando un hueco vacío a su derecha en vez de expandirse.

**Files:** Modify `indexer/src/settings/OriginsPanel.tsx` (línea ~201-202).

**Steps:**
- [ ] Localizar la tarjeta de "Tope mensual" en `OriginsPanel.tsx` y cambiar `max-w-sm` por `max-w-none` (o quitar la restricción de ancho máximo) para que ocupe el ancho completo de la fila.
- [ ] Verificar visualmente que ya no queda hueco vacío en esa sección.
- [ ] Commit: `git add indexer/src/settings/OriginsPanel.tsx` + `git commit -m "fix: panel de tope mensual rellena el hueco dejado al quitar la tarjeta de donde va la clave"`.

---

### Task 4: Quitar toggles sobrantes de "añadir capa" (#67)

**Root cause confirmado:** `indexer/src/catalog/IndexDetail.tsx:255-272` renderiza un botón "Añadir capa {modelo}" por cada modelo con embedding faltante, dentro del bloque "faltantes", visible cada vez que abres un proyecto y luego un índice dentro de él.

**Files:** Modify `indexer/src/catalog/IndexDetail.tsx`.

**Steps:**
- [ ] Leer el bloque completo (líneas ~250-280) para entender qué otra UI existe para gestionar modelos de embedding faltantes — cruzar con el fix ya hecho para BUG_BOUNTY #35 ("los modelos de embed deben ser modificables después de crear el índice") para no duplicar esa funcionalidad ni romperla.
- [ ] Quitar el bloque de botones "Añadir capa {modelo}" de la vista de detalle del índice dentro de un proyecto (según pide el bug), dejando la gestión de modelos donde corresponda tras el fix de #35 (probablemente un modal/panel de edición de modelos, no botones sueltos aquí).
- [ ] Verificar que abrir un proyecto → un índice ya no muestra esos toggles/botones, y que sigue siendo posible gestionar modelos de embedding desde el flujo correcto.
- [ ] Commit: `git add indexer/src/catalog/IndexDetail.tsx` + `git commit -m "fix: quitar los toggles de anadir capa sobrantes al ver un indice dentro de un proyecto"`.

---

### Task 5: Cobertura como mapa real del mundo (#59)

**Root cause confirmado:** `indexer/src/catalog/CoverageMap.tsx` (usado desde `ProfileDialog.tsx:69`) agrupa quadkeys en "islas" y las dibuja como una rejilla CSS abstracta — no es un mapa geográfico real, por diseño explícito (comentario propio en el archivo).

**Files:** Modify `indexer/src/catalog/CoverageMap.tsx`.

**Steps:**
- [ ] Leer `indexer/src/download/DownloadMap.tsx` o `indexer/src/territory/MapCanvas.tsx` para ver el patrón ya usado en este proyecto para pintar quadkeys sobre un mapa Mapbox GL real (fuente GeoJSON, capa de relleno).
- [ ] Reescribir `CoverageMap.tsx` para inicializar un mapa Mapbox GL (reutilizando el token/estilo ya usado en otros mapas del proyecto) y pintar los polígonos reales de los quadkeys de cobertura como una capa de relleno, en vez de la rejilla CSS sintética. Mantener la interfaz pública del componente (props) igual si es posible, para no tener que tocar `ProfileDialog.tsx`.
- [ ] Ajustar el tamaño/zoom inicial del mapa para encuadrar automáticamente la extensión de la cobertura del usuario (fit bounds sobre los quadkeys).
- [ ] Verificar visualmente en un perfil con cobertura real que el mapa muestra la forma geográfica correcta.
- [ ] Commit: `git add indexer/src/catalog/CoverageMap.tsx` + `git commit -m "feat: cobertura en el perfil ahora es un mapa geografico real, no una rejilla abstracta"`.

---

### Task 6: Barra única para publicaciones recientes (#60)

**Root cause confirmado:** Hoy cada publicación reciente tiene su propia fila con su propio `SourceBar` apilado por fuente. Se pide una única barra cuyos segmentos sean las publicaciones mismas, proporcionales a su peso. `SourceBar`'s rama `unidad="imágenes"` ya usa el patrón de barra apilada + leyenda que hace falta.

**Files:**
- Modify: `indexer/src/catalog/ProfileDialog.tsx` (líneas ~72-90)
- Modify: `indexer/src/catalog/SourceBar.tsx` (si hace falta un modo nuevo, o reutilizar el existente)

**Steps:**
- [ ] Leer `SourceBar.tsx` completo, en particular la rama `unidad="imágenes"` (líneas ~41-58), para entender su forma de datos de entrada (array de `{nombre, valor, color}` o similar).
- [ ] En `ProfileDialog.tsx`, sustituir el bucle que renderiza una fila+`SourceBar` por publicación por una única llamada a `SourceBar` (o un nuevo modo del mismo componente) cuyos segmentos sean las publicaciones recientes, con el tamaño de cada segmento proporcional a su peso (teselas o conteo — usar el mismo criterio que ya se usaba para ordenarlas/mostrarlas).
- [ ] Mantener una leyenda que identifique cada publicación (nombre + porcentaje), reutilizando el estilo de leyenda ya existente en `SourceBar`.
- [ ] Verificar visualmente con un perfil que tenga varias publicaciones recientes.
- [ ] Commit: `git add indexer/src/catalog/ProfileDialog.tsx indexer/src/catalog/SourceBar.tsx` + `git commit -m "feat: publicaciones recientes del perfil como una sola barra proporcional"`.

---

### Task 7: Panel de disponibilidad no debe solaparse con el buscador (#61)

**Root cause confirmado:** `AvailabilityPanel` (`absolute left-3 top-[68px] z-20`) y el panel de info de búsqueda `lugarSeleccionado` dentro de `MapCanvas.tsx` (`absolute left-3 top-[76px] z-20`, líneas ~717-741) comparten z-index y posición casi idéntica, sin ningún estado que los haga mutuamente excluyentes — el que pinta después (orden del DOM) queda encima.

**Files:**
- Modify: `indexer/src/territory/TerritoryView.tsx`
- Modify: `indexer/src/territory/AvailabilityPanel.tsx`
- Modify: `indexer/src/territory/MapCanvas.tsx`

**Steps:**
- [ ] Leer cómo `TerritoryView.tsx` decide si mostrar `AvailabilityPanel` (ligado a si hay una forma dibujada, tras el fix de #41) y cómo `MapCanvas.tsx` decide mostrar `lugarSeleccionado` (ligado a si hay un lugar buscado, tras el fix de #43).
- [ ] Introducir la exclusión mutua: cuando hay un lugar buscado seleccionado (`lugarSeleccionado` no nulo), ocultar `AvailabilityPanel`; cuando se dibuja/selecciona una forma de territorio, limpiar `lugarSeleccionado` para ocultar el panel de info de búsqueda. La forma más simple (ponytail): que ambos estados vivan en el padre común (`TerritoryView`) o se comuniquen vía un callback ya existente, y que activar uno limpie el otro explícitamente en el punto donde cada uno se establece.
- [ ] Verificar visualmente: buscar un lugar (aparece su panel de info), luego dibujar una forma de territorio (debe desaparecer el panel de búsqueda y aparecer el de disponibilidad), y viceversa.
- [ ] Commit: `git add indexer/src/territory/TerritoryView.tsx indexer/src/territory/AvailabilityPanel.tsx indexer/src/territory/MapCanvas.tsx` + `git commit -m "fix: panel de disponibilidad y panel de busqueda ahora son mutuamente excluyentes, no se solapan"`.

---

### Task 8: Embebido como pantalla completa con auto-navegación, y barra que espera a todos los orígenes (#62, #63)

**Root cause confirmado:** `indexer/src/embed/DescargaYEmbebidoView.tsx` apila descarga (arriba) y embebido (abajo) en la misma pantalla/scroll, y muestra la sección de embebido en cuanto CUALQUIER modelo tiene trabajo en cola (`indexer/src/ui/IndexQueueBar.tsx` y `DescargaYEmbebidoView.tsx:59-60,84,89`), sin esperar a que todos los orígenes activos terminen de descargar — comportamiento intencional pero mal comunicado (el bug real es que aparece "solo con imágenes de un proveedor").

**Files:**
- Modify: `indexer/src/embed/DescargaYEmbebidoView.tsx`
- Modify: `indexer/src/ui/IndexQueueBar.tsx`
- Check: `indexer/src/App.tsx` (`onTerminadoDescarga`, líneas ~214-218) y `indexer/src/ui/Rail.tsx` para el enrutado de pestañas.

**Steps:**
- [ ] Para #62: en la condición que decide mostrar la barra/sección de embebido, añadir el requisito de que la descarga esté completa en TODOS los orígenes activos (no solo que exista alguna fila con trabajo). Buscar el estado de progreso de descarga por origen (ya usado en `DownloadView.tsx`, `p.por_origen`) y exponerlo/consultarlo aquí para construir esa condición.
- [ ] Para #63: separar el embebido en su propia vista de pantalla completa, con el mismo layout/estructura que `DownloadView.tsx` (no una sección apilada). Cablear la navegación automática: cuando la descarga termina (`onTerminadoDescarga` en `App.tsx`), cambiar la pestaña/vista activa a la de embebido en vez de dejar ambas co-renderizadas.
- [ ] Verificar manualmente el flujo completo: iniciar una descarga con 2+ orígenes activos, confirmar que el embebido NO aparece hasta que todos terminan, y que al terminar la descarga se navega automáticamente a una pantalla de embebido a tamaño completo.
- [ ] Commit: `git add indexer/src/embed/DescargaYEmbebidoView.tsx indexer/src/ui/IndexQueueBar.tsx indexer/src/App.tsx` (+ `Rail.tsx` si se tocó) + `git commit -m "feat: embebido es pantalla completa y espera a que terminen todos los origenes antes de mostrarse"`.

---

### Task 9: Mapa no se encoge al cambiar de pestaña durante el embebido (#64)

**Root cause confirmado:** `indexer/src/download/DownloadMap.tsx` nunca llama a `mapboxgl.Map.resize()` ni usa `ResizeObserver`; su contenedor cambia de `flex-[2]` a `flex-1` según el estado async `hayEmbebido`, y cambiar de pestaña en `Rail` desmonta/remonta la vista de descarga mientras ese estado aún se está asentando — el mapa se inicializa contra un contenedor transitorio/pequeño y nunca se le avisa de que debe recalcular tamaño.

**Files:** Modify `indexer/src/download/DownloadMap.tsx`.

**Steps:**
- [ ] Añadir un `ResizeObserver` sobre el contenedor del mapa en `DownloadMap.tsx` que llame a `map.resize()` cada vez que las dimensiones del contenedor cambien (patrón estándar de Mapbox GL para contenedores con tamaño dinámico).
- [ ] Alternativa/complemento más simple si el `ResizeObserver` resulta excesivo: llamar explícitamente a `map.resize()` en un `useEffect` que dependa del estado `hayEmbebido` (o el prop equivalente que cambia el `flex-*`), con un pequeño `setTimeout(0)` para esperar a que el reflow del layout haya terminado antes de medir.
- [ ] Verificar manualmente: durante el embebido, cambiar entre pestañas repetidamente y confirmar que el mapa mantiene su tamaño correcto al volver.
- [ ] Commit: `git add indexer/src/download/DownloadMap.tsx` + `git commit -m "fix: el mapa de descarga se redimensiona correctamente al cambiar de pestana durante el embebido"`.

---

### Task 10: No permitir cambiar de índice durante el embebido (#65)

**Root cause confirmado:** El botón `«{nombreIndice}» · cambiar índice` en `DescargaYEmbebidoView.tsx` (líneas ~95-97) llama a `onCambiarIndice` incondicionalmente, sin gating sobre si hay trabajo de embebido en curso.

**Files:** Modify `indexer/src/embed/DescargaYEmbebidoView.tsx`.

**Steps:**
- [ ] Identificar el estado que indica trabajo de embebido en curso (p.ej. `cola.some(p => p.trabajando)` o equivalente, ya usado para las barras de progreso en este mismo archivo).
- [ ] Deshabilitar el botón "cambiar índice" mientras ese estado sea verdadero, siguiendo el patrón de "capability matrix" del proyecto (CLAUDE.md): deshabilitado con una razón visible (tooltip o texto adyacente tipo "no disponible mientras se está embebiendo"), no ocultar el control sin explicación.
- [ ] Verificar manualmente: iniciar embebido, confirmar que el botón queda deshabilitado con su motivo visible, y que se reactiva al terminar.
- [ ] Commit: `git add indexer/src/embed/DescargaYEmbebidoView.tsx` + `git commit -m "fix: no se puede cambiar de indice mientras el embebido esta en curso"`.

---

### Task 11: Tooltip con el desglose real del conteo de teselas (#66, pedido explícito del usuario)

**Contexto:** No es un bug de conteo — es intencional que 1 tesela física procesada por 2 orígenes activos cuente como 2 en `teselas_total`/`teselas_hechas` (test ya existente en `download.rs` lo documenta). El usuario pidió: al hacer hover sobre el número, mostrar de dónde sale la cuenta.

**Datos ya disponibles:** `ProgresoDescarga.por_origen: LineaOrigen[]` (`indexer/src/lib/api.ts:158-165`), cada entrada con `{fuente, hechas, total, imagenes, coste_eur}` — no hace falta tocar el backend.

**Files:** Modify `indexer/src/download/DownloadView.tsx` (líneas ~76-79, el `<span>` "N de M teselas").

**Steps:**
- [ ] Envolver el `<span className="font-mono text-[11px] text-muted">{p.teselas_hechas} de {p.teselas_total} teselas...</span>` (línea ~76) en un contenedor con un tooltip nativo/existente en el proyecto (buscar si hay un componente `Tooltip` reutilizable en `indexer/src/ui/`; si no existe, usar el atributo `title` nativo del navegador como fallback simple — ponytail, no introducir una librería de tooltips para esto).
- [ ] Construir el texto del tooltip a partir de `p.por_origen`, listando cada origen con su `nombre(fuente)` (helper ya usado en este archivo) y su `hechas`/`total` individual, p.ej.: `"Mapillary: 1 de 1 · KartaView: 1 de 1"` — dejando claro que el total combinado es la suma de tesela×origen, no teselas físicas distintas.
- [ ] Verificar visualmente: descargar con 2 orígenes activos sobre 1 tesela, pasar el ratón sobre "1 de 2 teselas" (o el conteo que corresponda) y confirmar que el tooltip muestra el desglose por origen.
- [ ] Commit: `git add indexer/src/download/DownloadView.tsx` + `git commit -m "feat: tooltip en el contador de teselas muestra el desglose por origen"`.

---

## Nota: #58 ya está implementado

`services.rs:359-387` (`Servicios::parar()`) ya detiene Redis/Qdrant al cerrar la app (`lib.rs:1810-1816`, hook de `tauri::RunEvent::Exit`), incluyendo instancias arrancadas por la app dentro de WSL. La única limitación (instancias "adoptadas" no arrancadas por el Indexer no se pueden matar sin API de shutdown) es intencional y ya está registrada en el propio código. **No crear ninguna tarea para #58** — si tienes tiempo, verifica manualmente que sigue funcionando y repórtalo, pero no es parte del trabajo de este plan.

## Verificación final

- [ ] `cargo build` limpio en el workspace (o al menos `cargo check -p lumi-index` si el build completo es lento).
- [ ] `cd indexer && npx tsc -b && npm run lint` sin errores.
- [ ] `git status --short` vacío tras todos los commits de este plan.
- [ ] Reportar cualquier desviación del plan al final.
