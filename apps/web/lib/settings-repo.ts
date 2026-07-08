// apps/web/lib/settings-repo.ts
import { getPool } from "./db";
import {
  createSettingsRepo,
  type SettingsRepo,
} from "@netryx/settings-repo";

export type { SettingsRepo, SettingWrite } from "@netryx/settings-repo";

let singleton: SettingsRepo | undefined;

/**
 * SETTINGS_KEY_PATH must be an absolute path shared with apps/worker — both
 * processes encrypt/decrypt the same system_settings rows and MUST agree on
 * the physical key file (spec §14.4). Falls back to a repo-relative default
 * only for the web app's own convenience; the worker has no such fallback
 * (see apps/worker/src/settings.ts, Task 5) because guessing a relative path
 * across two different process cwds is exactly the kind of bug that stays
 * invisible until someone rotates a key.
 */
function resolveKeyPath(): string {
  return process.env.SETTINGS_KEY_PATH ?? `${process.cwd()}/data/settings.key`;
}

export function getSettingsRepo(): SettingsRepo {
  if (!singleton) {
    singleton = createSettingsRepo({
      pool: getPool(),
      encryptionKeyPath: resolveKeyPath(),
    });
  }
  return singleton;
}