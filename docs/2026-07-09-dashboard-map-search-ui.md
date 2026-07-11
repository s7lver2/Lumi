# Dashboard & Map UI — Part 2: Search UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the real `/` search dashboard on top of the Part 1 foundation: upload (and crop) a query image, see geographically clustered candidate **regions** as translucent confidence circles with numbered markers on the map, browse ranked results with reverse-geocoded place names, similarity rings and copyable coordinates, then **refine** a region into a verified street-level ranking — matching the Raven references (spec §5, §8, §9.2, §9.3).

**Architecture:** A client `SearchDashboard` at `/` composes the Part 1 `MapCanvas` (search mode) with new components: `ImageDropzone` (upload + crop), `ResultsPanel`, `ConfidenceCircleLayer` (turf circles + numbered markers), `TopResultCard`, `BottomSummaryBar`, and `RingGauge`. It drives the existing `POST /api/search` (Pass 1 → regions) and `POST /api/search/[searchId]/refine` (Pass 2 → street-level), holding everything in a new `useSearchStore` (spec §13). Because the search backend returns only lat/lng, a new `GET /api/geocode` reverse-geocodes coordinates to place labels ("San Jose, California, United States") — Mapbox Geocoding when a token is configured, else free Nominatim — behind an in-memory cache.

**Tech Stack:** Next.js 14 App Router, React 18, TypeScript, Tailwind (Part 1 theme), Zustand, MapLibre/Mapbox (Part 1 `MapCanvas`), @turf/turf, react-easy-crop, vitest.

**Depends on:** Dashboard & Map UI Part 1 (AppShell, Tailwind theme, `FloatingCard`, `Badge`, `MapCanvas`, `useMapStore`, `/api/map-config`) and the Search Pass 1 + Pass 2 backends (`POST /api/search`, `POST /api/search/[searchId]/refine`, shared-types `SearchResponse`/`SearchCandidate`/`SearchRegion`/`RefineResponse`) — all merged.

**Out of scope (deferred, not MVP / no backend support):** PDF export ("Download PDF"), "case files" / "Add search to case", "Compare in Street View", search history persistence, and any multi-user features seen in the references. These have no DB schema or endpoint and are not in the spec's §8 component list — noted here so they're deliberate omissions, not oversights.

## Global Constraints

- **Reuse Part 1's design system** — Tailwind tokens (`bg`/`surface`/`panel`/`elevated`/`border`/`muted`/`subtle`/`fg`/`accent{,-fg}`/`draw{,-fg}`/`warning{,-fg}`/`danger{,-fg}`, `font-mono`), `FloatingCard` (translucent + `backdrop-blur`), `Badge`, `AppShell`, `MapCanvas`, `useMapStore`. Do not re-introduce styling; extend the theme only if a genuinely new token is needed.
- **Translucency + polish** (standing design preference): every floating surface stays semi-opaque + blurred; the result must read as close to the Raven references, not merely functional.
- **Map is client-only** — search map components mount through the Part 1 `MapCanvas` (`ssr:false`); never import MapLibre/Mapbox on the server.
- **Route-export rule:** `route.ts`/`page.tsx`/`layout.tsx` export only their allowed names; helpers live in sibling modules.
- **`/` moves under `(protected)`** replacing the Part 1 temporary `redirect("/index")`; it inherits the setup gate.
- **Coordinates always monospace** (`font-mono`) and copyable; percentages via `RingGauge`.
- **No path aliases** — relative imports. TDD for pure logic; map/WebGL components verified manually. DRY, YAGNI, frequent commits.

---

## File Structure

```
apps/web/
├── package.json                                   # Modify (Task 4 — react-easy-crop)
├── app/
│   ├── (protected)/page.tsx                       # Modify (Task 9 — replace redirect with SearchDashboard)
│   ├── api/geocode/route.ts                        # Task 1
│   ├── stores/
│   │   ├── useSearchStore.ts                       # Task 2
│   │   └── useSearchStore.test.ts                  # Task 2
│   ├── lib/
│   │   ├── geocode-label.ts                        # Task 1
│   │   ├── geocode-label.test.ts                   # Task 1
│   │   ├── coords.ts                               # Task 3
│   │   ├── coords.test.ts                          # Task 3
│   │   └── useReverseGeocode.ts                    # Task 6
│   └── components/
│       ├── RingGauge.tsx                           # Task 3
│       ├── ImageDropzone.tsx                        # Task 4
│       ├── ConfidenceCircleLayer.tsx               # Task 5
│       ├── ResultsPanel.tsx                         # Task 6
│       ├── TopResultCard.tsx                        # Task 7
│       ├── BottomSummaryBar.tsx                     # Task 7
│       └── SearchDashboard.tsx                      # Task 8, 9
```

---

### Task 1: Reverse-geocoding endpoint + label formatter

Turn lat/lng into a short place label. The label-assembly logic is pure (tested); the network call + provider switch + cache live in the route.

**Files:**
- Create: `apps/web/app/lib/geocode-label.ts`, `geocode-label.test.ts`, `apps/web/app/api/geocode/route.ts`

**Interfaces:**
- Produces: `formatMapboxLabel(feature)`, `formatNominatimLabel(addr)` → a `"City, Region, Country"`-style string; `GET /api/geocode?lat=&lng=` → `{ label: string | null }`.

- [ ] **Step 1: Write the failing label-formatter tests**

```typescript
// apps/web/app/lib/geocode-label.test.ts
import { describe, it, expect } from "vitest";
import { formatMapboxLabel, formatNominatimLabel } from "./geocode-label";

describe("formatMapboxLabel", () => {
  it("joins place + region + country from a Mapbox feature context", () => {
    const feature = {
      text: "San Jose",
      context: [
        { id: "region.1", text: "California" },
        { id: "country.1", text: "United States" },
      ],
    };
    expect(formatMapboxLabel(feature)).toBe("San Jose, California, United States");
  });
});

describe("formatNominatimLabel", () => {
  it("prefers city/town/village, then state, then country", () => {
    const addr = { city: "San Jose", state: "California", country: "United States" };
    expect(formatNominatimLabel(addr)).toBe("San Jose, California, United States");
  });
  it("falls back to town/village when city is absent", () => {
    expect(formatNominatimLabel({ village: "Lakeway", state: "Texas", country: "United States" })).toBe(
      "Lakeway, Texas, United States"
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && pnpm test geocode-label.test.ts`
Expected: FAIL — `Cannot find module './geocode-label'`.

- [ ] **Step 3: Implement `geocode-label.ts`**

```typescript
// apps/web/app/lib/geocode-label.ts
export interface MapboxFeature {
  text: string;
  context?: { id: string; text: string }[];
}

export function formatMapboxLabel(feature: MapboxFeature): string {
  const region = feature.context?.find((c) => c.id.startsWith("region"))?.text;
  const country = feature.context?.find((c) => c.id.startsWith("country"))?.text;
  return [feature.text, region, country].filter(Boolean).join(", ");
}

export interface NominatimAddress {
  city?: string;
  town?: string;
  village?: string;
  state?: string;
  country?: string;
}

export function formatNominatimLabel(addr: NominatimAddress): string {
  const locality = addr.city ?? addr.town ?? addr.village;
  return [locality, addr.state, addr.country].filter(Boolean).join(", ");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && pnpm test geocode-label.test.ts`
Expected: PASS.

- [ ] **Step 5: Implement `GET /api/geocode`** (provider switch + in-memory cache)

```typescript
// apps/web/app/api/geocode/route.ts
import { NextResponse } from "next/server";
import { getSettingsRepo } from "../../../lib/settings-repo";
import {
  formatMapboxLabel,
  formatNominatimLabel,
  type MapboxFeature,
  type NominatimAddress,
} from "../../lib/geocode-label";

// Coordinates snap to ~4 decimals (~11m) for cache keys — plenty for a
// city-level label and keeps the cache from exploding across near-identical
// points from the same pano cluster.
const cache = new Map<string, string | null>();
const key = (lat: number, lng: number) => `${lat.toFixed(4)},${lng.toFixed(4)}`;

async function geocodeMapbox(lat: number, lng: number, token: string): Promise<string | null> {
  const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json?types=place,region,country&access_token=${token}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const body = (await res.json()) as { features?: MapboxFeature[] };
  const f = body.features?.[0];
  return f ? formatMapboxLabel(f) : null;
}

async function geocodeNominatim(lat: number, lng: number): Promise<string | null> {
  const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=10`;
  // Nominatim's usage policy requires a descriptive User-Agent — same lesson
  // as Overpass; omitting it gets requests blocked.
  const res = await fetch(url, {
    headers: { "user-agent": "netryx-lumi/0.1 (+https://github.com/netryx-fork)" },
  });
  if (!res.ok) return null;
  const body = (await res.json()) as { address?: NominatimAddress };
  return body.address ? formatNominatimLabel(body.address) : null;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const lat = Number(searchParams.get("lat"));
  const lng = Number(searchParams.get("lng"));
  if (Number.isNaN(lat) || Number.isNaN(lng)) {
    return NextResponse.json({ error: "lat and lng are required" }, { status: 400 });
  }

  const k = key(lat, lng);
  if (cache.has(k)) return NextResponse.json({ label: cache.get(k) });

  const token = (await getSettingsRepo().getSetting("MAPBOX_TOKEN")) || null;
  let label: string | null = null;
  try {
    label = token ? await geocodeMapbox(lat, lng, token) : await geocodeNominatim(lat, lng);
  } catch {
    label = null; // geocoding is best-effort; the UI falls back to raw coords
  }
  cache.set(k, label);
  return NextResponse.json({ label });
}
```

- [ ] **Step 6: Manual verification**

Run: `pnpm dev`, then `curl -s "http://localhost:3000/api/geocode?lat=37.2803&lng=-121.9035" | jq`.
Expected: `{ "label": "San Jose, California, United States" }` (or similar) with no token (Nominatim); same shape with a Mapbox token set.

- [ ] **Step 7: Commit**

```bash
git add apps/web/app/lib/geocode-label.ts apps/web/app/lib/geocode-label.test.ts apps/web/app/api/geocode/route.ts
git commit -m "feat(web): reverse-geocode endpoint (Mapbox or Nominatim) with label formatter (spec §5)"
```

---

### Task 2: `useSearchStore`

**Files:**
- Create: `apps/web/app/stores/useSearchStore.ts`, `useSearchStore.test.ts`

**Interfaces:**
- Produces: `useSearchStore` per spec §13 — `currentSearchId`, `regions`, `candidatesByRegion`, `selectedRegionId`, `refineStatus: 'idle'|'searching'|'refining'|'done'|'error'`, `queryImageName`, plus `setSearching`, `setSearchResults(res, imageName)`, `selectRegion`, `setRefineResults(regionId, candidates)`, `setError`, `reset`.

- [ ] **Step 1: Write the failing test**

```typescript
// apps/web/app/stores/useSearchStore.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { useSearchStore } from "./useSearchStore";
import type { SearchResponse, SearchCandidate } from "@netryx/shared-types";

beforeEach(() => useSearchStore.getState().reset());

const RESPONSE: SearchResponse = {
  searchId: "s1",
  regions: [
    { id: "r1", centroid: { lat: 37.3, lng: -121.9 }, radiusM: 150, aggregateScore: 0.83, candidateCount: 4 },
    { id: "r2", centroid: { lat: 37.5, lng: -122.3 }, radiusM: 150, aggregateScore: 0.68, candidateCount: 1 },
  ],
  candidatesByRegion: {
    r1: [
      { id: "c1", regionId: "r1", indexedImageId: "i1", panoId: "p1", heading: 0, lat: 37.3, lng: -121.9, similarityScore: 0.83, verificationScore: null, rank: 1, status: "unreviewed" },
    ],
  },
};

describe("useSearchStore", () => {
  it("stores results, auto-selects the top region, and lists regions best-first", () => {
    useSearchStore.getState().setSearchResults(RESPONSE, "IMG_1.jpg");
    const s = useSearchStore.getState();
    expect(s.currentSearchId).toBe("s1");
    expect(s.queryImageName).toBe("IMG_1.jpg");
    expect(s.regions[0].id).toBe("r1"); // higher aggregateScore first
    expect(s.selectedRegionId).toBe("r1");
    expect(s.refineStatus).toBe("done");
  });

  it("merges refined candidates back into candidatesByRegion", () => {
    useSearchStore.getState().setSearchResults(RESPONSE, "IMG_1.jpg");
    const refined: SearchCandidate[] = [
      { id: "c9", regionId: "r1", indexedImageId: "i9", panoId: "p9", heading: 0, lat: 37.31, lng: -121.91, similarityScore: 0.8, verificationScore: 0.9, rank: 1, status: "confirmed" },
    ];
    useSearchStore.getState().setRefineResults("r1", refined);
    expect(useSearchStore.getState().candidatesByRegion.r1[0].verificationScore).toBe(0.9);
    expect(useSearchStore.getState().candidatesByRegion.r1[0].status).toBe("confirmed");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && pnpm test useSearchStore.test.ts`
Expected: FAIL — `Cannot find module './useSearchStore'`.

- [ ] **Step 3: Implement `useSearchStore.ts`**

```typescript
// apps/web/app/stores/useSearchStore.ts
import { create } from "zustand";
import type { SearchRegion, SearchCandidate, SearchResponse } from "@netryx/shared-types";

export type RefineStatus = "idle" | "searching" | "refining" | "done" | "error";

interface SearchState {
  currentSearchId: string | null;
  queryImageName: string | null;
  regions: SearchRegion[];
  candidatesByRegion: Record<string, SearchCandidate[]>;
  selectedRegionId: string | null;
  refineStatus: RefineStatus;
  error: string | null;
  setSearching: (imageName: string) => void;
  setSearchResults: (res: SearchResponse, imageName: string) => void;
  selectRegion: (regionId: string) => void;
  setRefineResults: (regionId: string, candidates: SearchCandidate[]) => void;
  setRefining: () => void;
  setError: (message: string) => void;
  reset: () => void;
}

const INITIAL = {
  currentSearchId: null,
  queryImageName: null,
  regions: [] as SearchRegion[],
  candidatesByRegion: {} as Record<string, SearchCandidate[]>,
  selectedRegionId: null as string | null,
  refineStatus: "idle" as RefineStatus,
  error: null as string | null,
};

export const useSearchStore = create<SearchState>((set) => ({
  ...INITIAL,
  setSearching: (queryImageName) => set({ ...INITIAL, queryImageName, refineStatus: "searching" }),
  setSearchResults: (res, queryImageName) => {
    const regions = [...res.regions].sort((a, b) => b.aggregateScore - a.aggregateScore);
    set({
      currentSearchId: res.searchId,
      queryImageName,
      regions,
      candidatesByRegion: res.candidatesByRegion,
      selectedRegionId: regions[0]?.id ?? null,
      refineStatus: "done",
      error: null,
    });
  },
  selectRegion: (selectedRegionId) => set({ selectedRegionId }),
  setRefining: () => set({ refineStatus: "refining" }),
  setRefineResults: (regionId, candidates) =>
    set((s) => ({
      candidatesByRegion: { ...s.candidatesByRegion, [regionId]: candidates },
      refineStatus: "done",
    })),
  setError: (error) => set({ error, refineStatus: "error" }),
  reset: () => set({ ...INITIAL }),
}));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && pnpm test useSearchStore.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/stores/useSearchStore.ts apps/web/app/stores/useSearchStore.test.ts
git commit -m "feat(web): useSearchStore (regions, selection, refine state) (spec §13)"
```

---

### Task 3: `RingGauge` + coordinate formatting

**Files:**
- Create: `apps/web/app/lib/coords.ts`, `coords.test.ts`, `apps/web/app/components/RingGauge.tsx`

**Interfaces:**
- Produces: `formatCoords(lat, lng): string` (6-dp, `"37.280333, -121.903501"`); `<RingGauge value={0..1} size? tone?>` — SVG circular gauge showing a percentage.

- [ ] **Step 1: Write the failing coords test**

```typescript
// apps/web/app/lib/coords.test.ts
import { describe, it, expect } from "vitest";
import { formatCoords } from "./coords";

describe("formatCoords", () => {
  it("formats lat,lng to six decimal places", () => {
    expect(formatCoords(37.2803331, -121.9035009)).toBe("37.280333, -121.903501");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && pnpm test coords.test.ts`
Expected: FAIL — `Cannot find module './coords'`.

- [ ] **Step 3: Implement `coords.ts`**

```typescript
// apps/web/app/lib/coords.ts
export function formatCoords(lat: number, lng: number): string {
  return `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && pnpm test coords.test.ts`
Expected: PASS.

- [ ] **Step 5: Implement `RingGauge.tsx`** (pure SVG, no dependency)

```tsx
// apps/web/app/components/RingGauge.tsx
const TONE = { accent: "#5dcaa5", warning: "#efb968", muted: "#6a6c70" } as const;

export function RingGauge({
  value,
  size = 20,
  tone = "accent",
}: {
  value: number; // 0..1
  size?: number;
  tone?: keyof typeof TONE;
}) {
  const r = size / 2 - 2;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(1, value));
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0" role="img" aria-label={`${Math.round(pct * 100)}%`}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#2c2d30" strokeWidth="2" />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={TONE[tone]}
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - pct)}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
    </svg>
  );
}
```

- [ ] **Step 6: Run + commit**

Run: `cd apps/web && pnpm test coords.test.ts`
```bash
git add apps/web/app/lib/coords.ts apps/web/app/lib/coords.test.ts apps/web/app/components/RingGauge.tsx
git commit -m "feat(web): RingGauge + coordinate formatting (spec §5, §8.2)"
```

---

### Task 4: `ImageDropzone` (upload + crop)

**Files:**
- Modify: `apps/web/package.json` (add `react-easy-crop`)
- Create: `apps/web/app/components/ImageDropzone.tsx`

**Interfaces:**
- Produces: `<ImageDropzone onImage={(file: File) => void} />` — drag/drop or click to pick, preview, optional crop, then hands a `File` (cropped or original) to `onImage`.

- [ ] **Step 1: Add dependency**

```bash
cd apps/web && pnpm add react-easy-crop@^5.1.0
```

- [ ] **Step 2: Implement `ImageDropzone.tsx`** (verified manually — file/canvas interaction isn't unit-testable in jsdom)

```tsx
// apps/web/app/components/ImageDropzone.tsx
"use client";

import { useCallback, useRef, useState } from "react";
import Cropper, { type Area } from "react-easy-crop";
import { FloatingCard } from "./FloatingCard";

async function cropToFile(src: string, area: Area, name: string): Promise<File> {
  const img = document.createElement("img");
  img.src = src;
  await new Promise((res) => (img.onload = res));
  const canvas = document.createElement("canvas");
  canvas.width = area.width;
  canvas.height = area.height;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(img, area.x, area.y, area.width, area.height, 0, 0, area.width, area.height);
  const blob: Blob = await new Promise((res) => canvas.toBlob((b) => res(b!), "image/jpeg", 0.92));
  return new File([blob], name, { type: "image/jpeg" });
}

export function ImageDropzone({ onImage }: { onImage: (file: File) => void }) {
  const [src, setSrc] = useState<string | null>(null);
  const [name, setName] = useState("query.jpg");
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const areaRef = useRef<Area | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const pick = useCallback((file: File) => {
    setName(file.name);
    setSrc(URL.createObjectURL(file));
  }, []);

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) pick(file);
  }

  async function useCropped() {
    if (!src) return;
    const file = areaRef.current ? await cropToFile(src, areaRef.current, name) : null;
    if (file) onImage(file);
  }

  async function useWhole() {
    if (!inputRef.current?.files?.[0]) return;
    onImage(inputRef.current.files[0]);
  }

  if (src) {
    return (
      <FloatingCard className="w-[420px] p-4">
        <div className="relative h-64 w-full overflow-hidden rounded-md bg-black">
          <Cropper
            image={src}
            crop={crop}
            zoom={zoom}
            aspect={1}
            onCropChange={setCrop}
            onZoomChange={setZoom}
            onCropComplete={(_, areaPixels) => (areaRef.current = areaPixels)}
          />
        </div>
        <div className="mt-3 flex gap-2">
          <button onClick={useCropped} className="flex-1 rounded-md bg-accent py-2 text-xs font-medium text-black">
            Buscar recorte
          </button>
          <button onClick={useWhole} className="flex-1 rounded-md bg-elevated py-2 text-xs text-fg hover:bg-white/10">
            Usar imagen completa
          </button>
        </div>
      </FloatingCard>
    );
  }

  return (
    <FloatingCard className="w-[420px]">
      <label
        onDragOver={(e) => e.preventDefault()}
        onDrop={onDrop}
        className="flex h-56 cursor-pointer flex-col items-center justify-center gap-2 rounded-card border border-dashed border-white/15 text-center"
      >
        <span className="text-sm text-fg">Arrastra una imagen o pulsa para subir</span>
        <span className="text-xs text-muted">JPG, PNG o WEBP</span>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => e.target.files?.[0] && pick(e.target.files[0])}
        />
      </label>
    </FloatingCard>
  );
}
```

- [ ] **Step 3: Manual verification**

Temporarily render `<ImageDropzone onImage={(f) => console.log(f.name, f.size)} />` on `/index` or a scratch page; confirm drag-drop + file-pick show the cropper, "Buscar recorte" logs a cropped File, "Usar imagen completa" logs the original.

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/components/ImageDropzone.tsx apps/web/package.json apps/web/pnpm-lock.yaml
git commit -m "feat(web): ImageDropzone with upload + crop (spec §8.2)"
```

---

### Task 5: `ConfidenceCircleLayer`

Draw one translucent confidence circle (turf) per region plus a numbered marker at each centroid; highlight the selected region (spec §5, §9.2). Radius comes from `region.radiusM`.

**Files:**
- Create: `apps/web/app/components/ConfidenceCircleLayer.tsx`

**Interfaces:**
- Consumes: a live `map` (from `MapCanvas` `onReady`), `useSearchStore` (`regions`, `selectedRegionId`, `selectRegion`).
- Produces: `<ConfidenceCircleLayer map={...} />` — manages GeoJSON sources/layers for circles + markers, reacts to selection, clicking a marker calls `selectRegion`.

- [ ] **Step 1: Implement `ConfidenceCircleLayer.tsx`** (verified manually — WebGL layers)

```tsx
// apps/web/app/components/ConfidenceCircleLayer.tsx
"use client";

import { useEffect } from "react";
import * as turf from "@turf/turf";
import { useSearchStore } from "../stores/useSearchStore";

export function ConfidenceCircleLayer({ map }: { map: any }) {
  const regions = useSearchStore((s) => s.regions);
  const selectedRegionId = useSearchStore((s) => s.selectedRegionId);
  const selectRegion = useSearchStore((s) => s.selectRegion);

  useEffect(() => {
    if (!map) return;

    const circles: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features: regions.map((r, i) =>
        turf.circle([r.centroid.lng, r.centroid.lat], r.radiusM / 1000, {
          units: "kilometers",
          properties: { id: r.id, rank: i + 1, selected: r.id === selectedRegionId },
        })
      ),
    };
    const centroids: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features: regions.map((r, i) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [r.centroid.lng, r.centroid.lat] },
        properties: { id: r.id, rank: i + 1, selected: r.id === selectedRegionId },
      })),
    };

    const apply = () => {
      for (const [id, data, add] of [
        ["lumi-conf-circles", circles, addCircles],
        ["lumi-conf-centroids", centroids, addCentroids],
      ] as const) {
        const src = map.getSource(id);
        if (src) src.setData(data);
        else add();
      }
    };

    function addCircles() {
      map.addSource("lumi-conf-circles", { type: "geojson", data: circles });
      map.addLayer({
        id: "lumi-conf-circles-fill",
        type: "fill",
        source: "lumi-conf-circles",
        paint: {
          "fill-color": "#5dcaa5",
          "fill-opacity": ["case", ["get", "selected"], 0.16, 0.07],
        },
      });
      map.addLayer({
        id: "lumi-conf-circles-line",
        type: "line",
        source: "lumi-conf-circles",
        paint: {
          "line-color": "#5dcaa5",
          "line-width": ["case", ["get", "selected"], 2, 1],
          "line-opacity": 0.7,
        },
      });
    }
    function addCentroids() {
      map.addSource("lumi-conf-centroids", { type: "geojson", data: centroids });
      map.addLayer({
        id: "lumi-conf-centroids-circle",
        type: "circle",
        source: "lumi-conf-centroids",
        paint: {
          "circle-radius": 13,
          "circle-color": "#15171a",
          "circle-stroke-color": ["case", ["get", "selected"], "#5dcaa5", "#4a4c50"],
          "circle-stroke-width": 2,
        },
      });
      map.addLayer({
        id: "lumi-conf-centroids-label",
        type: "symbol",
        source: "lumi-conf-centroids",
        layout: { "text-field": ["to-string", ["get", "rank"]], "text-size": 12 },
        paint: { "text-color": "#e8e8e6" },
      });
      map.on("click", "lumi-conf-centroids-circle", (e: any) => {
        const id = e.features?.[0]?.properties?.id;
        if (id) selectRegion(id);
      });
      map.on("mouseenter", "lumi-conf-centroids-circle", () => (map.getCanvas().style.cursor = "pointer"));
      map.on("mouseleave", "lumi-conf-centroids-circle", () => (map.getCanvas().style.cursor = ""));
    }

    if (map.isStyleLoaded()) apply();
    else map.once("load", apply);
  }, [map, regions, selectedRegionId, selectRegion]);

  return null;
}
```

- [ ] **Step 2: Manual verification** (after Task 8 wires it): running a search shows translucent green circles with numbered markers; clicking a marker selects that region (circle emphasizes).

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/components/ConfidenceCircleLayer.tsx
git commit -m "feat(web): ConfidenceCircleLayer — turf circles + numbered markers (spec §5, §9.2)"
```

---

### Task 6: `ResultsPanel` + reverse-geocode hook

The right panel: query thumbnail + name, result count, ranked candidate rows (rank, geocoded place, similarity ring, copyable coords, status badge, refine/street-precision affordance).

**Files:**
- Create: `apps/web/app/lib/useReverseGeocode.ts`, `apps/web/app/components/ResultsPanel.tsx`

**Interfaces:**
- Consumes: `useSearchStore`, `RingGauge`, `Badge`, `formatCoords`, `GET /api/geocode`.
- Produces: `useReverseGeocode(lat, lng): string | null` (fetches + memoizes a label); `<ResultsPanel queryImageUrl={string|null} onRefine={(regionId) => void} />`.

- [ ] **Step 1: Implement `useReverseGeocode.ts`**

```typescript
// apps/web/app/lib/useReverseGeocode.ts
"use client";

import { useEffect, useState } from "react";

const memo = new Map<string, string | null>();

export function useReverseGeocode(lat: number, lng: number): string | null {
  const k = `${lat.toFixed(4)},${lng.toFixed(4)}`;
  const [label, setLabel] = useState<string | null>(() => memo.get(k) ?? null);

  useEffect(() => {
    if (memo.has(k)) {
      setLabel(memo.get(k) ?? null);
      return;
    }
    let alive = true;
    fetch(`/api/geocode?lat=${lat}&lng=${lng}`)
      .then((r) => r.json())
      .then((d) => {
        memo.set(k, d.label ?? null);
        if (alive) setLabel(d.label ?? null);
      })
      .catch(() => alive && setLabel(null));
    return () => {
      alive = false;
    };
  }, [k, lat, lng]);

  return label;
}
```

- [ ] **Step 2: Implement `ResultsPanel.tsx`**

```tsx
// apps/web/app/components/ResultsPanel.tsx
"use client";

import { useSearchStore } from "../stores/useSearchStore";
import { RingGauge } from "./RingGauge";
import { Badge } from "./Badge";
import { formatCoords } from "../lib/coords";
import { useReverseGeocode } from "../lib/useReverseGeocode";
import type { SearchCandidate } from "@netryx/shared-types";

function ResultRow({ c, onRefine }: { c: SearchCandidate; onRefine: (regionId: string) => void }) {
  const place = useReverseGeocode(c.lat, c.lng);
  const score = c.verificationScore ?? c.similarityScore;
  const selected = useSearchStore((s) => s.selectedRegionId) === c.regionId;
  return (
    <div className={`rounded-card border p-3 ${selected ? "border-accent-fg/40 bg-white/5" : "border-border"}`}>
      <div className="flex items-start justify-between">
        <div className="flex gap-2">
          <span className="text-xs text-subtle">{c.rank}</span>
          <div>
            <div className="text-sm text-fg">{place ?? "Localizando…"}</div>
            <div className="mt-1 flex items-center gap-1.5">
              <RingGauge value={score} tone={c.status === "confirmed" ? "accent" : "muted"} />
              <span className="text-xs text-muted">
                {Math.round((c.verificationScore ?? c.similarityScore) * 100)}%{" "}
                {c.verificationScore != null ? "verificación" : "similitud"}
              </span>
            </div>
          </div>
        </div>
        <Badge tone={c.status === "confirmed" ? "accent" : "muted"}>{c.status}</Badge>
      </div>
      <button
        onClick={() => navigator.clipboard.writeText(formatCoords(c.lat, c.lng))}
        className="mt-2 flex items-center gap-1 font-mono text-xs text-muted hover:text-fg"
        title="Copiar coordenadas"
      >
        {formatCoords(c.lat, c.lng)}
      </button>
      {c.regionId && (
        <button
          onClick={() => onRefine(c.regionId!)}
          className="mt-2 text-xs text-draw-fg hover:underline"
        >
          {selected ? "Refinar aquí" : "Precisión de calle disponible"}
        </button>
      )}
    </div>
  );
}

export function ResultsPanel({
  queryImageUrl,
  onRefine,
}: {
  queryImageUrl: string | null;
  onRefine: (regionId: string) => void;
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
        <div className="text-xs text-muted">{all.length} resultados</div>
        {all.map((c) => (
          <ResultRow key={c.id} c={c} onRefine={onRefine} />
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/lib/useReverseGeocode.ts apps/web/app/components/ResultsPanel.tsx
git commit -m "feat(web): ResultsPanel with geocoded places, similarity rings, copyable coords (spec §5, §8.2)"
```

---

### Task 7: `TopResultCard` + `BottomSummaryBar`

The floating top-center result card and the bottom summary bar from the references.

**Files:**
- Create: `apps/web/app/components/TopResultCard.tsx`, `apps/web/app/components/BottomSummaryBar.tsx`

**Interfaces:**
- Consumes: `useSearchStore`, `RingGauge`, `FloatingCard`, `useReverseGeocode`, `formatCoords`.
- Produces: `<TopResultCard onRefine={(regionId)=>void} />`; `<BottomSummaryBar />`.

- [ ] **Step 1: Implement `TopResultCard.tsx`**

```tsx
// apps/web/app/components/TopResultCard.tsx
"use client";

import { FloatingCard } from "./FloatingCard";
import { RingGauge } from "./RingGauge";
import { useSearchStore } from "../stores/useSearchStore";
import { useReverseGeocode } from "../lib/useReverseGeocode";

export function TopResultCard({ onRefine }: { onRefine: (regionId: string) => void }) {
  const { regions, selectedRegionId, candidatesByRegion } = useSearchStore();
  const region = regions.find((r) => r.id === selectedRegionId) ?? regions[0];
  const top = region ? candidatesByRegion[region.id]?.[0] : undefined;
  const place = useReverseGeocode(region?.centroid.lat ?? 0, region?.centroid.lng ?? 0);
  if (!region) return null;

  const pct = Math.round(region.aggregateScore * 100);
  return (
    <div className="absolute left-1/2 top-4 w-96 -translate-x-1/2">
      <FloatingCard className="p-4">
        <div className="flex items-center gap-2">
          <RingGauge value={region.aggregateScore} size={28} />
          <span className="text-sm font-medium text-fg">{pct}% · Resultado principal</span>
        </div>
        <ul className="mt-3 space-y-1 text-xs text-muted">
          <li>Posible ubicación: <span className="text-fg">{place ?? "…"}</span>.</li>
          <li className="text-accent-fg">{region.candidateCount} de los resultados caen en esta región.</li>
          <li>Radio aproximado: {(region.radiusM / 1000).toFixed(1)} km.</li>
        </ul>
        {top && (
          <button
            onClick={() => onRefine(region.id)}
            className="mt-3 w-full rounded-md bg-elevated py-2 text-xs font-medium text-fg hover:bg-white/10"
          >
            Refinar en {place ?? "esta región"}
          </button>
        )}
      </FloatingCard>
    </div>
  );
}
```

- [ ] **Step 2: Implement `BottomSummaryBar.tsx`**

```tsx
// apps/web/app/components/BottomSummaryBar.tsx
"use client";

import { useSearchStore } from "../stores/useSearchStore";
import { useReverseGeocode } from "../lib/useReverseGeocode";
import { formatCoords } from "../lib/coords";

export function BottomSummaryBar() {
  const { regions, selectedRegionId, candidatesByRegion } = useSearchStore();
  const region = regions.find((r) => r.id === selectedRegionId) ?? regions[0];
  const top = region ? candidatesByRegion[region.id]?.[0] : undefined;
  const place = useReverseGeocode(region?.centroid.lat ?? 0, region?.centroid.lng ?? 0);
  if (!region) return null;

  const confirmed = top?.status === "confirmed";
  const pct = Math.round((top?.verificationScore ?? region.aggregateScore) * 100);
  return (
    <div className="absolute bottom-0 left-0 right-0 flex items-center justify-between border-t border-border bg-panel/80 px-6 py-3 backdrop-blur-md">
      <div className="flex gap-10">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-subtle">Identificado</div>
          <div className="mt-0.5 text-sm text-fg">{place ?? "—"}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-subtle">Coordenadas</div>
          <div className="mt-0.5 font-mono text-sm text-fg">
            {region ? formatCoords(region.centroid.lat, region.centroid.lng) : "—"}
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-subtle">Radio</div>
          <div className="mt-0.5 text-sm text-fg">~{(region.radiusM / 1000).toFixed(1)} km</div>
        </div>
      </div>
      <div className="text-right">
        <div className="text-2xl font-medium text-accent-fg">{pct}%</div>
        <div className="text-[10px] uppercase tracking-wider text-subtle">
          {confirmed ? "confirmado" : "coincidencia"}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/components/TopResultCard.tsx apps/web/app/components/BottomSummaryBar.tsx
git commit -m "feat(web): TopResultCard + BottomSummaryBar (spec §5, §8.2.1)"
```

---

### Task 8: `SearchDashboard` — Pass 1 wiring

Compose everything for the search (Pass 1) flow: map + dropzone (when idle) → on upload, `POST /api/search`, store results, show circles + panel + cards.

**Files:**
- Create: `apps/web/app/components/SearchDashboard.tsx`

**Interfaces:**
- Consumes: `MapCanvas`, `ImageDropzone`, `ConfidenceCircleLayer`, `ResultsPanel`, `TopResultCard`, `BottomSummaryBar`, `useSearchStore`, `useMapStore`, `POST /api/search`.

- [ ] **Step 1: Implement `SearchDashboard.tsx`** (refine handler added in Task 9)

```tsx
// apps/web/app/components/SearchDashboard.tsx
"use client";

import { useEffect, useState } from "react";
import { MapCanvas } from "./MapCanvas";
import { ImageDropzone } from "./ImageDropzone";
import { ConfidenceCircleLayer } from "./ConfidenceCircleLayer";
import { ResultsPanel } from "./ResultsPanel";
import { TopResultCard } from "./TopResultCard";
import { BottomSummaryBar } from "./BottomSummaryBar";
import { useSearchStore } from "../stores/useSearchStore";
import { useMapStore } from "../stores/useMapStore";

export function SearchDashboard() {
  const [map, setMap] = useState<any>(null);
  const [queryImageUrl, setQueryImageUrl] = useState<string | null>(null);
  const { refineStatus, regions, error, setSearching, setSearchResults, setError } = useSearchStore();
  const setMode = useMapStore((s) => s.setMode);

  useEffect(() => {
    setMode("search");
  }, [setMode]);

  async function handleImage(file: File) {
    setQueryImageUrl(URL.createObjectURL(file));
    setSearching(file.name);
    const form = new FormData();
    form.append("image", file);
    const res = await fetch("/api/search", { method: "POST", body: form });
    const json = await res.json();
    if (!res.ok) return setError(json.error ?? "La búsqueda falló");
    setSearchResults(json, file.name);
  }

  // Fit the map to the returned regions once results arrive.
  useEffect(() => {
    if (!map || regions.length === 0) return;
    const lngs = regions.map((r) => r.centroid.lng);
    const lats = regions.map((r) => r.centroid.lat);
    map.fitBounds(
      [
        [Math.min(...lngs), Math.min(...lats)],
        [Math.max(...lngs), Math.max(...lats)],
      ],
      { padding: 120, maxZoom: 14, duration: 800 }
    );
  }, [map, regions]);

  const idle = refineStatus === "idle";
  const searching = refineStatus === "searching";

  return (
    <>
      <MapCanvas onReady={(m) => setMap(m)} />
      {map && <ConfidenceCircleLayer map={map} />}

      {idle && (
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
          <ImageDropzone onImage={handleImage} />
        </div>
      )}

      {searching && (
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-card bg-panel/80 px-5 py-3 text-sm text-fg backdrop-blur-md">
          Localizando…
        </div>
      )}

      {regions.length > 0 && (
        <>
          <TopResultCard onRefine={() => {}} />
          <div className="absolute right-0 top-0 h-full">
            <ResultsPanel queryImageUrl={queryImageUrl} onRefine={() => {}} />
          </div>
          <BottomSummaryBar />
        </>
      )}

      {error && (
        <div className="absolute left-1/2 top-4 -translate-x-1/2 rounded-card bg-danger/20 px-4 py-2 text-xs text-danger-fg">
          {error}
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 2: Commit** (wired into `/` in Task 9)

```bash
git add apps/web/app/components/SearchDashboard.tsx
git commit -m "feat(web): SearchDashboard Pass 1 wiring (upload -> regions) (spec §9.2)"
```

---

### Task 9: Refine flow + mount `/` + verification

Wire "Refinar" to `POST /api/search/[searchId]/refine`, merge the street-level results, zoom to the region, and replace the temporary `/` redirect with `SearchDashboard`.

**Files:**
- Modify: `apps/web/app/components/SearchDashboard.tsx`
- Modify: `apps/web/app/(protected)/page.tsx`

**Interfaces:**
- Consumes: `POST /api/search/[searchId]/refine`, `useSearchStore` (`setRefining`, `setRefineResults`, `selectRegion`).

- [ ] **Step 1: Add the refine handler in `SearchDashboard.tsx`**

```tsx
// apps/web/app/components/SearchDashboard.tsx — add inside the component
  const { currentSearchId, setRefining, setRefineResults, selectRegion } = useSearchStore();

  async function handleRefine(regionId: string) {
    if (!currentSearchId) return;
    selectRegion(regionId);
    setRefining();
    const res = await fetch(`/api/search/${currentSearchId}/refine`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ regionId }),
    });
    const json = await res.json();
    if (!res.ok) return setError(json.error ?? "El refinado falló");
    setRefineResults(regionId, json.candidates);
    // Zoom to the refined region for the street-level view.
    const region = regions.find((r) => r.id === regionId);
    if (map && region) {
      map.flyTo({ center: [region.centroid.lng, region.centroid.lat], zoom: 16, pitch: 55, duration: 900 });
    }
  }
```

Then replace both `onRefine={() => {}}` props (on `TopResultCard` and `ResultsPanel`) with `onRefine={handleRefine}`. (`useSearchStore` is already destructured at the top of the component — merge `currentSearchId`/`setRefining`/`setRefineResults`/`selectRegion` into that existing destructure rather than calling the hook twice.)

- [ ] **Step 2: Replace the `/` redirect with the dashboard**

```tsx
// apps/web/app/(protected)/page.tsx
import { SearchDashboard } from "../components/SearchDashboard";

// Part 1 temporarily redirected "/" to "/index"; Part 2 makes it the real
// search dashboard (spec §8.1).
export default function HomePage() {
  return <SearchDashboard />;
}
```

- [ ] **Step 3: Build + full manual verification**

Run: `cd apps/web && pnpm build` (expect `Compiled successfully`; `/` is now a client dashboard). Then full stack up (`pnpm dev` + worker + inference + an indexed area with images), open `/`:
1. Dropzone shows; upload (and optionally crop) a query image.
2. "Localizando…" appears, then translucent confidence circles with numbered markers, the `TopResultCard`, the `ResultsPanel` (places geocoded, similarity rings, copyable coords), and the `BottomSummaryBar`.
3. Clicking a marker or a result selects that region (highlights).
4. "Refinar" runs Pass 2: the map flies to street level, results re-rank by verification score, the top one flips to `confirmed` if over threshold, and the bottom bar shows the confirmed % .
5. Left rail: "Buscar" now lands here; "Indexar"/"Áreas" still work.

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/components/SearchDashboard.tsx "apps/web/app/(protected)/page.tsx"
git commit -m "feat(web): refine flow + real / search dashboard (spec §9.3, §8.1)"
```

---

## Self-Review

- **Spec coverage:** §5 dashboard (dark map, confidence circles, right results panel, bottom bar) ✔ (Tasks 5,6,7,8); §8.1 `/` route ✔ (Task 9); §8.2 `MapCanvas` reuse, `ImageDropzone` ✔ (Task 4), `ResultsPanel` ✔ (Task 6), `ConfidenceCircleLayer` ✔ (Task 5); §8.2.1 top card + bottom bar match the mockups ✔ (Task 7); §9.2 Pass 1 regions + clustering visualization ✔ (Task 8); §9.3 refine → street-level re-rank → auto-confirm ✔ (Task 9); §13 `useSearchStore` ✔ (Task 2). Reverse geocoding added for the place labels the references show but the backend doesn't return ✔ (Task 1).
- **Reuse:** no new styling system; `FloatingCard`/`Badge`/`AppShell`/`MapCanvas`/`useMapStore`/theme all from Part 1. Only genuinely-new primitive is `RingGauge` (Task 3).
- **Deferred correctly (documented):** PDF export, case files, street-view compare, history — no backend/DB, not spec §8.
- **Type consistency:** consumes `SearchResponse`/`SearchRegion`/`SearchCandidate`/`RefineResponse` from `@netryx/shared-types` verbatim (verified against the live `/api/search` + `/refine` implementations). `refineStatus` state machine drives which overlay shows.
- **Manual-verification honesty:** map layers, dropzone/crop, and clipboard aren't unit-testable in jsdom — each such task ends with an explicit manual step. Pure logic (label formatting, coords, store) is unit-tested.
- **Reused lesson:** Nominatim (like Overpass) needs a descriptive `User-Agent` — baked into Task 1's geocode route.

---

## Execution Handoff

**Plan complete and saved to `docs/2026-07-09-dashboard-map-search-ui.md`.**

This completes the user-facing product. See also `docs/2026-07-09-cost-tracking.md` (independent backend plan).

**Two execution options:**
1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks.
2. **Inline Execution** — execute tasks in this session with checkpoints.

**Which approach?**
