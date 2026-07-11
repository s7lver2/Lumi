# Map Interactions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the map feel alive when a location is found — flying to a region when it's selected (not just after refining), flying precisely to the confirmed candidate's exact point when refining finishes, and a brief "arrival" pulse animation at the destination.

**Architecture:** A new pure helper (`apps/web/app/lib/map-camera.ts`) centralizes the two camera moves the app needs (a broad "look at this region" fly and a tight "zoomed in on this exact point" fly), tuned with different `duration`/`zoom`/`curve` per case. `ConfidenceCircleLayer.tsx` (already holds the `map` reference) calls it directly on marker click. `SearchDashboard.tsx` (already holds `map`) calls it on row click (a new `onSelectRegion` prop threaded into `ResultsPanel`/`TopResultCard`) and after refine completes, replacing its existing ad-hoc `map.flyTo` call. A new `MapArrivalPulse.tsx` overlay (framer-motion, absolutely positioned via `map.project()`) renders briefly whenever a candidate is confirmed.

## Global Constraints

- Camera animations must respect `prefers-reduced-motion` — do NOT pass `essential: true` to `flyTo` (that flag deliberately overrides the user's OS-level reduced-motion preference; Mapbox/MapLibre already skip/shorten the animation automatically when the browser reports a reduced-motion preference, and this app should honor that, not fight it).
- Every camera-move helper takes the `map` instance as an explicit parameter — no new global/singleton map reference. Components that don't already hold `map` (`ResultsPanel.tsx`, `TopResultCard.tsx`) get a callback prop instead of a map reference, keeping them map-library-agnostic (spec: this app already supports both Mapbox and MapLibre — see `MapCanvas.client.tsx`'s provider branch — so components other than `SearchDashboard`/`ConfidenceCircleLayer` should never touch the map API directly).

---

### Task 1: `apps/web/app/lib/map-camera.ts` — shared camera-move helpers

**Files:**
- Create: `apps/web/app/lib/map-camera.ts`
- Create: `apps/web/app/lib/map-camera.test.ts`

**Interfaces:**
- Produces: `flyToRegion(map: any, region: { centroid: { lat: number; lng: number } }): void` and `flyToPoint(map: any, point: { lat: number; lng: number }): void`, consumed by Task 2 (`ConfidenceCircleLayer.tsx`) and Task 3 (`SearchDashboard.tsx`).

- [ ] **Step 1: Write the failing tests**

```ts
// apps/web/app/lib/map-camera.test.ts
import { describe, it, expect, vi } from "vitest";
import { flyToRegion, flyToPoint } from "./map-camera";

describe("flyToRegion", () => {
  it("flies to the region centroid at a broad, exploratory zoom", () => {
    const map = { flyTo: vi.fn() };
    flyToRegion(map, { centroid: { lat: 40.4, lng: -3.7 } });
    expect(map.flyTo).toHaveBeenCalledWith(
      expect.objectContaining({ center: [-3.7, 40.4], zoom: 15, pitch: 50 })
    );
  });
});

describe("flyToPoint", () => {
  it("flies to the exact point at a tight, close-up zoom", () => {
    const map = { flyTo: vi.fn() };
    flyToPoint(map, { lat: 40.4, lng: -3.7 });
    expect(map.flyTo).toHaveBeenCalledWith(
      expect.objectContaining({ center: [-3.7, 40.4], zoom: 17, pitch: 60 })
    );
  });

  it("does nothing when map is not yet ready", () => {
    expect(() => flyToPoint(null, { lat: 40.4, lng: -3.7 })).not.toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @netryx/web exec vitest run app/lib/map-camera.test.ts`
Expected: FAIL — `Cannot find module './map-camera'`

- [ ] **Step 3: Implement**

```ts
// apps/web/app/lib/map-camera.ts
// Shared camera moves so "selecting a region" and "confirming a candidate"
// feel like two deliberately different gestures, not the same flyTo reused
// everywhere: selecting is a broad "let's look over here" (zoom 15, more
// tilt-forward feel via a gentler curve), confirming is a tight "here it
// is, precisely" swoop (zoom 17, longer duration, higher curve for more
// of a dramatic arc). Neither passes `essential: true` — that flag
// overrides the user's OS-level prefers-reduced-motion setting, which
// Mapbox/MapLibre otherwise already shortens/skips this animation for.

interface LatLng {
  lat: number;
  lng: number;
}

export function flyToRegion(map: any, region: { centroid: LatLng }): void {
  if (!map) return;
  map.flyTo({
    center: [region.centroid.lng, region.centroid.lat],
    zoom: 15,
    pitch: 50,
    duration: 1100,
    curve: 1.2,
  });
}

export function flyToPoint(map: any, point: LatLng): void {
  if (!map) return;
  map.flyTo({
    center: [point.lng, point.lat],
    zoom: 17,
    pitch: 60,
    duration: 1400,
    curve: 1.5,
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @netryx/web exec vitest run app/lib/map-camera.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/lib/map-camera.ts apps/web/app/lib/map-camera.test.ts
git commit -m "feat(web): add shared map camera-move helpers (region vs precise point)"
```

---

### Task 2: Fly to a region when its marker is clicked (not just after refining)

**Files:**
- Modify: `apps/web/app/components/ConfidenceCircleLayer.tsx`

**Interfaces:**
- Consumes: `flyToRegion` from Task 1.

- [ ] **Step 1: Import and call it from the existing click handler**

```tsx
// apps/web/app/components/ConfidenceCircleLayer.tsx — add import
import { flyToRegion } from "../lib/map-camera";
```

Replace the existing click handler body (currently only `selectRegion(id)`):

```tsx
      map.on("click", "lumi-conf-centroids-circle", (e: any) => {
        const id = e.features?.[0]?.properties?.id;
        if (!id) return;
        selectRegion(id);
        const region = regions.find((r) => r.id === id);
        if (region) flyToRegion(map, region);
      });
```

(`regions` is already a value in this component's closure — `const regions = useSearchStore((s) => s.regions);` at the top — no new prop/state needed.)

- [ ] **Step 2: Manually verify in the browser**

Run a search that returns 2+ regions, click a numbered marker on the map that ISN'T the currently-selected one. Confirm the camera smoothly flies to that region (zoom 15, tilted) instead of staying put — this previously did nothing but highlight the circle.

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/components/ConfidenceCircleLayer.tsx
git commit -m "feat(web): fly the camera to a region when its map marker is clicked"
```

---

### Task 3: Fly to a region when its result-list row is clicked; fly precisely to the confirmed candidate after refining

**Files:**
- Modify: `apps/web/app/components/SearchDashboard.tsx`
- Modify: `apps/web/app/components/ResultsPanel.tsx`
- Modify: `apps/web/app/components/TopResultCard.tsx`

**Interfaces:**
- Consumes: `flyToRegion`/`flyToPoint` from Task 1.
- Produces: `ResultsPanel`/`TopResultCard` gain an `onSelectRegion?: (regionId: string) => void` prop, called on row/card click (in addition to their existing `onRefine` prop, unrelated and unchanged).

- [ ] **Step 1: `SearchDashboard.tsx` — replace the ad-hoc `flyTo` and add a `handleSelectRegion`**

```tsx
// SearchDashboard.tsx — add import
import { flyToRegion, flyToPoint } from "../lib/map-camera";
```

Replace `handleRefine`'s final block (currently `map.flyTo({...})` using the region centroid):

```tsx
    const region = regions.find((r) => r.id === regionId);
    const confirmed = (
      candidatesByRegion[regionId] ?? []
    ).find((c) => c.status === "confirmed");
    if (confirmed) {
      flyToPoint(map, confirmed);
    } else if (region) {
      flyToRegion(map, region);
    }
```

(`candidatesByRegion` must be destructured from `useSearchStore()` alongside the existing `refineStatus, regions, error, ...` — add it to that existing destructure line.)

Add a new handler, next to `handleRefine`:

```tsx
  function handleSelectRegion(regionId: string) {
    selectRegion(regionId);
    const region = regions.find((r) => r.id === regionId);
    if (region) flyToRegion(map, region);
  }
```

Wire it into the two consumers (originally `<TopResultCard onRefine={handleRefine} refining={refining} />` and `<ResultsPanel queryImageUrl={queryImageUrl} onRefine={handleRefine} refining={refining} />`):

```tsx
          <TopResultCard onRefine={handleRefine} onSelectRegion={handleSelectRegion} refining={refining} />
          <div className="absolute right-0 top-0 h-full">
            <ResultsPanel queryImageUrl={queryImageUrl} onRefine={handleRefine} onSelectRegion={handleSelectRegion} refining={refining} />
          </div>
```

- [ ] **Step 2: `ResultsPanel.tsx` — call `onSelectRegion` when a row is clicked (not its buttons)**

```tsx
// ResultsPanel.tsx — ResultRow gains onSelectRegion, and the outer div becomes clickable
function ResultRow({ c, onRefine, onSelectRegion, refining }: {
  c: SearchCandidate; onRefine: (regionId: string) => void;
  onSelectRegion?: (regionId: string) => void; refining: boolean;
}) {
  const place = useReverseGeocode(c.lat, c.lng);
  const score = c.verificationScore ?? c.similarityScore;
  const selected = useSearchStore((s) => s.selectedRegionId) === c.regionId;
  return (
    <div
      role={c.regionId ? "button" : undefined}
      tabIndex={c.regionId ? 0 : undefined}
      onClick={() => c.regionId && onSelectRegion?.(c.regionId)}
      className={`rounded-card border p-3 ${c.regionId ? "cursor-pointer" : ""} ${selected ? "border-accent-fg/40 bg-white/5" : "border-border"}`}
    >
```

(The rest of `ResultRow`'s JSX — the score row, the coordinates link, the refine button — is unchanged, EXCEPT the refine button and the Google Maps link must call `e.stopPropagation()` so clicking them doesn't also trigger the new row-level `onSelectRegion`, matching the existing `stopPropagation` convention already used in `AreasPopup.tsx`'s row buttons):

```tsx
        <a
          href={streetViewMapsUrl(c.panoId, c.heading)}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="font-mono text-xs text-muted hover:text-fg hover:underline"
          title="Abrir en Google Maps (Street View, mismo ángulo de la foto)"
        >
          {formatCoords(c.lat, c.lng)}
        </a>
        <button
          onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(formatCoords(c.lat, c.lng)); }}
          className="text-subtle hover:text-fg"
          title="Copiar coordenadas"
          aria-label="Copiar coordenadas"
        >
          ⧉
        </button>
      </div>
      {c.regionId && (
        <button
          onClick={(e) => { e.stopPropagation(); onRefine(c.regionId!); }}
          disabled={refining}
          className="mt-2 text-xs text-draw-fg hover:underline disabled:opacity-50 disabled:no-underline"
        >
          {refining && selected ? "Refinando…" : selected ? "Refinar aquí" : "Precisión de calle disponible"}
        </button>
      )}
    </div>
  );
}
```

Update `ResultsPanel`'s own props/pass-through:

```tsx
export function ResultsPanel({
  queryImageUrl,
  onRefine,
  onSelectRegion,
  refining = false,
}: {
  queryImageUrl: string | null;
  onRefine: (regionId: string) => void;
  onSelectRegion?: (regionId: string) => void;
  refining?: boolean;
}) {
  const { queryImageName, regions, candidatesByRegion } = useSearchStore();
  const all = regions.flatMap((r) => candidatesByRegion[r.id] ?? []);

  return (
    <div className="flex h-full w-80 flex-col border-l border-border bg-panel/80 backdrop-blur-md">
      <div className="flex items-center gap-3 border-b border-border p-4">
        {queryImageUrl && <img src={queryImageUrl} alt="" className="h-14 w-14 rounded-md object-cover" />}
        <span className="truncate font-mono text-xs text-muted">{queryImageName}</span>
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto p-4">
        <div className="text-xs text-muted">
          {all.length} candidatos{all.every((c) => c.status !== "confirmed") ? " (sin verificar)" : ""}
        </div>
        {all.map((c) => (
          <ResultRow key={c.id} c={c} onRefine={onRefine} onSelectRegion={onSelectRegion} refining={refining} />
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: `TopResultCard.tsx` — same `onSelectRegion` wiring on the card itself**

```tsx
// TopResultCard.tsx
export function TopResultCard({ onRefine, onSelectRegion, refining = false }: {
  onRefine: (regionId: string) => void;
  onSelectRegion?: (regionId: string) => void;
  refining?: boolean;
}) {
  const { regions, selectedRegionId, candidatesByRegion } = useSearchStore();
  const region = regions.find((r) => r.id === selectedRegionId) ?? regions[0];
  const top = region ? candidatesByRegion[region.id]?.[0] : undefined;
  const place = useReverseGeocode(region?.centroid.lat ?? 0, region?.centroid.lng ?? 0);
  if (!region) return null;

  const pct = Math.round(region.aggregateScore * 100);
  return (
    <div
      className="absolute left-1/2 top-4 w-96 -translate-x-1/2 cursor-pointer"
      onClick={() => onSelectRegion?.(region.id)}
    >
      <FloatingCard className="p-4">
```

(No other change inside the card — the existing "Refinar en..." button already stops event bubbling implicitly since it's a `<button>` with its own `onClick`; add `e.stopPropagation()` there too for safety, matching Task 3 Step 2's convention:)

```tsx
        {top && (
          <button
            onClick={(e) => { e.stopPropagation(); onRefine(region.id); }}
            disabled={refining}
            className="mt-3 w-full rounded-md bg-elevated py-2 text-xs font-medium text-fg hover:bg-white/10 disabled:opacity-50"
          >
            {refining ? "Refinando…" : `Refinar en ${place ?? "esta región"}`}
          </button>
        )}
      </FloatingCard>
    </div>
  );
}
```

- [ ] **Step 4: Manually verify in the browser**

1. Run a search, click a row in the right-hand results list that belongs to a NON-selected region — confirm the map flies there (Task 2's `flyToRegion` behavior, now also reachable from the list, not just map markers).
2. Click "Refinar aquí" on a region, wait for it to confirm a candidate — confirm the camera now flies tightly to the CONFIRMED CANDIDATE'S exact lat/lng (zoom 17) rather than the region's original, fuzzier centroid (zoom 16 previously).
3. Confirm clicking the coordinates link or the copy/refine buttons inside a row does NOT ALSO trigger the new row-click fly (the `stopPropagation` calls from Step 2/3).

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/components/SearchDashboard.tsx apps/web/app/components/ResultsPanel.tsx apps/web/app/components/TopResultCard.tsx
git commit -m "feat(web): fly to a region on row/marker click, and precisely to the confirmed candidate after refining"
```

---

### Task 4: Arrival pulse animation on the confirmed candidate

**Files:**
- Create: `apps/web/app/components/MapArrivalPulse.tsx`
- Modify: `apps/web/app/components/SearchDashboard.tsx`

**Interfaces:**
- Consumes: `map` (already held by `SearchDashboard`), the confirmed candidate's `{lat, lng}` (already computed in Task 3 Step 1's `handleRefine`).
- Produces: a purely visual overlay component, no store/API interaction.

- [ ] **Step 1: Write the component**

```tsx
// apps/web/app/components/MapArrivalPulse.tsx
"use client";
import { useEffect, useState } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";

interface LatLng {
  lat: number;
  lng: number;
}

/**
 * A brief radiating-ring pulse at a specific map point — shown once when a
 * candidate is confirmed, so the "arrival" reads as a deliberate reveal
 * instead of the circle/marker just silently shrinking (see
 * ConfidenceCircleLayer.tsx's REFINED_RADIUS_KM collapse, which happens at
 * the same moment). Positioned via map.project(), so it must re-project on
 * every map move/zoom while visible — cheap, since it only runs for ~1.6s.
 */
export function MapArrivalPulse({ map, point }: { map: any; point: LatLng | null }) {
  const [screenPos, setScreenPos] = useState<{ x: number; y: number } | null>(null);
  const [visible, setVisible] = useState(false);
  const reduce = useReducedMotion();

  useEffect(() => {
    if (!map || !point) {
      setVisible(false);
      return;
    }
    setVisible(true);
    const update = () => {
      const p = map.project([point.lng, point.lat]);
      setScreenPos({ x: p.x, y: p.y });
    };
    update();
    map.on("move", update);
    const timeout = setTimeout(() => setVisible(false), 1600);
    return () => {
      map.off("move", update);
      clearTimeout(timeout);
    };
  }, [map, point]);

  if (reduce || !visible || !screenPos) return null;

  return (
    <div
      className="pointer-events-none absolute z-30"
      style={{ left: screenPos.x, top: screenPos.y, transform: "translate(-50%, -50%)" }}
    >
      <AnimatePresence>
        <motion.div
          initial={{ scale: 0.3, opacity: 0.8 }}
          animate={{ scale: 3.2, opacity: 0 }}
          transition={{ duration: 1.4, ease: "easeOut" }}
          className="h-6 w-6 rounded-full border-2 border-accent-fg"
        />
      </AnimatePresence>
    </div>
  );
}
```

- [ ] **Step 2: Wire it into `SearchDashboard.tsx`**

```tsx
// SearchDashboard.tsx — add import
import { MapArrivalPulse } from "./MapArrivalPulse";
```

Add local state for the pulse target, set it in `handleRefine` alongside the `flyToPoint` call from Task 3 Step 1:

```tsx
  const [pulsePoint, setPulsePoint] = useState<{ lat: number; lng: number } | null>(null);
```

```tsx
    if (confirmed) {
      flyToPoint(map, confirmed);
      setPulsePoint({ lat: confirmed.lat, lng: confirmed.lng });
    } else if (region) {
      flyToRegion(map, region);
    }
```

Render it in the JSX, alongside the other map-overlay components:

```tsx
      {map && <ConfidenceCircleLayer map={map} />}
      {map && <MapArrivalPulse map={map} point={pulsePoint} />}
```

- [ ] **Step 3: Manually verify in the browser**

Refine a region to confirmation and confirm a ring briefly expands and fades out at the confirmed candidate's exact point, roughly 1.4s, then disappears cleanly (no stray leftover DOM element). Enable "reduce motion" in OS accessibility settings and confirm the pulse doesn't render at all (the camera fly itself should also visibly shorten/skip, per Mapbox's own built-in reduced-motion handling — no code change needed for that part).

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/components/MapArrivalPulse.tsx apps/web/app/components/SearchDashboard.tsx
git commit -m "feat(web): add a brief arrival pulse animation at the confirmed candidate's point"
```

---

## Self-Review

**1. Spec coverage:** "al localizar algo haga zoom, animaciones" → Task 2 (marker click), Task 3 (row click + precise post-refine fly), Task 4 (arrival pulse). All three together turn what was previously a single ad-hoc `flyTo` (only after refining) into a consistent, animated "select → fly" interaction everywhere a location can be picked.

**2. Placeholder scan:** no TBD/TODO; every step has real, complete code.

**3. Type consistency:** `flyToRegion(map, region: {centroid})` / `flyToPoint(map, point: {lat,lng})` signatures from Task 1 are used identically in Task 2 and Task 3 — no drift. `onSelectRegion?: (regionId: string) => void` prop name/type matches across `SearchDashboard.tsx`, `ResultsPanel.tsx`, `TopResultCard.tsx`.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-11-map-interactions.md`. Two execution options:

1. **Subagent-Driven (recommended)** - dispatch a fresh subagent per task, review between tasks, fast iteration
2. **Inline Execution** - execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
