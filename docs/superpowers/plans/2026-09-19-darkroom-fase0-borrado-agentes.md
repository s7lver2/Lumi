# Darkroom Fase 0: borrado completo de los agentes — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminar el subsistema de agentes (5c) del repo entero — daemon, cliente, Python, crates compartidos, web y datos — dejando `cargo build`, `npx tsc -b --noEmit`, `npm run lint` y `cargo test -p lumi-proto` en verde y sin ninguna coincidencia de `agente` fuera de los specs derogados.

**Architecture:** No hay diseño nuevo — es una extirpación quirúrgica siguiendo el árbol de dependencias de hojas a raíz (datos → cliente → Python → daemon periferia → daemon núcleo → esquema → crates compartidos → web/docs), para que el árbol compile en cada paso intermedio. Tres puntos comparten código con subsistemas que se quedan (`BetaPill`, `persistente.rs`, `lumi_motores.py`) y se tratan como excepciones explícitas, no como borrado.

**Tech Stack:** Rust (`crates/lumid`, `crates/lumi-proto`, `crates/lumi-index`), TypeScript/React (`client/`), Python (`workers/`), Next.js/MDX (`web/`).

## Global Constraints

- **No se borra** `registros/motores/` (lo leen `cargar_motores`, `routes/models.rs` y `store.rs:552`; `real-esrgan.json` alimenta el upscaler), `crates/lumi-index/src/geo.rs` (lo usa `routes/export.rs` para el país en el PDF), `routes/rendimiento.rs` ni `routes/calibracion.rs` como ficheros (alojan también interruptores de verificación — solo se les quita lo de agentes).
- **`BetaPill` se reubica a `client/src/ui/` ANTES de borrar `AgentPickerPopup.tsx`**, o el cliente no compila (`ModelPicker.tsx` lo importa).
- **`persistente.rs` se queda como módulo.** Solo se retira el campo `agentes_persistente` y su valor; el parámetro `limite: Option<Duration>` de `Persistente::pedir` se deja aunque quede sin usuario — es la red de seguridad de un proceso persistente colgado, y la verificación podría usarlo mañana.
- **`workers/lumi_motores.py` se queda.** Solo se borra la clase `Vlm`, su entrada en `CLASES` y su rama en `cargar_motor`. `Upscalador`, `_directorio` y `cargar_motor` siguen ahí — los usa `workers/lumi_upscale.py`.
- **`analysis_agents`**: `DROP TABLE`, sin migración de datos — nadie fuera de agentes la lee.
- **Análisis con `model = 'agentes'`**: se borran de `analyses` (huérfanos si se dejan).
- **`analysis_hypotheses.motivo_agente`**: se deja como columna muerta (SQLite no permite `DROP COLUMN` en este esquema sin recrear la tabla completa) — se retira de los `SELECT` y de los structs, no de la tabla.
- **Specs históricos de agentes** (`docs/superpowers/specs/2026-08-13-agentes-5c-design.md`, `2026-09-17-agentes-rediseno-design.md` y sus planes): se marcan derogados con una nota al principio, **no se borran**.
- **Pesos en disco** (`pesos/qwen3-vl-8b/`, ~5,5 GB): no se borran automáticamente — se avisa en el panel de Modelos.
- Cada tarea termina con el árbol compilando (`cargo build` para Rust, `npx tsc -b --noEmit` para el cliente) — no dejar una tarea a medias entre commits.
- Idioma español en comentarios, commits y mensajes de UI, siguiendo la convención del repo.

---

### Task 1: Datos y docs (no compilan) + specs derogados

**Files:**
- Delete: `registros/agentes/` (carpeta completa, 8 fichas)
- Delete: `registros/niveles/agentes.json`
- Delete: `registros/motores/qwen3-vl.json`
- Delete: `pruebas/agentes/` (carpeta completa)
- Delete: `tools/evaluar_agentes.py`
- Modify: `registros/niveles/mini.json`, `registros/niveles/pro.json`, `registros/niveles/vision.json` — quitar la clave `"agentes"` de cada uno
- Modify: `docs/superpowers/specs/2026-08-13-agentes-5c-design.md` — nota de derogación al principio
- Modify: `docs/superpowers/specs/2026-09-17-agentes-rediseno-design.md` — nota de derogación al principio
- Modify: cualquier plan asociado a esos dos specs bajo `docs/superpowers/plans/` que empiece con `2026-08-13-agentes` o `2026-09-17-agentes` — misma nota

**Interfaces:**
- Consumes: nada (es el primer paso, hojas puras)
- Produces: nada que el código lea todavía — `mini.json`/`pro.json`/`vision.json` sin `"agentes"` es lo que consumirá `crates/lumi-index/src/niveles.rs` cuando se le quite el campo en el Task 10, pero hasta entonces el campo simplemente falta y Serde con `#[serde(default)]` (verificar en el propio `niveles.rs` si ya lo tiene) lo deja vacío — si NO lo tiene, este task rompe el build de `lumi-index`; en ese caso, ejecutar este cambio de JSON como parte del Task 10 en su lugar y omitirlo aquí.

- [ ] **Step 1: Comprobar si `Nivel.agentes` tiene `#[serde(default)]`**

```bash
grep -n "agentes" crates/lumi-index/src/niveles.rs | head -5
sed -n '15,26p' crates/lumi-index/src/niveles.rs
```

Si la línea inmediatamente anterior a `pub agentes: Vec<String>,` es `#[serde(default)]`, continuar con el Step 2. Si no lo es, **saltar los cambios de `mini.json`/`pro.json`/`vision.json` de este task** y hacerlos en el Task 10 en su lugar (junto con el borrado del campo `agentes` de `Nivel`), para no romper el `cargo build` entre tasks.

- [ ] **Step 2: Borrar datos de agentes**

```bash
git rm -r "registros/agentes"
git rm "registros/niveles/agentes.json"
git rm "registros/motores/qwen3-vl.json"
git rm -r "pruebas/agentes"
git rm "tools/evaluar_agentes.py"
```

- [ ] **Step 3: Quitar `"agentes"` de los niveles (solo si el Step 1 confirmó `#[serde(default)]`)**

Editar `registros/niveles/mini.json`, `registros/niveles/pro.json` y `registros/niveles/vision.json`: cada uno tiene una clave de nivel superior `"agentes": [...]` (una lista de ids). Borrar esa clave entera (con su coma) en los tres ficheros.

- [ ] **Step 4: Marcar los specs de agentes como derogados**

Al principio de `docs/superpowers/specs/2026-08-13-agentes-5c-design.md`, insertar como primera línea del fichero (antes del `# Título` existente):

```markdown
> **DEROGADO** (2026-09-19): el subsistema de agentes descrito aquí se ha
> eliminado por completo. Ver `docs/superpowers/specs/2026-09-19-darkroom-design.md`
> (Parte 1) para el porqué y el plan de borrado.

```

Repetir la misma nota (mismo texto) al principio de `docs/superpowers/specs/2026-09-17-agentes-rediseno-design.md`.

- [ ] **Step 5: Marcar los planes asociados como derogados**

```bash
ls docs/superpowers/plans/ | grep -i agente
```

Para cada fichero que liste, insertar la misma nota de derogación del Step 4 al principio.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore(darkroom): borrar datos de agentes y derogar sus specs (fase 0, paso 1/11)"
```

---

### Task 2: Cliente — mover `BetaPill` y limpiar referencias de superficie

**Files:**
- Modify: `client/src/work/AgentPickerPopup.tsx:130` (definición de `BetaPill`, a borrar de aquí)
- Create: nueva exportación de `BetaPill` en `client/src/ui/` (ver Step 1 para decidir el fichero exacto según lo que ya exista ahí)
- Modify: `client/src/work/ModelPicker.tsx:3` (import), `:65`, `:96` (usos) — apuntar al nuevo origen
- Modify: `client/src/lib/models.ts:7` — quitar `"agentes"` de `KNOWN_MODELS`

**Interfaces:**
- Produces: `BetaPill` exportado desde `client/src/ui/BetaPill.tsx` (o el fichero que el Step 1 elija), mismo componente sin cambios de props — lo consume `ModelPicker.tsx` en este mismo task y no debería tener más consumidores (verificar con grep en el Step 4).

- [ ] **Step 1: Ver el contenido actual de `client/src/ui/` para decidir dónde vive `BetaPill`**

```bash
ls client/src/ui/
sed -n '125,140p' client/src/work/AgentPickerPopup.tsx
```

Si `client/src/ui/` tiene un fichero de componentes pequeños genéricos (p. ej. `Pill.tsx`, `Badges.tsx`), añadir `BetaPill` ahí. Si no existe ninguno así, crear `client/src/ui/BetaPill.tsx` con el mismo cuerpo de función que tenía en `AgentPickerPopup.tsx:130` (léelo con el `sed -n` de arriba y cópialo literal — no reescribir su JSX).

- [ ] **Step 2: Actualizar el import en `ModelPicker.tsx`**

En `client/src/work/ModelPicker.tsx:3`, cambiar:

```ts
import { BetaPill } from "./AgentPickerPopup";
```

por (ajustar la ruta al fichero elegido en el Step 1, p. ej.):

```ts
import { BetaPill } from "../ui/BetaPill";
```

- [ ] **Step 3: Quitar `"agentes"` de `KNOWN_MODELS`**

En `client/src/lib/models.ts:7`:

```ts
export const KNOWN_MODELS = ["mini", "pro", "vision", "agentes"];
```

pasa a:

```ts
export const KNOWN_MODELS = ["mini", "pro", "vision"];
```

- [ ] **Step 4: Verificar que no queda ningún otro import de `BetaPill` desde `AgentPickerPopup`**

```bash
grep -rn "BetaPill" client/src/
```

Debe mostrar solo la definición nueva y el uso en `ModelPicker.tsx`. Si aparece en algún otro fichero, actualizar su import igual que en el Step 2.

- [ ] **Step 5: Compilar el cliente para confirmar que este paso no rompe nada por sí solo**

```bash
cd client && npx tsc -b --noEmit
```

Esperado: sin nuevos errores relacionados con `BetaPill` o `KNOWN_MODELS` (habrá errores de tipos en los ficheros que aún usan `agentes`/`AgentPickerPopup` — se resuelven en el Task 3, no aquí).

- [ ] **Step 6: Commit**

```bash
git add client/src/ui client/src/work/AgentPickerPopup.tsx client/src/work/ModelPicker.tsx client/src/lib/models.ts
git commit -m "refactor(client): reubicar BetaPill fuera de AgentPickerPopup (fase 0, paso 2a/11)"
```

---

### Task 3: Cliente — borrar los tres componentes de agentes y limpiar sus consumidores

**Files:**
- Delete: `client/src/work/AgentPickerPopup.tsx`, `client/src/work/AgentResultPopup.tsx`, `client/src/work/AgenteIcono.tsx`
- Modify: `client/src/work/CaseView.tsx:21-22` (imports), `:45`, `:198-207` (estado `agentPickerImage`/`agentResult`), `:593-715` (los usos y el JSX de los dos popups)
- Modify: `client/src/work/ResultsDrawer.tsx:3,7` (imports), `:30` (`motivo_agente: null`), `:207-346` (`AgentesPanel` y sus usos)
- Modify: `client/src/work/AttemptsRail.tsx:25-26,45` (comentarios que referencian agentes — no hay lógica que borrar, solo actualizar el comentario si describe el modo agentes como vigente)
- Modify: `client/src/work/ExportPopup.tsx:90,98,104,130` (opción "Veredictos de agentes")
- Modify: `client/src/admin/CalibracionView.tsx:87-89,104,122,144,146,162-172,181` (sección "Agentes persistentes" / timeout de agentes)
- Modify: `client/src/admin/ModelosView.tsx:36-37,56` (contadores `agentes_total`/`agentes_instalados`)
- Modify: `client/src/lib/api.ts:22,37-45,250-254,381-388,410-435,438-443` (tipos `AgenteVista`, `DichoDeAgente`, campos `agente`/`agentes`/`motivo_agente`/`agentes_persistente*`/`agentes_timeout_s`/`agentes_total`/`agentes_instalados`)
- Modify: `client/src/lib/bridge.ts:172` (`veredictos_agentes: boolean` en el tipo de opciones de export)
- Modify: `client/src/work/MediaDrawer.tsx:31-32` (comentario que menciona "agentes" como opción del popup de modelo)
- Modify: `client/src/work/Dock.tsx:37` (comentario)
- Modify: `client/src/lib/toasts.ts:8,44,58` (comentarios)

**Interfaces:**
- Consumes: `client/src/lib/models.ts::KNOWN_MODELS` sin `"agentes"` (Task 2)
- Produces: `client/src/lib/api.ts` sin `AgenteVista`, `DichoDeAgente`, ni los campos derivados — el Task 10 (daemon: `lumi-proto`) y este task deben quedar coherentes entre sí; como este task va antes, aquí se borra el lado del cliente aunque el daemon todavía envíe esos campos por un rato (JSON con campos de más no rompe nada, TypeScript solo deja de esperarlos).

- [ ] **Step 1: Borrar los tres componentes**

```bash
git rm client/src/work/AgentPickerPopup.tsx client/src/work/AgentResultPopup.tsx client/src/work/AgenteIcono.tsx
```

- [ ] **Step 2: Limpiar `CaseView.tsx`**

Quitar las líneas 21-22 (imports):

```ts
import { AgentPickerPopup } from "./AgentPickerPopup";
import { AgentResultPopup } from "./AgentResultPopup";
```

Quitar el estado de las líneas 198-207 (los dos `useState` de `agentPickerImage` y `agentResult`, con sus comentarios).

Buscar y quitar el bloque JSX de los dos popups (líneas ~700-715, empiezan por `<AgentPickerPopup` y `<AgentResultPopup>`).

En el callback que hoy hace `onAbrirAgente={() => { ... setAgentResult(...) }}` (línea ~593-608) y en el que hace `if (imgs.length === 1) { setAgentPickerImage(imgs[0]); return; }` (línea ~619) y el bloque `if (m === "agentes") { ... setAgentPickerImage(img); }` (líneas ~681-691): estas ramas dejan de tener sentido sin el modo `"agentes"`. Leer el fichero completo entre las líneas 580-720 con:

```bash
sed -n '580,720p' client/src/work/CaseView.tsx
```

y quitar toda rama condicional que solo exista para enrutar hacia el modo `agentes` (comparaciones `m === "agentes"`, `onAbrirAgente`, y las funciones que solo alimentan a `agentPickerImage`/`agentResult`), dejando el flujo normal de `mini`/`pro`/`vision` intacto.

- [ ] **Step 3: Limpiar `ResultsDrawer.tsx`**

Quitar `DichoDeAgente` del import de tipos en la línea 3 y el import de `AgenteIcono` en la línea 7.

Borrar la función `AgentesPanel` completa (líneas ~207-234, delimitada por `function AgentesPanel(...)` hasta su `}` de cierre).

En la línea 30, `motivo_agente: null,` — este campo sigue existiendo en `Hipotesis` porque la columna de BD no se borra (ver Global Constraints), así que **este valor por defecto se queda**; no tocar esta línea en este task.

Quitar los dos usos de `AgentesPanel` (línea ~334, `{analysis && <AgentesPanel .../>}`) y el bloque condicional de la línea ~335 (`analysis.agentes.length === 0`) junto con el mensaje "Los agentes tardaron demasiado..." de la línea ~346.

Quitar `onAbrirAgente` de las props del componente que lo declara (líneas ~264, ~276) y de cualquier sitio donde se le pase.

- [ ] **Step 4: Limpiar `AttemptsRail.tsx`**

Los comentarios de las líneas 25-26 y 45 mencionan el modo agentes como si siguiera vigente. Reescribirlos para hablar solo de upscale, que es el otro modo que comparte el mismo comportamiento de "hecho sin coordenadas":

Línea ~45, cambiar:

```ts
// Un análisis de agentes (o de upscale) puede terminar "hecho" sin
```

por:

```ts
// Un análisis de upscale puede terminar "hecho" sin
```

Aplicar el mismo criterio a las líneas 25-26 (quitar la mención a `AgentPickerPopup`/selección múltiple de agentes si el comentario ya no aplica a nada existente; si describe el mecanismo de `grupo_id` en términos genéricos, dejarlo pero sin nombrar `AgentPickerPopup`).

- [ ] **Step 5: Limpiar `ExportPopup.tsx`**

Quitar la línea 90 (`{opts.veredictos_agentes && <div .../>}`), la entrada `"veredictos_agentes"` del tipo unión de la línea 98, la entrada del array de opciones en la línea 104 (`{ key: "veredictos_agentes", ... }`), y `veredictos_agentes: true,` del objeto por defecto de la línea 130.

- [ ] **Step 6: Limpiar `CalibracionView.tsx`**

Quitar el párrafo de las líneas 87-89 sobre "modo elección" de agentes (si el resto del párrafo describe el modo de calibración en general, dejar solo la parte que no menciona agentes).

Quitar el bloque `<Interruptor activo={r.agentes_persistente} .../>` de las líneas 162-163 y el bloque de "Timeout de agentes" de las líneas 168-172, junto con el botón de guardar de la línea 181 que depende de `r.agentes_timeout_s`.

En la carga de settings (línea 122): quitar `setTimeout_(String(v.agentes_timeout_s))` — si `Timeout_` (el `useState`) ya no tiene más usos tras este cambio, quitar también su declaración.

En `guardarTimeout` (líneas 144-146): quitar la llamada `api.patch(... { agentes_timeout_s: n } ...)` y su función completa si no le queda ningún otro propósito.

- [ ] **Step 7: Limpiar `ModelosView.tsx`**

Líneas 36-37, quitar `+ n.resolucion.agentes_total` y `+ n.resolucion.agentes_instalados` de las sumas (dejando solo `recuperacion_total + geometricos_total` y su equivalente instalado).

Línea 56, quitar el fragmento `` {n.resolucion.agentes_total > 0 && ` · ${n.resolucion.agentes_total} motores de agente`} ``.

- [ ] **Step 8: Limpiar `client/src/lib/api.ts`**

Quitar de la interfaz de la línea ~22 el campo `agente: string | null;` (es el tipo de fila de `media.rs`, ver Task 6 — coordinar: si esta interfaz representa `SELECT a.id, a.model, a.agente, a.created_at`, el campo desaparece del lado Rust en el Task 6, así que aquí se quita a la vez).

Quitar `agentes_persistente`, `agentes_persistente_desc`, `agentes_timeout_s` (líneas 37-45, en sus dos interfaces — la de lectura y la de patch).

Quitar `agentes_instalados`, `agentes_total` de la línea 250-254 (y sus comentarios).

Quitar `motivo_agente: string | null;` de la línea 383 SOLO si en el Step 3 de este task se confirmó que `ResultsDrawer.tsx` ya no lo usa; si algún otro fichero cliente lo sigue leyendo, dejarlo (la columna de BD sigue existiendo).

Borrar la interfaz `DichoDeAgente` completa (líneas 385-388).

Quitar `agente: string | null;` de la interfaz de análisis (línea 411) y `agentes: DichoDeAgente[];` (línea 435).

Borrar la interfaz `AgenteVista` completa (líneas 438-443).

- [ ] **Step 9: Limpiar `bridge.ts`, `MediaDrawer.tsx`, `Dock.tsx`, `toasts.ts`**

En `bridge.ts:172`, quitar `veredictos_agentes: boolean;` del tipo de opciones de export.

En `MediaDrawer.tsx:31-32`, reescribir el comentario para no mencionar "agentes" como opción del popup de modelo (queda `mini/pro`).

En `Dock.tsx:37` y `toasts.ts:8,44,58`, reescribir los comentarios que mencionan "agentes" para que hablen solo de upscale/verificación, que son los casos reales que siguen aplicando.

- [ ] **Step 10: Compilar y verificar**

```bash
cd client && npx tsc -b --noEmit
grep -rn "AgentPickerPopup\|AgentResultPopup\|AgenteIcono\|DichoDeAgente\|AgenteVista" client/src/
```

Esperado: `tsc` limpio (o solo errores en ficheros que el Task 6/10 aún no ha tocado del lado Rust — no debería haber ninguno, porque el cliente es independiente del tipo Rust en build time); el segundo `grep` sin resultados.

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "refactor(client): borrar AgentPickerPopup/AgentResultPopup/AgenteIcono y sus referencias (fase 0, paso 2b/11)"
```

---

### Task 4: Python — borrar `lumi_agentes.py` y extirpar `Vlm` de `lumi_motores.py`

**Files:**
- Delete: `workers/lumi_agentes.py`
- Modify: `workers/lumi_motores.py:33-152` (clase `Vlm`), `:185` (entrada en `CLASES`), `:188-193` (rama en `cargar_motor`)

**Interfaces:**
- Consumes: nada
- Produces: `workers/lumi_motores.py` exporta `Upscalador`, `_directorio`, `CLASES = {"upscalador": Upscalador}`, `cargar_motor` — igual que antes menos la rama `"vlm"`. `workers/lumi_upscale.py:24,57` sigue funcionando sin cambios porque no toca `Vlm`.

- [ ] **Step 1: Borrar `lumi_agentes.py`**

```bash
git rm workers/lumi_agentes.py
```

- [ ] **Step 2: Ver el rango exacto de la clase `Vlm` antes de borrar**

```bash
sed -n '30,35p;150,195p' workers/lumi_motores.py
```

Confirmar que la clase `Vlm` empieza en `class Vlm(object):` y termina justo antes de la línea en blanco previa a `class Upscalador` (o el siguiente `class`/`def` de nivel superior). Si el rango real difiere de `33-152`, usar el rango confirmado en el Step 3.

- [ ] **Step 3: Borrar la clase `Vlm` completa**

Borrar desde `class Vlm(object):` hasta el final de su cuerpo (confirmado en el Step 2), incluyendo su docstring y todos sus métodos.

- [ ] **Step 4: Quitar `Vlm` de `CLASES`**

```python
CLASES = {"vlm": Vlm, "upscalador": Upscalador}
```

pasa a:

```python
CLASES = {"upscalador": Upscalador}
```

- [ ] **Step 5: Quitar la rama de `Vlm` en `cargar_motor`**

Leer el cuerpo completo de `cargar_motor` (`sed -n '188,200p' workers/lumi_motores.py`) y quitar cualquier `if clase == "vlm": ...` o rama equivalente que instancie `Vlm` con lógica propia (cuantización 4bit, etc.) que no aplique a `Upscalador`. Si `cargar_motor` ya construye genéricamente vía `CLASES[clase](...)` sin ramas por clase, no hay nada más que tocar aquí.

- [ ] **Step 6: Verificar que `lumi_upscale.py` sigue arrancando**

```bash
python3 -c "import ast; ast.parse(open('workers/lumi_motores.py').read())"
python3 -c "import ast; ast.parse(open('workers/lumi_upscale.py').read())"
grep -n "Vlm\b" workers/lumi_motores.py workers/lumi_upscale.py
```

Esperado: ambos parsean sin `SyntaxError`; el `grep` no encuentra `Vlm` en ningún sitio.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor(workers): borrar lumi_agentes.py y extirpar Vlm de lumi_motores.py (fase 0, paso 3/11)"
```

---

### Task 5: Daemon, hojas — borrar `routes/agentes.rs` y su registro

**Files:**
- Delete: `crates/lumid/src/routes/agentes.rs`
- Modify: `crates/lumid/src/routes/mod.rs:5` (`pub mod agentes;`)
- Modify: `crates/lumid/src/main.rs:402` (`.route("/v1/agentes", get(routes::agentes::listar))`)
- Modify: `crates/lumid/src/mantenimiento.rs:125-132` (la entrada `("/v1/agentes", "proyectos")` y su comentario)

**Interfaces:**
- Consumes: nada
- Produces: nada — este endpoint deja de existir; el Task 6 (`ModelosView`/`models.rs`) y el Task 3 (cliente) ya no lo llaman porque los componentes que lo consumían (`AgentPickerPopup`) se borraron en el Task 3.

- [ ] **Step 1: Borrar el fichero de rutas**

```bash
git rm crates/lumid/src/routes/agentes.rs
```

- [ ] **Step 2: Quitar el `pub mod` en `routes/mod.rs:5`**

```rust
pub mod agentes;
```

Borrar esa línea entera.

- [ ] **Step 3: Quitar el registro de ruta en `main.rs:402`**

```rust
.route("/v1/agentes", get(routes::agentes::listar))
```

Borrar esa línea entera. Comprobar que la línea anterior/siguiente no dependen de una coma colgante tras el borrado (el builder de rutas de `axum` encadena con `.route(...)` repetido, no con comas — no debería haber problema, pero verificar compilando en el Step 5).

- [ ] **Step 4: Quitar la entrada en `mantenimiento.rs:125-132`**

Leer el bloque completo:

```bash
sed -n '120,135p' crates/lumid/src/mantenimiento.rs
```

Borrar el comentario de las líneas 125-131 (explica por qué `/v1/agentes` necesitaba entrar en el mapa de mantenimiento) y la línea `("/v1/agentes", "proyectos"),` de la 132. Si esa línea forma parte de un array/vector literal, no dejar una coma sobrante ni un elemento vacío.

- [ ] **Step 5: Compilar**

```bash
cargo build -p lumid
```

Esperado: falla en otros ficheros que aún referencian `routes::agentes` o `agentar`/`queue` (se resuelven en los Tasks 6-7), pero **no** debe fallar por `mod.rs` o `main.rs` en sí mismos si el resto del crate compilase de forma aislada. Si `cargo build` no es viable todavía por dependencias cruzadas, usar `cargo check -p lumid 2>&1 | grep -A2 "agentes.rs\|mod.rs:5\|main.rs:402"` para confirmar que el error ya no viene de estos tres ficheros.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor(lumid): borrar routes/agentes.rs y su registro (fase 0, paso 4/11)"
```

---

### Task 6: Daemon, lecturas — `export.rs`, `analyses.rs`, `media.rs`, `cases.rs`, `projects.rs`, `images.rs`

**Files:**
- Modify: `crates/lumid/src/routes/analyses.rs` — funciones `agente_de_fila` (~150-160), `agentes` (~199-210), `agentes_por_caso` (~170-190), y todos los usos de `agente`/`agentes`/`motivo_agente` en `SELECT`, structs y el bloque de validación del modelo `"agentes"` (~280-294)
- Modify: `crates/lumid/src/routes/export.rs` — import de `agentes_por_caso` (línea 15), campo `agentes: Vec<DichoDeAgente>` en el struct de análisis local (~90), los contadores `agentes_total`/`agentes_respondieron`/`agentes_abstuvieron`/`n_con_agente` (~235-245, ~609-618), el campo `agente_lineas` y la función que lo llena (~322-333, ~520-545), y el bloque `con_agente`/`ag`/`geo` (~438-475)
- Modify: `crates/lumid/src/routes/media.rs:202-216` — `SELECT ... a.agente ...` y `agente: r.get(2)?`
- Modify: `crates/lumid/src/routes/cases.rs` — sin referencias directas a `agente` (confirmado por grep); no tocar salvo lo que el Task 9 (Parte 2/3 de Darkroom, fuera de este plan) añada más adelante
- Modify: `crates/lumid/src/routes/projects.rs:206` — comentario
- Modify: `crates/lumid/src/routes/images.rs:361,439,465,480` — comentario de la línea 361, el `INSERT` de la 439 (columna `agente`), y los valores por defecto `agente: None`/`agentes: vec![]` de las líneas 465/480

**Interfaces:**
- Consumes: nada de tasks anteriores directamente (Rust) — pero debe ejecutarse ANTES del Task 7 porque `export.rs` depende de `agentes_por_caso`, definida en `analyses.rs` (que este mismo task borra), tal como exige el orden del spec.
- Produces: `analyses.rs` sin `agentes_por_caso`, `agentes`, `agente_de_fila`; `export.rs` sin bloque "Agente" en el informe. El Task 9 (esquema) todavía no ha borrado `analysis_agents` ni las columnas — este task solo dejar de LEER esas columnas desde Rust, la tabla se borra después.

- [ ] **Step 1: Leer `analyses.rs` completo en la zona de agentes**

```bash
sed -n '1,50p;140,300p;380,470p' crates/lumid/src/routes/analyses.rs
```

- [ ] **Step 2: Borrar `agente_de_fila`, `agentes`, `agentes_por_caso`**

Borrar las tres funciones completas (líneas ~150-210 según el Step 1 confirme los rangos exactos): `fn agente_de_fila(...)`, `fn agentes(...)`, `pub(crate) fn agentes_por_caso(...)`.

- [ ] **Step 3: Quitar `agente`/`agentes`/`motivo_agente` de los `SELECT` y structs de lectura**

En las funciones que construyen `Analysis`/`Hipotesis` desde SQL (líneas ~18, ~34, ~46, ~59, ~74, ~112, ~131 según el Step 1): quitar `agente` de la lista de columnas del `SELECT`, quitar `agente: r.get(15)?,` (o el índice que corresponda tras quitar la columna del `SELECT` — **reindexar los `r.get(N)?` siguientes**, ya que quitar una columna del medio desplaza los índices de las que van después), quitar `agentes: vec![],` de los valores por defecto, y quitar `motivo_agente` del `SELECT`/struct de hipótesis (dejando la columna de BD intacta, solo se deja de seleccionarla).

- [ ] **Step 4: Quitar la validación del modelo `"agentes"` al crear un análisis**

Leer el bloque completo:

```bash
sed -n '278,300p' crates/lumid/src/routes/analyses.rs
```

Borrar el `if req.model == "agentes" { ... } else if req.agente.is_some() { ... }` completo (las comprobaciones de que se eligió un agente válido). El campo `agente` en `AnalysisReq`/`INSERT`/`Analysis` (líneas ~385, ~389, ~411, ~426) se borra en el Task 10 (`lumi-proto`), no aquí — aquí solo se borra la RAMA que trata `model == "agentes"` como caso especial; si el campo `req.agente` deja de existir en este mismo task porque ya se tocó `lumi-proto` primero, ajustar el orden localmente, pero **el Task 10 de este plan asume que este Task 6 va antes**, así que dejar el campo `agente` en las structs de este fichero para el Task 10.

- [ ] **Step 5: Limpiar `export.rs`**

Quitar `agentes_por_caso` del import de la línea 15 (queda `use crate::routes::analyses::{hypotheses_por_caso, image_ids_por_caso, row_to_analysis};`).

Quitar el bloque que llama a `agentes_por_caso` y rellena `a.agentes` (líneas ~86-90).

Quitar el campo `agentes: Vec<DichoDeAgente>` de cualquier struct local de análisis en este fichero.

Borrar los contadores `agentes_total`, `agentes_respondieron`, `agentes_abstuvieron` (~235-237) y `n_con_agente` (~245) de sus structs, y sus asignaciones (~609-618, ~893, ~918-919).

Borrar el campo `agente_lineas: Vec<Linea>` (~322-323, ~446, ~950) y la función que lo llena — leer el bloque:

```bash
sed -n '438-475p;520-570p' crates/lumid/src/routes/export.rs
```

y quitar: la variable `geo`/`ag` que separan el análisis de geolocalización del de agentes (~450-451), `con_agente` y `abstencion_total` (~454-462), el bloque `if req.veredictos_agentes && !sin_resuelto { ... }` completo (~521-545, incluye el fix de `nombre_mostrado` del commit `127aba5` — este bloque entero desaparece, así que ese fix también se va, correctamente, con él), y toda referencia a `con_agente`/`n_con_agente` en el resumen final (~893-940).

Quitar `veredictos_agentes` del `ExportReq` de este fichero SOLO si `lumi-proto::api::ExportReq` todavía no se ha tocado (eso es Task 10) — aquí basta con dejar de leer ese campo si ya no hace nada, o mantenerlo leído-pero-ignorado hasta el Task 10 para no romper la firma del struct antes de tiempo. Preferir: dejarlo intacto en este task, borrarlo en el Task 10 junto con el resto de `lumi-proto`.

- [ ] **Step 6: Limpiar `media.rs`**

Líneas 202-216: quitar `a.agente` del `SELECT` y `agente: r.get(2)?,` del mapeo, reindexando cualquier `r.get(N)?` posterior si `agente` no era la última columna.

- [ ] **Step 7: Limpiar `projects.rs` e `images.rs`**

`projects.rs:206`: reescribir el comentario para no mencionar "agentes" (deja solo "hipótesis de cada análisis suyo").

`images.rs:361`: reescribir el comentario (menciona `model: "agentes"` como ejemplo — cambiar el ejemplo a `model: "upscale"` u otro modelo real).

`images.rs:439`: quitar `agente` de la lista de columnas del `INSERT` (`INSERT INTO analyses (case_id, requested_by, model, agente, state, ...)` pasa a `INSERT INTO analyses (case_id, requested_by, model, state, ...)`, ajustando también los placeholders `?N` que sigan en la sentencia).

`images.rs:465,480`: quitar `agente: None,` y `agentes: vec![],` de los valores por defecto del `Analysis` construido ahí.

- [ ] **Step 8: Compilar y comprobar**

```bash
cargo check -p lumid 2>&1 | head -80
grep -n "agentes_por_caso\|fn agentes(\|fn agente_de_fila" crates/lumid/src/routes/analyses.rs
```

Esperado: los errores restantes de `cargo check` deben venir de `queue/mod.rs` (Task 7) y de `lumi-proto` (Task 10), no de `analyses.rs`/`export.rs`/`media.rs`/`projects.rs`/`images.rs`. El `grep` no debe encontrar nada.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "refactor(lumid): quitar lecturas de agentes en analyses/export/media/projects/images (fase 0, paso 5/11)"
```

---

### Task 7: Daemon, periferia — `rendimiento.rs`, `models.rs`, `informe.tex.tera`, `logging.rs`

**Files:**
- Modify: `crates/lumid/src/routes/rendimiento.rs:15,17,46,51-52,59,80-84,92-104` (las 3 claves de agentes: `CLAVE_AGENTES`, `CLAVE_AGENTES_TIMEOUT_S`, y sus lecturas/escrituras)
- Modify: `crates/lumid/src/routes/models.rs:212-222` (`agentes`, `motores_de_agentes`)
- Modify: `crates/lumid/src/templates/informe.tex.tera:376-378,441-444` (bloque "Agente" y contador "con agente")
- Modify: `crates/lumid/src/logging.rs` — confirmado por grep: **sin referencias**, no tocar (el spec lo lista pero el grep de este plan no encontró nada; verificar de nuevo en el Step 4 antes de darlo por hecho)

**Interfaces:**
- Consumes: nada de este plan directamente
- Produces: `RendimientoSettings`/`PatchRendimientoReq` en `lumi-proto` (Task 10) pierden los campos `agentes_persistente*`/`agentes_timeout_s` — este task deja de LEERLOS/ESCRIBIRLOS desde `rendimiento.rs`, el Task 10 los borra del tipo. Igual que en el Task 6, el orden es: primero dejar de usar el campo en el sitio que lo consume, después borrarlo de `lumi-proto`.

- [ ] **Step 1: Limpiar `rendimiento.rs`**

Leer el fichero completo:

```bash
cat -n crates/lumid/src/routes/rendimiento.rs
```

Borrar las constantes `CLAVE_AGENTES` (línea 15) y `CLAVE_AGENTES_TIMEOUT_S` (línea 17).

Borrar la lectura `let agentes_persistente = leer_bool(app, CLAVE_AGENTES);` (línea 46) y las dos asignaciones que la usan en la construcción de la respuesta (`agentes_persistente_desc: desc(agentes_persistente)`, `agentes_persistente,` — líneas 51-52).

Borrar `agentes_timeout_s: crate::agentar::limite_configurado(&app.store).as_secs(),` (línea 59) — esta llamada a `crate::agentar` desaparece con el módulo entero en el Task 8, así que si este task se ejecuta antes de borrar `agentar.rs`, dejar temporalmente un valor fijo NO es aceptable (no hay "temporal" en este plan) — **por eso este Step va DESPUÉS del Task 8 en la ejecución real si se sigue el orden estricto del spec; sin embargo, en este plan Task 7 está numerado antes que Task 8 (docs del spec) mientras que el orden mecánico correcto es el inverso para esta línea concreta.** Resolución: mover el borrado de la línea 59 al Task 8, Step 4 (ver allí). En este Step 1, borrar únicamente `CLAVE_AGENTES`, `CLAVE_AGENTES_TIMEOUT_S`, `agentes_persistente`, `agentes_persistente_desc` y el bloque `if let Some(v) = req.agentes_persistente { ... }` (líneas 80-84).

Borrar el bloque `if let Some(v) = req.agentes_timeout_s { ... }` (líneas 92-104) — este no depende de `crate::agentar`, solo escribe en el store, así que se borra aquí sin problema.

- [ ] **Step 2: Limpiar `models.rs`**

Leer el bloque:

```bash
sed -n '205,225p' crates/lumid/src/routes/models.rs
```

Borrar `let agentes = app.queue.agentes.lock().unwrap().clone();` (línea 212) y la línea que llama a `lumi_index::agentes::motores_de_agentes(&n.agentes, &agentes, &motores)` (línea 219), junto con cualquier variable (`motores_necesarios`) que solo exista para ese cálculo — si `motores_necesarios` también se usa para geométricos/recuperación, dejar esa parte y solo quitar el término de agentes de la unión de motores necesarios.

Nota: `self.queue.agentes` (el `Vec<Agente>` cargado en memoria por la cola) se borra en el Task 8 junto con `agentar.rs` — este Step 2 debe ejecutarse en el mismo commit que el Task 8 o dejará una referencia rota. Ver la nota de coordinación en el Task 8, Step 1.

- [ ] **Step 3: Limpiar `informe.tex.tera`**

Leer las dos zonas:

```bash
sed -n '370,385p;438,448p' crates/lumid/src/templates/informe.tex.tera
```

Borrar el bloque que pinta "Agente" (líneas ~376-378) y el contador "con agente" (líneas ~441-444), incluyendo cualquier `{% if %}`/`{% endif %}` de Tera que los envuelva completo (no dejar un `{% endif %}` huérfano).

- [ ] **Step 4: Confirmar que `logging.rs` no tiene nada que tocar**

```bash
grep -n "agente" crates/lumid/src/logging.rs
```

Esperado: sin resultados (ya confirmado antes de escribir este plan). Si aparece algo, tratarlo igual que los demás: quitar la referencia sin tocar lógica ajena.

- [ ] **Step 5: Compilar**

```bash
cargo check -p lumid 2>&1 | grep -i "rendimiento\|models.rs\|informe"
```

Esperado: sin errores nuevos originados en estos tres ficheros (seguirá habiendo errores por `queue/mod.rs` y `agentar.rs`, que son el Task 8).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor(lumid): quitar agentes de rendimiento/models/informe.tex (fase 0, paso 6/11)"
```

---

### Task 8: Daemon, núcleo — desarmar `queue/mod.rs`, borrar `agentar.rs`, limpiar `worker.rs`/`recuperar.rs`, cerrar `rendimiento.rs`/`models.rs`

**Files:**
- Delete: `crates/lumid/src/agentar.rs`
- Modify: `crates/lumid/src/queue/mod.rs:161,186,271,749,757-783,769,772,778,880,1020,1033-1054,1132,1244,1525,1552` — desarmar `tokio::join!` dejando solo el `await` del verificador, borrar `correr_agente_unico`, `agentes_de`, `guardar_agentes`, `agente_del_analisis`, el campo `agentes: Mutex<Vec<...>>` y el import de `mod agentar`
- Modify: `crates/lumid/src/queue/worker.rs:69-76,80,140` — comentarios
- Modify: `crates/lumid/src/recuperar.rs:157,202` — `motivo_agente: None,` (se deja el campo, ya cubierto por Global Constraints — no tocar estas líneas salvo que el struct que las contiene haya perdido el campo en el Task 6; verificar antes de tocar)
- Modify: `crates/lumid/src/routes/rendimiento.rs:59` (la línea aplazada del Task 7, Step 1)
- Modify: `crates/lumid/src/routes/models.rs` — verificar que el Task 7 Step 2 quedó consistente ahora que `self.queue.agentes` desaparece

**Interfaces:**
- Consumes: `queue/mod.rs` debe compilar sin `agentar` — este task es el más delicado del plan porque toca el despachador central de la cola.
- Produces: `queue/mod.rs` sin ningún campo/método de agentes; el `tokio::join!` de la línea 757 pasa a ser un `await` simple del verificador. **El comentario de las líneas 746-748 que justifica el `tokio::join!` (evitar que un agente equivocado mate un candidato antes de que RANSAC lo confirme) deja de aplicar y se borra junto con el código que justificaba — no es una regresión, es la razón de ser de la Fase 0.**

- [ ] **Step 1: Leer el bloque completo del despachador antes de tocar nada**

```bash
sed -n '155,200p;740,800p;870,890p;1015,1060p;1125,1145p;1240,1260p;1515,1560p' crates/lumid/src/queue/mod.rs
```

Confirmar la forma exacta de cada pieza antes de editar — los números de línea de este plan vienen de un grep hecho el mismo día pero pueden haberse desplazado por tasks anteriores de este mismo plan (ninguno de los tasks 1-7 toca `queue/mod.rs`, así que deberían coincidir).

- [ ] **Step 2: Desarmar el `tokio::join!`**

El bloque original (línea ~749-783) tiene esta forma (confirmar con el Step 1):

```rust
let agentes_del_nivel = self.agentes_de(&nivel);
// ... (comentario de las líneas 746-748 sobre por qué agentes y verificación corren juntos)
let (afinados, dictamen) = tokio::join!(
    self.verif_persistente.pedir(..., &self.verif_persistente, ...),
    /* la rama de agentes, usando agentes_del_nivel y self.agentes_persistente */
);
```

Sustituir por:

```rust
let afinados = self.verif_persistente.pedir(/* los mismos argumentos que tenía dentro del join!, sin cambios */).await;
```

Es decir: quitar la llamada a `self.agentes_de(&nivel)`, quitar el comentario de las líneas 746-748, quitar el `tokio::join!` y dejar solo el `.await` de lo que antes era la primera rama del join (`self.verif_persistente...`), asignado directamente a `afinados` (ya no hay tupla `(afinados, dictamen)`).

Buscar todos los usos de `dictamen` después de este punto (`self.guardar_agentes(id, &dictamen);` en la línea ~880) y borrarlos — `guardar_agentes` se borra en el Step 3.

- [ ] **Step 3: Borrar los métodos de agentes del `impl`**

Borrar completos: `fn agente_del_analisis` (~1020), `async fn correr_agente_unico` (~1033-1054, incluye su llamada interna a `self.guardar_agentes`), `fn agentes_de` (~1132), `fn guardar_agentes` (~1244).

- [ ] **Step 4: Borrar el campo de agentes y su inicialización**

Buscar la declaración del campo `agentes: Mutex<Vec<...>>` (o el tipo que use — confirmar con `grep -n "agentes:" crates/lumid/src/queue/mod.rs` tras los steps anteriores) y su inicialización en el constructor de la cola (probablemente cerca de donde se carga `agentes_persistente`, línea ~186/271). Borrar ambos.

Borrar `agentes_persistente: crate::persistente::Persistente,` (línea 186) y su inicialización `agentes_persistente: crate::persistente::Persistente::nuevo("agentes"),` (línea 271) — **esta es la única parte que se toca de `persistente.rs`/su uso, tal como marca la Trampa 2 del spec**; el módulo `persistente.rs` en sí NO se borra ni se edita.

- [ ] **Step 5: Borrar la rama de despacho que lanza análisis de agentes**

Líneas ~1525, ~1552 (confirmar con el Step 1): borrar el `let Some(agente_id) = self.agente_del_analisis(...) else { ... }` y la llamada `cola.correr_agente_unico(...).await;`, junto con la rama del `match`/`if` que los contenía (el despachador decide entre modo normal, `agentes` y `upscale` según `analyses.model` — aquí solo se quita la rama `agentes`, la de `upscale` se queda intacta).

- [ ] **Step 6: Borrar `agentar.rs` y su declaración de módulo**

```bash
grep -n "mod agentar" crates/lumid/src/lib.rs crates/lumid/src/main.rs
```

Borrar esa línea (dondequiera que esté) y:

```bash
git rm crates/lumid/src/agentar.rs
```

- [ ] **Step 7: Cerrar la línea aplazada de `rendimiento.rs`**

Ahora que `agentar.rs` no existe, borrar la línea 59 de `rendimiento.rs` (aplazada desde el Task 7, Step 1):

```rust
agentes_timeout_s: crate::agentar::limite_configurado(&app.store).as_secs(),
```

- [ ] **Step 8: Limpiar `queue/worker.rs` y `recuperar.rs`**

En `worker.rs`, reescribir los comentarios de las líneas 69-76 (mencionan "trabajador de agentes" como si siguiera existiendo), 80 y 140 para hablar solo de verificación/upscale, que son los casos reales que quedan.

En `recuperar.rs:157,202`: **no tocar** `motivo_agente: None,` — la columna se queda (Global Constraints), así que este valor por defecto sigue siendo válido y necesario mientras el struct `Hipotesis` conserve el campo (lo conserva, ver Task 6).

- [ ] **Step 9: Compilar el crate completo**

```bash
cargo build -p lumid 2>&1 | tee /tmp/build.log
```

Si quedan errores, deben venir exclusivamente de `store.rs` (Task 9) o `lumi-proto` (Task 10) — cualquier error dentro de `crates/lumid/src/queue/`, `rendimiento.rs` o `models.rs` debe resolverse en este mismo task antes de continuar.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "refactor(lumid): desarmar el despacho de agentes en queue/mod.rs y borrar agentar.rs (fase 0, paso 7/11)"
```

---

### Task 9: Esquema — `store.rs`

**Files:**
- Modify: `crates/lumid/src/store.rs:238-242` (comentario + `CREATE TABLE analysis_agents`), `:435-438` (llamada a la migración de septiembre), `:516-519` (comentarios), `:551` (`ALTER TABLE analysis_agents ...` en la lista de columnas idempotentes — se borra la entrada, no la tabla en sí desde ahí), `:557,575,581-611` (función `migracion_agentes_2026_09_17` completa)

**Interfaces:**
- Consumes: nada
- Produces: `store.rs::migrate()` sin `CREATE TABLE analysis_agents` ni la migración de septiembre; una migración nueva `DROP TABLE IF EXISTS analysis_agents` + `DELETE FROM analyses WHERE model = 'agentes'`, siguiendo el patrón exacto de `migracion_agentes_2026_09_17` (líneas 581-611) que este mismo task borra — leer su cuerpo ANTES de borrarlo para copiar la forma.

- [ ] **Step 1: Leer la migración de septiembre completa antes de borrarla (es la plantilla de la nueva)**

```bash
sed -n '575,612p' crates/lumid/src/store.rs
```

Copiar mentalmente (o a un fichero temporal de scratch) su forma: comprobación en `meta` con una clave única, `DROP TABLE IF EXISTS ...; CREATE TABLE ...` (si aplica), `DELETE FROM analyses WHERE model = '...'`, `INSERT OR REPLACE INTO meta`, `tracing::info!`.

- [ ] **Step 2: Borrar el `CREATE TABLE analysis_agents`**

Líneas 238-242: borrar el comentario ("Lo que dijeron los agentes...") y el `CREATE TABLE IF NOT EXISTS analysis_agents (...)` completo (buscar su `)` de cierre, puede extenderse más allá de la línea 242 — confirmar con `sed -n '238,260p' crates/lumid/src/store.rs`).

- [ ] **Step 3: Borrar la llamada a la migración de septiembre**

Línea 438: `migracion_agentes_2026_09_17(c);` — borrar esa línea. El comentario de la línea 435 que la explica también se borra.

- [ ] **Step 4: Borrar la entrada de columna idempotente**

Línea 551: `("analysis_agents", "etiqueta_real", "TEXT NOT NULL DEFAULT ''"),` — borrar esa entrada de la lista (y el comentario de la línea 516-519 que la introduce, si ya no describe nada vigente).

- [ ] **Step 5: Borrar `migracion_agentes_2026_09_17` completa**

Líneas 581-611 (confirmadas en el Step 1): borrar la función entera.

- [ ] **Step 6: Escribir la migración de Darkroom, con la misma forma**

Añadir una función nueva, siguiendo el patrón leído en el Step 1:

```rust
/// Los agentes (5c) se retiraron por completo en Darkroom (fase 0,
/// 2026-09-19): `analysis_agents` no tiene lectores fuera de agentes, y los
/// análisis con `model = 'agentes'` quedarían huérfanos e invisibles si se
/// dejasen (el cliente ya no ofrece ese modo).
fn migracion_darkroom_borrar_agentes_2026_09_19(c: &Connection) {
    let ya: i64 = c
        .query_row("SELECT v FROM meta WHERE k = 'migracion_darkroom_borrar_agentes_2026_09_19'", [], |r| {
            r.get::<_, String>(0).map(|s| s.parse().unwrap_or(0))
        })
        .unwrap_or(0);
    if ya == 1 {
        return;
    }
    c.execute_batch(
        "DROP TABLE IF EXISTS analysis_agents;",
    )
    .expect("borrar analysis_agents");
    let _ = c.execute("DELETE FROM analyses WHERE model = 'agentes'", []);
    let _ = c.execute(
        "INSERT OR REPLACE INTO meta (k, v) VALUES ('migracion_darkroom_borrar_agentes_2026_09_19', '1')",
        [],
    );
    tracing::info!("migración darkroom 2026-09-19: analysis_agents borrada, análisis de agentes vaciados");
}
```

(Ajustar el nombre exacto de la conexión/tipo `Connection` y la firma de `execute`/`execute_batch` para que coincidan EXACTAMENTE con las que usaba `migracion_agentes_2026_09_17` — el Step 1 es la fuente de verdad, este bloque es una plantilla a encajar, no un literal a pegar sin comparar.)

- [ ] **Step 7: Llamar a la migración nueva desde `migrate()`**

En el mismo sitio donde vivía la llamada borrada en el Step 3, añadir:

```rust
migracion_darkroom_borrar_agentes_2026_09_19(c);
```

- [ ] **Step 8: Compilar y probar la migración contra una copia de una BD real si existe una a mano**

```bash
cargo build -p lumid
```

Si hay un fichero `*.db` de desarrollo disponible (preguntar al usuario si no está claro cuál usar — no ejecutar la migración contra la BD de producción sin confirmar), copiarlo y arrancar `lumid` sobre la copia para confirmar que la migración corre sin panics y que una segunda ejecución es no-op (lee `ya == 1` y sale).

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "refactor(lumid): DROP TABLE analysis_agents y migración de limpieza (fase 0, paso 8/11)"
```

---

### Task 10: Crates compartidos — `lumi-proto` y `lumi-index`

**Files:**
- Modify: `crates/lumi-proto/src/api.rs:505-539,905,925-996,1015-1022,1378,1426` — `RendimientoSettings`/`PatchRendimientoReq` (campos de agentes), `agente`/`agentes` en `Analysis`/`AnalysisReq`, `DichoDeAgente` (struct completo), `veredictos_agentes` en `ExportReq`
- Modify: `crates/lumi-proto/src/worker.rs:302,325,344` — variante `Msg::Agente { ... }` del enum de mensajes IPC
- Delete: `crates/lumi-index/src/agentes.rs`
- Modify: `crates/lumi-index/src/lib.rs:10` (`pub mod agentes;`)
- Modify: `crates/lumi-index/src/niveles.rs:19-25,60-66,77-91,108,116,124,178,195,200-210` — campo `Nivel.agentes`, `agentes_instalados`/`agentes_total`, su uso en `resolver_composicion`, y el test que los ejercita
- Modify: `crates/lumi-index/Cargo.toml` — comprobar si `lumi-proto` sigue siendo dependencia necesaria (el comentario de `lib.rs:11-13` dice que solo estaba ahí por `Veredicto`)
- Modify: `indexer/src-tauri/src/niveles.rs:62,66` — quitar `agentes: vec![]` de los literales de nivel

**Interfaces:**
- Consumes: `registros/niveles/{mini,pro,vision}.json` sin la clave `"agentes"` (Task 1, si el Step 1 de ese task confirmó `#[serde(default)]`; si no, aplicar ese cambio de JSON AQUÍ, en el mismo commit que el borrado del campo `agentes` de `Nivel`)
- Produces: `Nivel` sin campo `agentes` ni `agentes_instalados`/`agentes_total`; `lumi-proto::api` sin `DichoDeAgente`, sin `agentes_persistente*`, sin `agentes_timeout_s`, sin `veredictos_agentes`, sin `agente`/`agentes` en `Analysis`/`AnalysisReq`; `lumi-proto::worker::Msg` sin la variante `Agente`.

- [ ] **Step 1: Confirmar el estado de `#[serde(default)]` en `Nivel.agentes` (si no se hizo en el Task 1)**

```bash
sed -n '15,26p' crates/lumi-index/src/niveles.rs
```

- [ ] **Step 2: Borrar el campo `agentes` de `Nivel` y sus derivados**

Borrar `pub agentes: Vec<String>,` (línea 25) y su doc-comment (líneas 19-23).

Borrar `pub agentes_instalados: usize,` y `pub agentes_total: usize,` (líneas 65-66) y su doc-comment (línea 60-62).

- [ ] **Step 3: Limpiar `resolver_composicion` y sus literales**

Leer la función completa:

```bash
sed -n '75,130p' crates/lumi-index/src/niveles.rs
```

Borrar la línea que calcula `agentes_instalados`/`agentes_total` a partir de `motores_de_agentes` (~90-91) — esta llamada ya no tiene función (`agentes::motores_de_agentes` se borra en el Step 5).

Quitar `agentes: Vec::new(),` de cada literal de `Nivel` construido en esta función (líneas ~108, 116, 124).

- [ ] **Step 4: Limpiar los literales de nivel fijos y el test**

Líneas 178, 195: quitar `agentes: vec![], ` / `agentes: vec!["idioma".into()], ` de los literales de `Nivel` de fábrica.

Líneas 200-210 (el test): quitar el comentario sobre el bug de instalación de agentes si ya no aplica, y quitar `assert_eq!(r.agentes_total, 1); assert_eq!(r.agentes_instalados, 0);` / `assert_eq!(r2.agentes_instalados, 1);` — si el test se queda sin aserciones útiles tras esto, revisar qué more comprobaba (probablemente algo sobre motores geométricos/recuperación) y dejar solo esas aserciones.

- [ ] **Step 5: Borrar `crates/lumi-index/src/agentes.rs` y su `mod`**

```bash
git rm crates/lumi-index/src/agentes.rs
```

Borrar `pub mod agentes;` de `crates/lumi-index/src/lib.rs:10`.

- [ ] **Step 6: Revisar si `lumi-proto` sigue siendo dependencia de `lumi-index`**

```bash
grep -n "lumi_proto\|lumi-proto" crates/lumi-index/src/*.rs
sed -n '1,15p' crates/lumi-index/Cargo.toml
```

Si tras borrar `agentes.rs` ningún fichero de `lumi-index/src/` importa nada de `lumi_proto`, quitar la línea `lumi-proto = { path = "../lumi-proto" }` de `Cargo.toml` y el comentario que la explicaba. Si algo más la usa (verificar con el grep), dejarla y anotar en el commit por qué se queda.

- [ ] **Step 7: Limpiar `lumi-proto/src/api.rs`**

Borrar `pub agentes_persistente: bool,` y `pub agentes_persistente_desc: String,` (516-517) de `RendimientoSettings`; borrar `pub agentes_timeout_s: u64,` (530) y su doc-comment (524-529).

Borrar `pub agentes_persistente: Option<bool>,` (537) y `pub agentes_timeout_s: Option<u64>,` (539) de `PatchRendimientoReq`.

Borrar `pub agente: Option<String>,` de `AnalysisReq` (905) y de `Analysis` (1020), con sus doc-comments (925-931, 1015-1018).

Borrar `pub agentes: Vec<DichoDeAgente>,` de `Analysis` (972) con su doc-comment (969).

Borrar el struct `DichoDeAgente` completo (978-1005, incluye sus doc-comments que referencian `worker::Msg::Agente` y `lumi_index::agentes::Veredicto`).

Borrar `pub veredictos_agentes: bool,` de `ExportReq` (1378) y `veredictos_agentes: true,` de su `Default` (1426).

- [ ] **Step 8: Limpiar `lumi-proto/src/worker.rs`**

Leer las tres apariciones de `Msg::Agente`:

```bash
sed -n '295,350p' crates/lumi-proto/src/worker.rs
```

Borrar la variante `Agente { ... }` del enum `Msg` y sus tres brazos de `match`/`impl` asociados (líneas 302, 325, 344 son probablemente el mismo bloque repetido en `Serialize`/`Deserialize`/un método propio — confirmar con la lectura y borrar los tres).

- [ ] **Step 9: Limpiar `indexer/src-tauri/src/niveles.rs`**

Líneas 62, 66: quitar `agentes: vec![], ` de los dos literales de `Nivel`.

- [ ] **Step 10: Compilar el workspace completo**

```bash
cargo build
cargo test -p lumi-proto
```

Esperado: build limpio; tests en verde. Si `lumi-index` fallaba por el `#[serde(default)]` pendiente (Step 1), aplicar aquí el cambio de JSON aplazado del Task 1.

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "refactor: borrar agentes de lumi-proto y lumi-index (fase 0, paso 9-10/11)"
```

---

### Task 11: Web y docs — cierre del borrado

**Files:**
- Delete: `web/components/AgentesVisual.tsx`, `web/components/docs/esquemas/EsquemaAgente.tsx`, `web/app/docs/como-funciona/agentes/` (carpeta completa)
- Modify: cualquier fichero que registre las rutas de docs (`arbolDocs.ts`, `indiceDocs.json` o equivalente — localizar con el Step 1) para quitar la entrada de `como-funciona/agentes`
- Modify: `web/components/Escalera.tsx` y el componente de navegación (`Nav` — localizar el fichero real con el Step 1) si enlazan a la página borrada
- Modify: `web/app/docs/como-funciona/el-viaje-de-una-foto/page.mdx`, `mini-pro-y-vision/page.mdx`, `veredicto/page.mdx`, `web/app/docs/tecnologias/motores/page.mdx` — quitar menciones a agentes o el enlace a la página borrada
- Modify: cualquier página `meetmini`/`meetpro` que mencione agentes (localizar con el Step 1)
- Modify: `ARCHITECTURE.md`, `CLAUDE.md`, `FUTURO.md`, `PRODUCT.md` — quitar o corregir las menciones a agentes/5c como subsistema vigente

**Interfaces:**
- Consumes: nada de código — es la última capa, puramente de presentación/documentación
- Produces: nada que otro task consuma — es terminal

- [ ] **Step 1: Localizar todos los ficheros a tocar**

```bash
grep -rln "agente\|Agente" web/app web/components 2>/dev/null | grep -v "\.next/"
grep -rln "agente\|Agente\|5c" ARCHITECTURE.md CLAUDE.md FUTURO.md PRODUCT.md
find web -iname "arbolDocs*" -o -iname "indiceDocs*"
grep -rln "meetmini\|meetpro" web/app web/components 2>/dev/null
```

- [ ] **Step 2: Borrar los componentes y la página de docs de agentes**

```bash
git rm web/components/AgentesVisual.tsx
git rm web/components/docs/esquemas/EsquemaAgente.tsx
git rm -r web/app/docs/como-funciona/agentes
```

- [ ] **Step 3: Quitar la entrada del índice de docs**

Abrir el fichero encontrado en el Step 1 (`arbolDocs.ts`/`indiceDocs.json` o equivalente) y borrar la entrada que apunta a `como-funciona/agentes`, con cuidado de no dejar una coma sobrante en el array/objeto.

- [ ] **Step 4: Quitar enlaces rotos en navegación**

Para cada fichero que el Step 1 encontró en `Escalera.tsx`/`Nav`/similares con un enlace a la página borrada: quitar la entrada de navegación correspondiente.

- [ ] **Step 5: Limpiar las páginas MDX que mencionan agentes de pasada**

Para `el-viaje-de-una-foto`, `mini-pro-y-vision`, `veredicto`, `tecnologias/motores`: leer cada mención con `grep -n "agente" <fichero>` y decidir caso por caso — si la mención es un enlace a la página borrada, quitar el enlace (dejando el texto sin hipervínculo o reescribiendo la frase); si es una explicación de qué hacían los agentes en el pipeline, quitar esa explicación o reescribirla para reflejar que ese paso ya no existe.

- [ ] **Step 6: Limpiar `meetmini`/`meetpro` si el Step 1 encontró algo**

Aplicar el mismo criterio del Step 5.

- [ ] **Step 7: Actualizar `ARCHITECTURE.md`, `CLAUDE.md`, `FUTURO.md`, `PRODUCT.md`**

Para cada mención encontrada en el Step 1: si describe 5c como un subsistema vigente, actualizar la frase para reflejar que se borró en favor de Darkroom, con una referencia a `docs/superpowers/specs/2026-09-19-darkroom-design.md`. En `CLAUDE.md` en particular, la tabla de "Subsystem status" menciona `5 es 5-0, 5a, 5b y 5c done` — actualizar esa línea para reflejar que 5c ya no existe (sustituida por Darkroom) en vez de marcarla "done".

- [ ] **Step 8: Verificación final de cierre de toda la Fase 0**

```bash
cargo build
npx tsc -b --noEmit --project client/tsconfig.json
cd client && npm run lint && cd ..
cargo test -p lumi-proto
grep -ril "agente" crates/ client/src/ workers/ registros/ 2>/dev/null | grep -v "node_modules"
```

Esperado: todo limpio; el último `grep` no debe devolver ningún fichero (los specs derogados del Task 1 llevan la palabra "agentes" en su propio nombre de fichero y en la nota de derogación — eso es intencional y no cuenta como fallo del criterio de cierre, que en el spec habla de código, no de los propios specs históricos).

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "docs: cerrar el borrado de agentes en web y documentación (fase 0, paso 11/11)"
```
