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
 * most recently deactivated row for a genuinely DIFFERENT version of that
 * same modelId (if any) — this is a version rollback, one level back per
 * call, same as clicking "uninstall" again on the newly-reactivated row
 * would step back one more level. It is never a no-op relabelled as
 * "still installed": reactivating a row of the exact same version that
 * was just turned off isn't a rollback, it's the same state under a new
 * row id — the button said "Desinstalar" and the model must end up off
 * (confirmed live: wanda-v1 had 4 rows all at version "1.0" from repeated
 * installs during testing, so the old any-previous-row logic kept
 * reactivating a same-version row every time, and "Desinstalar" looked
 * like it did nothing).
 *
 * Captures every version currently active before deactivating (there can
 * be more than one row if older data predates installClassificationModel's
 * duplicate-prevention fix) and excludes ALL of those versions, not just
 * the specific row ids, from the "find a previous version" search. */
export async function uninstallClassificationModel(pool: Pool, modelId: string): Promise<{ restoredVersion: string | null }> {
  const { rows: activeRows } = await pool.query(
    `SELECT manifest FROM installed_classification_models WHERE model_id = $1 AND active = true`,
    [modelId]
  );
  const deactivatedVersions = (activeRows as { manifest: GenericClassifierManifest }[]).map((r) => r.manifest.version);

  await pool.query(
    `UPDATE installed_classification_models SET active = false WHERE model_id = $1 AND active = true`,
    [modelId]
  );

  const { rows } = await pool.query(
    `SELECT id, manifest FROM installed_classification_models
     WHERE model_id = $1 AND active = false AND NOT (manifest->>'version' = ANY($2::text[]))
     ORDER BY installed_at DESC LIMIT 1`,
    [modelId, deactivatedVersions]
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
 * meaning it fully uninstalls to "nothing installed" for this model) —
 * must match uninstallClassificationModel's own same-version exclusion,
 * or the button label ("Desinstalar (volver a vX)") promises a rollback
 * that the click won't actually perform. */
export async function getClassificationModelHistory(
  pool: Pool,
  modelId: string
): Promise<{ available: boolean; previousVersion: string | null }> {
  const { rows: activeRows } = await pool.query(
    `SELECT manifest FROM installed_classification_models WHERE model_id = $1 AND active = true`,
    [modelId]
  );
  if (activeRows.length === 0) return { available: false, previousVersion: null };
  const activeVersions = (activeRows as { manifest: GenericClassifierManifest }[]).map((r) => r.manifest.version);

  const { rows: previousRows } = await pool.query(
    `SELECT manifest FROM installed_classification_models
     WHERE model_id = $1 AND active = false AND NOT (manifest->>'version' = ANY($2::text[]))
     ORDER BY installed_at DESC LIMIT 1`,
    [modelId, activeVersions]
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

/** Finds the active classification model, if any, whose manifest declares
 * the given facet — e.g. `findActiveModelForFacet(pool, "time_of_day")`
 * to discover which installed model (Wanda today, whatever tomorrow) can
 * serve a time-of-day classification, without hardcoding a modelId. */
export async function findActiveModelForFacet(pool: Pool, facet: string): Promise<{ modelId: string } | null> {
  const manifests = await listActiveClassificationModels(pool);
  const match = manifests.find((m) => m.facets.some((f) => f.facet === facet));
  return match ? { modelId: match.modelId } : null;
}