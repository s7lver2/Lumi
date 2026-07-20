# Unified model catalog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generalize the model-catalog install system to support two coexisting install strategies (`code-bundle`, today's exact mechanism, and a new lightweight `generic-classifier` metadata-only strategy), add a VRAM usage bar, and publish Velle v1 + Wanda v1 as the first `generic-classifier` releases.

**Architecture:** A `kind` field on `ModelCatalogManifest` drives dispatch in `install`/`uninstall`/`publish` routes. `generic-classifier` installs write to a new Postgres table (`installed_classification_models`) instead of touching files/restarting. `services/inference` gains a generic HF-pipeline/CLIP-zero-shot loader driven entirely by that table's manifest data, behind a generalized `_ensure_active_model` (keyed by arbitrary `model_id`, not a fixed 2-value enum) and a new `POST /models/{model_id}/classify` endpoint. A VRAM bar reads raw GPU bytes from a generalized `/model-status`.

**Tech Stack:** Next.js App Router route handlers, `node-pg-migrate` migrations, FastAPI + `transformers` (new dependency) + `torch`, Vitest, `pytest`.

## Global Constraints

- `code-bundle` strategy behavior is UNCHANGED — every existing test in `install/route.test.ts`, `uninstall/route.test.ts`, `publish/route.test.ts`, `manifest.test.ts` must keep passing exactly as today (spec Goals: "No behavior change for this strategy").
- `generic-classifier` installs/uninstalls never call `/api/setup/run/restart-inference` and never touch `INFERENCE_DIR` (spec Architecture, "Install/uninstall/publish dispatch").
- `generic-classifier` manifests use a *different*, smaller `benchmark` shape (`{ sampleCount: 0; ranAt: string; vramEstimateBytes: number | null }`) — no `accuracyWithin50m`/`avgDistanceM`, no accuracy gating at publish time (spec Architecture, "Manifest").
- Each facet in a `generic-classifier` manifest carries its own `hfModelId` directly — never a separate top-level list mapped by position (spec Architecture, "Manifest").
- In low-VRAM mode, activating ANY model kind (retrieval, verification, or any classification `model_id`) unloads whichever was active before — one shared slot, generalized from today's 2-value enum (spec Architecture, "generic classifier runtime").
- `pickDefaultRelease` (setup wizard) must never auto-select a `kind: "generic-classifier"` release, regardless of what number is in its `benchmark` (spec Architecture, "Setup wizard").
- New Python dependency: `transformers` (added to `services/inference/requirements.txt`) — no version pin verified live in this environment; the first task that imports it must confirm compatibility with the existing `torch==2.5.1+cu121` pin.

---

### Task 1: DB migration — `installed_classification_models`

**Files:**
- Create: `db/migrations/1721100000000_installed_classification_models.js`

**Interfaces:**
- Produces: table `installed_classification_models(id uuid PK, model_id text, manifest jsonb, active boolean, installed_at timestamptz)`, indexed on `(model_id, active)`.

- [ ] **Step 1: Write the migration**

```js
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE installed_classification_models (
      id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      model_id     text NOT NULL,
      manifest     jsonb NOT NULL,
      active       boolean NOT NULL DEFAULT true,
      installed_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX installed_classification_models_model_id_active_idx
      ON installed_classification_models (model_id, active);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`DROP TABLE installed_classification_models;`);
};
```

- [ ] **Step 2: Apply the migration against the running dev database**

Run: `pnpm --filter @netryx/db migrate:up` (the repo's existing migration-runner script — same one `tools/build.py` runs on every dev boot).
Expected: output confirms `1721100000000_installed_classification_models` ran, no errors.

- [ ] **Step 3: Verify the table exists**

Run: `docker exec netryx-db psql -U netryx -d netryx_dev -c "\d installed_classification_models"`
Expected: shows the 5 columns and the index.

- [ ] **Step 4: Commit**

```bash
git add db/migrations/1721100000000_installed_classification_models.js
git commit -m "feat(db): add installed_classification_models table"
```

---

### Task 2: `manifest.ts` — `kind` field + `generic-classifier` shape

**Files:**
- Modify: `apps/web/lib/model-catalog/manifest.ts`
- Modify: `apps/web/lib/model-catalog/manifest.test.ts`

**Interfaces:**
- Produces: `export type ModelCatalogKind = "code-bundle" | "generic-classifier"`
- Produces: `export interface ClassifierFacet { facet: string; hfModelId: string; strategy: "pipeline" | "clip-zero-shot"; prompts?: string[] }`
- Produces: `export interface CodeBundleManifest { kind: "code-bundle"; bundleId: string; version: string; backbones: BackboneReference[]; benchmark: ModelCatalogBenchmark; description: string; verificationModelId?: string }`
- Produces: `export interface GenericClassifierManifest { kind: "generic-classifier"; modelId: string; version: string; facets: ClassifierFacet[]; benchmark: GenericClassifierBenchmark; description: string }`
- Produces: `export interface GenericClassifierBenchmark { sampleCount: number; ranAt: string; vramEstimateBytes: number | null }`
- Produces: `export type ModelCatalogManifest = CodeBundleManifest | GenericClassifierManifest` (a discriminated union on `kind`)
- Produces: `export function validateModelCatalogManifest(data: unknown): ModelCatalogManifest`

- [ ] **Step 1: Write the failing tests**

Add to `apps/web/lib/model-catalog/manifest.test.ts` (the existing `validManifest()` helper and its tests stay — they now need `kind: "code-bundle"` added; append these new tests):

```ts
function validManifest() {
  return {
    kind: "code-bundle" as const,
    bundleId: "lumi-preview",
    version: "1.1",
    backbones: [
      { name: "MegaLoc", source: "torch.hub:gmberton/MegaLoc" },
      { name: "RoMa", source: "pip:romatch" },
    ],
    benchmark: { accuracyWithin50m: 0.89, avgDistanceM: 8.1, sampleCount: 20, ranAt: "2026-07-15T10:00:00.000Z" },
    description: "Better re-ranking.",
  };
}

function validClassifierManifest() {
  return {
    kind: "generic-classifier" as const,
    modelId: "wanda-v1",
    version: "1.0",
    facets: [
      { facet: "weather", hfModelId: "prithivMLmods/Weather-Image-Classification", strategy: "pipeline" as const },
      {
        facet: "time_of_day",
        hfModelId: "openai/clip-vit-base-patch32",
        strategy: "clip-zero-shot" as const,
        prompts: ["foto tomada al amanecer", "foto tomada al mediodía", "foto tomada al atardecer", "foto tomada de noche"],
      },
    ],
    benchmark: { sampleCount: 0, ranAt: "2026-07-20T10:00:00.000Z", vramEstimateBytes: null },
    description: "Clima, hora del día y estación.",
  };
}

describe("validateModelCatalogManifest — generic-classifier", () => {
  it("accepts a well-formed generic-classifier manifest", () => {
    const result = validateModelCatalogManifest(validClassifierManifest());
    expect(result.kind).toBe("generic-classifier");
    if (result.kind === "generic-classifier") {
      expect(result.modelId).toBe("wanda-v1");
      expect(result.facets).toHaveLength(2);
    }
  });

  it("rejects a generic-classifier manifest missing facets", () => {
    const manifest = validClassifierManifest() as any;
    delete manifest.facets;
    expect(() => validateModelCatalogManifest(manifest)).toThrow(/facets/);
  });

  it("rejects a clip-zero-shot facet missing prompts", () => {
    const manifest = validClassifierManifest() as any;
    delete manifest.facets[1].prompts;
    expect(() => validateModelCatalogManifest(manifest)).toThrow(/prompts/);
  });

  it("rejects a pipeline facet that isn't missing prompts (prompts allowed absent)", () => {
    // sanity: a "pipeline" facet with no prompts field at all is valid
    const manifest = validClassifierManifest();
    expect(() => validateModelCatalogManifest(manifest)).not.toThrow();
  });

  it("rejects an unknown kind", () => {
    const manifest = { ...validClassifierManifest(), kind: "not-a-real-kind" } as any;
    expect(() => validateModelCatalogManifest(manifest)).toThrow(/kind/);
  });

  it("rejects a code-bundle manifest missing kind (kind is now required)", () => {
    const manifest = validManifest() as any;
    delete manifest.kind;
    expect(() => validateModelCatalogManifest(manifest)).toThrow(/kind/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run apps/web/lib/model-catalog/manifest.test.ts`
Expected: FAIL — `kind` doesn't exist yet, `validateModelCatalogManifest` rejects/accepts the wrong things.

- [ ] **Step 3: Implement the new manifest shape**

Replace the whole content of `apps/web/lib/model-catalog/manifest.ts` with:

```ts
// apps/web/lib/model-catalog/manifest.ts

export const BUNDLE_CODE_ASSET_NAME = "code.zip.enc";
export const MODEL_CATALOG_METADATA_ASSET_NAME = "metadata.json.enc";

export interface BackboneReference {
  name: string;
  source: string;
}

export interface ModelCatalogBenchmark {
  accuracyWithin50m: number;
  avgDistanceM: number;
  sampleCount: number;
  ranAt: string;
}

export interface GenericClassifierBenchmark {
  sampleCount: number;
  ranAt: string;
  vramEstimateBytes: number | null;
}

export interface ClassifierFacet {
  facet: string;
  hfModelId: string;
  strategy: "pipeline" | "clip-zero-shot";
  // Required when strategy is "clip-zero-shot", absent for "pipeline" —
  // validated below, not enforced by the type system alone.
  prompts?: string[];
}

export interface CodeBundleManifest {
  kind: "code-bundle";
  bundleId: string;
  version: string;
  backbones: BackboneReference[];
  benchmark: ModelCatalogBenchmark;
  description: string;
  // The verification model id this release provides/activates, if any —
  // undefined means this release doesn't touch verification (e.g. a
  // retrieval-only update). Written by publish/route.ts from the
  // currently-active VERIFICATION_MODEL setting; consumed by
  // install/route.ts to activate it after a successful install.
  verificationModelId?: string;
}

export interface GenericClassifierManifest {
  kind: "generic-classifier";
  modelId: string;
  version: string;
  facets: ClassifierFacet[];
  benchmark: GenericClassifierBenchmark;
  description: string;
}

/**
 * Discriminated union on `kind` (spec: docs/superpowers/specs/2026-07-20-
 * unified-model-catalog-design.md) — code-bundle releases (Lumi Preview,
 * swap+restart) and generic-classifier releases (Velle/Wanda, metadata-
 * only, no restart) share one catalog UI but have entirely different
 * manifest shapes and benchmark semantics.
 */
export type ModelCatalogManifest = CodeBundleManifest | GenericClassifierManifest;

function validateBackbones(raw: unknown): BackboneReference[] {
  if (!Array.isArray(raw)) {
    throw new Error("manifest.backbones must be an array");
  }
  return raw.map((b, i) => {
    if (typeof b !== "object" || b === null) throw new Error(`manifest.backbones[${i}] must be an object`);
    const entry = b as Record<string, unknown>;
    if (typeof entry.name !== "string" || typeof entry.source !== "string") {
      throw new Error(`manifest.backbones[${i}] must have string name/source`);
    }
    return { name: entry.name, source: entry.source };
  });
}

function validateCodeBundleManifest(raw: Record<string, unknown>): CodeBundleManifest {
  if (typeof raw.bundleId !== "string" || raw.bundleId.length === 0) {
    throw new Error("manifest.bundleId must be a non-empty string");
  }
  if (typeof raw.version !== "string" || raw.version.length === 0) {
    throw new Error("manifest.version must be a non-empty string");
  }
  const backbones = validateBackbones(raw.backbones);

  if (typeof raw.benchmark !== "object" || raw.benchmark === null) {
    throw new Error("manifest.benchmark is required");
  }
  const benchmarkRaw = raw.benchmark as Record<string, unknown>;
  if (
    typeof benchmarkRaw.accuracyWithin50m !== "number" ||
    typeof benchmarkRaw.avgDistanceM !== "number" ||
    typeof benchmarkRaw.sampleCount !== "number" ||
    typeof benchmarkRaw.ranAt !== "string"
  ) {
    throw new Error("manifest.benchmark has missing or wrongly-typed fields");
  }

  if (raw.verificationModelId !== undefined && typeof raw.verificationModelId !== "string") {
    throw new Error("manifest.verificationModelId must be a string when present");
  }

  return {
    kind: "code-bundle",
    bundleId: raw.bundleId,
    version: raw.version,
    backbones,
    benchmark: {
      accuracyWithin50m: benchmarkRaw.accuracyWithin50m,
      avgDistanceM: benchmarkRaw.avgDistanceM,
      sampleCount: benchmarkRaw.sampleCount,
      ranAt: benchmarkRaw.ranAt,
    },
    description: typeof raw.description === "string" ? raw.description : "",
    verificationModelId: typeof raw.verificationModelId === "string" ? raw.verificationModelId : undefined,
  };
}

function validateFacets(raw: unknown): ClassifierFacet[] {
  if (!Array.isArray(raw)) {
    throw new Error("manifest.facets must be an array");
  }
  return raw.map((f, i) => {
    if (typeof f !== "object" || f === null) throw new Error(`manifest.facets[${i}] must be an object`);
    const entry = f as Record<string, unknown>;
    if (typeof entry.facet !== "string" || entry.facet.length === 0) {
      throw new Error(`manifest.facets[${i}].facet must be a non-empty string`);
    }
    if (typeof entry.hfModelId !== "string" || entry.hfModelId.length === 0) {
      throw new Error(`manifest.facets[${i}].hfModelId must be a non-empty string`);
    }
    if (entry.strategy !== "pipeline" && entry.strategy !== "clip-zero-shot") {
      throw new Error(`manifest.facets[${i}].strategy must be "pipeline" or "clip-zero-shot"`);
    }
    if (entry.strategy === "clip-zero-shot") {
      if (!Array.isArray(entry.prompts) || entry.prompts.length === 0 || !entry.prompts.every((p) => typeof p === "string")) {
        throw new Error(`manifest.facets[${i}].prompts is required (non-empty string array) for a clip-zero-shot facet`);
      }
    }
    return {
      facet: entry.facet,
      hfModelId: entry.hfModelId,
      strategy: entry.strategy,
      prompts: entry.strategy === "clip-zero-shot" ? (entry.prompts as string[]) : undefined,
    };
  });
}

function validateGenericClassifierManifest(raw: Record<string, unknown>): GenericClassifierManifest {
  if (typeof raw.modelId !== "string" || raw.modelId.length === 0) {
    throw new Error("manifest.modelId must be a non-empty string");
  }
  if (typeof raw.version !== "string" || raw.version.length === 0) {
    throw new Error("manifest.version must be a non-empty string");
  }
  const facets = validateFacets(raw.facets);

  if (typeof raw.benchmark !== "object" || raw.benchmark === null) {
    throw new Error("manifest.benchmark is required");
  }
  const benchmarkRaw = raw.benchmark as Record<string, unknown>;
  if (typeof benchmarkRaw.sampleCount !== "number" || typeof benchmarkRaw.ranAt !== "string") {
    throw new Error("manifest.benchmark has missing or wrongly-typed fields");
  }
  if (benchmarkRaw.vramEstimateBytes !== null && typeof benchmarkRaw.vramEstimateBytes !== "number") {
    throw new Error("manifest.benchmark.vramEstimateBytes must be a number or null");
  }

  return {
    kind: "generic-classifier",
    modelId: raw.modelId,
    version: raw.version,
    facets,
    benchmark: {
      sampleCount: benchmarkRaw.sampleCount,
      ranAt: benchmarkRaw.ranAt,
      vramEstimateBytes: (benchmarkRaw.vramEstimateBytes as number | null) ?? null,
    },
    description: typeof raw.description === "string" ? raw.description : "",
  };
}

/**
 * Strictly validates a decrypted model-catalog manifest, dispatching on
 * `kind` — same discipline as the dataset catalog's own manifest validator:
 * reject malformed/missing fields outright, never return a partially-valid
 * result.
 */
export function validateModelCatalogManifest(data: unknown): ModelCatalogManifest {
  if (typeof data !== "object" || data === null) {
    throw new Error("manifest must be an object");
  }
  const raw = data as Record<string, unknown>;

  if (raw.kind === "code-bundle") return validateCodeBundleManifest(raw);
  if (raw.kind === "generic-classifier") return validateGenericClassifierManifest(raw);
  throw new Error(`manifest.kind must be "code-bundle" or "generic-classifier", got: ${JSON.stringify(raw.kind)}`);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run apps/web/lib/model-catalog/manifest.test.ts`
Expected: PASS (all tests, old and new)

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/model-catalog/manifest.ts apps/web/lib/model-catalog/manifest.test.ts
git commit -m "feat(web): add kind field and generic-classifier shape to model-catalog manifest"
```

---

### Task 3: `classification-models.ts` — DB access layer

**Files:**
- Create: `apps/web/lib/model-catalog/classification-models.ts`
- Create: `apps/web/lib/model-catalog/classification-models.test.ts`

**Interfaces:**
- Consumes: `GenericClassifierManifest` (Task 2), a `pg` `Pool`
- Produces: `export async function installClassificationModel(pool: Pool, manifest: GenericClassifierManifest): Promise<void>`
- Produces: `export async function uninstallClassificationModel(pool: Pool, modelId: string): Promise<{ restoredVersion: string | null }>`
- Produces: `export async function getClassificationModelHistory(pool: Pool, modelId: string): Promise<{ available: boolean; previousVersion: string | null }>`
- Produces: `export async function listActiveClassificationModels(pool: Pool): Promise<GenericClassifierManifest[]>`

- [ ] **Step 1: Write the failing tests**

Create `apps/web/lib/model-catalog/classification-models.test.ts`:

```ts
// apps/web/lib/model-catalog/classification-models.test.ts
import { describe, it, expect, vi } from "vitest";
import {
  installClassificationModel,
  uninstallClassificationModel,
  getClassificationModelHistory,
  listActiveClassificationModels,
} from "./classification-models";
import type { GenericClassifierManifest } from "./manifest";

function manifest(version: string): GenericClassifierManifest {
  return {
    kind: "generic-classifier",
    modelId: "wanda-v1",
    version,
    facets: [{ facet: "weather", hfModelId: "prithivMLmods/Weather-Image-Classification", strategy: "pipeline" }],
    benchmark: { sampleCount: 0, ranAt: "2026-07-20T10:00:00.000Z", vramEstimateBytes: null },
    description: "",
  };
}

function makePool(queryImpl: (sql: string, params: unknown[]) => Promise<{ rows: any[] }>) {
  return { query: vi.fn(queryImpl) } as any;
}

describe("installClassificationModel", () => {
  it("inserts a new row for the model", async () => {
    const pool = makePool(async () => ({ rows: [] }));
    await installClassificationModel(pool, manifest("1.0"));
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO installed_classification_models"),
      ["wanda-v1", JSON.stringify(manifest("1.0"))]
    );
  });
});

describe("uninstallClassificationModel", () => {
  it("deactivates the current row and reactivates the immediately-preceding one", async () => {
    const calls: { sql: string; params: unknown[] }[] = [];
    const pool = makePool(async (sql, params) => {
      calls.push({ sql, params });
      if (sql.includes("UPDATE installed_classification_models SET active = false")) return { rows: [] };
      if (sql.includes("SELECT id, manifest")) {
        return { rows: [{ id: "prev-row-id", manifest: manifest("0.9") }] };
      }
      if (sql.includes("UPDATE installed_classification_models SET active = true")) return { rows: [] };
      throw new Error(`unexpected sql: ${sql}`);
    });

    const result = await uninstallClassificationModel(pool, "wanda-v1");

    expect(result).toEqual({ restoredVersion: "0.9" });
    expect(calls.some((c) => c.sql.includes("active = false"))).toBe(true);
    expect(calls.some((c) => c.sql.includes("active = true"))).toBe(true);
  });

  it("returns restoredVersion: null when there's no earlier row to restore", async () => {
    const pool = makePool(async (sql) => {
      if (sql.includes("active = false")) return { rows: [] };
      if (sql.includes("SELECT id, manifest")) return { rows: [] };
      throw new Error(`unexpected sql: ${sql}`);
    });

    const result = await uninstallClassificationModel(pool, "wanda-v1");
    expect(result).toEqual({ restoredVersion: null });
  });
});

describe("getClassificationModelHistory", () => {
  it("reports available: true with the previous version when one is deactivated most-recently-first", async () => {
    const pool = makePool(async (sql) => {
      if (sql.includes("active = false")) {
        return { rows: [{ manifest: manifest("0.9") }] };
      }
      throw new Error(`unexpected sql: ${sql}`);
    });

    const result = await getClassificationModelHistory(pool, "wanda-v1");
    expect(result).toEqual({ available: true, previousVersion: "0.9" });
  });

  it("reports available: false when there's no deactivated row for this model", async () => {
    const pool = makePool(async () => ({ rows: [] }));
    const result = await getClassificationModelHistory(pool, "wanda-v1");
    expect(result).toEqual({ available: false, previousVersion: null });
  });
});

describe("listActiveClassificationModels", () => {
  it("returns every active row's manifest", async () => {
    const pool = makePool(async () => ({ rows: [{ manifest: manifest("1.0") }] }));
    const result = await listActiveClassificationModels(pool);
    expect(result).toEqual([manifest("1.0")]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run apps/web/lib/model-catalog/classification-models.test.ts`
Expected: FAIL — `./classification-models` doesn't exist yet.

- [ ] **Step 3: Implement `classification-models.ts`**

Create `apps/web/lib/model-catalog/classification-models.ts`:

```ts
// apps/web/lib/model-catalog/classification-models.ts
import type { Pool } from "pg";
import type { GenericClassifierManifest } from "./manifest";

/** Writes a new row for this model's release — every install is a fresh
 * row, never an overwrite, so uninstall can always step back to whatever
 * was active before (spec: docs/superpowers/specs/2026-07-20-unified-
 * model-catalog-design.md, real multi-level history via DB rows instead
 * of a single filesystem snapshot). */
export async function installClassificationModel(pool: Pool, manifest: GenericClassifierManifest): Promise<void> {
  await pool.query(
    `INSERT INTO installed_classification_models (model_id, manifest, active) VALUES ($1, $2, true)`,
    [manifest.modelId, JSON.stringify(manifest)]
  );
}

/** Deactivates the current active row for modelId, then reactivates the
 * most recently deactivated row for that same modelId (if any) — this is
 * the "undo" step, one level back per call, same as clicking "uninstall"
 * again on the newly-reactivated row would step back one more level. */
export async function uninstallClassificationModel(pool: Pool, modelId: string): Promise<{ restoredVersion: string | null }> {
  await pool.query(
    `UPDATE installed_classification_models SET active = false WHERE model_id = $1 AND active = true`,
    [modelId]
  );

  const { rows } = await pool.query(
    `SELECT id, manifest FROM installed_classification_models
     WHERE model_id = $1 AND active = false
     ORDER BY installed_at DESC LIMIT 1`,
    [modelId]
  );
  if (rows.length === 0) return { restoredVersion: null };

  const previous = rows[0] as { id: string; manifest: GenericClassifierManifest };
  await pool.query(`UPDATE installed_classification_models SET active = true WHERE id = $1`, [previous.id]);
  return { restoredVersion: previous.manifest.version };
}

/** Mirrors the code-bundle strategy's GET .../uninstall shape
 * ({available, previousVersion}), scoped to one modelId instead of the
 * single global snapshot. */
export async function getClassificationModelHistory(
  pool: Pool,
  modelId: string
): Promise<{ available: boolean; previousVersion: string | null }> {
  const { rows } = await pool.query(
    `SELECT manifest FROM installed_classification_models
     WHERE model_id = $1 AND active = false
     ORDER BY installed_at DESC LIMIT 1`,
    [modelId]
  );
  if (rows.length === 0) return { available: false, previousVersion: null };
  const row = rows[0] as { manifest: GenericClassifierManifest };
  return { available: true, previousVersion: row.manifest.version };
}

/** Every currently-active classification model's manifest — read by
 * GET /api/model-catalog to compute isActive per release, and eventually
 * by the Consola spec to know what's installed. */
export async function listActiveClassificationModels(pool: Pool): Promise<GenericClassifierManifest[]> {
  const { rows } = await pool.query(
    `SELECT manifest FROM installed_classification_models WHERE active = true`
  );
  return rows.map((r) => r.manifest as GenericClassifierManifest);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run apps/web/lib/model-catalog/classification-models.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/model-catalog/classification-models.ts apps/web/lib/model-catalog/classification-models.test.ts
git commit -m "feat(web): add DB access layer for installed classification models"
```

---

### Task 4: `install/route.ts` — dual-strategy dispatch

**Files:**
- Modify: `apps/web/app/api/model-catalog/install/route.ts`
- Modify: `apps/web/app/api/model-catalog/install/route.test.ts`

**Interfaces:**
- Consumes: `installClassificationModel(pool, manifest)` (Task 3), `getPool()` (existing, `apps/web/lib/db`)
- Produces: unchanged `POST` signature; response shape for the new branch: `{ ok: true, modelId: string, version: string }` (`201`)

- [ ] **Step 1: Write the failing test**

Add to `apps/web/app/api/model-catalog/install/route.test.ts` (append; the file's existing `vi.mock` calls at the top stay as-is, add one more mock and one more `describe` block):

```ts
vi.mock("../../../../lib/model-catalog/classification-models", () => ({ installClassificationModel: vi.fn() }));
vi.mock("../../../../lib/db", () => ({ getPool: vi.fn(() => ({})) }));

describe("POST /api/model-catalog/install — generic-classifier strategy", () => {
  it("installs without touching files or calling restart-inference", async () => {
    const { listReleasesForRepo, downloadReleaseAsset } = await import("../../../../lib/model-catalog/github");
    const { encryptBuffer } = await import("@netryx/settings-repo");
    const { MODEL_CATALOG_SHARED_KEY } = await import("../../../../lib/model-catalog/shared-key");
    const { installClassificationModel } = await import("../../../../lib/model-catalog/classification-models");

    const manifest = {
      kind: "generic-classifier", modelId: "wanda-v1", version: "1.0",
      facets: [{ facet: "weather", hfModelId: "prithivMLmods/Weather-Image-Classification", strategy: "pipeline" }],
      benchmark: { sampleCount: 0, ranAt: "x", vramEstimateBytes: null },
      description: "",
    };

    (listReleasesForRepo as any).mockResolvedValue([
      { tagName: "wanda-v1", name: "x", body: "", assets: [{ name: "metadata.json.enc", url: "meta-url" }] },
    ]);
    (downloadReleaseAsset as any).mockImplementation(async (url: string) => {
      if (url === "meta-url") return encryptBuffer(Buffer.from(JSON.stringify(manifest)), MODEL_CATALOG_SHARED_KEY);
      throw new Error(`unexpected asset url: ${url}`);
    });

    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { POST } = await import("./route");
    const res = await POST(makeRequest({ owner: "inigo", repo: "lumi-model-catalog", tag: "wanda-v1" }));
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json).toEqual({ ok: true, modelId: "wanda-v1", version: "1.0" });
    expect(installClassificationModel).toHaveBeenCalledWith(expect.anything(), manifest);
    expect(fetchMock).not.toHaveBeenCalled(); // no restart-inference call
  });

  it("400s when a generic-classifier release is missing its metadata asset", async () => {
    const { listReleasesForRepo } = await import("../../../../lib/model-catalog/github");
    (listReleasesForRepo as any).mockResolvedValue([
      { tagName: "wanda-v1", name: "x", body: "", assets: [] },
    ]);

    const { POST } = await import("./route");
    const res = await POST(makeRequest({ owner: "inigo", repo: "lumi-model-catalog", tag: "wanda-v1" }));
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run apps/web/app/api/model-catalog/install/route.test.ts`
Expected: FAIL — route doesn't yet read `manifest.kind` or branch.

- [ ] **Step 3: Implement the dispatch**

In `apps/web/app/api/model-catalog/install/route.ts`, add imports:

```ts
import { installClassificationModel } from "../../../../lib/model-catalog/classification-models";
import { getPool } from "../../../../lib/db";
```

Right after the existing block that resolves `metadataAsset`/`codeAsset` and downloads+validates the manifest (i.e. right after the `const manifest = validateModelCatalogManifest(...)` line, and BEFORE the `codeAsset` existence check and code download), insert the kind branch — restructure so `codeAsset` is only required for `code-bundle`:

```ts
  const metadataAsset = release.assets.find((a) => a.name === MODEL_CATALOG_METADATA_ASSET_NAME);
  if (!metadataAsset) {
    return NextResponse.json({ error: "release is missing expected assets" }, { status: 400 });
  }

  const metadataBytes = await downloadReleaseAsset(metadataAsset.url);
  const manifest = validateModelCatalogManifest(
    JSON.parse(decryptBuffer(metadataBytes, MODEL_CATALOG_SHARED_KEY).toString("utf8"))
  );

  if (manifest.kind === "generic-classifier") {
    await installClassificationModel(getPool(), manifest);
    return NextResponse.json({ ok: true, modelId: manifest.modelId, version: manifest.version }, { status: 201 });
  }

  const codeAsset = release.assets.find((a) => a.name === BUNDLE_CODE_ASSET_NAME);
  if (!codeAsset) {
    return NextResponse.json({ error: "release is missing expected assets" }, { status: 400 });
  }
```

(This replaces the original combined `metadataAsset`/`codeAsset` lookup-and-check block — the rest of the function, from `const codeBytes = await downloadReleaseAsset(codeAsset.url);` onward, is unchanged and only runs for `code-bundle`.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run apps/web/app/api/model-catalog/install/route.test.ts`
Expected: PASS (all tests, old `code-bundle` ones and new `generic-classifier` ones)

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/api/model-catalog/install/route.ts apps/web/app/api/model-catalog/install/route.test.ts
git commit -m "feat(web): dispatch model-catalog install by manifest kind"
```

---

### Task 5: `uninstall/route.ts` — dual-strategy dispatch

**Files:**
- Modify: `apps/web/app/api/model-catalog/uninstall/route.ts`
- Modify: `apps/web/app/api/model-catalog/uninstall/route.test.ts`

**Interfaces:**
- Consumes: `uninstallClassificationModel(pool, modelId)`, `getClassificationModelHistory(pool, modelId)` (Task 3)

- [ ] **Step 1: Write the failing tests**

Add to `apps/web/app/api/model-catalog/uninstall/route.test.ts` (check the file's current top-of-file mocks first with Read; add `vi.mock` for `classification-models` and `../../../../lib/db` alongside them, then append):

```ts
describe("GET /api/model-catalog/uninstall?modelId=...", () => {
  it("returns that model's own history instead of the global code-bundle one", async () => {
    const { getClassificationModelHistory } = await import("../../../../lib/model-catalog/classification-models");
    (getClassificationModelHistory as any).mockResolvedValue({ available: true, previousVersion: "0.9" });

    const { GET } = await import("./route");
    const res = await GET(new Request("http://localhost/api/model-catalog/uninstall?modelId=wanda-v1"));
    const json = await res.json();

    expect(json).toEqual({ available: true, previousVersion: "0.9" });
    expect(getClassificationModelHistory).toHaveBeenCalledWith(expect.anything(), "wanda-v1");
  });
});

describe("POST /api/model-catalog/uninstall — generic-classifier strategy", () => {
  it("deactivates/reactivates via modelId, without restarting inference", async () => {
    const { uninstallClassificationModel } = await import("../../../../lib/model-catalog/classification-models");
    (uninstallClassificationModel as any).mockResolvedValue({ restoredVersion: "0.9" });

    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/model-catalog/uninstall", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ modelId: "wanda-v1" }),
      })
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ ok: true, version: "0.9" });
    expect(uninstallClassificationModel).toHaveBeenCalledWith(expect.anything(), "wanda-v1");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run apps/web/app/api/model-catalog/uninstall/route.test.ts`
Expected: FAIL — `GET`/`POST` don't read `modelId` yet.

- [ ] **Step 3: Implement the dispatch**

Replace the whole content of `apps/web/app/api/model-catalog/uninstall/route.ts` with:

```ts
// apps/web/app/api/model-catalog/uninstall/route.ts
import { NextResponse } from "next/server";
import { resolve } from "node:path";
import { restoreInferenceCode } from "../../../../lib/model-catalog/backup";
import { PREVIOUS_CODE_DIR, readUninstallMeta, writeUninstallMeta, clearPreviousBackup } from "../../../../lib/model-catalog/uninstall-state";
import { uninstallClassificationModel, getClassificationModelHistory } from "../../../../lib/model-catalog/classification-models";
import { getPool } from "../../../../lib/db";

// Same INFERENCE_DIR derivation as install/route.ts.
const INFERENCE_DIR = resolve(process.cwd(), "..", "..", "services", "inference");
const INFERENCE_SERVICE_URL = process.env.INFERENCE_SERVICE_URL ?? "http://localhost:8000";
const READY_POLL_TIMEOUT_MS = Number(process.env.MODEL_CATALOG_READY_TIMEOUT_MS ?? 60_000);
const READY_POLL_INTERVAL_MS = Number(process.env.MODEL_CATALOG_READY_POLL_INTERVAL_MS ?? 1_000);

async function waitForInferenceReady(timeoutMs: number = READY_POLL_TIMEOUT_MS): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${INFERENCE_SERVICE_URL}/docs`, { signal: AbortSignal.timeout(2000) });
      if (res.ok) return true;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, READY_POLL_INTERVAL_MS));
  }
  return false;
}

export async function GET(request: Request) {
  const modelId = new URL(request.url).searchParams.get("modelId");
  if (modelId) {
    const history = await getClassificationModelHistory(getPool(), modelId);
    return NextResponse.json(history);
  }

  const meta = await readUninstallMeta();
  return NextResponse.json({ available: meta.previousVersion !== null || meta.currentVersion !== null, previousVersion: meta.previousVersion });
}

interface UninstallBody {
  modelId?: string;
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as UninstallBody;

  if (body.modelId) {
    const { restoredVersion } = await uninstallClassificationModel(getPool(), body.modelId);
    return NextResponse.json({ ok: true, version: restoredVersion });
  }

  const meta = await readUninstallMeta();
  if (meta.currentVersion === null) {
    return NextResponse.json({ error: "No hay ninguna versión instalada para desinstalar" }, { status: 400 });
  }

  await restoreInferenceCode(INFERENCE_DIR, PREVIOUS_CODE_DIR);

  const origin = new URL(request.url).origin;
  const restartRes = await fetch(`${origin}/api/setup/run/restart-inference`, { method: "POST" });
  void restartRes; // SSE stream — we just wait for real readiness below.

  const ready = await waitForInferenceReady();
  if (!ready) {
    return NextResponse.json(
      { error: `Se restauraron los archivos de la versión anterior (${meta.previousVersion ?? "estado original"}), pero el servicio de inferencia no volvió a estar disponible` },
      { status: 502 }
    );
  }

  // Single level of undo — matches the one persistent snapshot we keep.
  await writeUninstallMeta({ currentVersion: meta.previousVersion, previousVersion: null });
  await clearPreviousBackup();

  return NextResponse.json({ ok: true, version: meta.previousVersion });
}
```

Note: the original route's `POST` didn't parse a body at all — it now does, defaulting to `{}` on a body-less request (today's real caller, `ModelosSection.tsx`'s `uninstall()`, sends no body at all for the code-bundle case, which must keep working identically).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run apps/web/app/api/model-catalog/uninstall/route.test.ts`
Expected: PASS (all tests, old and new)

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/api/model-catalog/uninstall/route.ts apps/web/app/api/model-catalog/uninstall/route.test.ts
git commit -m "feat(web): dispatch model-catalog uninstall by modelId presence"
```

---

### Task 6: `benchmark.ts` — VRAM before/after measurement

**Files:**
- Modify: `apps/web/lib/model-catalog/benchmark.ts`
- Modify: `apps/web/lib/model-catalog/benchmark.test.ts`

**Interfaces:**
- Produces: `export interface ModelStatusSnapshot { gpuFreeBytes: number | null; gpuTotalBytes: number | null }`
- Produces: `export async function measureVramDelta(getModelStatus: () => Promise<ModelStatusSnapshot>, runWarmup: () => Promise<void>): Promise<number | null>`

- [ ] **Step 1: Write the failing tests**

Read `apps/web/lib/model-catalog/benchmark.test.ts` first to see its exact existing mocking style, then append:

```ts
describe("measureVramDelta", () => {
  it("returns the drop in free VRAM between the before and after snapshots", async () => {
    const snapshots = [
      { gpuFreeBytes: 5_000_000_000, gpuTotalBytes: 6_000_000_000 },
      { gpuFreeBytes: 1_000_000_000, gpuTotalBytes: 6_000_000_000 },
    ];
    let call = 0;
    const getModelStatus = vi.fn(async () => snapshots[call++]);
    const runWarmup = vi.fn(async () => {});

    const delta = await measureVramDelta(getModelStatus, runWarmup);

    expect(delta).toBe(4_000_000_000);
    expect(runWarmup).toHaveBeenCalledTimes(1);
    expect(getModelStatus).toHaveBeenCalledTimes(2);
  });

  it("returns null when there's no GPU (gpuFreeBytes is null)", async () => {
    const getModelStatus = vi.fn(async () => ({ gpuFreeBytes: null, gpuTotalBytes: null }));
    const delta = await measureVramDelta(getModelStatus, async () => {});
    expect(delta).toBeNull();
  });

  it("never returns a negative delta (free VRAM can fluctuate up between calls)", async () => {
    const snapshots = [
      { gpuFreeBytes: 1_000_000_000, gpuTotalBytes: 6_000_000_000 },
      { gpuFreeBytes: 2_000_000_000, gpuTotalBytes: 6_000_000_000 }, // free went UP
    ];
    let call = 0;
    const getModelStatus = vi.fn(async () => snapshots[call++]);
    const delta = await measureVramDelta(getModelStatus, async () => {});
    expect(delta).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run apps/web/lib/model-catalog/benchmark.test.ts`
Expected: FAIL — `measureVramDelta` doesn't exist yet.

- [ ] **Step 3: Implement `measureVramDelta`**

Add to `apps/web/lib/model-catalog/benchmark.ts` (after the existing imports, anywhere before the exports it doesn't depend on):

```ts
export interface ModelStatusSnapshot {
  gpuFreeBytes: number | null;
  gpuTotalBytes: number | null;
}

/**
 * Measures a model's real VRAM footprint via the HTTP boundary this file
 * already uses for everything else (benchmark.ts has no direct access to
 * torch — see docs/superpowers/specs/2026-07-20-unified-model-catalog-
 * design.md's "VRAM bar" section). Takes a GET /model-status snapshot,
 * runs `runWarmup` (whatever forces the model to load — the retrieval
 * benchmark run, or one classify() call for a generic-classifier), then
 * takes another snapshot; the drop in free VRAM approximates that model's
 * footprint. Only accurate when nothing else is competing for the GPU
 * during the measurement — a known approximation, not lab-grade.
 */
export async function measureVramDelta(
  getModelStatus: () => Promise<ModelStatusSnapshot>,
  runWarmup: () => Promise<void>
): Promise<number | null> {
  const before = await getModelStatus();
  await runWarmup();
  const after = await getModelStatus();
  if (before.gpuFreeBytes === null || after.gpuFreeBytes === null) return null;
  return Math.max(0, before.gpuFreeBytes - after.gpuFreeBytes);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run apps/web/lib/model-catalog/benchmark.test.ts`
Expected: PASS (all tests, old and new)

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/model-catalog/benchmark.ts apps/web/lib/model-catalog/benchmark.test.ts
git commit -m "feat(web): add measureVramDelta for the model-catalog VRAM bar"
```

---

### Task 7: `publish/route.ts` — dual-strategy dispatch

**Files:**
- Modify: `apps/web/app/api/model-catalog/publish/route.ts`
- Modify: `apps/web/app/api/model-catalog/publish/route.test.ts`

**Interfaces:**
- Consumes: `measureVramDelta` (Task 6), `CodeBundleManifest`/`GenericClassifierManifest` (Task 2)

- [ ] **Step 1: Write the failing test**

Read `apps/web/app/api/model-catalog/publish/route.test.ts` first for its exact existing mocking conventions, then append:

```ts
describe("POST /api/model-catalog/publish — generic-classifier strategy", () => {
  it("publishes a manifest-only release, skipping accuracy benchmarking and the code zip", async () => {
    const { getSettingsRepo } = await import("../../../../lib/settings-repo");
    (getSettingsRepo as any).mockReturnValue({
      getSetting: vi.fn(async (key: string) => (key === "GITHUB_TOKEN" ? "tok" : "inigo/lumi-model-catalog")),
    });

    const { ensureRepoWithTopic, upsertRelease } = await import("../../../../lib/model-catalog/github");
    const { buildInferenceCodeZip } = await import("../../../../lib/model-catalog/code-bundle");
    const { runBenchmark } = await import("../../../../lib/model-catalog/benchmark");

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (String(url).includes("/model-status")) return { ok: true, json: async () => ({ gpuFreeBytes: 5_000_000_000, gpuTotalBytes: 6_000_000_000 }) } as Response;
        if (String(url).includes("/classify")) return { ok: true, json: async () => ({ groups: [] }) } as Response;
        throw new Error(`unexpected fetch: ${url}`);
      })
    );

    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/model-catalog/publish", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind: "generic-classifier",
          modelId: "wanda-v1",
          version: "1.0",
          facets: [{ facet: "weather", hfModelId: "prithivMLmods/Weather-Image-Classification", strategy: "pipeline" }],
          description: "Clima, hora del día y estación.",
          sampleImageBase64: "ZmFrZS1pbWFnZS1ieXRlcw==",
        }),
      })
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.tag).toBe("wanda-v1-v1.0");
    expect(buildInferenceCodeZip).not.toHaveBeenCalled();
    expect(runBenchmark).not.toHaveBeenCalled();
    expect(ensureRepoWithTopic).toHaveBeenCalledWith("inigo", "lumi-model-catalog", "tok");
    expect(upsertRelease).toHaveBeenCalledWith(
      "inigo", "lumi-model-catalog", "wanda-v1-v1.0", expect.stringContaining("wanda-v1"),
      expect.arrayContaining([expect.objectContaining({ name: "metadata.json.enc" })]),
      "tok"
    );
    // Exactly one asset — no code.zip.enc for this strategy.
    const uploadedAssets = (upsertRelease as any).mock.calls[0][4];
    expect(uploadedAssets).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run apps/web/app/api/model-catalog/publish/route.test.ts`
Expected: FAIL — route doesn't read `kind` from the body yet.

- [ ] **Step 3: Implement the dispatch**

Replace the whole content of `apps/web/app/api/model-catalog/publish/route.ts` with:

```ts
// apps/web/app/api/model-catalog/publish/route.ts
import { NextResponse } from "next/server";
import { RETRIEVAL_MODELS, DEFAULT_TOP_K } from "@netryx/shared-types";
import { getPool } from "../../../../lib/db";
import { getSettingsRepo } from "../../../../lib/settings-repo";
import { embedQueryImage } from "../../../../lib/inference-client";
import { retrieveCandidates } from "../../../../lib/search/retrieval";
import { buildReferenceSet, runBenchmark, passesBenchmarkThreshold, measureVramDelta, type ModelStatusSnapshot } from "../../../../lib/model-catalog/benchmark";
import { buildInferenceCodeZip } from "../../../../lib/model-catalog/code-bundle";
import { ensureRepoWithTopic, upsertRelease } from "../../../../lib/model-catalog/github";
import { MODEL_CATALOG_SHARED_KEY } from "../../../../lib/model-catalog/shared-key";
import {
  BUNDLE_CODE_ASSET_NAME,
  MODEL_CATALOG_METADATA_ASSET_NAME,
  type CodeBundleManifest,
  type GenericClassifierManifest,
  type ClassifierFacet,
} from "../../../../lib/model-catalog/manifest";
import { encryptBuffer } from "@netryx/settings-repo";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

interface PublishBody {
  kind?: "code-bundle" | "generic-classifier";
  description?: string;
  // generic-classifier only:
  modelId?: string;
  version?: string;
  facets?: ClassifierFacet[];
  sampleImageBase64?: string;
}

const INFERENCE_SERVICE_URL = process.env.INFERENCE_SERVICE_URL ?? "http://localhost:8000";

async function getModelStatusSnapshot(): Promise<ModelStatusSnapshot> {
  const res = await fetch(`${INFERENCE_SERVICE_URL}/model-status`);
  if (!res.ok) return { gpuFreeBytes: null, gpuTotalBytes: null };
  return (await res.json()) as ModelStatusSnapshot;
}

async function publishGenericClassifier(body: PublishBody, token: string, catalogRepo: string) {
  if (!body.modelId || !body.version || !body.facets) {
    return NextResponse.json({ error: "modelId, version and facets are required for a generic-classifier publish" }, { status: 400 });
  }

  const vramEstimateBytes = await measureVramDelta(getModelStatusSnapshot, async () => {
    if (!body.sampleImageBase64) return;
    await fetch(`${INFERENCE_SERVICE_URL}/models/${body.modelId}/classify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ image_base64: body.sampleImageBase64 }),
    });
  });

  const manifest: GenericClassifierManifest = {
    kind: "generic-classifier",
    modelId: body.modelId,
    version: body.version,
    facets: body.facets,
    benchmark: { sampleCount: 0, ranAt: new Date().toISOString(), vramEstimateBytes },
    description: body.description ?? "",
  };

  const [owner, repoName] = catalogRepo.split("/");
  const tag = `${manifest.modelId}-v${manifest.version}`;
  const title = `${manifest.modelId} v${manifest.version}`;

  await ensureRepoWithTopic(owner, repoName, token);
  await upsertRelease(
    owner,
    repoName,
    tag,
    title,
    [{ name: MODEL_CATALOG_METADATA_ASSET_NAME, data: encryptBuffer(Buffer.from(JSON.stringify(manifest)), MODEL_CATALOG_SHARED_KEY) }],
    token
  );

  return NextResponse.json({ tag }, { status: 200 });
}

export async function POST(request: Request) {
  const body = (await request.json()) as PublishBody;
  const repo = getSettingsRepo();
  const token = await repo.getSetting("GITHUB_TOKEN");
  const catalogRepo = await repo.getSetting("MODEL_CATALOG_REPO");
  if (!token || !catalogRepo) {
    return NextResponse.json({ error: "GITHUB_TOKEN and MODEL_CATALOG_REPO must be configured in Settings first" }, { status: 400 });
  }

  if (body.kind === "generic-classifier") {
    return publishGenericClassifier(body, token, catalogRepo);
  }

  const pool = getPool();
  const inferenceBaseUrl = INFERENCE_SERVICE_URL;

  const cases = await buildReferenceSet(pool);
  const benchmark = await runBenchmark(cases, {
    readImageBase64: async (imagePath) => (await readFile(imagePath)).toString("base64"),
    embedQuery: (imageBase64) => embedQueryImage(imageBase64, inferenceBaseUrl),
    retrieve: (embedding, excludeId) => retrieveCandidates(pool, embedding, DEFAULT_TOP_K, excludeId),
  });

  if (!passesBenchmarkThreshold(benchmark)) {
    return NextResponse.json({ benchmark }, { status: 409 });
  }

  const activeRetrievalModel = RETRIEVAL_MODELS[0];
  const bundleId = activeRetrievalModel?.id ?? "lumi-preview";
  const version = activeRetrievalModel?.version ?? "1.0";
  const liveVerificationModel = await repo.getSetting("VERIFICATION_MODEL");

  const inferenceDir = resolve(process.cwd(), "..", "..", "services", "inference");
  const codeZip = await buildInferenceCodeZip(inferenceDir);

  const manifest: CodeBundleManifest = {
    kind: "code-bundle",
    bundleId,
    version,
    backbones: [
      { name: "MegaLoc", source: "torch.hub:gmberton/MegaLoc" },
      { name: "RoMa", source: "pip:romatch" },
    ],
    benchmark,
    description: body.description ?? "",
    verificationModelId: liveVerificationModel || undefined,
  };

  const [owner, repoName] = catalogRepo.split("/");
  const tag = `${bundleId}-v${version}`;
  const title = `${activeRetrievalModel?.displayName ?? "Lumi Preview"} v${version}`;

  await ensureRepoWithTopic(owner, repoName, token);
  await upsertRelease(
    owner,
    repoName,
    tag,
    title,
    [
      { name: BUNDLE_CODE_ASSET_NAME, data: encryptBuffer(Buffer.from(codeZip), MODEL_CATALOG_SHARED_KEY) },
      { name: MODEL_CATALOG_METADATA_ASSET_NAME, data: encryptBuffer(Buffer.from(JSON.stringify(manifest)), MODEL_CATALOG_SHARED_KEY) },
    ],
    token
  );

  return NextResponse.json({ tag, benchmark }, { status: 200 });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run apps/web/app/api/model-catalog/publish/route.test.ts`
Expected: PASS (all tests, old `code-bundle` ones and the new `generic-classifier` one)

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/api/model-catalog/publish/route.ts apps/web/app/api/model-catalog/publish/route.test.ts
git commit -m "feat(web): dispatch model-catalog publish by kind, add VRAM measurement"
```

---

### Task 8: `GET /api/model-catalog` — kind-aware listing

**Files:**
- Modify: `apps/web/app/api/model-catalog/route.ts`
- Modify: `apps/web/app/api/model-catalog/route.test.ts`

**Interfaces:**
- Consumes: `listActiveClassificationModels(pool)` (Task 3), `getPool()`

- [ ] **Step 1: Write the failing test**

Read `apps/web/app/api/model-catalog/route.test.ts` first for its exact mocking style, then append a test asserting that a release whose decrypted manifest has `kind: "generic-classifier"` comes back with `isActive` computed by checking whether `listActiveClassificationModels` includes a matching `modelId`+`version`, e.g.:

```ts
describe("GET /api/model-catalog — generic-classifier releases", () => {
  it("marks a generic-classifier release active by checking installed_classification_models, not the global code-bundle version", async () => {
    const { searchRepositoriesByTopic, listReleasesForRepo, downloadReleaseAsset } = await import("../../../lib/model-catalog/github");
    const { encryptBuffer } = await import("@netryx/settings-repo");
    const { MODEL_CATALOG_SHARED_KEY } = await import("../../../lib/model-catalog/shared-key");
    const { listActiveClassificationModels } = await import("../../../lib/model-catalog/classification-models");

    const manifest = {
      kind: "generic-classifier", modelId: "wanda-v1", version: "1.0",
      facets: [], benchmark: { sampleCount: 0, ranAt: "x", vramEstimateBytes: null }, description: "",
    };

    (searchRepositoriesByTopic as any).mockResolvedValue([{ owner: "inigo", repo: "lumi-model-catalog" }]);
    (listReleasesForRepo as any).mockResolvedValue([
      { tagName: "wanda-v1-v1.0", name: "x", body: "", assets: [{ name: "metadata.json.enc", url: "meta-url" }] },
    ]);
    (downloadReleaseAsset as any).mockImplementation(async () => encryptBuffer(Buffer.from(JSON.stringify(manifest)), MODEL_CATALOG_SHARED_KEY));
    (listActiveClassificationModels as any).mockResolvedValue([{ modelId: "wanda-v1", version: "1.0" }]);

    const { GET } = await import("./route");
    const res = await GET();
    const json = await res.json();

    expect(json.bundles[0].releases[0].kind).toBe("generic-classifier");
    expect(json.bundles[0].releases[0].isActive).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run apps/web/app/api/model-catalog/route.test.ts`
Expected: FAIL — the route doesn't branch by `kind` yet, and `manifest.bundleId`/`manifest.version` are `undefined` for a `generic-classifier` manifest (crashes or reports wrong `isActive`).

- [ ] **Step 3: Implement kind-aware `isActive`**

Replace the whole content of `apps/web/app/api/model-catalog/route.ts` with:

```ts
// apps/web/app/api/model-catalog/route.ts
import { NextResponse } from "next/server";
import { RETRIEVAL_MODELS } from "@netryx/shared-types";
import { searchRepositoriesByTopic, listReleasesForRepo, downloadReleaseAsset } from "../../../lib/model-catalog/github";
import { MODEL_CATALOG_METADATA_ASSET_NAME, type ModelCatalogManifest } from "../../../lib/model-catalog/manifest";
import { MODEL_CATALOG_SHARED_KEY } from "../../../lib/model-catalog/shared-key";
import { decryptBuffer } from "@netryx/settings-repo";
import { readUninstallMeta } from "../../../lib/model-catalog/uninstall-state";
import { listActiveClassificationModels } from "../../../lib/model-catalog/classification-models";
import { getPool } from "../../../lib/db";

export async function GET() {
  // Falling back to the static constant when nothing has ever been
  // installed via the catalog keeps today's out-of-the-box behavior — a
  // fresh clone still shows its built-in version as "Activa" until the
  // first real catalog install.
  const { currentVersion } = await readUninstallMeta();
  const activeVersion = currentVersion ?? RETRIEVAL_MODELS[0]?.version ?? null;
  const activeClassifiers = await listActiveClassificationModels(getPool());
  const repos = await searchRepositoriesByTopic("lumi-model-catalog");

  const bundles = await Promise.all(
    repos.map(async ({ owner, repo }) => {
      const githubReleases = await listReleasesForRepo(owner, repo);

      const releases = await Promise.all(
        githubReleases.map(async (release) => {
          const metadataAsset = release.assets.find((a) => a.name === MODEL_CATALOG_METADATA_ASSET_NAME);
          if (!metadataAsset) return null;

          const encrypted = await downloadReleaseAsset(metadataAsset.url);
          const manifest = JSON.parse(decryptBuffer(encrypted, MODEL_CATALOG_SHARED_KEY).toString("utf8")) as ModelCatalogManifest;

          if (manifest.kind === "generic-classifier") {
            const isActive = activeClassifiers.some((m) => m.modelId === manifest.modelId && m.version === manifest.version);
            return {
              tag: release.tagName,
              kind: "generic-classifier" as const,
              modelId: manifest.modelId,
              version: manifest.version,
              facets: manifest.facets,
              benchmark: manifest.benchmark,
              description: manifest.description,
              isActive,
            };
          }

          return {
            tag: release.tagName,
            kind: "code-bundle" as const,
            bundleId: manifest.bundleId,
            version: manifest.version,
            backbones: manifest.backbones,
            benchmark: manifest.benchmark,
            description: manifest.description,
            isActive: manifest.version === activeVersion,
          };
        })
      );

      return { owner, repo, releases: releases.filter((r): r is NonNullable<typeof r> => r !== null) };
    })
  );

  return NextResponse.json({ bundles });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run apps/web/app/api/model-catalog/route.test.ts`
Expected: PASS (all tests, old `code-bundle` ones and the new `generic-classifier` one)

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/api/model-catalog/route.ts apps/web/app/api/model-catalog/route.test.ts
git commit -m "feat(web): compute isActive per-kind in GET /api/model-catalog"
```

---

### Task 9: `vram.py` raw bytes + `/model-status` fields

**Files:**
- Modify: `services/inference/vram.py`
- Modify: `services/inference/test_vram.py`
- Modify: `services/inference/main.py`
- Modify: `services/inference/test_main.py`

**Interfaces:**
- Produces: `def gpu_memory_bytes(cuda_available: bool, free_bytes: int, total_bytes: int) -> tuple[int, int] | None`
- Modifies: `ModelStatusResponse` gains `gpuFreeBytes: int | None`, `gpuTotalBytes: int | None`

- [ ] **Step 1: Write the failing tests**

Read `services/inference/test_vram.py` first to match its exact style, then add:

```python
from vram import gpu_memory_bytes


def test_gpu_memory_bytes_returns_none_without_cuda():
    assert gpu_memory_bytes(False, 0, 0) is None


def test_gpu_memory_bytes_returns_free_and_total_when_cuda_available():
    assert gpu_memory_bytes(True, 1_000_000_000, 6_000_000_000) == (1_000_000_000, 6_000_000_000)
```

Add to `services/inference/test_main.py` (near `test_model_status_reports_low_vram_mode_and_no_loading_when_idle`):

```python
def test_model_status_reports_gpu_bytes_when_cuda_available(monkeypatch):
    _reset_model_holder(low_vram_mode=False, gpu_note="GPU detectada")
    monkeypatch.setattr(main.torch.cuda, "is_available", lambda: True)
    monkeypatch.setattr(main.torch.cuda, "mem_get_info", lambda: (1_000_000_000, 6_000_000_000))

    resp = _module_client.get("/model-status")

    assert resp.json()["gpuFreeBytes"] == 1_000_000_000
    assert resp.json()["gpuTotalBytes"] == 6_000_000_000


def test_model_status_reports_null_gpu_bytes_without_cuda(monkeypatch):
    _reset_model_holder(low_vram_mode=False, gpu_note="Sin GPU")
    monkeypatch.setattr(main.torch.cuda, "is_available", lambda: False)

    resp = _module_client.get("/model-status")

    assert resp.json()["gpuFreeBytes"] is None
    assert resp.json()["gpuTotalBytes"] is None
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd services/inference && python -m pytest test_vram.py test_main.py -k "gpu_memory_bytes or gpu_bytes" -v`
Expected: FAIL — `gpu_memory_bytes` doesn't exist, `ModelStatusResponse` has no `gpuFreeBytes`/`gpuTotalBytes`.

- [ ] **Step 3: Implement `gpu_memory_bytes`**

Add to `services/inference/vram.py` (after `describe_gpu`):

```python
def gpu_memory_bytes(cuda_available: bool, free_bytes: int, total_bytes: int) -> tuple[int, int] | None:
    """Raw (free, total) VRAM bytes for the model-catalog VRAM bar (spec:
    docs/superpowers/specs/2026-07-20-unified-model-catalog-design.md) —
    describe_gpu() above only produces a human string. main.py queries
    torch.cuda.mem_get_info() fresh on every /model-status call (VRAM
    usage changes as models load/unload, unlike total_memory captured once
    at startup) and passes the raw numbers in here; this function's only
    job is the cuda_available guard, kept next to describe_gpu()'s
    identical guard instead of duplicated in main.py."""
    if not cuda_available:
        return None
    return (free_bytes, total_bytes)
```

- [ ] **Step 4: Wire it into `main.py`**

In `services/inference/main.py`, change the import line:

```python
from vram import resolve_low_vram_mode, describe_gpu, gpu_memory_bytes
```

Change `ModelStatusResponse`:

```python
class ModelStatusResponse(BaseModel):
    loading: str | None
    lowVramMode: bool
    gpuNote: str
    gpuFreeBytes: int | None
    gpuTotalBytes: int | None
```

Replace the `model_status` handler:

```python
@app.get("/model-status", response_model=ModelStatusResponse)
def model_status() -> ModelStatusResponse:
    cuda_available = torch.cuda.is_available()
    gpu_bytes = None
    if cuda_available:
        free_bytes, total_bytes = torch.cuda.mem_get_info()
        gpu_bytes = gpu_memory_bytes(cuda_available, free_bytes, total_bytes)
    return ModelStatusResponse(
        loading=_loading_kind,
        lowVramMode=_model_holder.get("low_vram_mode", False),
        gpuNote=_model_holder.get("gpu_note", "Estado de la GPU desconocido."),
        gpuFreeBytes=gpu_bytes[0] if gpu_bytes else None,
        gpuTotalBytes=gpu_bytes[1] if gpu_bytes else None,
    )
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd services/inference && python -m pytest test_vram.py test_main.py -v`
Expected: PASS (all tests in both files)

- [ ] **Step 6: Widen the TS-side `ModelStatus` proxy (`apps/web/lib/health.ts`)**

The web app never talks to `services/inference` directly from the browser — `GET /api/model-status` (`apps/web/app/api/model-status/route.ts`) proxies `fetchModelStatus()`, typed by `ModelStatus` in `apps/web/lib/health.ts`. Without widening that type/fallback, the new bytes fields get silently dropped on the way through. In `apps/web/lib/health.ts`, change:

```ts
export interface ModelStatus {
  loading: "retrieval" | "verification" | null;
  lowVramMode: boolean;
  gpuNote: string;
}
```

to:

```ts
export interface ModelStatus {
  loading: "retrieval" | "verification" | null;
  lowVramMode: boolean;
  gpuNote: string;
  gpuFreeBytes: number | null;
  gpuTotalBytes: number | null;
}
```

and update `fetchModelStatus`'s catch-block fallback:

```ts
    return { loading: null, lowVramMode: false, gpuNote: "Estado de la GPU desconocido — servicio de inferencia no disponible.", gpuFreeBytes: null, gpuTotalBytes: null };
```

- [ ] **Step 7: Update `apps/web/app/api/model-status/route.test.ts`'s fixtures**

Add `gpuFreeBytes`/`gpuTotalBytes` to both `mockResolvedValue`/`toEqual` object literals in the file's two existing tests (e.g. `gpuFreeBytes: 1_000_000_000, gpuTotalBytes: 6_000_000_000` for the first test, `gpuFreeBytes: null, gpuTotalBytes: null` for the fallback test) — this is a pure-passthrough route, so the test only needs the new fields present on both sides of the equality check.

- [ ] **Step 8: Run the web-side tests**

Run: `npx vitest run apps/web/app/api/model-status/route.test.ts`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add services/inference/vram.py services/inference/test_vram.py services/inference/main.py services/inference/test_main.py apps/web/lib/health.ts apps/web/app/api/model-status/route.test.ts
git commit -m "feat(inference): expose raw GPU VRAM bytes via /model-status"
```

---

### Task 10: `settings.py` — DB-driven classification model registry

**Files:**
- Modify: `services/inference/settings.py`
- Modify: `services/inference/test_settings.py`

**Interfaces:**
- Produces: `def get_active_classification_models(conn) -> dict[str, dict]` — keyed by `modelId`, value is the decoded manifest dict (with a `facets` list, each a dict with `facet`/`hfModelId`/`strategy`/optional `prompts`).

- [ ] **Step 1: Write the failing test**

Read `services/inference/test_settings.py` first for its exact `conn`-mocking convention (likely a fake cursor context manager matching `get_active_model_ids`'s test), then add:

```python
def test_get_active_classification_models_reads_active_rows(fake_conn_with_rows):
    # fake_conn_with_rows is this test file's existing helper for building a
    # fake psycopg2 connection whose cursor().fetchall() returns given rows —
    # reuse whatever helper get_active_model_ids's own tests already use.
    conn = fake_conn_with_rows([
        ("wanda-v1", {"modelId": "wanda-v1", "facets": [{"facet": "weather", "hfModelId": "x", "strategy": "pipeline"}]}),
    ])
    result = get_active_classification_models(conn)
    assert result == {"wanda-v1": {"modelId": "wanda-v1", "facets": [{"facet": "weather", "hfModelId": "x", "strategy": "pipeline"}]}}


def test_get_active_classification_models_empty_when_none_installed(fake_conn_with_rows):
    conn = fake_conn_with_rows([])
    assert get_active_classification_models(conn) == {}
```

If no `fake_conn_with_rows` helper already exists in `test_settings.py`, write one matching the file's existing raw-`cursor()`-mock pattern (check how `test_get_active_model_ids`-equivalent tests build their fake `conn` first — mirror that exactly rather than inventing a new mocking style).

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/inference && python -m pytest test_settings.py -k classification_models -v`
Expected: FAIL — `get_active_classification_models` doesn't exist.

- [ ] **Step 3: Implement it**

Add to `services/inference/settings.py`:

```python
def get_active_classification_models(conn) -> dict:
    """Every currently-installed (active=true) generic-classifier model,
    keyed by modelId (spec: docs/superpowers/specs/2026-07-20-unified-
    model-catalog-design.md). Queried fresh on every /models/{model_id}/
    classify call (not cached at startup like get_active_model_ids) —
    installing/uninstalling a classifier must take effect without
    restarting this process. psycopg2 decodes the `manifest` jsonb column
    to a plain dict automatically (its default type adapter for jsonb),
    no json.loads needed here."""
    with conn.cursor() as cur:
        cur.execute("SELECT model_id, manifest FROM installed_classification_models WHERE active = true")
        rows = cur.fetchall()
    return {model_id: manifest for model_id, manifest in rows}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd services/inference && python -m pytest test_settings.py -v`
Expected: PASS (all tests in the file)

- [ ] **Step 5: Commit**

```bash
git add services/inference/settings.py services/inference/test_settings.py
git commit -m "feat(inference): add get_active_classification_models, DB-driven registry"
```

---

### Task 11: `loader.py` — generic HF-pipeline + CLIP zero-shot loaders

**Files:**
- Modify: `services/inference/loader.py`
- Modify: `services/inference/test_loader.py`
- Modify: `services/inference/requirements.txt`

**Interfaces:**
- Produces: `class GenericClassifier` with `.classify(image: np.ndarray) -> list[dict]` (each dict: `{"facet": str, "labels": [{"name": str, "score": float}]}`)
- Produces: `def load_generic_classifier(manifest: dict) -> GenericClassifier`

- [ ] **Step 1: Add the new dependency**

In `services/inference/requirements.txt`, add a line after `huggingface_hub`:

```
transformers
```

- [ ] **Step 2: Install it and confirm no conflict with the existing torch pin**

Run: `cd services/inference && source venv/bin/activate && pip install transformers && pip check`
Expected: installs cleanly; `pip check` reports no broken requirements against `torch==2.5.1+cu121`. If `pip check` reports a conflict, STOP and re-open Phase 1 of systematic-debugging on that specific conflict before continuing — do not pin a version blind.

- [ ] **Step 3: Write the failing tests**

Add to `services/inference/test_loader.py`:

```python
import numpy as np
import torch


def _fake_image():
    return np.zeros((4, 4, 3), dtype=np.uint8)


def test_load_generic_classifier_runs_a_pipeline_facet(monkeypatch):
    import loader

    fake_pipeline_results = [{"label": "rain/storm", "score": 0.81}, {"label": "sun/clear", "score": 0.12}]
    fake_clf = lambda image: fake_pipeline_results  # noqa: E731 — pipeline(...) returns a callable
    monkeypatch.setattr(loader, "_TRANSFORMERS_PIPELINE", lambda *a, **k: fake_clf)

    manifest = {
        "modelId": "wanda-v1",
        "facets": [{"facet": "weather", "hfModelId": "prithivMLmods/Weather-Image-Classification", "strategy": "pipeline"}],
    }
    classifier = loader.load_generic_classifier(manifest)
    groups = classifier.classify(_fake_image())

    assert groups == [{"facet": "weather", "labels": [{"name": "rain/storm", "score": 0.81}, {"name": "sun/clear", "score": 0.12}]}]


def test_load_generic_classifier_runs_a_clip_zero_shot_facet(monkeypatch):
    import loader

    class FakeOutputs:
        logits_per_image = torch.tensor([[2.0, 0.5]])

    class FakeModel:
        def to(self, device):
            return self

        def __call__(self, **kwargs):
            return FakeOutputs()

    class FakeProcessor:
        def __call__(self, text, images, return_tensors, padding):
            return {"input_ids": torch.zeros(1, 1, dtype=torch.long)}

    monkeypatch.setattr(loader, "_CLIP_MODEL_CLS", type("M", (), {"from_pretrained": staticmethod(lambda _id: FakeModel())}))
    monkeypatch.setattr(loader, "_CLIP_PROCESSOR_CLS", type("P", (), {"from_pretrained": staticmethod(lambda _id: FakeProcessor())}))

    manifest = {
        "modelId": "wanda-v1",
        "facets": [
            {
                "facet": "time_of_day",
                "hfModelId": "openai/clip-vit-base-patch32",
                "strategy": "clip-zero-shot",
                "prompts": ["foto de día", "foto de noche"],
            }
        ],
    }
    classifier = loader.load_generic_classifier(manifest)
    groups = classifier.classify(_fake_image())

    assert groups[0]["facet"] == "time_of_day"
    # "foto de día" (logit 2.0) ranks above "foto de noche" (logit 0.5)
    assert groups[0]["labels"][0]["name"] == "foto de día"
    assert groups[0]["labels"][0]["score"] > groups[0]["labels"][1]["score"]


def test_load_generic_classifier_merges_multiple_facets(monkeypatch):
    import loader

    monkeypatch.setattr(loader, "_TRANSFORMERS_PIPELINE", lambda *a, **k: (lambda image: [{"label": "x", "score": 1.0}]))

    manifest = {
        "modelId": "velle-v1",
        "facets": [
            {"facet": "vehicle", "hfModelId": "Jordo23/vehicle-classifier", "strategy": "pipeline"},
        ],
    }
    classifier = loader.load_generic_classifier(manifest)
    groups = classifier.classify(_fake_image())
    assert [g["facet"] for g in groups] == ["vehicle"]
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `cd services/inference && python -m pytest test_loader.py -k generic_classifier -v`
Expected: FAIL — `load_generic_classifier`/`_TRANSFORMERS_PIPELINE`/`_CLIP_MODEL_CLS`/`_CLIP_PROCESSOR_CLS` don't exist yet.

- [ ] **Step 5: Implement the generic classifier loaders**

Add to `services/inference/loader.py` (after `RomaMatcher`, before the `_LOAD_ROMA_OUTDOOR` indirection block — or anywhere after the `torch`/`from models.registry import ...` imports at the top):

```python
class GenericClassifier:
    """Wraps one or more per-facet sub-models behind the uniform
    `.classify(image) -> list[dict]` interface main.py expects (same shape
    RomaMatcher.match_points() plays for verification) — a manifest's
    `facets` list (spec: docs/superpowers/specs/2026-07-20-unified-model-
    catalog-design.md) drives which sub-model handles which facet, and
    this class just runs each and merges the results."""

    def __init__(self, facet_runners: list):
        # facet_runners: list of (facet_name: str, runner: Callable[[np.ndarray], list[dict]])
        self._facet_runners = facet_runners

    def classify(self, image):
        return [{"facet": facet, "labels": runner(image)} for facet, runner in self._facet_runners]


# Indirection so tests can inject fakes instead of downloading real HF
# weights — same pattern as _LOAD_ROMA_OUTDOOR above. Both stay None until
# first real use; lazily resolved because `transformers` is a heavy import.
_TRANSFORMERS_PIPELINE = None
_CLIP_MODEL_CLS = None
_CLIP_PROCESSOR_CLS = None


def _load_hf_pipeline_classifier(hf_model_id: str):
    global _TRANSFORMERS_PIPELINE
    if _TRANSFORMERS_PIPELINE is None:
        from transformers import pipeline as _pipeline

        _TRANSFORMERS_PIPELINE = _pipeline
    device = 0 if torch.cuda.is_available() else -1
    return _TRANSFORMERS_PIPELINE("image-classification", model=hf_model_id, device=device)


def _run_hf_pipeline(clf, image) -> list:
    from PIL import Image

    results = clf(Image.fromarray(image))
    return [{"name": r["label"], "score": float(r["score"])} for r in results]


def _load_clip_zero_shot_classifier(hf_model_id: str):
    global _CLIP_MODEL_CLS, _CLIP_PROCESSOR_CLS
    if _CLIP_MODEL_CLS is None or _CLIP_PROCESSOR_CLS is None:
        from transformers import CLIPModel, CLIPProcessor

        _CLIP_MODEL_CLS = CLIPModel
        _CLIP_PROCESSOR_CLS = CLIPProcessor
    device = "cuda" if torch.cuda.is_available() else "cpu"
    model = _CLIP_MODEL_CLS.from_pretrained(hf_model_id).to(device)
    processor = _CLIP_PROCESSOR_CLS.from_pretrained(hf_model_id)
    return (model, processor, device)


def _run_clip_zero_shot(model_and_processor, prompts: list, image) -> list:
    from PIL import Image

    model, processor, device = model_and_processor
    inputs = processor(text=prompts, images=Image.fromarray(image), return_tensors="pt", padding=True)
    inputs = {k: v.to(device) if hasattr(v, "to") else v for k, v in inputs.items()}
    with torch.no_grad():
        outputs = model(**inputs)
    probs = outputs.logits_per_image.softmax(dim=1)[0].tolist()
    ranked = sorted(zip(prompts, probs), key=lambda pair: pair[1], reverse=True)
    return [{"name": name, "score": float(score)} for name, score in ranked]


def load_generic_classifier(manifest: dict) -> GenericClassifier:
    """manifest is one installed_classification_models row's decoded
    `manifest` jsonb (spec: docs/superpowers/specs/2026-07-20-unified-
    model-catalog-design.md) — loads one sub-model per facet. Two facets
    naming the same hfModelId (Wanda's time_of_day/season both use the
    same CLIP checkpoint) each get their own loaded instance — no
    cross-facet caching; acceptable since that checkpoint is small enough
    to load twice, and avoids adding cache-invalidation complexity for a
    case that's rare today."""
    facet_runners = []
    for facet_cfg in manifest["facets"]:
        facet = facet_cfg["facet"]
        hf_model_id = facet_cfg["hfModelId"]
        if facet_cfg["strategy"] == "pipeline":
            clf = _load_hf_pipeline_classifier(hf_model_id)
            facet_runners.append((facet, lambda image, clf=clf: _run_hf_pipeline(clf, image)))
        else:
            prompts = facet_cfg["prompts"]
            model_and_processor = _load_clip_zero_shot_classifier(hf_model_id)
            facet_runners.append(
                (facet, lambda image, mp=model_and_processor, prompts=prompts: _run_clip_zero_shot(mp, prompts, image))
            )
    return GenericClassifier(facet_runners)
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd services/inference && python -m pytest test_loader.py -v`
Expected: PASS (all tests in the file, old and new)

- [ ] **Step 7: Commit**

```bash
git add services/inference/loader.py services/inference/test_loader.py services/inference/requirements.txt
git commit -m "feat(inference): add generic HF-pipeline and CLIP zero-shot classifier loaders"
```

---

### Task 12: `main.py` — generalized `_ensure_active_model` + `POST /models/{model_id}/classify`

**Files:**
- Modify: `services/inference/main.py`
- Modify: `services/inference/test_main.py`

**Interfaces:**
- Consumes: `get_active_classification_models(conn)` (Task 10), `load_generic_classifier(manifest)` (Task 11)
- Produces: `POST /models/{model_id}/classify` — `200 {"groups": [{"facet": str, "labels": [{"name": str, "score": float}]}]}`, `404` unknown/inactive id, `503` on OOM.

- [ ] **Step 1: Write the failing tests**

Add to `services/inference/test_main.py`:

```python
def test_classify_404s_for_an_unknown_model_id(monkeypatch):
    monkeypatch.setattr(main, "_connect_db", lambda: _FakeConnNoRows())
    resp = _module_client.post("/models/not-installed-v1/classify", json={"image_base64": _fake_image_base64()})
    assert resp.status_code == 404


def test_classify_returns_groups_for_a_known_model_id(monkeypatch):
    manifest = {"modelId": "wanda-v1", "facets": []}
    monkeypatch.setattr(main, "_connect_db", lambda: _FakeConnWithRow("wanda-v1", manifest))
    _reset_model_holder(low_vram_mode=False)

    class _FakeClassifier:
        def classify(self, image):
            return [{"facet": "weather", "labels": [{"name": "rain/storm", "score": 0.81}]}]

    monkeypatch.setattr(main, "load_generic_classifier", lambda m: _FakeClassifier())

    resp = _module_client.post("/models/wanda-v1/classify", json={"image_base64": _fake_image_base64()})

    assert resp.status_code == 200
    assert resp.json() == {"groups": [{"facet": "weather", "labels": [{"name": "rain/storm", "score": 0.81}]}]}


def test_classify_raises_503_on_oom(monkeypatch):
    manifest = {"modelId": "wanda-v1", "facets": []}
    monkeypatch.setattr(main, "_connect_db", lambda: _FakeConnWithRow("wanda-v1", manifest))
    _reset_model_holder(low_vram_mode=False)

    class _OomClassifier:
        def classify(self, image):
            raise torch.cuda.OutOfMemoryError("CUDA out of memory")

    monkeypatch.setattr(main, "load_generic_classifier", lambda m: _OomClassifier())

    resp = _module_client.post("/models/wanda-v1/classify", json={"image_base64": _fake_image_base64()})
    assert resp.status_code == 503


class _FakeConnNoRows:
    def cursor(self):
        return self

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def execute(self, *a):
        pass

    def fetchall(self):
        return []

    def close(self):
        pass


class _FakeConnWithRow:
    def __init__(self, model_id, manifest):
        self._rows = [(model_id, manifest)]

    def cursor(self):
        return self

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def execute(self, *a):
        pass

    def fetchall(self):
        return self._rows

    def close(self):
        pass
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd services/inference && python -m pytest test_main.py -k classify -v`
Expected: FAIL — `/models/{model_id}/classify` doesn't exist, `_connect_db`/`load_generic_classifier` aren't imported in `main`.

- [ ] **Step 3: Generalize `_ensure_active_model` and add the endpoint**

In `services/inference/main.py`, change the import line to add the new loader and settings function:

```python
from loader import load_retrieval_model, load_verification_model, load_generic_classifier
```

```python
from settings import (
    DEFAULT_VERIFICATION_TILE_PASSES,
    get_active_model_ids,
    get_active_classification_models,
    get_verification_tile_passes,
    get_verify_config,
    get_low_vram_mode_setting,
)
```

Add a small connection helper (right after the `app = FastAPI(...)` line, before `_model_holder`), and refactor `load_model_once` to reuse it:

```python
def _connect_db():
    return psycopg2.connect(
        host=os.environ.get("POSTGRES_HOST", "localhost"),
        port=os.environ.get("POSTGRES_PORT", "5432"),
        user=os.environ.get("POSTGRES_USER", "netryx"),
        password=os.environ.get("POSTGRES_PASSWORD", "changeme"),
        dbname=os.environ.get("POSTGRES_DB", "netryx_dev"),
    )
```

In `load_model_once`, replace its inline `psycopg2.connect(...)` call with `conn = _connect_db()` (same behavior, deduplicated).

Replace `_load_kind` and `_unload_kind` with:

```python
def _model_key(kind: str) -> str:
    if kind == "retrieval":
        return "model"
    if kind == "verification":
        return "verification_model"
    # Any other kind is a classification model_id (spec: docs/superpowers/
    # specs/2026-07-20-unified-model-catalog-design.md).
    return f"classifier_{kind}"


def _load_kind(kind: str):
    if kind == "retrieval":
        model = load_retrieval_model(_model_holder["retrieval_model_id"])
        device = "cuda" if torch.cuda.is_available() else "cpu"
        model = model.to(device)
        model.eval()
        return model
    if kind == "verification":
        return load_verification_model(_model_holder["verification_model_id"])

    # A classification model_id — re-fetch its manifest from the DB-backed
    # registry rather than threading it through _model_holder, since
    # classify() isn't a hot path (unlike /embed's per-chunk calls).
    conn = _connect_db()
    try:
        manifest = get_active_classification_models(conn).get(kind)
    finally:
        conn.close()
    if manifest is None:
        raise HTTPException(status_code=404, detail=f"Unknown or inactive classification model id: {kind}")
    return load_generic_classifier(manifest)


def _unload_kind(kind: str) -> None:
    key = _model_key(kind)
    if key in _model_holder:
        del _model_holder[key]
    if torch.cuda.is_available():
        torch.cuda.empty_cache()
```

In `_ensure_active_model`, replace the line `key = "model" if kind == "retrieval" else "verification_model"` with `key = _model_key(kind)` (the rest of the function body is unchanged — it already worked generically on `kind`/`key`, the 2-value assumption was only in that one line and in `_load_kind`/`_unload_kind` above).

Add the request/response models (near `VerifyResponse`):

```python
class ClassifyRequest(BaseModel):
    image_base64: str


class ClassifyLabel(BaseModel):
    name: str
    score: float


class ClassifyGroup(BaseModel):
    facet: str
    labels: list[ClassifyLabel]


class ClassifyResponse(BaseModel):
    groups: list[ClassifyGroup]
```

Add the endpoint (after `/verify`, before `/model-status`):

```python
@app.post("/models/{model_id}/classify", response_model=ClassifyResponse)
def classify(model_id: str, request: ClassifyRequest) -> ClassifyResponse:
    conn = _connect_db()
    try:
        active_models = get_active_classification_models(conn)
    finally:
        conn.close()
    if model_id not in active_models:
        raise HTTPException(status_code=404, detail=f"Unknown or inactive classification model id: {model_id}")

    image = _decode_image(request.image_base64)
    classifier = _ensure_active_model(model_id)  # OOM during load already raises 503 inside _ensure_active_model
    try:
        groups = classifier.classify(image)
    except torch.cuda.OutOfMemoryError as exc:
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
        raise HTTPException(status_code=503, detail=_OOM_INFERENCE_MESSAGE) from exc

    return ClassifyResponse(groups=[ClassifyGroup(facet=g["facet"], labels=[ClassifyLabel(**l) for l in g["labels"]]) for g in groups])
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd services/inference && python -m pytest test_main.py -v`
Expected: PASS (the full file — this also re-verifies every pre-existing `_ensure_active_model`/`/embed`/`/verify` test still passes with the generalized `_model_key`)

- [ ] **Step 5: Commit**

```bash
git add services/inference/main.py services/inference/test_main.py
git commit -m "feat(inference): generalize _ensure_active_model, add POST /models/{model_id}/classify"
```

---

### Task 13: `ModelosSection.tsx` + `CatalogDetailPanel.tsx` — VRAM bar + kind-aware listing

**Files:**
- Modify: `apps/web/app/components/ModelosSection.tsx`
- Modify: `apps/web/app/components/CatalogDetailPanel.tsx`
- Modify: `apps/web/app/lib/catalog-types.ts`

**Interfaces:**
- Consumes: `GET /api/model-catalog`'s new per-release `kind` field (Task 8), `GET /api/model-status`'s new `gpuFreeBytes`/`gpuTotalBytes` (Task 9)

No automated test for this task — this repo has no component-render test infra (`apps/web/vitest.config.ts` uses `environment: "node"`, and no `.tsx` test files exist under `apps/web/app/components`; `ModelosSection.tsx` itself has never had one). Verified manually in Task 15.

- [ ] **Step 1: Add a VRAM bar to `CatalogDetailPanel`**

In `apps/web/app/components/CatalogDetailPanel.tsx`, add a new optional prop and render it between `{extra}` and the install/secondary-action row:

```tsx
export function CatalogDetailPanel({
  title,
  subtitle,
  stats,
  extra,
  vram,
  installLabel,
  installDisabled,
  onInstall,
  secondaryAction,
}: {
  title: string;
  subtitle: string;
  stats: { label: string; value: string }[];
  extra?: React.ReactNode;
  vram?: { totalBytes: number; freeBytes: number; estimateBytes: number | null };
  installLabel: string;
  installDisabled?: boolean;
  onInstall: () => void;
  secondaryAction?: { label: string; onClick: () => void; disabled?: boolean };
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
      {vram && vram.estimateBytes !== null ? (
        <div className="mt-4">
          <div className="mb-1 text-[10.5px] uppercase tracking-wide text-subtle">VRAM estimada</div>
          <div className="relative h-2 w-full overflow-hidden rounded-full bg-white/10">
            <div
              className="absolute inset-y-0 left-0 bg-white/20"
              style={{ width: `${Math.min(100, (100 * (vram.totalBytes - vram.freeBytes)) / vram.totalBytes)}%` }}
            />
            <div
              className="absolute inset-y-0 left-0 bg-[#85b7eb]"
              style={{ width: `${Math.min(100, (100 * vram.estimateBytes) / vram.totalBytes)}%` }}
            />
          </div>
          <div className="mt-1 text-[10.5px] text-subtle">
            ~{(vram.estimateBytes / 1024 ** 3).toFixed(1)} GB de {(vram.totalBytes / 1024 ** 3).toFixed(1)} GB totales
          </div>
        </div>
      ) : vram ? (
        <div className="mt-4 text-[10.5px] text-subtle">Sin estimación de VRAM disponible para este modelo.</div>
      ) : null}
      <div className="mt-5 flex items-center gap-2.5">
        <button
          onClick={onInstall}
          disabled={installDisabled}
          className="self-start rounded-md bg-accent px-4 py-2 text-xs font-medium text-black disabled:opacity-50"
        >
          {installLabel}
        </button>
        {secondaryAction && (
          <button
            onClick={secondaryAction.onClick}
            disabled={secondaryAction.disabled}
            className="self-start rounded-md border border-white/[.15] px-4 py-2 text-xs font-medium text-fg hover:bg-white/5 disabled:opacity-50"
          >
            {secondaryAction.label}
          </button>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Widen `catalog-types.ts`'s `CatalogRelease` into a union**

In `apps/web/app/lib/catalog-types.ts`, replace the existing `CatalogRelease` interface with:

```ts
export interface ClassifierFacetInfo {
  facet: string;
  hfModelId: string;
  strategy: "pipeline" | "clip-zero-shot";
  prompts?: string[];
}

export interface GenericClassifierBenchmark {
  sampleCount: number;
  ranAt: string;
  vramEstimateBytes: number | null;
}

export interface CodeBundleCatalogRelease {
  tag: string;
  kind: "code-bundle";
  bundleId: string;
  version: string;
  backbones: Backbone[];
  benchmark: CatalogBenchmark;
  description: string;
  isActive: boolean;
}

export interface GenericClassifierCatalogRelease {
  tag: string;
  kind: "generic-classifier";
  modelId: string;
  version: string;
  facets: ClassifierFacetInfo[];
  benchmark: GenericClassifierBenchmark;
  description: string;
  isActive: boolean;
}

export type CatalogRelease = CodeBundleCatalogRelease | GenericClassifierCatalogRelease;
```

`flattenModelBundles`'s own body doesn't change — `bundle.releases` already flows through as whatever `CatalogRelease` resolves to.

- [ ] **Step 3: Rewrite `ModelosSection.tsx`**

Replace the whole content of `apps/web/app/components/ModelosSection.tsx` with:

```tsx
// apps/web/app/components/ModelosSection.tsx
"use client";
import { useEffect, useState } from "react";
import { fetchJson } from "../lib/fetch-json";
import { flattenModelBundles, type CatalogBundle, type ModelCatalogItem, type CatalogRelease } from "../lib/catalog-types";
import { MODEL_FILTERS, filterModelItems, type ModelFilterId } from "../lib/catalog-filters";
import { CatalogList } from "./CatalogList";
import { CatalogDetailPanel } from "./CatalogDetailPanel";

function ModelRow({ item, selected }: { item: ModelCatalogItem; selected: boolean }) {
  const r = item.release;
  return (
    <div className={`flex items-center justify-between border-b border-white/10 px-4 py-3 ${selected ? "bg-white/[.03]" : ""}`}>
      <div>
        <div className="text-[13px] text-fg">
          {r.kind === "code-bundle" ? `v${r.version}` : `${r.modelId}`}
        </div>
        <div className="text-[11px] text-subtle">
          {r.kind === "code-bundle" ? r.backbones.map((b) => b.name).join(" + ") : r.facets.map((f) => f.facet).join(", ")}
        </div>
      </div>
      <div className="flex items-center gap-2">
        {r.kind === "code-bundle" && (
          <span className="rounded-full border border-[rgba(120,200,140,0.35)] bg-[rgba(120,200,140,0.12)] px-2.5 py-0.5 text-[10.5px] font-medium text-[#8fd6a3]">
            {Math.round(r.benchmark.accuracyWithin50m * 100)}% ≤ 50m
          </span>
        )}
        {r.isActive && (
          <span className="rounded-full border border-[rgba(133,183,235,0.35)] bg-[rgba(133,183,235,0.12)] px-2.5 py-0.5 text-[10.5px] font-medium text-[#85b7eb]">
            Activa
          </span>
        )}
      </div>
    </div>
  );
}

interface UninstallInfo {
  available: boolean;
  previousVersion: string | null;
}

export function ModelosSection({ query }: { query: string }) {
  const [items, setItems] = useState<ModelCatalogItem[]>([]);
  const [filter, setFilter] = useState<ModelFilterId>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [uninstallInfo, setUninstallInfo] = useState<UninstallInfo>({ available: false, previousVersion: null });
  const [uninstalling, setUninstalling] = useState(false);
  const [gpu, setGpu] = useState<{ freeBytes: number | null; totalBytes: number | null }>({ freeBytes: null, totalBytes: null });

  function refreshUninstallInfo(release: CatalogRelease | null) {
    const qs = release?.kind === "generic-classifier" ? `?modelId=${encodeURIComponent(release.modelId)}` : "";
    fetchJson<UninstallInfo>(`/api/model-catalog/uninstall${qs}`).then((r) => {
      if (r.data) setUninstallInfo(r.data);
    });
  }

  useEffect(() => {
    fetchJson<{ bundles: CatalogBundle[] }>("/api/model-catalog").then((r) => setItems(flattenModelBundles(r.data?.bundles ?? [])));
    fetchJson<{ gpuFreeBytes: number | null; gpuTotalBytes: number | null }>("/api/model-status").then((r) => {
      if (r.data) setGpu({ freeBytes: r.data.gpuFreeBytes, totalBytes: r.data.gpuTotalBytes });
    });
  }, []);

  const q = query.toLowerCase();
  const filtered = filterModelItems(items, filter).filter((item) => item.release.version.toLowerCase().includes(q));
  const selected = items.find((i) => i.id === selectedId) ?? null;

  useEffect(() => {
    refreshUninstallInfo(selected?.release ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  async function install(item: ModelCatalogItem) {
    const label = item.release.kind === "code-bundle" ? `v${item.release.version}` : `${item.release.modelId} v${item.release.version}`;
    setStatus(`Instalando ${label}…`);
    const { ok, data } = await fetchJson("/api/model-catalog/install", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ owner: item.owner, repo: item.repo, tag: item.release.tag }),
    });
    setStatus(ok ? `Instalada ${label}` : (data as { error?: string } | null)?.error ?? "No se pudo instalar");
    refreshUninstallInfo(item.release);
  }

  async function uninstall() {
    if (!selected) return;
    const isClassifier = selected.release.kind === "generic-classifier";
    setUninstalling(true);
    setStatus(
      uninstallInfo.previousVersion ? `Restaurando v${uninstallInfo.previousVersion}…` : "Restaurando estado original…"
    );
    const { ok, data } = await fetchJson<{ version: string | null }>("/api/model-catalog/uninstall", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(isClassifier ? { modelId: (selected.release as { modelId: string }).modelId } : {}),
    });
    setStatus(
      ok
        ? data?.version
          ? `Restaurada v${data.version}`
          : "Restaurado el estado original"
        : (data as { error?: string } | null)?.error ?? "No se pudo desinstalar"
    );
    setUninstalling(false);
    refreshUninstallInfo(selected.release);
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
          selected.release.kind === "code-bundle" ? (
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
              vram={
                gpu.totalBytes !== null && gpu.freeBytes !== null
                  ? { totalBytes: gpu.totalBytes, freeBytes: gpu.freeBytes, estimateBytes: selected.release.benchmark.vramEstimateBytes ?? null }
                  : undefined
              }
              installLabel={selected.release.isActive ? "Instalada" : "Instalar"}
              installDisabled={selected.release.isActive}
              onInstall={() => install(selected)}
              secondaryAction={
                selected.release.isActive
                  ? {
                      label: uninstalling
                        ? "Desinstalando…"
                        : uninstallInfo.previousVersion
                          ? `Desinstalar (volver a v${uninstallInfo.previousVersion})`
                          : "Desinstalar",
                      onClick: uninstall,
                      disabled: uninstalling || !uninstallInfo.available,
                    }
                  : undefined
              }
            />
          ) : (
            <CatalogDetailPanel
              title={`${selected.release.modelId} v${selected.release.version}`}
              subtitle={`github.com/${selected.owner}/${selected.repo}`}
              stats={[{ label: "Facetas", value: selected.release.facets.map((f) => f.facet).join(", ") }]}
              extra={
                <div className="mt-4 space-y-1.5">
                  {selected.release.facets.map((f) => (
                    <div key={f.facet} className="flex justify-between border-t border-white/10 py-1.5 text-xs text-muted">
                      <span>{f.facet}</span>
                      <b className="text-fg">{f.hfModelId}</b>
                    </div>
                  ))}
                </div>
              }
              vram={
                gpu.totalBytes !== null && gpu.freeBytes !== null
                  ? { totalBytes: gpu.totalBytes, freeBytes: gpu.freeBytes, estimateBytes: selected.release.benchmark.vramEstimateBytes }
                  : undefined
              }
              installLabel={selected.release.isActive ? "Instalado" : "Instalar"}
              installDisabled={selected.release.isActive}
              onInstall={() => install(selected)}
              secondaryAction={
                selected.release.isActive
                  ? {
                      label: uninstalling
                        ? "Desinstalando…"
                        : uninstallInfo.previousVersion
                          ? `Desinstalar (volver a v${uninstallInfo.previousVersion})`
                          : "Desinstalar",
                      onClick: uninstall,
                      disabled: uninstalling || !uninstallInfo.available,
                    }
                  : undefined
              }
            />
          )
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

- [ ] **Step 4: Typecheck**

Run: `cd apps/web && npx tsc --noEmit -p tsconfig.json`
Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/components/ModelosSection.tsx apps/web/app/components/CatalogDetailPanel.tsx apps/web/app/lib/catalog-types.ts
git commit -m "feat(web): kind-aware model catalog listing + VRAM bar"
```

---

### Task 14: Setup wizard — `pickDefaultRelease` kind filter

**Files:**
- Modify: `apps/web/app/setup/steps/CatalogModelsStep.tsx`
- Modify: `apps/web/app/setup/steps/CatalogModelsStep.test.tsx`

**Interfaces:**
- Modifies: `pickDefaultRelease(bundles: CatalogBundleEntry[])` — now filters to `kind === "code-bundle"` before picking.

- [ ] **Step 1: Write the failing test**

Read `apps/web/app/setup/steps/CatalogModelsStep.test.tsx` first for its exact fixture style, then add:

```tsx
it("never auto-selects a generic-classifier release, even one with a higher accuracyWithin50m-shaped number", () => {
  const bundles = [
    {
      owner: "inigo",
      repo: "lumi-model-catalog",
      releases: [
        { kind: "code-bundle" as const, tag: "lumi-preview-v1.0", version: "1.0", benchmark: { accuracyWithin50m: 0.7 } },
        { kind: "generic-classifier" as const, tag: "wanda-v1", version: "1.0", benchmark: { accuracyWithin50m: 0.99 } },
      ],
    },
  ];

  const picked = pickDefaultRelease(bundles as any);

  expect(picked?.release.tag).toBe("lumi-preview-v1.0");
});

it("returns null when only generic-classifier releases exist", () => {
  const bundles = [
    {
      owner: "inigo",
      repo: "lumi-model-catalog",
      releases: [{ kind: "generic-classifier" as const, tag: "wanda-v1", version: "1.0", benchmark: { accuracyWithin50m: 0.99 } }],
    },
  ];

  expect(pickDefaultRelease(bundles as any)).toBeNull();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run apps/web/app/setup/steps/CatalogModelsStep.test.tsx`
Expected: FAIL — `pickDefaultRelease` currently picks the `generic-classifier` release (higher `accuracyWithin50m`).

- [ ] **Step 3: Add the kind filter**

In `apps/web/app/setup/steps/CatalogModelsStep.tsx`, update `CatalogRelease`'s interface to include `kind`, and filter in `pickDefaultRelease`:

```tsx
interface CatalogRelease {
  kind: "code-bundle" | "generic-classifier";
  tag: string;
  version: string;
  benchmark: { accuracyWithin50m: number };
}
```

```tsx
export function pickDefaultRelease(
  bundles: CatalogBundleEntry[]
): { owner: string; repo: string; release: CatalogRelease } | null {
  let best: { owner: string; repo: string; release: CatalogRelease } | null = null;
  for (const bundle of bundles) {
    for (const release of bundle.releases) {
      // Setup only ever auto-installs the mandatory retrieval/verification
      // model — a generic-classifier release (Wanda/Velle) is always an
      // optional, later Ajustes → Modelos install (spec: docs/superpowers/
      // specs/2026-07-20-unified-model-catalog-design.md, "Setup wizard"),
      // regardless of what number its own benchmark shape happens to carry.
      if (release.kind !== "code-bundle") continue;
      if (!best || release.benchmark.accuracyWithin50m > best.release.benchmark.accuracyWithin50m) {
        best = { owner: bundle.owner, repo: bundle.repo, release };
      }
    }
  }
  return best;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run apps/web/app/setup/steps/CatalogModelsStep.test.tsx`
Expected: PASS (all tests, old and new)

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/setup/steps/CatalogModelsStep.tsx apps/web/app/setup/steps/CatalogModelsStep.test.tsx
git commit -m "fix(web): setup wizard never auto-selects a generic-classifier release"
```

---

### Task 15: Publish Velle v1 and Wanda v1 — manual end-to-end verification

**Files:** none (this task uses the running app; no code changes)

**Interfaces:**
- Consumes: everything above, end to end.

- [ ] **Step 1: Confirm prerequisites**

In Ajustes, confirm `GITHUB_TOKEN` and `MODEL_CATALOG_REPO` are set (Task 7's `publishGenericClassifier` 400s otherwise).

- [ ] **Step 2: Publish Wanda v1 via the real route**

Run (adjust `sampleImageBase64` to a real base64-encoded JPEG on disk):

```bash
curl -X POST http://localhost:3000/api/model-catalog/publish \
  -H "content-type: application/json" \
  -d '{
    "kind": "generic-classifier",
    "modelId": "wanda-v1",
    "version": "1.0",
    "description": "Clima, hora del día y estación.",
    "facets": [
      { "facet": "weather", "hfModelId": "prithivMLmods/Weather-Image-Classification", "strategy": "pipeline" },
      { "facet": "time_of_day", "hfModelId": "openai/clip-vit-base-patch32", "strategy": "clip-zero-shot", "prompts": ["foto tomada al amanecer", "foto tomada al mediodía", "foto tomada al atardecer", "foto tomada de noche"] },
      { "facet": "season", "hfModelId": "openai/clip-vit-base-patch32", "strategy": "clip-zero-shot", "prompts": ["foto tomada en invierno", "foto tomada en primavera", "foto tomada en verano", "foto tomada en otoño"] }
    ],
    "sampleImageBase64": "'"$(base64 -w0 /path/to/a/real/test/photo.jpg)"'"
  }'
```

Expected: `200 { "tag": "wanda-v1-v1.0" }`. Check `services/inference`'s log output during this call for `[loader]`-style messages confirming the HF checkpoints actually downloaded (first real network fetch of `prithivMLmods/Weather-Image-Classification` and `openai/clip-vit-base-patch32`).

- [ ] **Step 3: Publish Velle v1**

```bash
curl -X POST http://localhost:3000/api/model-catalog/publish \
  -H "content-type: application/json" \
  -d '{
    "kind": "generic-classifier",
    "modelId": "velle-v1",
    "version": "1.0",
    "description": "Reconocimiento de marca/modelo de vehículo.",
    "facets": [
      { "facet": "vehicle", "hfModelId": "Jordo23/vehicle-classifier", "strategy": "pipeline" }
    ],
    "sampleImageBase64": "'"$(base64 -w0 /path/to/a/real/car/photo.jpg)"'"
  }'
```

Expected: `200 { "tag": "velle-v1-v1.0" }`. If `Jordo23/vehicle-classifier` fails to load via `transformers.pipeline("image-classification", ...)` (the spec's flagged, unconfirmed risk), STOP and open systematic-debugging on that specific load failure before adjusting `load_generic_classifier` — don't guess at a fix.

- [ ] **Step 4: Install both from Ajustes → Modelos**

In the browser: Ajustes → Modelos, confirm both `wanda-v1` and `velle-v1` show up (as `generic-classifier` kind), install each, confirm the install completes instantly (no restart, no health-poll wait) and the VRAM bar renders against real `gpuFreeBytes`/`gpuTotalBytes`.

- [ ] **Step 5: Exercise the classify endpoint for real**

```bash
curl -X POST http://localhost:8000/models/wanda-v1/classify \
  -H "content-type: application/json" \
  -d '{"image_base64": "'"$(base64 -w0 /path/to/a/real/test/photo.jpg)"'"}'
```

Expected: `200` with a `groups` array containing `weather`/`time_of_day`/`season`, each with ranked `labels`. Repeat for `velle-v1` with a car photo, expecting one `vehicle` group.

- [ ] **Step 6: Confirm setup wizard still only offers Lumi Preview**

Re-run the setup wizard (or its `CatalogModelsStep` in isolation) against a catalog that now has all three release kinds published — confirm "Instalar modelo recomendado" only ever proposes the `code-bundle` release, never Wanda or Velle.

No commit for this task (no code changes) — if any step surfaces a real bug, that becomes a new, separate systematic-debugging task, not a silent tweak here.
