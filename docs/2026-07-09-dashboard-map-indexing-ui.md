# Dashboard & Map UI — Part 1: Map Foundation + Indexing UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `apps/web` its first real UI — a dark, translucent, Raven-style map dashboard — and the complete indexing flow on top of the already-built backend: draw a polygon, see the estimated cost before confirming, launch the job, watch live SSE progress, and browse/inspect indexed areas (spec §5, §6.1, §8, §12.1).

**Architecture:** Introduce Tailwind + a shared dark theme and an `AppShell` (thin left icon rail + full-bleed content), then a client-only `MapCanvas` that renders **MapLibre GL JS + free OpenFreeMap tiles by default** and switches to **Mapbox GL JS** when a `MAPBOX_TOKEN` is configured — both showing **3D extruded buildings**. The indexing flow (`/index`) composes `MapCanvas` (draw mode) + `IndexingDrawTool` + a right panel driven by two new lightweight endpoints (`POST /api/areas/estimate` for cost-before-confirm, reusing the existing `POST /api/areas` to launch) and the existing SSE progress endpoint. `/areas` and `/areas/[id]` read from `GET /api/areas` and a new `GET /api/areas/[id]`, with `DELETE`/reindex for management. Zustand holds map + indexing state (spec §13).

**Tech Stack:** Next.js 14 App Router, React 18, TypeScript, Tailwind CSS, Zustand, MapLibre GL JS / Mapbox GL JS, @mapbox/mapbox-gl-draw, @turf/turf, vitest.

**Depends on:** Foundation + Indexing Pipeline plans merged. Backend already provides: `POST /api/areas`, `GET /api/areas`, SSE `GET /api/areas/[id]/progress`, `system_settings` (incl. `MAPBOX_TOKEN`, `MAX_AREA_KM2`, `STREET_VIEW_PRICE_PER_IMAGE_USD`), the `(protected)` setup gate, and `@netryx/geo-sampling`.

**Out of scope (Part 2 — Search UI plan):** route `/` (search dashboard), `ImageDropzone`, `ResultsPanel`, `ConfidenceCircleLayer`, `RingGauge`, the bottom match summary bar, the refine flow, `useSearchStore`. This plan establishes the shared shell/theme/`MapCanvas`/`useMapStore` those will reuse, and temporarily redirects `/` to `/index`.

## Global Constraints

- **Visual identity (design preferences — non-negotiable for "done"):**
  - **Translucency:** floating panels and cards use a semi-opaque fill + `backdrop-blur` (e.g. `bg-panel/80 backdrop-blur-md`), never fully opaque — matching the Raven references.
  - **Polish:** the result must read as a refined, cinematic dark dashboard close to the references, not merely functional.
  - **3D buildings on BOTH map providers:** a `fill-extrusion` buildings layer renders in 3D whether the map is Mapbox (Mapbox Streets `building` layer) or MapLibre + OpenFreeMap (OpenMapTiles `building` layer with `render_height`/`render_min_height`). Token or no token, buildings are 3D.
- **Dark theme tokens (Tailwind, single source of truth):** surfaces `#0e0f11`/`#15171a`/`#1a1b1e`/`#202226`; border `#26282c`; text `#e8e8e6`/`#9a9a95`/`#6a6c70`; accent teal `#1d9e75` (fg `#5dcaa5`); draw blue `#378add` (fg `#85b7eb`); warning amber `#ef9f27`; danger `#e88f8f`. Monospace for coordinates.
- **Map libraries are client-only** — every map component is loaded via `next/dynamic(..., { ssr: false })` (spec §5.2); MapLibre/Mapbox never import on the server.
- **Route-export rule:** `route.ts` exports only HTTP handlers, and `layout.tsx`/`page.tsx` export only `default` + the fixed config names (`metadata`, `viewport`, ...) — no other named exports from either. Helpers live in sibling modules (learned bug from `app/api/areas/[id]/progress/`; confirmed to apply to `layout.tsx` too in Task 2).
- **All new pages live under `app/(protected)/`** so they inherit the setup gate; `resolveGateDecision`/`GateDecision` move out of `(protected)/layout.tsx` into a sibling `gate.ts` (route-export rule, below) — the decision logic itself is unchanged, only its location.
- **No path aliases** — use relative imports (matches existing `../../../lib/db`).
- **`apps/web` reads the root `.env` via `next.config.js`** (already wired) — server code uses `getPool()`/`getSettingsRepo()` as-is.
- **TDD where there's logic** (pure functions → vitest); **map/WebGL components are verified manually** (documented per task) since they can't run in jsdom. DRY, YAGNI, frequent commits.

---

## File Structure

```
apps/web/
├── package.json                                  # Modify (Task 1,3,5,7 — deps)
├── tailwind.config.ts                            # Task 1
├── postcss.config.js                             # Task 1
├── app/
│   ├── layout.tsx                                # Task 1 (NEW root layout)
│   ├── globals.css                               # Task 1
│   ├── setup/layout.tsx                          # Modify (Task 1 — drop <html>/<body>)
│   ├── settings/layout.tsx                       # Modify (Task 1 — drop <html>/<body>)
│   ├── (protected)/
│   │   ├── layout.tsx                            # Modify (Task 2 — wrap children in AppShell)
│   │   ├── page.tsx                             # Task 12 (redirect / -> /index)
│   │   ├── index/page.tsx                        # Task 9
│   │   ├── areas/page.tsx                        # Task 11
│   │   └── areas/[id]/page.tsx                   # Task 12
│   ├── api/
│   │   ├── map-config/route.ts                   # Task 4
│   │   └── areas/
│   │       ├── estimate/route.ts                 # Task 6
│   │       └── [id]/route.ts                     # Task 10 (GET + DELETE)
│   ├── components/
│   │   ├── Badge.tsx                             # Task 2
│   │   ├── FloatingCard.tsx                      # Task 2
│   │   ├── ProgressMeter.tsx                     # Task 2
│   │   ├── AppShell.tsx                          # Task 2
│   │   ├── MapCanvas.tsx                         # Task 5
│   │   ├── MapCanvas.client.tsx                  # Task 5
│   │   ├── IndexingDrawTool.tsx                  # Task 7
│   │   ├── JobProgressBar.tsx                    # Task 9
│   │   └── AreaCard.tsx                          # Task 11
│   ├── lib/
│   │   ├── geo.ts                                # Task 7
│   │   ├── geo.test.ts                           # Task 7
│   │   ├── progress-stream.ts                    # Task 8
│   │   ├── progress-stream.test.ts              # Task 8
│   │   ├── useAreaProgress.ts                    # Task 8
│   │   ├── area-status.ts                        # Task 11
│   │   ├── area-status.test.ts                   # Task 11
│   │   └── map-buildings.ts                      # Task 5
│   └── stores/
│       ├── useMapStore.ts                        # Task 3
│       ├── useMapStore.test.ts                   # Task 3
│       ├── useIndexingStore.ts                   # Task 3
│       └── useIndexingStore.test.ts             # Task 3
```

> Component/store/lib folders live under `app/` (not a top-level `src/`) to match the existing `app/`-centric layout.

---

### Task 1: Tailwind, dark theme, and a real root layout

Introduce Tailwind and the shared dark theme, and fix the missing root layout. Today each segment (`setup/layout.tsx`, `settings/layout.tsx`) renders its own `<html>`/`<body>`; App Router needs exactly one root layout to own `<html>`/`<body>` and import the global stylesheet.

**Files:**
- Modify: `apps/web/package.json`
- Create: `apps/web/tailwind.config.ts`, `apps/web/postcss.config.js`, `apps/web/app/globals.css`, `apps/web/app/layout.tsx`
- Modify: `apps/web/app/setup/layout.tsx`, `apps/web/app/settings/layout.tsx`

**Interfaces:**
- Produces: Tailwind theme tokens (`bg`, `surface`, `panel`, `elevated`, `border`, `accent{,-fg}`, `draw{,-fg}`, `warning`, `danger`, `muted`, `subtle`), `font-mono`; a root `<html>`/`<body>` with dark bg + fonts.

- [ ] **Step 1: Add dependencies**

```bash
cd apps/web && pnpm add -D tailwindcss@^3.4.10 postcss@^8.4.41 autoprefixer@^10.4.20
```

- [ ] **Step 2: Create `postcss.config.js`**

```javascript
// apps/web/postcss.config.js
module.exports = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
```

- [ ] **Step 3: Create `tailwind.config.ts`**

```typescript
// apps/web/tailwind.config.ts
import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#0e0f11",
        surface: "#15171a", // map backdrop
        panel: "#1a1b1e", // side panels
        elevated: "#202226", // inner cards
        border: "#26282c",
        muted: "#9a9a95",
        subtle: "#6a6c70",
        fg: "#e8e8e6",
        accent: { DEFAULT: "#1d9e75", fg: "#5dcaa5" },
        draw: { DEFAULT: "#378add", fg: "#85b7eb" },
        warning: { DEFAULT: "#ef9f27", fg: "#efb968" },
        danger: { DEFAULT: "#a33", fg: "#e88f8f" },
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "monospace"],
      },
      borderRadius: { card: "12px" },
    },
  },
  plugins: [],
};
export default config;
```

- [ ] **Step 4: Create `app/globals.css`**

```css
/* apps/web/app/globals.css */
@tailwind base;
@tailwind components;
@tailwind utilities;

html, body {
  height: 100%;
}
body {
  background: #0e0f11;
  color: #e8e8e6;
}
/* Map libraries ship their own CSS; import per-component to keep it client-only. */
```

- [ ] **Step 5: Create the root layout**

```tsx
// apps/web/app/layout.tsx
import "./globals.css";
import { Inter, JetBrains_Mono } from "next/font/google";

const sans = Inter({ subsets: ["latin"], variable: "--font-sans" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono" });

export const metadata = {
  title: "Lumi",
  description: "Street-level geolocation dashboard",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className={`${sans.variable} ${mono.variable}`}>
      <body className="font-sans bg-bg text-fg">{children}</body>
    </html>
  );
}
```

- [ ] **Step 6: Strip `<html>`/`<body>` from the segment layouts**

`app/setup/layout.tsx` and `app/settings/layout.tsx` currently render `<html><body>{children}</body></html>`. Replace each entire file body's return with a plain pass-through so the root layout owns the document:

```tsx
// apps/web/app/setup/layout.tsx
export default function SetupLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
```

```tsx
// apps/web/app/settings/layout.tsx
export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
```

- [ ] **Step 7: Verify the build and existing pages still render**

Run: `cd apps/web && pnpm build`
Expected: `Compiled successfully`; `/setup` and `/settings` still listed. Then `pnpm dev` and open `/settings` — it renders on a dark (`#0e0f11`) background with no styling regressions (unstyled form is fine; Tailwind base reset applied).

- [ ] **Step 8: Commit**

```bash
git add apps/web/package.json apps/web/pnpm-lock.yaml apps/web/tailwind.config.ts apps/web/postcss.config.js apps/web/app/globals.css apps/web/app/layout.tsx apps/web/app/setup/layout.tsx apps/web/app/settings/layout.tsx
git commit -m "feat(web): Tailwind dark theme + real root layout (spec §5)"
```

---

### Task 2: Shared UI primitives + AppShell

Build the translucent primitives and the left-rail shell used by every screen.

**Files:**
- Create: `apps/web/app/components/Badge.tsx`, `FloatingCard.tsx`, `ProgressMeter.tsx`, `AppShell.tsx`
- Modify: `apps/web/app/(protected)/layout.tsx`

**Interfaces:**
- Produces: `<Badge tone="accent|draw|warning|danger|muted">`, `<FloatingCard>` (translucent + blur), `<ProgressMeter label value max tone>`, `<AppShell>` (icon rail + `<main>` slot).

- [ ] **Step 1: `Badge.tsx`**

```tsx
// apps/web/app/components/Badge.tsx
const TONES = {
  accent: "bg-accent/15 text-accent-fg",
  draw: "bg-draw/15 text-draw-fg",
  warning: "bg-warning/15 text-warning-fg",
  danger: "bg-danger/20 text-danger-fg",
  muted: "bg-white/5 text-muted",
} as const;

export function Badge({
  tone = "muted",
  children,
}: {
  tone?: keyof typeof TONES;
  children: React.ReactNode;
}) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs ${TONES[tone]}`}>
      {children}
    </span>
  );
}
```

- [ ] **Step 2: `FloatingCard.tsx`** (the translucency requirement lives here)

```tsx
// apps/web/app/components/FloatingCard.tsx
export function FloatingCard({
  className = "",
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  // Translucent + blur is intentional (design preference): panels read as glass
  // over the map, matching the Raven references — never fully opaque.
  return (
    <div
      className={`rounded-card border border-white/10 bg-panel/80 backdrop-blur-md shadow-lg shadow-black/40 ${className}`}
    >
      {children}
    </div>
  );
}
```

- [ ] **Step 3: `ProgressMeter.tsx`**

```tsx
// apps/web/app/components/ProgressMeter.tsx
const BAR = { draw: "bg-draw", accent: "bg-accent" } as const;

export function ProgressMeter({
  label,
  value,
  max,
  tone = "draw",
}: {
  label: string;
  value: number;
  max: number;
  tone?: keyof typeof BAR;
}) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div>
      <div className="mb-1.5 flex justify-between text-xs">
        <span className="text-muted">{label}</span>
        <span className="font-medium text-fg">
          {value.toLocaleString()} / {max.toLocaleString()}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-border">
        <div className={`h-full ${BAR[tone]}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
```

- [ ] **Step 4: `AppShell.tsx`** (left icon rail + content)

```tsx
// apps/web/app/components/AppShell.tsx
import Link from "next/link";

const NAV = [
  { href: "/", label: "Buscar", icon: "M21 21l-4.35-4.35M11 19a8 8 0 100-16 8 8 0 000 16z" },
  { href: "/index", label: "Indexar", icon: "M12 2l9 4.5-9 4.5-9-4.5L12 2zM3 12l9 4.5 9-4.5M3 17l9 4.5 9-4.5" },
  { href: "/areas", label: "Áreas", icon: "M3 7l6-3 6 3 6-3v13l-6 3-6-3-6 3V7z" },
];

function RailIcon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className="h-5 w-5">
      <path d={d} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen w-screen overflow-hidden">
      <nav className="flex w-12 flex-col items-center gap-5 border-r border-border bg-[#141517] py-4">
        <span className="text-accent-fg">
          <RailIcon d="M12 2l9 4.5-9 4.5-9-4.5L12 2z" />
        </span>
        {NAV.map((n) => (
          <Link key={n.href} href={n.href} title={n.label} className="text-subtle hover:text-fg">
            <RailIcon d={n.icon} />
          </Link>
        ))}
        <div className="flex-1" />
        <Link href="/settings" title="Configuración" className="text-subtle hover:text-fg">
          <RailIcon d="M12 15a3 3 0 100-6 3 3 0 000 6z M19.4 15a7.97 7.97 0 000-6l1.5-2.6-2-3.4-2.9.9a8 8 0 00-5-2.9L10 0H6l-.5 2.9a8 8 0 00-5 2.9L-2.4 5l-2 3.4 1.5 2.6" />
        </Link>
      </nav>
      <main className="relative flex-1 overflow-hidden bg-surface">{children}</main>
    </div>
  );
}
```

> Icon paths are inline SVG (no icon dependency). Keep them simple; refine visually during Step 6.

- [ ] **Step 5: Move `resolveGateDecision` out of `layout.tsx`, then wrap children in `AppShell`**

**Route-export rule applies to `layout.tsx` too, not just `route.ts`** — confirmed by actually running `pnpm build`: Next.js App Router layout modules may only export `default` plus a fixed set of config names (`metadata`, `viewport`, ...); the pre-existing `export async function resolveGateDecision(...)` and `export type GateDecision` in `(protected)/layout.tsx` fail the build's type check (`next dev` doesn't catch it, which is why it went unnoticed). Move both into a sibling module first.

```typescript
// apps/web/app/(protected)/gate.ts
import type { SettingsRepo } from "../../lib/settings-repo";

export type GateDecision = { type: "allow" } | { type: "redirect"; to: string };

export async function resolveGateDecision(
  repo: Pick<SettingsRepo, "isSetupCompleted">
): Promise<GateDecision> {
  const completed = await repo.isSetupCompleted();
  return completed ? { type: "allow" } : { type: "redirect", to: "/setup" };
}
```

Update `(protected)/layout.test.ts`'s import from `./layout` to `./gate`.

Then modify `app/(protected)/layout.tsx` — keep the redirect logic exactly as-is, only change the import and the returned JSX:

```tsx
// apps/web/app/(protected)/layout.tsx
import { redirect } from "next/navigation";
import { AppShell } from "../components/AppShell";
import { getSettingsRepo } from "../../lib/settings-repo";
import { resolveGateDecision } from "./gate";

export default async function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const decision = await resolveGateDecision(getSettingsRepo());
  if (decision.type === "redirect") {
    redirect(decision.to);
  }
  return <AppShell>{children}</AppShell>;
}
```

- [ ] **Step 6: Manual verification**

Run: `pnpm dev`, then (with setup completed) open any protected route once Task 9 exists; for now temporarily add a `app/(protected)/page.tsx` returning `<div className="p-8">shell ok</div>` and open `/` — confirm the left rail renders dark with hoverable icons. Remove the temp page (Task 12 adds the real one).

- [ ] **Step 7: Commit**

```bash
git add apps/web/app/components/Badge.tsx apps/web/app/components/FloatingCard.tsx apps/web/app/components/ProgressMeter.tsx apps/web/app/components/AppShell.tsx "apps/web/app/(protected)/layout.tsx"
git commit -m "feat(web): translucent UI primitives + AppShell icon rail (spec §5, §8.2)"
```

---

### Task 3: Zustand stores (map + indexing)

**Files:**
- Modify: `apps/web/package.json` (add `zustand`)
- Create: `apps/web/app/stores/useMapStore.ts`, `useMapStore.test.ts`, `useIndexingStore.ts`, `useIndexingStore.test.ts`

**Interfaces:**
- Produces: `useMapStore` (`mode: 'search'|'draw'`, `viewport`, `setMode`, `setViewport`); `useIndexingStore` (`drawnPolygon`, `areaKm2`, `estimate`, `activeJobId`, `jobProgress`, `setDrawnPolygon`, `clearPolygon`, `setEstimate`, `startJob`, `updateProgress`, `reset`). `Estimate = { pointsEstimated: number; estimatedCostUsd: number }`. `JobProgress = { status; pointsEstimated; pointsCaptured; pointsFailed; imagesEmbedded }`.

- [ ] **Step 1: Add dependency**

```bash
cd apps/web && pnpm add zustand@^4.5.5
```

- [ ] **Step 2: Write the failing store tests**

```typescript
// apps/web/app/stores/useIndexingStore.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { useIndexingStore } from "./useIndexingStore";

beforeEach(() => useIndexingStore.getState().reset());

describe("useIndexingStore", () => {
  it("stores a drawn polygon with its area and clears it", () => {
    const poly: [number, number][] = [[0, 0], [0, 1], [1, 1], [0, 0]];
    useIndexingStore.getState().setDrawnPolygon(poly, 4.8);
    expect(useIndexingStore.getState().areaKm2).toBe(4.8);
    expect(useIndexingStore.getState().drawnPolygon).toEqual(poly);
    useIndexingStore.getState().clearPolygon();
    expect(useIndexingStore.getState().drawnPolygon).toBeNull();
    expect(useIndexingStore.getState().estimate).toBeNull();
  });

  it("tracks an active job and updates progress", () => {
    useIndexingStore.getState().startJob("area-1");
    expect(useIndexingStore.getState().activeJobId).toBe("area-1");
    useIndexingStore.getState().updateProgress({
      status: "indexing",
      pointsEstimated: 2300,
      pointsCaptured: 1842,
      pointsFailed: 0,
      imagesEmbedded: 6920,
    });
    expect(useIndexingStore.getState().jobProgress?.pointsCaptured).toBe(1842);
  });
});
```

```typescript
// apps/web/app/stores/useMapStore.test.ts
import { describe, it, expect } from "vitest";
import { useMapStore } from "./useMapStore";

describe("useMapStore", () => {
  it("defaults to search mode and switches to draw", () => {
    expect(useMapStore.getState().mode).toBe("search");
    useMapStore.getState().setMode("draw");
    expect(useMapStore.getState().mode).toBe("draw");
    useMapStore.getState().setMode("search");
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd apps/web && pnpm test stores`
Expected: FAIL — `Cannot find module './useIndexingStore'`.

- [ ] **Step 4: Implement the stores**

```typescript
// apps/web/app/stores/useMapStore.ts
import { create } from "zustand";

export interface Viewport {
  lat: number;
  lng: number;
  zoom: number;
}

interface MapState {
  mode: "search" | "draw";
  viewport: Viewport;
  setMode: (mode: MapState["mode"]) => void;
  setViewport: (viewport: Viewport) => void;
}

export const useMapStore = create<MapState>((set) => ({
  mode: "search",
  viewport: { lat: 42.6, lng: -5.57, zoom: 12 }, // León (spec test area); overridden by user pan
  setMode: (mode) => set({ mode }),
  setViewport: (viewport) => set({ viewport }),
}));
```

```typescript
// apps/web/app/stores/useIndexingStore.ts
import { create } from "zustand";
import type { AreaStatus } from "@netryx/shared-types";

export interface Estimate {
  pointsEstimated: number;
  estimatedCostUsd: number;
}
export interface JobProgress {
  status: AreaStatus;
  pointsEstimated: number;
  pointsCaptured: number;
  pointsFailed: number;
  imagesEmbedded: number;
}

interface IndexingState {
  drawnPolygon: [number, number][] | null;
  areaKm2: number;
  estimate: Estimate | null;
  activeJobId: string | null;
  jobProgress: JobProgress | null;
  setDrawnPolygon: (polygon: [number, number][], areaKm2: number) => void;
  clearPolygon: () => void;
  setEstimate: (estimate: Estimate) => void;
  startJob: (areaId: string) => void;
  updateProgress: (progress: JobProgress) => void;
  reset: () => void;
}

const INITIAL = {
  drawnPolygon: null,
  areaKm2: 0,
  estimate: null,
  activeJobId: null,
  jobProgress: null,
};

export const useIndexingStore = create<IndexingState>((set) => ({
  ...INITIAL,
  setDrawnPolygon: (drawnPolygon, areaKm2) => set({ drawnPolygon, areaKm2, estimate: null }),
  clearPolygon: () => set({ ...INITIAL }),
  setEstimate: (estimate) => set({ estimate }),
  startJob: (activeJobId) => set({ activeJobId }),
  updateProgress: (jobProgress) => set({ jobProgress }),
  reset: () => set({ ...INITIAL }),
}));
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd apps/web && pnpm test stores`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/stores apps/web/package.json apps/web/pnpm-lock.yaml
git commit -m "feat(web): Zustand map + indexing stores (spec §13)"
```

---

### Task 4: `GET /api/map-config`

The client must know which renderer to load and with what style/token. `MAPBOX_TOKEN` is stored encrypted in `system_settings`; it is decrypted server-side and returned to the client because Mapbox GL runs in the browser (Mapbox public tokens are client-side by design — documented, not a leak).

**Files:**
- Create: `apps/web/app/api/map-config/route.ts`

**Interfaces:**
- Produces: `GET /api/map-config` → `{ provider: "mapbox" | "maplibre", styleUrl: string, mapboxToken: string | null }`.

- [ ] **Step 1: Implement the route**

```typescript
// apps/web/app/api/map-config/route.ts
import { NextResponse } from "next/server";
import { getSettingsRepo } from "../../../lib/settings-repo";

// OpenFreeMap "liberty" is free, keyless, and uses the OpenMapTiles schema —
// its `building` layer carries render_height/render_min_height, which is what
// makes 3D extrusion possible without a Mapbox token (spec §5.1).
const MAPLIBRE_STYLE = "https://tiles.openfreemap.org/styles/liberty";
const MAPBOX_DARK_STYLE = "mapbox://styles/mapbox/dark-v11";

export async function GET() {
  const token = (await getSettingsRepo().getSetting("MAPBOX_TOKEN")) || null;
  if (token) {
    return NextResponse.json({ provider: "mapbox", styleUrl: MAPBOX_DARK_STYLE, mapboxToken: token });
  }
  return NextResponse.json({ provider: "maplibre", styleUrl: MAPLIBRE_STYLE, mapboxToken: null });
}
```

- [ ] **Step 2: Manual verification**

Run: `pnpm dev`, then `curl -s http://localhost:3000/api/map-config | jq`.
Expected: with no `MAPBOX_TOKEN` set → `{"provider":"maplibre","styleUrl":"https://tiles.openfreemap.org/styles/liberty","mapboxToken":null}`. Set a token via `/settings` and re-run → `provider: "mapbox"` with the token echoed.

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/api/map-config/route.ts
git commit -m "feat(web): GET /api/map-config — MapLibre default, Mapbox when token present (spec §5.1)"
```

---

### Task 5: `MapCanvas` — client-only, provider switch, 3D buildings

The shared map. A thin server-safe wrapper (`MapCanvas.tsx`) dynamically imports the real client component (`MapCanvas.client.tsx`), which fetches `/api/map-config`, loads the matching library + CSS, initializes the map, adds a 3D buildings extrusion layer for whichever provider is active, and syncs the viewport to `useMapStore`.

**Files:**
- Modify: `apps/web/package.json` (add `maplibre-gl`, `mapbox-gl`, `@types/mapbox-gl`)
- Create: `apps/web/app/components/MapCanvas.tsx`, `apps/web/app/components/MapCanvas.client.tsx`, `apps/web/app/lib/map-buildings.ts`

**Interfaces:**
- Consumes: `useMapStore`, `GET /api/map-config`.
- Produces: `<MapCanvas onReady={(map, provider) => void} />` — `map` is a `maplibregl.Map | mapboxgl.Map` (near-identical APIs); `provider` tells consumers which one. `addBuildingsLayer(map, provider)`.

- [ ] **Step 1: Add dependencies**

```bash
cd apps/web && pnpm add maplibre-gl@^4.7.1 mapbox-gl@^3.6.0 && pnpm add -D @types/mapbox-gl@^3.4.0
```

- [ ] **Step 2: Implement the 3D buildings helper**

```typescript
// apps/web/app/lib/map-buildings.ts
// Adds a fill-extrusion buildings layer. The source-layer + height fields differ
// per provider, but both produce real 3D buildings (spec §5, design requirement).
export function addBuildingsLayer(map: any, provider: "mapbox" | "maplibre"): void {
  const isMapbox = provider === "mapbox";
  const sourceLayer = isMapbox ? "building" : "building";
  const heightField = isMapbox ? "height" : "render_height";
  const minHeightField = isMapbox ? "min_height" : "render_min_height";
  const source = isMapbox ? "composite" : "openmaptiles";

  if (map.getLayer("lumi-3d-buildings")) return;
  map.addLayer({
    id: "lumi-3d-buildings",
    type: "fill-extrusion",
    source,
    "source-layer": sourceLayer,
    minzoom: 14,
    paint: {
      "fill-extrusion-color": "#2a2d31",
      "fill-extrusion-height": ["coalesce", ["get", heightField], 0],
      "fill-extrusion-base": ["coalesce", ["get", minHeightField], 0],
      "fill-extrusion-opacity": 0.85,
    },
  });
}
```

> The OpenFreeMap "liberty" style's vector source is named `openmaptiles` with a `building` source-layer carrying `render_height`. If a future style renames the source, this is the one place to adjust.

- [ ] **Step 3: Implement the client map component**

```tsx
// apps/web/app/components/MapCanvas.client.tsx
"use client";

import { useEffect, useRef } from "react";
import { useMapStore } from "../stores/useMapStore";
import { addBuildingsLayer } from "../lib/map-buildings";

type Provider = "mapbox" | "maplibre";

export default function MapCanvasClient({
  onReady,
}: {
  onReady?: (map: any, provider: Provider) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const viewport = useMapStore.getState().viewport;
  const setViewport = useMapStore((s) => s.setViewport);

  useEffect(() => {
    let cancelled = false;
    let map: any;

    async function init() {
      const cfg = await fetch("/api/map-config").then((r) => r.json());
      if (cancelled || !container.current) return;

      let map: any;
      if (cfg.provider === "mapbox") {
        const mapboxgl = (await import("mapbox-gl")).default;
        await import("mapbox-gl/dist/mapbox-gl.css");
        mapboxgl.accessToken = cfg.mapboxToken;
        map = new mapboxgl.Map({
          container: container.current,
          style: cfg.styleUrl,
          center: [viewport.lng, viewport.lat],
          zoom: viewport.zoom,
          pitch: 45, // tilt so 3D buildings are visible
          attributionControl: true,
        });
      } else {
        const maplibregl = (await import("maplibre-gl")).default;
        await import("maplibre-gl/dist/maplibre-gl.css");
        map = new maplibregl.Map({
          container: container.current,
          style: cfg.styleUrl,
          center: [viewport.lng, viewport.lat],
          zoom: viewport.zoom,
          pitch: 45,
        });
      }
      mapRef.current = map;

      map.on("load", () => {
        addBuildingsLayer(map, cfg.provider);
        onReady?.(map, cfg.provider);
      });
      map.on("moveend", () => {
        const c = map.getCenter();
        setViewport({ lat: c.lat, lng: c.lng, zoom: map.getZoom() });
      });
    }

    init();
    return () => {
      cancelled = true;
      mapRef.current?.remove();
    };
    // onReady is intentionally not a dep — the map is created once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={container} className="absolute inset-0" />;
}
```

- [ ] **Step 4: Implement the server-safe wrapper**

```tsx
// apps/web/app/components/MapCanvas.tsx
"use client";

import dynamic from "next/dynamic";

// ssr:false is mandatory — mapbox-gl/maplibre-gl touch `window` on import (spec §5.2).
const MapCanvasClient = dynamic(() => import("./MapCanvas.client"), {
  ssr: false,
  loading: () => <div className="absolute inset-0 bg-surface" />,
});

export function MapCanvas({ onReady }: { onReady?: (map: any, provider: "mapbox" | "maplibre") => void }) {
  return <MapCanvasClient onReady={onReady} />;
}
```

- [ ] **Step 5: Manual verification**

Temporarily render `<MapCanvas />` from the temp `app/(protected)/page.tsx` (or `/index` once it exists). Run `pnpm dev`, open the page:
- With no token: a dark MapLibre/OpenFreeMap map, tilted, with grey 3D buildings visible when zoomed to ~15+ over a city.
- With a `MAPBOX_TOKEN` set in `/settings`: the Mapbox dark map with 3D buildings.
Confirm no server-side `window is not defined` error in the terminal (proves `ssr:false` works).

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/components/MapCanvas.tsx apps/web/app/components/MapCanvas.client.tsx apps/web/app/lib/map-buildings.ts apps/web/package.json apps/web/pnpm-lock.yaml
git commit -m "feat(web): client-only MapCanvas with provider switch + 3D buildings (spec §5.1, §5.2)"
```

---

### Task 6: `POST /api/areas/estimate` — cost before confirming

Spec §12.1 requires showing estimated cost *before* the confirm button. The existing `POST /api/areas` computes the estimate but also inserts + enqueues in the same call. Add a dry-run that returns the estimate without side effects, reusing `@netryx/geo-sampling`.

**Files:**
- Create: `apps/web/app/api/areas/estimate/route.ts`

**Interfaces:**
- Consumes: `fetchStreetGeometry`, `samplePointsAlongStreets`, `estimateIndexingCostUsd`, `assertAreaWithinSizeLimit` (all from `@netryx/geo-sampling`), `STREET_VIEW_HEADINGS`, `getSettingsRepo`.
- Produces: `POST /api/areas/estimate` `{ polygon, areaKm2 }` → `{ pointsEstimated, estimatedCostUsd }` or `400 { error }`.

- [ ] **Step 1: Implement the route** (mirrors the estimate half of `POST /api/areas`, minus the INSERT/enqueue)

```typescript
// apps/web/app/api/areas/estimate/route.ts
import { NextResponse } from "next/server";
import {
  fetchStreetGeometry,
  samplePointsAlongStreets,
  estimateIndexingCostUsd,
  assertAreaWithinSizeLimit,
} from "@netryx/geo-sampling";
import { STREET_VIEW_HEADINGS } from "@netryx/shared-types";
import { getSettingsRepo } from "../../../../lib/settings-repo";

const SAMPLING_SPACING_METERS = 18;

interface EstimateBody {
  polygon?: [number, number][];
  areaKm2?: number;
}

export async function POST(request: Request) {
  const body = (await request.json()) as EstimateBody;
  if (!body.polygon || !Array.isArray(body.polygon) || body.polygon.length < 4) {
    return NextResponse.json({ error: "polygon is required" }, { status: 400 });
  }
  if (typeof body.areaKm2 !== "number") {
    return NextResponse.json({ error: "areaKm2 is required" }, { status: 400 });
  }

  const repo = getSettingsRepo();
  const maxAreaKm2 = Number((await repo.getSetting("MAX_AREA_KM2")) ?? "5");
  const pricePerImageUsd = Number(
    (await repo.getSetting("STREET_VIEW_PRICE_PER_IMAGE_USD")) ?? "0.007"
  );

  try {
    assertAreaWithinSizeLimit(body.areaKm2, maxAreaKm2);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 }
    );
  }

  let lines: Awaited<ReturnType<typeof fetchStreetGeometry>>;
  try {
    lines = await fetchStreetGeometry(body.polygon);
  } catch (err) {
    // Overpass is shared public infrastructure and does fail under load even
    // after fetchStreetGeometry's own built-in retries are exhausted (see
    // the Indexing Pipeline plan's Task 4) — surface a clean, actionable
    // error instead of an unhandled 500.
    return NextResponse.json(
      { error: `Could not reach the street data service — try again in a moment (${err instanceof Error ? err.message : String(err)})` },
      { status: 502 }
    );
  }

  const points = samplePointsAlongStreets(lines, SAMPLING_SPACING_METERS);
  const estimatedCostUsd = estimateIndexingCostUsd(
    points.length,
    STREET_VIEW_HEADINGS.length,
    pricePerImageUsd
  );

  return NextResponse.json({ pointsEstimated: points.length, estimatedCostUsd });
}
```

- [ ] **Step 2: Manual verification**

```bash
curl -s -X POST http://localhost:3000/api/areas/estimate \
  -H "content-type: application/json" \
  -d '{"polygon":[[-5.58,42.59],[-5.55,42.59],[-5.55,42.61],[-5.58,42.61],[-5.58,42.59]],"areaKm2":4.8}' | jq
```
Expected: `{ "pointsEstimated": <n>, "estimatedCostUsd": <n> }` (requires `GOOGLE_MAPS_API_KEY` configured for Overpass — Overpass itself needs no key, so this works even pre-setup; an oversized area returns `400`).

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/api/areas/estimate/route.ts
git commit -m "feat(web): POST /api/areas/estimate — cost preview before confirm (spec §12.1)"
```

---

### Task 7: `IndexingDrawTool` + client-side area math

Draw a polygon on the map, compute its area live, and warn if it exceeds the limit. Area math is a pure function (tested); the draw wiring is a component (manual).

**Files:**
- Modify: `apps/web/package.json` (add `@mapbox/mapbox-gl-draw`, `@turf/turf`, types)
- Create: `apps/web/app/lib/geo.ts`, `apps/web/app/lib/geo.test.ts`, `apps/web/app/components/IndexingDrawTool.tsx`

**Interfaces:**
- Consumes: a live map instance (from `MapCanvas` `onReady`), `useIndexingStore`.
- Produces: `polygonAreaKm2(ring: [number, number][]): number`; `ringToPolygon(ring)`; `<IndexingDrawTool map={...} />` that writes `setDrawnPolygon` on draw/update and `clearPolygon` on delete.

- [ ] **Step 1: Add dependencies**

```bash
cd apps/web && pnpm add @mapbox/mapbox-gl-draw@^1.4.3 @turf/turf@^7.1.0 && pnpm add -D @types/mapbox__mapbox-gl-draw@^1.4.6
```

- [ ] **Step 2: Write the failing area test**

```typescript
// apps/web/app/lib/geo.test.ts
import { describe, it, expect } from "vitest";
import { polygonAreaKm2 } from "./geo";

describe("polygonAreaKm2", () => {
  it("computes the area of a ~1km x ~1km box near the equator as ~1 km²", () => {
    // 0.009 deg lat ~= 1 km; at the equator 0.009 deg lng ~= 1 km too.
    const ring: [number, number][] = [
      [0, 0],
      [0.009, 0],
      [0.009, 0.009],
      [0, 0.009],
      [0, 0],
    ];
    const area = polygonAreaKm2(ring);
    expect(area).toBeGreaterThan(0.9);
    expect(area).toBeLessThan(1.1);
  });

  it("returns 0 for a degenerate ring", () => {
    expect(polygonAreaKm2([[0, 0], [0, 0], [0, 0]])).toBe(0);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd apps/web && pnpm test geo.test.ts`
Expected: FAIL — `Cannot find module './geo'`.

- [ ] **Step 4: Implement `geo.ts`**

```typescript
// apps/web/app/lib/geo.ts
import * as turf from "@turf/turf";

/** Closed GeoJSON polygon ([lng,lat] ring, first==last) from a draw ring. */
export function ringToPolygon(ring: [number, number][]): GeoJSON.Feature<GeoJSON.Polygon> {
  const closed =
    ring.length > 0 && (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1])
      ? [...ring, ring[0]]
      : ring;
  return turf.polygon([closed]);
}

/** Area of a [lng,lat] ring in km² (turf.area returns m²). */
export function polygonAreaKm2(ring: [number, number][]): number {
  if (ring.length < 4) return 0;
  try {
    return turf.area(ringToPolygon(ring)) / 1_000_000;
  } catch {
    return 0;
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd apps/web && pnpm test geo.test.ts`
Expected: PASS.

- [ ] **Step 6: Implement `IndexingDrawTool.tsx`**

```tsx
// apps/web/app/components/IndexingDrawTool.tsx
"use client";

import { useEffect } from "react";
import { useIndexingStore } from "../stores/useIndexingStore";
import { polygonAreaKm2 } from "../lib/geo";

// @mapbox/mapbox-gl-draw works with both mapbox-gl and maplibre-gl instances
// (maplibre is API-compatible). CSS imported client-side only.
export function IndexingDrawTool({ map }: { map: any }) {
  const setDrawnPolygon = useIndexingStore((s) => s.setDrawnPolygon);
  const clearPolygon = useIndexingStore((s) => s.clearPolygon);

  useEffect(() => {
    if (!map) return;
    let draw: any;
    let disposed = false;

    async function attach() {
      const MapboxDraw = (await import("@mapbox/mapbox-gl-draw")).default;
      await import("@mapbox/mapbox-gl-draw/dist/mapbox-gl-draw.css");
      if (disposed) return;
      draw = new MapboxDraw({
        displayControlsDefault: false,
        controls: { polygon: true, trash: true },
      });
      map.addControl(draw);

      const sync = () => {
        const fc = draw.getAll();
        const feature = fc.features[0];
        if (!feature) {
          clearPolygon();
          return;
        }
        const ring = (feature.geometry as GeoJSON.Polygon).coordinates[0] as [number, number][];
        setDrawnPolygon(ring, polygonAreaKm2(ring));
      };

      map.on("draw.create", sync);
      map.on("draw.update", sync);
      map.on("draw.delete", () => clearPolygon());
    }

    attach();
    return () => {
      disposed = true;
      if (draw && map) {
        try {
          map.removeControl(draw);
        } catch {
          // MapCanvas's own unmount cleanup calls map.remove(), which itself
          // removes every attached control internally (calling its onRemove).
          // If that ran first, this control's internal state (ctx.map) is
          // already null and calling removeControl again throws — confirmed
          // by actually navigating away from /index and hitting exactly this
          // crash. Nothing left to clean up in that case; the map is being
          // torn down regardless.
        }
      }
    };
  }, [map, setDrawnPolygon, clearPolygon]);

  return null;
}
```

- [ ] **Step 7: Run the web test suite**

Run: `cd apps/web && pnpm test`
Expected: PASS — geo tests + all existing.

- [ ] **Step 8: Commit**

```bash
git add apps/web/app/lib/geo.ts apps/web/app/lib/geo.test.ts apps/web/app/components/IndexingDrawTool.tsx apps/web/package.json apps/web/pnpm-lock.yaml
git commit -m "feat(web): polygon draw tool + live area calc (spec §6.1, §12.2)"
```

---

### Task 8: SSE progress — parser + hook

Consume `GET /api/areas/[id]/progress`. The parser (turning an SSE `data:` line into a `JobProgress`) is pure and tested; the `EventSource` hook is thin.

**Files:**
- Create: `apps/web/app/lib/progress-stream.ts`, `progress-stream.test.ts`, `apps/web/app/lib/useAreaProgress.ts`

**Interfaces:**
- Consumes: the SSE payload shape from `formatProgressEvent` (`{ status, pointsEstimated, pointsCaptured, pointsFailed, imagesEmbedded }`), `useIndexingStore.updateProgress`.
- Produces: `parseProgressData(json: string): JobProgress`; `isTerminal(status): boolean`; `useAreaProgress(areaId: string | null)` (subscribes, updates store, closes on terminal).

- [ ] **Step 1: Write the failing parser test**

```typescript
// apps/web/app/lib/progress-stream.test.ts
import { describe, it, expect } from "vitest";
import { parseProgressData, isTerminal } from "./progress-stream";

describe("parseProgressData", () => {
  it("parses the SSE data JSON into a JobProgress", () => {
    const json =
      '{"status":"indexing","pointsEstimated":100,"pointsCaptured":40,"pointsFailed":2,"imagesEmbedded":38}';
    expect(parseProgressData(json)).toEqual({
      status: "indexing",
      pointsEstimated: 100,
      pointsCaptured: 40,
      pointsFailed: 2,
      imagesEmbedded: 38,
    });
  });
});

describe("isTerminal", () => {
  it("treats indexed and failed as terminal", () => {
    expect(isTerminal("indexed")).toBe(true);
    expect(isTerminal("failed")).toBe(true);
    expect(isTerminal("indexing")).toBe(false);
    expect(isTerminal("pending")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && pnpm test progress-stream.test.ts`
Expected: FAIL — `Cannot find module './progress-stream'`.

- [ ] **Step 3: Implement `progress-stream.ts`**

```typescript
// apps/web/app/lib/progress-stream.ts
import type { AreaStatus } from "@netryx/shared-types";
import type { JobProgress } from "../stores/useIndexingStore";

export function isTerminal(status: AreaStatus): boolean {
  return status === "indexed" || status === "failed";
}

export function parseProgressData(json: string): JobProgress {
  const p = JSON.parse(json) as JobProgress;
  return {
    status: p.status,
    pointsEstimated: p.pointsEstimated,
    pointsCaptured: p.pointsCaptured,
    pointsFailed: p.pointsFailed,
    imagesEmbedded: p.imagesEmbedded,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && pnpm test progress-stream.test.ts`
Expected: PASS.

- [ ] **Step 5: Implement `useAreaProgress.ts`**

```typescript
// apps/web/app/lib/useAreaProgress.ts
"use client";

import { useEffect } from "react";
import { useIndexingStore } from "../stores/useIndexingStore";
import { parseProgressData, isTerminal } from "./progress-stream";

/** Subscribes to the SSE progress stream for an area and pushes into the store. */
export function useAreaProgress(areaId: string | null): void {
  const updateProgress = useIndexingStore((s) => s.updateProgress);

  useEffect(() => {
    if (!areaId) return;
    const es = new EventSource(`/api/areas/${areaId}/progress`);
    es.onmessage = (e) => {
      const progress = parseProgressData(e.data);
      updateProgress(progress);
      if (isTerminal(progress.status)) es.close();
    };
    es.onerror = () => es.close();
    return () => es.close();
  }, [areaId, updateProgress]);
}
```

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/lib/progress-stream.ts apps/web/app/lib/progress-stream.test.ts apps/web/app/lib/useAreaProgress.ts
git commit -m "feat(web): SSE progress parser + useAreaProgress hook (spec §6.2)"
```

---

### Task 9: `/index` route + `JobProgressBar`

Compose the full indexing screen: `MapCanvas` (draw mode) + `IndexingDrawTool` + a translucent right panel that walks draw → estimate → confirm → live progress.

**Files:**
- Create: `apps/web/app/(protected)/index/page.tsx`, `apps/web/app/components/JobProgressBar.tsx`

**Interfaces:**
- Consumes: `MapCanvas`, `IndexingDrawTool`, `FloatingCard`, `ProgressMeter`, `Badge`, `useIndexingStore`, `useMapStore`, `useAreaProgress`, `POST /api/areas/estimate`, `POST /api/areas`.

- [ ] **Step 1: Implement `JobProgressBar.tsx`**

```tsx
// apps/web/app/components/JobProgressBar.tsx
"use client";

import { useIndexingStore } from "../stores/useIndexingStore";
import { useAreaProgress } from "../lib/useAreaProgress";
import { ProgressMeter } from "./ProgressMeter";
import { Badge } from "./Badge";

export function JobProgressBar() {
  const activeJobId = useIndexingStore((s) => s.activeJobId);
  const p = useIndexingStore((s) => s.jobProgress);
  useAreaProgress(activeJobId);

  if (!activeJobId) return null;
  const status = p?.status ?? "pending";
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-fg">Indexando</span>
        <Badge tone={status === "failed" ? "danger" : status === "indexed" ? "accent" : "draw"}>
          {status}
        </Badge>
      </div>
      <ProgressMeter
        label="Puntos de captura"
        value={p?.pointsCaptured ?? 0}
        max={p?.pointsEstimated ?? 0}
      />
      <ProgressMeter
        label="Imágenes embebidas"
        value={p?.imagesEmbedded ?? 0}
        max={(p?.pointsEstimated ?? 0) * 4}
      />
      {(p?.pointsFailed ?? 0) > 0 && (
        <p className="text-xs text-warning-fg">{p?.pointsFailed} puntos sin cobertura</p>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Implement `/index/page.tsx`**

```tsx
// apps/web/app/(protected)/index/page.tsx
"use client";

import { useState } from "react";
import { MapCanvas } from "../../components/MapCanvas";
import { IndexingDrawTool } from "../../components/IndexingDrawTool";
import { FloatingCard } from "../../components/FloatingCard";
import { JobProgressBar } from "../../components/JobProgressBar";
import { useIndexingStore } from "../../stores/useIndexingStore";

export default function IndexPage() {
  const [map, setMap] = useState<any>(null);
  const { drawnPolygon, areaKm2, estimate, activeJobId, setEstimate, startJob } = useIndexingStore();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleEstimate() {
    if (!drawnPolygon) return;
    setBusy(true);
    setError(null);
    const res = await fetch("/api/areas/estimate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ polygon: drawnPolygon, areaKm2 }),
    });
    const json = await res.json();
    setBusy(false);
    if (!res.ok) return setError(json.error);
    setEstimate({ pointsEstimated: json.pointsEstimated, estimatedCostUsd: json.estimatedCostUsd });
  }

  async function handleConfirm() {
    if (!drawnPolygon) return;
    setBusy(true);
    const res = await fetch("/api/areas", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ polygon: drawnPolygon, areaKm2 }),
    });
    const json = await res.json();
    setBusy(false);
    if (!res.ok) return setError(json.error);
    startJob(json.areaId);
  }

  return (
    <>
      <MapCanvas onReady={(m) => setMap(m)} />
      {map && <IndexingDrawTool map={map} />}

      {drawnPolygon && (
        <div className="absolute left-4 top-4">
          <FloatingCard className="px-3 py-2 text-xs text-fg">
            Área dibujada: {areaKm2.toFixed(1)} km²
          </FloatingCard>
        </div>
      )}

      <div className="absolute right-4 top-4 w-72">
        <FloatingCard className="p-4">
          <h1 className="text-sm font-medium text-fg">Indexar área</h1>
          {!drawnPolygon && !activeJobId && (
            <p className="mt-1 text-xs text-muted">Dibuja un polígono sobre el mapa para empezar.</p>
          )}

          {activeJobId ? (
            <div className="mt-4">
              <JobProgressBar />
            </div>
          ) : drawnPolygon ? (
            <div className="mt-4 space-y-3">
              {!estimate ? (
                <button
                  onClick={handleEstimate}
                  disabled={busy}
                  className="w-full rounded-md bg-elevated py-2 text-xs text-fg hover:bg-white/10"
                >
                  {busy ? "Calculando…" : "Estimar coste"}
                </button>
              ) : (
                <>
                  <div>
                    <div className="text-[11px] uppercase tracking-wide text-subtle">Coste estimado</div>
                    <div className="mt-1 text-2xl font-medium text-accent-fg">
                      ~${estimate.estimatedCostUsd.toFixed(2)}
                    </div>
                    <div className="mt-1 text-xs text-muted">
                      {estimate.pointsEstimated.toLocaleString()} puntos ·{" "}
                      {(estimate.pointsEstimated * 4).toLocaleString()} imágenes
                    </div>
                  </div>
                  <button
                    onClick={handleConfirm}
                    disabled={busy}
                    className="w-full rounded-md bg-accent py-2.5 text-xs font-medium text-black hover:brightness-110"
                  >
                    Indexar área
                  </button>
                </>
              )}
            </div>
          ) : null}

          {error && <p className="mt-3 text-xs text-danger-fg">{error}</p>}
        </FloatingCard>
      </div>
    </>
  );
}
```

- [ ] **Step 3: Manual end-to-end verification**

Run: Postgres + worker + inference up, `pnpm dev`. Open `/index`:
1. Draw a polygon → "Área dibujada: X km²" chip appears, right panel shows "Estimar coste".
2. Click "Estimar coste" → cost + points/images appear (calls `/api/areas/estimate`).
3. Click "Indexar área" → the panel switches to live progress bars that advance as the worker processes (SSE), ending at `indexed`.

- [ ] **Step 4: Commit**

```bash
git add "apps/web/app/(protected)/index/page.tsx" apps/web/app/components/JobProgressBar.tsx
git commit -m "feat(web): /index — draw, estimate, confirm, live SSE progress (spec §6.1, §8.1, §12.1)"
```

---

### Task 10: `GET`/`DELETE /api/areas/[id]` + reindex

`/areas/[id]` needs a single area with its captured points as GeoJSON; management needs delete and reindex.

**Files:**
- Create: `apps/web/app/api/areas/[id]/route.ts`

**Interfaces:**
- Consumes: `getPool`, `enqueueIndexAreaJob` (existing `lib/queue`).
- Produces: `GET /api/areas/[id]` → `{ area, points: GeoJSON.FeatureCollection }`; `DELETE /api/areas/[id]` → `204`; `POST /api/areas/[id]` (`{ action: "reindex" }`) → re-enqueues, `202`.

- [ ] **Step 1: Implement the route**

```typescript
// apps/web/app/api/areas/[id]/route.ts
import { NextResponse } from "next/server";
import { getPool } from "../../../../lib/db";
import { enqueueIndexAreaJob } from "../../../../lib/queue";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const pool = getPool();
  const areaRes = await pool.query(
    `SELECT id, name, area_km2, status, points_estimated, points_captured,
            points_failed, images_embedded, estimated_cost_usd, actual_cost_usd, created_at,
            ST_AsGeoJSON(geometry) AS geometry
     FROM areas WHERE id = $1`,
    [params.id]
  );
  if (areaRes.rows.length === 0) {
    return NextResponse.json({ error: "area not found" }, { status: 404 });
  }
  const pointsRes = await pool.query(
    `SELECT id, pano_id, heading,
            ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng
     FROM indexed_images WHERE area_id = $1`,
    [params.id]
  );
  const points: GeoJSON.FeatureCollection = {
    type: "FeatureCollection",
    features: pointsRes.rows.map((r) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [Number(r.lng), Number(r.lat)] },
      properties: { id: r.id, panoId: r.pano_id, heading: r.heading },
    })),
  };
  const a = areaRes.rows[0];
  return NextResponse.json({
    area: { ...a, geometry: JSON.parse(a.geometry) },
    points,
  });
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const pool = getPool();
  const res = await pool.query(`DELETE FROM areas WHERE id = $1`, [params.id]);
  if (res.rowCount === 0) return NextResponse.json({ error: "area not found" }, { status: 404 });
  return new NextResponse(null, { status: 204 }); // indexed_images cascade on FK
}

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const body = (await request.json().catch(() => ({}))) as { action?: string };
  if (body.action !== "reindex") {
    return NextResponse.json({ error: "unsupported action" }, { status: 400 });
  }
  const pool = getPool();
  const res = await pool.query(
    `UPDATE areas SET status = 'pending' WHERE id = $1 RETURNING id`,
    [params.id]
  );
  if (res.rowCount === 0) return NextResponse.json({ error: "area not found" }, { status: 404 });
  await enqueueIndexAreaJob({ areaId: params.id });
  return NextResponse.json({ areaId: params.id }, { status: 202 });
}
```

> Confirm `lib/queue` exports `enqueueIndexAreaJob` (it's used by `app/api/areas/route.ts`). Reindex re-inserts the same pano/heading rows harmlessly — `insertIndexedImages` uses `ON CONFLICT DO NOTHING`.

- [ ] **Step 2: Manual verification**

```bash
# with an indexed area id:
curl -s http://localhost:3000/api/areas/<id> | jq '.area.status, (.points.features | length)'
curl -s -X POST http://localhost:3000/api/areas/<id> -H 'content-type: application/json' -d '{"action":"reindex"}' -w '%{http_code}\n'
curl -s -X DELETE http://localhost:3000/api/areas/<id> -w '%{http_code}\n'
```
Expected: GET returns the area + point count; reindex → `202` and the worker picks it up again; delete → `204` and the row (and its `indexed_images`) are gone.

- [ ] **Step 3: Commit**

```bash
git add "apps/web/app/api/areas/[id]/route.ts"
git commit -m "feat(web): GET/DELETE/reindex single area (spec §8.1)"
```

---

### Task 11: `/areas` list + `AreaCard`

**Files:**
- Create: `apps/web/app/(protected)/areas/page.tsx`, `apps/web/app/components/AreaCard.tsx`, `apps/web/app/lib/area-status.ts`, `apps/web/app/lib/area-status.test.ts`

**Interfaces:**
- Consumes: `GET /api/areas`, `Badge`, `AreaStatus`.
- Produces: `statusTone(status: AreaStatus): "accent"|"draw"|"warning"|"danger"`; `<AreaCard area={...} />`.

- [ ] **Step 1: Write the failing status-tone test**

```typescript
// apps/web/app/lib/area-status.test.ts
import { describe, it, expect } from "vitest";
import { statusTone } from "./area-status";

describe("statusTone", () => {
  it("maps each area status to a badge tone", () => {
    expect(statusTone("indexed")).toBe("accent");
    expect(statusTone("indexing")).toBe("draw");
    expect(statusTone("pending")).toBe("warning");
    expect(statusTone("failed")).toBe("danger");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && pnpm test area-status.test.ts`
Expected: FAIL — `Cannot find module './area-status'`.

- [ ] **Step 3: Implement `area-status.ts`**

```typescript
// apps/web/app/lib/area-status.ts
import type { AreaStatus } from "@netryx/shared-types";

export function statusTone(status: AreaStatus): "accent" | "draw" | "warning" | "danger" {
  switch (status) {
    case "indexed":
      return "accent";
    case "indexing":
      return "draw";
    case "failed":
      return "danger";
    default:
      return "warning"; // pending
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && pnpm test area-status.test.ts`
Expected: PASS.

- [ ] **Step 5: Implement `AreaCard.tsx`**

```tsx
// apps/web/app/components/AreaCard.tsx
import Link from "next/link";
import { Badge } from "./Badge";
import { statusTone } from "../lib/area-status";
import type { AreaStatus } from "@netryx/shared-types";

export interface AreaListItem {
  id: string;
  name: string | null;
  area_km2: string | number;
  status: AreaStatus;
  images_embedded: number;
  created_at: string;
}

export function AreaCard({ area }: { area: AreaListItem }) {
  return (
    <Link
      href={`/areas/${area.id}`}
      className="block rounded-card border border-border bg-panel/70 p-4 backdrop-blur-sm hover:border-white/20"
    >
      <div className="flex items-start justify-between">
        <span className="text-sm font-medium text-fg">{area.name ?? "Área sin nombre"}</span>
        <Badge tone={statusTone(area.status)}>{area.status}</Badge>
      </div>
      <div className="mt-3 flex gap-4 text-xs">
        <div>
          <div className="text-subtle">km²</div>
          <div className="mt-0.5 text-fg">{Number(area.area_km2).toFixed(1)}</div>
        </div>
        <div>
          <div className="text-subtle">imágenes</div>
          <div className="mt-0.5 text-fg">{area.images_embedded.toLocaleString()}</div>
        </div>
        <div>
          <div className="text-subtle">fecha</div>
          <div className="mt-0.5 text-fg">
            {new Date(area.created_at).toLocaleDateString("es-ES", { day: "numeric", month: "short" })}
          </div>
        </div>
      </div>
    </Link>
  );
}
```

- [ ] **Step 6: Implement `/areas/page.tsx`**

```tsx
// apps/web/app/(protected)/areas/page.tsx
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AreaCard, type AreaListItem } from "../../components/AreaCard";

export default function AreasPage() {
  const [areas, setAreas] = useState<AreaListItem[]>([]);
  useEffect(() => {
    fetch("/api/areas")
      .then((r) => r.json())
      .then((d) => setAreas(d.areas));
  }, []);

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="flex items-baseline justify-between">
        <h1 className="text-lg font-medium text-fg">Áreas indexadas</h1>
        <Link href="/index" className="rounded-md bg-accent px-3.5 py-2 text-xs font-medium text-black">
          Indexar nueva
        </Link>
      </div>
      <p className="mt-1 text-xs text-muted">{areas.length} áreas</p>
      <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {areas.map((a) => (
          <AreaCard key={a.id} area={a} />
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 7: Verify + commit**

Run: `cd apps/web && pnpm test && pnpm build`, then `pnpm dev` → `/areas` lists indexed areas with correct status badges.

```bash
git add "apps/web/app/(protected)/areas/page.tsx" apps/web/app/components/AreaCard.tsx apps/web/app/lib/area-status.ts apps/web/app/lib/area-status.test.ts
git commit -m "feat(web): /areas list with status badges (spec §8.1, §8.2)"
```

---

### Task 12: `/areas/[id]` detail + `/` redirect + final verification

Area detail: map showing the polygon + captured points, with delete/reindex. Plus the temporary `/` → `/index` redirect and a full pass.

**Files:**
- Create: `apps/web/app/(protected)/areas/[id]/page.tsx`, `apps/web/app/(protected)/page.tsx`

**Interfaces:**
- Consumes: `MapCanvas`, `FloatingCard`, `Badge`, `statusTone`, `GET /api/areas/[id]`, `DELETE`/`POST` reindex, `redirect` from `next/navigation`.

- [ ] **Step 1: Implement the `/` redirect**

```tsx
// apps/web/app/(protected)/page.tsx
import { redirect } from "next/navigation";

// The search dashboard is Part 2 (Search UI plan). Until then, land on /index.
export default function HomePage() {
  redirect("/index");
}
```

- [ ] **Step 2: Implement `/areas/[id]/page.tsx`**

```tsx
// apps/web/app/(protected)/areas/[id]/page.tsx
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { MapCanvas } from "../../../components/MapCanvas";
import { FloatingCard } from "../../../components/FloatingCard";
import { Badge } from "../../../components/Badge";
import { statusTone } from "../../../lib/area-status";

export default function AreaDetailPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const [data, setData] = useState<any>(null);
  const [map, setMap] = useState<any>(null);

  useEffect(() => {
    fetch(`/api/areas/${params.id}`)
      .then((r) => r.json())
      .then(setData);
  }, [params.id]);

  useEffect(() => {
    if (!map || !data) return;
    const draw = () => {
      if (!map.getSource("area-poly")) {
        map.addSource("area-poly", { type: "geojson", data: data.area.geometry });
        map.addLayer({
          id: "area-poly-line",
          type: "line",
          source: "area-poly",
          paint: { "line-color": "#85b7eb", "line-width": 1.5 },
        });
      }
      if (!map.getSource("area-points")) {
        map.addSource("area-points", { type: "geojson", data: data.points });
        map.addLayer({
          id: "area-points-dots",
          type: "circle",
          source: "area-points",
          paint: { "circle-radius": 2.5, "circle-color": "#5dcaa5", "circle-opacity": 0.8 },
        });
      }
    };
    if (map.isStyleLoaded()) draw();
    else map.once("load", draw);
  }, [map, data]);

  async function handleDelete() {
    await fetch(`/api/areas/${params.id}`, { method: "DELETE" });
    router.push("/areas");
  }
  async function handleReindex() {
    await fetch(`/api/areas/${params.id}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "reindex" }),
    });
    router.refresh();
  }

  return (
    <>
      <MapCanvas onReady={(m) => setMap(m)} />
      {data && (
        <div className="absolute right-4 top-4 w-72">
          <FloatingCard className="p-4">
            <div className="flex items-start justify-between">
              <h1 className="text-sm font-medium text-fg">{data.area.name ?? "Área"}</h1>
              <Badge tone={statusTone(data.area.status)}>{data.area.status}</Badge>
            </div>
            <div className="mt-3 space-y-1 text-xs text-muted">
              <div>{Number(data.area.area_km2).toFixed(1)} km²</div>
              <div>{data.area.images_embedded.toLocaleString()} imágenes embebidas</div>
              {data.area.actual_cost_usd != null && <div>Coste real: ${Number(data.area.actual_cost_usd).toFixed(2)}</div>}
            </div>
            <div className="mt-4 flex gap-2">
              <button onClick={handleReindex} className="flex-1 rounded-md bg-elevated py-2 text-xs text-fg hover:bg-white/10">
                Reindexar
              </button>
              <button onClick={handleDelete} className="flex-1 rounded-md border border-danger/40 py-2 text-xs text-danger-fg hover:bg-danger/10">
                Borrar
              </button>
            </div>
          </FloatingCard>
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 3: Full manual verification pass**

Run: full stack up (`pnpm dev` + worker + inference), then:
1. `/` redirects to `/index`.
2. Left rail navigates between Buscar (→/index for now), Indexar, Áreas, Configuración.
3. `/index`: draw → estimate → confirm → live progress to `indexed`.
4. `/areas`: the new area shows with `indexed` badge; click it.
5. `/areas/[id]`: map shows the polygon outline + green captured points; "Reindexar" re-enqueues (status → indexing), "Borrar" removes it and returns to `/areas`.
6. Confirm translucency: floating panels show the map blurred through them; confirm 3D buildings are visible at city zoom.

- [ ] **Step 4: Build + commit**

Run: `cd apps/web && pnpm build` — Expected: `Compiled successfully`, routes `/`, `/index`, `/areas`, `/areas/[id]`, `/api/map-config`, `/api/areas/estimate`, `/api/areas/[id]` all listed.

```bash
git add "apps/web/app/(protected)/areas/[id]/page.tsx" "apps/web/app/(protected)/page.tsx"
git commit -m "feat(web): /areas/[id] detail + reindex/delete + / redirect (spec §8.1)"
```

---

## Self-Review

- **Spec coverage:** §5 dark map dashboard ✔ (Tasks 1,2,5); §5.1 MapLibre-default/Mapbox-if-token ✔ (Tasks 4,5); §5.2 client-only map ✔ (Task 5 `ssr:false`); §6.1 draw→area→job→progress ✔ (Tasks 7,9); §6.2 SSE progress ✔ (Task 8,9); §8.1 routes `/index`,`/areas`,`/areas/[id]` ✔ (Tasks 9,11,12); §8.2 `MapCanvas`/`IndexingDrawTool`/`JobProgressBar`/`AreaCard` ✔; §8.3 partial-failure count shown ✔ (Task 9 `pointsFailed`), overlap surfaced — the backend already dedupes by `pano_id`; the "0 solapes" line in the mockup maps to `pointsFailed`/actual-vs-estimate and is left as a visual affordance (no overlap-count endpoint exists yet — noted, not silently dropped); §12.1 cost-before-confirm ✔ (Task 6,9); §13 stores ✔ (Task 3, `useSearchStore` deferred to Part 2).
- **Design preferences:** translucency in `FloatingCard`/`AreaCard` (Task 2,11); 3D buildings both providers (Task 5); polish is a manual-verification gate in Tasks 9/12.
- **Deferred correctly:** `/`, search components, refine, `useSearchStore` → Part 2 (Search UI). `/` redirect is explicitly temporary.
- **Type consistency:** `JobProgress`/`Estimate` defined in `useIndexingStore` (Task 3), consumed by `progress-stream` (Task 8), `JobProgressBar` (Task 9). `AreaStatus` (shared-types) drives `statusTone` (Task 11) and badges. `map: any` is deliberate — MapLibre and Mapbox map types differ; the `provider` arg from `onReady` disambiguates where it matters.
- **Assumption to verify during Task 4/6/10:** `lib/settings-repo` `getSettingsRepo` and `lib/queue` `enqueueIndexAreaJob` exist and are imported elsewhere (`app/api/areas/route.ts`) — confirmed from the Indexing Pipeline plan.
- **Manual-verification honesty:** map/WebGL components have no unit tests (jsdom has no WebGL); every such task ends with an explicit manual step. Pure logic (area math, SSE parse, status tone, stores) is unit-tested.
- **Bugs found and fixed during real execution of Task 9 Step 3 (already folded into the tasks above, not left for re-discovery):** (1) `overpass-api.de`'s front proxy 406s requests without a descriptive `User-Agent` — fixed in the Indexing Pipeline plan's `fetchStreetGeometry`, which `POST /api/areas/estimate` (Task 6) depends on. (2) `(protected)/layout.tsx`'s pre-existing named exports (`resolveGateDecision`, `GateDecision`) violate the route-export rule and fail `next build`'s type check though `next dev` doesn't catch it — fixed by moving them to `gate.ts` (Task 2 Step 5). (3) `IndexingDrawTool`'s unmount cleanup can call `removeControl` on a control `MapCanvas`'s own cleanup already tore down via `map.remove()` — fixed with a try/catch (Task 7 Step 6). (4) Confirmed live: `/api/areas/estimate` succeeded, then `POST /api/areas` 504'd moments later against the identical polygon — the public Overpass instance is shared infrastructure and does fail under load. Fixed with retry-with-backoff inside `fetchStreetGeometry` itself (Indexing Pipeline plan Task 4) plus a try/catch in both routes (Indexing Pipeline Task 14, this plan's Task 6) returning a clean `502` instead of an unhandled `500`.

---

## Execution Handoff

**Plan complete and saved to `docs/2026-07-09-dashboard-map-indexing-ui.md`.**

This is Part 1 of the Dashboard & Map UI. Part 2 (Search UI) will reuse `AppShell`, the Tailwind theme, `MapCanvas`, `useMapStore`, `Badge`, and `FloatingCard`, and build the real `/`.

**Two execution options:**
1. **Subagent-Driven (recommended)** — a fresh subagent per task, review between tasks.
2. **Inline Execution** — execute tasks in this session with checkpoints.

**Which approach?**
