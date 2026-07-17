# Catalog browser redesign — design spec

Status: approved (design phase) — implementation not started.
Related: `docs/superpowers/specs/2026-07-14-dataset-catalog-design.md`,
`docs/superpowers/specs/2026-07-15-model-catalog-design.md` (this spec
replaces both features' UI; their backend routes are unchanged).

## Context

The dataset catalog and model catalog were both implemented this session
as Settings tabs (`DatasetsCatalogPanel.tsx`, `ModelCatalogPanel.tsx`),
each with an Explorar/Publicar sub-tab pair rendered inline inside
`SettingsPanel.tsx`. The user wants both rebuilt as a single popup browser
in the style of Factorio's in-game mod menu — a dense filterable list with
a detail panel, opened from its own entry point rather than buried in
Settings — and wants the dataset "Publicar" flow simplified from a
free-text form into a guided picker. Models lose their publish UI
entirely; publishing a model version becomes an internal/manual operation
(the backend route stays, nothing in the UI triggers it).

Design explored via the brainstorming visual companion: two layout
options were compared (dense Factorio-style list+sidebar vs. app-store
card grid) — **list+sidebar won**. Three detail-view interactions were
compared (right-side panel, full replace-with-back-button, inline
accordion) — **right-side panel won**. A 3-step publish wizard (choose
area → details → destination) was compared against a reordered
single-page form — **3-step wizard won**.

## Goals

- One popup ("Tienda"), opened from a new rail icon in `AppShell.tsx`,
  entirely independent of Settings. Datasets and Modelos are two sections
  inside it, switched via tabs in the popup's own header.
- Both sections share the same list+sidebar+detail-panel layout and the
  same underlying list/detail components — one implementation, not two
  parallel ones.
- Publishing a dataset becomes a 3-step wizard reached via a "+ Publicar
  dataset" button in the Datasets section (not a persistent sub-tab),
  replacing the free-text area-ID field with a real picker over the
  user's own indexed areas.
- The model catalog's Publicar UI is deleted outright. Browsing/installing
  model versions is the only capability exposed in the UI.
- `SettingsPanel.tsx` loses the "Datasets publicados" and "Catálogo de
  modelos" tabs and their wiring entirely.

## Non-goals

- No backend/API changes. `GET /api/datasets`, `POST /api/datasets/install`,
  `POST /api/datasets/publish`, `GET /api/model-catalog`,
  `POST /api/model-catalog/install` are all consumed exactly as they exist
  today. `POST /api/model-catalog/publish` also stays, just uncalled from
  any UI — publishing a model version is an operator-run `curl`/script
  action from now on, not a feature request here.
- No new settings/schema fields. "Remember the last-used dataset repo"
  is `localStorage`, not a server-persisted setting (explicit choice —
  the equivalent `MODEL_CATALOG_REPO` setting exists for models because
  that value feeds a real server-side default; the dataset repo field
  has never had one and doesn't need one just for this convenience).
- No real per-item thumbnails/images — datasets and models have no
  uploaded image asset in their manifests. Each row gets a generic,
  purely decorative icon (a map-pin glyph for datasets, a chip glyph for
  models), not a distinguishing thumbnail.
- No changes to the install flow's actual mechanics (backup/restore,
  compatibility mismatch dialog, benchmark gate) — only where/how the
  existing UI pieces are presented.

## Architecture

### Entry point

`AppShell.tsx`'s left icon rail gets one new entry ("Tienda", a
storefront-style icon) between the existing nav links and the settings
gear at the bottom. Clicking it sets local `open` state and renders
`<CatalogBrowser onClose={...} />` as a fixed-position overlay above
everything else (same `fixed inset-0 z-30` overlay convention already
used by the dataset catalog's `MismatchDialog`).

### `CatalogBrowser.tsx` (new)

The popup shell. Renders:
- A header: tab switcher (`Datasets` / `Modelos`), a search input, a close
  button.
- Below it, `<CatalogList>` for the active section, and — when a row is
  selected — `<CatalogDetailPanel>` beside it (55%/45% split, matching the
  approved mockup).
- For Datasets only: a "+ Publicar dataset" button in the header area that
  opens `<PublishWizard>` as a full-popup overlay on top of the list
  (closing it returns to the list, selection state preserved).

Owns: `activeSection: "datasets" | "models"`, `selectedItem`, `query`
(search text), `publishWizardOpen`.

### `CatalogList.tsx` (new, shared by both sections)

Props: `items`, `filters` (the sidebar's category list — differs per
section, see below), `activeFilter`, `query`, `onSelect(item)`,
`selectedId`.

- Left sidebar: category filters.
  - Datasets: **Todos / Compatibles / No compatibles** (compatibility
    computed exactly as `DatasetsCatalogPanel.tsx` does today, from each
    release's `compatible` flag — see Data below for why there's no
    separate "Instalados" filter here).
  - Modelos: **Todos / Instalada** (only one version can be active,
    from the existing `isActive` flag).
- Center: one row per item — icon, name, owner/repo or version subtitle,
  a compatibility/active badge, and (datasets only, matching today's
  behavior) an inline "Instalar" button for the non-selected state.
  Selecting a row highlights it and opens the detail panel; it does not
  install anything by itself.

### `CatalogDetailPanel.tsx` (new, shared)

Props: `item`, `onInstall`, `installStatus`. Renders the stats grid
(points/images for datasets; accuracy/avgDistance/sampleCount for models —
same fields `ModelCatalogPanel.tsx`'s existing selected-release view
already shows), backbones list for models, and the Instalar button. The
dataset mismatch confirmation (`MismatchDialog` from
`DatasetsCatalogPanel.tsx`) is reused verbatim, triggered the same way
(install attempt returns `compatible:false` → dialog → confirm re-sends
with `forceInstall:true`).

### `PublishWizard.tsx` (new, datasets only)

Three steps, each a distinct screen inside the same overlay, with
Volver/Siguiente footer navigation:

1. **Elige el área** — fetches `GET /api/areas`, filters to
   `status === "indexed"` client-side (in-progress areas are listed
   grayed out and unselectable, matching the mockup, so the user
   understands why they're missing rather than wondering where their
   area went), a search box, click-to-select rows.
2. **Detalles** — Título (pre-filled from the area's `name`, editable),
   Descripción (optional textarea).
3. **Destino y publicar** — Repositorio destino (`owner/repo` text input,
   pre-filled from `localStorage.getItem("lumi:lastDatasetRepo")` if
   present), the existing read-only "se publicará como {modelo} v{versión}"
   tag, the existing ToS checkbox, and the Publicar button. On a
   successful publish, writes the repo back to
   `localStorage.setItem("lumi:lastDatasetRepo", repo)`.

Calls `POST /api/datasets/publish` with the exact same body shape
(`areaId, title, description, owner, repo`) the current form already
sends — only the surrounding UI changes.

### Deletions

- `apps/web/app/components/DatasetsCatalogPanel.tsx` and
  `apps/web/app/components/ModelCatalogPanel.tsx` are deleted outright
  (their `ExplorarTab`/`ReleaseRow`/`MismatchDialog` logic is carried
  forward into the new shared components; `PublicarTab` from
  `ModelCatalogPanel.tsx` is not carried forward anywhere).
- `SettingsPanel.tsx` loses: the `DatasetsCatalogPanel`/`ModelCatalogPanel`
  imports, the `datasets`/`model-catalog` `SECTION_ICON` entries, their
  `tabItems` entries, and their `activeTab === ...` render branches.

## Data

- Datasets/models lists: unchanged `GET /api/datasets` /
  `GET /api/model-catalog` responses.
- No "Instalados" filter for datasets: unlike models (single active
  version, exposed as `isActive`), dataset installs are additive — you
  can install the same or a different area repeatedly, and today's
  `GET /api/datasets` response carries no "this exact release is already
  installed locally" flag. Inventing one (e.g. stamping installed release
  tags into a new table) is a real feature, not something this UI-only
  redesign should smuggle in — so the datasets sidebar only ever shows
  **Todos / Compatibles / No compatibles**.

## Error handling

Unchanged from today's behavior, just relocated: install failures show
in the detail panel's status area; the compatibility-mismatch dialog is
reused verbatim; a failed `POST /api/datasets/publish` call (e.g. missing
`GITHUB_TOKEN`, network error) shows inline in the wizard's step 3, same
as today's error text. `GET /api/areas` failing (network/DB down) shows
an inline error in the wizard's step 1 instead of an empty list.

## Testing

- Unit: `CatalogList`'s filter logic (Todos/Compatibles/No compatibles/
  Instalada) against fixture data for both sections.
- Unit: `PublishWizard`'s step transitions (can't advance past step 1
  without a selected area, step 2 without a title) and the
  localStorage read/write for the remembered repo.
- Manual: open the popup from the rail icon, switch between Datasets/
  Modelos, select a row, confirm the detail panel and install flow work
  end to end for both; run the publish wizard against a real indexed
  area and confirm the release appears in Explorar afterward.
