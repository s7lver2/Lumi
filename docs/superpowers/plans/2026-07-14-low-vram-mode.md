# Low-VRAM Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a settings-controlled `INFERENCE_LOW_VRAM_MODE` (auto/on/off) that, when active, keeps only one model (retrieval or verification) resident on GPU at a time — swapping only on an operation switch, never per-request — with accurate "model loading" notices in search/refine/indexing and a one-click restart flow that reuses the existing loading screen.

**Architecture:** `services/inference`'s `get_retrieval_model()`/`get_verification_model()` FastAPI dependencies both route through one `_ensure_active_model(kind)` helper that tracks which model is currently resident, unloads the other one (`del` + `torch.cuda.empty_cache()`) only when low-VRAM mode is on, and catches `torch.cuda.OutOfMemoryError` into a `503`. A new `GET /model-status` exposes the in-memory loading state; a new `apps/web` proxy route lets the browser poll it. Toggling the setting only takes effect on the inference service's next restart — a new `POST /api/setup/run/restart-inference` (killing whatever's on port 8000, then respawning via the setup wizard's existing spawn plumbing) redirects into the real `BootGate` loading screen already shipped by the startup-health-screens feature.

**Tech Stack:** FastAPI/PyTorch (`services/inference`), Next.js API routes, `pg` (settings), pytest, Vitest.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-13-low-vram-mode-design.md` — read it before starting; every task below implements one of its sections.
- **The spec's "Open dependency" note is resolved:** it forward-referenced "spec #2" (the startup/loading screen) as not-yet-written. That screen (`apps/web/app/components/LoadingScreen.tsx`'s `BootGate`) has since been fully implemented and merged (`docs/superpowers/specs/2026-07-13-startup-health-screens-design.md`). Task 8 below redirects into the REAL component, not a placeholder.
- Auto-detection cutoff is a fixed **8 GiB** (`total_memory <= 8 GiB` → on). Exact value from the spec — do not change it.
- No implicit behavior change for existing large-GPU (mode resolves to "off") installs: `_ensure_active_model` must reproduce today's exact behavior in that case (retrieval loaded once at startup and never unloaded, verification lazy-loaded once on first `/verify` and never unloaded) — Task 3 folds this in as a refactor, not a behavior change.
- The setting change takes effect only on the inference service's next restart (matches how `RETRIEVAL_MODEL`/`VERIFICATION_MODEL` already work, spec §15.4) — never re-read `system_settings` mid-process.
- All new user-facing copy is in Spanish, matching the rest of the app. The OOM error text is copied **verbatim** from the spec: *"No hay memoria de GPU suficiente para cargar el modelo. Cierra otras aplicaciones que usen la GPU e inténtalo de nuevo."*
- Follow existing file conventions: Python tests use the `_mock_conn(rows)` / `app.dependency_overrides[...]` patterns already in `services/inference/test_settings.py`/`test_main.py`; TS route tests mock imported lib modules via `vi.mock` and call the exported handler directly with a real `Request`/`fetch` mock (see `apps/web/app/api/health/route.test.ts`).

---

### Task 1: `INFERENCE_LOW_VRAM_MODE` setting

**Files:**
- Modify: `packages/shared-types/src/settings.ts`
- Modify: `packages/shared-types/src/settings.test.ts`
- Modify: `apps/web/app/settings/sections.ts`

**Interfaces:**
- Produces: `SETTINGS_SCHEMA` entry `INFERENCE_LOW_VRAM_MODE` (enum: `"auto" | "on" | "off"`, default `"auto"`) — Task 5's inference `settings.py` and Task 9's Settings UI both read/write this key.

- [ ] **Step 1: Write the failing tests**

Add to `packages/shared-types/src/settings.test.ts`:

```ts
describe("INFERENCE_LOW_VRAM_MODE setting", () => {
  it("is a non-secret enum with auto/on/off options, defaulting to auto", () => {
    const def = SETTINGS_SCHEMA.find((s) => s.key === "INFERENCE_LOW_VRAM_MODE")!;
    expect(def).toBeDefined();
    expect(def.type).toBe("enum");
    expect(def.isSecret).toBe(false);
    expect(def.options).toEqual(["auto", "on", "off"]);
    expect(def.defaultValue).toBe("auto");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @netryx/shared-types test settings`
Expected: FAIL — `def` is `undefined`.

- [ ] **Step 3: Add the setting**

In `packages/shared-types/src/settings.ts`, add this entry to `SETTINGS_SCHEMA` (right after the `INFERENCE_RUNTIME` entry):

```ts
  {
    key: "INFERENCE_LOW_VRAM_MODE",
    label: "Modo bajo VRAM",
    type: "enum",
    isSecret: false,
    required: true,
    defaultValue: "auto",
    options: ["auto", "on", "off"],
  },
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter @netryx/shared-types test settings`
Expected: PASS.

- [ ] **Step 5: Assign the new key to the "models" section**

`apps/web/app/settings/sections.ts`'s `groupSettings()` throws if any `SETTINGS_SCHEMA` key isn't assigned to a section — skipping this step breaks the entire Settings page. In `apps/web/app/settings/sections.ts`, change the `"models"` section's `keys` array from:

```ts
  {
    id: "models",
    title: "Modelos",
    keys: [
      "RETRIEVAL_MODEL",
      "VERIFICATION_MODEL",
      "VERIFICATION_CONFIRM_THRESHOLD",
      "VERIFICATION_TILE_PASSES",
      "VERIFICATION_MIN_INLIERS",
      "VERIFICATION_INLIER_SATURATION",
      "VERIFICATION_ERROR_SCALE_PX",
      "VERIFICATION_MAGSAC_THRESHOLD_PX",
      "INFERENCE_RUNTIME",
    ],
  },
```

to:

```ts
  {
    id: "models",
    title: "Modelos",
    keys: [
      "RETRIEVAL_MODEL",
      "VERIFICATION_MODEL",
      "VERIFICATION_CONFIRM_THRESHOLD",
      "VERIFICATION_TILE_PASSES",
      "VERIFICATION_MIN_INLIERS",
      "VERIFICATION_INLIER_SATURATION",
      "VERIFICATION_ERROR_SCALE_PX",
      "VERIFICATION_MAGSAC_THRESHOLD_PX",
      "INFERENCE_RUNTIME",
      "INFERENCE_LOW_VRAM_MODE",
    ],
  },
```

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter @netryx/web typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add packages/shared-types/src/settings.ts packages/shared-types/src/settings.test.ts apps/web/app/settings/sections.ts
git commit -m "feat(settings): add INFERENCE_LOW_VRAM_MODE (auto/on/off)"
```

---

### Task 2: VRAM auto-detection resolver

**Files:**
- Create: `services/inference/vram.py`
- Create: `services/inference/test_vram.py`

**Interfaces:**
- Produces: `LOW_VRAM_THRESHOLD_BYTES`, `resolve_low_vram_mode(setting_value: str, cuda_available: bool, total_memory_bytes: int) -> bool`, `describe_gpu(cuda_available: bool, device_name: str | None, total_memory_bytes: int) -> str` — Task 4's `main.py` and Task 6's `/model-status` both import these.

- [ ] **Step 1: Write the failing tests**

```python
# services/inference/test_vram.py
from vram import resolve_low_vram_mode, describe_gpu, LOW_VRAM_THRESHOLD_BYTES

GIB = 1024 ** 3


def test_explicit_on_ignores_hardware():
    assert resolve_low_vram_mode("on", cuda_available=True, total_memory_bytes=24 * GIB) is True
    assert resolve_low_vram_mode("on", cuda_available=False, total_memory_bytes=0) is True


def test_explicit_off_ignores_hardware():
    assert resolve_low_vram_mode("off", cuda_available=True, total_memory_bytes=4 * GIB) is False


def test_auto_with_no_cuda_resolves_off():
    assert resolve_low_vram_mode("auto", cuda_available=False, total_memory_bytes=0) is False


def test_auto_at_or_under_8gib_resolves_on():
    assert resolve_low_vram_mode("auto", cuda_available=True, total_memory_bytes=6 * GIB) is True
    assert resolve_low_vram_mode("auto", cuda_available=True, total_memory_bytes=LOW_VRAM_THRESHOLD_BYTES) is True


def test_auto_over_8gib_resolves_off():
    assert resolve_low_vram_mode("auto", cuda_available=True, total_memory_bytes=24 * GIB) is False


def test_describe_gpu_with_no_cuda():
    assert "No se detectó GPU" in describe_gpu(cuda_available=False, device_name=None, total_memory_bytes=0)


def test_describe_gpu_with_cuda():
    desc = describe_gpu(cuda_available=True, device_name="RTX 3050", total_memory_bytes=6 * GIB)
    assert "RTX 3050" in desc
    assert "6 GB" in desc
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd services/inference && venv/bin/python -m pytest test_vram.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'vram'`.

- [ ] **Step 3: Write the implementation**

```python
# services/inference/vram.py
"""
Pure, testable VRAM auto-detection for low-VRAM mode (spec:
docs/superpowers/specs/2026-07-13-low-vram-mode-design.md). No import on
torch/CUDA here — main.py supplies the real torch.cuda.* values at
startup, tests supply fakes, so this stays importable and testable without
a GPU or even torch installed.
"""

LOW_VRAM_THRESHOLD_BYTES = 8 * 1024 * 1024 * 1024  # 8 GiB


def resolve_low_vram_mode(setting_value: str, cuda_available: bool, total_memory_bytes: int) -> bool:
    """setting_value is the raw INFERENCE_LOW_VRAM_MODE value ("auto"/"on"/
    "off"). Hardware is only consulted when it's "auto"."""
    if setting_value == "on":
        return True
    if setting_value == "off":
        return False
    if not cuda_available:
        return False
    return total_memory_bytes <= LOW_VRAM_THRESHOLD_BYTES


def describe_gpu(cuda_available: bool, device_name: str | None, total_memory_bytes: int) -> str:
    """Human-readable Spanish note for the settings UI — shows what "auto"
    actually decided (spec: "GPU detectada: RTX 3050 (6 GB) → se activa
    automáticamente"), not just the word "auto"."""
    if not cuda_available:
        return "No se detectó GPU — modo bajo VRAM desactivado (no aplica sin GPU)."
    gb = total_memory_bytes / (1024 ** 3)
    return f"GPU detectada: {device_name or 'desconocida'} ({gb:.0f} GB)"
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd services/inference && venv/bin/python -m pytest test_vram.py -v`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add services/inference/vram.py services/inference/test_vram.py
git commit -m "feat(inference): add VRAM auto-detection resolver for low-VRAM mode"
```

---

### Task 3: Read `INFERENCE_LOW_VRAM_MODE` from `system_settings`

**Files:**
- Modify: `services/inference/settings.py`
- Modify: `services/inference/test_settings.py`

**Interfaces:**
- Produces: `DEFAULT_LOW_VRAM_MODE = "auto"`, `get_low_vram_mode_setting(conn) -> str` — Task 4's `load_model_once()` calls this.

- [ ] **Step 1: Write the failing tests**

Add to `services/inference/test_settings.py`:

```python
from settings import get_low_vram_mode_setting


def test_reads_low_vram_mode_setting():
    conn = _mock_conn([("INFERENCE_LOW_VRAM_MODE", "on")])
    # get_low_vram_mode_setting queries a single key, not the same IN(...) as
    # get_active_model_ids — reuse _mock_conn's fetchall() stand-in either way.
    assert get_low_vram_mode_setting(conn) == "on"


def test_low_vram_mode_defaults_to_auto_when_unset():
    conn = _mock_conn([])
    assert get_low_vram_mode_setting(conn) == "auto"
```

`_mock_conn` currently wires `cursor.fetchall.return_value`; `get_low_vram_mode_setting` below uses `cursor.fetchone()` (single-row query, like `get_verification_tile_passes`) — add this to the existing `_mock_conn` helper in `services/inference/test_settings.py`:

```python
def _mock_conn(rows):
    conn = MagicMock()
    cursor = MagicMock()
    cursor.fetchall.return_value = rows
    cursor.fetchone.return_value = rows[0] if rows else None
    conn.cursor.return_value.__enter__.return_value = cursor
    return conn
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd services/inference && venv/bin/python -m pytest test_settings.py -v`
Expected: FAIL — `ImportError: cannot import name 'get_low_vram_mode_setting'`.

- [ ] **Step 3: Write the implementation**

Append to `services/inference/settings.py`:

```python
DEFAULT_LOW_VRAM_MODE = "auto"


def get_low_vram_mode_setting(conn) -> str:
    """Raw INFERENCE_LOW_VRAM_MODE value ("auto"/"on"/"off") — resolving it
    against actual hardware happens in vram.py's resolve_low_vram_mode(),
    called once from load_model_once() alongside this, same "read once at
    startup" convention as every other model-affecting setting here."""
    with conn.cursor() as cur:
        cur.execute("SELECT value FROM system_settings WHERE key = 'INFERENCE_LOW_VRAM_MODE'")
        row = cur.fetchone()
    if row is None or row[0] is None:
        return DEFAULT_LOW_VRAM_MODE
    return row[0]
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd services/inference && venv/bin/python -m pytest test_settings.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add services/inference/settings.py services/inference/test_settings.py
git commit -m "feat(inference): read INFERENCE_LOW_VRAM_MODE from system_settings"
```

---

### Task 4: `_ensure_active_model` swap helper + OOM handling + `/model-status`

**Files:**
- Modify: `services/inference/main.py`
- Modify: `services/inference/test_main.py`

**Interfaces:**
- Consumes: `resolve_low_vram_mode`, `describe_gpu` (Task 2); `get_low_vram_mode_setting` (Task 3).
- Produces: `_ensure_active_model(kind: str)`, `get_retrieval_model()`/`get_verification_model()` now both route through it, `GET /model-status` returning `{"loading": "retrieval" | "verification" | None, "lowVramMode": bool}` — Task 6's web proxy route and Task 10's UI both consume `/model-status`.

- [ ] **Step 1: Write the failing tests**

Add to `services/inference/test_main.py`:

```python
import pytest
from fastapi import HTTPException


def _reset_model_holder(**overrides):
    main._model_holder.clear()
    main._model_holder.update(overrides)
    main._active_kind = None
    main._loading_kind = None


def test_ensure_active_model_off_mode_never_unloads(monkeypatch):
    # Off mode: both kinds stay cached forever once loaded (today's exact
    # existing behavior) — switching kinds must NOT delete the other.
    _reset_model_holder(low_vram_mode=False, retrieval_model_id="lumi-preview", verification_model_id="laila")
    monkeypatch.setattr(main, "load_retrieval_model", lambda model_id: "retrieval-instance")
    monkeypatch.setattr(main, "load_verification_model", lambda model_id: "verification-instance")

    r = main._ensure_active_model("retrieval")
    v = main._ensure_active_model("verification")
    r_again = main._ensure_active_model("retrieval")

    assert r == "retrieval-instance"
    assert v == "verification-instance"
    assert r_again == "retrieval-instance"
    assert "model" in main._model_holder
    assert "verification_model" in main._model_holder


def test_ensure_active_model_same_kind_never_reloads(monkeypatch):
    _reset_model_holder(low_vram_mode=True, retrieval_model_id="lumi-preview", verification_model_id="laila")
    calls = []
    monkeypatch.setattr(main, "load_retrieval_model", lambda model_id: calls.append(model_id) or "retrieval-instance")

    main._ensure_active_model("retrieval")
    main._ensure_active_model("retrieval")
    main._ensure_active_model("retrieval")

    assert calls == ["lumi-preview"]  # loaded exactly once across 3 same-kind calls


def test_ensure_active_model_on_mode_unloads_previous_kind_on_switch(monkeypatch):
    _reset_model_holder(low_vram_mode=True, retrieval_model_id="lumi-preview", verification_model_id="laila")
    monkeypatch.setattr(main, "load_retrieval_model", lambda model_id: "retrieval-instance")
    monkeypatch.setattr(main, "load_verification_model", lambda model_id: "verification-instance")

    main._ensure_active_model("retrieval")
    assert "model" in main._model_holder

    main._ensure_active_model("verification")
    assert "model" not in main._model_holder  # unloaded on switch
    assert "verification_model" in main._model_holder


def test_ensure_active_model_raises_503_on_oom(monkeypatch):
    _reset_model_holder(low_vram_mode=True, retrieval_model_id="lumi-preview", verification_model_id="laila")

    def _raise_oom(model_id):
        raise torch.cuda.OutOfMemoryError("CUDA out of memory")

    monkeypatch.setattr(main, "load_retrieval_model", _raise_oom)

    with pytest.raises(HTTPException) as exc_info:
        main._ensure_active_model("retrieval")
    assert exc_info.value.status_code == 503
    assert "No hay memoria de GPU suficiente" in exc_info.value.detail


def test_model_status_reports_low_vram_mode_and_no_loading_when_idle():
    _reset_model_holder(low_vram_mode=True)
    res = _module_client.get("/model-status")
    assert res.status_code == 200
    assert res.json() == {"loading": None, "lowVramMode": True}
```

(`import torch` is already at the top of `test_main.py`'s target module `main.py`, but the test file itself imports `main` and does `from main import *` — `torch` is reachable as `main.torch` or via the already-wildcard-imported `torch` symbol; add `import torch` to `test_main.py`'s own imports if it isn't already implicitly available.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd services/inference && venv/bin/python -m pytest test_main.py -v -k "ensure_active_model or model_status"`
Expected: FAIL — `AttributeError: module 'main' has no attribute '_ensure_active_model'` (and `_active_kind`/`_loading_kind`).

- [ ] **Step 3: Write the implementation**

In `services/inference/main.py`, add the import:

```python
from vram import resolve_low_vram_mode, describe_gpu
from settings import get_low_vram_mode_setting
```

(add these two lines to the existing `from settings import (...)` block and a new `from vram import ...` line, right after the existing `from loader import load_retrieval_model, load_verification_model` line).

Add these module-level variables right after `_model_holder: dict = {}`:

```python
_active_kind: str | None = None  # "retrieval" | "verification" | None — which kind _ensure_active_model most recently returned
_loading_kind: str | None = None  # set only WHILE a model is actively being loaded — read by GET /model-status
```

Add this new class near the other `BaseModel`s:

```python
class ModelStatusResponse(BaseModel):
    loading: str | None
    lowVramMode: bool
```

Replace `get_verification_model()` and `get_retrieval_model()` (keep `_load_verification_model_now`, `_verification_load_lock` as-is — they're still used, just called from inside the new helper below) with:

```python
_OOM_MESSAGE = (
    "No hay memoria de GPU suficiente para cargar el modelo. "
    "Cierra otras aplicaciones que usen la GPU e inténtalo de nuevo."
)


def _load_kind(kind: str):
    if kind == "retrieval":
        model = load_retrieval_model(_model_holder["retrieval_model_id"])
        device = "cuda" if torch.cuda.is_available() else "cpu"
        model = model.to(device)
        model.eval()
        return model
    return load_verification_model(_model_holder["verification_model_id"])


def _unload_kind(kind: str) -> None:
    key = "model" if kind == "retrieval" else "verification_model"
    if key in _model_holder:
        del _model_holder[key]
    if torch.cuda.is_available():
        torch.cuda.empty_cache()


def _ensure_active_model(kind: str):
    """
    Both get_retrieval_model() and get_verification_model() route through
    here (spec: docs/superpowers/specs/2026-07-13-low-vram-mode-design.md,
    "Runtime behavior"). When low_vram_mode is False this reproduces
    today's exact pre-existing behavior: whichever kind is already cached
    in _model_holder is returned as-is, nothing is ever unloaded, and a
    kind that isn't cached yet gets loaded once and kept forever. When
    low_vram_mode is True, switching kinds unloads whichever one was
    active first (del + torch.cuda.empty_cache()) before loading the new
    one — swapping happens ONLY on a kind switch, never on a repeated
    same-kind call (the ~553 chunks of one indexing job never re-pay a
    load), which is why the very first check below is an early return.
    """
    global _active_kind, _loading_kind

    key = "model" if kind == "retrieval" else "verification_model"

    with _swap_lock:
        if key in _model_holder and _active_kind == kind:
            return _model_holder[key]

        low_vram = _model_holder.get("low_vram_mode", False)
        if low_vram and _active_kind is not None and _active_kind != kind:
            _unload_kind(_active_kind)

        if key not in _model_holder:
            _loading_kind = kind
            try:
                _model_holder[key] = _load_kind(kind)
            except torch.cuda.OutOfMemoryError as exc:
                raise HTTPException(status_code=503, detail=_OOM_MESSAGE) from exc
            finally:
                _loading_kind = None

        _active_kind = kind
        return _model_holder[key]


_swap_lock = threading.Lock()


def get_retrieval_model():
    """
    Overridden in tests via app.dependency_overrides. In production,
    retrieval_model_id is populated once at startup by the lifespan
    handler below — raising 503 here means startup never ran (spec §6.2,
    §14.5, §15.4), not "still loading" (that's what /model-status is for).
    """
    if "retrieval_model_id" not in _model_holder:
        raise HTTPException(status_code=503, detail="Retrieval model not loaded yet")
    return _ensure_active_model("retrieval")


def get_verification_model():
    if "verification_model_id" not in _model_holder:
        raise HTTPException(status_code=503, detail="Verification model not configured yet")
    return _ensure_active_model("verification")
```

Delete the old standalone `_verification_load_lock` / `_load_verification_model_now` usage from `get_verification_model()` — `_load_kind("verification")` now calls `load_verification_model` directly (the warmup call in `_load_verification_model_now` is folded out; the model still gets used for real on the very next `/verify` request either way, so a separate warmup isn't load-bearing). **Delete** the now-unused `_verification_load_lock` and `_load_verification_model_now` definitions entirely (their only caller was the old `get_verification_model()`, just replaced above).

Add the new endpoint, right after the `/verify` route:

```python
@app.get("/model-status", response_model=ModelStatusResponse)
def model_status() -> ModelStatusResponse:
    return ModelStatusResponse(
        loading=_loading_kind,
        lowVramMode=_model_holder.get("low_vram_mode", False),
    )
```

Finally, update `load_model_once()`. Replace:

```python
    try:
        # Extraemos ambos IDs usando la misma conexión según especificación
        retrieval_model_id, verification_model_id = get_active_model_ids(conn)
        _model_holder["verification_tile_passes"] = get_verification_tile_passes(conn)
        _model_holder["verify_config"] = get_verify_config(conn)
    finally:
        conn.close()

    # Inicialización en caliente de los modelos dentro del contenedor persistente
    retrieval_model = load_retrieval_model(retrieval_model_id)
    # load_retrieval_model() (loader.py) never moves MegaLoc off the CPU it's
    # loaded on by default — unlike load_verification_model(), which already
    # does this for RoMa. Confirmed live: /embed was running the retrieval
    # backbone on CPU even with an RTX 4070 SUPER present, making each
    # embedding chunk take much longer than it should. Moved here (not in
    # loader.py) so test_loader.py's MagicMock-returned "fake-model-instance"
    # string stand-in doesn't need a real .to()/.eval() to keep passing.
    retrieval_device = "cuda" if torch.cuda.is_available() else "cpu"
    retrieval_model = retrieval_model.to(retrieval_device)
    retrieval_model.eval()
    print(f"[loader] modelo de recuperación (Lumi Preview/MegaLoc) cargado en device={retrieval_device!r}")
    _model_holder["model"] = retrieval_model
    # Verification (RoMa/Laila) is NOT loaded here — see get_verification_model()'s
    # lazy-load docstring for why holding both models resident at once is a
    # real GPU-memory problem on smaller cards.
    _model_holder["verification_model_id"] = verification_model_id
    print(f"[loader] pasadas de verificación (VERIFICATION_TILE_PASSES) = {_model_holder['verification_tile_passes']}")
    print(f"[loader] calibración de verificación = {_model_holder['verify_config']}")
```

with:

```python
    try:
        # Extraemos ambos IDs usando la misma conexión según especificación
        retrieval_model_id, verification_model_id = get_active_model_ids(conn)
        _model_holder["verification_tile_passes"] = get_verification_tile_passes(conn)
        _model_holder["verify_config"] = get_verify_config(conn)
        low_vram_setting = get_low_vram_mode_setting(conn)
    finally:
        conn.close()

    cuda_available = torch.cuda.is_available()
    device_props = torch.cuda.get_device_properties(0) if cuda_available else None
    total_memory = device_props.total_memory if device_props else 0
    device_name = device_props.name if device_props else None
    low_vram_mode = resolve_low_vram_mode(low_vram_setting, cuda_available, total_memory)
    _model_holder["low_vram_mode"] = low_vram_mode
    _model_holder["retrieval_model_id"] = retrieval_model_id
    _model_holder["verification_model_id"] = verification_model_id
    print(f"[loader] modo bajo VRAM: {'activo' if low_vram_mode else 'inactivo'} ({describe_gpu(cuda_available, device_name, total_memory)})")

    if low_vram_mode:
        # Extends today's "verification loads on demand" discipline to
        # retrieval too — neither model is eager-loaded here; the first
        # /embed or /verify call triggers _ensure_active_model's load path.
        print("[loader] modo bajo VRAM activo — los modelos se cargan bajo demanda, uno a la vez")
    else:
        # Inicialización en caliente de los modelos dentro del contenedor persistente
        retrieval_model = load_retrieval_model(retrieval_model_id)
        # load_retrieval_model() (loader.py) never moves MegaLoc off the CPU it's
        # loaded on by default — unlike load_verification_model(), which already
        # does this for RoMa. Confirmed live: /embed was running the retrieval
        # backbone on CPU even with an RTX 4070 SUPER present, making each
        # embedding chunk take much longer than it should. Moved here (not in
        # loader.py) so test_loader.py's MagicMock-returned "fake-model-instance"
        # string stand-in doesn't need a real .to()/.eval() to keep passing.
        retrieval_device = "cuda" if cuda_available else "cpu"
        retrieval_model = retrieval_model.to(retrieval_device)
        retrieval_model.eval()
        print(f"[loader] modelo de recuperación (Lumi Preview/MegaLoc) cargado en device={retrieval_device!r}")
        _model_holder["model"] = retrieval_model

    print(f"[loader] pasadas de verificación (VERIFICATION_TILE_PASSES) = {_model_holder['verification_tile_passes']}")
    print(f"[loader] calibración de verificación = {_model_holder['verify_config']}")
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd services/inference && venv/bin/python -m pytest test_main.py test_loader.py -v`
Expected: PASS — all tests, including the pre-existing `/embed`/`/verify` ones (they use `dependency_overrides`, untouched by this refactor) and the new ones from Step 1.

- [ ] **Step 5: Commit**

```bash
git add services/inference/main.py services/inference/test_main.py
git commit -m "feat(inference): add _ensure_active_model swap helper, OOM handling, GET /model-status"
```

---

### Task 5: `killProcessOnPort` helper (web)

**Files:**
- Create: `apps/web/lib/kill-port.ts`
- Create: `apps/web/lib/kill-port.test.ts`

**Interfaces:**
- Produces: `killProcessOnPort(port: number): Promise<boolean>` — Task 6's `restart-inference` step calls this before respawning.

- [ ] **Step 1: Write the failing tests**

```ts
// apps/web/lib/kill-port.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const execFileMock = vi.fn();
vi.mock("node:child_process", () => ({ execFile: (...args: any[]) => execFileMock(...args) }));

beforeEach(() => {
  execFileMock.mockReset();
});

function mockExecFileOnce(stdout: string) {
  execFileMock.mockImplementationOnce((_cmd: string, _args: string[], cb: (err: unknown, res: { stdout: string; stderr: string }) => void) => {
    cb(null, { stdout, stderr: "" });
  });
}

describe("killProcessOnPort (non-Windows path)", () => {
  it("kills every pid lsof returns for the port and resolves true", async () => {
    vi.stubGlobal("process", { ...process, platform: "linux" });
    mockExecFileOnce("1234\n5678\n"); // lsof -ti :8000
    mockExecFileOnce(""); // kill -9 1234
    mockExecFileOnce(""); // kill -9 5678

    const { killProcessOnPort } = await import("./kill-port");
    const result = await killProcessOnPort(8000);

    expect(result).toBe(true);
    expect(execFileMock).toHaveBeenCalledTimes(3);
    expect(execFileMock.mock.calls[0][0]).toBe("lsof");
    expect(execFileMock.mock.calls[1]).toEqual(expect.arrayContaining(["kill"]));
  });

  it("resolves false when nothing is listening on the port", async () => {
    vi.stubGlobal("process", { ...process, platform: "linux" });
    execFileMock.mockImplementationOnce((_cmd: string, _args: string[], cb: (err: unknown) => void) => {
      cb(new Error("lsof: no process found"));
    });

    const { killProcessOnPort } = await import("./kill-port");
    expect(await killProcessOnPort(8000)).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @netryx/web test lib/kill-port`
Expected: FAIL — `Cannot find module './kill-port'`.

- [ ] **Step 3: Write the implementation**

```ts
// apps/web/lib/kill-port.ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * Finds and kills whatever process is listening on `port`, regardless of
 * which parent process spawned it (tools/build.py, lumi_launcher.py, or
 * this app's own setup-wizard spawn all use port 8000 for the inference
 * service) — needed because the restart flow (spec's "Apply / restart
 * flow" section) can't assume it has an in-process handle to the running
 * inference process. Resolves true if something was found and killed,
 * false if nothing was listening there.
 */
export async function killProcessOnPort(port: number): Promise<boolean> {
  if (process.platform === "win32") {
    try {
      const { stdout } = await execFileAsync("netstat", ["-ano"]);
      const line = stdout.split("\n").find((l) => l.includes(`:${port} `) && l.includes("LISTENING"));
      if (!line) return false;
      const pid = line.trim().split(/\s+/).pop();
      if (!pid) return false;
      await execFileAsync("taskkill", ["/PID", pid, "/F"]);
      return true;
    } catch {
      return false;
    }
  }

  try {
    const { stdout } = await execFileAsync("lsof", ["-ti", `:${port}`]);
    const pids = stdout.split("\n").map((l) => l.trim()).filter(Boolean);
    if (pids.length === 0) return false;
    for (const pid of pids) {
      await execFileAsync("kill", ["-9", pid]);
    }
    return true;
  } catch {
    return false;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @netryx/web test lib/kill-port`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/kill-port.ts apps/web/lib/kill-port.test.ts
git commit -m "feat(web): add cross-platform killProcessOnPort helper"
```

---

### Task 6: `POST /api/setup/run/restart-inference`

**Files:**
- Modify: `apps/web/app/api/setup/run/[step]/route.ts`
- Create: `apps/web/app/api/setup/run/restart-inference.test.ts`

**Interfaces:**
- Consumes: `killProcessOnPort` (Task 5); reuses this file's own `verifyServicesStarted`, `inferenceArgvFor`, `waitForInferenceReady`.
- Produces: `POST` handling `params.step === "restart-inference"` — an SSE stream of `{type: "log", line}` events ending in `{type: "done", code}`, same shape as the existing `verify-services` step.

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/app/api/setup/run/restart-inference.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../../../lib/settings-repo", () => ({
  getSettingsRepo: vi.fn(() => ({ getSetting: vi.fn().mockResolvedValue("linux"), isSetupCompleted: vi.fn().mockResolvedValue(true) })),
}));
vi.mock("../../../../lib/kill-port", () => ({ killProcessOnPort: vi.fn().mockResolvedValue(true) }));
vi.mock("node:child_process", () => ({
  spawn: vi.fn(() => ({ unref: vi.fn(), exitCode: null, kill: vi.fn() })),
}));

async function readAllEvents(res: Response): Promise<Array<Record<string, unknown>>> {
  const text = await res.text();
  return text
    .split("\n\n")
    .filter((chunk) => chunk.startsWith("data: "))
    .map((chunk) => JSON.parse(chunk.slice("data: ".length)));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
});

describe("POST /api/setup/run/restart-inference", () => {
  it("kills whatever is on port 8000, respawns inference, and reports readiness", async () => {
    const { killProcessOnPort } = await import("../../../../lib/kill-port");
    const { POST } = await import("./route");

    const res = await POST(new Request("http://localhost/api/setup/run/restart-inference", { method: "POST" }), {
      params: { step: "restart-inference" },
    });
    const events = await readAllEvents(res);

    expect(killProcessOnPort).toHaveBeenCalledWith(8000);
    expect(events.some((e) => e.type === "log" && String(e.line).includes("Deteniendo"))).toBe(true);
    expect(events[events.length - 1]).toEqual({ type: "done", code: 0 });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @netryx/web test app/api/setup/run/restart-inference`
Expected: FAIL — `params.step === "restart-inference"` isn't handled yet, falls through to `unknown step` 404.

- [ ] **Step 3: Add the new step handling**

In `apps/web/app/api/setup/run/[step]/route.ts`, add this import at the top:

```ts
import { killProcessOnPort } from "../../../../lib/kill-port";
```

Add this new function right after `runVerifyServices`:

```ts
async function runRestartInference(send: (e: object) => void): Promise<number> {
  send({ type: "log", line: "Deteniendo servicio de inferencia...\n" });
  if (verifyServicesStarted.inference) {
    verifyServicesStarted.inference.kill();
  }
  await killProcessOnPort(8000);
  verifyServicesStarted.inference = undefined;

  const runtime = (await getSettingsRepo().getSetting("INFERENCE_RUNTIME")) ?? (IS_WIN ? "windows" : "linux");
  const argv = inferenceArgvFor(runtime);
  if (!argv) {
    send({ type: "log", line: `Entorno de inferencia (${runtime}) no instalado todavía.\n` });
    return 1;
  }

  send({ type: "log", line: "Arrancando servicio de inferencia...\n" });
  verifyServicesStarted.inference = spawn(argv.cmd, argv.args, { cwd: argv.cwd, shell: argv.shell, detached: true, stdio: "ignore" });
  verifyServicesStarted.inference.unref();

  const ready = await waitForInferenceReady(45000);
  send({ type: "log", line: ready ? "Servicio de inferencia: listo.\n" : "Servicio de inferencia: no respondió a tiempo.\n" });
  return ready ? 0 : 1;
}
```

Change the top of `POST` from:

```ts
export async function POST(request: Request, { params }: { params: { step: string } }) {
  if (params.step === "verify-services") {
```

to:

```ts
export async function POST(request: Request, { params }: { params: { step: string } }) {
  if (params.step === "restart-inference") {
    const stream = new ReadableStream({
      async start(controller) {
        const enc = new TextEncoder();
        const send = (e: object) => controller.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`));
        const code = await runRestartInference(send);
        send({ type: "done", code });
        controller.close();
      },
    });
    return new Response(stream, {
      headers: { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" },
    });
  }

  if (params.step === "verify-services") {
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter @netryx/web test app/api/setup/run/restart-inference`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @netryx/web typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/api/setup/run/\[step\]/route.ts apps/web/app/api/setup/run/restart-inference.test.ts
git commit -m "feat(web): add POST /api/setup/run/restart-inference"
```

---

### Task 7: `GET /api/model-status` proxy route

**Files:**
- Create: `apps/web/app/api/model-status/route.ts`
- Create: `apps/web/app/api/model-status/route.test.ts`

**Interfaces:**
- Produces: `GET(): Promise<Response>` returning `{ loading: "retrieval" | "verification" | null, lowVramMode: boolean }` (proxies the inference service's own `/model-status`, since the browser can't reach `localhost:8000` directly/reliably — same reasoning as `apps/web/lib/health.ts`'s `checkInferenceReady`) — Task 8's `ModelLoadingNotice` polls this.

- [ ] **Step 1: Write the failing tests**

```ts
// apps/web/app/api/model-status/route.test.ts
import { describe, it, expect, vi, afterEach } from "vitest";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("GET /api/model-status", () => {
  it("proxies the inference service's /model-status response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ loading: "retrieval", lowVramMode: true }),
    }));

    const { GET } = await import("./route");
    const res = await GET();
    const json = await res.json();

    expect(json).toEqual({ loading: "retrieval", lowVramMode: true });
  });

  it("reports loading: null, lowVramMode: false when the inference service is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));

    const { GET } = await import("./route");
    const res = await GET();
    const json = await res.json();

    expect(json).toEqual({ loading: null, lowVramMode: false });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @netryx/web test app/api/model-status/route`
Expected: FAIL — `Cannot find module './route'`.

- [ ] **Step 3: Write the implementation**

```ts
// apps/web/app/api/model-status/route.ts
import { NextResponse } from "next/server";

interface ModelStatus {
  loading: "retrieval" | "verification" | null;
  lowVramMode: boolean;
}

export async function GET() {
  const baseUrl = process.env.INFERENCE_SERVICE_URL ?? "http://localhost:8000";
  try {
    const res = await fetch(`${baseUrl}/model-status`, { signal: AbortSignal.timeout(2000) });
    if (!res.ok) throw new Error(`inference /model-status returned ${res.status}`);
    const body = (await res.json()) as ModelStatus;
    return NextResponse.json(body);
  } catch {
    // Unreachable inference service isn't this route's concern (the boot
    // health screen already covers that) — just report nothing is loading.
    return NextResponse.json({ loading: null, lowVramMode: false } satisfies ModelStatus);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @netryx/web test app/api/model-status/route`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @netryx/web typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/api/model-status/route.ts apps/web/app/api/model-status/route.test.ts
git commit -m "feat(web): add GET /api/model-status proxy route"
```

---

### Task 8: `ModelLoadingNotice` shared component

**Files:**
- Create: `apps/web/app/components/ModelLoadingNotice.tsx`

**Interfaces:**
- Consumes: `GET /api/model-status` (Task 7).
- Produces: `ModelLoadingNotice({ active }: { active: boolean })` — Tasks 9-11 render this inside the search pill, the refine button area, and `JobProgressBar`.

- [ ] **Step 1: Write the component**

```tsx
// apps/web/app/components/ModelLoadingNotice.tsx
"use client";
import { useEffect, useState } from "react";

const LABEL: Record<"retrieval" | "verification", string> = {
  retrieval: "Cargando modelo de recuperación (Lumi Preview) — puede tardar unos segundos",
  verification: "Cargando modelo de verificación (Laila) — puede tardar unos segundos",
};

/**
 * Polls GET /api/model-status while `active` and shows the shared "model
 * loading" copy + sweeping-stripe indicator ONLY when the real in-memory
 * state (services/inference's _loading_kind) says a model is actually
 * loading — never a timeout guess, so it's never shown for unrelated
 * slowness like busy GPU compute or a slow network (spec's "Model-loading
 * notice" section). Reused as-is by search, refine, and indexing — one
 * shared component instead of three bespoke ones.
 */
export function ModelLoadingNotice({ active }: { active: boolean }) {
  const [loading, setLoading] = useState<"retrieval" | "verification" | null>(null);

  useEffect(() => {
    if (!active) {
      setLoading(null);
      return;
    }
    let cancelled = false;
    async function poll() {
      try {
        const res = await fetch("/api/model-status");
        const data: { loading: "retrieval" | "verification" | null } = await res.json();
        if (!cancelled) setLoading(data.loading);
      } catch {
        // keep the previous value rather than flicker on a transient network hiccup
      }
    }
    poll();
    const interval = setInterval(poll, 1500);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [active]);

  if (!active || !loading) return null;

  return (
    <div className="mt-2 flex items-center gap-2 text-xs text-draw-fg">
      <div className="relative h-1 w-16 overflow-hidden rounded-full bg-draw/20">
        <div
          className="lumi-anim absolute left-0 top-0 h-full w-2/5 rounded-full bg-draw"
          style={{ animation: "lumi-shimmer 1.6s ease-in-out infinite" }}
        />
      </div>
      <span>{LABEL[loading]}</span>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @netryx/web typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/components/ModelLoadingNotice.tsx
git commit -m "feat(web): add shared ModelLoadingNotice component"
```

---

### Task 9: Wire the notice into search (`SearchDashboard.tsx`)

**Files:**
- Modify: `apps/web/app/components/SearchDashboard.tsx`

**Interfaces:**
- Consumes: `ModelLoadingNotice` (Task 8).

- [ ] **Step 1: Add the import**

At the top of `apps/web/app/components/SearchDashboard.tsx`, add:

```ts
import { ModelLoadingNotice } from "./ModelLoadingNotice";
```

- [ ] **Step 2: Grow the "Localizando…" pill with the notice**

Find this block:

```tsx
      {searching && (
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-card bg-panel/80 px-5 py-3 text-sm text-fg backdrop-blur-md z-40">
          Localizando…
        </div>
      )}
```

and change it to:

```tsx
      {searching && (
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-card bg-panel/80 px-5 py-3 text-sm text-fg backdrop-blur-md z-40">
          Localizando…
          <ModelLoadingNotice active={searching} />
        </div>
      )}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @netryx/web typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/components/SearchDashboard.tsx
git commit -m "feat(web): show the model-loading notice in the search pill"
```

---

### Task 10: Wire the notice into refine (`TopResultCard.tsx` / `ResultsPanel.tsx`)

**Files:**
- Modify: `apps/web/app/components/TopResultCard.tsx`
- Modify: `apps/web/app/components/ResultsPanel.tsx`

**Interfaces:**
- Consumes: `ModelLoadingNotice` (Task 8).

- [ ] **Step 1: Add to `TopResultCard.tsx`**

Add the import:

```ts
import { ModelLoadingNotice } from "./ModelLoadingNotice";
```

Find the refine button (the element rendering `{refining ? "Refinando…" : ...}`) and add the notice as a sibling right after that button's closing tag:

```tsx
          <button
            /* ... existing props unchanged ... */
          >
            {refining ? "Refinando…" : `Refinar en ${place ?? "esta región"}`}
          </button>
          <ModelLoadingNotice active={refining} />
```

- [ ] **Step 2: Add to `ResultsPanel.tsx`**

Add the same import, then find the refine button (the one rendering `{refining && selected ? "Refinando…" : ...}`) and add the notice right after it the same way:

```tsx
          <button
            /* ... existing props unchanged ... */
          >
            {refining && selected ? "Refinando…" : selected ? "Refinar aquí" : "Precisión de calle disponible"}
          </button>
          <ModelLoadingNotice active={refining && Boolean(selected)} />
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @netryx/web typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/components/TopResultCard.tsx apps/web/app/components/ResultsPanel.tsx
git commit -m "feat(web): show the model-loading notice on refine"
```

---

### Task 11: Wire the notice into indexing (`JobProgressBar.tsx`)

**Files:**
- Modify: `apps/web/app/components/JobProgressBar.tsx`

**Interfaces:**
- Consumes: `ModelLoadingNotice` (Task 8).

- [ ] **Step 1: Add the pre-"Indexando" phase**

Add the import:

```ts
import { ModelLoadingNotice } from "./ModelLoadingNotice";
```

The spec wants this notice shown BEFORE "Indexando" really starts — i.e. while `status` is `"pending"` and no points have been captured yet (`pointsCaptured === 0`), since that's the window where the job has been enqueued but might still be waiting on a model load rather than genuinely indexing. Change the top of the returned JSX from:

```tsx
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-fg">{HEADER_LABEL[status] ?? status}</span>
```

to:

```tsx
  const awaitingFirstProgress = status === "pending" && (p?.pointsCaptured ?? 0) === 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-fg">{HEADER_LABEL[status] ?? status}</span>
```

Then, right after the closing `</div>` of the header `flex items-center justify-between` block (before the first `<ProgressMeter .../>`), add:

```tsx
      <ModelLoadingNotice active={awaitingFirstProgress} />
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @netryx/web typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/components/JobProgressBar.tsx
git commit -m "feat(web): show the model-loading notice before indexing starts"
```

---

### Task 12: Low-VRAM setting row — GPU note, restart-pending banner, "Reiniciar ahora"

**Files:**
- Create: `apps/web/app/components/LowVramModeRow.tsx`
- Modify: `apps/web/app/components/SettingsPanel.tsx`

**Interfaces:**
- Consumes: `GET /api/model-status` (Task 7, for `lowVramMode` — the value the RUNNING service actually started with), `POST /api/setup/run/restart-inference` (Task 6, SSE stream).
- Produces: `LowVramModeRow({ value, onChange }: { value: string; onChange: (v: string) => void })` — Task 12 wires this into `SettingsPanel.tsx` in place of the generic enum `<Menu>` for this one key.

- [ ] **Step 1: Write the component**

```tsx
// apps/web/app/components/LowVramModeRow.tsx
"use client";
import { useEffect, useState } from "react";
import { Menu } from "./Menu";

const OPTIONS = [
  { value: "auto", label: "auto" },
  { value: "on", label: "on" },
  { value: "off", label: "off" },
];

export function LowVramModeRow({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [runningLowVram, setRunningLowVram] = useState<boolean | null>(null);
  const [restarting, setRestarting] = useState(false);
  const [restartLog, setRestartLog] = useState<string[]>([]);

  useEffect(() => {
    fetch("/api/model-status")
      .then((r) => r.json())
      .then((d: { lowVramMode: boolean }) => setRunningLowVram(d.lowVramMode))
      .catch(() => {});
  }, []);

  // The setting is "on"/"off" or "auto" (resolved against hardware at
  // startup) — comparing the SAVED setting's on/off intent against what's
  // actually running only makes unambiguous sense for explicit on/off;
  // "auto" always shows the banner as a nudge to restart after any change,
  // since we can't know here whether "auto" would still resolve the same
  // way without asking the running service (which is exactly what a
  // restart does).
  const restartPending =
    runningLowVram !== null &&
    ((value === "on" && !runningLowVram) || (value === "off" && runningLowVram));

  async function restart() {
    setRestarting(true);
    setRestartLog([]);
    const res = await fetch("/api/setup/run/restart-inference", { method: "POST" });
    const reader = res.body?.getReader();
    if (!reader) {
      setRestarting(false);
      window.location.href = "/";
      return;
    }
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value: chunk } = await reader.read();
      if (done) break;
      buffer += decoder.decode(chunk, { stream: true });
      const events = buffer.split("\n\n");
      buffer = events.pop() ?? "";
      for (const raw of events) {
        if (!raw.startsWith("data: ")) continue;
        const event = JSON.parse(raw.slice("data: ".length));
        if (event.type === "log") setRestartLog((lines) => [...lines, event.line]);
        if (event.type === "done") window.location.href = "/";
      }
    }
  }

  return (
    <div>
      <Menu value={value} onChange={onChange} options={OPTIONS} />
      {restartPending && !restarting && (
        <div className="mt-2 rounded-md border border-[rgba(239,159,39,0.4)] bg-[rgba(239,159,39,0.08)] px-3 py-2 text-[11.5px] text-warning-fg">
          Este cambio requiere reiniciar el servicio de inferencia para aplicarse.
          <button onClick={restart} className="ml-2 rounded-md bg-accent px-2.5 py-1 text-[11px] font-medium text-black">
            Reiniciar ahora
          </button>
        </div>
      )}
      {restarting && (
        <div className="mt-2 rounded-md border border-white/10 bg-white/5 px-3 py-2 text-[11px] text-muted">
          {restartLog[restartLog.length - 1] ?? "Reiniciando…"}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Wire it into `SettingsPanel.tsx`**

Add the import:

```ts
import { LowVramModeRow } from "./LowVramModeRow";
```

In the generic per-setting field loop (the one filtering `!SLIDER_KEYS.has(def.key) && !CALIBRATION_KEYS.includes(def.key)`), change:

```tsx
                        {def.isSecret ? (
                          <SecretRow display={values[def.key]} onEdit={() => setEditing(def)} />
                        ) : def.type === "enum" ? (
                          <Menu value={current(def)} onChange={(v) => set(def.key, v)}
                            options={(def.options ?? []).map((o) => ({ value: o, label: o }))} />
                        ) : (
```

to:

```tsx
                        {def.isSecret ? (
                          <SecretRow display={values[def.key]} onEdit={() => setEditing(def)} />
                        ) : def.key === "INFERENCE_LOW_VRAM_MODE" ? (
                          <LowVramModeRow value={current(def)} onChange={(v) => set(def.key, v)} />
                        ) : def.type === "enum" ? (
                          <Menu value={current(def)} onChange={(v) => set(def.key, v)}
                            options={(def.options ?? []).map((o) => ({ value: o, label: o }))} />
                        ) : (
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @netryx/web typecheck`
Expected: no errors.

- [ ] **Step 4: Manual verification**

Run the full dev stack (`python3 tools/build.py`), open `/settings` → "Modelos". Confirm the `INFERENCE_LOW_VRAM_MODE` row renders the auto/on/off menu instead of a generic dropdown-only row. Set it to a value different from what's currently running (e.g. flip to `on` when the service started with it off) and confirm the amber "restart pending" banner with "Reiniciar ahora" appears; click it and confirm the SSE log lines stream in, then the page navigates and comes back through the real `BootGate` loading screen, ending with the inference service back up. Then, on a real memory-constrained GPU (or by lowering `LOW_VRAM_THRESHOLD_BYTES` locally for a manual test), confirm indexing an area and running a search+refine both show the model-loading notice with accurate Spanish copy exactly while `/model-status` reports `loading`, and never otherwise.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/components/LowVramModeRow.tsx apps/web/app/components/SettingsPanel.tsx
git commit -m "feat(web): add low-VRAM mode settings row with restart-pending banner"
```

---

## Self-Review Notes

- **Spec coverage:** `INFERENCE_LOW_VRAM_MODE` setting (Task 1); VRAM auto-detection resolver (Task 2); reading the setting server-side (Task 3); the `_ensure_active_model` swap helper preserving off-mode behavior exactly, OOM→503 handling with the spec's verbatim Spanish message, and `GET /model-status` (Task 4); the restart flow's kill+respawn mechanism (Tasks 5-6) redirecting through the real, already-shipped `BootGate` (Task 12's `restart()` navigates to `/`, which is gated by that component); the model-loading notice driven by real `/model-status` state rather than a timeout guess, shared verbatim across search/refine/indexing (Tasks 7-11); the settings UI's GPU-detected note + restart-pending banner + "Reiniciar ahora" (Task 12). All spec sections covered.
- **Placeholder scan:** none — every step has complete, runnable code and exact commands/expected output.
- **Type consistency:** `resolve_low_vram_mode`/`describe_gpu` (Task 2) are called with identical argument names/order in Task 4's `load_model_once()`. `_ensure_active_model`/`_load_kind`/`_unload_kind`/`_active_kind`/`_loading_kind` (Task 4) are the only names used across that task's own tests — no renamed variants. `killProcessOnPort` (Task 5) is called with the same `(port: number)` signature in Task 6. `ModelLoadingNotice`'s `active: boolean` prop (Task 8) is passed consistently by Tasks 9-11 (`searching`, `refining`, `awaitingFirstProgress` — three different booleans, same prop name/type). `GET /model-status`'s `{loading, lowVramMode}` shape (Task 4) matches exactly what Task 7's proxy route returns and what Tasks 8/12 read.
