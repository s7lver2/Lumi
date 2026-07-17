# Settings & Setup Redesign — Design

## Context

Two related but independently-shippable problems, bundled into one spec at the user's request:

1. **Settings page is visually broken.** `apps/web/app/settings/page.tsx` wraps everything in `max-w-2xl`, so the whole page (sidebar tabs + content) sits pinned to the top-left of the viewport with a large empty area to the right (confirmed via screenshot). The "Volver a ejecutar el setup" action is a `FloatingCard` sitting loose below the Guardar button, visible under every tab, with no section of its own.

2. **The Setup wizard predates the model catalog** (built earlier in this project) and still downloads model weights unconditionally as part of the "Instalación" step, with no way to pick which models to fetch or why. The user wants Setup to align with the catalog concept: ask what the user will use Lumi for, recommend models based on that, and install the recommendation with visible progress — while removing the unconditional weight-download items from Instalación.

Both were brainstormed together using the visual companion (mockup comparisons for width, tab placement, step ordering, and the "Uso" card grid) — decisions below reflect the approved mockups plus two technical findings surfaced along the way (see Architecture).

## Goals

- Settings page uses the full available window width instead of being pinned to a corner.
- The setup-rerun action lives in its own dedicated "Sistema" section instead of floating below every tab.
- Setup's Instalación step no longer downloads model weights unconditionally.
- Setup gains a "Uso" step (multi-select: reconocimiento de imágenes / solo testeo / geolocalización / experimentación con herramientas) and a "Modelos recomendados" step that installs the recommended model(s) with visible progress.
- Lumi Preview ends up published as the model catalog's first real entry (operational step, guided after implementation — not a coding deliverable of this spec).

## Non-goals

- No changes to the model catalog's GitHub-Releases backend, `/api/model-catalog/*` routes, or the Tienda popup (`CatalogBrowser`/`DatasetsSection`/`ModelosSection`) built in the prior redesign.
- No per-use-case recommendation intelligence beyond a static lookup table — today every use-case maps to the same single bundle (`lumi-preview`), since that's the only entry in `MODEL_BUNDLES`.
- No changes to `download_weights.py`, `services/inference`, or `packages/shared-types` — the existing weight-download commands and `MODEL_BUNDLES` registry are reused as-is, just triggered from a different place in the wizard.
- No code for publishing Lumi Preview to the catalog — `/api/model-catalog/publish` already exists; seeding it is a manual, guided, one-time action the user performs after this spec ships.
- Settings content itself does not move to a multi-column grid — stays single-column, just within a wider container (per approved mockup).

## Architecture

### Settings

- `settings/page.tsx`: replace `max-w-2xl` with a wider cap (`max-w-[1100px]`) so the sidebar + content fill more of the viewport without content cards becoming absurdly wide.
- `SettingsPanel.tsx`: add a `"system"` entry to `tabItems` (same pattern as the existing `"areas"` special case — not backed by `SETTINGS_SECTIONS`/`groupSettings()`, since it has no setting keys). Add a `SECTION_ICON.system` entry. Render it as its own branch in the tab-content conditional, alongside the existing `activeTab === "areas"` branch.
- New `apps/web/app/components/SystemPanel.tsx`: contains exactly what the current loose "Volver a ejecutar el setup" `FloatingCard` renders today (same copy, same `<a href="/setup">`). The old inline block at the bottom of `SettingsPanel.tsx` is deleted — it only ever rendered for non-"areas" tabs, so removing it doesn't touch the Áreas tab's behavior.

### Setup wizard

**Two technical findings that shape this section** (confirmed by reading the actual route/script code, not assumed):

1. `verify-services` (the "Arrancar y verificar servicios" item) starts uvicorn and polls `/docs` — it needs model weights already on disk to be a meaningful check, so it cannot stay in Instalación once Instalación stops downloading weights. It moves to be the last checklist item of the new "Modelos recomendados" step.
2. The model catalog's install mechanism (`/api/model-catalog/install`) only swaps `.py` code + `requirements.txt` fetched from GitHub Releases — it never touches actual model weight bytes. The real weight bytes (MegaLoc via `torch.hub`, RoMa via `huggingface_hub`) only ever come from `download_weights.py`, run via the existing `weights-retrieval`/`weights-verification`/`weights-retrieval-wsl`/`weights-verification-wsl` step ids in `apps/web/app/api/setup/run/[step]/route.ts`. Those commands are unchanged and reused — only their place in the wizard changes.

**Step sequence** (`apps/web/app/setup/wizard-steps.ts`): `install → usage → models → database → credentials → confirm` (was `install → database → credentials → confirm`).

**`InstallStep.tsx` / `ITEMS_BY_RUNTIME`**: remove the `weights-retrieval`/`weights-verification` (and their `-wsl` variants) and `verify-services` entries from all three runtime arrays (`windows`, `linux`, `wsl`). Each array keeps only its environment-setup items (`windows`/`linux`: `inference-venv`, `inference-deps`; `wsl`: `inference-wsl-prereqs`, `inference-venv-wsl`, `inference-deps-wsl`). The intro copy ("Verificaremos PostgreSQL y descargaremos el entorno de inferencia y los pesos...") drops the "y los pesos de Lumi Preview y Laila" clause and the "~2.5 GB" figure, since weights are no longer downloaded in this step.

**New `apps/web/app/setup/model-recommendations.ts`** (plain data + one function, colocated test):

```ts
import { MODEL_BUNDLES, type ModelBundleDefinition } from "@netryx/shared-types";

export const USE_CASES = [
  { id: "image-recognition", label: "Reconocimiento de imágenes", icon: "📷", blurb: "identificar lugares a partir de fotos" },
  { id: "testing", label: "Solo testeo", icon: "🧪", blurb: "probar la app, sin uso serio" },
  { id: "geolocation", label: "Geolocalización", icon: "📍", blurb: "ubicar imágenes en el mapa" },
  { id: "experimentation", label: "Experimentación", icon: "🛠", blurb: "probar herramientas y modelos" },
] as const;
export type UseCaseId = (typeof USE_CASES)[number]["id"];

// Every use case maps to the same bundle today — MODEL_BUNDLES has exactly
// one entry (lumi-preview). Adding a second bundle later means adding rows
// here without touching the wizard components.
const RECOMMENDATIONS_BY_USE_CASE: Record<UseCaseId, string[]> = {
  "image-recognition": ["lumi-preview"],
  testing: ["lumi-preview"],
  geolocation: ["lumi-preview"],
  experimentation: ["lumi-preview"],
};

export function recommendedBundles(selected: UseCaseId[]): ModelBundleDefinition[] {
  const ids = new Set(selected.flatMap((id) => RECOMMENDATIONS_BY_USE_CASE[id] ?? []));
  return MODEL_BUNDLES.filter((b) => ids.has(b.id));
}
```

If `selected` is empty (user clicked Siguiente without picking anything), `recommendedBundles([])` returns `[]` — the Modelos step then falls back to recommending every bundle in `MODEL_BUNDLES` (today: just `lumi-preview`), so a user can't strand themselves with zero models by skipping the survey. This fallback lives in `ModelsStep.tsx`, not in `recommendedBundles` itself (keeps the pure function's contract simple: "recommendations for these use cases", not "recommendations, or everything if none").

**New `apps/web/app/setup/steps/UsageStep.tsx`**: card grid (per approved mockup) — `USE_CASES` rendered as a 2×2 grid of selectable cards (icon, label, blurb), `data-multiselect`-style toggle state held as `UseCaseId[]`, real Lumi tokens (`rounded-card`, `border-white/10`/`bg-white/[.03]` default, `border-accent`/`bg-white/[.06]` + white ✓ badge when selected, `text-fg`/`text-muted`/`text-subtle`), wrapped in `motion.div variants={fadeRise}`. "Siguiente" is always enabled here (selecting nothing is valid — see fallback above). Props follow `InstallStep`'s existing split between a value-change callback and a no-arg completion callback: `{ selected: UseCaseId[]; onSelectedChange: (ids: UseCaseId[]) => void; onComplete: () => void }` — `onSelectedChange` fires on every card toggle (so `SetupWizard` always holds the current selection), `onComplete` fires once, on first render, marking the step done immediately (selecting nothing is valid, so there's no gating condition here unlike `CredentialsStep`'s key-test-gated completion).

**New `apps/web/app/setup/steps/ModelsStep.tsx`**: takes `useCases: UseCaseId[]` (collected from the Uso step), computes `const bundles = recommendedBundles(useCases); const toInstall = bundles.length > 0 ? bundles : MODEL_BUNDLES;`. Renders one recommendation blurb per bundle ("Recomendado para: reconocimiento de imágenes, geolocalización" — built by reverse-mapping `useCases` against `RECOMMENDATIONS_BY_USE_CASE`, or "Recomendado" alone if using the empty-selection fallback), then a checklist reusing the existing `InstallItem` component: for `lumi-preview` specifically, the checklist items are `weights-retrieval`, `weights-verification`, `verify-services` (same `stepId`s as before, run via the same `useCommandRun`/`run/[step]` SSE mechanism — `InstallItem` is reused unmodified). `onComplete()` fires once all items are done, same pattern as `InstallStep`.

**`SetupWizard.tsx`**: add `usage`/`models` to the `panel` map and `SUBTITLE` record (`usage: "para qué vas a usar Lumi."`, `models: "instalando lo recomendado."`); the existing `collected` state is a `Record<string, string>` (string values only), so the Uso step's array selection needs its own state — add `const [useCases, setUseCases] = useState<UseCaseId[]>([])` alongside the existing `collected`/`done`/`dirty`-equivalent state, wire `UsageStep`'s `selected`/`onSelectedChange` to it, and pass `useCases` into `ModelsStep`.

### Data flow summary

```
UsageStep (multi-select) --useCases--> ModelsStep --recommendedBundles()--> MODEL_BUNDLES (static)
                                              |
                                              +--> InstallItem(weights-retrieval) --> InstallItem(weights-verification) --> InstallItem(verify-services)
```

The live GitHub model catalog (`GET /api/model-catalog`, the Tienda popup) is untouched and unrelated to this flow — it's for installing *additional* model versions after setup, once something has been published to it.

## Error handling

- `ModelsStep`: if any `InstallItem` reports `ok === false` (non-zero exit), the existing `InstallItem` retry button already handles this (unchanged component) — `onComplete` simply never fires until all items succeed, matching `InstallStep`'s current behavior.
- `UsageStep`: no network calls, nothing to fail.
- Settings "Sistema" tab: the setup-rerun link (`<a href="/setup">`) has no new failure mode — it's copied verbatim from the current implementation.

## Testing

- `apps/web/app/setup/model-recommendations.test.ts`: `recommendedBundles` returns `["lumi-preview"]`'s definition for each individual use case, returns the union (deduped) for multiple use cases, and returns `[]` for an empty selection (the empty-selection fallback is `ModelsStep`'s concern, tested at that layer conceptually via the data function returning `[]` — no DOM tests exist in this repo, per `apps/web/vitest.config.ts`'s `environment: "node"`, so `ModelsStep`/`UsageStep` component behavior itself is not unit-tested, consistent with `InstallStep`/`CredentialsStep` today).
- `apps/web/app/setup/wizard-steps.test.ts` (existing file): extend for the new step ids — `nextStep`/`prevStep` traverse the full 6-step sequence correctly, `isComplete` still only true for `"confirm"`.

## Post-implementation operational step (not part of this plan's tasks)

Once shipped, publishing Lumi Preview as the catalog's first entry means, on a working instance with Lumi Preview active and indexed images present:
1. Configure `GITHUB_TOKEN` and `MODEL_CATALOG_REPO` in Settings → Modelos (already possible today).
2. Call `POST /api/model-catalog/publish` (no UI trigger exists or is being added — this is a deliberate one-time action, done via curl/Postman, per the user's decision to keep this out of the UI).
3. Confirm the release appears by opening the Tienda popup's Modelos tab.
