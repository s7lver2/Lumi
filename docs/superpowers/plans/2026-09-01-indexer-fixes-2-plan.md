# Indexer — Segunda tanda de fixes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Galería de imágenes no debe atascar el scroll con miles de imágenes, la migración de carpeta no debe quedar bloqueada para siempre por un job que terminó (con éxito o error) sin limpiar su flag, y la herramienta de firma de desreclamos debe tolerar un fallo de escritura transitorio (os error 1920) en vez de morir con un panic.

**Architecture:** `indexer/src`, `indexer/src-tauri`, y `crates/lumi-index/examples/firmar_desreclamos.rs`. No tocar `installer/` ni `client/` — otros planes cubren esos árboles en paralelo.

## Global Constraints

- No tests unless explicitly requested.
- Un commit por tarea, mensaje en español.
- `ponytail`: la solución más simple que funcione.
- Antes de cada commit: `git status --short`, stage solo archivos exactos de esta tarea.

---

### Task 1: Fallo de escritura al firmar desreclamos (#95)

**Root cause confirmado:** `crates/lumi-index/examples/firmar_desreclamos.rs`'s `firmar()` (línea ~154) y `fusionar_pendientes()` (línea ~131) hacen `std::fs::write(...).unwrap_or_else(|e| panic!(...))` directo — si el fichero de salida (`web/releases/desreclamos.json` o el `borrador.json`) está bloqueado momentáneamente por otro proceso (sync de OneDrive, editor con el fichero abierto, antivirus escaneando) Windows devuelve `os error 1920` y la herramienta muere con panic en vez de reintentar.

**Files:** Modify `crates/lumi-index/examples/firmar_desreclamos.rs`.

**Steps:**
- [ ] Añadir una función auxiliar `fn escribir_con_reintentos(ruta: &std::path::Path, contenido: &str)` que intente `std::fs::write` hasta 5 veces con una pequeña espera entre intentos (p.ej. 300ms), y solo haga panic con un mensaje claro ("no se pudo escribir {ruta} tras varios intentos — ¿está abierto en otro programa o sincronizándose? cierra ese programa y reintenta") si los 5 intentos fallan.
- [ ] Sustituir las dos llamadas directas a `std::fs::write` (en `firmar()` y `fusionar_pendientes()`) por esta función.
- [ ] Verificar `cargo check -p lumi-index --example firmar_desreclamos` limpio.
- [ ] Commit: `git add crates/lumi-index/examples/firmar_desreclamos.rs` + `git commit -m "fix: la herramienta de firmar desreclamos reintenta si el fichero esta bloqueado momentaneamente (os error 1920)"`.

---

### Task 2: Galería de imágenes no debe atascar el scroll (#96)

**Root cause confirmado:** `indexer/src/catalog/IndexMapDialog.tsx`, componente `Galeria` (líneas ~208-253). La paginación (`POR_PAGINA = 240`, botón "Cargar más") solo evita el choque INICIAL, pero `mostradas` únicamente crece — cada página cargada se queda montada en el DOM para siempre (`visibles = fichas.slice(0, mostradas)`, siempre un prefijo, nunca se desmontan las páginas anteriores). Con miles de imágenes tras varios "Cargar más", el navegador vuelve a decodificar/mantener miles de `<img>` a resolución completa (`convertFileSrc` apunta a ficheros reales, sin miniaturas), y el scroll se atasca.

**Files:** Modify `indexer/src/catalog/IndexMapDialog.tsx` (`Galeria`).

**Steps:**
- [ ] Comprobar si el proyecto ya tiene alguna librería de virtualización de listas disponible como dependencia (Grep `react-window`/`react-virtual`/`@tanstack/react-virtual` en `indexer/package.json`). Si no existe ninguna, evaluar si añadir una es proporcionado (ponytail: una librería pequeña y bien establecida como `@tanstack/react-virtual` es razonable aquí, dado que el problema es exactamente el caso de uso que resuelve — no es sobre-ingeniería, es la herramienta correcta para "miles de nodos DOM").
- [ ] Reescribir `Galeria` para virtualizar la rejilla: solo montar los `<img>` de las filas/celdas actualmente visibles (más un margen de scroll pequeño), calculando la posición absoluta de cada celda dentro de un contenedor con la altura total simulada — patrón estándar de grid virtualization.
- [ ] Mantener el comportamiento de carga incremental (no hace falta cargar los metadatos de TODAS las imágenes de golpe si el índice es enorme — pero si `fichas` ya viene completo desde el backend, la virtualización del render ya resuelve el problema de fondo sin tocar la carga de datos).
- [ ] Verificar manualmente con un índice grande (miles de imágenes) que el scroll ya no se atasca.
- [ ] Commit: `git add indexer/src/catalog/IndexMapDialog.tsx` (+ `package.json`/`package-lock.json` si se añadió una dependencia) + `git commit -m "fix: la galeria de imagenes virtualiza el render en vez de acumular miles de nodos DOM, arregla el atasco al hacer scroll"`.

---

### Task 3: Migración no debe quedar bloqueada por un job que ya terminó (#97)

**Root cause confirmado:** `indexer/src-tauri/src/lib.rs`, comando `ubicacion_migrar` (líneas ~116-138). El guard comprueba `.is_some()` sobre varios campos de estado (`estado.sellado`, `descarga`, `ingesta`, `sondeo`, `publicacion`, `pesos` — todos `Mutex<Option<Arc<...>>>`), pero esos campos se ponen a `Some(...)` al arrancar un job y **nunca vuelven a `None`**, ni al terminar con éxito ni con error (`paquete_sellar_arrancar` línea ~1063, `s.terminar(r)` en línea ~1066 no limpia el `Option` exterior). Solo `estado.migracion` hace el chequeo correcto (`.progreso().trabajando`, línea ~128). Resultado: un sellado que ya terminó (con error o sin él) deja el guard de migración bloqueado para siempre.

**Files:** Modify `indexer/src-tauri/src/lib.rs`.

**Steps:**
- [ ] Leer el punto exacto donde cada uno de estos jobs (`sellado`, `descarga`, `ingesta`, `sondeo`, `publicacion`, `pesos`) se marca como terminado (`s.terminar(r)` o equivalente) para entender la forma más simple de limpiar el `Option` exterior en ese mismo punto.
- [ ] Opción A (más simple, ponytail): justo después de que cada job termine (dentro del mismo `tokio::spawn`/closure que ya llama a `s.terminar(r)`), poner el campo correspondiente de `estado` a `None`.
- [ ] Opción B (si A resulta complicada por dónde vive `estado` respecto al spawn): en vez de limpiar el `Option`, cambiar el guard de `ubicacion_migrar` para que, igual que ya hace con `migracion`, compruebe el progreso real de cada job (`.progreso().trabajando` o el campo equivalente de cada tipo) en vez de solo la presencia del `Option`. Elegir la opción que requiera tocar menos sitios.
- [ ] Verificar manualmente: provocar un sellado que falle (o cualquier otro job de la lista), confirmar que tras el error el guard de migración ya NO lo considera "trabajo en curso" y permite migrar la carpeta.
- [ ] Commit: `git add indexer/src-tauri/src/lib.rs` + `git commit -m "fix: la migracion de carpeta ya no queda bloqueada por un job que ya termino, con exito o con error"`.

---

## Verificación final

- [ ] `cargo check -p lumi-index` y `cargo check` en `indexer/src-tauri` limpios.
- [ ] `cd indexer && npx tsc -b && npm run lint` sin errores.
- [ ] `git status --short` vacío tras los commits de este plan.
- [ ] Reportar cualquier desviación del plan al final.
