// apps/worker/src/settings.ts
import { createSettingsRepo, type SettingsRepo } from "@netryx/settings-repo";
import { getPool } from "./db";

let singleton: SettingsRepo | undefined;

/**
 * Unlike apps/web/lib/settings-repo.ts, this has NO relative-path fallback.
 * The worker runs as a separate OS process from apps/web (possibly a
 * separate machine later); guessing a path relative to its own cwd would
 * silently create a SECOND encryption key and make every secret written by
 * the web app undecryptable here. Fail fast instead (spec §14.4/§14.5).
 */
export function getSettingsRepo(): SettingsRepo {
  if (!singleton) {
    const keyPath = process.env.SETTINGS_KEY_PATH;
    if (!keyPath) {
      throw new Error(
        "SETTINGS_KEY_PATH is required for apps/worker — it must point at the " +
          "same absolute path apps/web uses, so both processes decrypt the " +
          "same system_settings secrets (spec §14.4)."
      );
    }
    singleton = createSettingsRepo({ pool: getPool(), encryptionKeyPath: keyPath });
  }
  return singleton;
}