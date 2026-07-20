# Forensic Vision / Velle / Wanda — Brainstorm Notes (Paused)

**Status:** Paused mid-brainstorm at the user's request, to resume later. This is NOT an approved design spec — it's a checkpoint of decisions made and open questions, so the thread can pick up without re-deriving context. Do not implement anything from this document without first resuming the brainstorm and reaching an approved design (per `superpowers:brainstorming`).

## Origin

User wants to make the model-catalog install/uninstall system (`apps/web/app/components/ModelosSection.tsx`, `CatalogDetailPanel.tsx`, `apps/web/app/api/model-catalog/{install,uninstall,route}.ts`) more robust, and add a VRAM usage bar per model card. While scoping that, the user expanded into a larger set of related ideas and asked to decompose into sub-projects. Sub-projects, in the user's chosen order:

- **C/D (do first):** two new AI "expert" models — Velle and Wanda — plus a new standalone screen, Forensic Vision, to run them outside of Lumi Preview's map-based flow.
- **A (deferred):** model-catalog robustness (error handling, pre-install protections, real multi-level version history).
- **B (deferred):** VRAM usage bar per model card (total VRAM vs. model footprint).
- **Separate, deferred indefinitely:** authentication system, admin panel, accounts, and projects — user will explain this later; do not design it until they raise it again.

This document covers only C/D, since that's the thread that was active when paused.

## Decisions made so far

### Velle (new model)
- Purpose: car make/model recognition.
- Integrate a pretrained open-source model rather than train from scratch (user's explicit choice).
- Best candidate found via research: `Jordo23/vehicle-classifier` (Hugging Face, PyTorch/ONNX, trained on VMMRdb). Alternative: `Helias/Car-Model-Recognition` (GitHub, ResNet transfer learning, also VMMRdb-based).
- User said plainly they need to actually source/build this integration themselves ("te toca crearlos jaja, necesito crearlos también") — i.e. this is real integration work, not a stub/simulation.

### Wanda (new model)
- Purpose: weather + time-of-day + season — "todo con IA" (user's explicit choice: full AI coverage, not heuristics for any part).
- Weather: `prithivMLmods/Weather-Image-Classification` (Hugging Face, SigLIP2-based, 5 classes: cloudy/overcast, foggy/hazy, rain/storm, snow/frosty, sun/clear).
- Time-of-day and season: no dedicated pretrained model found. Proposed approach (not yet formally approved as final, but was the direction the user was nodding along with): CLIP zero-shot classification, scoring the image against custom text prompts (e.g. "photo taken at dawn/noon/dusk/night", "photo taken in winter/summer/autumn/spring"). This is still a real pretrained model (CLIP), just used zero-shot rather than fine-tuned.

### Forensic Vision (new standalone screen)
- Purpose: run Velle/Wanda on an image without Lumi Preview's map/geolocation flow.
- Description: "una especie de editor de imagenes, pero que no es para editarlas, es para usar los modelos en el" — an image-editor-like screen, not for editing, but for running models on the image.
- Entry points: BOTH a new icon in the left sidebar AND an option in `ModePicker`. `ModePicker` gets simplified to only two entries: "Lumi Preview" and "Forensic Vision" — the current locked placeholders ("Identificar vehículo", "Detectar IA generativa" in `apps/web/app/components/ModePicker.tsx`) are dropped entirely, not kept as separate future options.

### Forensic Vision UI — converged direction (6-7 rounds of mockup iteration)
Mockup files (scratch, not committed, under `.superpowers/brainstorm/383963-1784386650/content/`): `forensic-vision-layout.html` → `-v2.html` → `-v3.html` → `-v4.html` → `-details.html` → `-davinci.html` → `-tools.html`. Each iteration was rejected/refined; the LAST one (`forensic-vision-tools.html`) is closest to what the user wants but has not been explicitly approved yet. Converged points:

- Overall chrome should mirror the app's own existing UI structure (left icon rail, dark panel styling, existing component language) — NOT literally imitate a third-party app. Earlier in the thread the user said "estilo de geospy" for icons/colors, then corrected: **"queria decir de nuestra app"** — i.e. stick to Lumi's own established visual language (the same dark-panel/token system already used elsewhere), not import an external product's look.
- Top toolbar, **centered**, editor-style: pan/move, zoom, then a divider, then the model tools themselves (Velle, Wanda) as selectable/clickable toolbar icons — clicking one activates it (highlighted, e.g. green background).
- Toolbar icons should show a hover preview: small text + a mini before/after-style preview graphic of what the tool does (mocked in `forensic-vision-details.html`, piece 1).
- **Contextual side panel**: shows ONLY the currently-active/selected tool's content — not all results stacked at once. This is a structural change from earlier mockups (v3/v4/davinci) which showed all result types together.
- **Vehicle (Velle) results panel**: 3 tabs — Info (spec grid: potencia, motor, 0-100, tracción), Precios (2-column grid of online listing sources with colored source-icon dots, price, thumbnail), Matrícula (large "Analizar matrícula" button to attempt plate OCR/lookup).
- **Weather (Wanda) results panel**: stays widget-like (matches the existing weather widget card style), no tabs.
- **Detection markers on the canvas**: when a model detects/highlights a region, show the model's name as a label plus an animated "marching ants" dashed border (like a photo-editor selection marquee) — NOT a static solid-color bounding box. Implemented in the last mockup via an SVG `<rect>` with `stroke-dasharray` + a CSS `@keyframes` animating `stroke-dashoffset`.
- **Interaction model**: click a tool in the toolbar to select/activate it (only one active at a time, panel reflects only that tool). Additionally, the user can manually drag on the canvas around a subject (e.g., a car) to draw/adjust a focus region that helps the active tool concentrate its analysis there — this is assistive, optional, and layered on top of the click-to-select model, not a replacement for it.
- Visual reference explicitly requested at one point: DaVinci Resolve-style chrome — square page-selector-style tab buttons (icon on top, label below) instead of horizontal text tabs, toolbar icon groups separated by thin vertical dividers with subtle-border boxed buttons, tight `justify-content:space-between` inspector-style rows with thin dividers, and a darker/less-blue-tinted neutral grey palette than earlier mockups. This was folded into `forensic-vision-davinci.html` and carried forward into `forensic-vision-tools.html`.

## Open questions / not yet resolved

1. **Final mockup approval**: `forensic-vision-tools.html` (the 7th iteration) was shown but the user paused before confirming it captures everything correctly. Needs an explicit "yes, this is it" (or another round of tweaks) before moving to architecture/approach proposals.
2. **Combined-view option**: the current tool-selection model shows only one tool's results at a time. Not yet asked/answered whether the user also wants some way to see Velle + Wanda results together (e.g., after running "analyze all"), or if strictly one-at-a-time is final.
3. **Drag-to-focus interaction**: only represented as a hint string in the mockup ("Arrastra sobre el coche para enfocar el análisis de Velle aquí") — the actual drag/bounding-box UX (how it's drawn, how it's cleared, whether it's per-tool or shared, whether it's sent to the backend as a crop/mask or just a hint) has not been designed.
4. **Backend/integration design** for Velle and Wanda has not been discussed at all yet: how they plug into `services/inference` (new model registry entries? new endpoint(s)? reuse of the existing `/verify`-style flow or a new one specific to Forensic Vision?), how the standalone mode's image upload/session works without the map/geolocation flow, and how results get persisted/displayed relative to the existing `WidgetGrid`/widget components already built for weather/EXIF/time estimates.
5. **Model sourcing mechanics**: whether Velle/Wanda ship as regular catalog releases (like existing models, installable/uninstallable through the model-catalog system) or are bundled differently, hasn't been decided.

## Explicitly deferred (do not start without the user re-raising it)

- Sub-project A: model-catalog install/uninstall robustness (error handling, pre-install protections — disk space check, no-concurrent-installs, confirm-before-replacing-active — and real multi-level version history, replacing the current single-level undo in `apps/web/lib/model-catalog/uninstall-state.ts`).
- Sub-project B: VRAM usage bar per model card (needs new raw numeric VRAM fields — `services/inference/vram.py`'s `describe_gpu()` currently only returns a formatted string, not raw bytes — and a new per-model on-disk/VRAM-footprint size field in `ModelCatalogManifest`, `apps/web/lib/model-catalog/manifest.ts`, which doesn't exist yet).
- Authentication + admin panel + accounts + projects system — user will explain this separately when ready.

## Also still open from before this brainstorm thread (unrelated, but unresolved)

- The second `POST /api/model-catalog/publish` attempt returned an HTTP 500 with an empty body, root cause unknown — the web process's stdout/stderr isn't teed to any log file (`data/logs/` only covers `worker`/`inference` tags), so the actual server-side traceback was never captured. The user was asked to paste it directly from their terminal; this was never provided. The live catalog release under `s7lver2/lumi-model-catalog` (tag `lumi-preview-v1.0`) still has a manifest with a stale `verificationModelId: "laila"` from the first publish attempt, even though the local DB setting and `services/inference/models/registry.py` are now self-consistent (`roma-verify`). If the marketplace install flow needs to be authoritative (not just local settings), this release should eventually be re-published correctly.

## Resuming this thread

When picked back up: start at open question #1 (confirm or refine the `forensic-vision-tools.html` mockup), then work through questions #2-#5, then move to the brainstorming skill's normal next steps (propose 2-3 architectural approaches with trade-offs, present design in sections, get approval, write the real design spec, self-review, get user sign-off on the spec, then invoke `superpowers:writing-plans`).
