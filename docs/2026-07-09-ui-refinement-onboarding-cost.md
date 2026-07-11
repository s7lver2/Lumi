# UI Refinement, Onboarding Wizard & Cost Free-Tier Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A polish + onboarding pass over the existing app: collapse navigation to two pages (Uso / Entrenamiento), fold the areas list into Entrenamiento as a notification-that-expands-to-a-popup, replace the always-present dropzone with map-wide drag-and-drop that opens a translucent "Find Region" upload popup, upgrade the area-drawing tools (shapes, vertex editing, undo/redo, street snapping), add an app loading screen, restyle the settings menu, turn first-run setup into a step-by-step wizard that checks prerequisites / runs migrations / tests credentials / installs the inference dependencies with live logs, and make cost estimation net out Google's monthly free allowance.

**Architecture:** Almost entirely `apps/web`, extending the Part 1/Part 2 dashboard. New shared cost math lives in `@netryx/api-usage`. The setup wizard introduces the one genuinely new server capability: a **command runner** that spawns child processes (venv/pip, `node-pg-migrate`, `torch.hub` downloads) and streams their stdout/stderr to the wizard over SSE — acceptable only because the app is self-hosted on a trusted network with no auth (spec §7.1, §10.3), documented as an explicit security assumption. Drawing gains use MapboxDraw's built-in direct-select/modes plus a small custom controller for shapes, undo/redo, and street snapping (turf nearest-point against Overpass geometry).

**Tech Stack:** Next.js 14 App Router, React 18, TypeScript, Tailwind (existing theme), Zustand, MapLibre/Mapbox + @mapbox/mapbox-gl-draw, @turf/turf, Node `child_process`, vitest.

**Depends on:** Foundation, Indexing Pipeline, Search Pass 1/2, Dashboard & Map UI Part 1 + Part 2, and Cost Tracking (`@netryx/api-usage`) — all merged. Reuses `AppShell`, Tailwind theme, `FloatingCard`, `Badge`, `RingGauge`, `MapCanvas`, `useMapStore`, `useSearchStore`, `useIndexingStore`, `IndexingDrawTool`, and the existing `/api/*` routes.

**Out of scope (documented, not silently dropped):** multi-image search and per-area "Worldwide/Change" scoping in the upload popup (backend `/api/search` is single-image, searches all indexed areas — the popup mirrors the reference visually but searches the selected image across all areas); EXIF parsing behind the METADATA affordance (shows file name/size/dimensions only); cross-platform installers (the wizard's command runner targets the documented Windows-native setup, spec §7.1); auth on the command-runner endpoints (trusted-network assumption, spec §10.3).

## Global Constraints

- **Reuse the existing design system** — Tailwind tokens, `FloatingCard` (translucent + `backdrop-blur`), `Badge`, `RingGauge`, `AppShell`, `MapCanvas`. Translucency is the throughline: menus, popovers, the settings panel, the upload popup, the areas popup, and the loading screen are all semi-opaque + blurred, never flat opaque.
- **Route-export rule:** `route.ts`/`page.tsx`/`layout.tsx` export only their allowed names; helpers in sibling modules.
- **Map components client-only** (`ssr:false` via `MapCanvas`); never import MapLibre/Mapbox server-side.
- **Command runner is a hard security boundary:** the setup endpoints execute shell commands (pip, migrations, model downloads). They are only mounted under `/setup` (pre-setup) and must refuse to run once `__setup_completed__` is true, except an explicit "re-run" from `/settings`. Document the trusted-network assumption (spec §10.3) at the top of the runner module.
- **Windows-native commands** (spec §7.1): venv at `services/inference/venv/Scripts/`, `pnpm`, `python`. Commands are declared as data (argv arrays) so they're auditable, never string-interpolated from user input.
- **No path aliases** — relative imports. TDD for pure logic (cost math, draw geometry, log parsing, wizard step state); UI/map/child-process components verified manually. DRY, YAGNI, frequent commits.

---

## File Structure

```
apps/web/app/
├── layout.tsx                                    # Modify (Task 12 — LoadingScreen boot gate)
├── components/
│   ├── AppShell.tsx                              # Modify (Task 2 — 2-item rail)
│   ├── LoadingScreen.tsx                         # Task 12
│   ├── Menu.tsx                                  # Task 3 (translucent dropdown/popover primitive)
│   ├── UploadPopup.tsx                           # Task 5 (Find Region popup)
│   ├── MapDropTarget.tsx                         # Task 5 (map-wide drag-and-drop)
│   ├── AreasNotification.tsx                     # Task 4 (toast → popup)
│   ├── AreasPopup.tsx                            # Task 4 (expanded list + detail)
│   ├── DrawToolbar.tsx                           # Task 8 (shape modes, undo/redo)
│   ├── IndexingDrawTool.tsx                      # Modify (Task 7 — edit/reshape, undo/redo)
│   ├── SearchDashboard.tsx                       # Modify (Task 5 — drop target + popup)
│   └── SettingsPanel.tsx                         # Task 11 (restyled, sectioned)
├── (protected)/
│   ├── index/page.tsx                            # Modify (Task 4,6,9 — merged Entrenamiento)
│   └── page.tsx                                  # (Uso — unchanged aside from Task 5)
├── setup/
│   ├── page.tsx                                  # Modify (Task 14 — wizard shell)
│   ├── wizard-steps.ts                           # Task 13 (pure step state machine)
│   ├── wizard-steps.test.ts                      # Task 13
│   └── components/*                              # Task 14 (per-step UI)
├── settings/page.tsx                             # Modify (Task 11 — use SettingsPanel)
├── lib/
│   ├── draw-history.ts                           # Task 7 (undo/redo stack — pure)
│   ├── draw-history.test.ts                      # Task 7
│   ├── snap.ts                                   # Task 8 (street snapping — pure)
│   ├── snap.test.ts                              # Task 8
│   ├── run-log.ts                                # Task 13 (SSE log line parsing — pure)
│   └── run-log.test.ts                           # Task 13
├── api/
│   ├── areas/estimate/route.ts                   # Modify (Task 1 — net cost)
│   ├── areas/route.ts                            # Modify (Task 1 — net budget guard)
│   ├── usage/route.ts                            # Modify (Task 1 — free-tier fields)
│   └── setup/
│       ├── prereqs/route.ts                      # Task 13 (checks)
│       └── run/[step]/route.ts                   # Task 13 (SSE command runner)
packages/
├── shared-types/src/settings.ts                  # Modify (Task 1 — free-tier settings)
└── api-usage/src/
    ├── free-tier.ts                              # Task 1 (net cost — pure)
    └── free-tier.test.ts                         # Task 1
```

---

## Group E — Cost free-tier (do first; other tasks reference the settings)

### Task 1: Net-of-free-tier cost math, settings, and wiring

Model Google's monthly free allowance as **both** a USD credit and a free-image count (spec §12; user decision), summed into one free-USD figure that the estimate, budget guard, and usage endpoint net out.

**Files:**
- Modify: `packages/shared-types/src/settings.ts`, `packages/shared-types/src/settings.test.ts`
- Create: `packages/api-usage/src/free-tier.ts`, `free-tier.test.ts`; Modify: `packages/api-usage/src/index.ts`
- Modify: `apps/web/app/api/areas/estimate/route.ts`, `apps/web/app/api/areas/route.ts`, `apps/web/app/api/usage/route.ts`

**Interfaces:**
- Produces settings `GOOGLE_FREE_MONTHLY_CREDIT_USD` (default `"0"`), `GOOGLE_FREE_MONTHLY_IMAGES` (default `"0"`); `freeAllowanceUsd(creditUsd, freeImages, pricePerImageUsd): number`; `netCostBreakdown({ monthSpendUsd, jobCostUsd, freeUsd }): { freeRemainingUsd, netJobUsd, netMonthTotalUsd }`.

- [ ] **Step 1: Add the two settings + failing test**

```typescript
// packages/shared-types/src/settings.test.ts — add
import { getSettingDefinition } from "./settings";
it("defines Google free-tier settings defaulting to 0", () => {
  expect(getSettingDefinition("GOOGLE_FREE_MONTHLY_CREDIT_USD").defaultValue).toBe("0");
  expect(getSettingDefinition("GOOGLE_FREE_MONTHLY_IMAGES").defaultValue).toBe("0");
});
```
Then add to `SETTINGS_SCHEMA` in `settings.ts` (both `type: "number"`, `isSecret: false`, `required: true`, defaults `"0"`; note `validateSettingValue` currently rejects `<= 0` for numbers — relax it for these two so `0` = "no free tier" is valid):

```typescript
  {
    key: "GOOGLE_FREE_MONTHLY_CREDIT_USD",
    label: "Google free monthly credit (USD, 0 = none)",
    type: "number",
    isSecret: false,
    required: true,
    defaultValue: "0",
  },
  {
    key: "GOOGLE_FREE_MONTHLY_IMAGES",
    label: "Google free monthly Street View images (0 = none)",
    type: "number",
    isSecret: false,
    required: true,
    defaultValue: "0",
  },
```

In `validateSettingValue`'s number branch, allow zero for these keys:
```typescript
  if (def.type === "number") {
    const parsed = Number(value);
    if (Number.isNaN(parsed)) throw new Error(`${def.label} must be a number`);
    const allowZero = def.key.startsWith("GOOGLE_FREE_MONTHLY_");
    if (allowZero ? parsed < 0 : parsed <= 0) {
      throw new Error(`${def.label} must be ${allowZero ? "zero or greater" : "greater than 0"}`);
    }
  }
```

Run: `cd packages/shared-types && pnpm test settings.test.ts` — expect PASS (add the entries until it passes).

- [ ] **Step 2: Write the failing free-tier math test**

```typescript
// packages/api-usage/src/free-tier.test.ts
import { describe, it, expect } from "vitest";
import { freeAllowanceUsd, netCostBreakdown } from "./free-tier";

describe("freeAllowanceUsd", () => {
  it("sums the USD credit and the value of free images", () => {
    expect(freeAllowanceUsd(200, 10000, 0.007)).toBeCloseTo(270, 5); // 200 + 10000*0.007
  });
});

describe("netCostBreakdown", () => {
  it("charges nothing while the month stays under the free allowance", () => {
    const b = netCostBreakdown({ monthSpendUsd: 10, jobCostUsd: 20, freeUsd: 100 });
    expect(b.netJobUsd).toBe(0);
    expect(b.freeRemainingUsd).toBeCloseTo(90, 5);
    expect(b.netMonthTotalUsd).toBe(0);
  });
  it("charges only the portion of the job beyond the free allowance", () => {
    const b = netCostBreakdown({ monthSpendUsd: 90, jobCostUsd: 30, freeUsd: 100 });
    // month already used 90 of 100 free; job of 30 -> 10 free left covers 10, 20 billable
    expect(b.netJobUsd).toBeCloseTo(20, 5);
    expect(b.freeRemainingUsd).toBeCloseTo(10, 5);
    expect(b.netMonthTotalUsd).toBeCloseTo(20, 5);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd packages/api-usage && pnpm test free-tier.test.ts` → FAIL (`Cannot find module './free-tier'`).

- [ ] **Step 4: Implement `free-tier.ts`**

```typescript
// packages/api-usage/src/free-tier.ts
export function freeAllowanceUsd(
  creditUsd: number,
  freeImages: number,
  pricePerImageUsd: number
): number {
  return Math.max(0, creditUsd) + Math.max(0, freeImages) * Math.max(0, pricePerImageUsd);
}

export interface NetCostInput {
  monthSpendUsd: number; // gross month-to-date, from api_usage
  jobCostUsd: number; // gross cost of this job
  freeUsd: number; // total monthly free allowance in USD
}

export interface NetCostBreakdown {
  freeRemainingUsd: number;
  netJobUsd: number;
  netMonthTotalUsd: number;
}

/** Nets Google's monthly free allowance out of a job's cost (spec §12). */
export function netCostBreakdown({ monthSpendUsd, jobCostUsd, freeUsd }: NetCostInput): NetCostBreakdown {
  const netMonthBefore = Math.max(0, monthSpendUsd - freeUsd);
  const netMonthTotalUsd = Math.max(0, monthSpendUsd + jobCostUsd - freeUsd);
  return {
    freeRemainingUsd: Math.max(0, freeUsd - monthSpendUsd),
    netJobUsd: netMonthTotalUsd - netMonthBefore,
    netMonthTotalUsd,
  };
}
```
Add to `packages/api-usage/src/index.ts`: `export * from "./free-tier";`

- [ ] **Step 5: Run test to verify it passes**

Run: `cd packages/api-usage && pnpm test` → PASS (free-tier + existing budget/usage tests).

- [ ] **Step 6: Wire net cost into `/api/areas/estimate`**

In `estimate/route.ts`, after computing `estimatedCostUsd`, read the free-tier settings + month spend and return the breakdown:

```typescript
// add imports
import { getPool } from "../../../../lib/db";
import { getMonthlySpendUsd, freeAllowanceUsd, netCostBreakdown } from "@netryx/api-usage";
// after estimatedCostUsd:
  const creditUsd = Number((await repo.getSetting("GOOGLE_FREE_MONTHLY_CREDIT_USD")) ?? "0");
  const freeImages = Number((await repo.getSetting("GOOGLE_FREE_MONTHLY_IMAGES")) ?? "0");
  const freeUsd = freeAllowanceUsd(creditUsd, freeImages, pricePerImageUsd);
  const monthSpendUsd = await getMonthlySpendUsd(getPool());
  const net = netCostBreakdown({ monthSpendUsd, jobCostUsd: estimatedCostUsd, freeUsd });
  return NextResponse.json({
    pointsEstimated: points.length,
    estimatedCostUsd,            // gross
    netCostUsd: net.netJobUsd,   // after free tier
    freeRemainingUsd: net.freeRemainingUsd,
  });
```

- [ ] **Step 7: Make the budget guard use the net month total in both routes**

In `apps/web/app/api/areas/route.ts`, replace the existing `assertWithinMonthlyBudget(spent, estimatedCostUsd, maxMonthlyBudgetUsd)` block with a net check (over-budget is about out-of-pocket, i.e. after free tier):

```typescript
import { freeAllowanceUsd, netCostBreakdown, BudgetExceededError } from "@netryx/api-usage";
// ...
  const creditUsd = Number((await repo.getSetting("GOOGLE_FREE_MONTHLY_CREDIT_USD")) ?? "0");
  const freeImages = Number((await repo.getSetting("GOOGLE_FREE_MONTHLY_IMAGES")) ?? "0");
  const freeUsd = freeAllowanceUsd(creditUsd, freeImages, pricePerImageUsd);
  const monthSpendUsd = await getMonthlySpendUsd(pool);
  const net = netCostBreakdown({ monthSpendUsd, jobCostUsd: estimatedCostUsd, freeUsd });
  if (net.netMonthTotalUsd > maxMonthlyBudgetUsd) {
    return NextResponse.json(
      { error: new BudgetExceededError(Math.max(0, monthSpendUsd - freeUsd), net.netJobUsd, maxMonthlyBudgetUsd).message },
      { status: 400 }
    );
  }
```
Apply the same net calc in the worker's guard (`apps/worker/src/jobs/index-area.ts`) — read the two free-tier settings, compute `freeUsd`, and compare `netCostBreakdown(...).netMonthTotalUsd` against `maxMonthlyBudgetUsd` instead of the gross sum. (The worker already imports from `@netryx/api-usage` per the Cost Tracking plan.)

- [ ] **Step 8: Add free-tier fields to `GET /api/usage`**

```typescript
// apps/web/app/api/usage/route.ts — extend the response
import { freeAllowanceUsd } from "@netryx/api-usage";
// after reading monthlyBudgetUsd + monthlySpendUsd:
  const pricePerImageUsd = Number((await repo.getSetting("STREET_VIEW_PRICE_PER_IMAGE_USD")) ?? "0.007");
  const creditUsd = Number((await repo.getSetting("GOOGLE_FREE_MONTHLY_CREDIT_USD")) ?? "0");
  const freeImages = Number((await repo.getSetting("GOOGLE_FREE_MONTHLY_IMAGES")) ?? "0");
  const freeUsd = freeAllowanceUsd(creditUsd, freeImages, pricePerImageUsd);
  return NextResponse.json({
    monthlySpendUsd, monthlyBudgetUsd,
    freeAllowanceUsd: freeUsd,
    freeRemainingUsd: Math.max(0, freeUsd - monthlySpendUsd),
    netSpendUsd: Math.max(0, monthlySpendUsd - freeUsd),
    remainingUsd: Math.max(0, monthlyBudgetUsd - Math.max(0, monthlySpendUsd - freeUsd)),
  });
```

- [ ] **Step 9: Verify + commit**

Run: `pnpm -r test` (shared-types + api-usage green). Manual: `curl /api/areas/estimate` shows `estimatedCostUsd`, `netCostUsd`, `freeRemainingUsd`; with a free credit set, `netCostUsd < estimatedCostUsd`.
```bash
git add packages/shared-types packages/api-usage apps/web/app/api/areas apps/web/app/api/usage apps/worker/src/jobs/index-area.ts
git commit -m "feat(cost): net Google monthly free tier out of estimate + budget (spec §12)"
```

---

## Group A — Navigation & merged Entrenamiento

### Task 2: Two-item icon rail (Uso / Entrenamiento)

**Files:** Modify `apps/web/app/components/AppShell.tsx`.

- [ ] **Step 1: Replace the three-item `NAV` with two**

```tsx
// apps/web/app/components/AppShell.tsx — NAV array
const NAV = [
  { href: "/", label: "Uso", icon: "M21 21l-4.35-4.35M11 19a8 8 0 100-16 8 8 0 000 16z" },
  { href: "/index", label: "Entrenamiento", icon: "M12 2l9 4.5-9 4.5-9-4.5L12 2zM3 12l9 4.5 9-4.5M3 17l9 4.5 9-4.5" },
];
```
Remove the standalone "Áreas" nav entry (its content moves into Entrenamiento, Task 4). Keep the bottom Settings gear + avatar. Active-route highlight: mark the current link with `text-fg` (use `usePathname()` from `next/navigation`; make `AppShell` a client component if it isn't — it renders `Link`s, so add `"use client"`).

- [ ] **Step 2: Manual verification + commit**

`pnpm dev` → rail shows exactly two icons (Uso, Entrenamiento) + settings; the active page's icon is highlighted.
```bash
git add apps/web/app/components/AppShell.tsx
git commit -m "feat(web): collapse rail to Uso + Entrenamiento (2 pages)"
```

---

### Task 3: Translucent `Menu` primitive

A reusable translucent dropdown/popover used by the model selector, the "Change" scope control, the area-status filters, and settings sections.

**Files:** Create `apps/web/app/components/Menu.tsx`.

- [ ] **Step 1: Implement `Menu.tsx`** (verified manually — interaction)

```tsx
// apps/web/app/components/Menu.tsx
"use client";
import { useEffect, useRef, useState } from "react";

export interface MenuOption { value: string; label: string; hint?: string }

export function Menu({
  label, options, value, onChange,
}: { label?: string; options: MenuOption[]; value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);
  const current = options.find((o) => o.value === value);
  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 rounded-md border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs text-fg hover:bg-white/10">
        {current?.label ?? label} <span className="text-subtle">▾</span>
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-1 min-w-44 overflow-hidden rounded-card border border-white/10 bg-panel/80 backdrop-blur-md shadow-lg shadow-black/40">
          {options.map((o) => (
            <button key={o.value} onClick={() => { onChange(o.value); setOpen(false); }}
              className={`block w-full px-3 py-2 text-left text-xs hover:bg-white/10 ${o.value === value ? "text-accent-fg" : "text-fg"}`}>
              {o.label}{o.hint && <span className="ml-2 text-subtle">{o.hint}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/app/components/Menu.tsx
git commit -m "feat(web): translucent Menu dropdown primitive"
```

---

### Task 4: Fold Áreas into Entrenamiento (notification → popup)

Indexed areas surface as a translucent notification on the Entrenamiento page; clicking it expands a popup with the list + inline detail. `/areas` routes are removed; their data is fetched from the existing `GET /api/areas` and `GET /api/areas/[id]`.

**Files:** Create `AreasNotification.tsx`, `AreasPopup.tsx`; Modify `(protected)/index/page.tsx`; Delete `(protected)/areas/page.tsx` and `(protected)/areas/[id]/page.tsx`.

- [ ] **Step 1: Implement `AreasNotification.tsx`** (collapsed toast)

```tsx
// apps/web/app/components/AreasNotification.tsx
"use client";
import { Badge } from "./Badge";

export function AreasNotification({ count, indexing, onOpen }: { count: number; indexing: number; onOpen: () => void }) {
  return (
    <button onClick={onOpen}
      className="flex items-center gap-2 rounded-card border border-white/10 bg-panel/80 px-3 py-2 text-xs text-fg backdrop-blur-md shadow-lg shadow-black/40 hover:bg-white/10">
      <span>{count} áreas</span>
      {indexing > 0 && <Badge tone="draw">{indexing} indexando</Badge>}
      <span className="text-subtle">▸</span>
    </button>
  );
}
```

- [ ] **Step 2: Implement `AreasPopup.tsx`** (expanded list + detail)

```tsx
// apps/web/app/components/AreasPopup.tsx
"use client";
import { useEffect, useState } from "react";
import { FloatingCard } from "./FloatingCard";
import { Badge } from "./Badge";
import { statusTone } from "../lib/area-status";
import { fetchJson } from "../lib/fetch-json";
import type { AreaStatus } from "@netryx/shared-types";

interface AreaItem { id: string; name: string | null; area_km2: string | number; status: AreaStatus; images_embedded: number; created_at: string }

export function AreasPopup({ onClose, onShowArea }: { onClose: () => void; onShowArea: (id: string) => void }) {
  const [areas, setAreas] = useState<AreaItem[]>([]);
  useEffect(() => { fetchJson<{ areas: AreaItem[] }>("/api/areas").then((r) => setAreas(r.data?.areas ?? [])); }, []);
  return (
    <div className="absolute right-4 top-16 z-30 w-80">
      <FloatingCard className="max-h-[70vh] overflow-y-auto p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-sm font-medium text-fg">Áreas indexadas</span>
          <button onClick={onClose} className="text-subtle hover:text-fg" aria-label="Cerrar">✕</button>
        </div>
        <div className="space-y-2">
          {areas.map((a) => (
            <button key={a.id} onClick={() => onShowArea(a.id)}
              className="block w-full rounded-card border border-border p-2.5 text-left hover:border-white/20">
              <div className="flex items-center justify-between">
                <span className="text-sm text-fg">{a.name ?? "Área"}</span>
                <Badge tone={statusTone(a.status)}>{a.status}</Badge>
              </div>
              <div className="mt-1 text-xs text-muted">{Number(a.area_km2).toFixed(1)} km² · {a.images_embedded.toLocaleString()} imágenes</div>
            </button>
          ))}
          {areas.length === 0 && <p className="text-xs text-muted">Aún no hay áreas indexadas.</p>}
        </div>
      </FloatingCard>
    </div>
  );
}
```

- [ ] **Step 3: Wire into Entrenamiento** — in `(protected)/index/page.tsx`, add `const [areasOpen, setAreasOpen] = useState(false)`, fetch the count for the notification, render `<AreasNotification .../>` (e.g. top-right) and `{areasOpen && <AreasPopup onClose={...} onShowArea={(id) => { /* draw that area's polygon+points on the map via GET /api/areas/[id], reusing the layer code from the old detail page */ }} />}`. Move the polygon/points-rendering effect from the deleted `areas/[id]/page.tsx` into a small helper the popup's `onShowArea` calls.

- [ ] **Step 4: Delete the standalone areas routes**

```bash
git rm "apps/web/app/(protected)/areas/page.tsx" "apps/web/app/(protected)/areas/[id]/page.tsx"
```
(Keep the API routes `app/api/areas/[id]/route.ts` — the popup still uses `GET`.)

- [ ] **Step 5: Verify + commit**

`pnpm build` (no dangling imports to the deleted pages) + `pnpm dev`: Entrenamiento shows the areas notification; clicking expands the translucent popup; clicking an area draws it on the map.
```bash
git add -A "apps/web/app/(protected)" apps/web/app/components/AreasNotification.tsx apps/web/app/components/AreasPopup.tsx
git commit -m "feat(web): fold areas into Entrenamiento as notification -> popup"
```

---

## Group #8 — Drag-and-drop upload popup (Uso)

### Task 5: Map-wide drag-and-drop + "Find Region" popup

Remove the always-present centered dropzone; make the whole Uso map a drop target that opens a translucent upload popup (image thumbnail + remove + name/size + METADATA + model selector + progress + action), replacing `ImageDropzone`'s card usage on `/`.

**Files:** Create `MapDropTarget.tsx`, `UploadPopup.tsx`; Modify `SearchDashboard.tsx`. (`ImageDropzone` is retained only for its crop helper, now invoked from `UploadPopup`.)

- [ ] **Step 1: Implement `MapDropTarget.tsx`** (full-surface drop zone, no visible box until dragging)

```tsx
// apps/web/app/components/MapDropTarget.tsx
"use client";
import { useState } from "react";

export function MapDropTarget({ onFiles }: { onFiles: (files: File[]) => void }) {
  const [over, setOver] = useState(false);
  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault(); setOver(false);
        const files = Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith("image/"));
        if (files.length) onFiles(files);
      }}
      className={`absolute inset-0 z-10 ${over ? "bg-accent/10 ring-2 ring-inset ring-accent-fg/40" : "pointer-events-none"}`}
    >
      {over && (
        <div className="pointer-events-none flex h-full items-center justify-center">
          <span className="rounded-card bg-panel/80 px-4 py-2 text-sm text-fg backdrop-blur-md">Suelta la imagen para buscar</span>
        </div>
      )}
    </div>
  );
}
```
> `pointer-events-none` when not dragging so the map stays interactive; it turns on to catch the drop. A small persistent "subir imagen" button elsewhere covers the click-to-pick path.

- [ ] **Step 2: Implement `UploadPopup.tsx`** (the Find Region popup)

```tsx
// apps/web/app/components/UploadPopup.tsx
"use client";
import { useState } from "react";
import { FloatingCard } from "./FloatingCard";
import { Menu } from "./Menu";
import { RETRIEVAL_MODELS } from "@netryx/shared-types";

interface Selected { file: File; url: string }

export function UploadPopup({
  files, onAddMore, onRemove, onSearch, busy,
}: {
  files: Selected[];
  onAddMore: (files: File[]) => void;
  onRemove: (index: number) => void;
  onSearch: () => void;
  busy: boolean;
}) {
  const [model, setModel] = useState(RETRIEVAL_MODELS[0]?.id ?? "lumi-preview");
  return (
    <div className="absolute left-1/2 top-6 z-20 w-[460px] -translate-x-1/2">
      <FloatingCard className="p-4">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white/5 text-accent-fg">◎</span>
            <div>
              <div className="text-sm font-medium text-fg">Buscar región</div>
              <div className="text-xs text-muted">Áreas indexadas · geolocalización aproximada</div>
            </div>
          </div>
        </div>
        <div className="mt-3 flex items-center justify-between rounded-md bg-white/5 px-3 py-2">
          <span className="text-xs text-muted">Modelo</span>
          <Menu value={model} onChange={setModel}
            options={RETRIEVAL_MODELS.map((m) => ({ value: m.id, label: m.displayName, hint: m.status }))} />
        </div>
        <div className="mt-3 text-sm text-fg">{files.length} imagen{files.length === 1 ? "" : "es"} seleccionada{files.length === 1 ? "" : "s"}</div>
        <div className="mt-2 space-y-2">
          {files.map((f, i) => (
            <div key={f.url} className="flex items-center gap-3 rounded-md bg-white/5 p-2">
              <img src={f.url} alt="" className="h-12 w-16 rounded object-cover" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs text-fg">{f.file.name}</div>
                <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted">
                  <span>{Math.round(f.file.size / 1024)}kb {f.file.type.split("/")[1]}</span>
                  <span className="rounded bg-white/5 px-1.5 py-0.5">METADATA</span>
                </div>
              </div>
              <button onClick={() => onRemove(i)} className="text-subtle hover:text-fg" aria-label="Quitar">✕</button>
            </div>
          ))}
        </div>
        <div className="mt-4 flex items-center justify-between">
          <label className="cursor-pointer rounded-md border border-white/10 px-3 py-1.5 text-xs text-fg hover:bg-white/10">
            Añadir más
            <input type="file" accept="image/*" multiple className="hidden"
              onChange={(e) => e.target.files && onAddMore(Array.from(e.target.files))} />
          </label>
          <button onClick={onSearch} disabled={busy || files.length === 0}
            className="rounded-md bg-accent px-4 py-1.5 text-xs font-medium text-black disabled:opacity-50">
            {busy ? "Subiendo…" : "Buscar"}
          </button>
        </div>
      </FloatingCard>
    </div>
  );
}
```
> Multi-select is visual (matches the reference "Add more"); `onSearch` submits the **first** file to the single-image `/api/search` (documented backend limit). The METADATA tag is a static affordance for now (out-of-scope note: no EXIF parsing).

- [ ] **Step 3: Wire into `SearchDashboard.tsx`** — remove the centered `<ImageDropzone>`; add local `selected` state, render `<MapDropTarget onFiles={addFiles} />` always (when idle) and `<UploadPopup .../>` when `selected.length > 0`; `onSearch` runs the existing `handleImage(selected[0].file)`. Keep the crop helper reachable (e.g. click the thumbnail to crop) — optional, note if deferred.

- [ ] **Step 4: Manual verification + commit**

`pnpm dev` on `/`: no permanent box; dragging an image highlights the map and shows "Suelta…"; dropping opens the translucent Find Region popup; "Buscar" runs the search.
```bash
git add apps/web/app/components/MapDropTarget.tsx apps/web/app/components/UploadPopup.tsx apps/web/app/components/SearchDashboard.tsx
git commit -m "feat(web): map-wide drag-drop + Find Region upload popup (replaces dropzone)"
```

---

## Group C — Drawing tools

### Task 6: Undo/redo history (pure) + toolbar

**Files:** Create `apps/web/app/lib/draw-history.ts`, `draw-history.test.ts`, `apps/web/app/components/DrawToolbar.tsx`.

- [ ] **Step 1: Failing test for the history stack**

```typescript
// apps/web/app/lib/draw-history.test.ts
import { describe, it, expect } from "vitest";
import { DrawHistory } from "./draw-history";

describe("DrawHistory", () => {
  it("pushes states and undoes/redoes", () => {
    const h = new DrawHistory<number>();
    h.push(1); h.push(2); h.push(3);
    expect(h.undo()).toBe(2);
    expect(h.undo()).toBe(1);
    expect(h.redo()).toBe(2);
  });
  it("drops the redo tail after a new push", () => {
    const h = new DrawHistory<number>();
    h.push(1); h.push(2); h.undo(); h.push(9);
    expect(h.redo()).toBeNull(); // 2 was discarded
  });
});
```

- [ ] **Step 2: Run → FAIL; implement `draw-history.ts`**

```typescript
// apps/web/app/lib/draw-history.ts
export class DrawHistory<T> {
  private stack: T[] = [];
  private index = -1;
  push(state: T): void {
    this.stack = this.stack.slice(0, this.index + 1);
    this.stack.push(state);
    this.index = this.stack.length - 1;
  }
  undo(): T | null { if (this.index <= 0) return null; this.index--; return this.stack[this.index]; }
  redo(): T | null { if (this.index >= this.stack.length - 1) return null; this.index++; return this.stack[this.index]; }
  current(): T | null { return this.index >= 0 ? this.stack[this.index] : null; }
}
```
Run → PASS.

- [ ] **Step 3: `DrawToolbar.tsx`** — a translucent floating toolbar with mode buttons (polígono / rectángulo / círculo), undo, redo, borrar. Buttons call callbacks passed from the draw tool (Task 7).

```tsx
// apps/web/app/components/DrawToolbar.tsx
"use client";
export function DrawToolbar({
  mode, onMode, onUndo, onRedo, onClear,
}: {
  mode: string;
  onMode: (m: "polygon" | "rectangle" | "circle") => void;
  onUndo: () => void; onRedo: () => void; onClear: () => void;
}) {
  const btn = (active: boolean) =>
    `rounded-md px-2.5 py-1.5 text-xs ${active ? "bg-accent text-black" : "text-fg hover:bg-white/10"}`;
  return (
    <div className="absolute left-4 top-4 z-20 flex gap-1 rounded-card border border-white/10 bg-panel/80 p-1 backdrop-blur-md">
      <button className={btn(mode === "polygon")} onClick={() => onMode("polygon")}>Polígono</button>
      <button className={btn(mode === "rectangle")} onClick={() => onMode("rectangle")}>Rectángulo</button>
      <button className={btn(mode === "circle")} onClick={() => onMode("circle")}>Círculo</button>
      <span className="mx-1 w-px bg-white/10" />
      <button className={btn(false)} onClick={onUndo} aria-label="Deshacer">↶</button>
      <button className={btn(false)} onClick={onRedo} aria-label="Rehacer">↷</button>
      <button className={btn(false)} onClick={onClear}>Borrar</button>
    </div>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/lib/draw-history.ts apps/web/app/lib/draw-history.test.ts apps/web/app/components/DrawToolbar.tsx
git commit -m "feat(web): draw undo/redo history + drawing toolbar"
```

---

### Task 7: Upgrade `IndexingDrawTool` — shapes, editing, undo/redo, keyboard

**Files:** Modify `apps/web/app/components/IndexingDrawTool.tsx`, `(protected)/index/page.tsx`.

- [ ] **Step 1: Enable direct-select editing + wire modes/history**

MapboxDraw already supports vertex editing via its `direct_select` mode and rectangle/circle via extra modes. In `IndexingDrawTool`:
- Instantiate `MapboxDraw` with `modes: { ...MapboxDraw.modes, draw_rectangle, draw_circle }` using `mapbox-gl-draw-rectangle-mode` + `mapbox-gl-draw-circle` (add deps) so `DrawToolbar` can switch `draw.changeMode("draw_rectangle" | "draw_circle" | "draw_polygon")`.
- Keep the existing `draw.create/update/delete → setDrawnPolygon/clearPolygon` sync (a circle/rectangle serializes to a polygon ring, so downstream cost/estimate is unchanged).
- On every `draw.create`/`draw.update`, `history.push(draw.getAll())`; expose `onUndo`/`onRedo` that `draw.set(history.undo()/redo())` and re-sync the store.
- Keyboard: `Escape` → `draw.changeMode("simple_select")`; `Delete`/`Backspace` on a selected vertex is handled natively by `direct_select`.

```bash
cd apps/web && pnpm add mapbox-gl-draw-rectangle-mode@^1.0.4 mapbox-gl-draw-circle@^1.1.2
```
Add the deps to the `modes` object and a `changeMode` method surfaced to the page. (Editing existing vertices needs no extra code — clicking a drawn feature enters `direct_select`.)

- [ ] **Step 2: Wire `DrawToolbar` into Entrenamiento** — render `<DrawToolbar mode={...} onMode={changeMode} onUndo={...} onRedo={...} onClear={clearPolygon} />`; hide it while a job is active.

- [ ] **Step 3: Manual verification + commit**

Draw a polygon, a rectangle, a circle; drag a vertex to reshape; undo/redo; Esc cancels; the live area + estimate update for all shapes.
```bash
git add apps/web/app/components/IndexingDrawTool.tsx "apps/web/app/(protected)/index/page.tsx" apps/web/package.json apps/web/pnpm-lock.yaml
git commit -m "feat(web): rectangle/circle modes, vertex editing, undo/redo, keyboard (spec §6.1)"
```

---

### Task 8: Street snapping (pure) + toggle

Snap drawn vertices to the nearest street node using turf against Overpass geometry fetched for the current view.

**Files:** Create `apps/web/app/lib/snap.ts`, `snap.test.ts`; Modify `IndexingDrawTool.tsx`.

- [ ] **Step 1: Failing test for `snapPoint`**

```typescript
// apps/web/app/lib/snap.test.ts
import { describe, it, expect } from "vitest";
import { snapPoint } from "./snap";

describe("snapPoint", () => {
  const streets: [number, number][][] = [[[0, 0], [0, 0.01]], [[0.02, 0], [0.02, 0.01]]];
  it("snaps to the nearest street vertex within the threshold", () => {
    const snapped = snapPoint([0.0003, 0.005], streets, 100); // ~33m from x=0 line
    expect(snapped[0]).toBeCloseTo(0, 4);
  });
  it("leaves the point unchanged when nothing is within the threshold", () => {
    const p: [number, number] = [0.01, 0.005]; // ~1.1km from either line
    expect(snapPoint(p, streets, 50)).toEqual(p);
  });
});
```

- [ ] **Step 2: Run → FAIL; implement `snap.ts`**

```typescript
// apps/web/app/lib/snap.ts
import * as turf from "@turf/turf";

/** Snaps a [lng,lat] point to the nearest point on any street line within thresholdMeters. */
export function snapPoint(
  point: [number, number],
  streets: [number, number][][],
  thresholdMeters: number
): [number, number] {
  const p = turf.point(point);
  let best: [number, number] = point;
  let bestDist = Infinity;
  for (const line of streets) {
    if (line.length < 2) continue;
    const snapped = turf.nearestPointOnLine(turf.lineString(line), p, { units: "meters" });
    const d = snapped.properties.dist ?? Infinity;
    if (d < bestDist) { bestDist = d; best = snapped.geometry.coordinates as [number, number]; }
  }
  return bestDist <= thresholdMeters ? best : point;
}
```
Run → PASS.

- [ ] **Step 3: Wire an optional "snap a calles" toggle** in `DrawToolbar`; when on, `IndexingDrawTool` fetches street geometry for the current bounds once (reuse the `/api/areas/estimate` Overpass path via a tiny `GET /api/streets?bbox=` helper, or fetch Overpass client-side) and, on `draw.update`, snaps each ring vertex with `snapPoint(..., 25)` then `draw.set` the snapped feature. Document that snapping needs street data and is a no-op if the fetch fails.

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/lib/snap.ts apps/web/app/lib/snap.test.ts apps/web/app/components/IndexingDrawTool.tsx apps/web/app/components/DrawToolbar.tsx
git commit -m "feat(web): optional street snapping while drawing (spec §4)"
```

---

## Group B — Loading screen + settings restyle

### Task 12: App loading screen

A branded translucent splash shown until first paint is ready (map config fetched).

**Files:** Create `apps/web/app/components/LoadingScreen.tsx`; Modify `app/layout.tsx` (or a client boot wrapper).

- [ ] **Step 1: Implement `LoadingScreen.tsx`**

```tsx
// apps/web/app/components/LoadingScreen.tsx
"use client";
import { useEffect, useState } from "react";

export function BootGate({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    // Warm the map config so the first map mount is instant; resolve either way.
    fetch("/api/map-config").catch(() => {}).finally(() => setReady(true));
  }, []);
  if (!ready) {
    return (
      <div className="fixed inset-0 flex flex-col items-center justify-center gap-4 bg-bg">
        <div className="text-2xl font-medium tracking-wide text-fg">Lumi</div>
        <div className="h-1 w-40 overflow-hidden rounded-full bg-white/10">
          <div className="h-full w-1/3 animate-pulse bg-accent" />
        </div>
      </div>
    );
  }
  return <>{children}</>;
}
```
> `fixed inset-0` is fine here (real app chrome, not a visualize widget). Wrap the protected content: in `(protected)/layout.tsx`, render `<AppShell><BootGate>{children}</BootGate></AppShell>` (BootGate is client; the layout stays a server component that awaits the gate, then renders this).

- [ ] **Step 2: Manual verification + commit**

Hard-refresh a protected page → brief "Lumi" splash, then the app. 
```bash
git add apps/web/app/components/LoadingScreen.tsx "apps/web/app/(protected)/layout.tsx"
git commit -m "feat(web): branded app loading screen"
```

---

### Task 11: Restyle the settings menu

Replace the unstyled `/settings` form with a sectioned, dark, translucent panel matching the design system, grouped into Street View / Mapa / Límites y coste (incl. the new free-tier fields) / Modelos.

**Files:** Create `apps/web/app/components/SettingsPanel.tsx`; Modify `apps/web/app/settings/page.tsx`.

- [ ] **Step 1: Implement `SettingsPanel.tsx`** — a client component that fetches `/api/settings`, renders `SETTINGS_SCHEMA` grouped by section (a small `SECTION_OF: Record<string, string>` map), styled inputs (`bg-white/5 border border-white/10 rounded-md`), enum settings via the `Menu` primitive, PATCHes on save, and shows the §15.4 "requires inference restart" note under the model selects. Reuse `FloatingCard` for each section.

- [ ] **Step 2: `settings/page.tsx`** renders `<main className="mx-auto max-w-2xl p-8"><h1 className="text-lg text-fg mb-6">Configuración</h1><SettingsPanel/></main>`.

- [ ] **Step 3: Manual verification + commit**

`/settings` shows grouped translucent sections incl. the two Google free-tier fields; saving PATCHes and shows "Guardado".
```bash
git add apps/web/app/components/SettingsPanel.tsx apps/web/app/settings/page.tsx
git commit -m "feat(web): restyled sectioned settings panel (spec §14, §15.4)"
```

---

## Group D — Step-by-step setup wizard ⚠️ (command runner)

### Task 13: Prereq checks + command-runner endpoints + pure log parsing

**Files:** Create `app/api/setup/prereqs/route.ts`, `app/api/setup/run/[step]/route.ts`, `app/setup/wizard-steps.ts`, `wizard-steps.test.ts`, `app/lib/run-log.ts`, `run-log.test.ts`.

**Security:** the runner executes shell commands; document at the module top that it is gated to pre-setup (or explicit re-run) and relies on the trusted-network / no-auth assumption (spec §10.3).

- [ ] **Step 1: Prereq checks endpoint** (read-only, no shell)

```typescript
// apps/web/app/api/setup/prereqs/route.ts
import { NextResponse } from "next/server";
import { getPool } from "../../../lib/db";

export async function GET() {
  const checks: { id: string; ok: boolean; detail: string }[] = [];
  // Postgres + extensions
  try {
    const { rows } = await getPool().query(
      `SELECT extname FROM pg_extension WHERE extname IN ('vector','postgis')`
    );
    const names = rows.map((r) => r.extname);
    checks.push({ id: "postgres", ok: true, detail: "conectado" });
    checks.push({ id: "pgvector", ok: names.includes("vector"), detail: names.includes("vector") ? "instalada" : "falta la extensión vector" });
    checks.push({ id: "postgis", ok: names.includes("postgis"), detail: names.includes("postgis") ? "instalada" : "falta la extensión postgis" });
  } catch (e) {
    checks.push({ id: "postgres", ok: false, detail: `no conecta: ${e instanceof Error ? e.message : e}` });
  }
  // Inference service reachable
  const infUrl = process.env.INFERENCE_SERVICE_URL ?? "http://localhost:8000";
  try {
    const res = await fetch(`${infUrl}/docs`, { signal: AbortSignal.timeout(2000) });
    checks.push({ id: "inference", ok: res.ok, detail: res.ok ? "alcanzable" : `HTTP ${res.status}` });
  } catch {
    checks.push({ id: "inference", ok: false, detail: "no alcanzable (arráncalo en el paso de dependencias)" });
  }
  return NextResponse.json({ checks });
}
```

- [ ] **Step 2: Pure log-line parser + failing test**

```typescript
// apps/web/app/lib/run-log.test.ts
import { describe, it, expect } from "vitest";
import { parseRunEvent } from "./run-log";
it("parses log and done events from SSE data", () => {
  expect(parseRunEvent('{"type":"log","line":"Collecting torch"}')).toEqual({ type: "log", line: "Collecting torch" });
  expect(parseRunEvent('{"type":"done","code":0}')).toEqual({ type: "done", code: 0 });
});
```
```typescript
// apps/web/app/lib/run-log.ts
export type RunEvent = { type: "log"; line: string } | { type: "done"; code: number };
export function parseRunEvent(data: string): RunEvent { return JSON.parse(data) as RunEvent; }
```
Run → PASS.

- [ ] **Step 3: Command-runner SSE endpoint** — declares each step's command as an argv array (auditable, no user interpolation) and streams stdout/stderr.

```typescript
// apps/web/app/api/setup/run/[step]/route.ts
import { spawn } from "node:child_process";
import { resolve } from "node:path";

// SECURITY: executes shell commands. Only for the self-hosted, trusted-network
// setup flow with no auth (spec §7.1, §10.3). Commands are fixed argv arrays —
// never built from request input.
const REPO_ROOT = resolve(process.cwd(), "..", "..");
const STEPS: Record<string, { cmd: string; args: string[]; cwd: string }> = {
  migrate: { cmd: "pnpm", args: ["migrate:up"], cwd: resolve(REPO_ROOT, "db") },
  "inference-venv": { cmd: "python", args: ["-m", "venv", "venv"], cwd: resolve(REPO_ROOT, "services", "inference") },
  "inference-deps": { cmd: resolve(REPO_ROOT, "services", "inference", "venv", "Scripts", "pip.exe"), args: ["install", "-r", "requirements.txt"], cwd: resolve(REPO_ROOT, "services", "inference") },
  "inference-weights": { cmd: resolve(REPO_ROOT, "services", "inference", "venv", "Scripts", "python.exe"), args: ["-c", "import torch; torch.hub.load('gmberton/MegaLoc','get_trained_model'); import romatch; romatch.roma_outdoor(device='cpu')"], cwd: resolve(REPO_ROOT, "services", "inference") },
};

export async function POST(_req: Request, { params }: { params: { step: string } }) {
  const step = STEPS[params.step];
  if (!step) return new Response("unknown step", { status: 404 });

  const stream = new ReadableStream({
    start(controller) {
      const enc = new TextEncoder();
      const send = (e: object) => controller.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`));
      const child = spawn(step.cmd, step.args, { cwd: step.cwd, shell: false });
      child.stdout.on("data", (d) => send({ type: "log", line: d.toString() }));
      child.stderr.on("data", (d) => send({ type: "log", line: d.toString() }));
      child.on("error", (err) => { send({ type: "log", line: `error: ${err.message}` }); send({ type: "done", code: 1 }); controller.close(); });
      child.on("close", (code) => { send({ type: "done", code: code ?? 0 }); controller.close(); });
    },
  });
  return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" } });
}
```

- [ ] **Step 4: Pure wizard step-state machine + failing test**

```typescript
// apps/web/app/setup/wizard-steps.test.ts
import { describe, it, expect } from "vitest";
import { WIZARD_STEPS, nextStep, isComplete } from "./wizard-steps";
it("advances through the steps in order and completes at the end", () => {
  expect(WIZARD_STEPS[0].id).toBe("prereqs");
  expect(nextStep("prereqs")).toBe("migrate");
  expect(nextStep("credentials")).toBe("inference");
  expect(nextStep("confirm")).toBeNull();
  expect(isComplete("confirm")).toBe(true);
});
```
```typescript
// apps/web/app/setup/wizard-steps.ts
export const WIZARD_STEPS = [
  { id: "prereqs", title: "Prerequisitos" },
  { id: "migrate", title: "Base de datos" },
  { id: "credentials", title: "Credenciales" },
  { id: "inference", title: "Dependencias de inferencia" },
  { id: "confirm", title: "Confirmación" },
] as const;
export type StepId = (typeof WIZARD_STEPS)[number]["id"];
export function nextStep(id: StepId): StepId | null {
  const i = WIZARD_STEPS.findIndex((s) => s.id === id);
  return i >= 0 && i < WIZARD_STEPS.length - 1 ? WIZARD_STEPS[i + 1].id : null;
}
export function isComplete(id: StepId): boolean { return id === "confirm"; }
```
Run both tests → PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/api/setup apps/web/app/setup/wizard-steps.ts apps/web/app/setup/wizard-steps.test.ts apps/web/app/lib/run-log.ts apps/web/app/lib/run-log.test.ts
git commit -m "feat(web): setup prereq checks + SSE command runner + wizard state (spec §7.1, §14.2)"
```

---

### Task 14: Wizard UI

**Files:** Modify `apps/web/app/setup/page.tsx`; Create per-step components under `apps/web/app/setup/components/`.

- [ ] **Step 1: Build the wizard shell** — a client component driving `WIZARD_STEPS`: a left step list (with ✅ as steps complete) + a right panel per step:
  - **Prereqs:** `GET /api/setup/prereqs`, render each check with ✅/❌ + detail; "Reintentar"; advance enabled when Postgres/pgvector/postgis are ✅ (inference may still be ❌ — it's fixed in the inference step).
  - **Migrate:** button runs `POST /api/setup/run/migrate`, streams logs into a translucent `<pre>` console via `EventSource`-style reading of the SSE stream (use `fetch` + `ReadableStream` reader, parsing lines with `parseRunEvent`); enable "Siguiente" on `{type:"done",code:0}`.
  - **Credentials:** the current Step-1/2/3 fields from the existing `/setup` (Google key + test, Mapbox optional, limits incl. the free-tier fields), submitting via the existing `submitSetup` action but WITHOUT marking setup complete yet (defer completion to the final step).
  - **Inference:** three run buttons in sequence (`inference-venv` → `inference-deps` → `inference-weights`), each streaming logs; a combined progress indicator; this is the long one (weights are ~2GB).
  - **Confirm:** summary; "Finalizar" writes settings + `__setup_completed__=true` (existing `completeSetup`) and redirects to `/`.
- Reuse `FloatingCard`, `Menu`, the translucent console styling. A shared `useCommandRun(step)` hook wraps the SSE read + log state.

- [ ] **Step 2: Guard the runner post-setup** — in `run/[step]/route.ts`, before spawning, check `getSettingsRepo().isSetupCompleted()` and refuse (`403`) unless a `?rerun=1` query is present (so `/settings` can offer a "reinstalar dependencias" action later); document it.

- [ ] **Step 3: Manual verification (full)** — from a fresh DB (setup not completed): visiting any route redirects to `/setup`; the wizard walks prereqs → migrate (logs stream, DB gets extensions/tables) → credentials (key test passes) → inference (venv+pip+weights stream, service becomes reachable) → confirm → lands on `/`. Re-running `/setup` after completion is blocked unless `?rerun=1`.

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/setup
git commit -m "feat(web): step-by-step setup wizard with live install logs (spec §14.2, §7.1)"
```

---

## Self-Review

- **Requirement coverage:** (1) free-tier cost ✔ Task 1; (2) menu transparency ✔ Task 3 `Menu` + translucent surfaces throughout; (3) 2-page rail ✔ Task 2; (4) areas folded into Entrenamiento as notification→popup ✔ Task 4; (5) better drawing (shapes/edit/undo/snap) ✔ Tasks 6–8; (6) settings menu rehecho ✔ Task 11; (7) loading screen ✔ Task 12; (8) drag-drop upload popup ✔ Task 5.
- **Spec coverage:** §6.1 drawing ✔; §12 cost + free tier ✔; §14.2 setup wizard as multi-step ✔ (upgrades the Foundation single-form setup); §7.1 Windows-native commands + no-Docker ✔; §10.3 trusted-network assumption documented for the command runner.
- **Deferred/documented:** multi-image search + per-area scoping (backend single-image), EXIF metadata, cross-platform installer, runner auth — all noted in Out of scope, none silently dropped.
- **Reuse & consistency:** no new styling system; `FloatingCard`/`Badge`/`RingGauge`/`Menu`/theme everywhere. Cost math extends `@netryx/api-usage` (Task 1) reused by web + worker. `netCostBreakdown` signature identical across estimate/areas/usage/worker.
- **Risk flagged:** the command runner is the one novel server capability — isolated to `/api/setup/run/[step]`, fixed argv arrays, setup-gated, trusted-network-only, verified manually (child processes aren't unit-testable). Snapping is the drawing sub-risk (needs street data; documented no-op on fetch failure).
- **Ordering:** Task 1 (settings) first since Tasks 11/14 render the new settings and Task 1's guard is reused. Nav/area/drawing/upload tasks are independent; the wizard (13–14) is last and self-contained.

---

## Execution Handoff

**Plan complete and saved to `docs/2026-07-09-ui-refinement-onboarding-cost.md`.**

This is a large single plan (user chose one plan over splitting). The command-runner wizard (Tasks 13–14) is the heaviest, most novel part — consider executing it last and reviewing its security posture before merge.

**Two execution options:**
1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks.
2. **Inline Execution** — execute tasks in this session with checkpoints.

**Which approach?**
