# Catalog-Driven Verification Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the hardcoded "laila" verification model from the product (shared-types + the Python inference service), and make the setup wizard install both retrieval and verification models by calling the existing model-catalog marketplace (`/api/model-catalog/install`/`uninstall`) instead of running `download_weights.py` directly — so every model the wizard installs can also be cleanly uninstalled.

**Architecture:** The repo's checked-in `services/inference` code stops declaring a default verification model at all — a fresh clone has retrieval (MegaLoc, unchanged) but zero verification models until the operator installs a catalog release that provides one. The existing model-catalog install/uninstall pipeline (GitHub release → decrypt manifest → swap `.py` files → restart inference service) already replaces the entire `services/inference` code tree on install, so once its manifest also declares which verification model id the release provides, installing a release is enough to activate verification — no separate "verification install" mechanism is needed. The setup wizard's fixed "download these 2 weight sets" checklist is replaced by a step that lists whatever the marketplace currently offers and installs the chosen release through that same pipeline.

**Tech Stack:** Next.js API routes (TypeScript), FastAPI inference service (Python), Vitest, pytest.

## Global Constraints

- Never hardcode a verification model id/name in `services/inference` or `packages/shared-types` — the only valid verification model ids are whatever a currently-installed catalog release's manifest declares.
- The retrieval model (`lumi-preview`/MegaLoc) is explicitly OUT OF SCOPE for this plan — it stays exactly as it is today (still statically defined, still eagerly loaded). Only verification-model handling and the setup wizard's install mechanism change.
- A fresh clone with no catalog release ever installed MUST start up cleanly with retrieval working and verification cleanly reporting "not configured" (HTTP 503, not a crash) — never let a missing/empty `VERIFICATION_MODEL` setting throw an unhandled exception anywhere in `services/inference`.
- All existing model-catalog security/integrity behavior (encrypted manifest, GitHub release signature via shared key, `isManagedInferenceFile` `.py`/`requirements.txt`-only file-type scope) is unchanged — this plan only adds fields to the manifest and callers of the existing install/uninstall routes, never touches that scope-enforcement logic.
- Every touched file's existing tests must still pass; every new piece of behavior gets a test in the same commit.
- Spanish user-facing copy, matching existing tone (see `ModelsStep.tsx`, `ModelosSection.tsx` for reference phrasing).

---

## File Structure

**Modified:**
- `packages/shared-types/src/models.ts` — empty `VERIFICATION_MODELS` (no "laila" seed entry); keep the type.
- `packages/shared-types/src/model-bundles.ts` — `verificationModelId` becomes optional on `ModelBundleDefinition`; drop it from the `lumi-preview` bundle entry.
- `packages/shared-types/src/settings.ts` — `VERIFICATION_MODEL` becomes `type: "string"`, `required: false`, `defaultValue: ""` (no longer a fixed enum against a static list, since valid ids are now catalog-defined at runtime).
- `services/inference/models/registry.py` — `VERIFICATION_MODELS = []`.
- `services/inference/settings.py` — `DEFAULT_VERIFICATION_MODEL = ""`.
- `services/inference/main.py` — `get_verification_model()` treats an empty `verification_model_id` the same as a missing one (clean 503, not an unhandled `UnknownModelError`).
- `services/inference/loader.py` — keep the RoMa-based `load_verification_model` implementation (it's real, working code a catalog release can still provide), but stop special-casing the literal id `"laila"`; the id it responds to comes from the registry entry itself.
- `apps/web/lib/model-catalog/manifest.ts` — add optional `verificationModelId?: string` to `ModelCatalogManifest` + validator.
- `apps/web/app/api/model-catalog/publish/route.ts` — read the live `VERIFICATION_MODEL`/`RETRIEVAL_MODEL` settings (not static shared-types constants) when building the manifest.
- `apps/web/app/api/model-catalog/route.ts` — `isActive` compares against the persisted install state (`readUninstallMeta().currentVersion`) instead of the static `RETRIEVAL_MODELS[0]?.version`.
- `apps/web/app/api/model-catalog/install/route.ts` — on success, also write the `RETRIEVAL_MODEL`/`VERIFICATION_MODEL` settings from the manifest.
- `apps/web/app/setup/steps/ModelsStep.tsx` → replaced by a new dynamic step (see below).
- `apps/web/app/api/setup/run/[step]/route.ts` — remove the `weights-retrieval(-wsl)`/`weights-verification(-wsl)` entries and the `download_weights.py`-specific env/cache helpers now unused by them.
- `services/inference/download_weights.py` — deleted (nothing invokes it once the wizard step above is removed).

**Created:**
- `apps/web/app/setup/steps/CatalogModelsStep.tsx` — dynamic step: fetches `/api/model-catalog`, lists releases, installs the chosen one via `/api/model-catalog/install`, reports done once the active release matches what setup needs.
- `apps/web/lib/model-catalog/manifest.test.ts` additions (same file, new cases) for the new field.

---

### Task 1: Loosen `VERIFICATION_MODEL` settings validation and empty the static model list

**Files:**
- Modify: `packages/shared-types/src/models.ts`
- Modify: `packages/shared-types/src/model-bundles.ts`
- Modify: `packages/shared-types/src/settings.ts:112-119`
- Test: `packages/shared-types/src/models.test.ts`
- Test: `packages/shared-types/src/model-bundles.test.ts`
- Test: `packages/shared-types/src/settings.test.ts`

**Interfaces:**
- Produces: `VERIFICATION_MODELS: VerificationModelDefinition[]` now `[]`; `ModelBundleDefinition.verificationModelId` now `string | undefined`; `VERIFICATION_MODEL` setting definition now `{ type: "string", required: false, defaultValue: "" }` (no `options`).

- [ ] **Step 1: Update the failing/changed tests first**

In `packages/shared-types/src/models.test.ts`, replace any assertion that `VERIFICATION_MODELS` contains a `"laila"` entry with:

```ts
it("ships with no hardcoded verification models — those are catalog-installed", () => {
  expect(VERIFICATION_MODELS).toEqual([]);
});
```

In `packages/shared-types/src/model-bundles.test.ts`, update the `lumi-preview` bundle assertion to not expect `verificationModelId`:

```ts
it("lumi-preview bundle has no fixed verification pairing", () => {
  const bundle = MODEL_BUNDLES.find((b) => b.id === "lumi-preview")!;
  expect(bundle.verificationModelId).toBeUndefined();
});
```

In `packages/shared-types/src/settings.test.ts`, replace the `VERIFICATION_MODEL` case with:

```ts
it("accepts an empty VERIFICATION_MODEL (no verification model installed yet)", () => {
  expect(() => validateSettingValue("VERIFICATION_MODEL", "")).not.toThrow();
});

it("accepts any non-empty VERIFICATION_MODEL id (catalog-defined, not a fixed enum)", () => {
  expect(() => validateSettingValue("VERIFICATION_MODEL", "whatever-a-release-calls-it")).not.toThrow();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/shared-types && npx vitest run src/models.test.ts src/model-bundles.test.ts src/settings.test.ts`
Expected: FAIL — `VERIFICATION_MODELS` still contains `laila`, bundle still has `verificationModelId: "laila"`, and passing a non-listed string to `VERIFICATION_MODEL` still throws `"must be one of: laila"`.

- [ ] **Step 3: Implement**

`packages/shared-types/src/models.ts` — replace:

```ts
export const VERIFICATION_MODELS: VerificationModelDefinition[] = [
  {
    id: "laila",
    displayName: "Laila",
    baseModel: "RoMa (frozen)",
    status: "stable",
  },
];
```

with:

```ts
// Ships empty on purpose — verification models are installed from the
// model-catalog marketplace at runtime (apps/web/app/api/model-catalog),
// never hardcoded here. A fresh clone has retrieval only, until an
// operator installs a release that provides verification.
export const VERIFICATION_MODELS: VerificationModelDefinition[] = [];
```

`packages/shared-types/src/model-bundles.ts` — make the field optional and drop it from the seed entry:

```ts
export interface ModelBundleDefinition {
  id: string;
  displayName: string;
  retrievalModelId: string;
  verificationModelId?: string;
  version: string;
  status: "preview" | "stable" | "deprecated";
}

export const MODEL_BUNDLES: ModelBundleDefinition[] = [
  {
    id: "lumi-preview",
    displayName: "Lumi Preview",
    retrievalModelId: "lumi-preview",
    version: "1.0",
    status: "preview",
  },
];
```

Also update `resolveModelBundle`'s doc comment (it still resolves by retrieval id only now — verification is no longer part of the pairing):

```ts
/** Which bundle (if any) the current retrieval setting corresponds to —
 * used by the Settings UI to render the right selection. Verification is
 * no longer part of this pairing (it's independently catalog-installed),
 * so this only matches on retrievalModelId now. */
export function resolveModelBundle(retrievalModelId: string): ModelBundleDefinition | null {
  return MODEL_BUNDLES.find((b) => b.retrievalModelId === retrievalModelId) ?? null;
}
```

Check callers of `resolveModelBundle` for the now-dropped second argument (grep `resolveModelBundle(` across `apps/web`) and update each call site to pass only `retrievalModelId`.

`packages/shared-types/src/settings.ts:112-119` — replace:

```ts
  {
    key: "VERIFICATION_MODEL",
    label: "Verification model",
    type: "enum",
    isSecret: false,
    required: true,
    defaultValue: "laila",
    options: VERIFICATION_MODELS.map((m) => m.id),
  },
```

with:

```ts
  {
    key: "VERIFICATION_MODEL",
    label: "Verification model (installed from the model marketplace — empty means none installed yet)",
    type: "string",
    isSecret: false,
    required: false,
    defaultValue: "",
  },
```

Since `VERIFICATION_MODELS` may now be unused in `settings.ts`, remove it from that file's import if no longer referenced there.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/shared-types && npx vitest run src/models.test.ts src/model-bundles.test.ts src/settings.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/shared-types/src/models.ts packages/shared-types/src/models.test.ts packages/shared-types/src/model-bundles.ts packages/shared-types/src/model-bundles.test.ts packages/shared-types/src/settings.ts packages/shared-types/src/settings.test.ts
git commit -m "feat(shared-types): make verification models 100% catalog-driven, not hardcoded"
```

---

### Task 2: Find and fix every other caller broken by Task 1's type/signature changes

**Files:**
- Modify: any file `resolveModelBundle(` is called with 2 arguments (grep to find them — as of this plan, `apps/web/app/settings` or catalog UI code).
- Modify: any file reading `VERIFICATION_MODELS[0]` or similar assuming a non-empty array (grep `VERIFICATION_MODELS`).
- Modify: `apps/web/app/setup/actions.ts:16-18` doc comment referencing `"laila"` default (comment only, but keep comments accurate).
- Test: run the full web typecheck to catch anything the grep misses.

**Interfaces:**
- Consumes: Task 1's `resolveModelBundle(retrievalModelId: string)` (one arg) and empty `VERIFICATION_MODELS`.

- [ ] **Step 1: Grep for call sites**

Run: `cd apps/web && grep -rn "resolveModelBundle(" app lib | grep -v test`
Run: `cd apps/web && grep -rn "VERIFICATION_MODELS" app lib | grep -v test`

- [ ] **Step 2: Fix each hit**

For each `resolveModelBundle(retrievalId, verificationId)` call, drop the second argument. For each place indexing into `VERIFICATION_MODELS` (e.g. a settings UI dropdown built from `VERIFICATION_MODELS.map(...)`), replace it with the pattern used for retrieval models' "what's actually available" — for now, since there is no live "list installed verification models" endpoint yet (Task 6 adds catalog listing, not a live-models endpoint), leave the setting as a free-text/read-only display of the current `VERIFICATION_MODEL` value rather than a `<select>` populated from a static list. If a Settings UI component renders a `<select>` bound to `VERIFICATION_MODELS`, change it to a plain disabled text input showing the current value with a note "Se gestiona desde Modelos → Marketplace."

- [ ] **Step 3: Update `apps/web/app/setup/actions.ts`'s comment**

Replace the `resolveValue` doc comment's `"lumi-preview"/"laila"` example with:

```ts
/**
 * Resolves the value to write for a setting from the submitted form.
 *
 * If the field is present in the form (even as an empty string, e.g. an
 * optional field like MAPBOX_TOKEN left blank), that submitted value wins.
 * If the field is absent entirely — true for RETRIEVAL_MODEL/VERIFICATION_MODEL,
 * which no wizard step renders directly as a form field — fall back to the
 * setting's defaultValue so setup can still complete. VERIFICATION_MODEL's
 * defaultValue is now "" (no verification model installed yet); it gets
 * written for real once a catalog release providing one is installed
 * (see model-catalog/install/route.ts).
 */
```

- [ ] **Step 4: Typecheck and test**

Run: `cd apps/web && npx tsc --noEmit`
Expected: no errors referencing `resolveModelBundle` arity or `VERIFICATION_MODELS`.

Run: `cd apps/web && npx vitest run`
Expected: all passing (aside from any pre-existing unrelated flake already known — `app/api/health/logs/route.test.ts`).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "fix(web): update callers for the one-arg resolveModelBundle and empty VERIFICATION_MODELS"
```

---

### Task 3: Make the Python inference service treat an unset/empty verification model as cleanly "not configured"

**Files:**
- Modify: `services/inference/models/registry.py`
- Modify: `services/inference/settings.py:12-13`
- Modify: `services/inference/main.py:191-194`
- Modify: `services/inference/loader.py:61-118`
- Test: `services/inference/test_settings.py`
- Test: `services/inference/test_main.py`
- Test: `services/inference/test_loader.py`

**Interfaces:**
- Produces: `load_verification_model(model_id: str)` raises `UnknownModelError` for any id not in `VERIFICATION_MODELS` (including `""`) — same contract as today, just against a now-possibly-empty list. `get_verification_model()` (FastAPI dependency) raises `HTTPException(503, "Verification model not configured yet")` for BOTH a missing key AND an empty-string `verification_model_id`.

- [ ] **Step 1: Write the failing tests**

In `services/inference/test_settings.py`, replace the assertion that `DEFAULT_VERIFICATION_MODEL == "laila"`:

```python
def test_default_verification_model_is_empty():
    from settings import DEFAULT_VERIFICATION_MODEL
    assert DEFAULT_VERIFICATION_MODEL == ""
```

In `services/inference/test_main.py`, add:

```python
def test_verify_503s_when_verification_model_is_empty_string(client):
    # Simulates a fresh install: the setting exists in system_settings but
    # is an empty string ("not installed yet"), not merely absent from
    # _model_holder — both must 503 cleanly, never raise UnknownModelError.
    import main
    main._model_holder["verification_model_id"] = ""
    response = client.post("/verify", json={"query_image": "...", "candidate_images": ["..."]})
    assert response.status_code == 503
    assert "not configured" in response.json()["detail"].lower()
```

(Adapt the request body to match whatever `VerifyRequest`'s real required fields are — check `main.py`'s `VerifyRequest` model before writing this; the point under test is the 503, not the payload shape.)

In `services/inference/test_loader.py`, replace any test asserting `load_verification_model("laila")` loads RoMa with a test using a registry entry the test itself injects (via monkeypatching `models.registry.VERIFICATION_MODELS`), so the test no longer depends on a literal `"laila"` id:

```python
def test_load_verification_model_unknown_id_raises(monkeypatch):
    import models.registry as registry
    monkeypatch.setattr(registry, "VERIFICATION_MODELS", [])
    from loader import UnknownModelError, load_verification_model
    with pytest.raises(UnknownModelError):
        load_verification_model("anything")
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd services/inference && ./venv/bin/pytest test_settings.py test_main.py test_loader.py -v`
Expected: FAIL — `DEFAULT_VERIFICATION_MODEL` is still `"laila"`; `/verify` with an empty-string id currently tries to load id `""` and raises an unhandled `UnknownModelError` (500, not 503).

- [ ] **Step 3: Implement**

`services/inference/models/registry.py` — replace the `VERIFICATION_MODELS` list body:

```python
VERIFICATION_MODELS = [
    # Ships empty on purpose — a verification model is only present here
    # once a catalog release providing one has been installed (the release
    # replaces this whole file, registry entry included). See
    # apps/web/app/api/model-catalog/install/route.ts.
]
```

`services/inference/settings.py:12-13` — change:

```python
DEFAULT_VERIFICATION_MODEL = ""
```

`services/inference/main.py` — update `get_verification_model()`:

```python
def get_verification_model():
    model_id = _model_holder.get("verification_model_id")
    if not model_id:
        raise HTTPException(status_code=503, detail="Verification model not configured yet")
    return _ensure_active_model("verification")
```

`services/inference/loader.py` — the `load_verification_model` function's body already raises `UnknownModelError` for anything not found in `VERIFICATION_MODELS` (which is now always empty in the base repo), so its `if model_id == "laila":` branch becomes dead code reachable only once some future registry entry re-adds an id — leave the RoMa-loading implementation itself intact (it's the real, working implementation a catalog release will ship), but generalize the condition so it isn't tied to the literal string `"laila"`:

```python
def load_verification_model(model_id: str):
    entry = next((m for m in VERIFICATION_MODELS if m["id"] == model_id), None)
    if entry is None:
        raise UnknownModelError(f"Unknown verification model id: {model_id}")

    # Every registry entry present today loads via the same RoMa-based
    # matcher (spec §15.2) — entry["id"] is looked up for existence above,
    # not branched on here, so adding a second verification model with a
    # different implementation later means adding a real dispatch, not
    # more copies of this branch.
    global _LOAD_ROMA_OUTDOOR
    ...  # (unchanged body, just remove the `if model_id == "laila":` guard
         # since `entry` already proved model_id is a real registry id)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd services/inference && ./venv/bin/pytest test_settings.py test_main.py test_loader.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add services/inference/models/registry.py services/inference/settings.py services/inference/main.py services/inference/loader.py services/inference/test_settings.py services/inference/test_main.py services/inference/test_loader.py
git commit -m "fix(inference): treat missing or empty verification model as cleanly unconfigured"
```

---

### Task 4: Add `verificationModelId` to the model-catalog manifest and validator

**Files:**
- Modify: `apps/web/lib/model-catalog/manifest.ts`
- Test: `apps/web/lib/model-catalog/manifest.test.ts`

**Interfaces:**
- Produces: `ModelCatalogManifest.verificationModelId?: string` — `undefined`/absent means "this release doesn't provide/change verification."

- [ ] **Step 1: Write the failing test**

Add to `apps/web/lib/model-catalog/manifest.test.ts`:

```ts
it("accepts a manifest with an optional verificationModelId", () => {
  const manifest = validateModelCatalogManifest({
    bundleId: "lumi-preview", version: "1.1", backbones: [], description: "",
    benchmark: { accuracyWithin50m: 0.9, avgDistanceM: 5, sampleCount: 20, ranAt: "x" },
    verificationModelId: "roma-verify",
  });
  expect(manifest.verificationModelId).toBe("roma-verify");
});

it("leaves verificationModelId undefined when the manifest omits it", () => {
  const manifest = validateModelCatalogManifest({
    bundleId: "lumi-preview", version: "1.1", backbones: [], description: "",
    benchmark: { accuracyWithin50m: 0.9, avgDistanceM: 5, sampleCount: 20, ranAt: "x" },
  });
  expect(manifest.verificationModelId).toBeUndefined();
});

it("rejects a non-string verificationModelId", () => {
  expect(() => validateModelCatalogManifest({
    bundleId: "lumi-preview", version: "1.1", backbones: [], description: "",
    benchmark: { accuracyWithin50m: 0.9, avgDistanceM: 5, sampleCount: 20, ranAt: "x" },
    verificationModelId: 42,
  })).toThrow();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run lib/model-catalog/manifest.test.ts`
Expected: FAIL — `manifest.verificationModelId` is `undefined` in the field-not-dropped case too, or the type doesn't exist yet (TS won't even compile the `.verificationModelId` access without the field).

- [ ] **Step 3: Implement**

`apps/web/lib/model-catalog/manifest.ts`:

```ts
export interface ModelCatalogManifest {
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
```

Add validation right before the final `return`:

```ts
  if (raw.verificationModelId !== undefined && typeof raw.verificationModelId !== "string") {
    throw new Error("manifest.verificationModelId must be a string when present");
  }
```

and add the field to the returned object:

```ts
  return {
    bundleId: raw.bundleId,
    version: raw.version,
    backbones,
    benchmark: { ... },
    description: typeof raw.description === "string" ? raw.description : "",
    verificationModelId: typeof raw.verificationModelId === "string" ? raw.verificationModelId : undefined,
  };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && npx vitest run lib/model-catalog/manifest.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/model-catalog/manifest.ts apps/web/lib/model-catalog/manifest.test.ts
git commit -m "feat(web): add optional verificationModelId to the model-catalog manifest"
```

---

### Task 5: Publish route reads live settings instead of static shared-types constants; install route activates the manifest's verification model

**Files:**
- Modify: `apps/web/app/api/model-catalog/publish/route.ts:44-62`
- Modify: `apps/web/app/api/model-catalog/install/route.ts`
- Test: `apps/web/app/api/model-catalog/publish/route.test.ts`
- Test: `apps/web/app/api/model-catalog/install/route.test.ts`

**Interfaces:**
- Consumes: `getSettingsRepo().getSetting(key: string): Promise<string | null>` (already used elsewhere in this route file for `GITHUB_TOKEN`/`MODEL_CATALOG_REPO`).
- Produces: the manifest published now includes `verificationModelId` sourced from the live `VERIFICATION_MODEL` setting (empty string maps to `undefined`, matching Task 4's manifest semantics). `install/route.ts` writes both `RETRIEVAL_MODEL` and `VERIFICATION_MODEL` settings after a successful install when the manifest specifies them.

- [ ] **Step 1: Write the failing tests**

In `apps/web/app/api/model-catalog/publish/route.test.ts`, add/adjust a case so the manifest asserts `verificationModelId` from a mocked setting:

```ts
it("includes the currently-configured verification model id in the published manifest", async () => {
  // ...existing mocking setup for GITHUB_TOKEN/MODEL_CATALOG_REPO/benchmark...
  const repo = await import("../../../../lib/settings-repo");
  (repo.getSettingsRepo as any).mockReturnValue({
    getSetting: vi.fn(async (key: string) => {
      if (key === "GITHUB_TOKEN") return "tok";
      if (key === "MODEL_CATALOG_REPO") return "inigo/lumi-model-catalog";
      if (key === "VERIFICATION_MODEL") return "roma-verify";
      return null;
    }),
  });
  // ...invoke POST, capture the manifest passed to upsertRelease's
  // MODEL_CATALOG_METADATA_ASSET_NAME asset (decrypt it in the assertion,
  // same pattern the existing tests in this file already use)...
  expect(manifest.verificationModelId).toBe("roma-verify");
});
```

In `apps/web/app/api/model-catalog/install/route.test.ts`, add:

```ts
it("writes RETRIEVAL_MODEL and VERIFICATION_MODEL settings from the manifest on success", async () => {
  await mockRelease(); // extend mockRelease() in this file to include verificationModelId: "roma-verify" in its manifest
  const { backupInferenceCode, restoreInferenceCode, persistBackup } = await import("../../../../lib/model-catalog/backup");
  (backupInferenceCode as any).mockResolvedValue("/tmp/backup-1");
  const fsPromises = await import("node:fs/promises");
  (fsPromises.readdir as any).mockResolvedValue([{ name: "main.py", isDirectory: () => false }]);
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (url.includes("restart-inference")) return { ok: true } as Response;
    if (url.includes("/docs")) return { ok: true } as Response;
    throw new Error(`unexpected fetch: ${url}`);
  }));
  const { setSetting } = await import("../../../../lib/settings-repo");

  const { POST } = await import("./route");
  await POST(makeRequest({ owner: "inigo", repo: "lumi-model-catalog", tag: "lumi-preview-v1.1" }));

  expect(setSetting).toHaveBeenCalledWith("RETRIEVAL_MODEL", "lumi-preview");
  expect(setSetting).toHaveBeenCalledWith("VERIFICATION_MODEL", "roma-verify");
});
```

(Check `apps/web/lib/settings-repo.ts` for the actual exported name/shape used to write a single setting — the plan assumes a `setSetting(key, value)` helper exists or `getSettingsRepo().setSetting(...)`; use whichever this repo already exposes, mocking it the same way this test file already mocks other settings-repo calls.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/web && npx vitest run app/api/model-catalog/publish/route.test.ts app/api/model-catalog/install/route.test.ts`
Expected: FAIL — publish's manifest has no `verificationModelId`; install never calls a settings-write function.

- [ ] **Step 3: Implement**

`apps/web/app/api/model-catalog/publish/route.ts` — replace:

```ts
  const activeRetrievalModel = RETRIEVAL_MODELS[0];
  const bundleId = activeRetrievalModel?.id ?? "lumi-preview";
  const version = activeRetrievalModel?.version ?? "1.0";
```

with (keep `RETRIEVAL_MODELS` for `bundleId`/`version`/`displayName` — retrieval is out of scope per Global Constraints — only add verification's live value):

```ts
  const activeRetrievalModel = RETRIEVAL_MODELS[0];
  const bundleId = activeRetrievalModel?.id ?? "lumi-preview";
  const version = activeRetrievalModel?.version ?? "1.0";
  const liveVerificationModel = await repo.getSetting("VERIFICATION_MODEL");
```

and add `verificationModelId` to the `manifest` object literal:

```ts
  const manifest: ModelCatalogManifest = {
    bundleId,
    version,
    backbones: [ ... ],
    benchmark,
    description: body.description ?? "",
    verificationModelId: liveVerificationModel || undefined,
  };
```

`apps/web/app/api/model-catalog/install/route.ts` — after the existing success path (right where Task 22's session already added `persistBackup`/`writeUninstallMeta`), also activate the manifest's model ids:

```ts
    const priorMeta = await readUninstallMeta();
    await persistBackup(backupDir, PREVIOUS_CODE_DIR);
    await writeUninstallMeta({ currentVersion: manifest.version, previousVersion: priorMeta.currentVersion });

    const settingsRepo = getSettingsRepo();
    await settingsRepo.setSetting("RETRIEVAL_MODEL", body.owner ? bundleIdFromManifest : manifest.bundleId);
    if (manifest.verificationModelId) {
      await settingsRepo.setSetting("VERIFICATION_MODEL", manifest.verificationModelId);
    }

    return NextResponse.json({ ok: true, version: manifest.version });
```

(Use `manifest.bundleId` directly for `RETRIEVAL_MODEL` — don't introduce a `bundleIdFromManifest` placeholder; that was illustrative above, write `manifest.bundleId` literally. Import `getSettingsRepo` from `../../../../lib/settings-repo` at the top of the file alongside the other imports.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/web && npx vitest run app/api/model-catalog/publish/route.test.ts app/api/model-catalog/install/route.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/api/model-catalog/publish/route.ts apps/web/app/api/model-catalog/install/route.ts apps/web/app/api/model-catalog/publish/route.test.ts apps/web/app/api/model-catalog/install/route.test.ts
git commit -m "feat(web): publish reads live settings; install activates the manifest's models"
```

---

### Task 6: `GET /api/model-catalog` reports `isActive` from real install state, not a static constant

**Files:**
- Modify: `apps/web/app/api/model-catalog/route.ts`
- Test: `apps/web/app/api/model-catalog/route.test.ts`

**Interfaces:**
- Consumes: `readUninstallMeta(): Promise<{ currentVersion: string | null; previousVersion: string | null }>` (already exists, from this session's `apps/web/lib/model-catalog/uninstall-state.ts`).
- Produces: `isActive` is `true` for the release whose `version` matches `readUninstallMeta().currentVersion`, not `RETRIEVAL_MODELS[0]?.version`.

- [ ] **Step 1: Write the failing test**

In `apps/web/app/api/model-catalog/route.test.ts`, add a mock for `uninstall-state` and change the active-version assertion:

```ts
vi.mock("../../../lib/model-catalog/uninstall-state", () => ({
  readUninstallMeta: vi.fn(),
}));

// inside the existing test, before calling GET():
const { readUninstallMeta } = await import("../../../lib/model-catalog/uninstall-state");
(readUninstallMeta as any).mockResolvedValue({ currentVersion: "1.1", previousVersion: "1.0" });
```

and change the assertions to expect version "1.1" (not "1.0") as active:

```ts
expect(releases.find((r: any) => r.version === "1.1").isActive).toBe(true);
expect(releases.find((r: any) => r.version === "1.0").isActive).toBe(false);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run app/api/model-catalog/route.test.ts`
Expected: FAIL — the route still marks version "1.0" active (the current hardcoded `RETRIEVAL_MODELS[0].version` in this repo, unaffected by the mock).

- [ ] **Step 3: Implement**

`apps/web/app/api/model-catalog/route.ts` — import and use `readUninstallMeta`:

```ts
import { readUninstallMeta } from "../../../lib/model-catalog/uninstall-state";

export async function GET() {
  const { currentVersion } = await readUninstallMeta();
  const activeVersion = currentVersion ?? RETRIEVAL_MODELS[0]?.version ?? null;
  // ...rest unchanged, still compares manifest.version === activeVersion
```

(Falling back to the static constant when nothing has ever been installed via the catalog keeps today's out-of-the-box behavior — a fresh clone still shows its built-in version as "Activa" until the first real catalog install.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && npx vitest run app/api/model-catalog/route.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/api/model-catalog/route.ts apps/web/app/api/model-catalog/route.test.ts
git commit -m "fix(web): model-catalog isActive reflects real install state, not a static constant"
```

---

### Task 7: New dynamic setup step — install from the marketplace instead of `download_weights.py`

**Files:**
- Create: `apps/web/app/setup/steps/CatalogModelsStep.tsx`
- Create: `apps/web/app/setup/steps/CatalogModelsStep.test.tsx` — logic-only tests (this repo's convention per Global Constraints in the earlier upload-redesign plan: no DOM/component-render tests — test any extracted pure helper function instead, e.g. a `pickDefaultRelease()` helper).
- Delete: `apps/web/app/setup/steps/ModelsStep.tsx`
- Modify: whatever step-list file wires `ModelsStep` into the wizard (grep `ModelsStep` from `apps/web/app/setup` to find the parent, e.g. `apps/web/app/setup/page.tsx` or a `wizard-steps.ts`).
- Test: update `apps/web/app/setup/wizard-steps.test.ts` / `apps/web/app/api/setup/wizard-steps.test.ts` for the renamed step if either references `ModelsStep`/`weights-retrieval` by name.

**Interfaces:**
- Consumes: `GET /api/model-catalog` → `{ bundles: CatalogBundle[] }` (existing shape, see `apps/web/lib/catalog-types.ts`'s `flattenModelBundles`), `POST /api/model-catalog/install` → `{ ok: true, version: string } | { error: string }` (existing).
- Produces: `onComplete: () => void` — same contract `ModelsStep` had, called once an install succeeds (or the operator explicitly skips, if the wizard's step contract allows skipping — check the parent wizard component for whether steps are skippable before assuming this).

- [ ] **Step 1: Write the failing test for the pure selection helper**

```tsx
// apps/web/app/setup/steps/CatalogModelsStep.test.tsx
import { describe, it, expect } from "vitest";
import { pickDefaultRelease } from "./CatalogModelsStep";

describe("pickDefaultRelease", () => {
  it("picks the highest-benchmark release across all bundles", () => {
    const bundles = [
      { owner: "a", repo: "r1", releases: [{ tag: "t1", version: "1.0", benchmark: { accuracyWithin50m: 0.7 } }] },
      { owner: "a", repo: "r2", releases: [{ tag: "t2", version: "1.0", benchmark: { accuracyWithin50m: 0.9 } }] },
    ];
    const picked = pickDefaultRelease(bundles as any);
    expect(picked?.repo).toBe("r2");
  });

  it("returns null when there are no releases at all", () => {
    expect(pickDefaultRelease([])).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run app/setup/steps/CatalogModelsStep.test.tsx`
Expected: FAIL — module doesn't exist yet.

- [ ] **Step 3: Implement**

```tsx
// apps/web/app/setup/steps/CatalogModelsStep.tsx
"use client";
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { fadeRise } from "../../lib/motion";
import { fetchJson } from "../../lib/fetch-json";

interface CatalogRelease {
  tag: string;
  version: string;
  benchmark: { accuracyWithin50m: number };
}
interface CatalogBundleEntry {
  owner: string;
  repo: string;
  releases: CatalogRelease[];
}

/** Auto-selects the release with the highest accuracyWithin50m across every
 * bundle the marketplace currently offers — used so setup can install
 * something sensible by default without making the operator pick, while
 * still showing what was picked and why. Pure function so it's unit
 * testable without rendering anything (this repo's convention: no
 * DOM/component-render tests). */
export function pickDefaultRelease(
  bundles: CatalogBundleEntry[]
): { owner: string; repo: string; release: CatalogRelease } | null {
  let best: { owner: string; repo: string; release: CatalogRelease } | null = null;
  for (const bundle of bundles) {
    for (const release of bundle.releases) {
      if (!best || release.benchmark.accuracyWithin50m > best.release.benchmark.accuracyWithin50m) {
        best = { owner: bundle.owner, repo: bundle.repo, release };
      }
    }
  }
  return best;
}

export function CatalogModelsStep({ onComplete }: { onComplete: () => void }) {
  const [bundles, setBundles] = useState<CatalogBundleEntry[]>([]);
  const [status, setStatus] = useState<"loading" | "idle" | "installing" | "done" | "error">("loading");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchJson<{ bundles: CatalogBundleEntry[] }>("/api/model-catalog").then((r) => {
      setBundles(r.data?.bundles ?? []);
      setStatus("idle");
    });
  }, []);

  async function install() {
    const picked = pickDefaultRelease(bundles);
    if (!picked) {
      setError("No hay ninguna versión disponible en el marketplace todavía.");
      setStatus("error");
      return;
    }
    setStatus("installing");
    const { ok, data } = await fetchJson<{ error?: string }>("/api/model-catalog/install", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ owner: picked.owner, repo: picked.repo, tag: picked.release.tag }),
    });
    if (!ok) {
      setError(data?.error ?? "No se pudo instalar el modelo");
      setStatus("error");
      return;
    }
    setStatus("done");
    onComplete();
  }

  return (
    <motion.div variants={fadeRise} initial="hidden" animate="show">
      <div className="mb-0.5 text-[15px] font-medium text-fg">Modelo desde el marketplace</div>
      <p className="mb-4 text-xs text-muted">
        Instala un modelo de recuperación + verificación publicado en tu catálogo. Podrás desinstalarlo o cambiarlo
        más tarde desde Ajustes → Modelos.
      </p>

      {status === "loading" && <p className="text-xs text-muted">Consultando el marketplace…</p>}

      {status !== "loading" && bundles.length === 0 && (
        <p className="text-xs text-warning-fg">
          No hay ningún catálogo configurado todavía (falta GITHUB_TOKEN/MODEL_CATALOG_REPO en Ajustes) — puedes
          completar la instalación más tarde desde Ajustes → Modelos.
        </p>
      )}

      {bundles.length > 0 && status !== "done" && (
        <button
          onClick={install}
          disabled={status === "installing"}
          className="rounded-md bg-accent px-4 py-2 text-xs font-medium text-black disabled:opacity-50"
        >
          {status === "installing" ? "Instalando…" : "Instalar modelo recomendado"}
        </button>
      )}

      {status === "done" && <p className="text-xs text-fg">Modelo instalado.</p>}
      {error && <p className="mt-2 text-xs text-danger-fg">{error}</p>}
    </motion.div>
  );
}
```

- [ ] **Step 4: Wire it into the wizard**

Find the parent that currently renders `<ModelsStep .../>` (`grep -rn "ModelsStep" apps/web/app/setup` — excluding the file itself). Replace the import and JSX usage with `CatalogModelsStep`, dropping the `useCases`/`runtime` props it no longer needs (the marketplace list doesn't depend on OS runtime the way `download_weights.py`'s WSL variants did). Delete `apps/web/app/setup/steps/ModelsStep.tsx`. If `model-recommendations.ts`'s `recommendedBundles`/`USE_CASES` are now unused anywhere else, leave them (other steps may still reference `USE_CASES` for the use-case picker step itself — check before deleting; only remove what `ModelsStep.tsx` alone consumed).

- [ ] **Step 5: Run tests to verify everything passes**

Run: `cd apps/web && npx vitest run app/setup`
Expected: PASS (including the new `CatalogModelsStep.test.tsx`).

Run: `cd apps/web && npx tsc --noEmit`
Expected: no errors (confirms nothing else still imports the deleted `ModelsStep.tsx`).

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/setup
git commit -m "feat(web): setup installs models from the marketplace instead of download_weights.py"
```

---

### Task 8: Remove the now-dead `download_weights.py` step wiring

**Files:**
- Modify: `apps/web/app/api/setup/run/[step]/route.ts` — remove `weights-retrieval`, `weights-verification`, `weights-retrieval-wsl`, `weights-verification-wsl` from `STEPS`, and `cacheEnvFor`/`wslCacheExport`/`MODELS_CACHE_DIR` if nothing else in this file uses them after removal (check `wslPipCacheExport`/`inference-deps-wsl` — those are for installing Python deps generally, not weights specifically, so they likely stay).
- Delete: `services/inference/download_weights.py`
- Test: `apps/web/app/api/setup/wizard-steps.test.ts` (or wherever `STEPS`'s keys are asserted) — remove/replace any case listing the deleted step ids.

**Interfaces:**
- Consumes: nothing new.
- Produces: `STEPS` no longer has `weights-*` keys; a request to `POST /api/setup/run/weights-retrieval` now 404s ("unknown step") the same way any never-existed step id already does.

- [ ] **Step 1: Update the failing test**

In whichever test currently asserts `weights-retrieval`/`weights-verification` are valid step ids, replace with an assertion that they're gone:

```ts
it("no longer exposes the retired download_weights.py steps", async () => {
  const res = await POST(makeRequest(), { params: { step: "weights-retrieval" } });
  expect(res.status).toBe(404);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run app/api/setup`
Expected: FAIL — `weights-retrieval` still resolves today.

- [ ] **Step 3: Implement**

Remove the four `weights-*` entries from `STEPS` in `apps/web/app/api/setup/run/[step]/route.ts` (the object literal at line ~114-125, and the two `STEPS["weights-*-wsl"] = ...` assignments inside the `if (IS_WIN)` block). Remove `cacheEnvFor`/`MODELS_CACHE_DIR`/`wslCacheExport` only if nothing else in the file still calls them after the removal — grep the file first (`grep -n "cacheEnvFor\|MODELS_CACHE_DIR\|wslCacheExport" apps/web/app/api/setup/run/\[step\]/route.ts`) since `wslCacheExport` is only used by the two `weights-*-wsl` lines being removed, but double-check before deleting.

Delete `services/inference/download_weights.py` entirely (`git rm services/inference/download_weights.py`) — confirm nothing else invokes it first (`grep -rn "download_weights" --include=*.ts --include=*.py .`).

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/web && npx vitest run app/api/setup`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: remove the retired download_weights.py setup step and script"
```

---

### Task 9: Full-repo verification pass

**Files:** none (verification only).

- [ ] **Step 1: Full web typecheck and test suite**

Run: `cd apps/web && npx tsc --noEmit && npx vitest run`
Expected: clean typecheck; all tests passing except the pre-existing unrelated `app/api/health/logs/route.test.ts` flake (documented earlier this session).

- [ ] **Step 2: Full worker typecheck and test suite**

Run: `cd apps/worker && npx tsc --noEmit && npx vitest run`
Expected: clean, all passing (this plan doesn't touch the worker, but confirm nothing in shared-types broke it).

- [ ] **Step 3: shared-types test suite**

Run: `cd packages/shared-types && npx vitest run`
Expected: all passing.

- [ ] **Step 4: Python test suite**

Run: `cd services/inference && ./venv/bin/pytest -v`
Expected: all passing.

- [ ] **Step 5: Grep sweep for any remaining "laila" reference in code (not historical docs/specs)**

Run: `grep -rniw laila packages apps services --include=*.ts --include=*.tsx --include=*.py`
Expected: zero hits. (Historical files under `docs/` are out of scope — they're a record of what was true when written, not living documentation.)

- [ ] **Step 6: Manual smoke check**

Start the app (`pnpm dev` or this repo's usual dev script), open Settings → Modelos, confirm the marketplace list renders and an install successfully flips a release's "Activa" badge and makes "Desinstalar" available. Run through `/setup` on a throwaway settings DB (or accept this is best-effort without one) to confirm `CatalogModelsStep` renders and installs without a hard crash when no catalog is configured yet (shows the "no hay ningún catálogo configurado" message instead of erroring).

- [ ] **Step 7: Final commit if step 6 turned up fixes**

```bash
git add -A
git commit -m "fix: address issues found during full-repo verification pass"
```
