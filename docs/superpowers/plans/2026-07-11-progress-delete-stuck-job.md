# Live Progress, Area Deletion & Stuck-Job Visibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix indexing jobs that get stuck in "indexing" forever with zero console output anywhere; make the "Puntos de captura" progress bar advance live instead of jumping 0→N at the end; let the user delete areas from the areas dropdown.

**Architecture:** `apps/worker` runs `runIndexAreaJob` (pg-boss handler) which currently only wraps the `embedImages` call in try/catch — any earlier throw (Overpass, settings reads, `downloadCaptures`, DB writes) rejects silently past pg-boss with no log, leaving the area's `status` stuck at `"indexing"`. Progress is written once, after all points finish. Fix: wrap the whole job body in try/catch with logging, thread a per-point progress callback through `downloadCaptures`, and add a delete button wired to the already-existing `DELETE /api/areas/[id]` route.

**Tech Stack:** TypeScript, vitest, pg-boss, Next.js App Router route handlers.

## Global Constraints

- `route.ts` may only export HTTP handlers; helpers live in sibling modules.
- Relative imports in `apps/web`; no icon webfont (inline SVG/text glyphs only, matching existing `✕`/`✓` usage).
- Do NOT kill the user's node/dev-server or worker processes; verify with `pnpm --filter <pkg> typecheck` and `pnpm --filter <pkg> test`.
- Commit after every task.
- Run worker tests: `pnpm --filter @netryx/worker test <path>`. Run web tests: `pnpm --filter @netryx/web test <path>`.

---

## Task 1: Wrap the whole job body so failures are logged and the area never gets stuck

**Problem:** In `apps/worker/src/jobs/index-area.ts`, only the `embedImages` call (lines 144-157) is inside a `try/catch`. If `deps.getAreaPolygon`, `deps.getSetting`, `deps.fetchStreetGeometry` (Overpass — known to fail with 502/504), `deps.downloadCaptures`, `deps.insertIndexedImages`, `deps.insertIndexedPoints`, or `deps.recordStreetViewUsage` throws, the promise rejects all the way up through `boss.work(...)` in `apps/worker/src/index.ts`, which pg-boss swallows internally with **no console output**. The area's `status` was already set to `"indexing"` and is never touched again — it's stuck forever. This is the reproduced symptom: "no progress, no logs in any of the 3 processes."

**Files:**
- Modify: `apps/worker/src/jobs/index-area.ts`
- Modify: `apps/worker/src/jobs/index-area.test.ts`

**Interfaces:**
- No signature changes — `runIndexAreaJob(payload, deps): Promise<void>` unchanged. Behavior change: never rejects; always resolves, and on any uncaught error the area ends up `status: "failed"` (unless already `"cancelled"`).

- [ ] **Step 1: Write the failing tests**

Append inside `describe("runIndexAreaJob", …)` in `apps/worker/src/jobs/index-area.test.ts`:

```ts
  it("catches an error from BEFORE downloadCaptures (e.g. fetchStreetGeometry/Overpass), logs it, and marks the area failed instead of leaving it stuck", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const deps = makeDeps({
      fetchStreetGeometry: vi.fn().mockRejectedValue(new Error("Overpass 504")),
    });

    await expect(runIndexAreaJob({ areaId: "area-1" }, deps)).resolves.toBeUndefined();

    const statuses = (deps.updateAreaProgress as any).mock.calls.map((c: any[]) => c[1].status).filter(Boolean);
    expect(statuses).toContain("failed");
    expect(consoleErrorSpy).toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });

  it("does not overwrite an already-cancelled area with failed when a later step throws", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const deps = makeDeps({
      isCancelled: vi.fn().mockResolvedValue(false).mockResolvedValueOnce(false).mockResolvedValueOnce(false),
      insertIndexedImages: vi.fn().mockRejectedValue(new Error("db write failed")),
    });
    // Simulate: cancelled flips true only by the time the outer catch checks it.
    (deps.isCancelled as any).mockResolvedValue(true);

    await runIndexAreaJob({ areaId: "area-1" }, deps);

    const statuses = (deps.updateAreaProgress as any).mock.calls.map((c: any[]) => c[1].status).filter(Boolean);
    expect(statuses).not.toContain("failed");
    consoleErrorSpy.mockRestore();
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @netryx/worker test src/jobs/index-area.test.ts`
Expected: FAIL — the first new test currently rejects (the promise throws instead of resolving) because `fetchStreetGeometry`'s rejection isn't caught anywhere; the second test's `updateAreaProgress` still receives `status: "failed"` because there's no outer cancellation guard yet.

- [ ] **Step 3: Wrap the job body in an outer try/catch and add start/success logs**

In `apps/worker/src/jobs/index-area.ts`, replace from `const { areaId } = payload;` through the end of the function:

```ts
    const { areaId } = payload;

    // Cancelled while still queued (before the worker ever picked it up) —
    // bail without touching status, it's already "cancelled" from the API.
    if (await deps.isCancelled(areaId)) return;

    await deps.updateAreaProgress(areaId, { status: "indexing" });

    try {
        // 3) Se incluye la lectura de las configuraciones de la capa gratuita y presupuesto mensual
        const [
            polygon,
            apiKey,
            maxConcurrentRaw,
            pricePerImageRaw,
            maxBudgetRaw,
            creditRaw,
            freeImagesRaw,
            existingPanoHeadings
        ] = await Promise.all([
            deps.getAreaPolygon(areaId),
            deps.getSetting("GOOGLE_MAPS_API_KEY"),
            deps.getSetting("MAX_CONCURRENT_REQUESTS"),
            deps.getSetting("STREET_VIEW_PRICE_PER_IMAGE_USD"),
            deps.getSetting("MAX_MONTHLY_BUDGET_USD"),
            deps.getSetting("GOOGLE_FREE_MONTHLY_CREDIT_USD"),
            deps.getSetting("GOOGLE_FREE_MONTHLY_IMAGES"),
            deps.loadExistingPanoHeadings(),
        ]);

        if (!apiKey) {
            await deps.updateAreaProgress(areaId, { status: "failed" });
            throw new Error("GOOGLE_MAPS_API_KEY is not configured — cannot index (spec §14.5)");
        }

        const maxConcurrent = Number(maxConcurrentRaw ?? 10);
        const pricePerImageUsd = Number(pricePerImageRaw ?? 0.007);
        const maxMonthlyBudgetUsd = Number(maxBudgetRaw ?? 50);
        const creditUsd = Number(creditRaw ?? "0");
        const freeImages = Number(freeImagesRaw ?? "0");

        const lines = await deps.fetchStreetGeometry(polygon);
        const points = deps.samplePointsAlongStreets(lines, SAMPLING_SPACING_METERS);

        console.log(`[index-area] iniciando área ${areaId} (${points.length} puntos)`);

        await deps.updateAreaProgress(areaId, { pointsEstimated: points.length });

        // 4 & 7) Validación de presupuesto considerando costes netos de la capa gratuita (Out-of-Pocket)
        const projectedGross = projectedCostUsd(points.length, STREET_VIEW_HEADINGS.length, pricePerImageUsd);
        const monthSpendUsd = await deps.getMonthlySpendUsd();
        const freeUsd = freeAllowanceUsd(creditUsd, freeImages, pricePerImageUsd);

        const net = netCostBreakdown({ monthSpendUsd, jobCostUsd: projectedGross, freeUsd });

        if (net.netMonthTotalUsd > maxMonthlyBudgetUsd) {
            await deps.updateAreaProgress(areaId, { status: "failed" });
            return;
        }

        const { captures, failedPoints, cancelled } = await deps.downloadCaptures(points, STREET_VIEW_HEADINGS, {
            apiKey,
            maxConcurrent,
            existingPanoHeadings,
            shouldCancel: () => deps.isCancelled(areaId),
        });

        const pointsCaptured = points.length - failedPoints;

        await deps.updateAreaProgress(areaId, {
            pointsCaptured,
            pointsFailed: failedPoints,
        });

        // Cancelled mid-download: leave status as "cancelled" (set by the API),
        // just persist whatever partial progress was made and stop — no failed/
        // indexed/embedding work past this point.
        if (cancelled) return;

        if (captures.length === 0) {
            await deps.updateAreaProgress(areaId, { status: "failed", pointsFailed: failedPoints });
            return;
        }

        // One more check: cancellation may have landed after the last point
        // finished but before embedding (the expensive next stage) started.
        if (await deps.isCancelled(areaId)) return;

        let embeddings: number[][];
        try {
            embeddings = await deps.embedImages(
                captures.map((c) => c.imageBase64),
                deps.inferenceBaseUrl
            );
        } catch (err) {
            // No silenciar: sin esto, un área marcada "failed" no da ninguna
            // pista de si el servicio de inferencia está caído, tardó demasiado,
            // o devolvió un error — hay que verlo en la terminal del worker.
            console.error(`[index-area] embedImages falló para el área ${areaId}:`, err);
            await deps.updateAreaProgress(areaId, { status: "failed", pointsFailed: failedPoints });
            return;
        }

        const inserts: IndexedImageInsert[] = [];
        for (let i = 0; i < captures.length; i++) {
            const capture = captures[i];
            const imagePath = await deps.saveCaptureImage(
                capture.panoId,
                capture.heading,
                capture.imageBase64
            );
            inserts.push({
                panoId: capture.panoId,
                heading: capture.heading,
                lat: capture.lat,
                lng: capture.lng,
                captureDate: capture.captureDate,
                embedding: embeddings[i],
                imagePath,
            });
        }

        await deps.insertIndexedImages(areaId, inserts);

        const aggregatePoints = aggregatePanoDescriptors(captures, embeddings);
        await deps.insertIndexedPoints(areaId, aggregatePoints);

        // 5) Registro del uso real efectuado en base de datos
        await deps.recordStreetViewUsage(captures.length, pricePerImageUsd);

        const actualCostUsd = captures.length * pricePerImageUsd;

        await deps.updateAreaProgress(areaId, {
            status: "indexed",
            pointsCaptured,
            pointsFailed: failedPoints,
            imagesEmbedded: inserts.length,
            actualCostUsd,
        });

        console.log(`[index-area] área ${areaId} indexada: ${inserts.length} imágenes`);
    } catch (err) {
        // Catches anything NOT already handled above (Overpass, settings reads,
        // downloadCaptures itself, insertIndexedImages/insertIndexedPoints,
        // recordStreetViewUsage, ...) — without this, the area got stuck at
        // "indexing" forever with zero console output anywhere (pg-boss
        // swallows the rejection silently).
        console.error(`[index-area] el job del área ${areaId} falló inesperadamente:`, err);
        if (!(await deps.isCancelled(areaId))) {
            await deps.updateAreaProgress(areaId, { status: "failed" }).catch(() => {});
        }
    }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @netryx/worker test src/jobs/index-area.test.ts`
Expected: PASS (all tests, including the two new ones and every pre-existing one — the `!apiKey` and `embedImages` catch paths are unchanged, just now nested one level deeper inside the outer `try`).

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/jobs/index-area.ts apps/worker/src/jobs/index-area.test.ts
git commit -m "fix(worker): wrap the whole index-area job in try/catch so failures are logged and areas never get stuck in indexing"
```

---

## Task 2: Per-point progress callback in `downloadCaptures`

**Files:**
- Modify: `apps/worker/src/street-view.ts`
- Modify: `apps/worker/src/street-view.test.ts`

**Interfaces:**
- Produces: `DownloadOptions.onPointDone?: (done: number, total: number) => void`, invoked once per point as it finishes (in whatever order points complete, since they run concurrently under `pLimit`). Consumed by Task 3.

- [ ] **Step 1: Write the failing test**

Append inside `describe("downloadCaptures", …)` in `apps/worker/src/street-view.test.ts`:

```ts
  it("calls onPointDone once per point as each one finishes, ending at total", async () => {
    const points: SampledPoint[] = Array.from({ length: 4 }, (_, i) => ({ lat: i, lng: i }));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(metadataResponse("pano-x", false)));
    const onPointDone = vi.fn();

    await downloadCaptures(points, [0], {
      apiKey: "test-key",
      maxConcurrent: 4,
      existingPanoHeadings: new Set(),
      onPointDone,
    });

    expect(onPointDone).toHaveBeenCalledTimes(4);
    for (const call of onPointDone.mock.calls) {
      expect(call[1]).toBe(4); // total is always 4
    }
    const doneValues = onPointDone.mock.calls.map((c) => c[0]).sort((a, b) => a - b);
    expect(doneValues).toEqual([1, 2, 3, 4]);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @netryx/worker test src/street-view.test.ts`
Expected: FAIL — `onPointDone` is not a recognized option and is never called (TypeScript would also reject the extra property once typed, but at the JS test-runtime level the call count assertion fails with `0` calls).

- [ ] **Step 3: Add the option and invoke it per point**

In `apps/worker/src/street-view.ts`, add to `DownloadOptions` (after `shouldCancel`):

```ts
  /** Invoked once per point as it finishes (success, no-coverage, or skipped-by-cancellation), for live progress reporting. */
  onPointDone?: (done: number, total: number) => void;
```

Then in `downloadCaptures`, add a counter and call the callback for both the cancellation-skip early-return and the normal per-point return. Replace the body of the `points.map((point) => limit(async () => { ... }))` block:

```ts
  const perPointResults = await Promise.all(
    points.map((point) =>
      limit(async () => {
        if (await Promise.resolve(options.shouldCancel?.() ?? false)) {
          doneCount += 1;
          options.onPointDone?.(doneCount, points.length);
          return { captures: [] as StreetViewCapture[], failed: false, skipped: true };
        }

        const captures: StreetViewCapture[] = [];
        let anyCoverage = false;

        for (const heading of headings) {
          // FIX: El limit() interno ha sido removido. Ahora llamamos directamente usando la estrategia de reintentos.
          const meta = await withRetry(
            () => fetchMetadata(point, heading, options.apiKey),
            retries,
            retryBaseDelayMs
          ).catch(() => null); // Si tras los reintentos falla por completo, tratamos como sin cobertura en este heading

          if (!meta) continue;
          anyCoverage = true;

          const dedupeKey = `${meta.panoId}:${heading}`;
          if (seenThisRun.has(dedupeKey)) continue;
          seenThisRun.add(dedupeKey);

          const imageBase64 = await fetchImage(
            meta.panoId,
            heading,
            options.apiKey,
            retries,
            retryBaseDelayMs
          );

          captures.push({
            panoId: meta.panoId,
            heading,
            lat: point.lat,
            lng: point.lng,
            captureDate: meta.date,
            imageBase64,
          });
        }

        doneCount += 1;
        options.onPointDone?.(doneCount, points.length);
        return { captures, failed: !anyCoverage, skipped: false };
      })
    )
  );
```

And add the counter declaration right before `const perPointResults = await Promise.all(`:

```ts
  let doneCount = 0;
  const perPointResults = await Promise.all(
```

(No shared-state race: JS is single-threaded, `doneCount += 1` inside each async task's continuation runs atomically between awaits.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @netryx/worker test src/street-view.test.ts`
Expected: PASS (all tests, including the new one).

- [ ] **Step 5: Verify worker typecheck**

Run: `pnpm --filter @netryx/worker typecheck`
Expected: only the pre-existing, unrelated `src/index.ts(12,24): error TS1470` (`import.meta` in CommonJS output) — confirmed present before this plan's changes too; no new errors.

- [ ] **Step 6: Commit**

```bash
git add apps/worker/src/street-view.ts apps/worker/src/street-view.test.ts
git commit -m "feat(worker): add onPointDone progress callback to downloadCaptures"
```

---

## Task 3: Wire live progress writes into the job, throttled

**Problem:** `runIndexAreaJob` currently writes `pointsCaptured`/`pointsFailed` exactly once, after `downloadCaptures` resolves for every point — the UI's 1s SSE poll therefore sees `0 → N` in one jump.

**Files:**
- Modify: `apps/worker/src/jobs/index-area.ts` (the `IndexAreaJobDeps.downloadCaptures` type + the call site, both now inside the Task 1 `try` block)
- Modify: `apps/worker/src/jobs/index-area.test.ts`

**Interfaces:**
- Consumes: `onPointDone` (Task 2).
- Changes `IndexAreaJobDeps.downloadCaptures`'s `opts` type to include `onPointDone?: (done: number, total: number) => void`.

- [ ] **Step 1: Write the failing test**

Append inside `describe("runIndexAreaJob", …)` in `apps/worker/src/jobs/index-area.test.ts`:

```ts
  it("writes intermediate pointsCaptured updates during download, not just one at the end", async () => {
    const downloadCaptures = vi.fn().mockImplementation(async (points, _headings, opts) => {
      opts.onPointDone?.(1, 2);
      opts.onPointDone?.(2, 2);
      return {
        captures: [{ panoId: "p1", heading: 0, lat: 0, lng: 0, captureDate: null, imageBase64: "aaa" }],
        failedPoints: 0,
        cancelled: false,
      };
    });
    const deps = makeDeps({
      points: [{ lat: 0, lng: 0 }, { lat: 0.0005, lng: 0 }],
      downloadCaptures,
      captures: [{ panoId: "p1", heading: 0, lat: 0, lng: 0, captureDate: null, imageBase64: "aaa" }],
      embeddings: [[0.1, 0.2]],
    });

    await runIndexAreaJob({ areaId: "area-1" }, deps);

    const pointsCapturedCalls = (deps.updateAreaProgress as any).mock.calls
      .map((c: any[]) => c[1].pointsCaptured)
      .filter((v: unknown) => v !== undefined);
    // At least one intermediate value strictly between 0 and the final total,
    // proving progress is reported before the download-complete update.
    expect(pointsCapturedCalls.some((v: number) => v > 0 && v < 2)).toBe(true);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @netryx/worker test src/jobs/index-area.test.ts`
Expected: FAIL — `downloadCaptures` is currently called without an `onPointDone` in its options, so nothing in the mock's `opts.onPointDone?.(...)` fires, and no intermediate `pointsCaptured` update exists.

- [ ] **Step 3: Extend the deps type and wire the throttled callback**

In `apps/worker/src/jobs/index-area.ts`, update the `downloadCaptures` field of `IndexAreaJobDeps`:

```ts
    downloadCaptures: (
        points: SampledPoint[],
        headings: readonly number[],
        opts: {
            apiKey: string;
            maxConcurrent: number;
            existingPanoHeadings: Set<string>;
            shouldCancel?: () => Promise<boolean> | boolean;
            onPointDone?: (done: number, total: number) => void;
        }
    ) => Promise<{ captures: StreetViewCapture[]; failedPoints: number; cancelled: boolean }>;
```

Then, inside the `try` block from Task 1, change the `downloadCaptures` call:

```ts
        const progressEveryN = Math.max(1, Math.floor(points.length / 50));
        const { captures, failedPoints, cancelled } = await deps.downloadCaptures(points, STREET_VIEW_HEADINGS, {
            apiKey,
            maxConcurrent,
            existingPanoHeadings,
            shouldCancel: () => deps.isCancelled(areaId),
            onPointDone: (done, total) => {
                if (done % progressEveryN === 0 || done === total) {
                    // Fire-and-forget: don't block the download loop waiting on a DB write.
                    // Caps writes at ~50 for the whole job regardless of area size.
                    deps.updateAreaProgress(areaId, { pointsCaptured: done }).catch(() => {});
                }
            },
        });
```

(The existing post-download `await deps.updateAreaProgress(areaId, { pointsCaptured, pointsFailed })` right after stays exactly as-is — it overwrites the last provisional value with the real captured/failed split.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @netryx/worker test src/jobs/index-area.test.ts`
Expected: PASS (all tests, this session's plus the two new ones from Task 1).

- [ ] **Step 5: Verify worker typecheck**

Run: `pnpm --filter @netryx/worker typecheck`
Expected: same single pre-existing `import.meta` error, nothing new.

- [ ] **Step 6: Commit**

```bash
git add apps/worker/src/jobs/index-area.ts apps/worker/src/jobs/index-area.test.ts
git commit -m "feat(worker): write pointsCaptured progress live during download instead of once at the end"
```

---

## Task 4: Delete areas from the areas dropdown

**Backend note:** `DELETE /api/areas/[id]` already exists in `apps/web/app/api/areas/[id]/route.ts` (deletes the row; `indexed_images` cascades via FK) — nothing to add there.

**Files:**
- Modify: `apps/web/app/components/AreasPopup.tsx`
- Modify: `apps/web/app/(protected)/index/page.tsx`

**Interfaces:**
- `AreasPopup` gains an optional prop `onChanged?: () => void`, called after a successful delete or cancel.

- [ ] **Step 1: Add delete state, handler, and button in AreasPopup**

Replace the full contents of `apps/web/app/components/AreasPopup.tsx`:

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

export function AreasPopup({
  onClose, onShowArea, onChanged,
}: { onClose: () => void; onShowArea: (id: string) => void; onChanged?: () => void }) {
  const [areas, setAreas] = useState<AreaItem[]>([]);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  useEffect(() => { fetchJson<{ areas: AreaItem[] }>("/api/areas").then((r) => setAreas(r.data?.areas ?? [])); }, []);

  async function cancelArea(id: string) {
    setCancellingId(id);
    const { ok } = await fetchJson(`/api/areas/${id}/cancel`, { method: "POST" });
    setCancellingId(null);
    if (ok) {
      setAreas((prev) => prev.map((a) => (a.id === id ? { ...a, status: "cancelled" } : a)));
      onChanged?.();
    }
  }

  async function deleteArea(id: string) {
    setDeletingId(id);
    const { ok } = await fetchJson(`/api/areas/${id}`, { method: "DELETE" });
    setDeletingId(null);
    if (ok) {
      setAreas((prev) => prev.filter((a) => a.id !== id));
      onChanged?.();
    }
  }

  return (
    // Sin posicionamiento propio a propósito: el padre (el mismo contenedor
    // flex que envuelve AreasNotification) lo coloca en flujo normal, justo
    // debajo del botón — así nunca se solapan sea cual sea la altura de este.
    <div className="w-80">
      <FloatingCard className="max-h-[70vh] overflow-y-auto p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-sm font-medium text-fg">Áreas indexadas</span>
          <button onClick={onClose} className="text-subtle hover:text-fg" aria-label="Cerrar">✕</button>
        </div>
        <div className="space-y-2">
          {areas.map((a) => {
            const cancellable = a.status === "pending" || a.status === "indexing";
            return (
              // div, no button: contiene botones anidados, y <button> dentro
              // de <button> es HTML inválido.
              <div key={a.id} role="button" tabIndex={0} onClick={() => onShowArea(a.id)}
                className="block w-full cursor-pointer rounded-card border border-border p-2.5 text-left hover:border-white/20">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-fg">{a.name ?? "Área"}</span>
                  <div className="flex items-center gap-2">
                    <Badge tone={statusTone(a.status)}>{a.status}</Badge>
                    {cancellable && (
                      <button
                        onClick={(e) => { e.stopPropagation(); cancelArea(a.id); }}
                        disabled={cancellingId === a.id}
                        className="rounded-md border border-white/10 px-2 py-0.5 text-[11px] text-fg hover:bg-white/10 disabled:opacity-50"
                      >
                        {cancellingId === a.id ? "…" : "Cancelar"}
                      </button>
                    )}
                    <button
                      onClick={(e) => { e.stopPropagation(); deleteArea(a.id); }}
                      disabled={deletingId === a.id}
                      aria-label="Quitar área"
                      className="rounded-md border border-white/10 px-2 py-0.5 text-[11px] text-danger-fg hover:bg-white/10 disabled:opacity-50"
                    >
                      {deletingId === a.id ? "…" : "✕"}
                    </button>
                  </div>
                </div>
                <div className="mt-1 text-xs text-muted">{Number(a.area_km2).toFixed(1)} km² · {a.images_embedded.toLocaleString()} imágenes</div>
              </div>
            );
          })}
          {areas.length === 0 && <p className="text-xs text-muted">Aún no hay áreas indexadas.</p>}
        </div>
      </FloatingCard>
    </div>
  );
}
```

- [ ] **Step 2: Extract the areas-count fetch into a reusable function and pass onChanged**

In `apps/web/app/(protected)/index/page.tsx`, replace the mount `useEffect` (the one fetching `/api/usage` and `/api/areas`):

```tsx
  const refetchAreaCounts = useCallback(() => {
    fetch("/api/areas")
      .then((r) => r.json())
      .then((data) => {
        const areas = Array.isArray(data) ? data : data?.areas ?? [];
        setAreasCount(areas.length);
        setAreasIndexing(areas.filter((a: any) => a.status === "indexing").length);
      })
      .catch(() => {
        setAreasCount(0);
        setAreasIndexing(0);
      });
  }, []);

  // Carga los datos de consumo e inicializa el conteo de áreas creadas
  useEffect(() => {
    fetch("/api/usage")
      .then((r) => r.json())
      .then(setUsage)
      .catch(() => setUsage(null));

    refetchAreaCounts();
  }, [refetchAreaCounts]);
```

Add `useCallback` to the existing React import at the top of the file:

```tsx
import { useState, useEffect, useCallback } from "react";
```

Then update the `<AreasPopup>` render to pass the new prop:

```tsx
        {areasOpen && (
          <AreasPopup
            onClose={() => setAreasOpen(false)}
            onShowArea={(id) => handleShowAreaOnMap(id)}
            onChanged={refetchAreaCounts}
          />
        )}
```

- [ ] **Step 3: Verify**

Run: `pnpm --filter @netryx/web typecheck`
Expected: PASS clean.

Manual: open the areas dropdown, click the `✕` on an area — it disappears from the list and the "N áreas" counter on the notification button updates without a page reload.

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/components/AreasPopup.tsx "apps/web/app/(protected)/index/page.tsx"
git commit -m "feat(web): delete areas from the areas dropdown, refreshing counts"
```

---

## Final verification

- [ ] `pnpm --filter @netryx/worker test` → PASS (all suites, including the new stuck-job and live-progress tests).
- [ ] `pnpm --filter @netryx/worker typecheck` → only the pre-existing unrelated `import.meta` error in `src/index.ts`.
- [ ] `pnpm --filter @netryx/web typecheck` → PASS clean.
- [ ] Manual: restart the worker process; index an area and watch "Puntos de captura" climb gradually instead of jumping; verify a forced failure (e.g. stop the inference service mid-job) now prints a `console.error` in the worker terminal and the area ends up `failed`, not stuck at `indexing`; delete an area from the dropdown and see it disappear with the counter updating.

## Self-Review (coverage)

- "la barra fuera en directo" → Tasks 2 + 3 (per-point callback, throttled DB writes).
- "las áreas de la zona desplegable de arriba se puedan quitar" → Task 4 (delete button, reusing the existing DELETE route).
- "se ha quedado pillado ... no veo ningún log" → Task 1 (root cause: only `embedImages` was try/caught; now the whole body is, with start/success/error logs).

## Type cross-check

`DownloadOptions.onPointDone?: (done:number,total:number)=>void` (Task 2) mirrored exactly in `IndexAreaJobDeps.downloadCaptures`'s inline `opts` type (Task 3) — these are two independently-declared structural types (not a shared import) so both edits are required; verified identical shape. `DownloadResult` (`captures`, `failedPoints`, `cancelled`) unchanged by this plan. `runIndexAreaJob(payload, deps): Promise<void>` signature unchanged; new behavior is "always resolves" instead of "may reject," consistent with Task 1's tests asserting `.resolves.toBeUndefined()`.
