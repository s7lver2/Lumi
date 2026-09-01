# Territorio: nombre real, modo persistente, hover en reclamadas, info de búsqueda — Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this
> plan task-by-task, in order. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cuatro mejoras a la pantalla de dibujar territorio del Indexer
(`indexer/src/territory/`): el diálogo de plan deja de mostrar un nombre de índice inventado,
sumar/restar deja de ser un popup posterior a dibujar y pasa a ser un modo elegido de antemano
junto a la barra de herramientas, las teselas reclamadas muestran quién las tiene con solo pasar
el ratón por encima, y seleccionar un resultado del buscador muestra un panel con más información
del lugar. De propina, la herramienta vuelve a "mano" sola en cuanto se termina de dibujar una
forma.

**Architecture:** `TerritoryView.tsx` sigue siendo dueño de `dibujo`/`clasificacion` y de la
lógica de combinar (turf); el modo de combinar (`combineMode`) se añade como otro estado allí y
se pasa a `MapCanvas.tsx` para que lo renderice junto a la barra de herramientas — mismo patrón ya
usado para `dibujo`/`onPoligonoListo`. La popup `CombineBar.tsx` (construida en el plan anterior)
queda sustituida por este selector persistente y se borra por completo, no se deja como código
muerto.

**Tech Stack:** React 19 + TypeScript, Mapbox GL JS.

## Global Constraints

- No añadir tests salvo que se pida explícitamente.
- Español en comentarios, copy de UI y mensajes de commit.
- Sin icon library: iconos SVG a mano en `indexer/src/ui/Icon.tsx`, mismo patrón que ya existe.
- Un solo commit al final. No commits intermedios por tarea.
- Antes de editar, releer el archivo — varias tareas tocan `MapCanvas.tsx`/`TerritoryView.tsx` en
  pasadas sucesivas y los números de línea pueden haberse desplazado.

---

## Task 1: El nombre del índice ya no es un placeholder inventado

**Files:**
- Modify: `indexer/src/catalog/IndexPicker.tsx`
- Modify: `indexer/src/App.tsx`

**Root cause confirmado:** `App.tsx` pasa `nombre="nuevo-indice"` a `TerritoryView` SIEMPRE, sin
importar qué índice se eligió — `IndexPicker` solo devuelve el `id` al elegir, nunca el nombre
real. El diálogo de plan (`PlanDialog`) muestra ese nombre falso, que por eso no coincide con
ningún índice real de la pestaña Proyectos: nunca existió, es un resto de una versión anterior sin
picker.

- [ ] **Paso 1: `IndexPicker` devuelve también el nombre**

En `indexer/src/catalog/IndexPicker.tsx`, cambiar la firma de la prop:

```ts
export function IndexPicker({ titulo, onAbrir }: { titulo: string; onAbrir: (id: number, nombre: string) => void }) {
```

Y el `onClick` del botón de cada fila (busca `onClick={() => onAbrir(r.id)}`):

```tsx
              <button key={r.id} onClick={() => onAbrir(r.id, r.nombre)}
```

- [ ] **Paso 2: `App.tsx` guarda y usa el nombre real**

Relee `App.tsx` completo antes de editar — varias sesiones han tocado este archivo hoy. Busca el
estado que guarda el índice abierto para Territorio (`indiceAbierto`, `setIndiceAbierto`) y añade
un estado hermano para el nombre:

```ts
  const [nombreIndiceAbierto, setNombreIndiceAbierto] = useState<string>("");
```

Busca los dos sitios donde `<IndexPicker titulo="Dibujar territorio" onAbrir={setIndiceAbierto} />`
y `<IndexPicker titulo="Revisar imágenes" onAbrir={setIndiceAbierto} />` se usan (uno para
Territorio, otro para Revisión — revisión no necesita el nombre, pero la firma de `onAbrir` ahora
exige el segundo argumento en los dos por ser el mismo componente). Cambia el de Territorio a:

```tsx
                {destino === "territorio" && indiceAbierto === null && (
                  <IndexPicker titulo="Dibujar territorio"
                    onAbrir={(id, nombre) => { setIndiceAbierto(id); setNombreIndiceAbierto(nombre); }} />
                )}
```

Y el de Revisión a (ignora el nombre, pero acepta el segundo parámetro):

```tsx
                {destino === "revision" && indiceAbierto === null && (
                  <IndexPicker titulo="Revisar imágenes"
                    onAbrir={(id) => setIndiceAbierto(id)} />
                )}
```

Busca `<TerritoryView nombre="nuevo-indice" ...` y cambia el prop:

```tsx
                {destino === "territorio" && indiceAbierto !== null && (
                  <TerritoryView
                    nombre={nombreIndiceAbierto}
                    indiceId={indiceAbierto}
```

(el resto de props de `TerritoryView` no cambia). Si en algún sitio `indiceAbierto` se limpia a
`null` (al volver atrás/cerrar), limpia `nombreIndiceAbierto` a `""` en el mismo punto para que no
se quede pegado el nombre del índice anterior la próxima vez que se abra el picker.

- [ ] **Paso 3: Verificar**

Run: `cd indexer && npx tsc -b --noEmit`.
Expected: sin errores nuevos.

---

## Task 2: Modo de combinar persistente en vez de popup posterior

**Files:**
- Modify: `indexer/src/territory/MapCanvas.tsx`
- Modify: `indexer/src/territory/TerritoryView.tsx`
- Delete: `indexer/src/territory/CombineBar.tsx`
- Modify: `indexer/src/ui/Icon.tsx`

Hoy, al dibujar una forma nueva sobre un área ya clasificada, aparece `CombineBar` (Sumar/
Restar/Sustituir/Cancelar) DESPUÉS de terminar el trazo. El pedido es que el modo se elija DE
ANTEMANO, con un selector de 3 posiciones que viva junto a la barra de herramientas de dibujo
(visible incluso antes de haber dibujado nada) — dibujar ya no pregunta nada, aplica
inmediatamente el modo activo.

- [ ] **Paso 1: Icono para "restar" ya existe, falta nada nuevo**

`indexer/src/ui/Icon.tsx` ya tiene `restar` y `plus` (del plan de hoy anterior) — no hace falta
ningún icono nuevo para este selector, solo texto/iconos ya presentes.

- [ ] **Paso 2: Levantar el estado `combineMode` en `TerritoryView.tsx`**

Relee el archivo completo. Sustituir:

```ts
  const [formaPendiente, setFormaPendiente] = useState<Punto[] | null>(null);
```

por:

```ts
  const [combineMode, setCombineMode] = useState<"sustituir" | "sumar" | "restar">("sustituir");
```

- [ ] **Paso 3: `alTerminarDibujo` aplica el modo directamente, sin paso intermedio**

Sustituir:

```ts
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
```

por:

```ts
  async function alTerminarDibujo(p: Punto[]) {
    if (!clasificacion) {
      await fijarAnillos([p]);
      return;
    }
    await resolverCombinacion(combineMode, p);
  }

  async function resolverCombinacion(modo: "sustituir" | "sumar" | "restar", nueva: Punto[]) {
    if (modo === "sustituir") {
      await fijarAnillos([nueva]);
      return;
    }
```

(el resto del cuerpo de `resolverCombinacion` — las ramas `sumar`/`restar` con `union`/
`difference` — no cambia, solo la firma y cómo se obtiene `nueva`).

- [ ] **Paso 4: Quitar `CombineBar` del render y del import**

Quitar el `import { CombineBar } from "./CombineBar";` y el bloque:

```tsx
      {formaPendiente && (
        <CombineBar
          onElegir={(m) => void resolverCombinacion(m)}
          onCancelar={() => setFormaPendiente(null)}
        />
      )}
```

- [ ] **Paso 5: Actualizar `reiniciar()`**

Donde `reiniciar()` hacía `setFormaPendiente(null);`, quítalo (ya no existe ese estado) — no hace
falta resetear `combineMode` al reiniciar: el modo elegido es una preferencia de la sesión de
dibujo, no algo ligado a un área concreta.

- [ ] **Paso 6: Pasar `combineMode` a `MapCanvas`**

En el JSX de `<MapCanvas ... />`, añade las dos props nuevas:

```tsx
        <MapCanvas
          dibujo={dibujo}
          clasificacion={clasificacion}
          onPoligonoListo={(p) => void alTerminarDibujo(p)}
          onVerticeEditado={(a) => void alEditarVertice(a)}
          combineMode={combineMode}
          onCombineModeChange={setCombineMode}
          activos={activos}
          sondeos={sondeos}
          tokenMapillary={tokenMapillary}
        />
```

- [ ] **Paso 7: Borrar `CombineBar.tsx`**

Run: `git rm indexer/src/territory/CombineBar.tsx` (o bórralo con la herramienta de archivos —
queda sin ningún consumidor tras el Paso 4, no lo dejes como código muerto).

- [ ] **Paso 8: El selector en `MapCanvas.tsx`**

Relee el archivo completo. Añade las dos props nuevas a la interfaz del componente (junto a
`dibujo`/`onPoligonoListo`):

```ts
  combineMode: "sustituir" | "sumar" | "restar";
  onCombineModeChange: (m: "sustituir" | "sumar" | "restar") => void;
```

y a la desestructuración de props. En el JSX, justo al lado de la barra de herramientas existente
(el `<div className="absolute bottom-6 left-1/2 ...">` que renderiza `HERRAMIENTAS.map(...)`),
añade un segundo grupo de botones en la MISMA barra flotante (no una barra aparte — mismo
contenedor, con un separador visual):

```tsx
          <span className="mx-0.5 w-px bg-white/10" />
          {([
            { m: "sustituir" as const, etiqueta: "Sustituir" },
            { m: "sumar" as const, etiqueta: "Sumar" },
            { m: "restar" as const, etiqueta: "Restar" },
          ]).map(({ m, etiqueta }) => (
            <button
              key={m}
              title={`Al dibujar una forma nueva sobre un área ya clasificada: ${etiqueta.toLowerCase()}`}
              onClick={() => onCombineModeChange(m)}
              className={`rounded-[7px] px-2 text-[10px] ${
                combineMode === m ? "bg-white/[.09] text-fg" : "text-subtle hover:text-fg"}`}
            >
              {etiqueta}
            </button>
          ))}
```

Colócalo dentro del mismo `<div>` flotante que ya envuelve `HERRAMIENTAS.map(...)` y el botón de
papelera, después del separador (`<span className="mx-0.5 w-px bg-white/10" />`) que ya separa las
herramientas de dibujo del botón de borrar — añade OTRO separador igual antes de este nuevo grupo,
para que quede: [herramientas] · [borrar] · [sustituir/sumar/restar].

- [ ] **Paso 9: Verificar**

Run: `cd indexer && npx tsc -b --noEmit`.
Expected: sin errores. Confirma con una búsqueda de texto que no queda ninguna referencia a
`CombineBar`/`formaPendiente` en el árbol de `indexer/src`.

---

## Task 3: Volver a "mano" sola al terminar de dibujar

**Files:**
- Modify: `indexer/src/territory/MapCanvas.tsx`

Con el Task 2 ya aplicado, `onPoligonoListoRef.current(pts)` siempre resuelve la forma en el acto
(nunca queda un estado "pendiente" que el operador pudiera querer seguir editando con la misma
herramienta) — así que cambiar a "mano" justo después es seguro en los 3 sitios donde se completa
un trazo.

- [ ] **Paso 1: Cierre por doble clic del polígono**

En el manejador `m.on("dblclick", (e) => { if (herramientaRef.current !== "poligono") return; ...`
busca la línea `onPoligonoListoRef.current(puntos.current);` y añade justo después:

```ts
          setHerramienta("mano");
```

- [ ] **Paso 2: Cierre por proximidad del polígono**

En el manejador `m.on("click", (e) => { if (herramientaRef.current !== "poligono") return; ...`
(el que añadió el cierre por proximidad en el plan anterior), busca la rama que llama
`onPoligonoListoRef.current(puntos.current); return;` dentro del `if (Math.hypot(...) < 12)` y
añade `setHerramienta("mano");` justo antes del `return;`.

- [ ] **Paso 3: Rectángulo y círculo**

En `m.on("mouseup", (e) => { ... })`, después de la comprobación de "arrastre demasiado pequeño,
no cuenta" (`if (metrosEntre(...) < 5) { pintarDibujo([]); return; }`) y justo después de la línea
`onPoligonoListoRef.current(pts);`, añade `setHerramienta("mano");`.

- [ ] **Paso 4: Verificar**

Run: `cd indexer && npx tsc -b --noEmit`.
Expected: sin errores. La herramienta "editar" no se ve afectada — usa `onVerticeEditadoRef`, no
`onPoligonoListoRef`, así que nunca dispara este auto-cambio.

---

## Task 4: Hover sobre una tesela reclamada muestra quién la tiene

**Files:**
- Modify: `indexer/src/territory/MapCanvas.tsx`

Las teselas reclamadas YA se ven distinguidas por color sin selección manual (capa `teselas-relleno`/
`teselas-borde`, siempre activa según `clasificacion`) — lo que falta es un tooltip al pasar el
ratón, sin necesidad de hacer clic. El popup de clic (con el botón "Reportar") se queda tal cual.

- [ ] **Paso 1: Popup de hover, siguiendo al ratón**

Junto a los demás `useRef` del componente, añade uno para la instancia del popup de hover:

```ts
  const popupHover = useRef<mapboxgl.Popup | null>(null);
```

Sustituir el bloque:

```ts
        m.on("mouseenter", "teselas-relleno", (e) => {
          const props = propsDe(e.features?.[0]);
          if (herramientaRef.current === "mano" && props.estado === "reclamada") {
            m.getCanvas().style.cursor = "pointer";
          }
        });
        m.on("mouseleave", "teselas-relleno", () => { m.getCanvas().style.cursor = ""; });
```

por:

```ts
        m.on("mouseenter", "teselas-relleno", (e) => {
          const props = propsDe(e.features?.[0]);
          if (herramientaRef.current !== "mano" || props.estado !== "reclamada") return;
          m.getCanvas().style.cursor = "pointer";
          const autor = String(props.autor ?? "");
          const paquete = String(props.paquete ?? "");
          popupHover.current = new mapboxgl.Popup({
            closeButton: false, closeOnClick: false, className: "lumi-popup-hover",
          })
            .setLngLat(e.lngLat)
            .setHTML(`<div class="font-mono text-[10px] leading-relaxed"><b>${autor}</b><br/>${paquete}</div>`)
            .addTo(m);
        });
        m.on("mousemove", "teselas-relleno", (e) => {
          if (herramientaRef.current !== "mano") return;
          popupHover.current?.setLngLat(e.lngLat);
        });
        m.on("mouseleave", "teselas-relleno", () => {
          m.getCanvas().style.cursor = "";
          popupHover.current?.remove();
          popupHover.current = null;
        });
```

El popup de hover es de solo lectura (sin botón "Reportar", sin `closeButton`) — el de clic
(el bloque `m.on("click", "teselas-relleno", ...)` más abajo, que SÍ trae "Reportar") no cambia.

- [ ] **Paso 2: Verificar**

Run: `cd indexer && npx tsc -b --noEmit`.
Expected: sin errores.

---

## Task 5: Panel con más información del lugar buscado

**Files:**
- Modify: `indexer/src/territory/MapCanvas.tsx`

Al elegir un resultado del buscador, hoy solo se vuela hasta ahí — no queda ningún rastro de qué
se buscó ni de su contexto. Se añade un panel lateral (columna izquierda, debajo del buscador) que
aparece al elegir un resultado y muestra su nombre completo, tipo de lugar y coordenadas, con un
botón para cerrarlo.

- [ ] **Paso 1: Guardar más datos de cada resultado**

Mapbox Geocoding v5 ya devuelve `place_type` (array, p. ej. `["place"]`/`["region"]`) y `context`
(jerarquía: región, país, etc., cada uno `{id, text}`) en cada `feature` — hoy `alEscribirBusqueda`
solo extrae `nombre`/`lng`/`lat` y descarta el resto. Sustituir el tipo del estado `sugerencias` y
su construcción:

```ts
  const [sugerencias, setSugerencias] = useState<{ nombre: string; lng: number; lat: number }[]>([]);
```

por:

```ts
  const [sugerencias, setSugerencias] = useState<LugarBuscado[]>([]);
  const [lugarSeleccionado, setLugarSeleccionado] = useState<LugarBuscado | null>(null);
```

Junto a la interfaz `Poligono`/tipos del módulo (o al principio del archivo, junto a las demás
interfaces locales), añade:

```ts
interface LugarBuscado {
  nombre: string;
  lng: number;
  lat: number;
  tipo: string[];
  contexto: { id: string; text: string }[];
}
```

En `alEscribirBusqueda`, sustituir:

```ts
        const j: { features?: { place_name: string; center: [number, number] }[] } = await r.json();
        setSugerencias(
          (j.features ?? []).map((f) => ({ nombre: f.place_name, lng: f.center[0], lat: f.center[1] })),
        );
```

por:

```ts
        const j: {
          features?: {
            place_name: string; center: [number, number];
            place_type?: string[]; context?: { id: string; text: string }[];
          }[];
        } = await r.json();
        setSugerencias(
          (j.features ?? []).map((f) => ({
            nombre: f.place_name, lng: f.center[0], lat: f.center[1],
            tipo: f.place_type ?? [], contexto: f.context ?? [],
          })),
        );
```

- [ ] **Paso 2: `irA` guarda el lugar elegido**

En la función `irA`, después de `setSugerencias([]);`, añade `setLugarSeleccionado(s);` (donde `s`
ya es el parámetro `LugarBuscado` completo — el tipo de `irA` pasa de recibir
`{ nombre: string; lng: number; lat: number }` a recibir `LugarBuscado`, ajusta la firma de la
función si hace falta; el resto del cuerpo de `irA` no cambia).

- [ ] **Paso 3: El panel**

Con `partirNombre` ya existente (del plan de buscador de hoy), añade un mapa de nombres legibles
para los tipos de lugar de Mapbox:

```ts
const NOMBRE_TIPO: Record<string, string> = {
  country: "país", region: "región/provincia", postcode: "código postal",
  district: "distrito", place: "ciudad/pueblo", locality: "localidad",
  neighborhood: "barrio", address: "dirección", poi: "punto de interés",
};
```

Y en el JSX, junto al bloque del buscador (después del `<div>` que contiene el input y la lista de
sugerencias/recientes, dentro del mismo contenedor posicionado `absolute left-3 top-3 z-30`, o en
un `<div>` hermano justo debajo con el mismo `left-3`), añade:

```tsx
      {lugarSeleccionado && (
        <div className="lumi-anim absolute left-3 top-[76px] z-20 w-[300px] rounded-lg border border-white/[.13]
          bg-[rgba(16,19,25,.82)] p-3 shadow-lg shadow-black/40 backdrop-blur-xl"
          style={{ animation: "jg-fade-rise 200ms cubic-bezier(.2,.85,.35,1) both" }}>
          <div className="flex items-start justify-between gap-2">
            <p className="text-[12px] leading-snug text-fg">{partirNombre(lugarSeleccionado.nombre).principal}</p>
            <button onClick={() => setLugarSeleccionado(null)} className="jg-press shrink-0 text-subtle hover:text-fg">
              <Icon name="x" size={12} />
            </button>
          </div>
          {lugarSeleccionado.tipo.length > 0 && (
            <p className="mt-1 text-[10px] uppercase tracking-wide text-subtle">
              {lugarSeleccionado.tipo.map((t) => NOMBRE_TIPO[t] ?? t).join(", ")}
            </p>
          )}
          {lugarSeleccionado.contexto.length > 0 && (
            <p className="mt-1.5 text-[10.5px] leading-relaxed text-muted">
              {lugarSeleccionado.contexto.map((c) => c.text).join(" · ")}
            </p>
          )}
          <p className="mt-1.5 font-mono text-[9.5px] text-subtle">
            {lugarSeleccionado.lat.toFixed(5)}, {lugarSeleccionado.lng.toFixed(5)}
          </p>
        </div>
      )}
```

(Ajusta `top-[76px]` si la altura real del bloque del buscador es distinta — debe quedar justo
debajo de la caja de búsqueda, no solapado con ella; comprueba visualmente si es posible.)

- [ ] **Paso 4: Verificar**

Run: `cd indexer && npx tsc -b --noEmit`.
Expected: sin errores.

---

## Task 6: Verificación final y commit

- [ ] **Paso 1: Typecheck y lint**

Run: `cd indexer && npx tsc -b --noEmit && npm run lint`.
Expected: ambos limpios.

- [ ] **Paso 2: Sanity check de git**

Run: `git status --short && git log --oneline -3`. Incluye solo archivos que este plan tocó — si
hay cambios de otra fuente en el árbol (p. ej. `BUG_BOUNTY.txt`), déjalos fuera del `git add`.

- [ ] **Paso 3: Commit único**

```bash
git add indexer/src/catalog/IndexPicker.tsx indexer/src/App.tsx \
  indexer/src/territory/MapCanvas.tsx indexer/src/territory/TerritoryView.tsx \
  docs/superpowers/plans/2026-09-01-territorio-fixes-plan.md
git rm --cached indexer/src/territory/CombineBar.tsx 2>/dev/null || true
git commit -m "$(cat <<'EOF'
fix: nombre real de índice al dibujar territorio, modo de combinar persistente, hover en reclamadas, info del lugar buscado

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

(si ya borraste `CombineBar.tsx` con `git rm` en la Task 2, el `git rm --cached` de aquí no hace
falta — está por si el archivo se borró con la herramienta de archivos en vez de con `git rm` y
queda como "eliminado" sin estar en el índice).
