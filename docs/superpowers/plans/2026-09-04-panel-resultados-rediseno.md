# Rediseño del panel de resultados — Fase 1 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Separar el historial de intentos de análisis (carril angosto, izquierda del cajón) del detalle del intento seleccionado (cajón ensanchado, 360px), y reescribir el panel de agentes con tarjetas individuales e iconos propios — sin tocar backend ni añadir el comparador de fotos (Fase 2 aparte).

**Architecture:** Dos componentes nuevos/reescritos en `client/src/work/`: `AttemptsRail.tsx` (nuevo, la lista de intentos que hoy vive dentro de `ResultsDrawer.tsx`) y `ResultsDrawer.tsx` reescrito (deja de listar intentos, se ensancha, gana secciones de resultado/agentes rediseñadas). `CaseView.tsx` monta ambos con estado de apertura independiente pero enlazado (mismo patrón `abiertoYa` que ya usa para el cajón). Iconos nuevos en `client/src/ui/Icon.tsx`, siguiendo el registro existente.

**Tech Stack:** React 18/19 + TypeScript, Tailwind (clases inline, sin CSS aparte), sin librerías nuevas.

## Global Constraints

- 360px de ancho para el cajón de detalle (`DRAWER_W` en `Drawer.tsx`), no 250px.
- ~80px de ancho para el carril de intentos (constante nueva `RAIL_W`).
- Insignia de verificación SIEMPRE en `fg`/blanco, NUNCA en verde — `DESIGN.md`: "No hay verde. Completado se representa en blanco."
- Iconos: `viewBox="0 0 24 24"`, `fill="none" stroke="currentColor"`, `strokeWidth` 1.6–2.0, sin cajitas de color, sin librería — mismo patrón que `client/src/ui/Icon.tsx` ya establece.
- El agente `hora-sombras` es el único icono cuyo dibujo es dato real (ángulo de la aguja calculado de la hora estimada), no decoración.
- Un agente abstenido (`etiqueta === "abstiene"`) se ve con opacidad reducida, nunca desaparece.
- El carril de intentos se abre solo automáticamente la primera vez que hay más de un intento; después, control manual (mismo patrón que `abiertoYa` en `CaseView.tsx:213-219`).
- Sin cambios de esquema de base de datos ni de tipos de API (`Analysis`, `Hipotesis`, `DichoDeAgente` ya traen todo lo necesario).
- No tests unless explicitly requested (`PROJECT-CONVENTIONS.md`) — verificación manual únicamente.

---

### Task 1: Iconos de agente en el registro central

**Files:**
- Modify: `client/src/ui/Icon.tsx`

**Interfaces:**
- Consumes: nada (icono estático puro).
- Produces: `IconName` gana `"bocadillo"` y `"via"` como claves válidas de `PATHS`, usables por `<Icon name="bocadillo" />` / `<Icon name="via" />` desde cualquier componente, igual que el resto del registro.

- [ ] **Step 1: Añadir los dos iconos nuevos a `PATHS`**

En `client/src/ui/Icon.tsx`, dentro del objeto `PATHS` (justo antes de la línea `};` que lo cierra, línea 109), añade:

```tsx
  bocadillo: (
    <>
      <path d="M4 5h16v10H9l-4 4v-4H4V5Z" />
      <path d="M8 9h8M8 12h5" />
    </>
  ),
  via: (
    <>
      <line x1="12" y1="3" x2="12" y2="21" strokeDasharray="2.4 2.6" />
      <rect x="14.5" y="7" width="5" height="8" rx="1.3" />
      <circle cx="17" cy="8.4" r=".5" fill="currentColor" stroke="none" />
    </>
  ),
```

- [ ] **Step 2: Verificar que compila**

Run: `cd "E:\Lumi Station\client" && npx tsc -b`
Expected: sin errores (el registro es un objeto literal, `IconName` se infiere de sus claves — no hay un segundo sitio que listar).

- [ ] **Step 3: Commit**

```bash
cd "E:\Lumi Station"
git add client/src/ui/Icon.tsx
git commit -m "feat(client): iconos de bocadillo (idioma) y via (lado de conduccion) para las tarjetas de agente"
```

---

### Task 2: `AttemptsRail` — extraer la lista de intentos a su propio carril

**Files:**
- Create: `client/src/work/AttemptsRail.tsx`
- Modify: `client/src/work/Drawer.tsx` (añadir `RAIL_W` y un `AttemptsRailShell` que reutilice el mismo patrón de transición que `Drawer`)
- Modify: `client/src/work/CaseView.tsx` (montar `AttemptsRail`, estado de apertura, insets)

**Interfaces:**
- Consumes: `Analysis[]` (de `client/src/lib/api.ts`, ya existente — campos `id`, `model`, `state`, `result_lat`, `result_radius_m`, `result_confidence`), tipo `MenuState`/`MenuEntry` de `client/src/ui/ContextMenu.tsx` (ya usados por `ResultsDrawer.tsx` hoy).
- Produces: componente `AttemptsRail({ open, analyses, selected, onSelect, onMenu }: {...})` — el mismo contrato de selección que ya consume `ResultsDrawer` hoy (`selected: number | null`, `onSelect: (id: number) => void`), para que Task 3 no tenga que inventar nada nuevo. Exporta también `RAIL_W` (constante numérica) desde `Drawer.tsx`.

- [ ] **Step 1: Añadir `RAIL_W` y `RailShell` a `Drawer.tsx`**

Lee primero `client/src/work/Drawer.tsx` completo (17 líneas hoy) para no perder el `DrawerTab` existente. Añade, sin borrar nada:

```tsx
export const RAIL_W = 80;

/** El mismo armazón que `Drawer`, pero para el carril de intentos: se
 *  desliza desde la derecha igual, pero su borde derecho se pega al cajón
 *  de detalle cuando ese está abierto (`shiftedBy`), o al canto de la
 *  pantalla cuando no lo está — nunca se solapan. */
export function RailShell({ open, shiftedBy, children }:
  { open: boolean; shiftedBy: number; children: React.ReactNode }) {
  return (
    <aside
      style={{ width: RAIL_W, right: shiftedBy, transform: open ? "none" : "translateX(100%)" }}
      className="absolute bottom-0 top-0 z-[21] flex flex-col gap-1 overflow-y-auto
        border-l border-border bg-[rgba(16,18,21,.92)] p-2 backdrop-blur-xl
        transition-[transform,right] duration-[420ms] ease-expo">
      {children}
    </aside>
  );
}
```

- [ ] **Step 2: Escribir `AttemptsRail.tsx`**

Este es el contenido que hoy vive en `client/src/work/ResultsDrawer.tsx` líneas 166-198 (el `.map` de `analyses`), movido a su propio fichero y adaptado al ancho angosto (80px: ya no caben ni la coordenada ni el aviso de nivel efectivo degradado — solo modelo + estado, con el detalle completo reservado para el cajón de al lado).

```tsx
import type { Analysis } from "../lib/api";
import type { MenuEntry, MenuState } from "../ui/ContextMenu";
import { menuAt } from "../ui/ContextMenu";
import { Icon } from "../ui/Icon";
import { RailShell } from "./Drawer";

/** El carril angosto de intentos: qué análisis existen para la imagen
 *  seleccionada, sin ninguno de sus datos — eso vive en el cajón de detalle,
 *  de al lado. Antes esta lista vivía DENTRO del cajón de detalle y lo
 *  llenaba entero en cuanto había unos pocos intentos, empujando el
 *  resultado de verdad fuera de la vista. */
export function AttemptsRail({
  open, shiftedBy, analyses, selected, onSelect, onAnalyze, onMenu,
}: {
  open: boolean;
  shiftedBy: number;
  analyses: Analysis[];
  selected: number | null;
  onSelect: (id: number) => void;
  onAnalyze: () => void;
  onMenu: (s: MenuState) => void;
}) {
  const menuDe = (a: Analysis): MenuEntry[] => {
    const hecho = a.state === "hecho";
    return [
      { label: "Repetir con otro modelo…", onClick: onAnalyze },
      hecho
        ? {
            label: "Copiar coordenadas", hint: "⌘C",
            onClick: () => void navigator.clipboard.writeText(
              `${a.result_lat!.toFixed(6)}, ${a.result_lng!.toFixed(6)}`),
          }
        : null,
    ];
  };

  return (
    <RailShell open={open} shiftedBy={shiftedBy}>
      <p className="mb-1 text-center text-[7.5px] uppercase tracking-[.1em] text-subtle">
        Intentos
      </p>
      {analyses.map((a, i) => {
        const on = a.id === selected;
        const icon = a.state === "hecho" ? "check" : a.state === "error" ? "x" : "spinner";
        return (
          <button key={a.id} onClick={() => onSelect(a.id)}
            onContextMenu={(e) => menuAt(e, `${i + 1} · ${a.model}`, menuDe(a), onMenu)}
            style={{ animation: `jg-fade-rise 220ms ${Math.min(i, 6) * 30}ms cubic-bezier(.16,1,.3,1) both` }}
            className={`flex flex-col items-center gap-1 rounded-lg border p-[6px_2px] text-center
              transition-[border-color,background-color] duration-300 ease-expo ${
                on ? "border-white/[.35] bg-white/[.05]" : "border-border hover:border-white/[.18]"}`}>
            <span className="text-[8px] uppercase tracking-[.06em] text-subtle">{a.model}</span>
            <Icon name={icon} size={12}
              className={a.state === "error" ? "text-danger-fg" : a.state === "hecho" ? "text-fg" : "text-subtle"} />
          </button>
        );
      })}
    </RailShell>
  );
}
```

- [ ] **Step 3: Verificar que compila (aunque nada lo monte todavía)**

Run: `cd "E:\Lumi Station\client" && npx tsc -b`
Expected: sin errores. `AttemptsRail` no se usa aún en ningún sitio — eso es Task 4.

- [ ] **Step 4: Commit**

```bash
cd "E:\Lumi Station"
git add client/src/work/Drawer.tsx client/src/work/AttemptsRail.tsx
git commit -m "feat(client): AttemptsRail, el carril de intentos separado del cajon de detalle"
```

---

### Task 3: Reescribir `ResultsDrawer.tsx` — sin lista de intentos, ensanchado, agentes con icono propio

**Files:**
- Modify: `client/src/work/ResultsDrawer.tsx` (reescritura casi completa)
- Modify: `client/src/work/Drawer.tsx` (`DRAWER_W`: 250 → 360)

**Interfaces:**
- Consumes: `RAIL_W`/`RailShell` de Task 2 (no directamente — `ResultsDrawer` sigue usando su propio `Drawer`/`DrawerTab`, sin cambios de firma ahí más que el valor de `DRAWER_W`). `Analysis`, `Hipotesis`, `DichoDeAgente` de `client/src/lib/api.ts` (sin cambios de tipo).
- Produces: `ResultsDrawer({ open, image, analysis, busy, onAnalyze, onCenter }: {...})` — **firma distinta a la de hoy**: pierde `analyses: Analysis[]`, `selected`, `onSelect`, `onMenu` (eso ya lo cubre `AttemptsRail`); gana `analysis: Analysis | null` (el intento YA seleccionado, resuelto por el llamador — antes `ResultsDrawer` resolvía `shownA` internamente buscando en `analyses`, ahora se lo pasan resuelto). Task 4 tiene que llamarlo con esta firma nueva.

- [ ] **Step 1: Cambiar `DRAWER_W` en `Drawer.tsx`**

En `client/src/work/Drawer.tsx`, la línea `export const DRAWER_W = 250;` pasa a:

```tsx
export const DRAWER_W = 360;
```

- [ ] **Step 2: Reescribir `client/src/work/ResultsDrawer.tsx` completo**

Reemplaza el fichero entero por:

```tsx
import { lumiUrl } from "../lib/bridge";
import type { Analysis, DichoDeAgente, Hipotesis, Image } from "../lib/api";
import { Drawer } from "./Drawer";
import { Icon } from "../ui/Icon";

/** Metros entre dos coordenadas. Haversine con el radio medio de la Tierra:
 *  precisión de sobra para decir «el EXIF declara un GPS a 300 m de aquí». */
export function metersBetween(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(bLat - aLat);
  const dLng = rad(bLng - aLng);
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Resultado principal + alternativas, con su barra de peso y su respaldo
 *  geométrico si lo tiene. Sin lista de intentos aquí (vive en
 *  `AttemptsRail`) — todo este espacio es del intento seleccionado. */
function HipotesisList({ a }: { a: Analysis }) {
  if (a.state !== "hecho" || a.result_lat == null || a.result_lng == null) return null;
  const principal: Hipotesis = {
    lat: a.result_lat, lng: a.result_lng, radio_m: a.result_radius_m ?? 0,
    peso: a.result_confidence ?? 0, indice: "", autor: "",
    inliers: a.result_inliers, verificador: a.result_verificador,
    motivo_agente: null,
  };
  const todas = [principal, ...a.hypotheses];
  const maxPeso = Math.max(...todas.map((h) => h.peso), 1e-9);
  return (
    <div className="flex flex-col gap-2.5 rounded-[10px] border border-border p-3">
      <div className="font-mono text-[18px] leading-none text-fg">
        {principal.lat.toFixed(4)}, {principal.lng.toFixed(4)}
      </div>
      <div className="flex gap-4">
        <div>
          <div className="text-[8px] uppercase tracking-[.08em] text-subtle">Radio</div>
          <div className="mt-0.5 font-mono text-[12.5px] text-fg">± {Math.round(principal.radio_m)} m</div>
        </div>
        <div>
          <div className="text-[8px] uppercase tracking-[.08em] text-subtle">Confianza</div>
          <div className="mt-0.5 font-mono text-[12.5px] text-fg">{principal.peso.toFixed(1)}×</div>
        </div>
      </div>
      {/* Insignia de verificación: SIEMPRE en `fg`/blanco, nunca verde —
          DESIGN.md lo prohíbe ("Completado se representa en blanco"). */}
      <div className="flex items-center gap-1.5 border-t border-border pt-2.5">
        {principal.verificador ? (
          <>
            <Icon name="check" size={12} className="text-fg" />
            <span className="text-[10.5px] text-fg">
              verificado por {principal.verificador} ·{" "}
              <span className="font-mono tabular-nums">{principal.inliers}</span> correspondencias
            </span>
          </>
        ) : (
          <span className="text-[10.5px] text-subtle">sin verificación geométrica · coordenada de recuperación</span>
        )}
      </div>
      {a.hypotheses.length > 0 && (
        <div className="flex flex-col gap-1.5 border-t border-border pt-2.5">
          <p className="text-[8px] uppercase tracking-[.08em] text-subtle">Alternativas</p>
          {todas.slice(1).map((h, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="w-3 shrink-0 font-mono text-[9px] text-subtle">{i + 2}</span>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-1.5">
                  <span className="font-mono text-[10px] text-fg">{h.lat.toFixed(4)}, {h.lng.toFixed(4)}</span>
                  <span className="font-mono text-[9px] text-subtle">± {Math.round(h.radio_m)} m</span>
                </div>
                <div className="mt-1 h-[3px] overflow-hidden rounded-full bg-white/[.06]">
                  <div className="h-full bg-white/40" style={{ width: `${Math.max(6, (h.peso / maxPeso) * 100)}%` }} />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Icono propio por agente — no una plantilla repetida con el icono
 *  cambiado (DESIGN.md prohíbe rejillas de tarjetas idénticas). El de
 *  `hora-sombras` es el único cuyo dibujo depende del dato real: la aguja
 *  rota al ángulo estimado a partir de la hora que dice `etiqueta`
 *  ("~13:00" → 13h). El resto son formas fijas. */
function AgenteIcono({ agente, etiqueta, apagado }: { agente: string; etiqueta: string; apagado: boolean }) {
  const color = apagado ? "#6a6c70" : "#e8e8e6";
  if (agente === "hora-sombras") {
    const m = /(\d{1,2})(?::\d{2})?/.exec(etiqueta);
    const hora = m ? Number(m[1]) : 12;
    // Mediodía (12h) = aguja recta hacia arriba (0°); cada hora de
    // diferencia gira 15° (360°/24h) hacia el lado que corresponda.
    const grados = (hora - 12) * 15;
    return (
      <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.7"
        strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
        <circle cx="12" cy="12" r="8.5" />
        <line x1="12" y1="12" x2="12" y2="6" transform={`rotate(${grados} 12 12)`}
          style={{ transition: "transform 1.1s cubic-bezier(.16,1,.3,1)" }} />
        <circle cx="12" cy="12" r=".6" fill={color} stroke="none" />
      </svg>
    );
  }
  if (agente === "clima-aparente") {
    return <Icon name="cloud" size={26} className={apagado ? "text-subtle" : "text-fg"} />;
  }
  if (agente === "lado-conduccion") {
    return <Icon name="via" size={26} className={apagado ? "text-subtle" : "text-fg"} />;
  }
  // "idioma" y cualquier agente futuro sin icono propio: bocadillo genérico.
  return <Icon name="bocadillo" size={26} className={apagado ? "text-subtle" : "text-fg"} />;
}

/** Lo que la imagen dice de sí misma. Una tarjeta por agente, con su icono
 *  propio y su frase de motivo visible — antes era una lista apretada de
 *  una columna con todos los `detalle` concatenados al final. Los
 *  abstenidos NO desaparecen: se ven apagados, diciendo que no hubo señal
 *  suficiente. */
function AgentesPanel({ agentes }: { agentes: DichoDeAgente[] }) {
  if (agentes.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <p className="text-[9px] uppercase tracking-[.11em] text-subtle">Lo que dice la imagen</p>
      {agentes.map((d) => {
        const calla = d.etiqueta === "abstiene";
        return (
          <div key={d.agente}
            className={`flex items-center gap-3 rounded-lg bg-white/[.03] p-2.5 ${calla ? "opacity-50" : ""}`}>
            <AgenteIcono agente={d.agente} etiqueta={d.etiqueta} apagado={calla} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-[10.5px] text-fg">{d.nombre}</span>
                {!calla && <span className="font-mono text-[9px] tabular-nums text-subtle">{d.confianza.toFixed(2)}</span>}
              </div>
              <div className="mt-0.5 text-[12px] text-fg">{calla ? "sin señal suficiente" : d.etiqueta}</div>
              {!calla && d.detalle && (
                <p className="mt-0.5 text-[9.5px] leading-snug text-subtle">{d.detalle}</p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Lo que se sabe del intento seleccionado: la foto, el resultado y el GPS
 *  que declara la cámara. `analysis` ya viene resuelto por quien monta este
 *  componente (antes `ResultsDrawer` buscaba entre TODOS los intentos y
 *  además los listaba aquí mismo — eso ahora es trabajo de `AttemptsRail`
 *  y de `CaseView`, no de este componente). */
export function ResultsDrawer({
  open, image, analysis, busy, onAnalyze, onCenter,
}: {
  open: boolean;
  image: Image | null;
  analysis: Analysis | null;
  busy: boolean;
  onAnalyze: () => void;
  onCenter: (lat: number, lng: number) => void;
}) {
  const exif = image?.exif_lat != null && image.exif_lng != null;

  return (
    <Drawer open={open}>
      {image && (
        <div className="flex items-center gap-2.5 rounded-[9px] bg-white/[.03] p-[8px]">
          <img src={lumiUrl(`/v1/images/${image.id}/thumb`)} alt=""
            className="h-9 w-11 shrink-0 rounded bg-elevated object-cover" />
          <div className="min-w-0">
            <div className="truncate font-mono text-[10.5px] text-fg">{image.filename}</div>
            {analysis && (
              <div className="mt-0.5 font-mono text-[9px] text-subtle">{analysis.model}</div>
            )}
          </div>
        </div>
      )}

      {analysis && analysis.state !== "hecho" && (
        <p className="text-[11.5px] text-muted">
          {analysis.state === "error" ? analysis.error ?? "falló sin dejar motivo" : "esperando al motor"}
        </p>
      )}

      {analysis?.nivel_efectivo && analysis.nivel_efectivo !== analysis.model && (
        <p className="flex items-start gap-2 text-[10.5px] leading-relaxed text-warning-fg">
          <Icon name="alert" size={12} className="mt-px shrink-0" />
          Se pidió {analysis.model} y corrió {analysis.nivel_efectivo}: a los índices instalados les
          faltan capas de vectores de los modelos que {analysis.model} necesita.
        </p>
      )}

      {analysis && <HipotesisList a={analysis} />}
      {analysis && <AgentesPanel agentes={analysis.agentes} />}
      {analysis?.state === "hecho" && analysis.agentes.length === 0 && (
        <p className="text-[10px] leading-relaxed text-subtle">
          Los agentes no llegaron a correr: sus modelos no están instalados en este servidor.
        </p>
      )}

      {exif && (
        <div className="rounded-[10px] border border-warning/30 p-[8px_9px]">
          <div className="text-[9px] uppercase tracking-[.11em] text-subtle">E · EXIF</div>
          <div className="text-[11.5px] text-warning-fg">
            {image!.exif_lat!.toFixed(4)}, {image!.exif_lng!.toFixed(4)}
          </div>
        </div>
      )}

      <div className="flex-1" />
      <button onClick={onAnalyze} disabled={busy}
        className="jg-press w-full rounded-[9px] border border-white/15 px-3 py-2 text-[11.5px]
          text-fg disabled:opacity-40">
        {busy ? "Un momento…" : "Analizar otra vez"}
      </button>
    </Drawer>
  );
}
```

Nota para quien implemente: `onCenter` queda en la firma porque `metersBetween` y el resto del contrato con `CaseView` (mapa, marcadores) no cambian — el llamador (`CaseView.tsx`, Task 4) sigue usándolo para centrar el mapa en una alternativa, aunque este fichero ya no tenga el menú contextual que lo disparaba (ese menú pasa a `AttemptsRail`, que también puede llamar a `onCenter` si Task 4 se lo conecta — este plan no lo exige explícitamente, solo no elimina la prop para no romper `CaseView`).

- [ ] **Step 3: Verificar que compila**

Run: `cd "E:\Lumi Station\client" && npx tsc -b`
Expected: errores en `CaseView.tsx` (todavía llama al `ResultsDrawer` viejo con la firma vieja) — **eso es esperado aquí**, Task 4 lo arregla. Confirma que los únicos errores están en `CaseView.tsx`, no en `ResultsDrawer.tsx` ni `AttemptsRail.tsx`.

- [ ] **Step 4: Commit**

```bash
cd "E:\Lumi Station"
git add client/src/work/ResultsDrawer.tsx client/src/work/Drawer.tsx
git commit -m "feat(client): ResultsDrawer sin lista de intentos, ensanchado a 360px, agentes con icono propio"
```

---

### Task 4: `CaseView.tsx` — montar `AttemptsRail` + `ResultsDrawer` con la nueva firma

**Files:**
- Modify: `client/src/work/CaseView.tsx`

**Interfaces:**
- Consumes: `AttemptsRail` (Task 2), `ResultsDrawer` nueva firma (Task 3), `RAIL_W` de `Drawer.tsx`.
- Produces: nada nuevo hacia fuera — es el punto de montaje final.

- [ ] **Step 1: Import nuevo y estado del carril**

En `client/src/work/CaseView.tsx`, la línea 12 (`import { DrawerTab, DRAWER_W, type DrawerId } from "./Drawer";`) pasa a:

```tsx
import { DrawerTab, DRAWER_W, RAIL_W, type DrawerId } from "./Drawer";
import { AttemptsRail } from "./AttemptsRail";
```

Después del `abiertoYa` existente (líneas 213-219), añade el mismo patrón para el carril — se abre solo automáticamente la primera vez que hay MÁS DE UN intento, y a partir de ahí manda el control manual:

```tsx
  const [railOpen, setRailOpen] = useState<boolean | null>(null);
  const railAbiertoYa = useRef(false);
  useEffect(() => {
    if (mine.length > 1 && !railAbiertoYa.current && railOpen === null) {
      railAbiertoYa.current = true;
      setRailOpen(true);
    }
  }, [mine.length, railOpen]);
  const railMostrado = mine.length > 1 && (railOpen ?? false);
```

Esto necesita `useState`/`useRef`/`useEffect` ya importados (lo están, línea 1) y `mine` ya calculado más arriba (línea 201-204, sin cambios).

- [ ] **Step 2: Calcular los dos insets (carril + cajón) y pasarlos a `Dock`**

La línea 295 (`const inset = drawerId === null ? 0 : DRAWER_W;`) pasa a:

```tsx
  const cajonAbierto = drawerId === "results";
  const detailInset = drawerId === null ? 0 : DRAWER_W;
  const railInset = railMostrado ? RAIL_W : 0;
  const inset = detailInset + railInset;
```

- [ ] **Step 3: Montar `AttemptsRail` junto a `ResultsDrawer`, con la firma nueva**

El bloque (líneas 322-329 hoy):

```tsx
          <DrawerTab shifted={drawerId !== null} open={drawerId === "results"}
            onClick={() => setDrawer(drawerId === "results" ? null : "results")} />
          <ResultsDrawer open={drawerId === "results"} image={image} analyses={mine}
            selected={shown?.id ?? null} busy={busy}
            onSelect={setSelAnalysis}
            onAnalyze={() => (sel !== null ? setStaged([sel]) : void pick())}
            onCenter={(lat, lng) => setFly({ lat, lng, zoom: 14 })}
            onMenu={setMenu} />
```

pasa a:

```tsx
          <DrawerTab shifted={drawerId !== null} open={drawerId === "results"}
            onClick={() => setDrawer(drawerId === "results" ? null : "results")} />
          {mine.length > 1 && (
            <button
              onClick={() => setRailOpen(!railMostrado)}
              title={railMostrado ? "Ocultar intentos" : "Ver intentos"}
              style={{ right: detailInset }}
              className="absolute top-[calc(50%+72px)] z-[23] grid h-[40px] w-[15px] -translate-y-1/2
                place-items-center rounded-l-lg border border-r-0 border-border
                bg-[rgba(16,18,21,.92)] text-subtle transition-[right,color,background-color]
                duration-[420ms] ease-expo hover:bg-white/[.05] hover:text-fg">
              <Icon name="layers" size={9} />
            </button>
          )}
          <AttemptsRail open={railMostrado} shiftedBy={detailInset} analyses={mine}
            selected={shown?.id ?? null} onSelect={setSelAnalysis}
            onAnalyze={() => (sel !== null ? setStaged([sel]) : void pick())}
            onMenu={setMenu} />
          <ResultsDrawer open={drawerId === "results"} image={image} analysis={shown}
            busy={busy}
            onAnalyze={() => (sel !== null ? setStaged([sel]) : void pick())}
            onCenter={(lat, lng) => setFly({ lat, lng, zoom: 14 })} />
```

Esto necesita `Icon` importado en `CaseView.tsx` — si no lo está ya, añade `import { Icon } from "../ui/Icon";` junto a los demás imports del principio del fichero.

- [ ] **Step 4: Verificar que compila**

Run: `cd "E:\Lumi Station\client" && npx tsc -b`
Expected: sin errores.

- [ ] **Step 5: Verificar en la app real**

Run: `cd "E:\Lumi Station\client" && npm run tauri build` (o `python tools/build.py` desde la raíz del repo, que levanta cliente + daemon juntos)

Abre un caso con una imagen que tenga 2+ análisis (los de la sesión de hoy con Casa Botines valen). Confirma a ojo:
- El carril de intentos se abre solo, sin lista alguna dentro del cajón de detalle.
- El cajón de detalle mide más ancho que antes y muestra coordenada grande, radio/confianza como par, la insignia de verificación en blanco (nunca verde) cuando hay `result_verificador`.
- Cada agente es su propia tarjeta con un icono reconocible; el que se abstiene se ve apagado, no desaparece.
- Cerrar el carril con el botón nuevo y volver a abrirlo funciona independientemente del cajón de detalle.

- [ ] **Step 6: Commit**

```bash
cd "E:\Lumi Station"
git add client/src/work/CaseView.tsx
git commit -m "feat(client): monta AttemptsRail junto al cajon de detalle rediseñado en CaseView"
```

---

## Self-Review

**Cobertura del spec:**
- Carril de intentos, auto-abre/cierra + control manual → Task 4 Step 1.
- Cajón ensanchado a 360px → Task 3 Step 1.
- Cabecera, resultado principal con estadísticas, insignia en blanco → Task 3 Step 2.
- Agentes en tarjetas con icono propio, hora-sombras con aguja real, abstenido apagado → Task 1 + Task 3 Step 2.
- EXIF al final → Task 3 Step 2 (sin cambios de esa sección, ya estaba bien).
- Comparador de fotos → explícitamente Fase 2, fuera de este plan (coincide con el spec).

**Placeholder scan:** sin TBD, sin "añadir manejo de errores" genérico — cada paso trae el código completo.

**Consistencia de tipos:** `AttemptsRail` usa `Analysis`/`MenuEntry`/`MenuState` tal cual los exporta `client/src/lib/api.ts`/`client/src/ui/ContextMenu.tsx` hoy, sin inventar campos. `ResultsDrawer` nueva firma (`analysis: Analysis | null` en vez de `analyses`+`selected`) se refleja igual en el único llamador (`CaseView.tsx`, Task 4) — no hay un segundo sitio que lo monte.
