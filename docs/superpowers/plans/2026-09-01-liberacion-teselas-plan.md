# Liberación de teselas propias — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Resolver BUG_BOUNTY #38 — dar al usuario una forma de solicitar la liberación de sus propias teselas reclamadas en el catálogo publicado, sin mover la clave privada Ed25519 de firma (`~/.lumi-indexer/desreclamos.key`) a ningún servidor (invariante de seguridad ya documentado en `crates/lumi-index/src/desreclamos.rs`).

**Architecture:** Flujo de dos fases: (1) el Indexer, autenticado con el token de GitHub que ya usa para publicar, pide la liberación de teselas concretas a un nuevo endpoint de la web; la web verifica la propiedad contra la `ficha.json` real (nunca confía en lo que dice el cliente) y añade la solicitud a una cola pendiente guardada en el propio repo (vía la API de GitHub, sin base de datos nueva). (2) El operador (tú) sigue firmando `desreclamos.json` con la herramienta offline ya existente (`firmar_desreclamos`), que ahora también lee esa cola pendiente para incorporarla al borrador antes de firmar — el paso de firma sigue siendo manual y offline, solo se automatiza la solicitud y su verificación de propiedad.

**Tech Stack:** Next.js (`web/`, API routes), Rust (`indexer/src-tauri`, `crates/lumi-index`), React/TS (`indexer/src`), GitHub REST API (OAuth device flow ya integrado).

## Global Constraints

- **No mover la clave privada de firma a ningún servidor.** Esta es la restricción de diseño que hace que esta feature no sea "liberación instantánea" sino "solicitud verificada + firma manual posterior".
- No tests unless explicitly requested (proyecto: `CLAUDE.md`).
- Un commit por tarea, mensaje en español explicando el porqué.
- `ponytail`: no introducir una base de datos nueva ni infraestructura nueva — reutilizar GitHub como almacén de la cola pendiente, igual que el resto del catálogo ya vive en releases/repos de GitHub.
- Español para UI/código de este repo.
- Antes de cada commit: `git status --short`, stage solo los archivos exactos de esta tarea.

---

### Task 1: Endpoint web para solicitar liberación, verificado contra la ficha real

**Root cause / contexto confirmado:** `web/app/api/desreclamos/route.ts` hoy solo SIRVE el `desreclamos.json` ya firmado (sin lógica). No existe ninguna ruta de escritura ni base de datos en `web/`. La verificación de propiedad de una tesela es: `Ficha.autor == cuenta de GitHub` (mismo patrón que `indexer/src-tauri/src/catalogo.rs`'s `perfil()`/`mios()`).

**Files:**
- Create: `web/app/api/desreclamos/solicitar/route.ts`
- Check: `web/package.json`/variables de entorno para ver si `web/` ya tiene algún token de GitHub (PAT/GitHub App) configurado para llamadas server-to-server; si no existe, esta tarea debe añadir uno nuevo como variable de entorno de Vercel (documentar en el commit qué variable hace falta configurar manualmente en el dashboard de Vercel — no se puede hacer desde aquí).

**Steps:**
- [ ] Leer `web/app/api/desreclamos/route.ts` y `web/app/api/versiones/route.ts` para entender el estilo de las rutas existentes (Next.js App Router, `GET`/`POST` handlers).
- [ ] Definir el contrato del endpoint `POST /api/desreclamos/solicitar`: body `{paquete: string, quadkeys: string[]}`, header `Authorization: Bearer <token de github>`.
- [ ] Implementar la verificación: con el token recibido, llamar a `GET https://api.github.com/user` para obtener el login real de GitHub (nunca confiar en un campo `cuenta` que mande el cliente). Luego, para el `paquete` indicado, obtener la `ficha.json` publicada real (mismo lugar de donde el Indexer ya la lee — revisar `catalogo.rs` para la URL exacta del release/asset de GitHub donde vive `ficha.json`) y comprobar que `ficha.autor` coincide con el login verificado. Si no coincide, devolver 403.
- [ ] Si la verificación pasa, añadir la solicitud a una cola pendiente persistida en el propio repo de GitHub (el mismo repo donde vive `web/releases/`, o un fichero dedicado `web/releases/liberaciones-pendientes.json`) usando la API de contenidos de GitHub (`PUT /repos/{owner}/{repo}/contents/{path}`, con el token/PAT del propio proyecto — no el del usuario, que solo sirve para verificar identidad) para leer-modificar-escribir ese JSON, añadiendo `{paquete, quadkeys, cuenta, fecha}` (usar una fecha determinista pasada por el cliente si `Date.now()` no está disponible en este contexto de build, o `new Date().toISOString()` si es runtime normal de servidor — confirmar que esto corre server-side, no en un contexto restringido).
- [ ] Devolver 200 con un cuerpo simple de confirmación si todo fue bien.
- [ ] Documentar en el mensaje de commit qué variable de entorno de Vercel hace falta configurar (el PAT/token del propio proyecto para escribir en el repo) si no existe ya una.
- [ ] Commit: `git add web/app/api/desreclamos/solicitar/route.ts` (+ cualquier fichero de config) + `git commit -m "feat: endpoint para solicitar liberacion de teselas, verificado contra la ficha real vía GitHub"`.

---

### Task 2: Comando y UI del Indexer para pedir la liberación

**Files:**
- Modify: `indexer/src-tauri/src/catalogo.rs` (o crear una función nueva en el mismo archivo)
- Modify: `indexer/src-tauri/src/lib.rs` (nuevo comando Tauri)
- Modify: `indexer/src/lib/api.ts` (wrapper del nuevo comando)
- Modify: `indexer/src/catalog/ProfileDialog.tsx` (o el componente donde se listan "mis teselas"/"mios" — UI para seleccionar y solicitar liberación)

**Steps:**
- [ ] Leer `catalogo.rs`'s `perfil()`/`mios()` (o equivalente) para entender cómo se listan hoy las teselas propias del usuario, y `publicar.rs` para el patrón exacto de llamada HTTP autenticada con el token de GitHub (`identidad::leer_testigo`).
- [ ] En `catalogo.rs`, añadir una función `pub async fn solicitar_liberacion(paquete: &str, quadkeys: &[String]) -> Result<...>` que: lea el token de GitHub guardado (`identidad::leer_testigo`), y haga `POST` a `https://lumi.s7lver.xyz/api/desreclamos/solicitar` (mismo dominio que `refrescar_desreclamos()` ya usa) con el body `{paquete, quadkeys}` y el header `Authorization: Bearer <token>`.
- [ ] En `lib.rs`, exponer esto como comando Tauri `#[tauri::command] async fn solicitar_liberacion_teselas(paquete: String, quadkeys: Vec<String>) -> Result<(), String>`.
- [ ] En `indexer/src/lib/api.ts`, añadir el wrapper `solicitarLiberacionTeselas(paquete: string, quadkeys: string[]): Promise<void>`.
- [ ] En la UI de perfil (`ProfileDialog.tsx` o donde se muestren "mis teselas reclamadas" — cruzar con el componente ya tocado en el plan de indexer de esta misma sesión para #59, `CoverageMap.tsx`, que ahora pinta un mapa real de la cobertura propia), añadir la posibilidad de seleccionar una o más teselas propias y pedir "Liberar" — un botón que llama a `solicitarLiberacionTeselas` y muestra confirmación ("Solicitud enviada — se procesará en la próxima actualización del catálogo") en vez de dar a entender que la liberación es instantánea (no lo es: sigue pendiente de que el operador firme).
- [ ] Verificar que `cargo check` en `indexer/src-tauri` y `npx tsc -b`/`npm run lint` en `indexer/` pasan limpio.
- [ ] Commit: `git add indexer/src-tauri/src/catalogo.rs indexer/src-tauri/src/lib.rs indexer/src/lib/api.ts indexer/src/catalog/ProfileDialog.tsx` (ajustar rutas exactas según lo que se toque) + `git commit -m "feat: el indexer permite solicitar la liberacion de teselas propias desde el perfil"`.

---

### Task 3: La herramienta de firma offline incorpora la cola pendiente

**Files:**
- Modify: `crates/lumi-index/examples/firmar_desreclamos.rs`

**Steps:**
- [ ] Leer el ejemplo completo (`generar-clave`, edición manual de `borrador.json`, `firmar`) para entender el flujo actual del operador.
- [ ] Añadir un subcomando (o un paso dentro de `firmar`) que descargue `web/releases/liberaciones-pendientes.json` (vía la API pública de GitHub, sin autenticación — es un fichero del propio repo, público) y lo fusione en `borrador.json` antes de firmar, evitando duplicados (comparar contra lo que ya esté en `borrador.json`/`desreclamos.json` firmado).
- [ ] Tras fusionar y firmar con éxito, el operador sigue siendo responsable de vaciar/actualizar `liberaciones-pendientes.json` (borrar las entradas ya procesadas) y comitear todo junto — esto sigue siendo un paso manual explícito, no se automatiza el commit/push (mantener la invariante: firma y publicación son acciones humanas deliberadas).
- [ ] Verificar `cargo check -p lumi-index --example firmar_desreclamos` limpio.
- [ ] Commit: `git add crates/lumi-index/examples/firmar_desreclamos.rs` + `git commit -m "feat: la herramienta de firma de desreclamos incorpora las solicitudes de liberacion pendientes antes de firmar"`.

---

## Verificación final

- [ ] `cargo build` limpio en el workspace.
- [ ] `cd indexer && npx tsc -b && npm run lint` sin errores.
- [ ] `git status --short` vacío tras todos los commits.
- [ ] Reportar en el resumen final: (a) qué variable de entorno de Vercel hace falta configurar manualmente si aplica, (b) confirmar que la clave privada de firma NUNCA se tocó ni se referenció desde `web/` — es la invariante de seguridad central de este plan.
