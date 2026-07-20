# Settings DB Reset Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the model-catalog-only reset feature with a broader "Restablecer configuración" reset living in Ajustes → Sistema: it backs up every application table to a local JSON file, restores inference code if a code-bundle was ever installed, truncates every application table, and resets the retrieval/verification settings — all behind a type-to-confirm dialog.

**Architecture:** One new library (`db-backup.ts`) for the JSON snapshot, one new route (`POST /api/settings/reset`) that sequences backup → risky code-restore → destructive truncate → settings reset (in that order, each gated on the previous step succeeding), and one new dialog component wired into `SystemPanel.tsx`. The old model-catalog-scoped reset (route, its UI block, and its now-dead `deleteAllClassificationModels` helper) is deleted as part of this work, not left behind.

**Tech Stack:** Next.js route handlers, `pg` (`Pool`), Vitest, React + `framer-motion` (existing `popIn`/`overlay` variants).

## Global Constraints

- The application-table list is a **fixed, hardcoded array** (`APPLICATION_TABLES`), never discovered via `information_schema.tables` at request time: `api_usage, areas, indexed_images, indexed_points, installed_classification_models, search_batches, search_candidates, search_regions, searches, system_settings, worker_heartbeat`. Explicitly excludes `pgmigrations` (node-pg-migrate's bookkeeping table) and PostGIS's `tiger`/`topology` schemas + `spatial_ref_sys` (static reference data, not application data).
- `confirm` must match the exact string `"RESET"` (400 otherwise) — same contract as the feature being replaced.
- Step ordering inside the route is non-negotiable: **backup (must succeed) → risky code-restore+restart (must succeed) → destructive truncate → settings reset.** Nothing irreversible runs until both prior steps have succeeded.
- `RETRIEVAL_MODEL` resets to `"lumi-preview"`, `VERIFICATION_MODEL` resets to `""` — exact defaults, matching `services/inference/settings.py`'s `DEFAULT_RETRIEVAL_MODEL`/`DEFAULT_VERIFICATION_MODEL`.
- The dialog's confirm mechanism is a text field requiring the exact word `RESET` to enable the destructive button — not a plain Cancel/Confirm pair.

---

### Task 1: `backupDatabaseToJson` — JSON snapshot of every application table

**Files:**
- Create: `apps/web/lib/settings/db-backup.ts`
- Test: `apps/web/lib/settings/db-backup.test.ts`

**Interfaces:**
- Produces: `export const APPLICATION_TABLES: readonly string[]` (the fixed 11-table list from Global Constraints, in the exact order given there) and `export async function backupDatabaseToJson(pool: Pool): Promise<string>` — queries `SELECT * FROM <table>` for each table in `APPLICATION_TABLES`, writes one JSON file to `data/db-backups/<ISO-timestamp-with-colons-and-dots-replaced-by-dashes>.json` shaped as `{ table: string; rows: Record<string, unknown>[] }[]`, creating the directory if missing, and returns the absolute path written. Task 2's route imports both `APPLICATION_TABLES` and `backupDatabaseToJson` from this file.

- [ ] **Step 1: Write the failing test**

Create `apps/web/lib/settings/db-backup.test.ts`:

```ts
// apps/web/lib/settings/db-backup.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("node:fs/promises", () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("backupDatabaseToJson", () => {
  it("writes one JSON file covering every application table", async () => {
    const { backupDatabaseToJson, APPLICATION_TABLES } = await import("./db-backup");
    const { writeFile, mkdir } = await import("node:fs/promises");

    const query = vi.fn(async (sql: string) => {
      const table = sql.match(/FROM (\w+)/)?.[1];
      return { rows: [{ id: `${table}-row-1` }] };
    });
    const pool = { query } as any;

    const path = await backupDatabaseToJson(pool);

    expect(mkdir).toHaveBeenCalledWith(expect.stringContaining("db-backups"), { recursive: true });
    expect(path).toContain("db-backups");
    expect(query).toHaveBeenCalledTimes(APPLICATION_TABLES.length);

    const written = JSON.parse((writeFile as any).mock.calls[0][1] as string);
    expect(written).toHaveLength(APPLICATION_TABLES.length);
    for (const table of APPLICATION_TABLES) {
      const entry = written.find((e: any) => e.table === table);
      expect(entry).toBeDefined();
      expect(entry.rows).toEqual([{ id: `${table}-row-1` }]);
    }
  });

  it("returns an absolute path ending in .json", async () => {
    const { backupDatabaseToJson } = await import("./db-backup");
    const pool = { query: vi.fn().mockResolvedValue({ rows: [] }) } as any;

    const path = await backupDatabaseToJson(pool);

    expect(path.endsWith(".json")).toBe(true);
    expect(path.startsWith("/")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run lib/settings/db-backup.test.ts`
Expected: FAIL — `Cannot find module './db-backup'` (file doesn't exist yet).

- [ ] **Step 3: Write minimal implementation**

Create `apps/web/lib/settings/db-backup.ts`:

```ts
// apps/web/lib/settings/db-backup.ts
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Pool } from "pg";

/** Fixed, hardcoded — deliberately not discovered via information_schema at
 * request time, which would silently start touching PostGIS's tiger/
 * topology reference tables or a future migrations-bookkeeping table.
 * Adding a new application table later means updating this array
 * explicitly (spec: docs/superpowers/specs/2026-07-20-settings-db-reset-
 * design.md). */
export const APPLICATION_TABLES = [
  "api_usage",
  "areas",
  "indexed_images",
  "indexed_points",
  "installed_classification_models",
  "search_batches",
  "search_candidates",
  "search_regions",
  "searches",
  "system_settings",
  "worker_heartbeat",
] as const;

interface TableBackup {
  table: string;
  rows: Record<string, unknown>[];
}

/** Dumps every application table to one JSON file under data/db-backups/ —
 * a safety net before a destructive reset, not a one-command restore tool.
 * Returns the absolute path written. */
export async function backupDatabaseToJson(pool: Pool): Promise<string> {
  const backup: TableBackup[] = [];
  for (const table of APPLICATION_TABLES) {
    const { rows } = await pool.query(`SELECT * FROM ${table}`);
    backup.push({ table, rows });
  }

  const dir = resolve(process.cwd(), "data", "db-backups");
  await mkdir(dir, { recursive: true });
  const path = resolve(dir, `${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  await writeFile(path, JSON.stringify(backup), "utf8");
  return path;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && npx vitest run lib/settings/db-backup.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/settings/db-backup.ts apps/web/lib/settings/db-backup.test.ts
git commit -m "feat(web): add backupDatabaseToJson safety-net snapshot for settings reset"
```

---

### Task 2: `POST /api/settings/reset` route, deleting the old model-catalog-only reset

**Files:**
- Create: `apps/web/app/api/settings/reset/route.ts`
- Test: `apps/web/app/api/settings/reset/route.test.ts`
- Delete: `apps/web/app/api/model-catalog/reset/route.ts`
- Delete: `apps/web/app/api/model-catalog/reset/route.test.ts`
- Modify: `apps/web/lib/model-catalog/classification-models.ts` (remove `deleteAllClassificationModels`)
- Modify: `apps/web/lib/model-catalog/classification-models.test.ts` (remove its test)

**Interfaces:**
- Consumes from Task 1: `backupDatabaseToJson(pool: Pool): Promise<string>` and `APPLICATION_TABLES: readonly string[]` from `../../../../lib/settings/db-backup`.
- Consumes (existing, unchanged): `restoreInferenceCode(inferenceDir, backupDir): Promise<void>` from `../../../../lib/model-catalog/backup`; `PREVIOUS_CODE_DIR`, `readUninstallMeta()`, `writeUninstallMeta(meta)`, `clearPreviousBackup()` from `../../../../lib/model-catalog/uninstall-state`; `getSettingsRepo()` from `../../../../lib/settings-repo`; `getPool()` from `../../../../lib/db`.
- Produces: `POST` handler at `apps/web/app/api/settings/reset/route.ts` accepting `{ confirm: "RESET" }`, returning `{ ok: true }` on success. Task 3's `ResetConfirmDialog.tsx` POSTs to `/api/settings/reset` with this exact body shape.

- [ ] **Step 1: Write the failing test**

Create `apps/web/app/api/settings/reset/route.test.ts`:

```ts
// apps/web/app/api/settings/reset/route.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

process.env.MODEL_CATALOG_READY_TIMEOUT_MS = "20";
process.env.MODEL_CATALOG_READY_POLL_INTERVAL_MS = "5";

vi.mock("../../../../lib/db", () => ({ getPool: vi.fn() }));
vi.mock("../../../../lib/settings/db-backup", () => ({
  backupDatabaseToJson: vi.fn().mockResolvedValue("/fake/backup.json"),
  APPLICATION_TABLES: ["areas", "system_settings"],
}));
vi.mock("../../../../lib/model-catalog/backup", () => ({ restoreInferenceCode: vi.fn() }));
vi.mock("../../../../lib/model-catalog/uninstall-state", () => ({
  PREVIOUS_CODE_DIR: "/fake/previous",
  readUninstallMeta: vi.fn(),
  writeUninstallMeta: vi.fn(),
  clearPreviousBackup: vi.fn(),
}));
vi.mock("../../../../lib/settings-repo", () => ({ getSettingsRepo: vi.fn() }));

let poolQuery: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  vi.clearAllMocks();
  poolQuery = vi.fn().mockResolvedValue({ rows: [] });
  const { getPool } = await import("../../../../lib/db");
  (getPool as any).mockReturnValue({ query: poolQuery });
  const { backupDatabaseToJson } = await import("../../../../lib/settings/db-backup");
  (backupDatabaseToJson as any).mockResolvedValue("/fake/backup.json");
});

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/settings/reset", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/settings/reset", () => {
  it("400s when confirm doesn't match exactly", async () => {
    const { POST } = await import("./route");
    const res = await POST(makeRequest({ confirm: "reset" }));
    expect(res.status).toBe(400);
  });

  it("400s when confirm is missing", async () => {
    const { POST } = await import("./route");
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
  });

  it("500s and touches nothing else when the backup fails", async () => {
    const { backupDatabaseToJson } = await import("../../../../lib/settings/db-backup");
    (backupDatabaseToJson as any).mockRejectedValue(new Error("disk full"));
    const { restoreInferenceCode } = await import("../../../../lib/model-catalog/backup");

    const { POST } = await import("./route");
    const res = await POST(makeRequest({ confirm: "RESET" }));
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.error).toContain("disk full");
    expect(restoreInferenceCode).not.toHaveBeenCalled();
    expect(poolQuery).not.toHaveBeenCalled();
  });

  it("truncates the application tables and resets settings, skipping code restore when nothing was ever installed", async () => {
    const { readUninstallMeta } = await import("../../../../lib/model-catalog/uninstall-state");
    (readUninstallMeta as any).mockResolvedValue({ currentVersion: null, previousVersion: null });

    const setSetting = vi.fn();
    const { getSettingsRepo } = await import("../../../../lib/settings-repo");
    (getSettingsRepo as any).mockReturnValue({ setSetting });

    const { restoreInferenceCode } = await import("../../../../lib/model-catalog/backup");
    const { backupDatabaseToJson } = await import("../../../../lib/settings/db-backup");

    const { POST } = await import("./route");
    const res = await POST(makeRequest({ confirm: "RESET" }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ ok: true });
    expect(backupDatabaseToJson).toHaveBeenCalledWith(expect.anything());
    expect(restoreInferenceCode).not.toHaveBeenCalled();
    expect(poolQuery).toHaveBeenCalledWith(expect.stringContaining("TRUNCATE TABLE areas, system_settings"));
    expect(setSetting).toHaveBeenCalledWith("RETRIEVAL_MODEL", "lumi-preview", false);
    expect(setSetting).toHaveBeenCalledWith("VERIFICATION_MODEL", "", false);
  });

  it("restores code and restarts inference when a backup exists", async () => {
    const { readUninstallMeta, writeUninstallMeta, clearPreviousBackup } = await import(
      "../../../../lib/model-catalog/uninstall-state"
    );
    (readUninstallMeta as any).mockResolvedValue({ currentVersion: "1.0", previousVersion: null });

    const { getSettingsRepo } = await import("../../../../lib/settings-repo");
    (getSettingsRepo as any).mockReturnValue({ setSetting: vi.fn() });

    const { restoreInferenceCode } = await import("../../../../lib/model-catalog/backup");

    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes("restart-inference")) return { ok: true } as Response;
      if (String(url).includes("/docs")) return { ok: true } as Response;
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { POST } = await import("./route");
    const res = await POST(makeRequest({ confirm: "RESET" }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ ok: true });
    expect(restoreInferenceCode).toHaveBeenCalledWith(expect.stringContaining("inference"), "/fake/previous");
    expect(writeUninstallMeta).toHaveBeenCalledWith({ currentVersion: null, previousVersion: null });
    expect(clearPreviousBackup).toHaveBeenCalled();

    vi.unstubAllGlobals();
  });

  it("502s with a clear message when the restart never becomes healthy", async () => {
    const { readUninstallMeta } = await import("../../../../lib/model-catalog/uninstall-state");
    (readUninstallMeta as any).mockResolvedValue({ currentVersion: "1.0", previousVersion: null });

    const { getSettingsRepo } = await import("../../../../lib/settings-repo");
    (getSettingsRepo as any).mockReturnValue({ setSetting: vi.fn() });

    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes("restart-inference")) return { ok: true } as Response;
      if (String(url).includes("/docs")) return { ok: false } as Response;
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { POST } = await import("./route");
    const res = await POST(makeRequest({ confirm: "RESET" }));

    expect(res.status).toBe(502);
    const json = await res.json();
    expect(json.error).toContain("no volvió a estar disponible");

    vi.unstubAllGlobals();
  });

  it("502s with a clear message when restoreInferenceCode throws", async () => {
    const { readUninstallMeta } = await import("../../../../lib/model-catalog/uninstall-state");
    (readUninstallMeta as any).mockResolvedValue({ currentVersion: "1.0", previousVersion: null });

    const { getSettingsRepo } = await import("../../../../lib/settings-repo");
    (getSettingsRepo as any).mockReturnValue({ setSetting: vi.fn() });

    const { restoreInferenceCode } = await import("../../../../lib/model-catalog/backup");
    (restoreInferenceCode as any).mockRejectedValue(new Error("backup dir missing"));

    const { POST } = await import("./route");
    const res = await POST(makeRequest({ confirm: "RESET" }));

    expect(res.status).toBe(502);
    const json = await res.json();
    expect(json.error).toContain("No se pudieron restaurar los archivos originales");
    expect(json.error).toContain("backup dir missing");
  });

  it("never truncates or resets settings when the risky restore step fails", async () => {
    const { readUninstallMeta } = await import("../../../../lib/model-catalog/uninstall-state");
    (readUninstallMeta as any).mockResolvedValue({ currentVersion: "1.0", previousVersion: null });

    const setSetting = vi.fn();
    const { getSettingsRepo } = await import("../../../../lib/settings-repo");
    (getSettingsRepo as any).mockReturnValue({ setSetting });

    const { restoreInferenceCode } = await import("../../../../lib/model-catalog/backup");
    (restoreInferenceCode as any).mockRejectedValue(new Error("backup dir missing"));

    const { POST } = await import("./route");
    const res = await POST(makeRequest({ confirm: "RESET" }));

    expect(res.status).toBe(502);
    expect(poolQuery).not.toHaveBeenCalled();
    expect(setSetting).not.toHaveBeenCalled();
  });

  it("never truncates or resets settings when the restart never becomes healthy", async () => {
    const { readUninstallMeta } = await import("../../../../lib/model-catalog/uninstall-state");
    (readUninstallMeta as any).mockResolvedValue({ currentVersion: "1.0", previousVersion: null });

    const setSetting = vi.fn();
    const { getSettingsRepo } = await import("../../../../lib/settings-repo");
    (getSettingsRepo as any).mockReturnValue({ setSetting });

    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes("restart-inference")) return { ok: true } as Response;
      if (String(url).includes("/docs")) return { ok: false } as Response;
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { POST } = await import("./route");
    const res = await POST(makeRequest({ confirm: "RESET" }));

    expect(res.status).toBe(502);
    expect(poolQuery).not.toHaveBeenCalled();
    expect(setSetting).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run app/api/settings/reset/route.test.ts`
Expected: FAIL — `Cannot find module './route'` (route doesn't exist yet).

- [ ] **Step 3: Write minimal implementation**

Create `apps/web/app/api/settings/reset/route.ts`:

```ts
// apps/web/app/api/settings/reset/route.ts
import { NextResponse } from "next/server";
import { resolve } from "node:path";
import { getPool } from "../../../../lib/db";
import { getSettingsRepo } from "../../../../lib/settings-repo";
import { backupDatabaseToJson, APPLICATION_TABLES } from "../../../../lib/settings/db-backup";
import { restoreInferenceCode } from "../../../../lib/model-catalog/backup";
import {
  PREVIOUS_CODE_DIR,
  readUninstallMeta,
  writeUninstallMeta,
  clearPreviousBackup,
} from "../../../../lib/model-catalog/uninstall-state";

// Same INFERENCE_DIR/URL/poll derivation as the feature this replaces
// (apps/web/app/api/model-catalog/uninstall/route.ts).
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

interface ResetBody {
  confirm?: string;
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as ResetBody;
  if (body.confirm !== "RESET") {
    return NextResponse.json({ error: 'confirm must be exactly "RESET"' }, { status: 400 });
  }

  const pool = getPool();

  try {
    await backupDatabaseToJson(pool);
  } catch (err) {
    return NextResponse.json(
      { error: `No se pudo generar la copia de seguridad: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 }
    );
  }

  const meta = await readUninstallMeta();
  if (meta.currentVersion !== null || meta.previousVersion !== null) {
    try {
      await restoreInferenceCode(INFERENCE_DIR, PREVIOUS_CODE_DIR);

      const origin = new URL(request.url).origin;
      const restartRes = await fetch(`${origin}/api/setup/run/restart-inference`, { method: "POST" });
      void restartRes; // SSE stream — we just wait for real readiness below.
    } catch (err) {
      return NextResponse.json(
        { error: `No se pudieron restaurar los archivos originales: ${err instanceof Error ? err.message : String(err)}` },
        { status: 502 }
      );
    }

    const ready = await waitForInferenceReady();
    if (!ready) {
      return NextResponse.json(
        { error: "Se restauraron los archivos originales, pero el servicio de inferencia no volvió a estar disponible" },
        { status: 502 }
      );
    }

    await writeUninstallMeta({ currentVersion: null, previousVersion: null });
    await clearPreviousBackup();
  }

  await pool.query(`TRUNCATE TABLE ${APPLICATION_TABLES.join(", ")} RESTART IDENTITY CASCADE`);

  const repo = getSettingsRepo();
  await repo.setSetting("RETRIEVAL_MODEL", "lumi-preview", false);
  await repo.setSetting("VERIFICATION_MODEL", "", false);

  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && npx vitest run app/api/settings/reset/route.test.ts`
Expected: PASS (9 tests)

- [ ] **Step 5: Delete the old model-catalog-only reset**

```bash
rm apps/web/app/api/model-catalog/reset/route.ts
rm apps/web/app/api/model-catalog/reset/route.test.ts
```

- [ ] **Step 6: Remove `deleteAllClassificationModels`, now unused**

In `apps/web/lib/model-catalog/classification-models.ts`, delete lines 92-98 (the `deleteAllClassificationModels` function and its preceding doc comment):

```ts
/** Wipes every installed-classifier row, active or not — used by the
 * catalog "reset" action (spec: returns to a clean slate for testing/
 * demos, not a normal uninstall). Deletes rather than deactivates: a
 * reset should leave zero history, not one more deactivated row per
 * model. */
export async function deleteAllClassificationModels(pool: Pool): Promise<void> {
  await pool.query("DELETE FROM installed_classification_models");
}
```

In `apps/web/lib/model-catalog/classification-models.test.ts`:
- Remove `deleteAllClassificationModels` from the import list (line 8).
- Delete the trailing `describe("deleteAllClassificationModels", ...)` block (lines 113-119):

```ts
describe("deleteAllClassificationModels", () => {
  it("deletes every row, regardless of model_id or active state", async () => {
    const pool = { query: vi.fn(async () => ({ rows: [] })) } as any;
    await deleteAllClassificationModels(pool);
    expect(pool.query).toHaveBeenCalledWith("DELETE FROM installed_classification_models");
  });
});
```

- [ ] **Step 7: Run the full affected suite to confirm nothing broke**

Run: `cd apps/web && npx vitest run app/api/settings/reset/route.test.ts lib/model-catalog/classification-models.test.ts lib/settings/db-backup.test.ts`
Expected: PASS, all tests — and no leftover reference to the deleted route/function (`grep -rn "deleteAllClassificationModels\|model-catalog/reset" apps/web --include="*.ts" --include="*.tsx"` returns nothing).

- [ ] **Step 8: Commit**

```bash
git add apps/web/app/api/settings/reset/route.ts apps/web/app/api/settings/reset/route.test.ts \
  apps/web/lib/model-catalog/classification-models.ts apps/web/lib/model-catalog/classification-models.test.ts
git rm apps/web/app/api/model-catalog/reset/route.ts apps/web/app/api/model-catalog/reset/route.test.ts
git commit -m "feat(web): add POST /api/settings/reset, replacing the model-catalog-only reset"
```

---

### Task 3: `ResetConfirmDialog` + `SystemPanel` wiring, removing the old danger-zone UI

**Files:**
- Create: `apps/web/app/components/ResetConfirmDialog.tsx`
- Modify: `apps/web/app/components/SystemPanel.tsx`
- Modify: `apps/web/app/components/ModelosSection.tsx`

**Interfaces:**
- Consumes from Task 2: `POST /api/settings/reset` with body `{ confirm: "RESET" }`, returning `{ ok: true }` or `{ error: string }`.
- Consumes (existing): `fetchJson` from `../lib/fetch-json`; `popIn`, `overlay` variants from `../lib/motion`; `ModelLoadNotification` from `./ModelLoadNotification`; `FloatingCard` from `./FloatingCard`.
- Produces: `ResetConfirmDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void })` — `SystemPanel.tsx` renders it conditionally and uses `onDone` to show a status line.

This is a UI-only task with no automated test file — matches this codebase's existing convention (`OverwriteKeyModal.tsx`, `SystemPanel.tsx`, and `ModelosSection.tsx` all have no test files today); verify by running the dev server and clicking through the flow manually (Step 4 below).

- [ ] **Step 1: Create the dialog**

Create `apps/web/app/components/ResetConfirmDialog.tsx`:

```tsx
// apps/web/app/components/ResetConfirmDialog.tsx
"use client";
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { fetchJson } from "../lib/fetch-json";
import { popIn, overlay } from "../lib/motion";
import { ModelLoadNotification } from "./ModelLoadNotification";

export function ResetConfirmDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [confirmText, setConfirmText] = useState("");
  const [resetting, setResetting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !resetting) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, resetting]);

  async function reset() {
    setResetting(true);
    setError(null);
    const { ok, data } = await fetchJson<{ error?: string }>("/api/settings/reset", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ confirm: "RESET" }),
    });
    setResetting(false);
    if (!ok) {
      setError((data as { error?: string } | null)?.error ?? "No se pudo restablecer la configuración");
      return;
    }
    onDone();
    onClose();
  }

  return (
    <>
      <motion.div
        variants={overlay}
        initial="hidden"
        animate="show"
        exit="exit"
        onClick={() => !resetting && onClose()}
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      >
        <motion.div
          variants={popIn}
          initial="hidden"
          animate="show"
          exit="exit"
          onClick={(e) => e.stopPropagation()}
          className="w-[340px] rounded-[14px] border border-white/12 bg-elevated p-[18px] shadow-2xl shadow-black/50"
        >
          <div className="mb-1 flex items-center justify-between">
            <span className="text-sm font-medium text-fg">Restablecer configuración</span>
            <button
              onClick={onClose}
              disabled={resetting}
              aria-label="Cerrar"
              className="text-subtle hover:text-fg disabled:opacity-50"
            >
              ✕
            </button>
          </div>
          <p className="mb-3.5 text-xs leading-relaxed text-muted">
            Esto borra todos los datos de la aplicación (áreas, imágenes, modelos instalados, ajustes) y restaura
            los modelos originales. Se guarda una copia de seguridad local antes de borrar, pero esta acción no se
            puede deshacer desde la interfaz.
          </p>
          <label className="mb-1.5 block text-xs text-muted">Escribe RESET para confirmar</label>
          <input
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            disabled={resetting}
            placeholder="RESET"
            className="mb-2 h-[38px] w-full rounded-lg border border-white/25 bg-white/5 px-3 font-mono text-sm text-fg outline-none disabled:opacity-50"
          />
          {error && <p className="mb-2 text-xs text-danger-fg">{error}</p>}
          <div className="flex justify-end gap-2">
            <button
              onClick={onClose}
              disabled={resetting}
              className="rounded-lg border border-white/15 px-3.5 py-2 text-xs text-muted hover:text-fg disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              onClick={reset}
              disabled={confirmText !== "RESET" || resetting}
              className="rounded-lg border border-[rgba(163,51,51,0.5)] bg-[rgba(163,51,51,0.15)] px-4 py-2 text-xs font-medium text-danger-fg hover:bg-[rgba(163,51,51,0.25)] disabled:opacity-50"
            >
              {resetting ? "Restableciendo…" : "Restablecer"}
            </button>
          </div>
        </motion.div>
      </motion.div>
      <ModelLoadNotification active={resetting} fallbackLabel="Restableciendo configuración…" />
    </>
  );
}
```

- [ ] **Step 2: Wire it into `SystemPanel.tsx`**

Replace the full contents of `apps/web/app/components/SystemPanel.tsx`:

```tsx
// apps/web/app/components/SystemPanel.tsx
"use client";
import { useState } from "react";
import { FloatingCard } from "./FloatingCard";
import { ResetConfirmDialog } from "./ResetConfirmDialog";

export function SystemPanel() {
  const [resetOpen, setResetOpen] = useState(false);
  const [resetStatus, setResetStatus] = useState<string | null>(null);

  return (
    <div className="space-y-4">
      <FloatingCard className="flex items-center justify-between p-5">
        <div>
          <div className="text-sm font-medium text-fg">Volver a ejecutar el setup</div>
          <p className="mt-1 text-xs text-muted">
            Reinstala dependencias, migra la base de datos o cambia credenciales paso a paso.
          </p>
        </div>
        <a href="/setup" className="rounded-md border border-white/15 px-4 py-2 text-xs text-fg hover:bg-white/10">
          Abrir setup
        </a>
      </FloatingCard>

      <FloatingCard className="flex items-center justify-between border-[rgba(163,51,51,0.35)] bg-[rgba(163,51,51,0.04)] p-5">
        <div>
          <div className="text-sm font-medium text-danger-fg">Restablecer configuración</div>
          <p className="mt-1 text-xs text-muted">
            Borra todos los datos de la aplicación y restaura los modelos originales. Se guarda una copia de
            seguridad local antes de borrar. No se puede deshacer.
          </p>
          {resetStatus && <p className="mt-1 text-xs text-muted">{resetStatus}</p>}
        </div>
        <button
          onClick={() => setResetOpen(true)}
          className="rounded-md border border-[rgba(163,51,51,0.5)] bg-[rgba(163,51,51,0.15)] px-4 py-2 text-xs font-medium text-danger-fg hover:bg-[rgba(163,51,51,0.25)]"
        >
          Restablecer…
        </button>
      </FloatingCard>

      {resetOpen && (
        <ResetConfirmDialog
          onClose={() => setResetOpen(false)}
          onDone={() => setResetStatus("Configuración restablecida")}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 3: Remove the old danger-zone block from `ModelosSection.tsx`**

In `apps/web/app/components/ModelosSection.tsx`:

Remove the `resetConfirmText`/`resetting` state (currently lines 53-54):

```tsx
  const [resetConfirmText, setResetConfirmText] = useState("");
  const [resetting, setResetting] = useState(false);
```

Remove the `resetCatalog` function (currently lines 116-131):

```tsx
  async function resetCatalog() {
    setResetting(true);
    setStatus("Restableciendo catálogo de modelos…");
    const { ok, data } = await fetchJson<{ error?: string }>("/api/model-catalog/reset", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ confirm: "RESET" }),
    });
    setStatus(ok ? "Catálogo restablecido" : (data as { error?: string } | null)?.error ?? "No se pudo restablecer el catálogo");
    setResetting(false);
    setResetConfirmText("");
    if (ok) {
      fetchJson<{ bundles: CatalogBundle[] }>("/api/model-catalog").then((r) => setItems(flattenModelBundles(r.data?.bundles ?? [])));
      setSelectedId(null);
    }
  }
```

Replace the closing return block (currently lines 133-324, from the `return (` through the final `}` of the component) with:

```tsx
  return (
    <div className="flex h-full overflow-hidden">
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
              stats={
                selected.release.benchmark.benchmarkPending
                  ? [{ label: "Benchmarks", value: "Saldrán pronto" }]
                  : [
                      { label: "Precisión (≤50m)", value: `${Math.round(selected.release.benchmark.accuracyWithin50m * 100)}%` },
                      { label: "Distancia media", value: `${selected.release.benchmark.avgDistanceM.toFixed(1)}m` },
                      { label: "Casos evaluados", value: String(selected.release.benchmark.sampleCount) },
                    ]
              }
              extra={
                <div className="mt-4 space-y-1.5">
                  {selected.release.benchmark.benchmarkPending && (
                    <div className="rounded-md border border-dashed border-white/20 bg-white/[.03] px-3 py-2 text-xs text-muted">
                      No se pudo correr el benchmark de precisión en esta máquina ahora mismo (probablemente por falta de
                      VRAM libre) — los benchmarks saldrán pronto.
                    </div>
                  )}
                  {selected.release.backbones.map((b) => (
                    <div key={b.name} className="flex justify-between border-t border-white/10 py-1.5 text-xs text-muted">
                      <span>{b.name}</span>
                      <b className="text-fg">{b.source}</b>
                    </div>
                  ))}
                  {selected.release.benchmark.vramEstimate && (
                    <>
                      <div className="flex justify-between border-t border-white/10 py-1.5 text-xs text-muted">
                        <span>VRAM retrieval</span>
                        <b className="text-fg">
                          {selected.release.benchmark.vramEstimate.retrievalBytes !== null
                            ? `~${(selected.release.benchmark.vramEstimate.retrievalBytes / 1024 ** 3).toFixed(1)} GB`
                            : "—"}
                        </b>
                      </div>
                      <div className="flex justify-between border-t border-white/10 py-1.5 text-xs text-muted">
                        <span>VRAM verificación</span>
                        <b className="text-fg">
                          {selected.release.benchmark.vramEstimate.verificationBytes !== null
                            ? `~${(selected.release.benchmark.vramEstimate.verificationBytes / 1024 ** 3).toFixed(1)} GB`
                            : "—"}
                        </b>
                      </div>
                    </>
                  )}
                </div>
              }
              vram={
                gpu.totalBytes !== null && gpu.freeBytes !== null
                  ? {
                      totalBytes: gpu.totalBytes,
                      freeBytes: gpu.freeBytes,
                      estimateBytes: Math.max(
                        selected.release.benchmark.vramEstimate?.retrievalBytes ?? 0,
                        selected.release.benchmark.vramEstimate?.verificationBytes ?? 0
                      ) || null,
                    }
                  : undefined
              }
              installLabel={
                selected.release.isActive
                  ? uninstallInfo.available
                    ? "Instalada"
                    : "Reinstalar (crear respaldo)"
                  : "Instalar"
              }
              installDisabled={selected.release.isActive && uninstallInfo.available}
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
      <ModelLoadNotification
        active={installing || uninstalling}
        fallbackLabel={installing ? "Instalando modelo…" : "Desinstalando modelo…"}
      />
    </div>
  );
}
```

Note: this component no longer imports `fetchJson`'s `CatalogBundle`/`flattenModelBundles` any differently than before — those imports (line 5) are still used by `install`/`uninstall` and stay unchanged. Only the reset-specific state, function, and JSX are removed.

- [ ] **Step 4: Manually verify in the browser**

Run: `cd apps/web && npm run dev` (or the app's existing dev script), then:
1. Open Ajustes → Sistema. Confirm the new red "Restablecer configuración" card appears below "Volver a ejecutar el setup".
2. Click "Restablecer…" — confirm the dialog opens, Escape closes it, clicking the backdrop closes it, and the confirm button stays disabled until the input contains exactly `RESET`.
3. Open Tienda → Modelos — confirm the old red danger-zone block at the bottom is gone, and install/uninstall still work as before.
4. (Optional, only if you have a disposable dev database) Type `RESET` and confirm — verify a new file appears under `data/db-backups/`, the app's data is cleared, and `RETRIEVAL_MODEL`/`VERIFICATION_MODEL` are back to defaults.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/components/ResetConfirmDialog.tsx apps/web/app/components/SystemPanel.tsx apps/web/app/components/ModelosSection.tsx
git commit -m "feat(web): move destructive reset to Ajustes as a full DB reset with confirm dialog"
```
