# Catalog Browser Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Settings-tab-based dataset/model catalog UIs with a single popup ("Tienda"), opened from a new `AppShell.tsx` rail icon, in a Factorio-mod-menu-style list+sidebar+detail-panel layout shared between a Datasets section and a Modelos section — plus a 3-step publish wizard replacing the free-text dataset publish form. Models lose their publish UI entirely.

**Architecture:** Pure logic (filtering, wizard step validation, the remembered-repo helper) lives in small, framework-free files under `apps/web/app/lib/` so it's unit-testable in this project's Node-only test environment (no DOM/testing-library here). `CatalogList`/`CatalogDetailPanel` are generic, presentation-only shared components; `DatasetsSection`/`ModelosSection` own the per-kind data fetching and pass already-filtered data + a `renderRow` function into `CatalogList`. `CatalogBrowser` is the popup shell (tabs, search, close) rendered by `AppShell.tsx`. No backend/API changes anywhere in this plan.

**Tech Stack:** React/Next.js (`apps/web`), Tailwind (existing tokens only), Vitest.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-17-catalog-browser-redesign-design.md` — read it before starting.
- No backend/API changes. Every route this plan's UI calls (`GET /api/datasets`, `POST /api/datasets/install`, `POST /api/datasets/publish`, `GET /api/model-catalog`, `POST /api/model-catalog/install`, `GET /api/areas`) already exists and is consumed exactly as-is.
- No new settings/schema fields — the remembered dataset-publish repo is `localStorage` only (key `"lumi:lastDatasetRepo"`), never sent to the server.
- No real per-item thumbnails — this plan does not add icons/images to rows, only text (the spec's "generic decorative icon" idea is explicitly dropped as unnecessary polish; nothing in the approved mockups requires it to function).
- All user-facing copy is in Spanish, matching the rest of the app.
- Follow existing conventions exactly: pure client-side helpers live in `apps/web/app/lib/` with a colocated `.test.ts` (see `apps/web/app/lib/area-status.ts`/`.test.ts`); `fetchJson` (`apps/web/app/lib/fetch-json.ts`) is the only fetch wrapper used; Tailwind classes/colors are copied from the components being replaced, never invented; `pg` integer columns (e.g. `points_captured`) come back as real JS numbers, only `numeric`/`decimal` columns come back as strings (see `AreasManagePanel.tsx`'s own `AreaItem` comment) — don't add unnecessary `Number(...)` casts where the column is already an integer.
- This codebase has no DOM/testing-library test environment (`apps/web/vitest.config.ts` sets `environment: "node"`) — no component-rendering tests exist anywhere in `apps/web/app/components/`, and this plan does not introduce the first one. All new tests in this plan are against plain, framework-free functions.

---

### Task 1: Shared catalog types + flatten helpers

**Files:**
- Create: `apps/web/app/lib/catalog-types.ts`
- Create: `apps/web/app/lib/catalog-types.test.ts`

**Interfaces:**
- Produces: `ModelTag`, `DatasetRelease`, `DatasetArea`, `DatasetCatalogItem`, `Backbone`, `CatalogBenchmark`, `CatalogRelease`, `CatalogBundle`, `ModelCatalogItem`, `flattenDatasetAreas(areas: DatasetArea[]): DatasetCatalogItem[]`, `flattenModelBundles(bundles: CatalogBundle[]): ModelCatalogItem[]` — every later task imports these types; Tasks 9-10 call the flatten functions.

- [ ] **Step 1: Write the failing tests**

```ts
// apps/web/app/lib/catalog-types.test.ts
import { describe, it, expect } from "vitest";
import { flattenDatasetAreas, flattenModelBundles } from "./catalog-types";
import type { DatasetArea, CatalogBundle } from "./catalog-types";

describe("flattenDatasetAreas", () => {
  it("produces one item per release, keyed by owner/repo#tag", () => {
    const areas: DatasetArea[] = [
      {
        owner: "inigo",
        repo: "lumi-madrid",
        releases: [
          {
            tag: "lumi-preview-v1.0",
            title: "Downtown Madrid",
            description: "",
            model: { id: "lumi-preview", version: "1.0", embeddingDim: 8448 },
            stats: { pointsCaptured: 10, imagesEmbedded: 40 },
            compatible: true,
          },
        ],
      },
    ];
    const items = flattenDatasetAreas(areas);
    expect(items).toEqual([
      { id: "inigo/lumi-madrid#lumi-preview-v1.0", owner: "inigo", repo: "lumi-madrid", release: areas[0].releases[0] },
    ]);
  });
});

describe("flattenModelBundles", () => {
  it("produces one item per release, keyed by owner/repo#tag", () => {
    const bundles: CatalogBundle[] = [
      {
        owner: "inigo",
        repo: "lumi-model-catalog",
        releases: [
          {
            tag: "lumi-preview-v1.0",
            bundleId: "lumi-preview",
            version: "1.0",
            backbones: [],
            benchmark: { accuracyWithin50m: 0.9, avgDistanceM: 5, sampleCount: 20, ranAt: "x" },
            description: "",
            isActive: true,
          },
        ],
      },
    ];
    const items = flattenModelBundles(bundles);
    expect(items).toEqual([
      { id: "inigo/lumi-model-catalog#lumi-preview-v1.0", owner: "inigo", repo: "lumi-model-catalog", release: bundles[0].releases[0] },
    ]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @netryx/web test lib/catalog-types`
Expected: FAIL — `Cannot find module './catalog-types'`.

- [ ] **Step 3: Write the implementation**

```ts
// apps/web/app/lib/catalog-types.ts

export interface ModelTag { id: string; version: string; embeddingDim: number }

export interface DatasetRelease {
  tag: string;
  title: string;
  description: string;
  model: ModelTag;
  stats: { pointsCaptured: number; imagesEmbedded: number };
  compatible: boolean;
}

export interface DatasetArea { owner: string; repo: string; releases: DatasetRelease[] }

export interface DatasetCatalogItem {
  id: string;
  owner: string;
  repo: string;
  release: DatasetRelease;
}

export interface Backbone { name: string; source: string }

export interface CatalogBenchmark {
  accuracyWithin50m: number;
  avgDistanceM: number;
  sampleCount: number;
  ranAt: string;
}

export interface CatalogRelease {
  tag: string;
  bundleId: string;
  version: string;
  backbones: Backbone[];
  benchmark: CatalogBenchmark;
  description: string;
  isActive: boolean;
}

export interface CatalogBundle { owner: string; repo: string; releases: CatalogRelease[] }

export interface ModelCatalogItem {
  id: string;
  owner: string;
  repo: string;
  release: CatalogRelease;
}

/** Flattens the grouped-by-repo API response into one row per release — the
 * Factorio-style list shows one row per item, not a card per repo (spec:
 * docs/superpowers/specs/2026-07-17-catalog-browser-redesign-design.md). */
export function flattenDatasetAreas(areas: DatasetArea[]): DatasetCatalogItem[] {
  return areas.flatMap((area) =>
    area.releases.map((release) => ({
      id: `${area.owner}/${area.repo}#${release.tag}`,
      owner: area.owner,
      repo: area.repo,
      release,
    }))
  );
}

export function flattenModelBundles(bundles: CatalogBundle[]): ModelCatalogItem[] {
  return bundles.flatMap((bundle) =>
    bundle.releases.map((release) => ({
      id: `${bundle.owner}/${bundle.repo}#${release.tag}`,
      owner: bundle.owner,
      repo: bundle.repo,
      release,
    }))
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @netryx/web test lib/catalog-types`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/lib/catalog-types.ts apps/web/app/lib/catalog-types.test.ts
git commit -m "feat(web): add shared catalog types and grouped-to-flat-list helpers"
```

---

### Task 2: Pure filter helpers

**Files:**
- Create: `apps/web/app/lib/catalog-filters.ts`
- Create: `apps/web/app/lib/catalog-filters.test.ts`

**Interfaces:**
- Consumes: `DatasetCatalogItem`, `ModelCatalogItem` (Task 1).
- Produces: `DATASET_FILTERS`, `DatasetFilterId`, `filterDatasetItems(items, filterId)`, `MODEL_FILTERS`, `ModelFilterId`, `filterModelItems(items, filterId)` — Tasks 9-10's sections use all of these.

- [ ] **Step 1: Write the failing tests**

```ts
// apps/web/app/lib/catalog-filters.test.ts
import { describe, it, expect } from "vitest";
import { filterDatasetItems, filterModelItems } from "./catalog-filters";
import type { DatasetCatalogItem, ModelCatalogItem } from "./catalog-types";

function makeDatasetItem(compatible: boolean): DatasetCatalogItem {
  return {
    id: `item-${compatible}`,
    owner: "inigo",
    repo: "lumi-madrid",
    release: {
      tag: "lumi-preview-v1.0",
      title: "T",
      description: "D",
      model: { id: "lumi-preview", version: "1.0", embeddingDim: 8448 },
      stats: { pointsCaptured: 10, imagesEmbedded: 40 },
      compatible,
    },
  };
}

function makeModelItem(isActive: boolean): ModelCatalogItem {
  return {
    id: `model-${isActive}`,
    owner: "inigo",
    repo: "lumi-model-catalog",
    release: {
      tag: "lumi-preview-v1.0",
      bundleId: "lumi-preview",
      version: "1.0",
      backbones: [],
      benchmark: { accuracyWithin50m: 0.9, avgDistanceM: 5, sampleCount: 20, ranAt: "x" },
      description: "",
      isActive,
    },
  };
}

describe("filterDatasetItems", () => {
  it("returns everything for 'all'", () => {
    const items = [makeDatasetItem(true), makeDatasetItem(false)];
    expect(filterDatasetItems(items, "all")).toHaveLength(2);
  });

  it("filters to only compatible items", () => {
    const items = [makeDatasetItem(true), makeDatasetItem(false)];
    const result = filterDatasetItems(items, "compatible");
    expect(result).toHaveLength(1);
    expect(result[0].release.compatible).toBe(true);
  });

  it("filters to only incompatible items", () => {
    const items = [makeDatasetItem(true), makeDatasetItem(false)];
    const result = filterDatasetItems(items, "incompatible");
    expect(result).toHaveLength(1);
    expect(result[0].release.compatible).toBe(false);
  });
});

describe("filterModelItems", () => {
  it("returns everything for 'all'", () => {
    const items = [makeModelItem(true), makeModelItem(false)];
    expect(filterModelItems(items, "all")).toHaveLength(2);
  });

  it("filters to only the active release", () => {
    const items = [makeModelItem(true), makeModelItem(false)];
    const result = filterModelItems(items, "active");
    expect(result).toHaveLength(1);
    expect(result[0].release.isActive).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @netryx/web test lib/catalog-filters`
Expected: FAIL — `Cannot find module './catalog-filters'`.

- [ ] **Step 3: Write the implementation**

```ts
// apps/web/app/lib/catalog-filters.ts
import type { DatasetCatalogItem, ModelCatalogItem } from "./catalog-types";

export const DATASET_FILTERS = [
  { id: "all", label: "Todos" },
  { id: "compatible", label: "Compatibles" },
  { id: "incompatible", label: "No compatibles" },
] as const;

export type DatasetFilterId = (typeof DATASET_FILTERS)[number]["id"];

/** No "Instalados" filter here on purpose — dataset installs are additive
 * (you can install the same or a different area repeatedly), and
 * GET /api/datasets carries no "this exact release is already installed
 * locally" flag the way models' `isActive` does. Inventing one is a real
 * feature, out of scope for this UI-only redesign (spec's Data section). */
export function filterDatasetItems(items: DatasetCatalogItem[], filterId: DatasetFilterId): DatasetCatalogItem[] {
  if (filterId === "compatible") return items.filter((i) => i.release.compatible);
  if (filterId === "incompatible") return items.filter((i) => !i.release.compatible);
  return items;
}

export const MODEL_FILTERS = [
  { id: "all", label: "Todos" },
  { id: "active", label: "Instalada" },
] as const;

export type ModelFilterId = (typeof MODEL_FILTERS)[number]["id"];

export function filterModelItems(items: ModelCatalogItem[], filterId: ModelFilterId): ModelCatalogItem[] {
  if (filterId === "active") return items.filter((i) => i.release.isActive);
  return items;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @netryx/web test lib/catalog-filters`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/lib/catalog-filters.ts apps/web/app/lib/catalog-filters.test.ts
git commit -m "feat(web): add pure catalog sidebar-filter helpers"
```

---

### Task 3: Remembered dataset-repo helper

**Files:**
- Create: `apps/web/app/lib/last-dataset-repo.ts`
- Create: `apps/web/app/lib/last-dataset-repo.test.ts`

**Interfaces:**
- Produces: `RepoStorage` (an injectable `{getItem, setItem}` interface), `getLastDatasetRepo(storage)`, `setLastDatasetRepo(storage, repo)` — Task 8's `PublishWizard` calls both with `window.localStorage` at the real call site.

- [ ] **Step 1: Write the failing tests**

```ts
// apps/web/app/lib/last-dataset-repo.test.ts
import { describe, it, expect } from "vitest";
import { getLastDatasetRepo, setLastDatasetRepo, type RepoStorage } from "./last-dataset-repo";

function makeFakeStorage(): RepoStorage {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
  };
}

describe("getLastDatasetRepo", () => {
  it("returns an empty string when nothing was ever saved", () => {
    expect(getLastDatasetRepo(makeFakeStorage())).toBe("");
  });

  it("returns whatever was saved by setLastDatasetRepo", () => {
    const storage = makeFakeStorage();
    setLastDatasetRepo(storage, "inigo/lumi-madrid");
    expect(getLastDatasetRepo(storage)).toBe("inigo/lumi-madrid");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @netryx/web test lib/last-dataset-repo`
Expected: FAIL — `Cannot find module './last-dataset-repo'`.

- [ ] **Step 3: Write the implementation**

```ts
// apps/web/app/lib/last-dataset-repo.ts

const STORAGE_KEY = "lumi:lastDatasetRepo";

export interface RepoStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Remembers the last owner/repo the user published a dataset to, so the
 * publish wizard's destination step doesn't start empty every time
 * (spec's Non-goals: localStorage only, no server-side setting). An
 * injectable storage parameter — not a bare `localStorage` reference —
 * keeps this testable in the Node test environment, which has no
 * `window`; the real call site (PublishWizard.tsx) passes
 * `window.localStorage`. */
export function getLastDatasetRepo(storage: RepoStorage): string {
  return storage.getItem(STORAGE_KEY) ?? "";
}

export function setLastDatasetRepo(storage: RepoStorage, repo: string): void {
  storage.setItem(STORAGE_KEY, repo);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @netryx/web test lib/last-dataset-repo`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/lib/last-dataset-repo.ts apps/web/app/lib/last-dataset-repo.test.ts
git commit -m "feat(web): add injectable-storage helper for the remembered publish repo"
```

---

### Task 4: Publish wizard step-validation helpers

**Files:**
- Create: `apps/web/app/lib/publish-wizard-steps.ts`
- Create: `apps/web/app/lib/publish-wizard-steps.test.ts`

**Interfaces:**
- Produces: `canAdvanceFromAreaStep(selectedAreaId)`, `canAdvanceFromDetailsStep(title)`, `canPublish(repo, tosAccepted)` — Task 8's `PublishWizard` calls all three to enable/disable its Siguiente/Publicar buttons.

- [ ] **Step 1: Write the failing tests**

```ts
// apps/web/app/lib/publish-wizard-steps.test.ts
import { describe, it, expect } from "vitest";
import { canAdvanceFromAreaStep, canAdvanceFromDetailsStep, canPublish } from "./publish-wizard-steps";

describe("canAdvanceFromAreaStep", () => {
  it("is false with no area selected", () => {
    expect(canAdvanceFromAreaStep(null)).toBe(false);
    expect(canAdvanceFromAreaStep("")).toBe(false);
  });

  it("is true once an area id is selected", () => {
    expect(canAdvanceFromAreaStep("area-1")).toBe(true);
  });
});

describe("canAdvanceFromDetailsStep", () => {
  it("is false with a blank or whitespace-only title", () => {
    expect(canAdvanceFromDetailsStep("")).toBe(false);
    expect(canAdvanceFromDetailsStep("   ")).toBe(false);
  });

  it("is true with a real title", () => {
    expect(canAdvanceFromDetailsStep("Downtown Madrid")).toBe(true);
  });
});

describe("canPublish", () => {
  it("requires both a valid owner/repo shape and the ToS checkbox", () => {
    expect(canPublish("inigo/lumi-madrid", true)).toBe(true);
    expect(canPublish("inigo/lumi-madrid", false)).toBe(false);
    expect(canPublish("not-a-repo", true)).toBe(false);
    expect(canPublish("", true)).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @netryx/web test lib/publish-wizard-steps`
Expected: FAIL — `Cannot find module './publish-wizard-steps'`.

- [ ] **Step 3: Write the implementation**

```ts
// apps/web/app/lib/publish-wizard-steps.ts

/** Step 1 (choose area) only advances once an area is actually selected. */
export function canAdvanceFromAreaStep(selectedAreaId: string | null): boolean {
  return selectedAreaId !== null && selectedAreaId !== "";
}

/** Step 2 (details) requires at least a non-blank title — description stays optional. */
export function canAdvanceFromDetailsStep(title: string): boolean {
  return title.trim().length > 0;
}

/** Step 3 (destination) requires an "owner/repo"-shaped value and the ToS checkbox. */
export function canPublish(repo: string, tosAccepted: boolean): boolean {
  return tosAccepted && /^[^/\s]+\/[^/\s]+$/.test(repo.trim());
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @netryx/web test lib/publish-wizard-steps`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/lib/publish-wizard-steps.ts apps/web/app/lib/publish-wizard-steps.test.ts
git commit -m "feat(web): add publish-wizard step-validation helpers"
```

---

### Task 5: `CatalogList` shared component

**Files:**
- Create: `apps/web/app/components/CatalogList.tsx`

**Interfaces:**
- Produces: `CatalogFilterOption { id, label }`, `CatalogList<T extends {id: string}>({items, filters, activeFilter, onFilterChange, selectedId, onSelect, renderRow})` — Tasks 9-10 both render this with their own item type and row renderer.

- [ ] **Step 1: Write the component**

```tsx
// apps/web/app/components/CatalogList.tsx
"use client";

export interface CatalogFilterOption {
  id: string;
  label: string;
}

/**
 * Shared Factorio-mod-menu-style list: a left sidebar of category filters
 * and a scrollable row list. Presentation-only — filtering/searching
 * happens in the caller (DatasetsSection/ModelosSection) before `items`
 * ever reaches this component, and each row's actual content comes from
 * `renderRow`, since datasets and models have genuinely different fields
 * to show (spec: "share layout, not necessarily data shape").
 */
export function CatalogList<T extends { id: string }>({
  items,
  filters,
  activeFilter,
  onFilterChange,
  selectedId,
  onSelect,
  renderRow,
}: {
  items: T[];
  filters: CatalogFilterOption[];
  activeFilter: string;
  onFilterChange: (id: string) => void;
  selectedId: string | null;
  onSelect: (item: T) => void;
  renderRow: (item: T, selected: boolean) => React.ReactNode;
}) {
  return (
    <div className="flex h-full overflow-hidden">
      <div className="w-32 flex-shrink-0 border-r border-white/10 px-2 py-3 text-[11.5px] text-muted">
        {filters.map((f) => (
          <div
            key={f.id}
            onClick={() => onFilterChange(f.id)}
            className={`mb-0.5 cursor-pointer rounded-md px-2.5 py-1.5 ${
              activeFilter === f.id ? "bg-white/[.06] text-fg" : "hover:text-fg"
            }`}
          >
            {f.label}
          </div>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto">
        {items.map((item) => (
          <div key={item.id} onClick={() => onSelect(item)} className="cursor-pointer">
            {renderRow(item, item.id === selectedId)}
          </div>
        ))}
        {items.length === 0 && (
          <div className="p-6 text-center text-xs text-subtle">No hay elementos que coincidan.</div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @netryx/web typecheck`
Expected: no errors (nothing imports this component yet, so this only checks the file compiles standalone).

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/components/CatalogList.tsx
git commit -m "feat(web): add shared CatalogList (sidebar filters + row list)"
```

---

### Task 6: `CatalogDetailPanel` shared component

**Files:**
- Create: `apps/web/app/components/CatalogDetailPanel.tsx`

**Interfaces:**
- Produces: `CatalogDetailPanel({title, subtitle, stats, extra?, installLabel, installDisabled?, onInstall})` — Tasks 9-10 both render this.

- [ ] **Step 1: Write the component**

```tsx
// apps/web/app/components/CatalogDetailPanel.tsx
"use client";

/**
 * Shared right-side detail panel (spec: "right-side panel" won over
 * replace-the-list and inline-accordion). `stats` is a small label/value
 * grid — datasets show points/images, models show accuracy/distance/
 * sample-count, using the exact same rendering either way. `extra` is a
 * slot for anything kind-specific (models' backbone list) that doesn't
 * fit the stats grid.
 */
export function CatalogDetailPanel({
  title,
  subtitle,
  stats,
  extra,
  installLabel,
  installDisabled,
  onInstall,
}: {
  title: string;
  subtitle: string;
  stats: { label: string; value: string }[];
  extra?: React.ReactNode;
  installLabel: string;
  installDisabled?: boolean;
  onInstall: () => void;
}) {
  return (
    <div className="flex h-full w-full flex-col overflow-y-auto p-5">
      <div className="text-[14px] font-medium text-fg">{title}</div>
      <div className="mt-1 text-[11.5px] text-muted">{subtitle}</div>
      <div className="mt-4 flex gap-6">
        {stats.map((s) => (
          <div key={s.label}>
            <div className="text-[10.5px] uppercase tracking-wide text-subtle">{s.label}</div>
            <div className="mt-0.5 text-[17px] text-fg">{s.value}</div>
          </div>
        ))}
      </div>
      {extra}
      <button
        onClick={onInstall}
        disabled={installDisabled}
        className="mt-5 self-start rounded-md bg-accent px-4 py-2 text-xs font-medium text-black disabled:opacity-50"
      >
        {installLabel}
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @netryx/web typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/components/CatalogDetailPanel.tsx
git commit -m "feat(web): add shared CatalogDetailPanel"
```

---

### Task 7: Extract `MismatchDialog`

**Files:**
- Create: `apps/web/app/components/MismatchDialog.tsx`

**Interfaces:**
- Consumes: `DatasetRelease` (Task 1).
- Produces: `MismatchDialog({release, onCancel, onConfirm})` — Task 9's `DatasetsSection` renders this, byte-identical to the version currently inline in `DatasetsCatalogPanel.tsx`.

- [ ] **Step 1: Write the component**

```tsx
// apps/web/app/components/MismatchDialog.tsx
"use client";
import { FloatingCard } from "./FloatingCard";
import type { DatasetRelease } from "../lib/catalog-types";

export function MismatchDialog({
  release,
  onCancel,
  onConfirm,
}: {
  release: DatasetRelease;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/60">
      <FloatingCard className="w-[420px] p-5">
        <div className="text-[13.5px] font-medium text-fg">Modelo distinto al activo</div>
        <p className="mt-2.5 text-[12.5px] text-muted">
          Este dataset se construyó con <b className="text-fg">{release.model.id} v{release.model.version}</b>.
          Se instalarán las imágenes y puntos igualmente, y se completarán los embeddings automáticamente con tu
          modelo activo (sin volver a gastar cuota de Street View). El área aparecerá como &quot;indexando&quot; hasta que termine.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onCancel} className="rounded-md border border-white/15 px-4 py-2 text-xs text-fg hover:bg-white/10">
            Cancelar
          </button>
          <button onClick={onConfirm} className="rounded-md bg-accent px-4 py-2 text-xs font-medium text-black">
            Instalar y completar embeddings
          </button>
        </div>
      </FloatingCard>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @netryx/web typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/components/MismatchDialog.tsx
git commit -m "feat(web): extract MismatchDialog into its own shared component"
```

---

### Task 8: `PublishWizard` (3-step dataset publish flow)

**Files:**
- Create: `apps/web/app/components/PublishWizard.tsx`

**Interfaces:**
- Consumes: `canAdvanceFromAreaStep`, `canAdvanceFromDetailsStep`, `canPublish` (Task 4); `getLastDatasetRepo`, `setLastDatasetRepo` (Task 3); `fetchJson` (`apps/web/app/lib/fetch-json.ts`, unchanged).
- Produces: `PublishWizard({onClose, onPublished})` — Task 9's `DatasetsSection` renders this when its "+ Publicar dataset" button is clicked.

- [ ] **Step 1: Write the component**

```tsx
// apps/web/app/components/PublishWizard.tsx
"use client";
import { useEffect, useState } from "react";
import { fetchJson } from "../lib/fetch-json";
import { canAdvanceFromAreaStep, canAdvanceFromDetailsStep, canPublish } from "../lib/publish-wizard-steps";
import { getLastDatasetRepo, setLastDatasetRepo } from "../lib/last-dataset-repo";

interface Area {
  id: string;
  name: string | null;
  status: string;
  points_captured: number;
}

export function PublishWizard({ onClose, onPublished }: { onClose: () => void; onPublished: () => void }) {
  const [step, setStep] = useState(1);
  const [areas, setAreas] = useState<Area[]>([]);
  const [areasError, setAreasError] = useState<string | null>(null);
  const [selectedAreaId, setSelectedAreaId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [repo, setRepo] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    fetchJson<{ areas: Area[] }>("/api/areas").then((r) => {
      if (!r.ok) {
        setAreasError((r.data as { error?: string } | null)?.error ?? "No se pudieron cargar las áreas");
        return;
      }
      setAreas(r.data?.areas ?? []);
    });
    setRepo(getLastDatasetRepo(window.localStorage));
  }, []);

  function selectArea(area: Area) {
    setSelectedAreaId(area.id);
    if (!title && area.name) setTitle(area.name);
  }

  async function publish() {
    setStatus("Publicando…");
    const [owner, repoName] = repo.split("/");
    const { ok, data } = await fetchJson("/api/datasets/publish", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ areaId: selectedAreaId, title, description, owner, repo: repoName }),
    });
    if (!ok) {
      setStatus((data as { error?: string } | null)?.error ?? "No se pudo publicar");
      return;
    }
    setLastDatasetRepo(window.localStorage, repo);
    onPublished();
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60">
      <div className="relative w-[480px] rounded-card border border-white/10 bg-panel p-5">
        <button onClick={onClose} className="absolute right-4 top-4 text-subtle hover:text-fg">✕</button>

        <div className="mb-4 flex gap-1.5">
          {[1, 2, 3].map((s) => (
            <div key={s} className={`h-[3px] flex-1 rounded-full ${s <= step ? "bg-[#85b7eb]" : "bg-white/10"}`} />
          ))}
        </div>

        {step === 1 && (
          <div>
            <div className="mb-3 text-xs text-muted">Paso 1 de 3 — Elige el área</div>
            {areasError && <div className="mb-3 text-xs text-danger-fg">{areasError}</div>}
            <div className="max-h-[280px] overflow-y-auto">
              {areas.map((area) => {
                const indexed = area.status === "indexed";
                const selected = selectedAreaId === area.id;
                return (
                  <div
                    key={area.id}
                    onClick={() => indexed && selectArea(area)}
                    className={`mb-2 flex items-center justify-between rounded-md border px-3 py-2.5 ${
                      !indexed
                        ? "cursor-default border-white/10 opacity-40"
                        : selected
                        ? "cursor-pointer border-[#85b7eb]"
                        : "cursor-pointer border-white/10 hover:border-white/25"
                    }`}
                  >
                    <div>
                      <div className="text-[12.5px] text-fg">{area.name ?? "(sin nombre)"}</div>
                      <div className="text-[10.5px] text-subtle">
                        {indexed ? `${area.points_captured} puntos · indexada` : "no disponible aún"}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="mt-4 flex justify-end">
              <button
                disabled={!canAdvanceFromAreaStep(selectedAreaId)}
                onClick={() => setStep(2)}
                className="rounded-md bg-accent px-4 py-2 text-xs font-medium text-black disabled:opacity-50"
              >
                Siguiente →
              </button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div>
            <div className="mb-3 text-xs text-muted">Paso 2 de 3 — Detalles</div>
            <label className="mb-1 block text-xs text-muted">Título</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="mb-3 w-full rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm text-fg outline-none focus:border-white/25"
            />
            <label className="mb-1 block text-xs text-muted">Descripción (opcional)</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="mb-3 h-20 w-full rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm text-fg outline-none focus:border-white/25"
            />
            <div className="flex justify-between">
              <button onClick={() => setStep(1)} className="rounded-md px-4 py-2 text-xs text-muted hover:text-fg">
                ← Volver
              </button>
              <button
                disabled={!canAdvanceFromDetailsStep(title)}
                onClick={() => setStep(3)}
                className="rounded-md bg-accent px-4 py-2 text-xs font-medium text-black disabled:opacity-50"
              >
                Siguiente →
              </button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div>
            <div className="mb-3 text-xs text-muted">Paso 3 de 3 — Destino y publicar</div>
            <label className="mb-1 block text-xs text-muted">Repositorio destino (owner/repo)</label>
            <input
              value={repo}
              onChange={(e) => setRepo(e.target.value)}
              placeholder="owner/repo"
              className="mb-3 w-full rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm text-fg outline-none focus:border-white/25"
            />
            <div className="mb-3 rounded-md border border-dashed border-white/22 bg-white/[.03] px-3 py-2 text-xs text-muted">
              🔒 Se publicará etiquetado con tu modelo de retrieval activo ahora mismo (no editable).
            </div>
            <div className="mb-3 flex items-start gap-2 rounded-md border border-[rgba(163,51,51,0.4)] bg-[rgba(163,51,51,0.08)] px-3 py-2.5 text-[11.5px] text-danger-fg">
              <input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} className="mt-0.5" />
              <span>
                Entiendo que publicar contenido de Street View reempaquetado a otros usuarios puede infringir los
                Términos de Servicio de Google Maps Platform (ver docs/PROOF_OF_CONCEPT.md §3.1) y asumo esa responsabilidad.
              </span>
            </div>
            <div className="flex items-center justify-between">
              <button onClick={() => setStep(2)} className="rounded-md px-4 py-2 text-xs text-muted hover:text-fg">
                ← Volver
              </button>
              <div className="flex items-center gap-3">
                {status && <span className="text-xs text-muted">{status}</span>}
                <button
                  disabled={!canPublish(repo, accepted)}
                  onClick={publish}
                  className="rounded-md bg-accent px-4 py-2 text-xs font-medium text-black disabled:opacity-50"
                >
                  Publicar
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @netryx/web typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/components/PublishWizard.tsx
git commit -m "feat(web): add 3-step PublishWizard replacing the free-text publish form"
```

---

### Task 9: `DatasetsSection`

**Files:**
- Create: `apps/web/app/components/DatasetsSection.tsx`

**Interfaces:**
- Consumes: `flattenDatasetAreas`, `DatasetArea`, `DatasetCatalogItem` (Task 1); `DATASET_FILTERS`, `filterDatasetItems`, `DatasetFilterId` (Task 2); `CatalogList` (Task 5); `CatalogDetailPanel` (Task 6); `MismatchDialog` (Task 7); `PublishWizard` (Task 8); `fetchJson` (unchanged).
- Produces: `DatasetsSection({query}: {query: string})` — Task 11's `CatalogBrowser` renders this.

- [ ] **Step 1: Write the component**

```tsx
// apps/web/app/components/DatasetsSection.tsx
"use client";
import { useEffect, useState } from "react";
import { fetchJson } from "../lib/fetch-json";
import { flattenDatasetAreas, type DatasetArea, type DatasetCatalogItem } from "../lib/catalog-types";
import { DATASET_FILTERS, filterDatasetItems, type DatasetFilterId } from "../lib/catalog-filters";
import { CatalogList } from "./CatalogList";
import { CatalogDetailPanel } from "./CatalogDetailPanel";
import { MismatchDialog } from "./MismatchDialog";
import { PublishWizard } from "./PublishWizard";

function DatasetRow({ item, selected }: { item: DatasetCatalogItem; selected: boolean }) {
  return (
    <div className={`flex items-center justify-between border-b border-white/10 px-4 py-3 ${selected ? "bg-white/[.03]" : ""}`}>
      <div>
        <div className="text-[13px] text-fg">{item.release.title}</div>
        <div className="text-[11px] text-subtle">{item.owner}/{item.repo} · {item.release.stats.pointsCaptured} puntos</div>
      </div>
      <span
        className={`rounded-full px-2.5 py-0.5 text-[10.5px] font-medium ${
          item.release.compatible
            ? "border border-[rgba(120,200,140,0.35)] bg-[rgba(120,200,140,0.12)] text-[#8fd6a3]"
            : "border border-[rgba(239,159,39,0.4)] bg-[rgba(239,159,39,0.12)] text-warning-fg"
        }`}
      >
        {item.release.compatible ? "Compatible" : "Requiere completar embeddings"}
      </span>
    </div>
  );
}

export function DatasetsSection({ query }: { query: string }) {
  const [items, setItems] = useState<DatasetCatalogItem[]>([]);
  const [filter, setFilter] = useState<DatasetFilterId>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [pendingInstall, setPendingInstall] = useState<DatasetCatalogItem | null>(null);
  const [publishOpen, setPublishOpen] = useState(false);

  function reload() {
    fetchJson<{ areas: DatasetArea[] }>("/api/datasets").then((r) => setItems(flattenDatasetAreas(r.data?.areas ?? [])));
  }

  useEffect(reload, []);

  const q = query.toLowerCase();
  const filtered = filterDatasetItems(items, filter).filter(
    (item) =>
      item.release.title.toLowerCase().includes(q) ||
      item.repo.toLowerCase().includes(q) ||
      item.owner.toLowerCase().includes(q)
  );
  const selected = items.find((i) => i.id === selectedId) ?? null;

  async function install(item: DatasetCatalogItem, forceInstall: boolean) {
    setStatus("Instalando…");
    const { ok, data } = await fetchJson("/api/datasets/install", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ owner: item.owner, repo: item.repo, tag: item.release.tag, forceInstall }),
    });
    if (!ok && (data as { compatible?: boolean } | null)?.compatible === false && !forceInstall) {
      setPendingInstall(item);
      setStatus(null);
      return;
    }
    setStatus(ok ? "Instalado" : (data as { error?: string } | null)?.error ?? "No se pudo instalar");
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-end border-b border-white/10 px-3 py-2">
        <button
          onClick={() => setPublishOpen(true)}
          className="rounded-md border border-white/15 px-3 py-1.5 text-[11.5px] text-fg hover:bg-white/10"
        >
          + Publicar dataset
        </button>
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="w-[55%] border-r border-white/10">
          <CatalogList
            items={filtered}
            filters={[...DATASET_FILTERS]}
            activeFilter={filter}
            onFilterChange={(id) => setFilter(id as DatasetFilterId)}
            selectedId={selectedId}
            onSelect={(item) => setSelectedId(item.id)}
            renderRow={(item, sel) => <DatasetRow item={item} selected={sel} />}
          />
        </div>
        <div className="flex w-[45%] flex-col">
          {selected ? (
            <CatalogDetailPanel
              title={selected.release.title}
              subtitle={`github.com/${selected.owner}/${selected.repo} · ${selected.release.model.id} v${selected.release.model.version}`}
              stats={[
                { label: "Puntos", value: String(selected.release.stats.pointsCaptured) },
                { label: "Imágenes", value: String(selected.release.stats.imagesEmbedded) },
              ]}
              installLabel="Instalar"
              onInstall={() => install(selected, false)}
            />
          ) : (
            <div className="flex h-full items-center justify-center text-xs text-subtle">
              Selecciona un dataset para ver el detalle.
            </div>
          )}
          {status && <div className="px-5 pb-3 text-xs text-muted">{status}</div>}
        </div>
      </div>
      {pendingInstall && (
        <MismatchDialog
          release={pendingInstall.release}
          onCancel={() => setPendingInstall(null)}
          onConfirm={() => {
            const item = pendingInstall;
            setPendingInstall(null);
            install(item, true);
          }}
        />
      )}
      {publishOpen && (
        <PublishWizard
          onClose={() => setPublishOpen(false)}
          onPublished={() => {
            setPublishOpen(false);
            reload();
          }}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @netryx/web typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/components/DatasetsSection.tsx
git commit -m "feat(web): add DatasetsSection wiring CatalogList/DetailPanel/MismatchDialog/PublishWizard"
```

---

### Task 10: `ModelosSection`

**Files:**
- Create: `apps/web/app/components/ModelosSection.tsx`

**Interfaces:**
- Consumes: `flattenModelBundles`, `CatalogBundle`, `ModelCatalogItem` (Task 1); `MODEL_FILTERS`, `filterModelItems`, `ModelFilterId` (Task 2); `CatalogList` (Task 5); `CatalogDetailPanel` (Task 6); `fetchJson` (unchanged).
- Produces: `ModelosSection({query}: {query: string})` — Task 11's `CatalogBrowser` renders this. No publish UI anywhere in this file.

- [ ] **Step 1: Write the component**

```tsx
// apps/web/app/components/ModelosSection.tsx
"use client";
import { useEffect, useState } from "react";
import { fetchJson } from "../lib/fetch-json";
import { flattenModelBundles, type CatalogBundle, type ModelCatalogItem } from "../lib/catalog-types";
import { MODEL_FILTERS, filterModelItems, type ModelFilterId } from "../lib/catalog-filters";
import { CatalogList } from "./CatalogList";
import { CatalogDetailPanel } from "./CatalogDetailPanel";

function ModelRow({ item, selected }: { item: ModelCatalogItem; selected: boolean }) {
  return (
    <div className={`flex items-center justify-between border-b border-white/10 px-4 py-3 ${selected ? "bg-white/[.03]" : ""}`}>
      <div>
        <div className="text-[13px] text-fg">v{item.release.version}</div>
        <div className="text-[11px] text-subtle">{item.release.backbones.map((b) => b.name).join(" + ")}</div>
      </div>
      <div className="flex items-center gap-2">
        <span className="rounded-full border border-[rgba(120,200,140,0.35)] bg-[rgba(120,200,140,0.12)] px-2.5 py-0.5 text-[10.5px] font-medium text-[#8fd6a3]">
          {Math.round(item.release.benchmark.accuracyWithin50m * 100)}% ≤ 50m
        </span>
        {item.release.isActive && (
          <span className="rounded-full border border-[rgba(133,183,235,0.35)] bg-[rgba(133,183,235,0.12)] px-2.5 py-0.5 text-[10.5px] font-medium text-[#85b7eb]">
            Activa
          </span>
        )}
      </div>
    </div>
  );
}

export function ModelosSection({ query }: { query: string }) {
  const [items, setItems] = useState<ModelCatalogItem[]>([]);
  const [filter, setFilter] = useState<ModelFilterId>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    fetchJson<{ bundles: CatalogBundle[] }>("/api/model-catalog").then((r) => setItems(flattenModelBundles(r.data?.bundles ?? [])));
  }, []);

  const q = query.toLowerCase();
  const filtered = filterModelItems(items, filter).filter((item) => item.release.version.toLowerCase().includes(q));
  const selected = items.find((i) => i.id === selectedId) ?? null;

  async function install(item: ModelCatalogItem) {
    setStatus(`Instalando v${item.release.version}…`);
    const { ok, data } = await fetchJson("/api/model-catalog/install", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ owner: item.owner, repo: item.repo, tag: item.release.tag }),
    });
    setStatus(ok ? `Instalada v${item.release.version}` : (data as { error?: string } | null)?.error ?? "No se pudo instalar");
  }

  return (
    <div className="flex h-full">
      <div className="w-[55%] border-r border-white/10">
        <CatalogList
          items={filtered}
          filters={[...MODEL_FILTERS]}
          activeFilter={filter}
          onFilterChange={(id) => setFilter(id as ModelFilterId)}
          selectedId={selectedId}
          onSelect={(item) => setSelectedId(item.id)}
          renderRow={(item, sel) => <ModelRow item={item} selected={sel} />}
        />
      </div>
      <div className="flex w-[45%] flex-col">
        {selected ? (
          <CatalogDetailPanel
            title={`Lumi Preview v${selected.release.version}`}
            subtitle={`github.com/${selected.owner}/${selected.repo}`}
            stats={[
              { label: "Precisión (≤50m)", value: `${Math.round(selected.release.benchmark.accuracyWithin50m * 100)}%` },
              { label: "Distancia media", value: `${selected.release.benchmark.avgDistanceM.toFixed(1)}m` },
              { label: "Casos evaluados", value: String(selected.release.benchmark.sampleCount) },
            ]}
            extra={
              <div className="mt-4 space-y-1.5">
                {selected.release.backbones.map((b) => (
                  <div key={b.name} className="flex justify-between border-t border-white/10 py-1.5 text-xs text-muted">
                    <span>{b.name}</span>
                    <b className="text-fg">{b.source}</b>
                  </div>
                ))}
              </div>
            }
            installLabel={selected.release.isActive ? "Instalada" : "Instalar"}
            installDisabled={selected.release.isActive}
            onInstall={() => install(selected)}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-subtle">
            Selecciona una versión para ver el detalle.
          </div>
        )}
        {status && <div className="px-5 pb-3 text-xs text-muted">{status}</div>}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @netryx/web typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/components/ModelosSection.tsx
git commit -m "feat(web): add ModelosSection (browse/install only, no publish UI)"
```

---

### Task 11: `CatalogBrowser` shell + wire into `AppShell.tsx`

**Files:**
- Create: `apps/web/app/components/CatalogBrowser.tsx`
- Modify: `apps/web/app/components/AppShell.tsx`

**Interfaces:**
- Consumes: `DatasetsSection` (Task 9), `ModelosSection` (Task 10).
- Produces: `CatalogBrowser({onClose})` — rendered by `AppShell.tsx`'s new rail button.

- [ ] **Step 1: Write `CatalogBrowser.tsx`**

```tsx
// apps/web/app/components/CatalogBrowser.tsx
"use client";
import { useState } from "react";
import { DatasetsSection } from "./DatasetsSection";
import { ModelosSection } from "./ModelosSection";

export function CatalogBrowser({ onClose }: { onClose: () => void }) {
  const [section, setSection] = useState<"datasets" | "models">("datasets");
  const [query, setQuery] = useState("");

  function changeSection(next: "datasets" | "models") {
    setSection(next);
    setQuery("");
  }

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/60">
      <div className="flex h-[80vh] w-[900px] flex-col overflow-hidden rounded-card border border-white/10 bg-surface">
        <div className="flex items-center gap-3 border-b border-white/10 bg-panel px-4 py-2.5">
          <div className="flex gap-1">
            {(["datasets", "models"] as const).map((id) => (
              <button
                key={id}
                onClick={() => changeSection(id)}
                className={`rounded-md px-3 py-1.5 text-[12.5px] ${
                  section === id ? "bg-white/[.08] text-fg" : "text-muted hover:text-fg"
                }`}
              >
                {id === "datasets" ? "Datasets" : "Modelos"}
              </button>
            ))}
          </div>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={section === "datasets" ? "Buscar dataset…" : "Buscar versión…"}
            className="flex-1 rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-fg outline-none focus:border-white/25"
          />
          <button onClick={onClose} className="text-subtle hover:text-fg">✕</button>
        </div>
        <div className="min-h-0 flex-1">
          {section === "datasets" ? <DatasetsSection query={query} /> : <ModelosSection query={query} />}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire into `AppShell.tsx`**

Replace the full contents of `apps/web/app/components/AppShell.tsx` (it becomes a Client Component — it now holds the popup's open/closed state) with:

```tsx
// apps/web/app/components/AppShell.tsx
"use client";
import { useState } from "react";
import Link from "next/link";
import { CatalogBrowser } from "./CatalogBrowser";

const NAV = [
  { href: "/", label: "Uso", icon: "M21 21l-4.35-4.35M11 19a8 8 0 100-16 8 8 0 000 16z" },
  { href: "/index", label: "Entrenamiento", icon: "M12 2l9 4.5-9 4.5-9-4.5L12 2zM3 12l9 4.5 9-4.5M3 17l9 4.5 9-4.5" },
];

function RailIcon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className="h-5 w-5">
      <path d={d} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const [catalogOpen, setCatalogOpen] = useState(false);

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
        <button onClick={() => setCatalogOpen(true)} title="Tienda" className="text-subtle hover:text-fg">
          <RailIcon d="M6 6h12l1 4H5l1-4Z M5 10h14v9a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-9Z M9 10v3a3 3 0 0 0 6 0v-3" />
        </button>
        <div className="flex-1" />
        <Link href="/settings" title="Configuración" className="text-subtle hover:text-fg">
          <RailIcon d="M12 9a3 3 0 100 6 3 3 0 000-6z M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
        </Link>
      </nav>
      <main className="relative flex-1 overflow-hidden bg-surface">{children}</main>
      {catalogOpen && <CatalogBrowser onClose={() => setCatalogOpen(false)} />}
    </div>
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @netryx/web typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/components/CatalogBrowser.tsx apps/web/app/components/AppShell.tsx
git commit -m "feat(web): add CatalogBrowser popup shell, open it from a new AppShell rail icon"
```

---

### Task 12: Remove the old Settings tabs and delete the superseded panels

**Files:**
- Modify: `apps/web/app/components/SettingsPanel.tsx`
- Delete: `apps/web/app/components/DatasetsCatalogPanel.tsx`
- Delete: `apps/web/app/components/ModelCatalogPanel.tsx`

**Interfaces:**
- Consumes: nothing new — this only removes now-dead wiring.

- [ ] **Step 1: Remove the two panel imports**

In `apps/web/app/components/SettingsPanel.tsx`, delete these two lines:

```ts
import { DatasetsCatalogPanel } from "./DatasetsCatalogPanel";
import { ModelCatalogPanel } from "./ModelCatalogPanel";
```

- [ ] **Step 2: Remove the two now-unused `SECTION_ICON` entries**

Delete these two lines from the `SECTION_ICON` object:

```ts
  "datasets": svg(<><path d="M12 3c4.4 0 8 1.3 8 3v12c0 1.7-3.6 3-8 3s-8-1.3-8-3V6c0-1.7 3.6-3 8-3Z" /><path d="M4 6c0 1.7 3.6 3 8 3s8-1.3 8-3" /></>, "#7edca4"),
  "model-catalog": svg(<><rect x="4" y="4" width="16" height="16" rx="2" /><path d="M4 10h16M10 4v16" /></>, "#a89fff"),
```

- [ ] **Step 3: Remove the two `tabItems` entries**

Change:

```ts
  const tabItems = [
    ...groups.map(({ section }) => ({ id: section.id, label: section.title, icon: SECTION_ICON[section.id] })),
    { id: "areas", label: "Áreas", icon: SECTION_ICON.areas },
    { id: "datasets", label: "Datasets publicados", icon: SECTION_ICON.datasets },
    { id: "model-catalog", label: "Catálogo de modelos", icon: SECTION_ICON["model-catalog"] },
  ];
```

to:

```ts
  const tabItems = [
    ...groups.map(({ section }) => ({ id: section.id, label: section.title, icon: SECTION_ICON[section.id] })),
    { id: "areas", label: "Áreas", icon: SECTION_ICON.areas },
  ];
```

- [ ] **Step 4: Remove the two render branches**

Change:

```tsx
          {activeTab === "areas" ? (
            <motion.div variants={staggerItem}>
              <AreasManagePanel />
            </motion.div>
          ) : activeTab === "datasets" ? (
            <motion.div variants={staggerItem}>
              <DatasetsCatalogPanel />
            </motion.div>
          ) : activeTab === "model-catalog" ? (
            <motion.div variants={staggerItem}>
              <ModelCatalogPanel />
            </motion.div>
          ) : activeGroup ? (
```

to:

```tsx
          {activeTab === "areas" ? (
            <motion.div variants={staggerItem}>
              <AreasManagePanel />
            </motion.div>
          ) : activeGroup ? (
```

- [ ] **Step 5: Delete the superseded panel files**

```bash
rm apps/web/app/components/DatasetsCatalogPanel.tsx
rm apps/web/app/components/ModelCatalogPanel.tsx
```

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter @netryx/web typecheck`
Expected: no errors.

- [ ] **Step 7: Run the full web test suite**

Run: `pnpm --filter @netryx/web test`
Expected: PASS — every test added in Tasks 1-4 (14 tests total: 2 + 5 + 2 + 5) plus every pre-existing test in the project, all green.

- [ ] **Step 8: Manual verification**

Run the dev stack, click the new "Tienda" rail icon (between "Entrenamiento" and the Settings gear). Confirm: the popup opens over everything; switching Datasets/Modelos tabs works; typing in the search box filters the active section's list; clicking a row opens the detail panel on the right and highlights the row; clicking "Instalar" on a dataset works end to end (including triggering the mismatch dialog on an incompatible release, same as before); clicking "Instalar" on a model version works; clicking "+ Publicar dataset" opens the 3-step wizard, Step 1 shows your real indexed areas (in-progress ones grayed out and unclickable), and publishing a real area succeeds and the release shows up in Explorar afterward without a page reload. Then open Settings and confirm "Datasets publicados" and "Catálogo de modelos" no longer appear as tabs there.

- [ ] **Step 9: Commit**

```bash
git add apps/web/app/components/SettingsPanel.tsx
git rm apps/web/app/components/DatasetsCatalogPanel.tsx apps/web/app/components/ModelCatalogPanel.tsx
git commit -m "feat(web): remove the old Settings-tab catalog UIs, superseded by the popup"
```

---

## Self-Review Notes

- **Spec coverage:** shared catalog types + flatten helpers (Task 1); sidebar filter logic, including the explicit no-"Instalados"-for-datasets decision from the spec's Data section (Task 2); localStorage-only remembered repo (Task 3); wizard step validation (Task 4); shared `CatalogList`/`CatalogDetailPanel` (Tasks 5-6); `MismatchDialog` reused verbatim (Task 7); the 3-step `PublishWizard` replacing the free-text form, including the grayed-out-and-unselectable in-progress areas (Task 8); `DatasetsSection`/`ModelosSection` per-kind wiring, with `ModelosSection` never referencing publish at all (Tasks 9-10); the popup shell + new rail icon entry point outside Settings (Task 11); removing the old Settings tabs and deleting the superseded panels (Task 12). All spec sections covered.
- **Placeholder scan:** none — every step has complete, runnable code and exact commands/expected output.
- **Type consistency:** `DatasetCatalogItem`/`ModelCatalogItem` (Task 1) are used identically in Task 2's filter functions, Task 5's generic `CatalogList<T>`, and Tasks 9-10's row renderers/detail-panel wiring — no renamed fields anywhere. `CatalogList`'s `renderRow(item, selected)` signature (Task 5) matches exactly how Tasks 9-10 call it. `CatalogDetailPanel`'s `stats: {label, value}[]`/`extra?`/`installLabel`/`installDisabled?`/`onInstall` (Task 6) are supplied consistently by both sections. `PublishWizard`'s `{onClose, onPublished}` (Task 8) matches exactly how Task 9's `DatasetsSection` renders it.
