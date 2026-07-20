// apps/web/app/api/settings/reset/route.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

process.env.MODEL_CATALOG_READY_TIMEOUT_MS = "20";
process.env.MODEL_CATALOG_READY_POLL_INTERVAL_MS = "5";

vi.mock("../../../../lib/db", () => ({ getPool: vi.fn() }));
vi.mock("../../../../lib/settings/db-backup", () => ({
  backupDatabaseToJson: vi.fn().mockResolvedValue("/fake/backup.json"),
  APPLICATION_TABLES: ["areas", "system_settings"],
}));
vi.mock("../../../../lib/model-catalog/backup", () => ({ restoreInferenceCode: vi.fn() }));
vi.mock("../../../../lib/model-catalog/uninstall-state", () => ({
  PREVIOUS_CODE_DIR: "/fake/previous",
  readUninstallMeta: vi.fn(),
  writeUninstallMeta: vi.fn(),
  clearPreviousBackup: vi.fn(),
}));
vi.mock("../../../../lib/settings-repo", () => ({ getSettingsRepo: vi.fn() }));

let poolQuery: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  vi.clearAllMocks();
  poolQuery = vi.fn().mockResolvedValue({ rows: [] });
  const { getPool } = await import("../../../../lib/db");
  (getPool as any).mockReturnValue({ query: poolQuery });
  const { backupDatabaseToJson } = await import("../../../../lib/settings/db-backup");
  (backupDatabaseToJson as any).mockResolvedValue("/fake/backup.json");
});

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/settings/reset", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/settings/reset", () => {
  it("400s when confirm doesn't match exactly", async () => {
    const { POST } = await import("./route");
    const res = await POST(makeRequest({ confirm: "reset" }));
    expect(res.status).toBe(400);
  });

  it("400s when confirm is missing", async () => {
    const { POST } = await import("./route");
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
  });

  it("500s and touches nothing else when the backup fails", async () => {
    const { backupDatabaseToJson } = await import("../../../../lib/settings/db-backup");
    (backupDatabaseToJson as any).mockRejectedValue(new Error("disk full"));
    const { restoreInferenceCode } = await import("../../../../lib/model-catalog/backup");

    const { POST } = await import("./route");
    const res = await POST(makeRequest({ confirm: "RESET" }));
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.error).toContain("disk full");
    expect(restoreInferenceCode).not.toHaveBeenCalled();
    expect(poolQuery).not.toHaveBeenCalled();
  });

  it("truncates the application tables and resets settings, skipping code restore when nothing was ever installed", async () => {
    const { readUninstallMeta } = await import("../../../../lib/model-catalog/uninstall-state");
    (readUninstallMeta as any).mockResolvedValue({ currentVersion: null, previousVersion: null });

    const setSetting = vi.fn();
    const { getSettingsRepo } = await import("../../../../lib/settings-repo");
    (getSettingsRepo as any).mockReturnValue({ setSetting, clearCache: vi.fn() });

    const { restoreInferenceCode } = await import("../../../../lib/model-catalog/backup");
    const { backupDatabaseToJson } = await import("../../../../lib/settings/db-backup");

    const { POST } = await import("./route");
    const res = await POST(makeRequest({ confirm: "RESET" }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ ok: true });
    expect(backupDatabaseToJson).toHaveBeenCalledWith(expect.anything());
    expect(restoreInferenceCode).not.toHaveBeenCalled();
    expect(poolQuery).toHaveBeenCalledWith(expect.stringContaining("TRUNCATE TABLE areas, system_settings"));
    expect(setSetting).toHaveBeenCalledWith("RETRIEVAL_MODEL", "lumi-preview", false);
    expect(setSetting).toHaveBeenCalledWith("VERIFICATION_MODEL", "", false);
  });

  it("clears the settings repo's cache after truncating", async () => {
    // Regression test: the TRUNCATE bypasses the settings repo entirely
    // (raw pool.query), so its in-memory cache keeps serving pre-reset
    // values — most visibly isSetupCompleted() staying true and the app
    // never redirecting to /setup right after a real reset.
    const { readUninstallMeta } = await import("../../../../lib/model-catalog/uninstall-state");
    (readUninstallMeta as any).mockResolvedValue({ currentVersion: null, previousVersion: null });

    const clearCache = vi.fn();
    const { getSettingsRepo } = await import("../../../../lib/settings-repo");
    (getSettingsRepo as any).mockReturnValue({ setSetting: vi.fn(), clearCache });

    const { POST } = await import("./route");
    const res = await POST(makeRequest({ confirm: "RESET" }));

    expect(res.status).toBe(200);
    expect(clearCache).toHaveBeenCalled();
  });

  it("reseeds worker_heartbeat's singleton row after truncating", async () => {
    // Regression test: worker_heartbeat's row 1 is seeded once by its
    // migration and never re-created afterward (the worker only ever
    // UPDATEs it, no upsert fallback) — confirmed live that truncating it
    // without reseeding leaves the worker permanently reported as stopped.
    const { readUninstallMeta } = await import("../../../../lib/model-catalog/uninstall-state");
    (readUninstallMeta as any).mockResolvedValue({ currentVersion: null, previousVersion: null });

    const { getSettingsRepo } = await import("../../../../lib/settings-repo");
    (getSettingsRepo as any).mockReturnValue({ setSetting: vi.fn(), clearCache: vi.fn() });

    const { POST } = await import("./route");
    const res = await POST(makeRequest({ confirm: "RESET" }));

    expect(res.status).toBe(200);
    expect(poolQuery).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO worker_heartbeat (id, updated_at) VALUES (1, now())"));

    // Must run after the truncate, not before (a before-truncate insert
    // would just get wiped out).
    const truncateIndex = poolQuery.mock.calls.findIndex((c) => String(c[0]).includes("TRUNCATE TABLE"));
    const reseedIndex = poolQuery.mock.calls.findIndex((c) => String(c[0]).includes("INSERT INTO worker_heartbeat"));
    expect(truncateIndex).toBeGreaterThanOrEqual(0);
    expect(reseedIndex).toBeGreaterThan(truncateIndex);
  });

  it("restores code and restarts inference when a backup exists", async () => {
    const { readUninstallMeta, writeUninstallMeta, clearPreviousBackup } = await import(
      "../../../../lib/model-catalog/uninstall-state"
    );
    (readUninstallMeta as any).mockResolvedValue({ currentVersion: "1.0", previousVersion: null });

    const { getSettingsRepo } = await import("../../../../lib/settings-repo");
    (getSettingsRepo as any).mockReturnValue({ setSetting: vi.fn(), clearCache: vi.fn() });

    const { restoreInferenceCode } = await import("../../../../lib/model-catalog/backup");

    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes("restart-inference")) return { ok: true } as Response;
      if (String(url).includes("/docs")) return { ok: true } as Response;
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { POST } = await import("./route");
    const res = await POST(makeRequest({ confirm: "RESET" }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ ok: true });
    expect(restoreInferenceCode).toHaveBeenCalledWith(expect.stringContaining("inference"), "/fake/previous");
    expect(writeUninstallMeta).toHaveBeenCalledWith({ currentVersion: null, previousVersion: null });
    expect(clearPreviousBackup).toHaveBeenCalled();

    vi.unstubAllGlobals();
  });

  it("502s with a clear message when the restart never becomes healthy", async () => {
    const { readUninstallMeta } = await import("../../../../lib/model-catalog/uninstall-state");
    (readUninstallMeta as any).mockResolvedValue({ currentVersion: "1.0", previousVersion: null });

    const { getSettingsRepo } = await import("../../../../lib/settings-repo");
    (getSettingsRepo as any).mockReturnValue({ setSetting: vi.fn(), clearCache: vi.fn() });

    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes("restart-inference")) return { ok: true } as Response;
      if (String(url).includes("/docs")) return { ok: false } as Response;
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { POST } = await import("./route");
    const res = await POST(makeRequest({ confirm: "RESET" }));

    expect(res.status).toBe(502);
    const json = await res.json();
    expect(json.error).toContain("no volvió a estar disponible");

    vi.unstubAllGlobals();
  });

  it("502s with a clear message when restoreInferenceCode throws", async () => {
    const { readUninstallMeta } = await import("../../../../lib/model-catalog/uninstall-state");
    (readUninstallMeta as any).mockResolvedValue({ currentVersion: "1.0", previousVersion: null });

    const { getSettingsRepo } = await import("../../../../lib/settings-repo");
    (getSettingsRepo as any).mockReturnValue({ setSetting: vi.fn(), clearCache: vi.fn() });

    const { restoreInferenceCode } = await import("../../../../lib/model-catalog/backup");
    (restoreInferenceCode as any).mockRejectedValue(new Error("backup dir missing"));

    const { POST } = await import("./route");
    const res = await POST(makeRequest({ confirm: "RESET" }));

    expect(res.status).toBe(502);
    const json = await res.json();
    expect(json.error).toContain("No se pudieron restaurar los archivos originales");
    expect(json.error).toContain("backup dir missing");
  });

  it("never truncates or resets settings when the risky restore step fails", async () => {
    const { readUninstallMeta } = await import("../../../../lib/model-catalog/uninstall-state");
    (readUninstallMeta as any).mockResolvedValue({ currentVersion: "1.0", previousVersion: null });

    const setSetting = vi.fn();
    const { getSettingsRepo } = await import("../../../../lib/settings-repo");
    (getSettingsRepo as any).mockReturnValue({ setSetting, clearCache: vi.fn() });

    const { restoreInferenceCode } = await import("../../../../lib/model-catalog/backup");
    (restoreInferenceCode as any).mockRejectedValue(new Error("backup dir missing"));

    const { POST } = await import("./route");
    const res = await POST(makeRequest({ confirm: "RESET" }));

    expect(res.status).toBe(502);
    expect(poolQuery).not.toHaveBeenCalled();
    expect(setSetting).not.toHaveBeenCalled();
  });

  it("never truncates or resets settings when the restart never becomes healthy", async () => {
    const { readUninstallMeta } = await import("../../../../lib/model-catalog/uninstall-state");
    (readUninstallMeta as any).mockResolvedValue({ currentVersion: "1.0", previousVersion: null });

    const setSetting = vi.fn();
    const { getSettingsRepo } = await import("../../../../lib/settings-repo");
    (getSettingsRepo as any).mockReturnValue({ setSetting, clearCache: vi.fn() });

    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes("restart-inference")) return { ok: true } as Response;
      if (String(url).includes("/docs")) return { ok: false } as Response;
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { POST } = await import("./route");
    const res = await POST(makeRequest({ confirm: "RESET" }));

    expect(res.status).toBe(502);
    expect(poolQuery).not.toHaveBeenCalled();
    expect(setSetting).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });
});
