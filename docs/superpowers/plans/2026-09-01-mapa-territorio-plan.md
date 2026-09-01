# Mapa de territorio: buscador, deshacer, combinar y editar — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this
> plan task-by-task, in order. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mejorar el dibujo de territorio del Indexer (`indexer/src/territory/`): un buscador que
no trunca el contexto que desambigua y recuerda los últimos lugares, deshacer un vértice suelto y
cerrar un polígono acercándose al primero, una herramienta para editar un trazo ya cerrado
(arrastrar/insertar/borrar vértices), la posibilidad de sumar o restar una forma nueva contra el
área ya clasificada en vez de sustituirla siempre, y deshacer/rehacer general sobre todo eso.

**Architecture:** El backend pasa de clasificar UN anillo a clasificar una LISTA de anillos (una
pieza por trozo de área) — todo el cálculo de agregados (`locales`/`catalogo`/`nuevas`/
`reclamadas`/`bytes_a_descargar`/`autores`/`por_origen`) se queda en Rust, deduplicando las
teselas pedidas por los distintos anillos antes de clasificar; el frontend nunca reimplementa esa
suma. `@turf/union`/`@turf/difference` combinan geometría en el cliente (unión/resta de polígonos)
y el resultado se manda tal cual al mismo comando de clasificar — sin His nuevo comando, sin lógica
de reparto duplicada en TypeScript. El historial de deshacer/rehacer es una pila de instantáneas
`{dibujo, clasificacion}` en `TerritoryView`, no un sistema de comandos reversibles.

**Tech Stack:** Rust (`indexer/src-tauri`, `lumi-index`), React 19 + TypeScript (`indexer/src`),
Mapbox GL JS, `@turf/union`/`@turf/difference`/`@turf/helpers`/`@turf/nearest-point-on-line`
(nuevas dependencias, paquetes individuales de Turf v7 — no el bundle `@turf/turf` completo, para
no traer más de lo que hace falta).

## Global Constraints

- **No añadir tests** salvo que se pida explícitamente — excepción única del repo:
  `cargo test -p lumi-proto`. No tocar `#[cfg(test)]` de los archivos que se editan salvo que un
  cambio de firma los rompa (en ese caso, arreglarlos para que compilen, sin añadir cobertura
  nueva).
- **Español** en comentarios, copy de UI y mensajes de commit.
- **Sin icon library**: los iconos nuevos son SVG a mano, mismo patrón que `indexer/src/ui/Icon.tsx`
  ya usa (`viewBox="0 0 24 24"`, `strokeWidth={1.8}` salvo casos ya marcados aparte).
- **Un solo commit al final**, tras compilar/verificar todo. No hacer commits intermedios por tarea.
- Antes de editar cualquier archivo, **releerlo** con la herramienta de lectura — varias tareas de
  este plan tocan los mismos archivos (`MapCanvas.tsx`, `TerritoryView.tsx`) en pasadas sucesivas,
  y los números de línea de este documento pueden haberse desplazado por la tarea anterior.

---

## Task 1: Clasificar varios anillos a la vez (Rust)

**Files:**
- Modify: `indexer/src-tauri/src/territory.rs`
- Modify: `indexer/src-tauri/src/lib.rs` (función `territorio_clasificar`, sobre la línea 700)

**Interfaces:**
- Produces: `territory::clasificar_area(poligonos: &[Vec<Punto>], fuentes: &[String], locales: &[Cobertura], catalogo: &[Cobertura]) -> Result<Clasificacion>` — antes tomaba `poligono: &[Punto]` (un solo anillo).
- Produces: el comando Tauri `territorio_clasificar` pasa a aceptar `poligonos: Vec<Vec<lumi_index::tiles::Punto>>` en vez de `poligono: Vec<lumi_index::tiles::Punto>`.

Hoy `clasificar_area` solo sabe clasificar UN anillo. Para poder sumar/restar formas (Task 8), el
resultado de combinar dos polígonos puede ser varias piezas separadas (un `MultiPolygon` en
términos de GeoJSON) — hace falta poder clasificar todas esas piezas como una sola área, con los
agregados (`autores`, `por_origen`, etc.) calculados sobre el conjunto, no pieza a pieza.

- [ ] **Paso 1: Cambiar la firma de `clasificar_area`**

En `indexer/src-tauri/src/territory.rs`, sustituir la función completa:

```rust
pub fn clasificar_area(
    poligonos: &[Vec<Punto>],
    fuentes: &[String],
    locales: &[Cobertura],
    catalogo: &[Cobertura],
) -> Result<Clasificacion> {
    // Varios anillos significa «varias piezas del área», nunca un agujero: el
    // sistema no modela huecos interiores, y combinar formas (Task 8, sumar o
    // restar) puede partir el área en trozos separados. Deduplicar por
    // quadkey antes de clasificar es lo único que hace falta para tratar
    // todos los trozos como una sola área.
    let mut vistas = std::collections::BTreeSet::new();
    for anillo in poligonos {
        for qk in teselas_de_poligono(anillo) {
            vistas.insert(qk);
        }
    }
    let pedidas: Vec<String> = vistas.into_iter().collect();

    let teselas = clasificar(&pedidas, locales, catalogo);
    let Reparto { locales: l, catalogo: c, nuevas, reclamadas, bytes_a_descargar } = repartir(&teselas);

    let mut autores: std::collections::BTreeMap<String, u32> = Default::default();
    for (_, e) in &teselas {
        if let Estado::Catalogo { indice, .. } = e {
            *autores.entry(indice.clone()).or_default() += 1;
        }
    }
    let mut autores: Vec<(String, u32)> = autores.into_iter().collect();
    autores.sort_by_key(|b| std::cmp::Reverse(b.1));

    let detalle = clasificar_por_origen(&pedidas, fuentes, locales, catalogo);
    let por_origen = repartir_por_origen(&detalle)
        .into_iter()
        .map(|(f, r)| (f, RepartoOrigen { locales: r.locales, catalogo: r.catalogo, nuevas: r.nuevas }))
        .collect();

    Ok(Clasificacion {
        teselas,
        locales: l,
        catalogo: c,
        nuevas,
        reclamadas,
        bytes_a_descargar,
        autores,
        por_origen,
    })
}
```

- [ ] **Paso 2: Actualizar el comando Tauri**

En `indexer/src-tauri/src/lib.rs`, en `async fn territorio_clasificar` (busca `poligono: Vec<lumi_index::tiles::Punto>`), cambiar la firma y la única llamada a `clasificar_area` dentro:

```rust
async fn territorio_clasificar(
    estado: tauri::State<'_, Estado>,
    poligonos: Vec<Vec<lumi_index::tiles::Punto>>,
    fuentes: Vec<String>,
) -> Result<territory::Clasificacion, String> {
    let locales = territory::coberturas_locales(&estado.dir.join("paquetes"));
    let mut c =
        territory::clasificar_area(&poligonos, &fuentes, &locales, &[]).map_err(|e| e.to_string())?;
```

El resto del cuerpo de la función (descuento de reclamos, `reparto`, `Ok(c)`) no cambia.

- [ ] **Paso 3: Compilar**

Run: `cargo build -p lumid` (el crate `indexer` es un proyecto Tauri aparte — compílalo con
`cd indexer/src-tauri && cargo build`).
Expected: compila sin errores. Si `clasificar_area` tiene otro llamador además de
`territorio_clasificar` (compruébalo con una búsqueda de texto), actualízalo también.

- [ ] **Paso 4: Commit** — no hagas commit todavía; el commit único es la Task 8.

---

## Task 2: Recordar los últimos lugares buscados (Rust)

**Files:**
- Modify: `indexer/src-tauri/src/keys.rs`
- Modify: `indexer/src-tauri/src/lib.rs`

**Interfaces:**
- Consumes: `Almacen::guardar_ajuste(&self, clave: &str, valor: &str) -> Result<()>` y
  `Almacen::leer_ajuste(&self, clave: &str) -> Result<Option<String>>` — ya existen en `store.rs`,
  mismo mecanismo que usan `cola_consumo_leer`/`cola_consumo_fijar`.
- Produces: comandos Tauri `territorio_recientes_leer() -> Vec<LugarReciente>` y
  `territorio_recientes_anadir(nombre: String, lat: f64, lng: f64) -> ()`.

No hace falta tabla nueva: es exactamente el mismo patrón que el modo de consumo de embebido, un
valor JSON bajo una clave de `ajustes`. No es un secreto (son solo nombres de sitio y coordenadas),
así que usa `guardar_ajuste`/`leer_ajuste`, no la variante sellada.

- [ ] **Paso 1: Añadir la clave**

En `indexer/src-tauri/src/keys.rs`, junto a `CLAVE_MAPBOX`/`CLAVE_TOPE`:

```rust
pub const TERRITORIO_RECIENTES: &str = "territorio_recientes";
```

- [ ] **Paso 2: Los dos comandos**

En `indexer/src-tauri/src/lib.rs`, cerca de `territorio_clasificar`, añadir:

```rust
#[derive(serde::Serialize, serde::Deserialize, Clone)]
struct LugarReciente {
    nombre: String,
    lat: f64,
    lng: f64,
}

const TOPE_RECIENTES: usize = 6;

/// Los últimos lugares a los que saltó el operador desde el buscador del
/// mapa, para no tener que volver a escribirlos cada vez.
#[tauri::command]
fn territorio_recientes_leer(estado: tauri::State<'_, Estado>) -> Result<Vec<LugarReciente>, String> {
    let Some(json) = estado.almacen.leer_ajuste(keys::TERRITORIO_RECIENTES).map_err(|e| e.to_string())? else {
        return Ok(Vec::new());
    };
    Ok(serde_json::from_str(&json).unwrap_or_default())
}

/// Añade uno nuevo al frente, descarta un duplicado por nombre si ya estaba,
/// y recorta al tope — el orden "más reciente primero" vive aquí.
#[tauri::command]
fn territorio_recientes_anadir(
    estado: tauri::State<'_, Estado>,
    nombre: String,
    lat: f64,
    lng: f64,
) -> Result<(), String> {
    let anterior = estado.almacen.leer_ajuste(keys::TERRITORIO_RECIENTES).map_err(|e| e.to_string())?;
    let mut lista: Vec<LugarReciente> =
        anterior.and_then(|j| serde_json::from_str(&j).ok()).unwrap_or_default();
    lista.retain(|l| l.nombre != nombre);
    lista.insert(0, LugarReciente { nombre, lat, lng });
    lista.truncate(TOPE_RECIENTES);
    let json = serde_json::to_string(&lista).map_err(|e| e.to_string())?;
    estado.almacen.guardar_ajuste(keys::TERRITORIO_RECIENTES, &json).map_err(|e| e.to_string())
}
```

- [ ] **Paso 3: Registrar los comandos**

En `indexer/src-tauri/src/lib.rs`, en la lista de `generate_handler!` (busca `mapbox_clave_leer,`),
añadir justo debajo:

```rust
            territorio_recientes_leer,
            territorio_recientes_anadir,
```

- [ ] **Paso 4: Compilar**

Run: `cd indexer/src-tauri && cargo build`.
Expected: compila sin errores.

---

## Task 3: `api.ts` — firmas nuevas

**Files:**
- Modify: `indexer/src/lib/api.ts`

**Interfaces:**
- Consumes: los comandos Tauri de Task 1 y Task 2.
- Produces: `territorioClasificar(poligonos: Punto[][], fuentes: string[]) -> Promise<Clasificacion>`,
  `territorioRecientesLeer() -> Promise<LugarReciente[]>`,
  `territorioRecientesAnadir(nombre: string, lat: number, lng: number) -> Promise<void>`.

- [ ] **Paso 1: Cambiar `territorioClasificar`**

Busca (sobre la línea 309):

```ts
  territorioClasificar: (poligono: Punto[], fuentes: string[]) =>
    invoke<Clasificacion>("territorio_clasificar", { poligono, fuentes }),
```

Sustituir por:

```ts
  territorioClasificar: (poligonos: Punto[][], fuentes: string[]) =>
    invoke<Clasificacion>("territorio_clasificar", { poligonos, fuentes }),
```

- [ ] **Paso 2: Nuevo tipo y comandos de recientes**

Junto a la interfaz `FichaOrigen` (sobre la línea 110), añadir:

```ts
export interface LugarReciente { nombre: string; lat: number; lng: number }
```

Junto a `territorioHeredar` (sobre la línea 311), añadir:

```ts
  territorioRecientesLeer: () => invoke<LugarReciente[]>("territorio_recientes_leer"),
  territorioRecientesAnadir: (nombre: string, lat: number, lng: number) =>
    invoke<void>("territorio_recientes_anadir", { nombre, lat, lng }),
```

- [ ] **Paso 3: Verificar**

Run: `cd indexer && npx tsc -b --noEmit`.
Expected: fallará porque `TerritoryView.tsx`/`MapCanvas.tsx` todavía pasan `Punto[]` en vez de
`Punto[][]` — eso es esperado hasta la Task 8; no lo arregles aquí, solo confirma que el único
error nuevo es ese tipo de discrepancia (no un error de sintaxis en `api.ts`).

---

## Task 4: Dependencia de Turf + iconos nuevos

**Files:**
- Modify: `indexer/package.json`
- Modify: `indexer/src/ui/Icon.tsx`

**Interfaces:**
- Produces: iconos `editar`, `deshacer`, `rehacer`, `restar` en el registro `PATHS` de `Icon.tsx`
  (usables como `<Icon name="editar" />` etc. en las tareas siguientes).

- [ ] **Paso 1: Añadir las dependencias**

En `indexer/package.json`, bajo `"dependencies"`, junto a `"mapbox-gl"`, añadir (orden alfabético
con el resto):

```json
    "@turf/difference": "^7.2.0",
    "@turf/helpers": "^7.2.0",
    "@turf/nearest-point-on-line": "^7.2.0",
    "@turf/union": "^7.2.0",
```

Son paquetes individuales de Turf v7, no el bundle `@turf/turf` completo — solo se necesitan
unión, resta, el punto más cercano de una línea (para insertar un vértice) y los constructores
básicos (`polygon`, `featureCollection`, `lineString`).

- [ ] **Paso 2: Instalar**

Run: `cd indexer && npm install`.
Expected: instala sin error; `package-lock.json` se actualiza.

- [ ] **Paso 3: Confirmar la firma real de `union`/`difference`**

Turf v7 cambió la firma de `union`/`difference` respecto a v6: en vez de `union(a, b)` toman una
`FeatureCollection` con todas las piezas. Antes de escribir las Tasks 6-8, abre
`indexer/node_modules/@turf/union/dist/js/index.d.ts` y
`indexer/node_modules/@turf/difference/dist/js/index.d.ts` y confirma la firma exacta (nombre del
parámetro, si acepta un array de `Feature` o una `FeatureCollection`, qué devuelve si no hay
intersección). Este plan asume:

```ts
function union(features: FeatureCollection<Polygon | MultiPolygon>, options?: { properties?: object }): Feature<Polygon | MultiPolygon> | null;
function difference(features: FeatureCollection<Polygon | MultiPolygon>, options?: { properties?: object }): Feature<Polygon | MultiPolygon> | null;
```

Si la versión instalada difiere, ajusta las llamadas de la Task 8 a la firma real — el resto del
plan (extracción de anillos exteriores del resultado) no cambia, solo cómo se invoca la función.

- [ ] **Paso 4: Iconos nuevos**

En `indexer/src/ui/Icon.tsx`, dentro del objeto `PATHS`, junto a `poligono`/`rectangulo`/`circulo`
(sobre la línea 113), añadir:

```ts
  // Un lápiz: la herramienta que edita un trazo ya cerrado, distinta de
  // dibujar uno nuevo.
  editar: <><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></>,
  // Deshacer/rehacer como un par de flechas en espejo, mismo trazo, para que
  // se lean como opuestos a simple vista.
  deshacer: <><path d="M9 14 4 9l5-5" /><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" /></>,
  rehacer: <><path d="M15 14l5-5-5-5" /><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13" /></>,
  restar: <path d="M5 12h14" />,
```

- [ ] **Paso 5: Verificar**

Run: `cd indexer && npx tsc -b --noEmit`.
Expected: mismo estado que al final de Task 3 (los errores pendientes son solo los tipos de
`dibujo`, que se resuelven en Task 8) — sin errores nuevos originados en `Icon.tsx` ni en
`package.json`.

---

## Task 5: Buscador — contexto claro y recientes (`MapCanvas.tsx`)

**Files:**
- Modify: `indexer/src/territory/MapCanvas.tsx`

**Interfaces:**
- Consumes: `api.territorioRecientesLeer`, `api.territorioRecientesAnadir` (Task 3),
  `LugarReciente` (Task 3).

Los resultados de Mapbox ya traen el contexto que desambigua (país/región) dentro de `place_name`
— hoy se pinta en una sola línea con `truncate`, así que ese contexto es justo lo que se corta.
Separarlo en dos líneas (nombre principal en negro, contexto en gris debajo, sin truncar la
segunda) no necesita ningún dato nuevo de la API.

- [ ] **Paso 1: Estado de recientes y foco**

Junto a los demás `useState` de búsqueda (sobre la línea 116-119), añadir:

```ts
  const [recientes, setRecientes] = useState<LugarReciente[]>([]);
  const [foco, setFoco] = useState(false);

  useEffect(() => { void api.territorioRecientesLeer().then(setRecientes); }, []);
```

Y en el `import` de `api` en la cabecera del archivo, añadir `LugarReciente` al `import { api, ... } from "../lib/api";`.

- [ ] **Paso 2: Partir el nombre**

Junto a las demás funciones auxiliares del archivo (p. ej. cerca de `metrosEntre`), añadir:

```ts
function partirNombre(nombre: string): { principal: string; contexto: string } {
  const i = nombre.indexOf(",");
  return i === -1
    ? { principal: nombre, contexto: "" }
    : { principal: nombre.slice(0, i), contexto: nombre.slice(i + 1).trim() };
}
```

- [ ] **Paso 3: Registrar el salto en recientes**

En la función `irA` (sobre la línea 421), justo después de `setSugerencias([]);`, añadir:

```ts
    void api.territorioRecientesAnadir(s.nombre, s.lat, s.lng)
      .then(() => api.territorioRecientesLeer())
      .then(setRecientes);
```

- [ ] **Paso 4: `onFocus`/`onBlur` en el input**

En el `<input>` del buscador (sobre la línea 474), añadir los manejadores:

```tsx
              onFocus={() => setFoco(true)}
              onBlur={() => setFoco(false)}
```

(junto a `onChange`/`onKeyDown` que ya existen).

- [ ] **Paso 5: Reescribir la lista de sugerencias**

Sustituir el bloque completo `{sugerencias.length > 0 && (...)}`  (líneas ~483-499) por:

```tsx
          {(() => {
            const mostrarRecientes =
              foco && busqueda.trim().length === 0 && sugerencias.length === 0 && recientes.length > 0;
            const items = mostrarRecientes ? recientes : sugerencias;
            if (items.length === 0) return null;
            return (
              <div className="lumi-anim mt-1.5 overflow-hidden rounded-lg border border-white/[.13]
                bg-[rgba(16,19,25,.94)] shadow-lg shadow-black/40 backdrop-blur-xl"
                style={{ animation: "jg-fade-rise 160ms cubic-bezier(.2,.85,.35,1) both" }}>
                {mostrarRecientes && (
                  <p className="px-3 pt-2 text-[9.5px] uppercase tracking-wide text-subtle">Recientes</p>
                )}
                {items.map((s, i) => {
                  const { principal, contexto } = partirNombre(s.nombre);
                  return (
                    <button
                      key={`${s.nombre}-${i}`}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => irA(s)}
                      className="lumi-anim block w-full px-3 py-2 text-left transition-colors duration-150
                        hover:bg-white/[.06]"
                      style={{ animation: `jg-fade-rise 160ms ${i * 25}ms cubic-bezier(.2,.85,.35,1) both` }}
                    >
                      <p className="truncate text-[11.5px] text-fg">{principal}</p>
                      {contexto && <p className="truncate text-[9.5px] text-subtle">{contexto}</p>}
                    </button>
                  );
                })}
              </div>
            );
          })()}
```

`onMouseDown={(e) => e.preventDefault()}` es lo que evita que el `onBlur` del input cierre la
lista antes de que el `onClick` del botón llegue a disparar — el input nunca pierde el foco al
pulsar un resultado.

- [ ] **Paso 6: Verificar**

Run: `cd indexer && npx tsc -b --noEmit`.
Expected: sin errores nuevos originados en este bloque.

---

## Task 6: Deshacer último vértice y cerrar por proximidad (`MapCanvas.tsx`)

**Files:**
- Modify: `indexer/src/territory/MapCanvas.tsx`

- [ ] **Paso 1: Cerrar el polígono acercándose al primer vértice**

En el manejador `m.on("click", (e) => { if (herramientaRef.current !== "poligono") return; ...`
(sobre la línea 235), sustituir el cuerpo completo por:

```ts
        m.on("click", (e) => {
          if (herramientaRef.current !== "poligono") return;
          // Cerrar acercándose al primer vértice, además del doble clic que
          // ya funciona: 12px de radio en pantalla, no en metros, porque el
          // gesto tiene que sentirse igual de fácil a cualquier zoom.
          if (puntos.current.length >= 3) {
            const inicio = m.project([puntos.current[0].lng, puntos.current[0].lat]);
            const aqui = m.project(e.lngLat);
            if (Math.hypot(inicio.x - aqui.x, inicio.y - aqui.y) < 12) {
              onPoligonoListoRef.current(puntos.current);
              return;
            }
          }
          puntos.current = [...puntos.current, { lat: e.lngLat.lat, lng: e.lngLat.lng }];
          pintarDibujo(puntos.current);
        });
```

- [ ] **Paso 2: Deshacer el último vértice con Backspace**

Después del bloque de `m.on("dblclick", ...)` para el polígono (sobre la línea 244), dentro del
mismo `m.on("load", () => { ... })`, añadir:

```ts
        // Backspace quita solo la última esquina en vez de obligar a borrar
        // el trazo entero por un clic de más.
        m.getContainer().tabIndex = 0;
        m.getContainer().addEventListener("keydown", (e) => {
          if (e.key !== "Backspace" || herramientaRef.current !== "poligono") return;
          if (puntos.current.length === 0) return;
          e.preventDefault();
          puntos.current = puntos.current.slice(0, -1);
          pintarDibujo(puntos.current);
        });
```

`m.getContainer().tabIndex = 0` hace que el `<div>` del mapa pueda recibir el foco de teclado —
sin esto, `Backspace` nunca llegaría a ese contenedor salvo que el operador ya hubiera hecho clic
dentro por otra razón. El listener se registra sobre el contenedor del mapa (no `window`) para no
interceptar `Backspace` mientras se escribe en el buscador o en cualquier otro campo de texto de
la pantalla.

- [ ] **Paso 3: Verificar**

Run: `cd indexer && npx tsc -b --noEmit`.
Expected: sin errores nuevos.

---

## Task 7: Herramienta «editar» — arrastrar, insertar y borrar vértices (`MapCanvas.tsx`)

**Files:**
- Modify: `indexer/src/territory/MapCanvas.tsx`

**Interfaces:**
- Consumes: `nearestPointOnLine` de `@turf/nearest-point-on-line`, `lineString` de `@turf/helpers`
  (Task 4).
- Produces: prop nueva `onVerticeEditado?: (anillo: Punto[]) => void` en `MapCanvas`; prop `dibujo`
  cambia de tipo `Punto[]` a `Punto[][]` (una entrada por pieza del área — Task 8 la rellena).

Vale solo cuando el trazo actual es UNA sola pieza (`dibujo.length === 1`): editar varias piezas a
la vez no tiene un gesto claro, así que con más de una pieza la herramienta simplemente no muestra
vértices que arrastrar (el botón se queda deshabilitado — Paso 6).

- [ ] **Paso 1: Import y tipo del prop**

En la cabecera del archivo, añadir:

```ts
import { lineString } from "@turf/helpers";
import { nearestPointOnLine } from "@turf/nearest-point-on-line";
```

Cambiar la firma del componente (busca `dibujo: Punto[];` en la interfaz de props, sobre la línea
89) a:

```ts
  dibujo: Punto[][];
  clasificacion: Clasificacion | null;
  onPoligonoListo: (p: Punto[]) => void;
  onVerticeEditado?: (anillo: Punto[]) => void;
```

Y añadir `onVerticeEditado` a la desestructuración de props del componente (junto a
`onPoligonoListo`, sobre la línea 84-94).

- [ ] **Paso 2: Nueva herramienta en el tipo y en la barra**

Cambiar `type Herramienta = "mano" | "poligono" | "rectangulo" | "circulo";` a:

```ts
type Herramienta = "mano" | "poligono" | "rectangulo" | "circulo" | "editar";
```

Añadir a `HERRAMIENTAS` (sobre la línea 74), después de `circulo`:

```ts
  { id: "editar", icon: "editar", titulo: "Editar — arrastra un vértice, doble clic en un lado para añadir uno, clic derecho para borrarlo" },
```

- [ ] **Paso 3: Refs para el arrastre**

Junto a los demás `useRef` del componente (cerca de `puntos`, sobre la línea 98), añadir:

```ts
  const onVerticeEditadoRef = useRef(onVerticeEditado);
  useEffect(() => { onVerticeEditadoRef.current = onVerticeEditado; }, [onVerticeEditado]);
  // El anillo que se está editando ahora mismo — se resincroniza cada vez
  // que cambian la herramienta activa o el trazo confirmado, y el arrastre
  // lee/escribe aquí en vez de en el estado de React para no re-renderizar
  // en cada `mousemove`.
  const anilloEditando = useRef<Punto[]>([]);
  const arrastrandoVertice = useRef<number | null>(null);
```

- [ ] **Paso 4: Fuente y capa de vértices**

Dentro de `m.on("load", () => { ... })`, después del bloque que añade la fuente/capa `sondeos`
(sobre la línea 188), añadir:

```ts
        // Los vértices del trazo actual, editables con la herramienta
        // "editar". Fuente aparte de "dibujo": esta pinta puntos arrastrables,
        // no la línea/relleno del trazo.
        m.addSource("vertices", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        m.addLayer({
          id: "vertices-puntos", type: "circle", source: "vertices",
          paint: {
            "circle-radius": 4.5,
            "circle-color": "#85b7eb",
            "circle-stroke-width": 1.4,
            "circle-stroke-color": "#0c0e12",
          },
        });
```

- [ ] **Paso 5: Función auxiliar `verticesGeoJSON`**

Junto a `poligonoGeoJSON` (línea 24), añadir:

```ts
function verticesGeoJSON(anillo: Punto[]) {
  return {
    type: "FeatureCollection" as const,
    features: anillo.map((p, i) => ({
      type: "Feature" as const,
      properties: { i },
      geometry: { type: "Point" as const, coordinates: [p.lng, p.lat] },
    })),
  };
}
```

- [ ] **Paso 6: Interacción de arrastrar/insertar/borrar**

Dentro de `m.on("load", () => { ... })`, después del bloque de rectángulo/círculo (sobre la línea
286, antes del cierre `});` que termina el callback de `load`), añadir:

```ts
        // --- Editar: arrastrar, insertar y borrar vértices. ----------------
        m.on("mousedown", "vertices-puntos", (e) => {
          if (herramientaRef.current !== "editar") return;
          const i = Number(propsDe(e.features?.[0]).i);
          arrastrandoVertice.current = i;
          m.dragPan.disable();
        });
        m.on("mousemove", (e) => {
          if (arrastrandoVertice.current === null) return;
          const i = arrastrandoVertice.current;
          const anillo = [...anilloEditando.current];
          anillo[i] = { lat: e.lngLat.lat, lng: e.lngLat.lng };
          anilloEditando.current = anillo;
          (m.getSource("vertices") as mapboxgl.GeoJSONSource)?.setData(verticesGeoJSON(anillo));
          pintarDibujo(anillo);
        });
        m.on("mouseup", () => {
          if (arrastrandoVertice.current === null) return;
          arrastrandoVertice.current = null;
          m.dragPan.enable();
          onVerticeEditadoRef.current?.(anilloEditando.current);
        });

        // Doble clic sobre el borde inserta un vértice ahí — `nearestPointOnLine`
        // da el índice del segmento donde cae, y el punto nuevo se inserta justo
        // después de ese índice.
        m.on("dblclick", "dibujo-borde", (e) => {
          if (herramientaRef.current !== "editar") return;
          e.preventDefault();
          const anillo = anilloEditando.current;
          if (anillo.length < 3) return;
          const cerrado = [...anillo, anillo[0]].map((p): [number, number] => [p.lng, p.lat]);
          const cercano = nearestPointOnLine(lineString(cerrado), [e.lngLat.lng, e.lngLat.lat]);
          const idx = (cercano.properties.index ?? 0) + 1;
          const nuevo = { lat: e.lngLat.lat, lng: e.lngLat.lng };
          onVerticeEditadoRef.current?.([...anillo.slice(0, idx), nuevo, ...anillo.slice(idx)]);
        });

        // Clic derecho sobre un vértice lo borra, si quedan al menos 3.
        m.on("contextmenu", "vertices-puntos", (e) => {
          if (herramientaRef.current !== "editar") return;
          e.preventDefault();
          const i = Number(propsDe(e.features?.[0]).i);
          const anillo = anilloEditando.current;
          if (anillo.length <= 3) return;
          onVerticeEditadoRef.current?.(anillo.filter((_, j) => j !== i));
        });
```

- [ ] **Paso 7: Sincronizar `vertices`/`dibujo` con el prop `dibujo`**

Sustituir el efecto `useEffect(() => { if (dibujo.length === 0) puntos.current = []; }, [dibujo]);`
(sobre la línea 350) por:

```ts
  useEffect(() => {
    if (dibujo.length === 0) puntos.current = [];
    anilloEditando.current = herramienta === "editar" && dibujo.length === 1 ? dibujo[0] : [];
    const m = mapa.current;
    if (!m || !m.isStyleLoaded()) return;
    const src = m.getSource("vertices") as mapboxgl.GeoJSONSource | undefined;
    src?.setData(verticesGeoJSON(anilloEditando.current));
    // Entrar en "editar" es la única forma de volver a ver el contorno de un
    // área ya clasificada: fuera de este modo, nada vuelve a tocar la fuente
    // "dibujo" una vez que el trazo se cerró.
    if (herramienta === "editar") pintarDibujo(anilloEditando.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dibujo, herramienta]);
```

`pintarDibujo` está definida dentro del callback de `load` (closure sobre `m`) — para poder
llamarla también desde este efecto (fuera de ese closure), muévela de ser una función local dentro
de `load` a ser una función de módulo que recibe `m` como parámetro:

```ts
function pintarDibujoEn(m: mapboxgl.Map, pts: Punto[]) {
  (m.getSource("dibujo") as mapboxgl.GeoJSONSource | undefined)?.setData({
    type: "FeatureCollection",
    features: pts.length >= 3 ? [poligonoGeoJSON(pts)] : [],
  });
}
```

y sustituir tanto la definición local `const pintarDibujo = (pts: Punto[]) => { ... };` (línea 190)
como todas sus llamadas (`pintarDibujo(puntos.current)`, `pintarDibujo(pts)`, la nueva
`pintarDibujo(anillo)` del Paso 6, y la del efecto de este paso) por `pintarDibujoEn(m, ...)` —
dentro del callback de `load`, `m` ya está en scope; en este efecto, guárdalo primero en la
variable local `m` como ya hace el resto del archivo (`const m = mapa.current;`).

- [ ] **Paso 8: Botón «editar» deshabilitado con varias piezas**

En el `.map` de `HERRAMIENTAS` que pinta los botones de la barra (sobre la línea 509), añadir la
condición de deshabilitado solo para `"editar"`:

```tsx
          {HERRAMIENTAS.map((h) => (
            <button
              key={h.id}
              title={h.id === "editar" && dibujo.length > 1
                ? "Editar solo vale con una pieza — combina o rehaz para dejar una sola"
                : h.titulo}
              disabled={h.id === "editar" && dibujo.length !== 1}
              onClick={() => elegirHerramienta(h.id)}
              className={`grid h-7 w-7 place-items-center rounded-[7px] disabled:opacity-30 ${
                herramienta === h.id ? "bg-white/[.09] text-fg" : "text-subtle hover:text-fg"}`}
            >
              <Icon name={h.icon} size={14} />
            </button>
          ))}
```

- [ ] **Paso 9: Verificar**

Run: `cd indexer && npx tsc -b --noEmit`.
Expected: los únicos errores restantes deben venir de `TerritoryView.tsx` (que todavía pasa
`Punto[]` a `dibujo` y no pasa `onVerticeEditado`) — eso se arregla en Task 8.

---

## Task 8: Combinar formas y deshacer/rehacer general (`TerritoryView.tsx`)

**Files:**
- Create: `indexer/src/territory/CombineBar.tsx`
- Modify: `indexer/src/territory/TerritoryView.tsx`

**Interfaces:**
- Consumes: `MapCanvas` con `dibujo: Punto[][]` y `onVerticeEditado` (Task 7),
  `api.territorioClasificar(poligonos: Punto[][], fuentes: string[])` (Task 3),
  `union`/`difference`/`polygon`/`featureCollection` de Turf (Task 4).
- Produces: `CombineBar` — barra de confirmación con Sustituir/Sumar/Restar/Cancelar.

- [ ] **Paso 1: `CombineBar.tsx`**

Crear `indexer/src/territory/CombineBar.tsx`:

```tsx
import { Icon } from "../ui/Icon";

/** Aparece cuando ya hay un área clasificada y el operador acaba de cerrar
 *  un trazo nuevo: decide si el trazo nuevo sustituye al área, se suma, o se
 *  resta de ella. Mismo sitio y estilo que el aviso de "elige una
 *  herramienta" — una pista flotante, no un diálogo modal que tape el mapa. */
export function CombineBar({ onElegir, onCancelar }: {
  onElegir: (modo: "sustituir" | "sumar" | "restar") => void;
  onCancelar: () => void;
}) {
  return (
    <div className="absolute bottom-[62px] left-1/2 z-20 -translate-x-1/2 flex items-center gap-1.5
      whitespace-nowrap rounded-card border border-white/[.13] bg-[rgba(16,19,25,.82)]
      px-2 py-1.5 shadow-lg shadow-black/40 backdrop-blur-xl">
      <p className="px-1.5 text-[10.5px] text-subtle">Ya hay un área — ¿qué hacer con la forma nueva?</p>
      <button onClick={() => onElegir("sumar")}
        className="jg-press flex items-center gap-1 rounded-lg border border-border px-2.5 py-1 text-[11px] text-fg">
        <Icon name="plus" size={11} /> Sumar
      </button>
      <button onClick={() => onElegir("restar")}
        className="jg-press flex items-center gap-1 rounded-lg border border-border px-2.5 py-1 text-[11px] text-fg">
        <Icon name="restar" size={11} /> Restar
      </button>
      <button onClick={() => onElegir("sustituir")}
        className="jg-press rounded-lg border border-border px-2.5 py-1 text-[11px] text-fg">
        Sustituir
      </button>
      <button onClick={onCancelar} className="jg-press px-2 py-1 text-[11px] text-subtle hover:text-fg">
        Cancelar
      </button>
    </div>
  );
}
```

- [ ] **Paso 2: Imports y tipos nuevos en `TerritoryView.tsx`**

En la cabecera del archivo, añadir:

```ts
import { difference } from "@turf/difference";
import { featureCollection, polygon } from "@turf/helpers";
import { union } from "@turf/union";

import { CombineBar } from "./CombineBar";
```

(Ajusta los nombres/orden exactos de los imports de Turf a la firma real confirmada en la Task 4,
Paso 3, si difiere de lo asumido aquí.)

Junto a las demás funciones auxiliares del archivo, añadir:

```ts
type Instantanea = { dibujo: Punto[][]; clasificacion: Clasificacion | null };

function cerrarAnillo(pts: Punto[]): [number, number][] {
  const anillo = pts.map((p): [number, number] => [p.lng, p.lat]);
  anillo.push(anillo[0]);
  return anillo;
}

function anilloATurf(pts: Punto[]) {
  return polygon([cerrarAnillo(pts)]);
}

/** Solo los anillos EXTERIORES del resultado de turf: el sistema no modela
 *  agujeros (una tesela es local/catálogo/nueva, nunca "excluida"), así que
 *  un hueco real que deje sumar/restar se ignora — caso raro (restar algo
 *  totalmente rodeado por el área existente) y documentado como límite
 *  conocido, no un fallo silencioso a ciegas. */
function anillosExteriores(geom: { type: string; coordinates: unknown }): Punto[][] {
  const anillos = geom.type === "Polygon"
    ? [(geom.coordinates as number[][][])[0]]
    : (geom.coordinates as number[][][][]).map((poly) => poly[0]);
  return anillos.map((anillo) => anillo.slice(0, -1).map(([lng, lat]) => ({ lat, lng })));
}
```

- [ ] **Paso 3: Estado nuevo**

Cambiar `const [dibujo, setDibujo] = useState<Punto[]>([]);` a:

```ts
  const [dibujo, setDibujo] = useState<Punto[][]>([]);
  const [formaPendiente, setFormaPendiente] = useState<Punto[] | null>(null);
  const [historial, setHistorial] = useState<Instantanea[]>([]);
  const [historialFuturo, setHistorialFuturo] = useState<Instantanea[]>([]);
```

- [ ] **Paso 4: `fijarAnillos`, reemplazo de `alTerminarDibujo`, combinar y editar**

Sustituir la función `alTerminarDibujo` (líneas 50-54) por:

```ts
  async function fijarAnillos(anillos: Punto[][]) {
    setHistorial((h) => [...h, { dibujo, clasificacion }].slice(-20));
    setHistorialFuturo([]);
    setDibujo(anillos);
    setSondeos([]);
    setClasificacion(await api.territorioClasificar(anillos, fichas.map((f) => f.id)));
  }

  // La clasificación necesita saber contra QUÉ orígenes se pregunta, porque
  // una tesela heredada puede seguir sin cubrir en alguno de ellos. Si ya hay
  // un área, un trazo nuevo no la sustituye sin más: se pregunta qué hacer.
  async function alTerminarDibujo(p: Punto[]) {
    if (clasificacion) {
      setFormaPendiente(p);
      return;
    }
    await fijarAnillos([p]);
  }

  async function resolverCombinacion(modo: "sustituir" | "sumar" | "restar") {
    if (!formaPendiente) return;
    const nueva = formaPendiente;
    setFormaPendiente(null);
    if (modo === "sustituir") {
      await fijarAnillos([nueva]);
      return;
    }
    const actuales = dibujo.map(anilloATurf);
    const nuevaTurf = anilloATurf(nueva);
    if (modo === "sumar") {
      const resultado = union(featureCollection([...actuales, nuevaTurf]));
      await fijarAnillos(resultado ? anillosExteriores(resultado.geometry) : [...dibujo, nueva]);
      return;
    }
    // Restar: turf resta contra UN minuendo, no contra una colección suelta
    // — si el área actual ya son varias piezas, se unen primero.
    const minuendo = actuales.length > 1 ? union(featureCollection(actuales)) : actuales[0];
    if (!minuendo) return;
    const resultado = difference(featureCollection([minuendo, nuevaTurf]));
    await fijarAnillos(resultado ? anillosExteriores(resultado.geometry) : []);
  }

  async function alEditarVertice(anillo: Punto[]) {
    await fijarAnillos([anillo]);
  }
```

- [ ] **Paso 5: Deshacer/rehacer**

Añadir, junto a las funciones anteriores:

```ts
  function deshacer() {
    const anterior = historial[historial.length - 1];
    if (!anterior) return;
    setHistorial((h) => h.slice(0, -1));
    setHistorialFuturo((f) => [...f, { dibujo, clasificacion }]);
    setDibujo(anterior.dibujo);
    setClasificacion(anterior.clasificacion);
  }

  function rehacer() {
    const siguiente = historialFuturo[historialFuturo.length - 1];
    if (!siguiente) return;
    setHistorialFuturo((f) => f.slice(0, -1));
    setHistorial((h) => [...h, { dibujo, clasificacion }]);
    setDibujo(siguiente.dibujo);
    setClasificacion(siguiente.clasificacion);
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!e.ctrlKey && !e.metaKey) return;
      if (document.activeElement instanceof HTMLInputElement) return;
      if (e.key.toLowerCase() === "z" && !e.shiftKey) { e.preventDefault(); deshacer(); }
      else if ((e.key.toLowerCase() === "z" && e.shiftKey) || e.key.toLowerCase() === "y") {
        e.preventDefault();
        rehacer();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
```

Sin array de dependencias (se re-registra en cada render): `deshacer`/`rehacer` cierran sobre
`historial`/`historialFuturo`/`dibujo`/`clasificacion` del render actual, y esta pantalla no
re-renderiza con la frecuencia suficiente para que eso importe.

- [ ] **Paso 6: Actualizar `reiniciar`**

Añadir a `reiniciar()` (línea 88):

```ts
    setFormaPendiente(null);
    setHistorial([]);
    setHistorialFuturo([]);
```

- [ ] **Paso 7: Cambiar `dibujo={dibujo}` por el nuevo estado y pintar `CombineBar`**

En el JSX de `<MapCanvas ... />` (línea 162), añadir la prop nueva:

```tsx
        <MapCanvas
          dibujo={dibujo}
          clasificacion={clasificacion}
          onPoligonoListo={(p) => void alTerminarDibujo(p)}
          onVerticeEditado={(a) => void alEditarVertice(a)}
          activos={activos}
          sondeos={sondeos}
          tokenMapillary={tokenMapillary}
        />
```

Después del bloque `{clasificacion && !mostrarPlan && <MapLegend />}` (línea 203), añadir:

```tsx
      {formaPendiente && (
        <CombineBar
          onElegir={(m) => void resolverCombinacion(m)}
          onCancelar={() => setFormaPendiente(null)}
        />
      )}
```

- [ ] **Paso 8: Verificar**

Run: `cd indexer && npx tsc -b --noEmit`.
Expected: sin errores. Si `alConfirmarPlan`/`confirmarDescarga` referencian `clasificacion.teselas`
directamente, no necesitan cambios — la forma de `Clasificacion` no cambió, solo cómo se pide.

---

## Task 9: Verificación final y commit

**Files:** ninguno nuevo — solo build/lint/commit de todo lo anterior.

- [ ] **Paso 1: Compilar todo**

Run: `cd indexer/src-tauri && cargo build`.
Expected: sin errores ni warnings nuevos.

- [ ] **Paso 2: Typecheck y lint del frontend**

Run: `cd indexer && npx tsc -b --noEmit && npm run lint`.
Expected: ambos limpios.

- [ ] **Paso 3: Sanity check de git antes de comitear**

Run: `git status --short && git log --oneline -3`.
Confirma que no hay cambios de otra sesión mezclados en el árbol de trabajo (si los hay, no los
incluyas en el `git add` del paso siguiente — son ajenos a este plan).

- [ ] **Paso 4: Commit único**

Run:
```bash
git add indexer/package.json indexer/package-lock.json indexer/src/ui/Icon.tsx \
  indexer/src/lib/api.ts indexer/src/territory/MapCanvas.tsx indexer/src/territory/TerritoryView.tsx \
  indexer/src/territory/CombineBar.tsx indexer/src-tauri/src/keys.rs indexer/src-tauri/src/lib.rs \
  indexer/src-tauri/src/territory.rs indexer/src-tauri/Cargo.lock \
  docs/superpowers/plans/2026-09-01-mapa-territorio-plan.md
git commit -m "$(cat <<'EOF'
feat: mapa de territorio — buscador con contexto y recientes, deshacer/rehacer, editar vértices, sumar/restar áreas

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

Añade solo los archivos que este plan tocó por su ruta explícita — nunca `git add -A`/`git add .`.
Si `indexer/src-tauri/Cargo.lock` no cambió (no se añadió ninguna dependencia Rust nueva en este
plan), omítelo del `git add`.
