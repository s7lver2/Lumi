# Setup Re-run, Install/Weights Fixes & Draw-Tool Repair — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make setup run automatically on first boot and re-runnable from Settings; fix the 403 that blocks the wizard's install commands; fix the Windows shell-quoting bug that breaks model-weight downloads; and repair the Entrenamiento draw tool (valid draw modes, working rectangle/circle, remove the top-right native control).

**Architecture:** Continuation of `2026-07-10-ui-overhaul.md` (already implemented + committed through `a52712e`). All target files exist. This plan amends them. Pure logic stays vitest-tested; SSE/child-process/map behavior is verified with `tsc` + manual runs.

**Tech Stack:** Next.js 14 App Router, TypeScript, `@mapbox/mapbox-gl-draw` + `mapbox-gl-draw-rectangle-mode` + `mapbox-gl-draw-circle` (already in `apps/web` deps), Python inference venv.

## Global Constraints

- `route.ts` may only export HTTP handlers; helpers live in sibling modules.
- Relative imports in `apps/web`; no icon webfont (inline SVG/CSS only).
- Fixed argv only in the run endpoint — never build commands from request input (security §7.1, §10.3).
- Windows: `spawn(..., { shell: true })` joins argv through cmd.exe, so **no single argv entry may contain spaces** unless it is a real file path with no spaces. Inline `python -c "…"` scripts are therefore banned — use a script file with single-token args.
- Do NOT kill the user's node/dev-server processes; verify with `pnpm --filter @netryx/web typecheck` and manual runs.
- Commit after every task.

---

## Task 1: Fix model-weight downloads (script file instead of inline `-c`)

**Problem:** `weights-retrieval` / `weights-verification` run `python -c "import torch; torch.hub.load(...)"`. With `shell: true` on Windows, cmd.exe splits the `-c` argument at the first space, so Python receives just `import` → `SyntaxError: invalid syntax`.

**Files:**
- Create: `services/inference/download_weights.py`
- Modify: `apps/web/app/api/setup/run/[step]/route.ts` (the `STEPS` map)

**Interfaces:**
- Produces: run steps `weights-retrieval` and `weights-verification` invoked as `python.exe download_weights.py <retrieval|verification>` (single-token args, shell-safe).

- [ ] **Step 1: Create the download script**

```python
# services/inference/download_weights.py
"""
Descarga y cachea los pesos de los modelos seleccionados. Se ejecuta con el
python del venv (cwd = services/inference) desde el paso Install del asistente.
Recibe un argumento: "retrieval" | "verification" | "all".

Nota: se invoca como `python download_weights.py retrieval` (argumentos de un
solo token) — NUNCA como `python -c "..."`, porque en Windows con shell:true
cmd.exe parte el script inline por los espacios (SyntaxError).
"""
import sys


def main() -> int:
    kind = sys.argv[1] if len(sys.argv) > 1 else "all"

    if kind in ("retrieval", "all"):
        import torch
        print("Descargando modelo de recuperación (Lumi Preview / MegaLoc)…", flush=True)
        torch.hub.load("gmberton/MegaLoc", "get_trained_model")

    if kind in ("verification", "all"):
        import romatch
        print("Descargando modelo de verificación (Laila / RoMa)…", flush=True)
        romatch.roma_outdoor(device="cpu")

    print("Pesos listos.", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 2: Point the run steps at the script** — in `route.ts`, replace the three weight-related entries (`inference-weights`, `weights-retrieval`, `weights-verification`) with just these two:

```ts
  "weights-retrieval": {
    cmd: resolve(INFER, "venv", "Scripts", "python.exe"),
    args: ["download_weights.py", "retrieval"],
    cwd: INFER,
  },
  "weights-verification": {
    cmd: resolve(INFER, "venv", "Scripts", "python.exe"),
    args: ["download_weights.py", "verification"],
    cwd: INFER,
  },
```

(Delete the now-unused `"inference-weights"` entry — the wizard no longer calls it.)

- [ ] **Step 3: Verify** — Run: `pnpm --filter @netryx/web typecheck`
Expected: PASS. Manual (after Task 2, with the venv + deps installed): the "Modelo de recuperación · Lumi Preview" console shows `Descargando modelo de recuperación…` and completes with code 0 — no `SyntaxError`.

- [ ] **Step 4: Commit**

```bash
git add services/inference/download_weights.py "apps/web/app/api/setup/run/[step]/route.ts"
git commit -m "fix(setup): download model weights via script file (Windows shell-quoting bug)"
```

---

## Task 2: Wizard runs its commands with rerun=1 (fix the 403)

**Problem:** The run endpoint returns `403 setup already completed` unless `?rerun=1`. Once setup has completed even once, every wizard command 403s (`error: HTTP 403`). Since setup is now intentionally re-runnable, the wizard must always send `rerun=1`. It is harmless on a genuine first boot (the completed-guard is false there anyway).

**Files:**
- Modify: `apps/web/app/setup/steps/InstallItem.tsx:17` (auto-start `run`)
- Modify: `apps/web/app/setup/steps/DatabaseStep.tsx` (the `run("migrate")` effect)
- Modify: `apps/web/app/api/setup/run/[step]/route.ts` (comment only — document that the wizard always reruns)

**Interfaces:**
- Consumes: `useCommandRun.run(step, rerun?)` — unchanged signature.

- [ ] **Step 1: InstallItem auto-starts with rerun** — change line 17:

```tsx
    if (active && !started.current) { started.current = true; run(stepId, true); }
```

(The retry button already passes `true`; leave it.)

- [ ] **Step 2: DatabaseStep runs migrate with rerun** — in the mount effect, change `run("migrate")` to `run("migrate", true)`:

```tsx
  useEffect(() => { if (!started.current) { started.current = true; run("migrate", true); } }, [run]);
```

(The retry button already passes `true`; leave it.)

- [ ] **Step 3: Update the security note in route.ts** — replace the comment sentence "Refuses to run once setup is complete unless ?rerun=1 is present." with:

```ts
// The setup wizard always passes ?rerun=1 (setup is re-runnable from Settings),
// so the completed-guard only blocks stray external callers, not the wizard.
```

- [ ] **Step 4: Verify** — Run: `pnpm --filter @netryx/web typecheck`
Expected: PASS. Manual: with `__setup_completed__=true` already in the DB, open `/setup`, click Install — steps now proceed instead of showing `error: HTTP 403`.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/setup/steps/InstallItem.tsx apps/web/app/setup/steps/DatabaseStep.tsx "apps/web/app/api/setup/run/[step]/route.ts"
git commit -m "fix(setup): wizard always reruns commands so re-run isn't blocked by 403"
```

---

## Task 3: Re-run setup from Settings (first boot already auto-runs)

**Behavior:** First boot already works — `resolveGateDecision` in `app/(protected)/gate.ts` redirects any protected route to `/setup` when `isSetupCompleted()` is false, so a fresh install lands on the wizard automatically. `/setup` is outside the `(protected)` gate (its own passthrough layout), so it stays reachable after completion. The only missing piece is an explicit entry point for re-running.

**Files:**
- Modify: `apps/web/app/components/SettingsPanel.tsx` (add a re-run entry at the bottom)

- [ ] **Step 1: Add a re-run section** — in `SettingsPanel.tsx`, inside the top-level `<motion.div variants={staggerContainer} …>`, after the Guardar row `<div className="flex items-center gap-3">…</div>` and before it closes, add:

```tsx
        <motion.div variants={staggerItem}>
          <FloatingCard className="flex items-center justify-between p-5">
            <div>
              <div className="text-sm font-medium text-fg">Volver a ejecutar el setup</div>
              <p className="mt-1 text-xs text-muted">Reinstala dependencias, migra la base de datos o cambia credenciales paso a paso.</p>
            </div>
            <a href="/setup" className="rounded-md border border-white/15 px-4 py-2 text-xs text-fg hover:bg-white/10">Abrir setup</a>
          </FloatingCard>
        </motion.div>
```

- [ ] **Step 2: Verify** — Run: `pnpm --filter @netryx/web typecheck`
Expected: PASS. Manual: `/settings` shows the "Volver a ejecutar el setup" card; clicking "Abrir setup" opens the wizard, and its steps run (rerun=1 from Task 2) even though setup was already completed.

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/components/SettingsPanel.tsx
git commit -m "feat(settings): add re-run setup entry point"
```

---

## Task 4: Repair the draw tool (valid modes, rectangle/circle, remove native control)

**Problems:** (1) `IndexingDrawTool` enables `controls: { polygon: true, trash: true }`, which renders the native draw buttons in the top-right corner — the user wants them gone (the bottom `DrawToolbar` replaces them). (2) `changeMode(mode)` throws `polygon is not valid` because MapboxDraw's polygon mode is `draw_polygon`, and `rectangle`/`circle` aren't registered. (3) After removing the native trash control, the current `handleClearPolygon` (which clicks `.mapbox-gl-draw_trash`) stops working.

**Files:**
- Create: `apps/web/draw-modes.d.ts` (ambient module declarations — the extra draw packages ship no types)
- Modify: `apps/web/app/components/IndexingDrawTool.tsx` (register modes, drop native controls, map mode names, handle clear)
- Modify: `apps/web/app/(protected)/index/page.tsx` (`handleClearPolygon` dispatches `draw-clear`)

**Interfaces:**
- Consumes/Produces: window CustomEvents `draw-change-mode` (`detail.mode` = "polygon" | "rectangle" | "circle") and `draw-clear` (no detail), both handled by `IndexingDrawTool`.

- [ ] **Step 1: Declare the untyped draw packages**

```ts
// apps/web/draw-modes.d.ts
declare module "mapbox-gl-draw-rectangle-mode";
declare module "mapbox-gl-draw-circle";
```

- [ ] **Step 2: Rewrite IndexingDrawTool** — replace `apps/web/app/components/IndexingDrawTool.tsx` with:

```tsx
"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import MapboxDraw from "@mapbox/mapbox-gl-draw";
import DrawRectangle from "mapbox-gl-draw-rectangle-mode";
import { DragCircleMode } from "mapbox-gl-draw-circle";
import { snapPoint } from "../lib/snap";
import { useIndexingStore } from "../stores/useIndexingStore";
import { polygonAreaKm2 } from "../lib/geo";

import "@mapbox/mapbox-gl-draw/dist/mapbox-gl-draw.css";

interface IndexingDrawToolProps {
  map: any;
  onModeChange?: (mode: string) => void;
}

// The bottom DrawToolbar speaks in semantic names; MapboxDraw uses its own.
const TO_DRAW: Record<string, string> = { polygon: "draw_polygon", rectangle: "draw_rectangle", circle: "draw_circle" };
const TO_SEMANTIC: Record<string, string> = { draw_polygon: "polygon", draw_rectangle: "rectangle", draw_circle: "circle" };

export function IndexingDrawTool({ map, onModeChange }: IndexingDrawToolProps) {
  const setDrawnPolygon = useIndexingStore((s) => s.setDrawnPolygon);
  const clearPolygon = useIndexingStore((s) => s.clearPolygon);

  const [snapEnabled, setSnapEnabled] = useState(false);
  const [streetFeatures, setStreetFeatures] = useState<any[]>([]);
  const drawRef = useRef<any>(null);

  const sync = useCallback(() => {
    if (!drawRef.current) return;
    const fc = drawRef.current.getAll();
    const feature = fc.features[0];
    if (!feature) {
      clearPolygon();
      return;
    }
    const ring = (feature.geometry as GeoJSON.Polygon).coordinates[0] as [number, number][];
    setDrawnPolygon(ring, polygonAreaKm2(ring));
  }, [setDrawnPolygon, clearPolygon]);

  // 1. Init MapboxDraw with NO native controls (the bottom toolbar drives it)
  //    and with rectangle + circle modes registered so changeMode() is valid.
  useEffect(() => {
    if (!map) return;

    const draw = new MapboxDraw({
      displayControlsDefault: false,
      modes: { ...MapboxDraw.modes, draw_rectangle: DrawRectangle, draw_circle: DragCircleMode },
    });

    drawRef.current = draw;
    map.addControl(draw);

    map.on("draw.create", sync);
    map.on("draw.update", sync);
    map.on("draw.delete", clearPolygon);

    const handleMode = (e: any) => {
      if (onModeChange) onModeChange(TO_SEMANTIC[e.mode] ?? e.mode);
    };
    map.on("draw.modechange", handleMode);

    return () => {
      if (map) {
        map.off("draw.create", sync);
        map.off("draw.update", sync);
        map.off("draw.delete", clearPolygon);
        map.off("draw.modechange", handleMode);
        if (drawRef.current) {
          try {
            map.removeControl(drawRef.current);
          } catch {
            // El mapa ya se destruyó por completo; ignorar.
          }
          drawRef.current = null;
        }
      }
    };
  }, [map, sync, clearPolygon, onModeChange]);

  // 2. Snapping en tiempo real durante draw.update
  useEffect(() => {
    if (!map || !snapEnabled || streetFeatures.length === 0) return;

    const onDrawUpdate = (e: any) => {
      let modified = false;
      const updatedFeatures = e.features.map((feature: any) => {
        if (feature.geometry.type === "Polygon") {
          const snappedRing = feature.geometry.coordinates[0].map((vertex: [number, number]) => {
            const snapped = snapPoint(vertex, streetFeatures, 25);
            if (snapped) {
              modified = true;
              return snapped;
            }
            return vertex;
          });
          feature.geometry.coordinates = [snappedRing];
        }
        return feature;
      });
      if (modified && drawRef.current) {
        updatedFeatures.forEach((f: any) => drawRef.current.add(f));
        sync();
      }
    };

    map.on("draw.update", onDrawUpdate);
    return () => {
      map.off("draw.update", onDrawUpdate);
    };
  }, [map, snapEnabled, streetFeatures, sync]);

  // 3. Puentes de eventos globales para la DrawToolbar
  useEffect(() => {
    const changeModeListener = (e: Event) => {
      const mode = (e as CustomEvent).detail?.mode;
      if (!drawRef.current || !mode) return;
      try {
        drawRef.current.changeMode(TO_DRAW[mode] ?? mode);
      } catch {
        // Modo no soportado por el build de MapboxDraw; ignorar en vez de romper.
      }
    };

    const clearListener = () => {
      if (drawRef.current) drawRef.current.deleteAll();
      clearPolygon();
    };

    const toggleSnapListener = (e: Event) => {
      const enabled = (e as CustomEvent).detail?.enabled;
      setSnapEnabled(enabled);
      if (enabled && map) {
        const bounds = map.getBounds();
        const bbox = `${bounds.getWest()},${bounds.getSouth()},${bounds.getEast()},${bounds.getNorth()}`;
        fetch(`/api/streets?bbox=${bbox}`)
          .then((r) => r.json())
          .then((data) => {
            if (data.lines?.features) setStreetFeatures(data.lines.features);
          })
          .catch(() => setStreetFeatures([]));
      }
    };

    window.addEventListener("draw-change-mode", changeModeListener);
    window.addEventListener("draw-clear", clearListener);
    window.addEventListener("draw-toggle-snap", toggleSnapListener);
    return () => {
      window.removeEventListener("draw-change-mode", changeModeListener);
      window.removeEventListener("draw-clear", clearListener);
      window.removeEventListener("draw-toggle-snap", toggleSnapListener);
    };
  }, [map, clearPolygon]);

  // 4. Escape sale a selección simple
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && drawRef.current) {
        drawRef.current.changeMode("simple_select");
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  return null;
}
```

- [ ] **Step 3: Make clear use the event** — in `app/(protected)/index/page.tsx`, replace `handleClearPolygon`:

```tsx
  function handleClearPolygon() {
    window.dispatchEvent(new CustomEvent("draw-clear"));
    setEstimate(null);
  }
```

- [ ] **Step 4: Verify** — Run: `pnpm --filter @netryx/web typecheck`
Expected: PASS. Manual on `/index`: no draw buttons in the top-right corner; the bottom toolbar's Polígono / Rectángulo / Círculo each start the right drawing mode with no `polygon is not valid` crash; Borrar clears the drawn shape.

- [ ] **Step 5: Commit**

```bash
git add apps/web/draw-modes.d.ts apps/web/app/components/IndexingDrawTool.tsx "apps/web/app/(protected)/index/page.tsx"
git commit -m "fix(web): register rectangle/circle draw modes, drop native control, wire clear event"
```

---

## Final verification

- [ ] `pnpm --filter @netryx/web typecheck` → PASS clean.
- [ ] `pnpm --filter @netryx/web test` → PASS (no unit tests changed here; confirm nothing regressed).
- [ ] Manual: `/setup` full flow with a previously-completed DB (Install proceeds past 403, weights download without SyntaxError, DB materializes, credentials, confirm → `/`); `/settings` "Volver a ejecutar el setup" opens the wizard; `/index` draw toolbar works with all three shapes and no top-right control.

## Self-Review (change coverage)

- Setup auto on first boot → already handled by `gate.ts` (documented in Task 3, no change needed).
- Re-run from Settings → Task 3 (button) + Task 2 (rerun=1 makes it actually run).
- Install 403 → Task 2.
- Lumi Preview `SyntaxError` on retry → Task 1 (script file, shell-safe args).
- `changeMode` "polygon is not valid" → Task 4 (mode registration + name mapping).
- Remove top-right draw control → Task 4 (drop `controls`, clear via `draw-clear`).

## Type cross-check

`run(step, rerun?)` unchanged (T2). Draw events: `draw-change-mode` detail.mode semantic → `TO_DRAW` → MapboxDraw mode; `draw.modechange` → `TO_SEMANTIC` → `onModeChange` semantic, matching `DrawToolbar`'s `mode === "polygon"` comparison; `draw-clear` handled in T4, dispatched in T3-page. Consistent.
