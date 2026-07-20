# Model catalog reset Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A destructive "reset" action (Ajustes → Modelos only) that wipes all installed-classifier history, restores `services/inference`'s code to pre-catalog-install state if a backup exists, and resets the retrieval/verification settings to their defaults — for returning to a clean slate before a demo or test run.

**Architecture:** A new `POST /api/model-catalog/reset` route requires an exact `{ confirm: "RESET" }` body, deletes all `installed_classification_models` rows, reuses the exact restore+restart+health-poll sequence already in `uninstall/route.ts` when a code-bundle backup exists, then resets `RETRIEVAL_MODEL`/`VERIFICATION_MODEL` to their defaults. The UI gate is a type-to-confirm text field in `ModelosSection.tsx`.

**Tech Stack:** Next.js App Router route handlers, `pg`, existing `ModelLoadNotification` component.

## Global Constraints

- The route requires `{ confirm: "RESET" }` (exact string match) in the POST body — a missing or wrong value is a `400`, never a silent no-op or a soft warning (spec: this is a destructive action, must not fire from a stray/malformed request).
- `installed_classification_models` rows are `DELETE`d, not deactivated — a real clean slate, not more history rows.
- If a code-bundle backup exists (`readUninstallMeta().currentVersion !== null || previousVersion !== null`) and the restore/restart fails, the route returns a `502` with a clear message — it must never silently continue as if the whole reset succeeded.
- `RETRIEVAL_MODEL` resets to `"lumi-preview"`, `VERIFICATION_MODEL` resets to `""` — matching `services/inference/settings.py`'s `DEFAULT_RETRIEVAL_MODEL`/`DEFAULT_VERIFICATION_MODEL` exactly.
- The UI button stays disabled until the user has typed `RESET` verbatim into a confirmation field — this is UX friction, not a substitute for the backend's own `confirm` check.

---

### Task 1: `DELETE`-all helper for `installed_classification_models`

**Files:**
- Modify: `apps/web/lib/model-catalog/classification-models.ts`
- Modify: `apps/web/lib/model-catalog/classification-models.test.ts`

**Interfaces:**
- Produces: `export async function deleteAllClassificationModels(pool: Pool): Promise<void>`

- [ ] **Step 1: Write the failing test**

Add to `apps/web/lib/model-catalog/classification-models.test.ts`:

```ts
describe("deleteAllClassificationModels", () => {
  it("deletes every row, regardless of model_id or active state", async () => {
    const pool = { query: vi.fn(async () => ({ rows: [] })) } as any;
    await deleteAllClassificationModels(pool);
    expect(pool.query).toHaveBeenCalledWith("DELETE FROM installed_classification_models");
  });
});
```

Add `deleteAllClassificationModels` to the existing `import { ... } from "./classification-models"` line at the top of the test file.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run apps/web/lib/model-catalog/classification-models.test.ts`
Expected: FAIL — `deleteAllClassificationModels` is not exported yet.

- [ ] **Step 3: Implement it**

Add to `apps/web/lib/model-catalog/classification-models.ts` (after `listActiveClassificationModels`):

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

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run apps/web/lib/model-catalog/classification-models.test.ts`
Expected: PASS (all tests, old and new)

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/model-catalog/classification-models.ts apps/web/lib/model-catalog/classification-models.test.ts
git commit -m "feat(web): add deleteAllClassificationModels for the catalog reset action"
```

---

### Task 2: `POST /api/model-catalog/reset` route

**Files:**
- Create: `apps/web/app/api/model-catalog/reset/route.ts`
- Create: `apps/web/app/api/model-catalog/reset/route.test.ts`

**Interfaces:**
- Consumes: `deleteAllClassificationModels(pool)` (Task 1), `readUninstallMeta()`/`writeUninstallMeta()`/`clearPreviousBackup()`/`PREVIOUS_CODE_DIR` (existing, `apps/web/lib/model-catalog/uninstall-state.ts`), `restoreInferenceCode(inferenceDir, backupDir)` (existing, `apps/web/lib/model-catalog/backup.ts`), `getPool()`, `getSettingsRepo()`
- Produces: `POST` — `200 { ok: true }`, `400` on a missing/wrong `confirm`, `502` if the code restore/restart fails

- [ ] **Step 1: Write the failing tests**

Create `apps/web/app/api/model-catalog/reset/route.test.ts`:

```ts
// apps/web/app/api/model-catalog/reset/route.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

process.env.MODEL_CATALOG_READY_TIMEOUT_MS = "20";
process.env.MODEL_CATALOG_READY_POLL_INTERVAL_MS = "5";

vi.mock("../../../../lib/db", () => ({ getPool: vi.fn(() => ({})) }));
vi.mock("../../../../lib/model-catalog/classification-models", () => ({ deleteAllClassificationModels: vi.fn() }));
vi.mock("../../../../lib/model-catalog/backup", () => ({ restoreInferenceCode: vi.fn() }));
vi.mock("../../../../lib/model-catalog/uninstall-state", () => ({
  PREVIOUS_CODE_DIR: "/fake/previous",
  readUninstallMeta: vi.fn(),
  writeUninstallMeta: vi.fn(),
  clearPreviousBackup: vi.fn(),
}));
vi.mock("../../../../lib/settings-repo", () => ({ getSettingsRepo: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
});

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/model-catalog/reset", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/model-catalog/reset", () => {
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

  it("deletes classifier rows and resets settings, skipping code restore when nothing was ever installed", async () => {
    const { readUninstallMeta } = await import("../../../../lib/model-catalog/uninstall-state");
    (readUninstallMeta as any).mockResolvedValue({ currentVersion: null, previousVersion: null });

    const setSetting = vi.fn();
    const { getSettingsRepo } = await import("../../../../lib/settings-repo");
    (getSettingsRepo as any).mockReturnValue({ setSetting });

    const { deleteAllClassificationModels } = await import("../../../../lib/model-catalog/classification-models");
    const { restoreInferenceCode } = await import("../../../../lib/model-catalog/backup");

    const { POST } = await import("./route");
    const res = await POST(makeRequest({ confirm: "RESET" }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ ok: true });
    expect(deleteAllClassificationModels).toHaveBeenCalledWith(expect.anything());
    expect(restoreInferenceCode).not.toHaveBeenCalled();
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
      if (String(url).includes("/docs")) return { ok: false } as Response; // never healthy
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
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run apps/web/app/api/model-catalog/reset/route.test.ts`
Expected: FAIL — `./route` doesn't exist yet.

- [ ] **Step 3: Write the route**

Create `apps/web/app/api/model-catalog/reset/route.ts`:

```ts
// apps/web/app/api/model-catalog/reset/route.ts
import { NextResponse } from "next/server";
import { resolve } from "node:path";
import { getPool } from "../../../../lib/db";
import { getSettingsRepo } from "../../../../lib/settings-repo";
import { deleteAllClassificationModels } from "../../../../lib/model-catalog/classification-models";
import { restoreInferenceCode } from "../../../../lib/model-catalog/backup";
import { PREVIOUS_CODE_DIR, readUninstallMeta, writeUninstallMeta, clearPreviousBackup } from "../../../../lib/model-catalog/uninstall-state";

// Same INFERENCE_DIR/URL/poll derivation as uninstall/route.ts.
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
  await deleteAllClassificationModels(pool);

  const meta = await readUninstallMeta();
  if (meta.currentVersion !== null || meta.previousVersion !== null) {
    await restoreInferenceCode(INFERENCE_DIR, PREVIOUS_CODE_DIR);

    const origin = new URL(request.url).origin;
    const restartRes = await fetch(`${origin}/api/setup/run/restart-inference`, { method: "POST" });
    void restartRes; // SSE stream — we just wait for real readiness below.

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

  const repo = getSettingsRepo();
  await repo.setSetting("RETRIEVAL_MODEL", "lumi-preview", false);
  await repo.setSetting("VERIFICATION_MODEL", "", false);

  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run apps/web/app/api/model-catalog/reset/route.test.ts`
Expected: PASS (all 5 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/api/model-catalog/reset/route.ts apps/web/app/api/model-catalog/reset/route.test.ts
git commit -m "feat(web): add POST /api/model-catalog/reset"
```

---

### Task 3: Destructive-action UI in `ModelosSection.tsx`

**Files:**
- Modify: `apps/web/app/components/ModelosSection.tsx`

**Interfaces:**
- Consumes: `POST /api/model-catalog/reset` (Task 2), `ModelLoadNotification` (already imported in this file)

No automated test for this step — this repo has no component-render test infra (established convention, see the unified-model-catalog plan's Task 13 constraint) and `ModelosSection.tsx` has never had one. Verified manually in Step 3.

- [ ] **Step 1: Add reset state and handler**

Read the current `apps/web/app/components/ModelosSection.tsx` in full first (it's changed several times this session — kind-aware listing, VRAM bar, `benchmarkPending`, the reinstall-to-create-backup fix — confirm the exact current shape of the `export function ModelosSection` component body before editing, since this step adds new state/JSX to it rather than replacing the file).

Add two new state variables alongside the existing ones (`uninstallInfo`, `uninstalling`, `installing`, `gpu`):

```tsx
const [resetConfirmText, setResetConfirmText] = useState("");
const [resetting, setResetting] = useState(false);
```

Add a handler function alongside `install`/`uninstall`:

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

- [ ] **Step 2: Add the destructive-action block to the render output**

Add this block right after the closing `</div>` of the `<div className="flex w-[45%] flex-col">...</div>` panel (i.e., as a sibling of that div, still inside the top-level `<div className="flex h-full">`, so it renders as its own row below the list/detail split — check the exact current JSX structure first since it may have shifted; insert immediately before the `<ModelLoadNotification .../>` line added in the earlier "wire notification into install/uninstall" work):

```tsx
      <div className="w-full border-t border-white/10 bg-[rgba(163,51,51,0.04)] px-5 py-4">
        <div className="mb-1 text-xs font-medium text-danger-fg">Restablecer catálogo de modelos</div>
        <p className="mb-2 text-[11px] text-muted">
          Borra todo lo instalado (clasificadores y, si aplica, restaura el código de retrieval/verificación a su
          estado original) y reinicia el servicio de inferencia. Pensado para volver a un estado limpio antes de una
          demo o prueba — no se puede deshacer.
        </p>
        <div className="flex items-center gap-2">
          <input
            value={resetConfirmText}
            onChange={(e) => setResetConfirmText(e.target.value)}
            placeholder='Escribe "RESET" para confirmar'
            className="w-56 rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-fg outline-none focus:border-white/25"
          />
          <button
            onClick={resetCatalog}
            disabled={resetConfirmText !== "RESET" || resetting}
            className="rounded-md border border-[rgba(163,51,51,0.5)] bg-[rgba(163,51,51,0.15)] px-3 py-1.5 text-xs font-medium text-danger-fg hover:bg-[rgba(163,51,51,0.25)] disabled:opacity-40"
          >
            {resetting ? "Restableciendo…" : "Restablecer catálogo de modelos"}
          </button>
        </div>
      </div>
```

Update the `ModelLoadNotification` line to also cover this new in-flight state:

```tsx
      <ModelLoadNotification
        active={installing || uninstalling || resetting}
        fallbackLabel={installing ? "Instalando modelo…" : uninstalling ? "Desinstalando modelo…" : "Restableciendo catálogo…"}
      />
```

- [ ] **Step 3: Typecheck and manually verify**

Run: `cd apps/web && npx tsc --noEmit -p tsconfig.json`
Expected: no new errors.

Manually, in a running dev server: open Ajustes → Modelos, confirm the red block renders below the list/detail split, confirm the button stays disabled until you type `RESET` exactly (case-sensitive, no partial match), click it with something installed, confirm the list refreshes empty/reset afterward and the notification toast appeared during the call.

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/components/ModelosSection.tsx
git commit -m "feat(web): add type-to-confirm model-catalog reset UI"
```
