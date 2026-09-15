# Editor de imagen pre-subida — rediseño — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rehacer `client/src/work/ImageEditorPopup.tsx` (barra de herramientas horizontal,
recorte con rejilla/proporciones/manejadores mejorados, rotar/voltear, zoom, brillo/contraste)
y extender el reescalado de IA para aceptar una resolución objetivo (1×/2×/4×) con una rejilla
visual de "trabajando" en vez de la barra de progreso falsa que no existe hoy.

**Architecture:** El editor sigue siendo un único componente de React sobre un `<canvas>` de
trabajo + un `<canvas>` overlay para dibujar controles, exactamente como hoy — se añaden
estados y ramas de herramienta nuevas, no una reestructuración del patrón. El reescalado añade
una columna nueva (`upscale_factor`) a `analyses` para que el factor pedido sobreviva desde la
petición HTTP hasta que la cola lo recoge de forma asíncrona, y ese mismo factor viaja hasta
`workers/lumi_upscale.py`, que reescala el resultado nativo ×4 del modelo hacia abajo cuando
se pidió menos.

**Tech Stack:** React + TypeScript + Tailwind (cliente), Rust/axum/rusqlite (`lumid`), Python +
Pillow (`workers/lumi_upscale.py`).

## Global Constraints

- No se toca el flujo Omitir / Usar esta versión / Mejorar calidad más allá de lo que cada
  tarea pide explícitamente — ver spec, sección "Qué no cambia".
- Nada de barras de progreso o porcentajes inventados: el reescalado sigue siendo una sola
  llamada sin progreso incremental real (`workers/lumi_upscale.py`), así que su indicador
  visual comunica "trabajando", nunca una medida.
- Este repo no tiene test runner de frontend; el ciclo de verificación de cada tarea de cliente
  es `cd client && npm run build` + `npx oxlint <ficheros tocados>`. Las tareas de Rust usan
  `cargo build -p lumid` (+ `cargo test -p lumid` cuando la tarea toca `queue/plan.rs`-like
  lógica pura, que aquí no aplica). Python no tiene test runner en este repo; se verifica
  leyendo el resultado a mano si hace falta, o confiando en que el tipo de dato es correcto —
  no se añade un test runner nuevo por esto.
- Español para nombres de funciones/estado/comentarios y copy de UI, igual que el resto del
  repo.
- Reutilizar iconos ya existentes en `client/src/ui/Icon.tsx` (`crop`, `blur`, `undo`, `redo`,
  `sparkle`) cuando encajen; solo se añade un icono nuevo si de verdad no hay uno que sirva
  (ver Task 3, "girar" no tiene equivalente hoy).

---

### Task 1: Barra de herramientas horizontal con iconos + zona contextual

**Files:**
- Modify: `client/src/work/ImageEditorPopup.tsx`

**Interfaces:**
- Consumes: nada nuevo — reorganiza el `herramienta`/`radio`/`deshacer`/`rehacer` que ya existen.
- Produces: el tipo `Herramienta` pasa a `"recorte" | "girar" | "blur" | "tono"` (los dos nuevos
  se implementan en las Tasks 3 y 5, pero el tipo se amplía aquí de una vez para no volver a
  tocar cada `switch`/render condicional en cada tarea siguiente). Un contenedor `<div>` con
  `data-contextual` justo debajo de la barra de iconos y encima del lienzo, donde cada tarea
  siguiente añade el contenido de su propia herramienta.

- [ ] **Step 1: Añadir el icono "girar" a `Icon.tsx`**

No hay un icono de "rotar" en el catálogo — el resto (`crop`, `blur`, `undo`, `redo`, `sparkle`)
ya existen y se reutilizan tal cual. Añade esta entrada al objeto `PATHS` en
`client/src/ui/Icon.tsx`, junto a las demás (por ejemplo, justo después de `undo`/`redo`):

```tsx
  girar: <><path d="M3 12a9 9 0 1 1 3 6.7" /><path d="M3 12v5h5" /></>,
```

- [ ] **Step 2: Reescribir la barra de herramientas y añadir la zona contextual**

En `client/src/work/ImageEditorPopup.tsx`, cambia la línea del tipo:

```tsx
type Herramienta = "recorte" | "blur";
```
por:
```tsx
type Herramienta = "recorte" | "girar" | "blur" | "tono";
```

Sustituye el bloque completo que va desde `<div className="mt-4 flex items-center gap-2">`
hasta el cierre de ese mismo `<div>` (justo antes de `<div ref={contenedorRef}...`) por:

```tsx
                <div className="mt-4 flex items-center gap-1">
                  {([
                    ["recorte", "crop", "Recortar"],
                    ["girar", "girar", "Girar y voltear"],
                    ["blur", "blur", "Difuminar"],
                    ["tono", "sparkle", "Brillo y contraste"],
                  ] as const).map(([id, icono, titulo], i) => (
                    <>
                      {i === 2 && <div key="sep" className="mx-1 h-5 w-px bg-border" />}
                      <button key={id} onClick={() => setHerramienta(id)} disabled={bloqueado} title={titulo}
                        className={`jg-press grid h-8 w-8 place-items-center rounded-lg border
                          ${herramienta === id ? "border-fg bg-white/[.06] text-fg" : "border-transparent text-subtle hover:text-fg"}`}>
                        <Icon name={icono} size={14} />
                      </button>
                    </>
                  ))}
                  <div className="ml-auto flex items-center gap-1">
                    <button onClick={deshacer} disabled={!puedeDeshacer || bloqueado} title="Deshacer"
                      className="jg-press rounded-md p-1.5 text-subtle hover:text-fg disabled:opacity-30">
                      <Icon name="undo" size={14} />
                    </button>
                    <button onClick={rehacer} disabled={!puedeRehacer || bloqueado} title="Rehacer"
                      className="jg-press rounded-md p-1.5 text-subtle hover:text-fg disabled:opacity-30">
                      <Icon name="redo" size={14} />
                    </button>
                  </div>
                </div>

                <div className="mt-2 flex min-h-[26px] items-center gap-2">
                  {herramienta === "blur" && (
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-subtle">radio</span>
                      <input type="range" min={6} max={80} value={radio}
                        onChange={(e) => setRadio(e.target.valueAsNumber)}
                        className="w-24 accent-fg" />
                    </div>
                  )}
                </div>
```

Esto quita el `<button>` de texto con icono+etiqueta de antes y el bloque `{herramienta === "blur" && (...)}` que vivía dentro de la barra principal — el radio del blur se muda a la zona contextual nueva, que hoy solo tiene contenido para "blur" (las Tasks 2/3/5 añaden el resto ahí mismo).

- [ ] **Step 3: Comprobar que compila**

Run: `cd client && npm run build`
Expected: sin errores.

- [ ] **Step 4: Lint**

Run: `cd client && npx oxlint src/work/ImageEditorPopup.tsx src/ui/Icon.tsx`
Expected: sin warnings nuevos.

- [ ] **Step 5: Commit**

```bash
git add client/src/work/ImageEditorPopup.tsx client/src/ui/Icon.tsx
git commit -m "feat(editor): barra de herramientas en iconos + zona contextual

Los dos botones de texto (Recorte/Blur) pasan a cuatro iconos (Recortar,
Girar, Difuminar, Tono) con una zona contextual debajo dedicada a los
controles de la herramienta activa -- feedback del owner (\"se siente
básico y cutre\"). Girar y Tono se implementan en tareas siguientes; hoy
solo cambian de estado sin dibujar nada todavía, que es el mismo
comportamiento neutro que ya tenían herramientas sin overlay propio.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: Recorte — rejilla de tercios, proporciones, medidas y manejadores mejorados

**Files:**
- Modify: `client/src/work/ImageEditorPopup.tsx` (de la Task 1)

**Interfaces:**
- Consumes: `Caja`, `caja`/`setCaja`, `dibujarOverlay`, `esquinaEn`, `onPointerDown`/`onPointerMove`,
  el contenedor `data-contextual` de la Task 1.
- Produces: estado `aspecto: number | null` (proporción bloqueada, `null` = Libre) que las
  Tasks siguientes no necesitan pero que queda disponible si hiciera falta.

- [ ] **Step 1: Añadir el estado de proporción y la función que la aplica**

Justo debajo de `const [caja, setCaja] = useState<Caja | null>(null);`, añade:

```tsx
  // `null` = recorte libre (el de siempre). Un número fija ancho/alto -- las
  // esquinas dejan de deformar la caja y la mantienen a esa proporción; los
  // manejadores de borde (un solo eje) se ocultan mientras hay una fijada,
  // porque estirar un solo lado rompería la proporción que se acaba de pedir.
  const [aspecto, setAspecto] = useState<number | null>(null);

  function aplicarProporcion(r: number | null) {
    setAspecto(r);
    const canvas = canvasRef.current;
    if (r === null || !caja || !canvas) return;
    let w = caja.w;
    let h = w / r;
    if (h > canvas.height) { h = canvas.height; w = h * r; }
    if (w > canvas.width) { w = canvas.width; h = w / r; }
    const cx = caja.x + caja.w / 2;
    const cy = caja.y + caja.h / 2;
    const x = Math.max(0, Math.min(canvas.width - w, cx - w / 2));
    const y = Math.max(0, Math.min(canvas.height - h, cy - h / 2));
    setCaja({ x, y, w, h });
  }
```

- [ ] **Step 2: Ampliar `arrastreRef` con el ancla para el arrastre de esquina con proporción fija**

Cambia:
```tsx
  const arrastreRef = useRef<
    | { modo: "mover"; ox: number; oy: number }
    | { modo: "esquina"; esquina: "nw" | "ne" | "sw" | "se" }
    | { modo: "pintar" }
    | null
  >(null);
```
por:
```tsx
  const arrastreRef = useRef<
    | { modo: "mover"; ox: number; oy: number }
    | { modo: "esquina"; esquina: "nw" | "ne" | "sw" | "se"; anclaX: number; anclaY: number }
    | { modo: "borde"; borde: "n" | "s" | "e" | "w" }
    | { modo: "pintar" }
    | null
  >(null);
```

- [ ] **Step 3: Ampliar `esquinaEn` para detectar también los manejadores de borde**

Sustituye la función `esquinaEn` entera por:

```tsx
  function esquinaEn(p: { x: number; y: number }, c: Caja): "nw" | "ne" | "sw" | "se" | null {
    const esc = escalaRef.current || 1;
    const tol = TAM_ESQUINA / esc;
    const esquinas: [("nw" | "ne" | "sw" | "se"), number, number][] = [
      ["nw", c.x, c.y], ["ne", c.x + c.w, c.y], ["sw", c.x, c.y + c.h], ["se", c.x + c.w, c.y + c.h],
    ];
    for (const [nombre, ex, ey] of esquinas) {
      if (Math.abs(p.x - ex) < tol && Math.abs(p.y - ey) < tol) return nombre;
    }
    return null;
  }

  // Los manejadores de borde solo existen en recorte libre: estirar un solo
  // lado con una proporción fijada rompería justo lo que se acaba de pedir.
  function bordeEn(p: { x: number; y: number }, c: Caja): "n" | "s" | "e" | "w" | null {
    if (aspecto !== null) return null;
    const esc = escalaRef.current || 1;
    const tol = TAM_ESQUINA / esc;
    const bordes: [("n" | "s" | "e" | "w"), number, number][] = [
      ["n", c.x + c.w / 2, c.y], ["s", c.x + c.w / 2, c.y + c.h],
      ["w", c.x, c.y + c.h / 2], ["e", c.x + c.w, c.y + c.h / 2],
    ];
    for (const [nombre, ex, ey] of bordes) {
      if (Math.abs(p.x - ex) < tol && Math.abs(p.y - ey) < tol) return nombre;
    }
    return null;
  }
```

- [ ] **Step 4: Actualizar `onPointerDown` para reconocer esquina-con-ancla y borde**

Sustituye el cuerpo de `onPointerDown` desde `if (!caja) return;` hasta el final de la función
por:

```tsx
    if (!caja) return;
    const esquina = esquinaEn(p, caja);
    if (esquina) {
      const opuesta: Record<typeof esquina, [number, number]> = {
        nw: [caja.x + caja.w, caja.y + caja.h], ne: [caja.x, caja.y + caja.h],
        sw: [caja.x + caja.w, caja.y], se: [caja.x, caja.y],
      };
      const [anclaX, anclaY] = opuesta[esquina];
      arrastreRef.current = { modo: "esquina", esquina, anclaX, anclaY };
      return;
    }
    const borde = bordeEn(p, caja);
    if (borde) {
      arrastreRef.current = { modo: "borde", borde };
      return;
    }
    if (p.x >= caja.x && p.x <= caja.x + caja.w && p.y >= caja.y && p.y <= caja.y + caja.h) {
      arrastreRef.current = { modo: "mover", ox: p.x - caja.x, oy: p.y - caja.y };
    }
```

- [ ] **Step 5: Actualizar `onPointerMove` para las esquinas con proporción fija y los bordes**

Sustituye el bloque `if (!caja || !canvas) return;` ... hasta el final de la función (el `else`
que manejaba `a.modo === "esquina"`) por:

```tsx
    if (!caja || !canvas) return;
    if (a.modo === "mover") {
      const x = Math.max(0, Math.min(canvas.width - caja.w, p.x - a.ox));
      const y = Math.max(0, Math.min(canvas.height - caja.h, p.y - a.oy));
      setCaja({ ...caja, x, y });
      return;
    }
    if (a.modo === "borde") {
      let { x, y, w, h } = caja;
      const x2 = x + w, y2 = y + h;
      if (a.borde === "n") { y = Math.min(p.y, y2 - 10); h = y2 - y; }
      if (a.borde === "s") { h = Math.max(10, p.y - y); }
      if (a.borde === "w") { x = Math.min(p.x, x2 - 10); w = x2 - x; }
      if (a.borde === "e") { w = Math.max(10, p.x - x); }
      x = Math.max(0, x); y = Math.max(0, y);
      w = Math.min(w, canvas.width - x); h = Math.min(h, canvas.height - y);
      setCaja({ x, y, w, h });
      return;
    }
    // a.modo === "esquina"
    if (aspecto !== null) {
      const dx = p.x - a.anclaX;
      const dy = p.y - a.anclaY;
      let w = Math.max(10, Math.abs(dx));
      let h = w / aspecto;
      if (Math.abs(dy) / (h || 1) > Math.abs(dx) / (w || 1)) {
        h = Math.max(10, Math.abs(dy));
        w = h * aspecto;
      }
      let x = dx >= 0 ? a.anclaX : a.anclaX - w;
      let y = dy >= 0 ? a.anclaY : a.anclaY - h;
      x = Math.max(0, Math.min(canvas.width - w, x));
      y = Math.max(0, Math.min(canvas.height - h, y));
      w = Math.min(w, canvas.width - x); h = Math.min(h, canvas.height - y);
      setCaja({ x, y, w, h });
      return;
    }
    let { x, y, w, h } = caja;
    const x2 = x + w, y2 = y + h;
    if (a.esquina === "nw") { x = Math.min(p.x, x2 - 10); y = Math.min(p.y, y2 - 10); w = x2 - x; h = y2 - y; }
    if (a.esquina === "ne") { y = Math.min(p.y, y2 - 10); w = Math.max(10, p.x - x); h = y2 - y; }
    if (a.esquina === "sw") { x = Math.min(p.x, x2 - 10); w = x2 - x; h = Math.max(10, p.y - y); }
    if (a.esquina === "se") { w = Math.max(10, p.x - x); h = Math.max(10, p.y - y); }
    x = Math.max(0, x); y = Math.max(0, y);
    w = Math.min(w, canvas.width - x); h = Math.min(h, canvas.height - y);
    setCaja({ x, y, w, h });
```

- [ ] **Step 6: Rejilla de tercios y manejadores más grandes con halo al agarrar**

En `dibujarOverlay`, sustituye el bloque `if (herramienta === "recorte" && caja) { ... }` por:

```tsx
    if (herramienta === "recorte" && caja) {
      const esc = escalaRef.current || 1;
      ctx.fillStyle = "rgba(0,0,0,.55)";
      ctx.fillRect(0, 0, overlay.width, overlay.height);
      ctx.clearRect(caja.x, caja.y, caja.w, caja.h);
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 2 / esc;
      ctx.strokeRect(caja.x, caja.y, caja.w, caja.h);

      // Rejilla de tercios: ayuda de composición estándar, siempre visible
      // mientras se recorta.
      ctx.strokeStyle = "rgba(255,255,255,.35)";
      ctx.lineWidth = 1 / esc;
      for (const f of [1 / 3, 2 / 3]) {
        ctx.beginPath();
        ctx.moveTo(caja.x + caja.w * f, caja.y);
        ctx.lineTo(caja.x + caja.w * f, caja.y + caja.h);
        ctx.moveTo(caja.x, caja.y + caja.h * f);
        ctx.lineTo(caja.x + caja.w, caja.y + caja.h * f);
        ctx.stroke();
      }

      // Manejadores de esquina: cuadrados de 14px de pantalla (antes puntos
      // de 5px), con halo cuando se está arrastrando justo ese -- "cogido"
      // de verdad, no solo un cursor que cambia.
      const lado = 14 / esc;
      const agarrando = arrastreRef.current?.modo === "esquina" ? arrastreRef.current.esquina : null;
      const esquinas: [string, number, number][] = [
        ["nw", caja.x, caja.y], ["ne", caja.x + caja.w, caja.y],
        ["sw", caja.x, caja.y + caja.h], ["se", caja.x + caja.w, caja.y + caja.h],
      ];
      for (const [nombre, ex, ey] of esquinas) {
        const activa = nombre === agarrando;
        const l = activa ? lado * 1.15 : lado;
        if (activa) {
          ctx.fillStyle = "rgba(255,255,255,.18)";
          ctx.beginPath();
          ctx.arc(ex, ey, l, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillStyle = "#fff";
        ctx.fillRect(ex - l / 2, ey - l / 2, l, l);
      }

      // Manejadores de borde (un eje), solo en recorte libre.
      if (aspecto === null) {
        const anchoBorde = 14 / esc, altoBorde = 8 / esc;
        const bordes: [number, number, number, number][] = [
          [caja.x + caja.w / 2, caja.y, anchoBorde, altoBorde],
          [caja.x + caja.w / 2, caja.y + caja.h, anchoBorde, altoBorde],
          [caja.x, caja.y + caja.h / 2, altoBorde, anchoBorde],
          [caja.x + caja.w, caja.y + caja.h / 2, altoBorde, anchoBorde],
        ];
        ctx.fillStyle = "rgba(255,255,255,.85)";
        for (const [ex, ey, w, h] of bordes) {
          ctx.fillRect(ex - w / 2, ey - h / 2, w, h);
        }
      }
    } else if (herramienta === "blur" && cursor) {
```

(La rama `else if (herramienta === "blur" && cursor) { ... }` que sigue no cambia — se deja tal
cual estaba, solo se sustituye el `if` de recorte de arriba.)

- [ ] **Step 7: Barra contextual de Recorte — proporciones y medidas en vivo**

En el bloque de la zona contextual añadido en la Task 1
(`<div className="mt-2 flex min-h-[26px] items-center gap-2">`), añade ANTES del
`{herramienta === "blur" && (...)}` que ya existe:

```tsx
                  {herramienta === "recorte" && (
                    <div className="flex w-full items-center gap-1.5">
                      {([["Libre", null], ["1:1", 1], ["4:3", 4 / 3], ["16:9", 16 / 9]] as const).map(([etq, r]) => (
                        <button key={etq} onClick={() => aplicarProporcion(r)}
                          className={`jg-press rounded-md border px-2 py-1 text-[10px]
                            ${aspecto === r ? "border-fg text-fg" : "border-border text-subtle"}`}>
                          {etq}
                        </button>
                      ))}
                      {caja && (
                        <span className="ml-auto font-mono text-[10px] text-subtle">
                          {Math.round(caja.w)} × {Math.round(caja.h)} px
                        </span>
                      )}
                    </div>
                  )}
```

- [ ] **Step 8: Comprobar que compila**

Run: `cd client && npm run build`
Expected: sin errores. Presta atención a que el `Record<typeof esquina, ...>` del Step 4
infiera bien el tipo literal de `esquina` (viene de `esquinaEn`, que ya devuelve la unión
`"nw"|"ne"|"sw"|"se"`).

- [ ] **Step 9: Lint**

Run: `cd client && npx oxlint src/work/ImageEditorPopup.tsx`
Expected: sin warnings nuevos.

- [ ] **Step 10: Commit**

```bash
git add client/src/work/ImageEditorPopup.tsx
git commit -m "feat(editor): rejilla de tercios, proporciones y mejor agarre en el recorte

Manejadores de esquina más grandes (14px, antes 5px) con halo al
arrastrar, manejadores nuevos en el punto medio de cada lado para
reescalar en un solo eje (solo en recorte libre), botones de proporción
Libre/1:1/4:3/16:9 que bloquean el aspecto al arrastrar una esquina, y
medidas en vivo junto a ellos.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: Rotar y voltear

**Files:**
- Modify: `client/src/work/ImageEditorPopup.tsx` (de la Task 2)

**Interfaces:**
- Consumes: `canvasRef`, `snapshot()`, `ajustarOverlay()`, `bloqueado`, el icono `girar` de la
  Task 1.
- Produces: nada que otra tarea necesite.

- [ ] **Step 1: Añadir las funciones de rotar y voltear**

Justo después de la función `aplicarRecorte`, añade:

```tsx
  // Rotar intercambia ancho/alto del lienzo -- por eso hace falta un canvas
  // temporal del tamaño ya girado, igual que ya hace `aplicarRecorte`.
  function rotar90() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const nuevo = document.createElement("canvas");
    nuevo.width = canvas.height;
    nuevo.height = canvas.width;
    const ctx = nuevo.getContext("2d");
    if (!ctx) return;
    ctx.translate(nuevo.width / 2, nuevo.height / 2);
    ctx.rotate(Math.PI / 2);
    ctx.drawImage(canvas, -canvas.width / 2, -canvas.height / 2);
    canvas.width = nuevo.width;
    canvas.height = nuevo.height;
    canvas.getContext("2d")?.drawImage(nuevo, 0, 0);
    ajustarOverlay();
    setCaja(null);
    snapshot();
  }

  function voltear(eje: "h" | "v") {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const nuevo = document.createElement("canvas");
    nuevo.width = canvas.width;
    nuevo.height = canvas.height;
    const ctx = nuevo.getContext("2d");
    if (!ctx) return;
    if (eje === "h") { ctx.translate(canvas.width, 0); ctx.scale(-1, 1); }
    else { ctx.translate(0, canvas.height); ctx.scale(1, -1); }
    ctx.drawImage(canvas, 0, 0);
    canvas.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
    canvas.getContext("2d")?.drawImage(nuevo, 0, 0);
    snapshot();
  }
```

- [ ] **Step 2: Barra contextual de Girar**

En la zona contextual (junto a los otros `{herramienta === "..." && (...)}`), añade:

```tsx
                  {herramienta === "girar" && (
                    <div className="flex items-center gap-1.5">
                      <button onClick={rotar90} disabled={bloqueado}
                        className="jg-press flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-[10.5px] text-fg">
                        <Icon name="girar" size={12} /> Rotar 90°
                      </button>
                      <button onClick={() => voltear("h")} disabled={bloqueado}
                        className="jg-press rounded-md border border-border px-2.5 py-1 text-[10.5px] text-fg">
                        Voltear horizontal
                      </button>
                      <button onClick={() => voltear("v")} disabled={bloqueado}
                        className="jg-press rounded-md border border-border px-2.5 py-1 text-[10.5px] text-fg">
                        Voltear vertical
                      </button>
                    </div>
                  )}
```

- [ ] **Step 3: Comprobar que compila**

Run: `cd client && npm run build`
Expected: sin errores.

- [ ] **Step 4: Lint**

Run: `cd client && npx oxlint src/work/ImageEditorPopup.tsx`
Expected: sin warnings nuevos.

- [ ] **Step 5: Commit**

```bash
git add client/src/work/ImageEditorPopup.tsx
git commit -m "feat(editor): rotar 90° y voltear horizontal/vertical

Cada acción genera su propio paso en el historial de deshacer/rehacer,
mismo mecanismo que ya usan recorte y blur.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: Zoom sobre el lienzo

**Files:**
- Modify: `client/src/work/ImageEditorPopup.tsx` (de la Task 3)

**Interfaces:**
- Consumes: `ajustarOverlay`, `escalaRef`, `contenedorRef`.
- Produces: nada que otra tarea necesite -- el zoom es puramente de presentación, la
  conversión pantalla→canvas (`puntoCanvas`) ya usa `escalaRef.current`, así que sigue
  funcionando sin cambios en cuanto `escalaRef` incluye el factor de zoom.

- [ ] **Step 1: Añadir el estado de zoom**

Junto a `const [radio, setRadio] = useState(24);`, añade:

```tsx
  // 1 = ajuste automático de siempre (`ajustarOverlay`). El contenedor se
  // vuelve desplazable (`overflow-auto` más abajo) en vez de llevar un pan a
  // mano: el scroll nativo del navegador ya resuelve mover la vista por una
  // imagen más grande que el hueco, sin estado ni gestos propios que
  // mantener.
  const [zoom, setZoom] = useState(1);
```

- [ ] **Step 2: Incorporar el zoom al cálculo de escala**

En `ajustarOverlay`, sustituye:
```tsx
    const escala = Math.min(MAX_W / canvas.width, MAX_H / canvas.height, 1);
    escalaRef.current = escala;
```
por:
```tsx
    const base = Math.min(MAX_W / canvas.width, MAX_H / canvas.height, 1);
    const escala = base * zoomRef.current;
    escalaRef.current = escala;
```

Y define `zoomRef` justo debajo de `escalaRef` (una `ref` además del estado, para que
`ajustarOverlay` -- que no es un componente y no re-renderiza solo por leer estado -- vea
siempre el valor actual sin tener que estar en las dependencias de todos los sitios que ya la
llaman):

```tsx
  const zoomRef = useRef(1);
```

Y sincroniza la ref cuando cambie el estado, y vuelve a ajustar el overlay para que el zoom
nuevo se aplique al momento. Añade este efecto junto a los demás `useEffect`:

```tsx
  useEffect(() => {
    zoomRef.current = zoom;
    ajustarOverlay();
    dibujarOverlay();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom]);
```

- [ ] **Step 3: Controles de zoom y contenedor desplazable**

Añade los botones de zoom junto a deshacer/rehacer, en el `<div className="ml-auto ...">` de
la barra de iconos (Task 1). Sustituye ese `<div>` por:

```tsx
                  <div className="ml-auto flex items-center gap-1">
                    <button onClick={() => setZoom((z) => Math.max(1, +(z - 0.5).toFixed(1)))}
                      disabled={bloqueado || zoom <= 1} title="Alejar"
                      className="jg-press rounded-md p-1.5 text-subtle hover:text-fg disabled:opacity-30">
                      −
                    </button>
                    <span className="w-8 text-center font-mono text-[10px] text-subtle">{zoom.toFixed(1)}×</span>
                    <button onClick={() => setZoom((z) => Math.min(4, +(z + 0.5).toFixed(1)))}
                      disabled={bloqueado || zoom >= 4} title="Acercar"
                      className="jg-press rounded-md p-1.5 text-subtle hover:text-fg disabled:opacity-30">
                      +
                    </button>
                    <div className="mx-1 h-5 w-px bg-border" />
                    <button onClick={deshacer} disabled={!puedeDeshacer || bloqueado} title="Deshacer"
                      className="jg-press rounded-md p-1.5 text-subtle hover:text-fg disabled:opacity-30">
                      <Icon name="undo" size={14} />
                    </button>
                    <button onClick={rehacer} disabled={!puedeRehacer || bloqueado} title="Rehacer"
                      className="jg-press rounded-md p-1.5 text-subtle hover:text-fg disabled:opacity-30">
                      <Icon name="redo" size={14} />
                    </button>
                  </div>
```

Y añade `overflow-auto` al contenedor del lienzo para que el scroll nativo pueda moverse por
una imagen ampliada más grande que el hueco visible:

```tsx
                <div ref={contenedorRef} className="mt-3 flex items-center justify-center overflow-auto rounded-xl border
                  border-border bg-black/30 p-2" style={{ minHeight: 300, maxHeight: 420 }}>
```

(sustituye la línea `<div ref={contenedorRef} className="mt-3 flex items-center justify-center rounded-xl border
                  border-border bg-black/30 p-2" style={{ minHeight: 300 }}>` existente por la de arriba)

- [ ] **Step 4: Comprobar que compila**

Run: `cd client && npm run build`
Expected: sin errores.

- [ ] **Step 5: Lint**

Run: `cd client && npx oxlint src/work/ImageEditorPopup.tsx`
Expected: sin warnings nuevos.

- [ ] **Step 6: Commit**

```bash
git add client/src/work/ImageEditorPopup.tsx
git commit -m "feat(editor): zoom sobre el lienzo

1x a 4x, con el contenedor ya desplazable (overflow-auto) en vez de un pan
a mano -- el scroll nativo resuelve moverse por una imagen ampliada más
grande que el hueco visible. El recorte y el blur siguen funcionando en
coordenadas reales del lienzo sin cambios: puntoCanvas ya dividía por
escalaRef, que ahora simplemente incluye el factor de zoom.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 5: Brillo y contraste

**Files:**
- Modify: `client/src/work/ImageEditorPopup.tsx` (de la Task 4)

**Interfaces:**
- Consumes: `canvasRef`, `snapshot`.
- Produces: nada que otra tarea necesite.

- [ ] **Step 1: Estado de los sliders**

Junto a `const [radio, setRadio] = useState(24);`, añade:

```tsx
  // Vista previa en directo vía CSS `filter` sobre el propio <canvas> (no
  // toca los píxeles todavía); "Aplicar tono" es lo que de verdad redibuja
  // el lienzo y genera el snapshot -- mismo criterio que "Aplicar recorte":
  // los sliders son una previsualización, no un compromiso.
  const [brillo, setBrillo] = useState(100);
  const [contraste, setContraste] = useState(100);
```

- [ ] **Step 2: Aplicar el filtro en vivo al `<canvas>` visible**

En el JSX del `<canvas ref={canvasRef} .../>`, añade un `style` con el filtro cuando la
herramienta "tono" está activa:

```tsx
                    <canvas ref={canvasRef} className="rounded-md"
                      style={herramienta === "tono" ? { filter: `brightness(${brillo}%) contrast(${contraste}%)` } : undefined} />
```

(sustituye la línea `<canvas ref={canvasRef} className="rounded-md" />` existente)

- [ ] **Step 3: Función que graba el tono en los píxeles**

Añade, junto a `aplicarRecorte`/`rotar90`/`voltear`:

```tsx
  // Redibuja el canvas con el filtro ya "horneado" en los píxeles -- igual
  // que el blur, que tampoco deja el filtro puesto sobre el elemento, lo
  // aplica y lo suelta.
  function aplicarTono() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const nuevo = document.createElement("canvas");
    nuevo.width = canvas.width;
    nuevo.height = canvas.height;
    const ctx = nuevo.getContext("2d");
    if (!ctx) return;
    ctx.filter = `brightness(${brillo}%) contrast(${contraste}%)`;
    ctx.drawImage(canvas, 0, 0);
    canvas.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
    canvas.style.filter = "";
    canvas.getContext("2d")?.drawImage(nuevo, 0, 0);
    setBrillo(100);
    setContraste(100);
    snapshot();
  }
```

- [ ] **Step 4: Barra contextual de Tono**

En la zona contextual, añade:

```tsx
                  {herramienta === "tono" && (
                    <div className="flex w-full items-center gap-3">
                      <span className="text-[10px] text-subtle">brillo</span>
                      <input type="range" min={40} max={160} value={brillo}
                        onChange={(e) => setBrillo(e.target.valueAsNumber)} className="w-20 accent-fg" />
                      <span className="text-[10px] text-subtle">contraste</span>
                      <input type="range" min={40} max={160} value={contraste}
                        onChange={(e) => setContraste(e.target.valueAsNumber)} className="w-20 accent-fg" />
                      <button onClick={aplicarTono} disabled={bloqueado}
                        className="jg-press ml-auto rounded-md border border-white/15 px-3 py-1 text-[10.5px] text-fg">
                        Aplicar tono
                      </button>
                    </div>
                  )}
```

- [ ] **Step 5: Comprobar que compila**

Run: `cd client && npm run build`
Expected: sin errores.

- [ ] **Step 6: Lint**

Run: `cd client && npx oxlint src/work/ImageEditorPopup.tsx`
Expected: sin warnings nuevos.

- [ ] **Step 7: Commit**

```bash
git add client/src/work/ImageEditorPopup.tsx
git commit -m "feat(editor): ajuste de brillo y contraste

Vista previa en vivo con CSS filter sobre el canvas; \"Aplicar tono\"
redibuja y hornea el resultado en los píxeles, mismo patrón que el blur.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 6: Backend — factor de reescalado hasta el trabajador Python

**Files:**
- Modify: `crates/lumid/src/store.rs`
- Modify: `crates/lumid/src/routes/images.rs`
- Modify: `crates/lumid/src/queue/mod.rs`
- Modify: `crates/lumid/src/upscale.rs`
- Modify: `workers/lumi_upscale.py`

**Interfaces:**
- Consumes: nada de las tareas de cliente (son independientes).
- Produces: la ruta `POST /v1/cases/:id/images/upscale?factor=1|2|4` (query param, por
  defecto 4 si se omite) — la Task 7 la consume desde el cliente.

- [ ] **Step 1: Columna nueva en `analyses`**

En `crates/lumid/src/store.rs`, en la lista de migraciones (`ALTER TABLE` por columna, busca el
array que contiene `("analyses", "imagen_sha256", "TEXT"),`), añade una entrada más al final de
ese array:

```rust
        // Resoluciones objetivo del reescalado de IA (spec 2026-09-15):
        // cuánto multiplicar el tamaño original. El modelo solo sabe
        // reescalar nativamente a x4 (`workers::lumi_upscale`); 1 y 2 se
        // consiguen reduciendo ESE resultado, nunca interpolando el
        // original. `NULL` en una fila que no es de tipo "upscale", o en
        // cualquier fila de antes de esta columna -- ahí se asume 4 (el
        // único comportamiento que existía).
        ("analyses", "upscale_factor", "INTEGER"),
```

- [ ] **Step 2: La ruta acepta `?factor=`**

En `crates/lumid/src/routes/images.rs`, cambia el import:
```rust
use axum::extract::{Multipart, Path, State};
```
por:
```rust
use axum::extract::{Multipart, Path, Query, State};
use serde::Deserialize;
```

Añade, cerca de la función `upscale` (antes de ella):

```rust
#[derive(Deserialize)]
pub struct UpscaleQuery {
    /// `1`, `2` o `4`. Cualquier otro valor (incluido "ausente") cae a 4,
    /// que es el único comportamiento que existía antes de esto.
    #[serde(default = "factor_por_defecto")]
    factor: i64,
}
fn factor_por_defecto() -> i64 { 4 }
```

Cambia la firma de `pub async fn upscale(` de:
```rust
pub async fn upscale(
    State(app): State<App>,
    Path(case_id): Path<i64>,
    headers: HeaderMap,
    mut mp: Multipart,
) -> Result<Json<lumi_proto::api::Analysis>, Fail> {
```
a:
```rust
pub async fn upscale(
    State(app): State<App>,
    Path(case_id): Path<i64>,
    Query(q): Query<UpscaleQuery>,
    headers: HeaderMap,
    mut mp: Multipart,
) -> Result<Json<lumi_proto::api::Analysis>, Fail> {
    let factor = match q.factor { 1 | 2 | 4 => q.factor, _ => 4 };
```

(la llave de apertura de la función ya existía; esta línea de `factor` se añade como primera
línea de su cuerpo, antes de `if app.store.get_meta(...)`)

Y en el `INSERT INTO analyses` de esa misma función, cambia:
```rust
        c.execute(
            "INSERT INTO analyses (case_id, requested_by, model, agente, state, created_at, via_api)
             VALUES (?1, ?2, 'upscale', NULL, 'pendiente', ?3, 0)",
            rusqlite::params![case_id, uid, t],
        )
```
por:
```rust
        c.execute(
            "INSERT INTO analyses (case_id, requested_by, model, agente, state, created_at, via_api, upscale_factor)
             VALUES (?1, ?2, 'upscale', NULL, 'pendiente', ?3, 0, ?4)",
            rusqlite::params![case_id, uid, t, factor],
        )
```

- [ ] **Step 3: La cola lee el factor y lo pasa a `correr_upscale`**

En `crates/lumid/src/queue/mod.rs`, dentro del bloque `if modelo == "upscale" { ... }` de
`repartir_ahora`, justo después de la línea:
```rust
                let (Some(imagen_id), Some(ruta)) =
                    (self.imagen_id_del_analisis(a.analysis_id), imagenes.first().cloned())
                else {
```
... dentro de ese mismo bloque `if modelo == "upscale"`, añade la lectura del factor justo
antes de `let ocupado = match self.estado.lock() {`:

```rust
                let factor: i64 = self
                    .store
                    .conn()
                    .query_row("SELECT upscale_factor FROM analyses WHERE id = ?1", [a.analysis_id], |r| r.get(0))
                    .unwrap_or(Some(4))
                    .unwrap_or(4);
```

Y cambia la llamada:
```rust
                tokio::spawn(async move {
                    cola.correr_upscale(dispositivo, a.analysis_id, imagen_id, ruta).await;
                });
```
por:
```rust
                tokio::spawn(async move {
                    cola.correr_upscale(dispositivo, a.analysis_id, imagen_id, ruta, factor).await;
                });
```

Y cambia la firma de `correr_upscale`:
```rust
    async fn correr_upscale(&self, dispositivo: String, id: i64, imagen_id: i64, ruta_entrada: String) {
```
por:
```rust
    async fn correr_upscale(&self, dispositivo: String, id: i64, imagen_id: i64, ruta_entrada: String, factor: i64) {
```

Y dentro de esa función, cambia la llamada:
```rust
        let resultado = crate::upscale::procesar(
            std::path::Path::new(&ruta_entrada), &salida, &python, &pesos, &dispositivo,
        )
        .await;
```
por:
```rust
        let resultado = crate::upscale::procesar(
            std::path::Path::new(&ruta_entrada), &salida, &python, &pesos, &dispositivo, factor,
        )
        .await;
```

- [ ] **Step 4: `upscale::procesar` manda el factor al trabajador**

En `crates/lumid/src/upscale.rs`, cambia la firma de `pub async fn procesar`:
```rust
pub async fn procesar(
    ruta_entrada: &Path,
    ruta_salida: &Path,
    python: &Path,
    pesos: &Path,
    dispositivo: &str,
) -> anyhow::Result<()> {
    let tarea = correr(ruta_entrada, ruta_salida, python, pesos, dispositivo);
```
por:
```rust
pub async fn procesar(
    ruta_entrada: &Path,
    ruta_salida: &Path,
    python: &Path,
    pesos: &Path,
    dispositivo: &str,
    factor: i64,
) -> anyhow::Result<()> {
    let tarea = correr(ruta_entrada, ruta_salida, python, pesos, dispositivo, factor);
```

Y la firma de `async fn correr`:
```rust
async fn correr(
    ruta_entrada: &Path, ruta_salida: &Path, python: &Path, pesos: &Path, dispositivo: &str,
) -> anyhow::Result<()> {
```
por:
```rust
async fn correr(
    ruta_entrada: &Path, ruta_salida: &Path, python: &Path, pesos: &Path, dispositivo: &str, factor: i64,
) -> anyhow::Result<()> {
```

Y en el JSON de la orden dentro de esa función:
```rust
    let orden = serde_json::json!({
        "tipo": "upscale",
        "id": 0,
        "ruta_entrada": ruta_entrada.display().to_string(),
        "ruta_salida": ruta_salida.display().to_string(),
    });
```
por:
```rust
    let orden = serde_json::json!({
        "tipo": "upscale",
        "id": 0,
        "ruta_entrada": ruta_entrada.display().to_string(),
        "ruta_salida": ruta_salida.display().to_string(),
        "factor": factor,
    });
```

- [ ] **Step 5: `lumi_upscale.py` reduce el resultado nativo ×4 cuando se pidió menos**

En `workers/lumi_upscale.py`, cambia la función `_procesar`:

```python
def _procesar(orden, disp):
    if _motores:
        import lumi_pesos
        for m in lumi_pesos.purgar_inactivos(_motores, _ultimo_uso):
            print("motor %s desalojado por inactividad" % m, file=sys.stderr)

    id_trabajo = orden["id"]
    motor = _motor(disp)
    if motor is None:
        escribir({"tipo": "fallo", "id": id_trabajo, "motivo": "el motor upscalador no está disponible en este servidor"})
        return
    try:
        motor.procesar(orden["ruta_entrada"], orden["ruta_salida"])
        _reducir_si_hace_falta(orden["ruta_salida"], orden.get("factor", 4))
    except Exception as e:
        escribir({"tipo": "fallo", "id": id_trabajo, "motivo": str(e)})
        return
    escribir({"tipo": "upscale", "id": id_trabajo, "ruta": orden["ruta_salida"]})


def _reducir_si_hace_falta(ruta_salida, factor):
    """El motor siempre reescala x4 de forma nativa -- pedir 1x o 2x reduce
    ESE resultado (nunca una interpolación del original), para partir
    siempre del detalle que reconstruyó la IA. Mismo filtro (Lanczos) que ya
    usa `lumi_verify.py` para sus reescalados."""
    if factor >= 4:
        return
    from PIL import Image
    img = Image.open(ruta_salida)
    nuevo = (round(img.width * factor / 4), round(img.height * factor / 4))
    img.resize(nuevo, Image.LANCZOS).save(ruta_salida)
```

- [ ] **Step 6: Comprobar que compila**

Run: `cd "E:\Lumi Station" && cargo build -p lumid`
Expected: sin errores nuevos (el warning preexistente de `PuntoCurva` en `hardware.rs` sigue
igual, no es de esta tarea).

- [ ] **Step 7: Comprobar el tipo de `_reducir_si_hace_falta` a mano**

`lumi_upscale.py` no tiene test runner en este repo. Verifica que el fichero es Python válido:

Run: `python -m py_compile workers/lumi_upscale.py`
Expected: sin salida (compila sin errores de sintaxis).

- [ ] **Step 8: Commit**

```bash
git add crates/lumid/src/store.rs crates/lumid/src/routes/images.rs crates/lumid/src/queue/mod.rs crates/lumid/src/upscale.rs workers/lumi_upscale.py
git commit -m "feat(upscale): resolución objetivo (1x/2x/4x) hasta el trabajador

El modelo reescala siempre a x4 de forma nativa; 1x y 2x reducen ESE
resultado con Lanczos en vez de interpolar el original, para seguir
partiendo del detalle que reconstruyó la IA. El factor viaja como query
param (?factor=), se guarda en analyses.upscale_factor (asíncrono: la cola
lo lee más tarde, no en la misma petición) y llega hasta
lumi_upscale.py por el mismo canal JSON que ya usa ruta_entrada/ruta_salida.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 7: Cliente — selector de resolución y rejilla de "trabajando"

**Files:**
- Modify: `client/src-tauri/src/main.rs`
- Modify: `client/src/lib/bridge.ts`
- Modify: `client/src/work/ImageEditorPopup.tsx` (de la Task 5)
- Modify: `client/src/work/CaseView.tsx:172-174` (`mejorarCalidad`, el `onUpscale` que recibe `ImageEditorPopup`)

**Interfaces:**
- Consumes: la ruta `?factor=` de la Task 6.
- Produces: nada que otra tarea necesite.

- [ ] **Step 1: El comando Tauri acepta el factor**

En `client/src-tauri/src/main.rs`, cambia:
```rust
async fn upscale_image_bytes(
    case_id: i64, data_base64: String, file_name: String, state: tauri::State<'_, Shared>,
) -> Result<String, String> {
    subir_bytes_imagen(&format!("/v1/cases/{case_id}/images/upscale"), &data_base64, &file_name, &state).await
}
```
por:
```rust
async fn upscale_image_bytes(
    case_id: i64, data_base64: String, file_name: String, factor: i64, state: tauri::State<'_, Shared>,
) -> Result<String, String> {
    subir_bytes_imagen(&format!("/v1/cases/{case_id}/images/upscale?factor={factor}"), &data_base64, &file_name, &state).await
}
```

- [ ] **Step 2: `bridge.ts` pasa el factor**

En `client/src/lib/bridge.ts`, cambia:
```ts
export async function upscaleImageBytes(caseId: number, dataBase64: string, fileName: string): Promise<Analysis> {
  const raw = await invoke<string>("upscale_image_bytes", { caseId, dataBase64, fileName });
  return JSON.parse(raw) as Analysis;
}
```
por:
```ts
export async function upscaleImageBytes(
  caseId: number, dataBase64: string, fileName: string, factor: 1 | 2 | 4,
): Promise<Analysis> {
  const raw = await invoke<string>("upscale_image_bytes", { caseId, dataBase64, fileName, factor });
  return JSON.parse(raw) as Analysis;
}
```

- [ ] **Step 3: `ImageEditorPopup` — estado del factor y presets en la vista de "Mejorar calidad"**

El upscaler no es una "herramienta" de la barra (no tiene overlay ni afecta al lienzo antes de
pedirlo) -- su UI vive junto al botón "Mejorar calidad" ya existente, igual que hoy. Añade,
junto a `const [mejorando, setMejorando] = useState(false);`:

```tsx
  const [factorUpscale, setFactorUpscale] = useState<1 | 2 | 4>(4);
```

Cambia la prop `upscaler` para que reciba el factor -- en la firma del componente, cambia:
```tsx
  upscaler: { onUpscale: (blob: Blob) => Promise<Blob> } | null;
```
por:
```tsx
  upscaler: { onUpscale: (blob: Blob, factor: 1 | 2 | 4) => Promise<Blob> } | null;
```

Y en `mejorarCalidad`, cambia la línea:
```tsx
            const mejorado = await upscaler.onUpscale(blob);
```
por:
```tsx
            const mejorado = await upscaler.onUpscale(blob, factorUpscale);
```

- [ ] **Step 4: Rejilla de "trabajando" mientras `mejorando` es `true`, y presets de resolución**

Sustituye el bloque del botón "Mejorar calidad" (dentro de `{upscaler && (...)}`, dos niveles
por debajo de "Omitir") por:

```tsx
                    {upscaler && (
                      <div className="flex items-center gap-2">
                        {!mejorando && (
                          <div className="flex items-center gap-1 rounded-md border border-border p-0.5">
                            {([1, 2, 4] as const).map((f) => (
                              <button key={f} onClick={() => setFactorUpscale(f)}
                                className={`rounded px-2 py-1 text-[10px] ${
                                  factorUpscale === f ? "bg-white/[.08] text-fg" : "text-subtle"}`}>
                                {f}×
                              </button>
                            ))}
                          </div>
                        )}
                        <button onClick={() => void mejorarCalidad()} disabled={bloqueado}
                          className="jg-press flex items-center gap-1.5 rounded-lg border border-white/15 px-3 py-2
                            text-[11.5px] text-fg disabled:opacity-40">
                          <Icon name="sparkle" size={13} />
                          {mejorando ? "Mejorando…" : "Mejorar calidad"}
                        </button>
                      </div>
                    )}
```

Y, para que se vea la rejilla mientras dura, envuelve el `<canvas ref={canvasRef} .../>` con un
`<div className="relative">` (si no lo tiene ya -- el contenedor de los dos `<canvas>` ya es
`<div className="relative" style={{ lineHeight: 0 }}>`, así que basta con añadir la rejilla
como hijo de ESE div, justo después del `<canvas ref={overlayRef} .../>`):

```tsx
                    {mejorando && (
                      <div className="absolute inset-0 grid grid-cols-10 grid-rows-7">
                        {Array.from({ length: 70 }).map((_, i) => (
                          <div key={i} className="border border-white/50"
                            style={{ animation: `jg-alert-pulse 1.8s ease-in-out ${(i % 10) * 0.08 + Math.floor(i / 10) * 0.05}s infinite` }} />
                        ))}
                      </div>
                    )}
```

`jg-alert-pulse` ya existe (se usa en `Icon.tsx` para el icono de alerta) y anima opacidad —
sirve tal cual para las celdas sin definir una animación nueva.

- [ ] **Step 5: `CaseView.tsx` pasa el factor a `upscaleImageBytes`**

`CaseView.tsx:172` define `mejorarCalidad`, la función que `ImageEditorPopup` recibe como
`onUpscale`. Cambia:
```tsx
  async function mejorarCalidad(blob: Blob): Promise<Blob> {
    const base64 = await blobToBase64(blob);
    const analisis = await upscaleImageBytes(case_.id, base64, editorPath ? nombreDeRuta(editorPath) : "editada.jpg");
```
por:
```tsx
  async function mejorarCalidad(blob: Blob, factor: 1 | 2 | 4): Promise<Blob> {
    const base64 = await blobToBase64(blob);
    const analisis = await upscaleImageBytes(
      case_.id, base64, editorPath ? nombreDeRuta(editorPath) : "editada.jpg", factor,
    );
```

- [ ] **Step 6: Comprobar que compila**

Run: `cd client && npm run build`
Expected: sin errores.

- [ ] **Step 7: Lint**

Run: `cd client && npx oxlint src/work/ImageEditorPopup.tsx src/lib/bridge.ts src/work/CaseView.tsx`
Expected: sin warnings nuevos.

- [ ] **Step 8: Commit**

```bash
git add client/src-tauri/src/main.rs client/src/lib/bridge.ts client/src/work/ImageEditorPopup.tsx client/src/work/CaseView.tsx
git commit -m "feat(editor): presets de resolución y rejilla de proceso en el reescalado

1x/2x/4x junto al botón \"Mejorar calidad\"; mientras dura, una rejilla de
celdas late de forma escalonada sobre el lienzo -- comunica \"trabajando\"
sin fingir medir un progreso que el backend no reporta.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Verificación manual (no automatizada)

Sin test runner de frontend, el criterio final es manual (preferencia ya establecida: el
usuario prueba la app él mismo). Tras la Task 7, comprobar a ojo:

- Las cuatro herramientas cambian de barra contextual sin perder la imagen ni el historial.
- Proporciones 1:1/4:3/16:9 bloquean el aspecto al arrastrar cualquier esquina; Libre permite
  también los manejadores de borde.
- Rotar/voltear se pueden deshacer/rehacer igual que recorte y blur.
- El zoom permite acercar y desplazarse con scroll sin que el recorte/blur pierdan precisión.
- Brillo/contraste solo se hornean al pulsar "Aplicar tono", no antes.
- Los presets de resolución muestran el multiplicador correcto y la rejilla se ve mientras
  "Mejorando…" está activo.
