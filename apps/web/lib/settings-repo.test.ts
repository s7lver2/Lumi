// apps/web/lib/settings-repo.test.ts
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { Pool } from "pg";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSettingsRepo } from "@netryx/settings-repo";

const connectionString =
  process.env.TEST_DATABASE_URL ??
  "postgres://netryx:changeme@localhost:5432/netryx_test";
const pool = new Pool({ connectionString });

let dir: string;
let keyPath: string;

beforeEach(async () => {
  await pool.query("DELETE FROM system_settings");
  dir = mkdtempSync(join(tmpdir(), "netryx-settings-repo-test-"));
  keyPath = join(dir, "settings.key");
});

afterAll(async () => {
  await pool.end();
});

function makeRepo() {
  return createSettingsRepo({ pool, encryptionKeyPath: keyPath, cacheTtlMs: 0 });
}

describe("settings repo", () => {
  it("starts with setup not completed", async () => {
    const repo = makeRepo();
    expect(await repo.isSetupCompleted()).toBe(false);
  });

  it("stores and retrieves a non-secret value in plaintext", async () => {
    const repo = makeRepo();
    await repo.setSetting("MAX_AREA_KM2", "5", false);
    expect(await repo.getSetting("MAX_AREA_KM2")).toBe("5");

    const { rows } = await pool.query(
      "SELECT value, encrypted_value FROM system_settings WHERE key = 'MAX_AREA_KM2'"
    );
    expect(rows[0].value).toBe("5");
    expect(rows[0].encrypted_value).toBeNull();
  });

  it("stores a secret value encrypted, never in the plaintext column", async () => {
    const repo = makeRepo();
    await repo.setSetting("GOOGLE_MAPS_API_KEY", "AIzaSyTest", true);

    const { rows } = await pool.query(
      "SELECT value, encrypted_value FROM system_settings WHERE key = 'GOOGLE_MAPS_API_KEY'"
    );
    expect(rows[0].value).toBeNull();
    expect(rows[0].encrypted_value).not.toBeNull();

    expect(await repo.getSetting("GOOGLE_MAPS_API_KEY")).toBe("AIzaSyTest");
  });

  it("completeSetup writes all values in a single transaction and flips the flag", async () => {
    const repo = makeRepo();
    await repo.completeSetup([
      { key: "GOOGLE_MAPS_API_KEY", value: "AIzaSyTest", isSecret: true },
      { key: "MAX_AREA_KM2", value: "5", isSecret: false },
    ]);

    expect(await repo.isSetupCompleted()).toBe(true);
    expect(await repo.getSetting("GOOGLE_MAPS_API_KEY")).toBe("AIzaSyTest");
    expect(await repo.getSetting("MAX_AREA_KM2")).toBe("5");
  });

  it("caches getSetting for cacheTtlMs and invalidates on write", async () => {
    const repo = createSettingsRepo({
      pool,
      encryptionKeyPath: keyPath,
      cacheTtlMs: 60_000,
    });
    await repo.setSetting("MAX_CONCURRENT_REQUESTS", "10", false);
    expect(await repo.getSetting("MAX_CONCURRENT_REQUESTS")).toBe("10");

    // mutate the DB directly, bypassing the repo, to prove the cache is serving stale data
    await pool.query(
      "UPDATE system_settings SET value = '999' WHERE key = 'MAX_CONCURRENT_REQUESTS'"
    );
    expect(await repo.getSetting("MAX_CONCURRENT_REQUESTS")).toBe("10");

    // writing through the repo must invalidate the cache
    await repo.setSetting("MAX_CONCURRENT_REQUESTS", "20", false);
    expect(await repo.getSetting("MAX_CONCURRENT_REQUESTS")).toBe("20");
  });

  it("returns null for a setting that was never set", async () => {
    const repo = makeRepo();
    expect(await repo.getSetting("MAPBOX_TOKEN")).toBeNull();
  });

  it("clearCache drops every cached value, including keys never written through the repo", async () => {
    const repo = createSettingsRepo({
      pool,
      encryptionKeyPath: keyPath,
      cacheTtlMs: 60_000,
    });
    await repo.completeSetup([{ key: "MAX_AREA_KM2", value: "5", isSecret: false }]);
    expect(await repo.isSetupCompleted()).toBe(true);

    // mutate the DB directly (mirroring a raw TRUNCATE), bypassing the repo
    await pool.query("DELETE FROM system_settings");
    expect(await repo.isSetupCompleted()).toBe(true); // still cached

    repo.clearCache();
    expect(await repo.isSetupCompleted()).toBe(false);
  });
});