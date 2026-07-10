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
 * which the wizard doesn't render per spec §14.2's four steps — fall back to
 * the setting's defaultValue so setup can still complete (spec §15.3's
 * "lumi-preview"/"laila" defaults).
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
    try {
      validateSettingValue(def.key, resolveValue(formData, def));
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