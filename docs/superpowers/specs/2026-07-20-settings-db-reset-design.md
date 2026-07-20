# Settings "Reset configuración" — Design

## Context

The app already has a destructive reset feature, but it's scoped and placed wrong: it lives inside the model-catalog "Tienda" modal (`apps/web/app/api/model-catalog/reset/route.ts` + a danger-zone block at the bottom of `apps/web/app/components/ModelosSection.tsx`), and it only clears model-catalog state (`installed_classification_models`, `RETRIEVAL_MODEL`/`VERIFICATION_MODEL` settings, and the inference code backup).

This design **replaces that feature entirely** with a broader "Restablecer configuración" reset that lives in Ajustes (Settings) → Sistema, wipes the whole application database (with a safety backup first), and still restores inference code files exactly as the old feature did.

## What gets removed

- `apps/web/app/api/model-catalog/reset/route.ts` and its test file.
- The destructive reset block (`resetConfirmText`/`resetting` state, `resetCatalog()`, and the red danger-zone JSX) inside `apps/web/app/components/ModelosSection.tsx`.
- `deleteAllClassificationModels` in `apps/web/lib/model-catalog/classification-models.ts` — superseded by the generic table truncation (its only caller is the route being deleted).

## New route: `POST /api/settings/reset`

File: `apps/web/app/api/settings/reset/route.ts`. Body `{ confirm: "RESET" }` (exact match, 400 otherwise — same contract as the feature it replaces).

Steps, in order:

1. **Backup.** Call `backupDatabaseToJson()` (new, see below). If this throws, return 500 immediately — nothing else runs. A failed backup must never be allowed to proceed to truncation.
2. **Restore inference code, if applicable.** Identical logic to the current `model-catalog/reset/route.ts` (lines 42-67 today): read `readUninstallMeta()`; if either `currentVersion` or `previousVersion` is non-null, run `restoreInferenceCode(INFERENCE_DIR, PREVIOUS_CODE_DIR)`, POST `${origin}/api/setup/run/restart-inference`, poll `waitForInferenceReady()`. On restore/poll failure, return 502 with the same messages as today — **truncation must not run**. On success, `writeUninstallMeta({ currentVersion: null, previousVersion: null })` and `clearPreviousBackup()`.
3. **Truncate application tables.** `TRUNCATE TABLE <list> RESTART IDENTITY CASCADE` in one statement, where `<list>` is the fixed, explicit list below (not discovered dynamically at request time — see Global Constraints).
4. **Reset settings.** `getSettingsRepo().setSetting("RETRIEVAL_MODEL", "lumi-preview", false)` and `setSetting("VERIFICATION_MODEL", "", false)` — same defaults as today. (Safe even though `system_settings` was just truncated: the settings repo just re-inserts these two rows.)

Return `{ ok: true }` on success.

### Table list (step 3)

Truncate exactly these tables in the `public` schema — the application's own data:

```
api_usage, areas, indexed_images, indexed_points, installed_classification_models,
search_batches, search_candidates, search_regions, searches, system_settings, worker_heartbeat
```

Explicitly **excluded**: `pgmigrations` (node-pg-migrate's bookkeeping table — truncating it desyncs the migration tool from the schema that's actually applied) and everything in the `tiger`/`topology` schemas plus `spatial_ref_sys` (PostGIS reference data installed by the extension, not application data — truncating it breaks geocoding until the extension is reinstalled).

## Backup: `apps/web/lib/settings/db-backup.ts`

```ts
export async function backupDatabaseToJson(pool: Pool): Promise<string>
```

For each table in the same fixed list above (not discovered via `information_schema` — see Global Constraints), run `SELECT * FROM <table>`, and write one file to `data/db-backups/<ISO-timestamp>.json` with the shape:

```json
[{ "table": "areas", "rows": [ /* ... */ ] }, { "table": "system_settings", "rows": [ /* ... */ ] }, ...]
```

Returns the absolute path written. No retention/cleanup — files accumulate indefinitely; the user can delete old ones manually. This is a safety net for an accidental reset, not a one-command restore tool — restoring from it (if ever needed) is a manual, ad-hoc operation outside this feature's scope.

`data/db-backups/` is created if missing (`mkdir(..., { recursive: true })`), same pattern as `uninstall-state.ts`'s `BACKUPS_ROOT`.

## UI

### `SystemPanel.tsx`

Add a second `FloatingCard` below the existing "Volver a ejecutar el setup" one: a danger-zone card titled "Restablecer configuración" with a one-line description ("Borra todos los datos de la aplicación y restaura los modelos originales. Se guarda una copia de seguridad local antes de borrar. No se puede deshacer.") and a red "Restablecer…" button that opens `ResetConfirmDialog`.

### New: `apps/web/app/components/ResetConfirmDialog.tsx`

Built on `OverwriteKeyModal.tsx`'s exact pattern: `"use client"`, `framer-motion` `overlay`/`popIn` variants from `apps/web/lib/motion.ts`, Escape-to-close via a `keydown` listener, backdrop `fixed inset-0 z-50 bg-black/50` with `onClick={onClose}`, inner card `stopPropagation`, `w-[340px] rounded-[14px] border border-white/12 bg-elevated p-[18px]`.

Contents: warning copy, a text input requiring the user to type `RESET` exactly (mirroring the removed `ModelosSection.tsx` behavior) to enable the confirm button, Cancelar/confirm button pair. While the request is in flight, render `ModelLoadNotification` (it can trigger a real inference restart, same as the feature it replaces) and disable both buttons. On success, close the dialog and show a brief status message in `SystemPanel`; on failure, show the server's error message inline in the dialog without closing it.

Props: `{ onClose: () => void; onDone: () => void }` — `onDone` lets `SystemPanel` show a "Configuración restablecida" status line after the dialog closes.

## Error handling

Same ordering guarantee the current feature already has, extended by one more step at the front:

```
backup (must succeed) → risky restore+restart (must succeed) → destructive truncate → settings reset
```

If backup fails: 500, nothing else touched. If restore/restart fails: 502, nothing DB-side touched (matches today's behavior exactly). Only once both of those succeed does anything irreversible happen.

## Testing

`apps/web/app/api/settings/reset/route.test.ts`, mirroring today's `model-catalog/reset/route.test.ts`:

- 400 when `confirm !== "RESET"`.
- Backup runs before anything else; if `backupDatabaseToJson` rejects, route returns 500 and `restoreInferenceCode`/`pool.query` (truncate) are never called.
- Existing two regression tests carried over: restore-fails → 502, truncate/setSetting never called; restart-never-ready → 502, same assertions.
- Happy path: backup called, truncate called with the full fixed table list, both settings reset, `{ ok: true }` returned.

`apps/web/lib/settings/db-backup.test.ts` (new): given a mocked pool returning distinct rows per table, asserts the written file's JSON shape (`[{ table, rows }]`) covers every table in the fixed list, using a mocked `node:fs/promises`.

## Global Constraints

- The table list (for both truncation and backup) is a **fixed, hardcoded array** in the route/lib, not discovered dynamically via `information_schema.tables` at request time — a dynamic query would silently start truncating (or backing up) any future table added to the `tiger`/`topology`/PostGIS schemas, or a future `pgmigrations`-like bookkeeping table, without anyone re-reviewing this feature. Adding a new application table later means updating this array explicitly.
- `confirm` must match the exact string `"RESET"` — same as the feature being replaced.
- The ordering (backup → risky restore → destructive truncate → settings reset) is non-negotiable: nothing irreversible happens until both prior steps have succeeded.
