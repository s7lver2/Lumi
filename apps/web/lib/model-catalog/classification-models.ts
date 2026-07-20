// apps/web/lib/model-catalog/classification-models.ts
import type { Pool } from "pg";
import type { GenericClassifierManifest } from "./manifest";

/** Writes a new row for this model's release — every install is a fresh
 * row, never an overwrite, so uninstall can always step back to whatever
 * was active before (spec: docs/superpowers/specs/2026-07-20-unified-
 * model-catalog-design.md, real multi-level history via DB rows instead
 * of a single filesystem snapshot). */
export async function installClassificationModel(pool: Pool, manifest: GenericClassifierManifest): Promise<void> {
  await pool.query(
    `INSERT INTO installed_classification_models (model_id, manifest, active) VALUES ($1, $2, true)`,
    [manifest.modelId, JSON.stringify(manifest)]
  );
}

/** Deactivates the current active row for modelId, then reactivates the
 * most recently deactivated row for that same modelId (if any) — this is
 * the "undo" step, one level back per call, same as clicking "uninstall"
 * again on the newly-reactivated row would step back one more level. */
export async function uninstallClassificationModel(pool: Pool, modelId: string): Promise<{ restoredVersion: string | null }> {
  await pool.query(
    `UPDATE installed_classification_models SET active = false WHERE model_id = $1 AND active = true`,
    [modelId]
  );

  const { rows } = await pool.query(
    `SELECT id, manifest FROM installed_classification_models
     WHERE model_id = $1 AND active = false
     ORDER BY installed_at DESC LIMIT 1`,
    [modelId]
  );
  if (rows.length === 0) return { restoredVersion: null };

  const previous = rows[0] as { id: string; manifest: GenericClassifierManifest };
  await pool.query(`UPDATE installed_classification_models SET active = true WHERE id = $1`, [previous.id]);
  return { restoredVersion: previous.manifest.version };
}

/** Mirrors the code-bundle strategy's GET .../uninstall shape
 * ({available, previousVersion}), scoped to one modelId instead of the
 * single global snapshot. */
export async function getClassificationModelHistory(
  pool: Pool,
  modelId: string
): Promise<{ available: boolean; previousVersion: string | null }> {
  const { rows } = await pool.query(
    `SELECT manifest FROM installed_classification_models
     WHERE model_id = $1 AND active = false
     ORDER BY installed_at DESC LIMIT 1`,
    [modelId]
  );
  if (rows.length === 0) return { available: false, previousVersion: null };
  const row = rows[0] as { manifest: GenericClassifierManifest };
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