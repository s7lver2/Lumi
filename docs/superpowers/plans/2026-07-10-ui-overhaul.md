# Lumi UI Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rework Lumi's frontend to a white-accent (no green) dark aesthetic with fluid animations, redesign the loading screen and setup wizard around a rotating-gray-planet space motif, make Settings' API keys masked/non-copyable with a lock→overwrite popup, and fix the broken Entrenamiento toolbar + the broken setup build.

**Architecture:** Next.js 14 App Router (`apps/web`), pnpm monorepo. Pure logic (masking, migration-progress parsing, wizard-step machine) is unit-tested with vitest; React components that touch the map/WebGL/SSE/forms are verified manually + by `tsc`. Animations use `framer-motion` with a shared presets module and always honor `prefers-reduced-motion`. The space background is pure CSS (transform loops), not WebGL.

**Tech Stack:** TypeScript, React 18.3, Next.js 14.2.5, Tailwind 3.4, Zustand, framer-motion (new), vitest.

## Global Constraints

- Accent color is **white** (`accent.DEFAULT = "#f2f3f5"`, `accent.fg = "#e8e8e6"`). The green `#5dcaa5` / `#1d9e75` is **banned** everywhere. "ok/verified" states use a white check, never green. Keep blue `#85b7eb`, purple `#a89fff`, amber `#f0c477`, red `#f09595` for categories/semantics.
- Model display names: retrieval = **"Lumi Preview"** (engine MegaLoc), verification = **"Laila"** (engine RoMa). App brand = "Lumi".
- `route.ts` / `layout.tsx` / `page.tsx` may only export HTTP handlers or `default` + config; helpers live in sibling modules.
- Imports are relative (no path aliases) in `apps/web`.
- No Tabler/icon webfont exists in the app — use inline SVG or CSS, never `<i class="ti …">`.
- Every new animation respects `prefers-reduced-motion`.
- Do NOT kill the user's node/dev-server processes; verify with `pnpm --filter @netryx/web typecheck` and vitest.
- Commit after every task.
- Run unit tests from `apps/web`: `pnpm --filter @netryx/web test`. Run a single file: `pnpm --filter @netryx/web test <path>`.

---

## Phase 0 — Fix Entrenamiento (unblock the training page)

### Task 1: Allow clearing the indexing estimate

**Files:**
- Modify: `apps/web/app/stores/useIndexingStore.ts:25`
- Test: `apps/web/app/stores/useIndexingStore.test.ts`

**Interfaces:**
- Produces: `setEstimate(estimate: Estimate | null): void` on `useIndexingStore`.

- [ ] **Step 1: Write the failing test** — append inside the `describe("useIndexingStore", …)` block in `useIndexingStore.test.ts`:

```ts
it("sets and clears the estimate", () => {
  useIndexingStore.getState().setEstimate({ pointsEstimated: 100, estimatedCostUsd: 1.5 });
  expect(useIndexingStore.getState().estimate?.pointsEstimated).toBe(100);
  useIndexingStore.getState().setEstimate(null);
  expect(useIndexingStore.getState().estimate).toBeNull();
});
```

- [ ] **Step 2: Run test to verify it passes at runtime but typecheck fails**

Run: `pnpm --filter @netryx/web test app/stores/useIndexingStore.test.ts`
Expected: PASS (runtime accepts null already).
Run: `pnpm --filter @netryx/web typecheck`
Expected: FAIL — `app/(protected)/index/page.tsx` line ~109 `Argument of type 'null' is not assignable to parameter of type 'Estimate'`.

- [ ] **Step 3: Widen the type** — in `useIndexingStore.ts`, change the interface line:

```ts
  setEstimate: (estimate: Estimate | null) => void;
```

(The implementation `setEstimate: (estimate) => set({ estimate })` is unchanged.)

- [ ] **Step 4: Verify typecheck advances** — Run: `pnpm --filter @netryx/web typecheck`
Expected: the `setEstimate(null)` error is gone (other unrelated errors from Tasks 2–3 may remain).

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/stores/useIndexingStore.ts apps/web/app/stores/useIndexingStore.test.ts
git commit -m "fix(web): allow setEstimate(null) to clear the indexing estimate"
```

### Task 2: DrawToolbar becomes layout-only with a consistent prop name

**Files:**
- Modify: `apps/web/app/components/DrawToolbar.tsx` (rewrite)

**Interfaces:**
- Produces: `DrawToolbar({ mode, onModeChange, onUndo, onRedo, onClear })` where `onModeChange: (m: "polygon" | "rectangle" | "circle") => void`. No internal absolute positioning — the parent positions it.

- [ ] **Step 1: Rewrite the file**

```tsx
// apps/web/app/components/DrawToolbar.tsx
"use client";
export function DrawToolbar({
  mode, onModeChange, onUndo, onRedo, onClear,
}: {
  mode: string;
  onModeChange: (m: "polygon" | "rectangle" | "circle") => void;
  onUndo: () => void; onRedo: () => void; onClear: () => void;
}) {
  const btn = (active: boolean) =>
    `rounded-md px-2.5 py-1.5 text-xs ${active ? "bg-accent text-black" : "text-fg hover:bg-white/10"}`;
  return (
    <div className="inline-flex gap-1 rounded-card border border-white/10 bg-panel/80 p-1 backdrop-blur-md shadow-lg shadow-black/40">
      <button className={btn(mode === "polygon")} onClick={() => onModeChange("polygon")}>Polígono</button>
      <button className={btn(mode === "rectangle")} onClick={() => onModeChange("rectangle")}>Rectángulo</button>
      <button className={btn(mode === "circle")} onClick={() => onModeChange("circle")}>Círculo</button>
      <span className="mx-1 w-px bg-white/10" />
      <button className={btn(false)} onClick={onUndo} aria-label="Deshacer">↶</button>
      <button className={btn(false)} onClick={onRedo} aria-label="Rehacer">↷</button>
      <button className={btn(false)} onClick={onClear}>Borrar</button>
    </div>
  );
}
```

- [ ] **Step 2: Verify typecheck** — Run: `pnpm --filter @netryx/web typecheck`
Expected: the `onModeChange` vs `onMode` mismatch on `index/page.tsx:152` is resolved (page already passes `onModeChange`).

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/components/DrawToolbar.tsx
git commit -m "fix(web): make DrawToolbar layout-only and rename prop to onModeChange"
```

### Task 3: Remove the Image Dropzone test card from Entrenamiento

**Files:**
- Modify: `apps/web/app/(protected)/index/page.tsx` (remove import ~line 15-16 and the test `FloatingCard` block ~line 171-182)

- [ ] **Step 1: Delete the temporary import** — remove these two lines near the top:

```tsx
// 🛠️ IMPORTACIÓN TEMPORAL PARA LA VERIFICACIÓN DE DROPZONE
import { ImageDropzone } from "../../components/ImageDropzone";
```

- [ ] **Step 2: Delete the test card block** — remove the entire block inside the right-side container (leave the "PANEL ORIGINAL DE INDEXACIÓN" `FloatingCard` intact):

```tsx
        {/* 🛠️ TARJETA SCRATCH TEMPORAL PARA COMPROBAR EL DROPZONE */}
        <FloatingCard className="p-4 border border-dashed border-accent/40">
          <h2 className="text-xs font-semibold text-accent-fg uppercase tracking-wider mb-2">
            Test: Image Dropzone
          </h2>
          <ImageDropzone
            onImage={(file) => {
              console.log("📸 [Dropzone Event] Archivo recibido en la página:");
              console.log(`Nombre: ${file.name} | Tamaño: ${(file.size / 1024).toFixed(2)} KB`);
            }}
          />
        </FloatingCard>
```

- [ ] **Step 3: Verify** — Run: `pnpm --filter @netryx/web typecheck`
Expected: PASS clean (all three Phase-0 errors gone). Manual: load `/index`, confirm the draw toolbar is visible at bottom-center and the areas notification (top-right) no longer overlaps it.

- [ ] **Step 4: Commit**

```bash
git add "apps/web/app/(protected)/index/page.tsx"
git commit -m "fix(web): remove temporary Image Dropzone test card from training page"
```

---

## Phase 1 — Design foundation

### Task 4: White accent palette (remove green token)

**Files:**
- Modify: `apps/web/tailwind.config.ts:17`

- [ ] **Step 1: Swap the accent token**

```ts
// before
accent: { DEFAULT: "#1d9e75", fg: "#5dcaa5" },
// after
accent: { DEFAULT: "#f2f3f5", fg: "#e8e8e6" },
```

- [ ] **Step 2: Verify** — Run: `pnpm --filter @netryx/web typecheck`
Expected: PASS. Manual: buttons that used `bg-accent text-black` now render white with dark text.

- [ ] **Step 3: Commit**

```bash
git add apps/web/tailwind.config.ts
git commit -m "feat(web): switch primary accent to white, drop green"
```

### Task 5: Remove green literals from map layers

**Files:**
- Modify: `apps/web/app/components/ConfidenceCircleLayer.tsx` (lines with `#5dcaa5`)
- Modify: `apps/web/app/(protected)/index/page.tsx` (`renderAreaOnMap`, the `area-points-dots` color)

- [ ] **Step 1: Confirm the hits** — Run: `rg -n "#5dcaa5|#1d9e75" apps/web/app`
Expected: matches in `ConfidenceCircleLayer.tsx` (fill, line, selected stroke) and `index/page.tsx` (`renderAreaOnMap`).

- [ ] **Step 2: Recolor ConfidenceCircleLayer** — in `ConfidenceCircleLayer.tsx` replace:
  - `"fill-color": "#5dcaa5"` → `"fill-color": "#e8e8e6"`
  - `"line-color": "#5dcaa5"` → `"line-color": "#e8e8e6"`
  - `"circle-stroke-color": ["case", ["get", "selected"], "#5dcaa5", "#4a4c50"]` → `["case", ["get", "selected"], "#e8e8e6", "#4a4c50"]`

- [ ] **Step 3: Recolor the area dots** — in `index/page.tsx` `renderAreaOnMap`, change the `area-points-dots` paint `"circle-color": "#5dcaa5"` → `"circle-color": "#e8e8e6"`. Leave the polygon line `#85b7eb` (blue is allowed).

- [ ] **Step 4: Verify** — Run: `rg -n "#5dcaa5|#1d9e75" apps/web/app`
Expected: no matches. Run: `pnpm --filter @netryx/web typecheck` → PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/components/ConfidenceCircleLayer.tsx "apps/web/app/(protected)/index/page.tsx"
git commit -m "feat(web): recolor map confidence + area layers from green to neutral white"
```

### Task 6: Add framer-motion

**Files:**
- Modify: `apps/web/package.json` (dependencies)

- [ ] **Step 1: Add the dependency**

```bash
pnpm --filter @netryx/web add framer-motion@^11.11.0
```

- [ ] **Step 2: Verify** — Run: `pnpm --filter @netryx/web exec -- node -e "require.resolve('framer-motion'); console.log('ok')"`
Expected: prints `ok`.

- [ ] **Step 3: Commit**

```bash
git add apps/web/package.json pnpm-lock.yaml
git commit -m "chore(web): add framer-motion"
```

### Task 7: Motion presets module

**Files:**
- Create: `apps/web/app/lib/motion.ts`

**Interfaces:**
- Produces: named `Variants` exports `fadeRise`, `popIn`, `overlay`, `staggerContainer`, `staggerItem`.

- [ ] **Step 1: Create the file**

```ts
// apps/web/app/lib/motion.ts
import type { Variants } from "framer-motion";

export const fadeRise: Variants = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { type: "spring", stiffness: 260, damping: 26 } },
  exit: { opacity: 0, y: 8, transition: { duration: 0.15 } },
};
export const popIn: Variants = {
  hidden: { opacity: 0, scale: 0.96, y: 6 },
  show: { opacity: 1, scale: 1, y: 0, transition: { type: "spring", stiffness: 320, damping: 28 } },
  exit: { opacity: 0, scale: 0.97, transition: { duration: 0.12 } },
};
export const overlay: Variants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { duration: 0.18 } },
  exit: { opacity: 0, transition: { duration: 0.12 } },
};
export const staggerContainer: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.05 } },
};
export const staggerItem: Variants = fadeRise;
```

- [ ] **Step 2: Verify** — Run: `pnpm --filter @netryx/web typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/lib/motion.ts
git commit -m "feat(web): add framer-motion presets"
```

### Task 8: Space + spinner keyframes in globals.css

**Files:**
- Modify: `apps/web/app/globals.css` (append)

- [ ] **Step 1: Append the keyframes**

```css
@keyframes lumi-planet-spin { from { transform: translateX(0); } to { transform: translateX(-50%); } }
@keyframes lumi-orbit { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
@keyframes lumi-twinkle { 0%, 100% { opacity: .2; } 50% { opacity: .9; } }
@keyframes lumi-shimmer { 0% { transform: translateX(-140%); } 100% { transform: translateX(360%); } }
@keyframes lumi-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) {
  .lumi-anim { animation: none !important; }
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/app/globals.css
git commit -m "feat(web): add space + spinner keyframes"
```

### Task 9: PlanetBackground component

**Files:**
- Create: `apps/web/app/components/PlanetBackground.tsx`

**Interfaces:**
- Produces: `PlanetBackground({ satellite?: boolean })` — an absolutely-positioned `-z-10` space layer (dark bg, twinkling stars, a rotating gray planet, optional orbiting satellite). Parent must be `relative`.

- [ ] **Step 1: Create the file**

```tsx
// apps/web/app/components/PlanetBackground.tsx
"use client";
const STARS = [
  { t: "8%", l: "12%", d: "0s" }, { t: "16%", l: "76%", d: ".6s" }, { t: "26%", l: "40%", d: "1.2s" },
  { t: "12%", l: "58%", d: "1.8s" }, { t: "70%", l: "8%", d: ".4s" }, { t: "82%", l: "30%", d: "2.1s" },
  { t: "60%", l: "88%", d: "1.5s" }, { t: "40%", l: "92%", d: ".9s" },
];
const PLANET_TEX =
  "radial-gradient(70px 46px at 8% 32%,rgba(255,255,255,.06),transparent 70%)," +
  "radial-gradient(90px 56px at 26% 64%,rgba(0,0,0,.28),transparent 70%)," +
  "radial-gradient(56px 44px at 44% 40%,rgba(255,255,255,.05),transparent 70%)," +
  "radial-gradient(100px 66px at 62% 72%,rgba(0,0,0,.24),transparent 70%)," +
  "radial-gradient(70px 46px at 58% 32%,rgba(255,255,255,.06),transparent 70%),#3a3f47";

export function PlanetBackground({ satellite = false }: { satellite?: boolean }) {
  return (
    <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden bg-[#05070a]">
      {STARS.map((s, i) => (
        <span key={i} className="lumi-anim absolute h-0.5 w-0.5 rounded-full bg-white"
          style={{ top: s.t, left: s.l, animation: `lumi-twinkle 3s ease-in-out ${s.d} infinite` }} />
      ))}
      <div className="absolute -right-40 -bottom-52 h-[520px] w-[520px] overflow-hidden rounded-full"
        style={{ background: "#33383f", boxShadow: "0 0 130px 24px rgba(150,160,175,.10), inset -34px -22px 90px rgba(0,0,0,.65)" }}>
        <div className="lumi-anim absolute left-0 top-0 h-full w-[200%]"
          style={{ animation: "lumi-planet-spin 70s linear infinite", background: PLANET_TEX }} />
        <div className="absolute inset-0 rounded-full"
          style={{ background: "radial-gradient(circle at 30% 28%,transparent 42%,rgba(0,0,0,.55) 100%)" }} />
      </div>
      {satellite && (
        <div className="lumi-anim absolute -bottom-32 left-1/2 -ml-[260px] h-[520px] w-[520px]"
          style={{ animation: "lumi-orbit 14s linear infinite" }}>
          <div className="absolute -top-1 left-1/2 -ml-[3px] h-[7px] w-[7px] rounded-full bg-[#f4f6f9]"
            style={{ boxShadow: "0 0 10px 2px rgba(255,255,255,.6)" }} />
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify** — Run: `pnpm --filter @netryx/web typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/components/PlanetBackground.tsx
git commit -m "feat(web): add PlanetBackground space layer"
```

---

## Phase 2 — Loading screen

### Task 10: Redesign the BootGate splash

**Files:**
- Modify: `apps/web/app/components/LoadingScreen.tsx` (rewrite the `!ready` block, keep the fetch logic)

**Interfaces:**
- Consumes: `PlanetBackground` (Task 9).

- [ ] **Step 1: Rewrite the file**

```tsx
// apps/web/app/components/LoadingScreen.tsx
"use client";
import { useEffect, useState } from "react";
import { PlanetBackground } from "./PlanetBackground";

export function BootGate({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    fetch("/api/map-config").catch(() => {}).finally(() => setReady(true));
  }, []);
  if (!ready) {
    return (
      <div className="fixed inset-0 flex flex-col items-center justify-center overflow-hidden">
        <PlanetBackground satellite />
        <div className="relative text-center" style={{ marginBottom: 120 }}>
          <div className="text-5xl font-medium tracking-[6px] text-fg">Lumi</div>
          <p className="mt-2 text-sm text-muted">Preparando tu espacio de trabajo…</p>
          <div className="relative mx-auto mt-5 h-[3px] w-56 overflow-hidden rounded-full bg-white/10">
            <div className="lumi-anim absolute left-0 top-0 h-full w-2/5 rounded-full"
              style={{ background: "linear-gradient(90deg,transparent,#f4f6f9,transparent)", animation: "lumi-shimmer 1.6s ease-in-out infinite" }} />
          </div>
        </div>
      </div>
    );
  }
  return <>{children}</>;
}
```

- [ ] **Step 2: Verify** — Run: `pnpm --filter @netryx/web typecheck`
Expected: PASS. Manual: reload the app; the planet + shimmer splash shows, then content.

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/components/LoadingScreen.tsx
git commit -m "feat(web): redesign loading screen with planet + shimmer"
```

---

## Phase 3 — Settings (masked keys, lock → overwrite popup)

### Task 11: maskSecret helper (TDD)

**Files:**
- Create: `apps/web/app/settings/mask.ts`
- Test: `apps/web/app/settings/mask.test.ts`

**Interfaces:**
- Produces: `maskSecret(value: string): string` — first 4 chars followed by exactly 12 `•`; `""` for empty input.

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/app/settings/mask.test.ts
import { describe, it, expect } from "vitest";
import { maskSecret } from "./mask";

describe("maskSecret", () => {
  it("shows the first 4 chars then 12 dots", () => {
    expect(maskSecret("AIzaSyRealSecret")).toBe("AIza" + "•".repeat(12));
  });
  it("handles values shorter than 4 chars", () => {
    expect(maskSecret("AI")).toBe("AI" + "•".repeat(12));
  });
  it("returns empty string for empty input", () => {
    expect(maskSecret("")).toBe("");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @netryx/web test app/settings/mask.test.ts`
Expected: FAIL — cannot find module `./mask`.

- [ ] **Step 3: Implement**

```ts
// apps/web/app/settings/mask.ts
const DOTS = "•".repeat(12);
/** Muestra los primeros 4 caracteres del secreto; el resto se enmascara. */
export function maskSecret(value: string): string {
  if (!value) return "";
  return value.slice(0, 4) + DOTS;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @netryx/web test app/settings/mask.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/settings/mask.ts apps/web/app/settings/mask.test.ts
git commit -m "feat(web): add maskSecret helper"
```

### Task 12: Settings GET returns a preview for secrets

**Files:**
- Modify: `apps/web/app/api/settings/route.ts` (GET loop; remove unused `MASK`)
- Test: `apps/web/app/api/settings/route.test.ts:34-44`

**Interfaces:**
- Consumes: `maskSecret` (Task 11).

- [ ] **Step 1: Update the test expectation** — in `route.test.ts`, add the import at top:

```ts
import { maskSecret } from "../../settings/mask";
```

and change the masked assertion (line ~43):

```ts
    expect(json.GOOGLE_MAPS_API_KEY).toBe(maskSecret("AIzaSyRealSecret"));
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @netryx/web test app/api/settings/route.test.ts`
Expected: FAIL — receives `"••••••••"`, expected `"AIza" + 12 dots`.

- [ ] **Step 3: Implement** — in `route.ts` add the import and update the GET loop; delete the now-unused `const MASK = "••••••••";`:

```ts
import { maskSecret } from "../../settings/mask";
// ...
export async function GET() {
  const repo = getSettingsRepo();
  const result: Record<string, string> = {};
  for (const def of SETTINGS_SCHEMA) {
    const value = await repo.getSetting(def.key);
    if (value === null) continue;
    result[def.key] = def.isSecret ? maskSecret(value) : value;
  }
  return NextResponse.json(result);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @netryx/web test app/api/settings/route.test.ts`
Expected: PASS (all GET + PATCH tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/api/settings/route.ts apps/web/app/api/settings/route.test.ts
git commit -m "feat(web): settings GET returns first-4-char preview for secrets"
```

### Task 13: Restore the sections coverage guard test

**Files:**
- Modify: `apps/web/app/settings/sections.test.ts` (currently empty — populate)

**Interfaces:**
- Consumes: `groupSettings()` and `SETTINGS_SECTIONS` from `./sections`.

- [ ] **Step 1: Write the test**

```ts
// apps/web/app/settings/sections.test.ts
import { describe, it, expect } from "vitest";
import { SETTINGS_SCHEMA } from "@netryx/shared-types";
import { groupSettings, SETTINGS_SECTIONS } from "./sections";

describe("settings sections", () => {
  it("assigns every schema key to exactly one section", () => {
    const keys = SETTINGS_SECTIONS.flatMap((s) => s.keys);
    expect(new Set(keys).size).toBe(keys.length); // no duplicates
    expect([...keys].sort()).toEqual(SETTINGS_SCHEMA.map((d) => d.key).sort());
  });
  it("groupSettings returns one entry per section with resolved defs", () => {
    const groups = groupSettings();
    expect(groups.map((g) => g.section.id)).toEqual(SETTINGS_SECTIONS.map((s) => s.id));
    for (const g of groups) expect(g.defs.length).toBe(g.section.keys.length);
  });
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `pnpm --filter @netryx/web test app/settings/sections.test.ts`
Expected: PASS (2 tests). If it FAILS on the coverage assertion, a schema key is unassigned in `sections.ts` — add it to the correct section, then rerun.

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/settings/sections.test.ts
git commit -m "test(web): restore settings-sections coverage guard"
```

### Task 14: OverwriteKeyModal

**Files:**
- Create: `apps/web/app/components/OverwriteKeyModal.tsx`

**Interfaces:**
- Consumes: `fetchJson` (`app/lib/fetch-json`), `maskSecret` (Task 11), `popIn`/`overlay` (Task 7), `SettingDefinition` (`@netryx/shared-types`), `POST /api/setup/test-key`, `PATCH /api/settings`.
- Produces: `OverwriteKeyModal({ def, onClose, onSaved })` where `onSaved: (preview: string) => void`.

- [ ] **Step 1: Create the file**

```tsx
// apps/web/app/components/OverwriteKeyModal.tsx
"use client";
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import type { SettingDefinition } from "@netryx/shared-types";
import { fetchJson } from "../lib/fetch-json";
import { maskSecret } from "../settings/mask";
import { popIn, overlay } from "../lib/motion";

export function OverwriteKeyModal({ def, onClose, onSaved }: {
  def: SettingDefinition; onClose: () => void; onSaved: (preview: string) => void;
}) {
  const [value, setValue] = useState("");
  const [reveal, setReveal] = useState(false);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const isGoogle = def.key === "GOOGLE_MAPS_API_KEY";

  async function test() {
    if (isGoogle) {
      setTesting(true); setResult(null);
      const { data } = await fetchJson<{ ok: boolean; error?: string }>("/api/setup/test-key", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ key: value }),
      });
      setTesting(false);
      setResult(data?.ok ? { ok: true, msg: "Clave válida" } : { ok: false, msg: data?.error ?? "No válida" });
    } else {
      const ok = /^(pk|sk)\./.test(value);
      setResult(ok ? { ok: true, msg: "Formato correcto" } : { ok: false, msg: "Un token Mapbox empieza por pk. o sk." });
    }
  }

  async function save() {
    setSaving(true);
    const { ok, data } = await fetchJson("/api/settings", {
      method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ [def.key]: value }),
    });
    setSaving(false);
    if (!ok) { setResult({ ok: false, msg: (data as { error?: string })?.error ?? "No se pudo guardar" }); return; }
    onSaved(maskSecret(value));
  }

  const canSave = value.length > 0 && (!def.required || result?.ok === true);

  return (
    <motion.div variants={overlay} initial="hidden" animate="show" exit="exit"
      onClick={onClose} className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <motion.div variants={popIn} initial="hidden" animate="show" exit="exit"
        onClick={(e) => e.stopPropagation()}
        className="w-[340px] rounded-[14px] border border-white/12 bg-elevated p-[18px] shadow-2xl shadow-black/50">
        <div className="mb-1 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#e9ecf1" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0" /></svg>
            <span className="text-sm font-medium text-fg">Sustituir clave</span>
          </div>
          <button onClick={onClose} aria-label="Cerrar" className="text-subtle hover:text-fg">✕</button>
        </div>
        <p className="mb-3.5 text-xs leading-relaxed text-muted">La clave actual no se puede leer por seguridad. Pega una nueva para reemplazarla.</p>
        <label className="mb-1.5 block text-xs text-muted">Nueva {def.label}</label>
        <div className="mb-2 flex items-center gap-2 rounded-lg border border-white/25 bg-white/5 px-3">
          <input type={reveal ? "text" : "password"} value={value}
            onChange={(e) => { setValue(e.target.value); setResult(null); }}
            className="h-[38px] flex-1 bg-transparent font-mono text-sm text-fg outline-none" placeholder="Pega la nueva clave" />
          <button onClick={() => setReveal((v) => !v)} className="text-[11px] text-subtle hover:text-fg">{reveal ? "Ocultar" : "Mostrar"}</button>
        </div>
        <div className="mb-4 flex items-center gap-2.5">
          <button onClick={test} disabled={!value || testing}
            className="rounded-lg border border-white/20 bg-white/[.06] px-3 py-1.5 text-xs text-fg hover:bg-white/10 disabled:opacity-50">{testing ? "Probando…" : "Probar"}</button>
          {result && <span className={`flex items-center gap-1.5 text-xs ${result.ok ? "text-fg" : "text-danger-fg"}`}>{result.ok ? "✓" : "✕"} {result.msg}</span>}
        </div>
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border border-white/15 px-3.5 py-2 text-xs text-muted hover:text-fg">Cancelar</button>
          <button onClick={save} disabled={!canSave || saving}
            className="rounded-lg bg-accent px-4 py-2 text-xs font-medium text-black disabled:opacity-50">{saving ? "Guardando…" : "Guardar clave"}</button>
        </div>
      </motion.div>
    </motion.div>
  );
}
```

- [ ] **Step 2: Verify** — Run: `pnpm --filter @netryx/web typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/components/OverwriteKeyModal.tsx
git commit -m "feat(web): add OverwriteKeyModal for replacing secret keys"
```

### Task 15: SettingsPanel — masked secret rows + lock, section icons, stagger

**Files:**
- Modify: `apps/web/app/components/SettingsPanel.tsx` (rewrite)

**Interfaces:**
- Consumes: `OverwriteKeyModal` (Task 14), `staggerContainer`/`staggerItem` (Task 7), `groupSettings` (`../settings/sections`), `Menu`, `FloatingCard`, `fetchJson`, `SettingDefinition`.

- [ ] **Step 1: Rewrite the file**

```tsx
// apps/web/app/components/SettingsPanel.tsx
"use client";
import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { FloatingCard } from "./FloatingCard";
import { Menu } from "./Menu";
import { OverwriteKeyModal } from "./OverwriteKeyModal";
import { groupSettings } from "../settings/sections";
import { fetchJson } from "../lib/fetch-json";
import { staggerContainer, staggerItem } from "../lib/motion";
import type { SettingDefinition } from "@netryx/shared-types";

const svg = (path: React.ReactNode, stroke: string) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{path}</svg>
);
const SECTION_ICON: Record<string, React.ReactNode> = {
  "street-view": svg(<><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" /><circle cx="12" cy="10" r="3" /></>, "#85b7eb"),
  "map": svg(<><path d="m9 3 6 3 6-3v15l-6 3-6-3-6 3V6l6-3Z" /><path d="M9 3v15" /><path d="M15 6v15" /></>, "#85b7eb"),
  "limits-cost": svg(<><circle cx="12" cy="12" r="9" /><path d="M12 7v10M9.5 9.5a2.5 2.5 0 0 1 5 0M9.5 14.5a2.5 2.5 0 0 0 5 0" /></>, "#f0c477"),
  "models": svg(<><rect x="6" y="6" width="12" height="12" rx="1" /><path d="M9 2v2M15 2v2M9 20v2M15 20v2M2 9h2M2 15h2M20 9h2M20 15h2" /></>, "#a89fff"),
};

export function SettingsPanel() {
  const groups = groupSettings();
  const [values, setValues] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<SettingDefinition | null>(null);

  useEffect(() => {
    fetchJson<Record<string, string>>("/api/settings").then((r) => setValues(r.data ?? {}));
  }, []);

  const set = (key: string, value: string) => setDirty((d) => ({ ...d, [key]: value }));
  const current = (def: SettingDefinition) => dirty[def.key] ?? values[def.key] ?? def.defaultValue ?? "";

  async function save() {
    setSaving(true); setStatus(null);
    const body: Record<string, string> = { ...dirty }; // secrets never enter `dirty`
    const { ok, data } = await fetchJson("/api/settings", {
      method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    });
    setSaving(false);
    if (!ok) return setStatus({ tone: "error", text: (data as { error?: string })?.error ?? "No se pudo guardar" });
    setValues((prev) => ({ ...prev, ...body })); setDirty({}); setStatus({ tone: "ok", text: "Guardado" });
  }

  return (
    <>
      <motion.div variants={staggerContainer} initial="hidden" animate="show" className="space-y-4">
        {groups.map(({ section, defs }) => (
          <motion.div key={section.id} variants={staggerItem}>
            <FloatingCard className="p-5">
              <h2 className="mb-4 flex items-center gap-2 text-sm font-medium text-fg">{SECTION_ICON[section.id]}{section.title}</h2>
              <div className="space-y-4">
                {defs.map((def) => (
                  <div key={def.key}>
                    <span className="mb-1 block text-xs text-muted">{def.label}</span>
                    {def.isSecret ? (
                      <SecretRow display={values[def.key]} onEdit={() => setEditing(def)} />
                    ) : def.type === "enum" ? (
                      <Menu value={current(def)} onChange={(v) => set(def.key, v)}
                        options={(def.options ?? []).map((o) => ({ value: o, label: o }))} />
                    ) : (
                      <input type={def.type === "number" ? "number" : "text"} step={def.type === "number" ? "any" : undefined}
                        value={current(def)} onChange={(e) => set(def.key, e.target.value)}
                        className="w-full rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm text-fg outline-none focus:border-white/25" />
                    )}
                  </div>
                ))}
                {section.id === "models" && (
                  <p className="text-[11px] text-warning-fg">Cambiar de modelo requiere reiniciar el servicio de inferencia para aplicarse (spec §15.4).</p>
                )}
              </div>
            </FloatingCard>
          </motion.div>
        ))}
        <div className="flex items-center gap-3">
          <button onClick={save} disabled={saving || Object.keys(dirty).length === 0}
            className="rounded-md bg-accent px-4 py-2 text-xs font-medium text-black disabled:opacity-50">{saving ? "Guardando…" : "Guardar cambios"}</button>
          {status && <span className={`text-xs ${status.tone === "ok" ? "text-fg" : "text-danger-fg"}`}>{status.text}</span>}
        </div>
      </motion.div>

      <AnimatePresence>
        {editing && (
          <OverwriteKeyModal def={editing} onClose={() => setEditing(null)}
            onSaved={(preview) => { const key = editing.key; setValues((v) => ({ ...v, [key]: preview })); setEditing(null); }} />
        )}
      </AnimatePresence>
    </>
  );
}

function SecretRow({ display, onEdit }: { display?: string; onEdit: () => void }) {
  const lockBtn = (
    <button onClick={onEdit} aria-label="Sustituir clave"
      className="flex h-[38px] w-[38px] flex-none items-center justify-center rounded-md border border-white/22 bg-white/[.08] text-fg hover:bg-white/15">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0" /></svg>
    </button>
  );
  if (display) {
    return (
      <div className="flex items-center gap-2">
        <div className="flex h-[38px] flex-1 select-none items-center gap-2.5 rounded-md border border-white/10 bg-white/[.04] px-3">
          <span className="flex-1 font-mono text-[13px] tracking-wide text-fg">{display}</span>
          <span className="text-[11px] text-fg/80">✓ verificada</span>
        </div>
        {lockBtn}
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2">
      <div className="flex h-[38px] flex-1 select-none items-center rounded-md border border-dashed border-white/14 bg-white/[.03] px-3 text-xs text-subtle">Sin definir</div>
      {lockBtn}
    </div>
  );
}
```

- [ ] **Step 2: Verify** — Run: `pnpm --filter @netryx/web typecheck` → PASS. Run: `pnpm --filter @netryx/web test app/settings app/api/settings` → PASS. Manual: open `/settings`, confirm secret rows show `AIza••••••••••••` (non-selectable), the lock opens the modal, Probar validates, Guardar updates the row.

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/components/SettingsPanel.tsx
git commit -m "feat(web): masked non-copyable secret rows with lock→overwrite popup"
```

---

## Phase 4 — Setup wizard (Install → Database → Credentials → Confirm)

### Task 16: New wizard step machine

**Files:**
- Modify: `apps/web/app/setup/wizard-steps.ts` (rewrite)
- Test: `apps/web/app/setup/wizard-steps.test.ts` (rewrite)

**Interfaces:**
- Produces: `WIZARD_STEPS` with ids `install`, `database`, `credentials`, `confirm`; `nextStep(id): StepId | null`; `prevStep(id): StepId | null`; `isComplete(id): boolean`; `type StepId`.

- [ ] **Step 1: Rewrite the test**

```ts
// apps/web/app/setup/wizard-steps.test.ts
import { describe, it, expect } from "vitest";
import { WIZARD_STEPS, nextStep, prevStep, isComplete } from "./wizard-steps";

describe("wizard steps", () => {
  it("orders the four steps and walks forward/back", () => {
    expect(WIZARD_STEPS.map((s) => s.id)).toEqual(["install", "database", "credentials", "confirm"]);
    expect(nextStep("install")).toBe("database");
    expect(prevStep("credentials")).toBe("database");
    expect(nextStep("confirm")).toBeNull();
    expect(prevStep("install")).toBeNull();
    expect(isComplete("confirm")).toBe(true);
    expect(isComplete("install")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @netryx/web test app/setup/wizard-steps.test.ts`
Expected: FAIL — current ids are `prereqs, migrate, credentials, inference, confirm`.

- [ ] **Step 3: Rewrite the module**

```ts
// apps/web/app/setup/wizard-steps.ts
export const WIZARD_STEPS = [
  { id: "install", title: "Instalación" },
  { id: "database", title: "Base de datos" },
  { id: "credentials", title: "Credenciales" },
  { id: "confirm", title: "Confirmación" },
] as const;
export type StepId = (typeof WIZARD_STEPS)[number]["id"];
const idx = (id: StepId) => WIZARD_STEPS.findIndex((s) => s.id === id);
export function nextStep(id: StepId): StepId | null {
  const i = idx(id);
  return i >= 0 && i < WIZARD_STEPS.length - 1 ? WIZARD_STEPS[i + 1].id : null;
}
export function prevStep(id: StepId): StepId | null {
  const i = idx(id);
  return i > 0 ? WIZARD_STEPS[i - 1].id : null;
}
export function isComplete(id: StepId): boolean { return id === "confirm"; }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @netryx/web test app/setup/wizard-steps.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/setup/wizard-steps.ts apps/web/app/setup/wizard-steps.test.ts
git commit -m "feat(setup): 4-step wizard machine (install→database→credentials→confirm)"
```

### Task 17: Split model-weight download endpoints

**Files:**
- Modify: `apps/web/app/api/setup/run/[step]/route.ts` (the `STEPS` map)

**Interfaces:**
- Produces: SSE steps `weights-retrieval` (Lumi Preview / MegaLoc) and `weights-verification` (Laila / RoMa), consumed by Task 19–20.

- [ ] **Step 1: Add the two entries** — inside the `STEPS` object, replacing the single `"inference-weights"` entry:

```ts
  "weights-retrieval": {
    cmd: resolve(INFER, "venv", "Scripts", "python.exe"),
    args: ["-c", "import torch; torch.hub.load('gmberton/MegaLoc','get_trained_model')"],
    cwd: INFER,
  },
  "weights-verification": {
    cmd: resolve(INFER, "venv", "Scripts", "python.exe"),
    args: ["-c", "import romatch; romatch.roma_outdoor(device='cpu')"],
    cwd: INFER,
  },
```

- [ ] **Step 2: Verify** — Run: `pnpm --filter @netryx/web typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add "apps/web/app/api/setup/run/[step]/route.ts"
git commit -m "feat(setup): separate retrieval/verification weight download steps"
```

### Task 18: Migration-progress parser (TDD)

**Files:**
- Create: `apps/web/app/lib/migrate-progress.ts`
- Test: `apps/web/app/lib/migrate-progress.test.ts`

**Interfaces:**
- Produces: `appliedMigrations(lines: string[]): string[]`; `migrateProgress(lines: string[], total: number): { applied: number; total: number; fraction: number }`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/app/lib/migrate-progress.test.ts
import { describe, it, expect } from "vitest";
import { appliedMigrations, migrateProgress } from "./migrate-progress";

const LINES = [
  "> Migrating files:",
  "> - 1720400000000_init",           // listing line, must NOT count
  "### MIGRATION 1720400000000_init (UP) ###",
  "CREATE EXTENSION IF NOT EXISTS vector;",
  "### MIGRATION 1720400100000_add_points_failed (UP) ###",
];

describe("migrate-progress", () => {
  it("counts only applied migrations, deduped", () => {
    expect(appliedMigrations(LINES)).toEqual([
      "1720400000000_init",
      "1720400100000_add_points_failed",
    ]);
  });
  it("computes fraction against a known total", () => {
    const p = migrateProgress(LINES, 5);
    expect(p.applied).toBe(2);
    expect(p.total).toBe(5);
    expect(p.fraction).toBeCloseTo(0.4);
  });
  it("clamps applied to total", () => {
    expect(migrateProgress(LINES, 1).applied).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @netryx/web test app/lib/migrate-progress.test.ts`
Expected: FAIL — cannot find module `./migrate-progress`.

- [ ] **Step 3: Implement**

```ts
// apps/web/app/lib/migrate-progress.ts
// Parsea el stream de node-pg-migrate para contar migraciones aplicadas.
// Solo cuentan líneas que indican aplicación (MIGRATION/(UP)/Migrated),
// no el listado inicial de ficheros.
const MIGRATION_RE = /(\d{13}_[\w-]+)/g;
export function appliedMigrations(lines: string[]): string[] {
  const seen = new Set<string>();
  for (const l of lines) {
    if (!/MIGRATION|Migrated|\(UP\)/i.test(l)) continue;
    for (const m of l.matchAll(MIGRATION_RE)) seen.add(m[1]);
  }
  return [...seen];
}
export function migrateProgress(lines: string[], total: number): { applied: number; total: number; fraction: number } {
  const applied = Math.min(appliedMigrations(lines).length, total);
  return { applied, total, fraction: total ? applied / total : 0 };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @netryx/web test app/lib/migrate-progress.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/lib/migrate-progress.ts apps/web/app/lib/migrate-progress.test.ts
git commit -m "feat(setup): migration-progress parser"
```

> **Robustness note for the executor:** if, during manual testing, the DB step never advances past 0, dump the real SSE lines and adjust the predicate/regex in `migrate-progress.ts` — the format of node-pg-migrate output may differ from the sample. The parser is isolated + tested precisely so this stays a one-line tweak.

### Task 19: InstallItem (one download row with its own console)

**Files:**
- Create: `apps/web/app/setup/steps/InstallItem.tsx`

**Interfaces:**
- Consumes: `useCommandRun` (`../../lib/useCommandRun`), `RunConsole` (`../../components/RunConsole`), framer-motion.
- Produces: `InstallItem({ stepId, label, engine, active, onDone })` where `onDone: (ok: boolean) => void`.

- [ ] **Step 1: Create the file**

```tsx
// apps/web/app/setup/steps/InstallItem.tsx
"use client";
import { useEffect, useRef } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { useCommandRun } from "../../lib/useCommandRun";
import { RunConsole } from "../../components/RunConsole";

export function InstallItem({ stepId, label, engine, active, onDone }: {
  stepId: string; label: string; engine?: string; active: boolean; onDone: (ok: boolean) => void;
}) {
  const { lines, running, done, code, run } = useCommandRun();
  const started = useRef(false);
  const reported = useRef(false);
  const reduce = useReducedMotion();

  useEffect(() => {
    if (active && !started.current) { started.current = true; run(stepId); }
  }, [active, run, stepId]);

  useEffect(() => {
    if (done && !reported.current) { reported.current = true; onDone(code === 0); }
  }, [done, code, onDone]);

  const ok = done && code === 0;
  const failed = done && code !== 0;
  const showConsole = running || failed;

  return (
    <div className={`rounded-card border p-3 ${running ? "border-white/20 bg-white/[.06]" : "border-white/10 bg-white/[.03]"} ${!active && !done ? "opacity-70" : ""}`}>
      <div className="flex items-center gap-3">
        <span className="flex h-[22px] w-[22px] flex-none items-center justify-center">
          {ok ? (
            <span className="flex h-full w-full items-center justify-center rounded-full bg-accent text-[11px] text-black">✓</span>
          ) : failed ? (
            <span className="flex h-full w-full items-center justify-center rounded-full text-danger-fg">✕</span>
          ) : running ? (
            <span className="lumi-anim h-4 w-4 rounded-full border-2 border-white/25 border-t-white" style={{ animation: "lumi-spin 1s linear infinite" }} />
          ) : (
            <span className="h-full w-full rounded-full border border-white/20" />
          )}
        </span>
        <span className="flex-1 text-sm text-fg">{label}{engine && <span className="text-subtle"> · {engine}</span>}</span>
        <span className="text-xs text-subtle">{ok ? "listo" : failed ? "error" : running ? "…" : "en cola"}</span>
        {failed && (
          <button onClick={() => { started.current = true; reported.current = false; run(stepId, true); }}
            className="ml-2 rounded-md border border-white/10 px-2 py-1 text-xs text-fg hover:bg-white/10">Reintentar</button>
        )}
      </div>
      {showConsole && (
        <motion.div initial={reduce ? false : { height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} style={{ overflow: "hidden" }}>
          <RunConsole lines={lines} />
        </motion.div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify** — Run: `pnpm --filter @netryx/web typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/setup/steps/InstallItem.tsx
git commit -m "feat(setup): InstallItem row with per-item expandable console"
```

### Task 20: InstallStep (button → prereqs → sequenced downloads)

**Files:**
- Create: `apps/web/app/setup/steps/InstallStep.tsx`

**Interfaces:**
- Consumes: `InstallItem` (Task 19), `fetchJson`, `fadeRise` (Task 7), `GET /api/setup/prereqs`.
- Produces: `InstallStep({ onComplete })` — calls `onComplete()` once all four items exit code 0.

- [ ] **Step 1: Create the file**

```tsx
// apps/web/app/setup/steps/InstallStep.tsx
"use client";
import { useState } from "react";
import { motion } from "framer-motion";
import { InstallItem } from "./InstallItem";
import { fetchJson } from "../../lib/fetch-json";
import { fadeRise } from "../../lib/motion";

const ITEMS = [
  { id: "inference-venv", label: "Entorno Python", engine: "venv" },
  { id: "inference-deps", label: "Dependencias PyTorch + CUDA", engine: "pip install" },
  { id: "weights-retrieval", label: "Modelo de recuperación", engine: "Lumi Preview" },
  { id: "weights-verification", label: "Modelo de verificación", engine: "Laila" },
];
interface Check { id: string; label: string; ok: boolean; detail: string }

export function InstallStep({ onComplete }: { onComplete: () => void }) {
  const [started, setStarted] = useState(false);
  const [checks, setChecks] = useState<Check[] | null>(null);
  const [activeIdx, setActiveIdx] = useState(-1);

  async function start() {
    setStarted(true);
    const { data } = await fetchJson<{ checks: Check[] }>("/api/setup/prereqs");
    const c = data?.checks ?? [];
    setChecks(c);
    if (c.find((x) => x.id === "postgres")?.ok) setActiveIdx(0);
  }
  function onDone(ok: boolean) {
    if (!ok) return;
    setActiveIdx((x) => {
      const next = x + 1;
      if (next >= ITEMS.length) onComplete();
      return next;
    });
  }
  const postgresOk = checks?.find((c) => c.id === "postgres")?.ok ?? false;

  if (!started) {
    return (
      <motion.div variants={fadeRise} initial="hidden" animate="show" className="flex flex-col items-center text-center">
        <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-white/15 bg-white/[.06]">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#e9ecf1" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v12" /><path d="m7 12 5 5 5-5" /><path d="M5 21h14" /></svg>
        </div>
        <div className="text-base font-medium text-fg">Instalar dependencias locales</div>
        <p className="mt-1.5 max-w-sm text-xs leading-relaxed text-muted">Verificaremos PostgreSQL y descargaremos el entorno de inferencia y los pesos de Lumi Preview y Laila. Ocupan ~2.5 GB y se guardan en tu equipo.</p>
        <button onClick={start} className="mt-4 rounded-[10px] bg-accent px-7 py-2.5 text-sm font-medium text-black hover:brightness-105">Install</button>
      </motion.div>
    );
  }

  return (
    <motion.div variants={fadeRise} initial="hidden" animate="show">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-sm font-medium text-fg">Instalando…</span>
        <span className="text-xs text-muted">{Math.max(activeIdx, 0)} / {ITEMS.length} completado</span>
      </div>
      {checks && (
        <div className="mb-3 flex items-center gap-3 rounded-card border border-white/10 bg-white/[.045] px-3 py-2.5">
          <span className="text-xs text-fg/80">Prerequisitos</span>
          <div className="ml-auto flex items-center gap-3">
            {checks.map((c) => (
              <span key={c.id} className={`flex items-center gap-1 text-[11px] ${c.ok ? "text-fg" : "text-danger-fg"}`}>{c.ok ? "✓" : "✕"} {c.label}</span>
            ))}
          </div>
        </div>
      )}
      {!postgresOk ? (
        <div className="rounded-card border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger-fg">
          PostgreSQL no responde. Arráncalo y reintenta.
          <button onClick={start} className="ml-2 rounded-md border border-white/10 px-2 py-1 text-fg hover:bg-white/10">Reintentar</button>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {ITEMS.map((it, i) => (
            <InstallItem key={it.id} stepId={it.id} label={it.label} engine={it.engine} active={i === activeIdx} onDone={onDone} />
          ))}
        </div>
      )}
    </motion.div>
  );
}
```

- [ ] **Step 2: Verify** — Run: `pnpm --filter @netryx/web typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/setup/steps/InstallStep.tsx
git commit -m "feat(setup): InstallStep with prereq check + sequenced downloads"
```

### Task 21: DatabaseStep (schema materializes; no console)

**Files:**
- Create: `apps/web/app/setup/steps/DatabaseStep.tsx`

**Interfaces:**
- Consumes: `useCommandRun`, `migrateProgress` (Task 18), `RunConsole`, `POST /api/setup/run/migrate`.
- Produces: `DatabaseStep({ onComplete })` — calls `onComplete()` when migrate exits 0.

- [ ] **Step 1: Create the file**

```tsx
// apps/web/app/setup/steps/DatabaseStep.tsx
"use client";
import { useEffect, useRef, useState } from "react";
import { useCommandRun } from "../../lib/useCommandRun";
import { migrateProgress } from "../../lib/migrate-progress";
import { RunConsole } from "../../components/RunConsole";

const TABLES = ["areas", "indexed_images", "searches", "search_regions", "search_candidates", "api_usage", "system_settings"];
const TOTAL_MIGRATIONS = 5;
const GRID_BG: React.CSSProperties = {
  backgroundImage:
    "linear-gradient(rgba(255,255,255,.035) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.035) 1px,transparent 1px)",
  backgroundSize: "26px 26px",
};

export function DatabaseStep({ onComplete }: { onComplete: () => void }) {
  const { lines, done, code, run } = useCommandRun();
  const started = useRef(false);
  const reported = useRef(false);
  const [showLog, setShowLog] = useState(false);

  useEffect(() => { if (!started.current) { started.current = true; run("migrate"); } }, [run]);
  useEffect(() => { if (done && code === 0 && !reported.current) { reported.current = true; onComplete(); } }, [done, code, onComplete]);

  const finished = done && code === 0;
  const failed = done && code !== 0;
  const { applied, total, fraction } = migrateProgress(lines, TOTAL_MIGRATIONS);
  const extOk = applied >= 1 || finished;
  const revealed = finished ? TABLES.length : Math.round(fraction * TABLES.length);

  return (
    <div>
      <div className="mb-1 flex items-center gap-2">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#e9ecf1" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><ellipse cx="12" cy="5" rx="8" ry="3" /><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5" /><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" /></svg>
        <span className="text-base font-medium text-fg">Construyendo la base de datos</span>
      </div>
      <p className="mb-4 text-xs text-muted">Aplicando migraciones · las extensiones y tablas se materializan según se crean.</p>

      <div className="mb-4 flex gap-2.5">
        {[["pgvector", "embeddings 8448-d"], ["PostGIS", "geometría · índices"]].map(([name, sub]) => (
          <div key={name} className={`flex flex-1 items-center gap-2 rounded-card border px-3 py-2.5 ${extOk ? "border-white/20 bg-white/[.06]" : "border-white/10 bg-white/[.03] opacity-60"}`}>
            <div className="flex-1">
              <div className="text-[12.5px] font-medium text-fg">{name}</div>
              <div className="text-[11px] text-subtle">{sub}</div>
            </div>
            {extOk && <span className="text-fg">✓</span>}
          </div>
        ))}
      </div>

      <div className="rounded-card border border-white/10 bg-white/[.03] p-2" style={GRID_BG}>
        <div className="grid grid-cols-2 gap-1.5">
          {TABLES.map((t, i) => {
            const isDone = i < revealed;
            const isCurrent = i === revealed && !finished && !failed;
            return (
              <div key={t} className={`flex items-center gap-2 rounded-md border px-2.5 py-2 ${isDone ? "border-white/10 bg-white/[.04]" : isCurrent ? "border-white/20 bg-white/[.07]" : "border-dashed border-white/10 bg-white/[.02] opacity-55"}`}>
                <span className="flex-1 font-mono text-xs text-fg">{t}</span>
                {isDone ? <span className="text-xs text-fg">✓</span> : isCurrent ? <span className="lumi-anim h-3.5 w-3.5 rounded-full border-2 border-white/25 border-t-white" style={{ animation: "lumi-spin 1s linear infinite" }} /> : null}
              </div>
            );
          })}
        </div>
      </div>

      <div className="mt-4 flex items-center gap-2.5">
        <span className="relative h-1 flex-1 overflow-hidden rounded bg-white/10">
          <span className="absolute left-0 top-0 h-full rounded bg-accent transition-[width] duration-500" style={{ width: `${Math.round((finished ? 1 : fraction) * 100)}%` }} />
        </span>
        <span className="text-[11.5px] text-muted">{finished ? total : applied} / {total} migraciones</span>
      </div>

      {failed && (
        <div className="mt-3 text-xs text-danger-fg">
          Falló la migración. <button onClick={() => setShowLog((v) => !v)} className="underline">ver log</button>
          <button onClick={() => { started.current = true; reported.current = false; setShowLog(true); run("migrate", true); }} className="ml-2 rounded-md border border-white/10 px-2 py-1 text-fg hover:bg-white/10">Reintentar</button>
        </div>
      )}
      {showLog && <RunConsole lines={lines} />}
    </div>
  );
}
```

- [ ] **Step 2: Verify** — Run: `pnpm --filter @netryx/web typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/setup/steps/DatabaseStep.tsx
git commit -m "feat(setup): DatabaseStep schema-materialization view"
```

### Task 22: CredentialsStep (glass form)

**Files:**
- Create: `apps/web/app/setup/steps/CredentialsStep.tsx`

**Interfaces:**
- Consumes: `fetchJson`, `fadeRise` (Task 7), `POST /api/setup/test-key`.
- Produces: `CredentialsStep({ values, onChange, onComplete })` where `values: Record<string,string>`, `onChange: (k: string, v: string) => void`. Calls `onComplete()` when the Google key tests OK.

- [ ] **Step 1: Create the file**

```tsx
// apps/web/app/setup/steps/CredentialsStep.tsx
"use client";
import { useState } from "react";
import { motion } from "framer-motion";
import { fetchJson } from "../../lib/fetch-json";
import { fadeRise } from "../../lib/motion";

const LIMITS = [
  { key: "MAX_AREA_KM2", label: "Área máx. (km²)" },
  { key: "MAX_MONTHLY_BUDGET_USD", label: "Presupuesto mensual (USD)" },
  { key: "GOOGLE_FREE_MONTHLY_CREDIT_USD", label: "Crédito gratis Google (USD)" },
  { key: "GOOGLE_FREE_MONTHLY_IMAGES", label: "Imágenes gratis Google" },
];

export function CredentialsStep({ values, onChange, onComplete }: {
  values: Record<string, string>; onChange: (k: string, v: string) => void; onComplete: () => void;
}) {
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const google = values.GOOGLE_MAPS_API_KEY ?? "";

  async function test() {
    setTesting(true); setResult(null);
    const { data } = await fetchJson<{ ok: boolean; error?: string }>("/api/setup/test-key", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ key: google }),
    });
    setTesting(false);
    if (data?.ok) { setResult({ ok: true, msg: "Clave válida · Street View respondió OK" }); onComplete(); }
    else setResult({ ok: false, msg: data?.error ?? "La clave no es válida" });
  }

  const field = "h-[38px] w-full rounded-lg border border-white/12 bg-white/5 px-3 text-sm text-fg outline-none focus:border-white/30";

  return (
    <motion.div variants={fadeRise} initial="hidden" animate="show">
      <div className="mb-0.5 text-[15px] font-medium text-fg">Credenciales</div>
      <p className="mb-4 text-xs text-muted">Se guardan cifradas y se aplican al terminar. Nada se escribe hasta confirmar.</p>

      <label className="mb-1.5 block text-xs text-muted">Google Street View Static API key <span className="text-danger-fg">· obligatoria</span></label>
      <div className="mb-1.5 flex items-center gap-2">
        <input value={google} onChange={(e) => { onChange("GOOGLE_MAPS_API_KEY", e.target.value); setResult(null); }} className={field} placeholder="AIza…" />
        <button onClick={test} disabled={!google || testing} className="h-[38px] flex-none rounded-lg border border-white/20 bg-white/[.06] px-3.5 text-xs text-fg hover:bg-white/10 disabled:opacity-50">{testing ? "Probando…" : "Probar"}</button>
      </div>
      {result && <p className={`mb-4 flex items-center gap-1.5 text-xs ${result.ok ? "text-fg" : "text-danger-fg"}`}>{result.ok ? "✓" : "✕"} {result.msg}</p>}

      <label className="mb-1.5 block text-xs text-muted">Mapbox token <span className="text-subtle">· opcional</span></label>
      <input value={values.MAPBOX_TOKEN ?? ""} onChange={(e) => onChange("MAPBOX_TOKEN", e.target.value)} className={`${field} mb-5`} placeholder="Déjalo vacío para usar MapLibre + tiles gratis" />

      <div className="mb-3 flex items-center gap-2"><span className="text-[11px] uppercase tracking-wide text-subtle">Límites y coste</span><span className="h-px flex-1 bg-white/10" /></div>
      <div className="grid grid-cols-2 gap-3">
        {LIMITS.map((l) => (
          <div key={l.key}>
            <label className="mb-1.5 block text-xs text-muted">{l.label}</label>
            <input type="number" step="any" value={values[l.key] ?? ""} onChange={(e) => onChange(l.key, e.target.value)}
              className="h-9 w-full rounded-lg border border-white/12 bg-white/5 px-3 text-sm text-fg outline-none focus:border-white/30" />
          </div>
        ))}
      </div>
    </motion.div>
  );
}
```

- [ ] **Step 2: Verify** — Run: `pnpm --filter @netryx/web typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/setup/steps/CredentialsStep.tsx
git commit -m "feat(setup): CredentialsStep glass form with key test"
```

### Task 23: ConfirmStep (summary + submit)

**Files:**
- Create: `apps/web/app/setup/steps/ConfirmStep.tsx`

**Interfaces:**
- Consumes: `maskSecret` (Task 11), `submitSetupAction` (`../actions`), `fadeRise` (Task 7).
- Produces: `ConfirmStep({ values })` — renders a form whose action is `submitSetupAction`.

- [ ] **Step 1: Create the file**

```tsx
// apps/web/app/setup/steps/ConfirmStep.tsx
"use client";
import { motion } from "framer-motion";
import { fadeRise } from "../../lib/motion";
import { maskSecret } from "../../settings/mask";
import { submitSetupAction } from "../actions";

export function ConfirmStep({ values }: { values: Record<string, string> }) {
  const rows: [string, string][] = [
    ["Google Street View key", values.GOOGLE_MAPS_API_KEY ? maskSecret(values.GOOGLE_MAPS_API_KEY) : "— (obligatoria)"],
    ["Mapbox token", values.MAPBOX_TOKEN ? maskSecret(values.MAPBOX_TOKEN) : "sin definir (MapLibre)"],
    ["Área máx. (km²)", values.MAX_AREA_KM2 ?? "5"],
    ["Presupuesto mensual (USD)", values.MAX_MONTHLY_BUDGET_USD ?? "50"],
    ["Crédito gratis Google (USD)", values.GOOGLE_FREE_MONTHLY_CREDIT_USD ?? "0"],
    ["Imágenes gratis Google", values.GOOGLE_FREE_MONTHLY_IMAGES ?? "0"],
  ];
  return (
    <motion.div variants={fadeRise} initial="hidden" animate="show">
      <div className="mb-0.5 text-[15px] font-medium text-fg">Confirmación</div>
      <p className="mb-4 text-xs text-muted">Revisa y finaliza. Los valores se guardan cifrados en una sola operación.</p>
      <div className="mb-5 overflow-hidden rounded-card border border-white/10">
        {rows.map(([k, v], i) => (
          <div key={k} className={`flex items-center justify-between px-3.5 py-2.5 text-xs ${i % 2 ? "bg-white/[.02]" : ""}`}>
            <span className="text-muted">{k}</span>
            <span className="font-mono text-fg">{v}</span>
          </div>
        ))}
      </div>
      <form action={submitSetupAction}>
        {Object.entries(values).map(([k, v]) => (<input key={k} type="hidden" name={k} value={v} />))}
        <button type="submit" className="w-full rounded-lg bg-accent py-3 text-sm font-medium text-black hover:brightness-105">Finalizar setup</button>
      </form>
    </motion.div>
  );
}
```

- [ ] **Step 2: Verify** — Run: `pnpm --filter @netryx/web typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/setup/steps/ConfirmStep.tsx
git commit -m "feat(setup): ConfirmStep summary + submitSetupAction"
```

### Task 24: SetupWizard rewrite + remove dead steps (fixes the build)

**Files:**
- Modify: `apps/web/app/setup/SetupWizard.tsx` (rewrite)
- Delete: `apps/web/app/setup/steps/PrereqsStep.tsx`, `apps/web/app/setup/steps/MigrateStep.tsx`
- Modify (if needed): `apps/web/app/setup/page.tsx` (ensure full-height container)

**Interfaces:**
- Consumes: `PlanetBackground` (Task 9), `WIZARD_STEPS`/`nextStep`/`prevStep`/`StepId` (Task 16), `InstallStep` (20), `DatabaseStep` (21), `CredentialsStep` (22), `ConfirmStep` (23), `fadeRise` (Task 7).

- [ ] **Step 1: Rewrite SetupWizard**

```tsx
// apps/web/app/setup/SetupWizard.tsx
"use client";
import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { PlanetBackground } from "../components/PlanetBackground";
import { WIZARD_STEPS, nextStep, prevStep, type StepId } from "./wizard-steps";
import { InstallStep } from "./steps/InstallStep";
import { DatabaseStep } from "./steps/DatabaseStep";
import { CredentialsStep } from "./steps/CredentialsStep";
import { ConfirmStep } from "./steps/ConfirmStep";
import { fadeRise } from "../lib/motion";

const DEFAULT_COLLECTED: Record<string, string> = {
  MAX_AREA_KM2: "5", MAX_MONTHLY_BUDGET_USD: "50",
  GOOGLE_FREE_MONTHLY_CREDIT_USD: "0", GOOGLE_FREE_MONTHLY_IMAGES: "0",
};
const SUBTITLE: Record<StepId, string> = {
  install: "descarga el entorno y los modelos.",
  database: "crea las tablas y extensiones.",
  credentials: "conecta tus llaves de Google y el mapa.",
  confirm: "revisa y termina.",
};

export function SetupWizard() {
  const [current, setCurrent] = useState<StepId>("install");
  const [done, setDone] = useState<Record<string, boolean>>({});
  const [collected, setCollected] = useState<Record<string, string>>(DEFAULT_COLLECTED);
  const mark = (id: StepId) => setDone((d) => ({ ...d, [id]: true }));
  const setField = (k: string, v: string) => setCollected((c) => ({ ...c, [k]: v }));

  const idx = WIZARD_STEPS.findIndex((s) => s.id === current);
  const next = nextStep(current);
  const prev = prevStep(current);

  const panel = {
    install: <InstallStep onComplete={() => mark("install")} />,
    database: <DatabaseStep onComplete={() => mark("database")} />,
    credentials: <CredentialsStep values={collected} onChange={setField} onComplete={() => mark("credentials")} />,
    confirm: <ConfirmStep values={collected} />,
  }[current];

  return (
    <div className="relative min-h-screen overflow-hidden">
      <PlanetBackground />
      <div className="relative mx-auto max-w-xl px-6 py-10">
        <div className="mb-1 flex items-center gap-2.5">
          <span className="animate-pulse text-fg">✦</span>
          <span className="text-lg font-medium text-fg">Vamos a preparar Lumi</span>
        </div>
        <p className="mb-6 text-xs text-muted">Paso {idx + 1} de {WIZARD_STEPS.length} · {SUBTITLE[current]}</p>

        <div className="relative mb-6 flex items-start justify-between">
          <div className="absolute left-[6%] right-[6%] top-3.5 h-0.5 bg-white/10" />
          <div className="absolute left-[6%] top-3.5 h-0.5 bg-accent transition-[width] duration-500"
            style={{ width: `${(idx / (WIZARD_STEPS.length - 1)) * 88}%` }} />
          {WIZARD_STEPS.map((s, i) => {
            const state = done[s.id] ? "done" : i === idx ? "active" : "todo";
            return (
              <div key={s.id} className="relative flex w-1/4 flex-col items-center gap-1.5">
                <div className={`flex h-7 w-7 items-center justify-center rounded-full text-xs ${state === "done" ? "bg-accent text-black" : state === "active" ? "animate-pulse border-2 border-accent bg-bg text-fg" : "border border-white/15 bg-white/5 text-subtle"}`}>
                  {state === "done" ? "✓" : i + 1}
                </div>
                <span className={`text-center text-[11px] leading-tight ${i === idx ? "text-fg" : "text-subtle"}`}>{s.title}</span>
              </div>
            );
          })}
        </div>

        <div className="rounded-card border border-white/[.13] bg-[rgba(16,19,25,.66)] p-5 shadow-lg shadow-black/40 backdrop-blur-xl">
          <AnimatePresence mode="wait">
            <motion.div key={current} variants={fadeRise} initial="hidden" animate="show" exit="exit">
              {panel}
            </motion.div>
          </AnimatePresence>
        </div>

        <div className="mt-4 flex justify-between">
          <button onClick={() => prev && setCurrent(prev)} disabled={!prev}
            className="rounded-lg border border-white/15 px-4 py-2 text-xs text-fg disabled:opacity-40">Atrás</button>
          {next && (
            <button onClick={() => next && setCurrent(next)} disabled={!done[current]}
              className="rounded-lg bg-accent px-5 py-2 text-xs font-medium text-black disabled:opacity-40">Siguiente</button>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Delete the superseded step files**

```bash
git rm apps/web/app/setup/steps/PrereqsStep.tsx apps/web/app/setup/steps/MigrateStep.tsx
```

- [ ] **Step 3: Confirm nothing else imports them** — Run: `rg -n "PrereqsStep|MigrateStep|InferenceStep" apps/web`
Expected: no matches.

- [ ] **Step 4: Ensure the page hosts a full-height wizard** — open `apps/web/app/setup/page.tsx`; if it doesn't already render `<SetupWizard />` inside a `min-h-screen` container, make it:

```tsx
import { SetupWizard } from "./SetupWizard";
export default function SetupPage() {
  return <main className="min-h-screen"><SetupWizard /></main>;
}
```

- [ ] **Step 5: Verify the whole app builds** — Run: `pnpm --filter @netryx/web typecheck`
Expected: PASS clean (the missing `CredentialsStep`/`InferenceStep`/`ConfirmStep` import errors are gone — the build is fixed). Manual: walk `/setup` end-to-end (Install with consoles → Database materializing → Credentials with Probar → Confirmar → lands on `/`).

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/setup/SetupWizard.tsx apps/web/app/setup/page.tsx
git commit -m "feat(setup): planet wizard shell wiring the 4 steps; remove dead steps"
```

---

## Final verification

- [ ] Run all web unit tests: `pnpm --filter @netryx/web test`
Expected: PASS (mask, sections, settings route, wizard-steps, migrate-progress, stores + existing suites).
- [ ] Run typecheck: `pnpm --filter @netryx/web typecheck`
Expected: PASS clean.
- [ ] Manual smoke: loading splash (planet), `/index` toolbar visible + no overlap, `/settings` masked keys + lock popup, `/setup` full flow.

## Self-Review notes (spec coverage)

- Remove green everywhere → Tasks 4, 5 (+ token flip cascades to Menu/buttons automatically).
- White accent → Task 4.
- Fluid animations (framer-motion) → Tasks 6, 7 + applied in 10, 14, 15, 19–24. Reduced-motion honored via `.lumi-anim` media query (Task 8) and `useReducedMotion` in InstallItem.
- Loading screen w/ planet → Tasks 9, 10.
- Setup planet bg + translucency + animation + personality → Tasks 9, 24.
- Unique steps: Install=console (19–20), Database=materializing blueprint (21), Credentials=glass form (22) → covered.
- Install groups prereqs + venv + models with per-item consoles → Task 20 (+19, +17 for split model steps).
- Steps order Install→DB→Credenciales→Confirmar → Task 16.
- Settings masked (first 4), non-copyable, lock→overwrite popup, truly functional → Tasks 11, 12, 14, 15.
- Model names Lumi Preview / Laila → used in Task 20 (`models.ts` already has the displayNames).
- Fix broken build (missing steps) → Task 24.

## Types cross-check

`setEstimate(Estimate|null)` (T1) · `onModeChange` (T2) · `maskSecret(string):string` (T11, used T12/14/15/23) · `OverwriteKeyModal({def,onClose,onSaved})` (T14→T15) · `InstallItem({stepId,label,engine,active,onDone})` (T19→T20) · `migrateProgress(lines,total)` (T18→T21) · `CredentialsStep({values,onChange,onComplete})` (T22→T24) · `ConfirmStep({values})` (T23→T24) · `WIZARD_STEPS` ids install/database/credentials/confirm (T16→T24). Consistent.
