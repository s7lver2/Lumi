// apps/web/app/setup/actions.ts
"use server";

import { redirect } from "next/navigation";
import { SETTINGS_SCHEMA, validateSettingValue } from "@netryx/shared-types";
import { getSettingsRepo, type SettingsRepo } from "../../lib/settings-repo";
import { writeRuntimeMarker } from "../../lib/runtime-marker";

export type SubmitSetupResult = { ok: true } | { ok: false; error: string };

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
function resolveValue(formData: FormData, def: (typeof SETTINGS_SCHEMA)[number]): string {
  const raw = formData.get(def.key);
  if (raw !== null) return String(raw);
  return def.defaultValue ?? "";
}

export async function submitSetup(
  repo: Pick<SettingsRepo, "completeSetup">,
  formData: FormData
): Promise<SubmitSetupResult> {
  const writes = SETTINGS_SCHEMA.map((def) => ({
    key: def.key,
    value: resolveValue(formData, def),
    isSecret: def.isSecret,
  }));

  for (const def of SETTINGS_SCHEMA) {
    const value = resolveValue(formData, def);
    // GOOGLE_MAPS_API_KEY is optional overall now (spec: docs/superpowers/
    // specs/2026-07-20-setup-credentials-step-google-optional-design.md) —
    // CredentialsStep's own client-side gate ("must pass test only if
    // non-empty") already lets the wizard reach this final submit with an
    // empty key. The schema still marks it required: true (that still
    // drives Ajustes' "replace key" gate elsewhere), so this one key is
    // exempted from the generic required-check here instead of flipping
    // the shared schema flag, which would also loosen that unrelated flow.
    if (def.key === "GOOGLE_MAPS_API_KEY" && value.trim() === "") continue;
    try {
      validateSettingValue(def.key, value);
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  await repo.completeSetup(writes);
  const runtimeWrite = writes.find((w) => w.key === "INFERENCE_RUNTIME");
  await writeRuntimeMarker(runtimeWrite?.value ?? "windows");
  return { ok: true };
}

// A function passed to <form action={...}> must return void | Promise<void>
// (Next.js App Router constraint), so this wrapper cannot forward submitSetup's
// SubmitSetupResult. On failure we throw so the error surfaces instead of being
// silently swallowed. On success we redirect to "/" ourselves — the
// (protected)/layout.tsx gate only re-checks __setup_completed__ when a
// request actually lands on it, so without an explicit redirect() here the
// browser just sits on /setup with no error and no navigation.
export async function submitSetupAction(formData: FormData): Promise<void> {
  const result = await submitSetup(getSettingsRepo(), formData);
  if (!result.ok) {
    throw new Error(result.error);
  }
  redirect("/");
}