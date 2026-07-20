// apps/web/lib/model-catalog/classification-models.ts
import type { Pool } from "pg";
import type { GenericClassifierManifest } from "./manifest";

/** Writes a new row for this model's release — every install is a fresh
 * row, never an overwrite, so uninstall can always step back to whatever
 * was active before (spec: docs/superpowers/specs/2026-07-20-unified-
 * model-catalog-design.md, real multi-level history via DB rows instead
 * of a single filesystem snapshot).
 *
 * Deactivates any existing active row for this modelId first — installing
 * the same model twice (e.g. once from the setup wizard's recommended-
 * classifier step, once later from Ajustes) must never leave two active
 * rows at once, since uninstall assumes at most one (confirmed live: two
 * active rows for "wanda-v1" made uninstall bulk-deactivate both, then
 * immediately reactivate whichever the "find previous" query happened to
 * pick — the click did something, just never what the button said). */
export async function installClassificationModel(pool: Pool, manifest: GenericClassifierManifest): Promise<void> {
  await pool.query(
    `UPDATE installed_classification_models SET active = false WHERE model_id = $1 AND active = true`,
    [manifest.modelId]
  );
  await pool.query(
    `INSERT INTO installed_classification_models (model_id, manifest, active) VALUES ($1, $2, true)`,
    [manifest.modelId, JSON.stringify(manifest)]
  );
}

/** Deactivates the current active row for modelId, then reactivates the
 * most recently deactivated row for that same modelId (if any) — this is
 * the "undo" step, one level back per call, same as clicking "uninstall"
 * again on the newly-reactivated row would step back one more level.
 * Captures the row being deactivated first and excludes it from the
 * "find a previous version" search — without that exclusion, a model with
 * no other history matches its own just-deactivated row and immediately
 * reactivates it, making uninstall a silent no-op (confirmed live: the UI
 * reported "Restaurada v1.0" — the version it had just turned off — and
 * the row stayed active in the DB the whole time). */
export async function uninstallClassificationModel(pool: Pool, modelId: string): Promise<{ restoredVersion: string | null }> {
  const { rows: activeRows } = await pool.query(
    `SELECT id FROM installed_classification_models WHERE model_id = $1 AND active = true`,
    [modelId]
  );
  // Captures every row being deactivated, not just one — installs now
  // guard against creating duplicate active rows (see installClassification
  // Model), but existing data from before that fix may still have more
  // than one, and a single-id exclusion let the "find previous" search
  // match and immediately reactivate the OTHER row deactivated in this
  // very call.
  const deactivatedIds = (activeRows as { id: string }[]).map((r) => r.id);

  await pool.query(
    `UPDATE installed_classification_models SET active = false WHERE model_id = $1 AND active = true`,
    [modelId]
  );

  const { rows } = await pool.query(
    `SELECT id, manifest FROM installed_classification_models
     WHERE model_id = $1 AND active = false AND NOT (id = ANY($2::uuid[]))
     ORDER BY installed_at DESC LIMIT 1`,
    [modelId, deactivatedIds]
  );
  if (rows.length === 0) return { restoredVersion: null };

  const previous = rows[0] as { id: string; manifest: GenericClassifierManifest };
  await pool.query(`UPDATE installed_classification_models SET active = true WHERE id = $1`, [previous.id]);
  return { restoredVersion: previous.manifest.version };
}

/** Mirrors the code-bundle strategy's GET .../uninstall shape
 * ({available, previousVersion}), scoped to one modelId instead of the
 * single global snapshot. `available` means "is there something currently
 * installed to remove" — checking only for a deactivated prior row here
 * (confirmed live: a model's very first install has no prior row at all)
 * wrongly disabled uninstall entirely for a model with no version history
 * yet, even though it was genuinely active and removable. `previousVersion`
 * separately reports what a click would restore to afterward (or `null`,
 * meaning it fully uninstalls to "nothing installed" for this model). */
export async function getClassificationModelHistory(
  pool: Pool,
  modelId: string
): Promise<{ available: boolean; previousVersion: string | null }> {
  const { rows: activeRows } = await pool.query(
    `SELECT 1 FROM installed_classification_models WHERE model_id = $1 AND active = true`,
    [modelId]
  );
  if (activeRows.length === 0) return { available: false, previousVersion: null };

  const { rows: previousRows } = await pool.query(
    `SELECT manifest FROM installed_classification_models
     WHERE model_id = $1 AND active = false
     ORDER BY installed_at DESC LIMIT 1`,
    [modelId]
  );
  if (previousRows.length === 0) return { available: true, previousVersion: null };
  const row = previousRows[0] as { manifest: GenericClassifierManifest };
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