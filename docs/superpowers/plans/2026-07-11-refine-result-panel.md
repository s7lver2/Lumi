# Refine Result Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When refining confirms a candidate, show the actual photo comparison (the uploaded query photo next to the matched Street View capture) inside the existing right-hand results panel — not a new floating panel — so the user can visually see where the match was found, not just a place name and a percentage.

**Architecture:** Two new GET routes serve raw image bytes that were previously only ever read server-side as base64 for calling the inference service (`indexed_images.image_path` for candidates, `searches.query_image_path` for the original upload — both already durable, on-disk paths, confirmed via research: NO existing route serves `image/*` anywhere in this codebase today). A new `RefinedCandidateCard` component renders at the top of the existing `ResultsPanel` (inside its current scroll container, not a separate overlay) whenever the selected region's candidates include one with `status === "confirmed"`, using plain `<img src=".../api/...">` tags against the two new routes — no client-side blob-URL plumbing needed, works after a page reload too.

## Global Constraints

- Neither new route requires authentication beyond what the rest of this app already has (spec: self-hosted, trusted network, no auth layer — same security posture as every other `/api/areas/*`/`/api/search/*` route in this codebase).
- Image routes must 404 cleanly (not throw a 500) when the file is missing on disk — `indexed_images.image_path` is nullable and can point to a file that was never written or was moved (same caveat already documented in `apps/web/app/api/areas/export/route.ts`'s per-image `try/catch`).
- The new card only ever shows the CONFIRMED candidate (rank 1, `verificationScore >= threshold`) — never an unverified one, so as not to visually imply certainty about a guess. If the selected region has no confirmed candidate yet, the card doesn't render at all (the existing plain candidate list underneath is unaffected either way).

---

### Task 1: Serve a candidate's captured image

**Files:**
- Create: `apps/web/app/api/images/indexed/[indexedImageId]/route.ts`

**Interfaces:**
- Produces: `GET /api/images/indexed/:indexedImageId` → `200` with `content-type: image/jpeg` body, or `404` JSON `{error}` if the row/file doesn't exist.

- [ ] **Step 1: Write the route**

```ts
// apps/web/app/api/images/indexed/[indexedImageId]/route.ts
import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import { getPool } from "../../../../../lib/db";

// No existing route in this codebase serves a raw image file (confirmed by
// grep) — every other image read (areas/export, search/refine) only ever
// reads bytes server-side to embed as base64 in an inference-service call.
// This is the first place a candidate's actual captured .jpg becomes
// directly viewable in an <img> tag.
export async function GET(
  _request: Request,
  { params }: { params: { indexedImageId: string } }
) {
  const pool = getPool();
  const { rows } = await pool.query<{ image_path: string | null }>(
    `SELECT image_path FROM indexed_images WHERE id = $1`,
    [params.indexedImageId]
  );
  if (rows.length === 0 || !rows[0].image_path) {
    return NextResponse.json({ error: "image not found" }, { status: 404 });
  }

  try {
    const bytes = await readFile(rows[0].image_path);
    return new NextResponse(bytes as unknown as BodyInit, {
      status: 200,
      headers: { "content-type": "image/jpeg", "cache-control": "public, max-age=31536000, immutable" },
    });
  } catch {
    // File missing on disk (moved/deleted outside the app) — 404, not 500.
    return NextResponse.json({ error: "image file missing on disk" }, { status: 404 });
  }
}
```

- [ ] **Step 2: Manually verify**

Start the dev server, find a real `indexed_images.id` with a non-null `image_path` (`SELECT id FROM indexed_images WHERE image_path IS NOT NULL LIMIT 1;`), navigate the browser directly to `http://localhost:3000/api/images/indexed/<that-id>` and confirm the actual Street View capture renders as an image, not JSON. Then try a random UUID and confirm a clean 404 JSON body, not a stack trace.

- [ ] **Step 3: Commit**

```bash
git add "apps/web/app/api/images/indexed/[indexedImageId]/route.ts"
git commit -m "feat(web): serve a candidate's captured image by indexedImageId"
```

---

### Task 2: Serve a search's original query image

**Files:**
- Create: `apps/web/app/api/images/query/[searchId]/route.ts`

**Interfaces:**
- Produces: `GET /api/images/query/:searchId` → `200` with the query image bytes, or `404`.

- [ ] **Step 1: Write the route**

```ts
// apps/web/app/api/images/query/[searchId]/route.ts
import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import { getPool } from "../../../../../lib/db";

// searches.query_image_path is a durable, on-disk path (written when the
// search was created — see apps/web/lib/search/persist.ts's persistSearch)
// independent of SearchDashboard.tsx's client-side blob URL, which only
// survives for the current browser session/tab. Serving it from the DB
// path means the refined-result comparison still works after a reload.
export async function GET(
  _request: Request,
  { params }: { params: { searchId: string } }
) {
  const pool = getPool();
  const { rows } = await pool.query<{ query_image_path: string | null }>(
    `SELECT query_image_path FROM searches WHERE id = $1`,
    [params.searchId]
  );
  if (rows.length === 0 || !rows[0].query_image_path) {
    return NextResponse.json({ error: "query image not found" }, { status: 404 });
  }

  try {
    const bytes = await readFile(rows[0].query_image_path);
    return new NextResponse(bytes as unknown as BodyInit, {
      status: 200,
      headers: { "content-type": "image/jpeg", "cache-control": "public, max-age=31536000, immutable" },
    });
  } catch {
    return NextResponse.json({ error: "query image file missing on disk" }, { status: 404 });
  }
}
```

- [ ] **Step 2: Manually verify**

Run a real search, grab its `searchId` (from the network tab's `POST /api/search` response, or `SELECT id FROM searches ORDER BY created_at DESC LIMIT 1;`), navigate to `http://localhost:3000/api/images/query/<that-id>` and confirm the originally uploaded photo renders.

- [ ] **Step 3: Commit**

```bash
git add "apps/web/app/api/images/query/[searchId]/route.ts"
git commit -m "feat(web): serve a search's original query image by searchId"
```

---

### Task 3: `RefinedCandidateCard` — the comparison card inside the results panel

**Files:**
- Create: `apps/web/app/components/RefinedCandidateCard.tsx`
- Modify: `apps/web/app/components/ResultsPanel.tsx`

**Interfaces:**
- Consumes: `SearchCandidate` (already has `indexedImageId`, `lat`, `lng`, `verificationScore`, `status` — no schema change needed, per research), Task 1/2's routes, `streetViewMapsUrl` (already exists, from the earlier Google Maps deep-link work).
- Produces: rendered inside `ResultsPanel`, above the existing candidate list.

- [ ] **Step 1: Write the component**

```tsx
// apps/web/app/components/RefinedCandidateCard.tsx
"use client";
import { formatCoords } from "../lib/coords";
import { streetViewMapsUrl } from "../lib/street-view-maps-url";
import { useReverseGeocode } from "../lib/useReverseGeocode";
import type { SearchCandidate } from "@netryx/shared-types";

/**
 * Shown at the top of ResultsPanel once a region's top candidate has been
 * refined and confirmed (status === "confirmed") — a side-by-side photo
 * comparison (the uploaded query photo vs. the matched Street View capture)
 * so the match is visually verifiable, not just a percentage. Deliberately
 * lives INSIDE the existing right-hand panel (same width, same scroll
 * container) rather than as a separate overlay/modal.
 */
export function RefinedCandidateCard({
  searchId,
  candidate,
}: {
  searchId: string;
  candidate: SearchCandidate;
}) {
  const place = useReverseGeocode(candidate.lat, candidate.lng);
  const pct = Math.round((candidate.verificationScore ?? 0) * 100);

  return (
    <div className="rounded-card border border-accent-fg/30 bg-white/[.04] p-3">
      <div className="flex items-center gap-2">
        <div className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-accent-fg text-[10px] font-medium text-accent-fg">
          {pct}%
        </div>
        <div>
          <div className="text-sm text-fg">{place ?? "Localizando…"}</div>
          <div className="text-[11px] text-accent-fg">confirmado · verificación geométrica</div>
        </div>
      </div>

      <div className="mt-3 flex gap-1.5">
        <div className="min-w-0 flex-1">
          <img
            src={`/api/images/query/${searchId}`}
            alt="Tu foto"
            className="aspect-[4/3] w-full rounded-md border border-border object-cover"
          />
          <div className="mt-1 text-[10px] text-subtle">Tu foto</div>
        </div>
        <div className="min-w-0 flex-1">
          <img
            src={`/api/images/indexed/${candidate.indexedImageId}`}
            alt="Street View"
            className="aspect-[4/3] w-full rounded-md border border-accent-fg/40 object-cover"
          />
          <div className="mt-1 text-[10px] text-accent-fg">Street View</div>
        </div>
      </div>

      <a
        href={streetViewMapsUrl(candidate.panoId, candidate.heading)}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-2 flex items-center justify-between rounded-md bg-white/[.04] px-2.5 py-2 font-mono text-xs text-fg hover:bg-white/10"
        title="Abrir en Google Maps (Street View, mismo ángulo de la foto)"
      >
        {formatCoords(candidate.lat, candidate.lng)}
      </a>
    </div>
  );
}
```

- [ ] **Step 2: Wire it into `ResultsPanel.tsx`**

```tsx
// ResultsPanel.tsx — add imports
import { RefinedCandidateCard } from "./RefinedCandidateCard";
```

Add `currentSearchId` and `selectedRegionId` to the store destructure, compute the confirmed candidate, render the card above the count line:

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
  const { queryImageName, regions, candidatesByRegion, currentSearchId, selectedRegionId } = useSearchStore();
  const all = regions.flatMap((r) => candidatesByRegion[r.id] ?? []);
  const confirmed = selectedRegionId
    ? candidatesByRegion[selectedRegionId]?.find((c) => c.status === "confirmed")
    : undefined;

  return (
    <div className="flex h-full w-80 flex-col border-l border-border bg-panel/80 backdrop-blur-md">
      <div className="flex items-center gap-3 border-b border-border p-4">
        {queryImageUrl && <img src={queryImageUrl} alt="" className="h-14 w-14 rounded-md object-cover" />}
        <span className="truncate font-mono text-xs text-muted">{queryImageName}</span>
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto p-4">
        {confirmed && currentSearchId && (
          <RefinedCandidateCard searchId={currentSearchId} candidate={confirmed} />
        )}
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

- [ ] **Step 3: Manually verify in the browser**

Run a search, refine a region until a candidate confirms. Confirm the new comparison card appears at the top of the right panel (inside the same scroll area, same 320px width — not a separate floating window), showing the query photo and the matched Street View capture side by side, with the confidence percentage, place name, and a coordinates link that opens Google Maps at the correct pano/heading. Switch to a DIFFERENT (still-unrefined) region and confirm the card disappears (no confirmed candidate for that region yet).

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/components/RefinedCandidateCard.tsx apps/web/app/components/ResultsPanel.tsx
git commit -m "feat(web): show a photo comparison card in the results panel once a candidate is confirmed"
```

---

## Self-Review

**1. Spec coverage:** "se abre una ventana lateral mostrando el resultado final... con la imagen con la que fue entrenada para que podamos ver donde está" → Task 3's `RefinedCandidateCard`, explicitly placed INSIDE the existing lateral panel (per the user's correction on the mockup — "recuerda que tiene que estar en el panel lateral" — not a new floating window). "la imagen con la que fue entrenada" (the query photo) and the matched capture are both shown via Task 1/2's new routes.

**2. Placeholder scan:** no TBD/TODO; every route and component is complete, working code.

**3. Type consistency:** `RefinedCandidateCard`'s `candidate: SearchCandidate` prop matches the exact shape already returned by `runRefine`/`persistRefine` (confirmed via research — no new fields needed). Route paths (`/api/images/indexed/:id`, `/api/images/query/:id`) are referenced identically in Task 3's `<img src>` template strings and Task 1/2's route file locations.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-11-refine-result-panel.md`. Two execution options:

1. **Subagent-Driven (recommended)** - dispatch a fresh subagent per task, review between tasks, fast iteration
2. **Inline Execution** - execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
