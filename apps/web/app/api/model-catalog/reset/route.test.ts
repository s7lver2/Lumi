// apps/web/app/api/model-catalog/reset/route.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

process.env.MODEL_CATALOG_READY_TIMEOUT_MS = "20";
process.env.MODEL_CATALOG_READY_POLL_INTERVAL_MS = "5";

vi.mock("../../../../lib/db", () => ({ getPool: vi.fn(() => ({})) }));
vi.mock("../../../../lib/model-catalog/classification-models", () => ({ deleteAllClassificationModels: vi.fn() }));
vi.mock("../../../../lib/model-catalog/backup", () => ({ restoreInferenceCode: vi.fn() }));
vi.mock("../../../../lib/model-catalog/uninstall-state", () => ({
  PREVIOUS_CODE_DIR: "/fake/previous",
  readUninstallMeta: vi.fn(),
  writeUninstallMeta: vi.fn(),
  clearPreviousBackup: vi.fn(),
}));
vi.mock("../../../../lib/settings-repo", () => ({ getSettingsRepo: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
});

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/model-catalog/reset", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/model-catalog/reset", () => {
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

  it("deletes classifier rows and resets settings, skipping code restore when nothing was ever installed", async () => {
    const { readUninstallMeta } = await import("../../../../lib/model-catalog/uninstall-state");
    (readUninstallMeta as any).mockResolvedValue({ currentVersion: null, previousVersion: null });

    const setSetting = vi.fn();
    const { getSettingsRepo } = await import("../../../../lib/settings-repo");
    (getSettingsRepo as any).mockReturnValue({ setSetting });

    const { deleteAllClassificationModels } = await import("../../../../lib/model-catalog/classification-models");
    const { restoreInferenceCode } = await import("../../../../lib/model-catalog/backup");

    const { POST } = await import("./route");
    const res = await POST(makeRequest({ confirm: "RESET" }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ ok: true });
    expect(deleteAllClassificationModels).toHaveBeenCalledWith(expect.anything());
    expect(restoreInferenceCode).not.toHaveBeenCalled();
    expect(setSetting).toHaveBeenCalledWith("RETRIEVAL_MODEL", "lumi-preview", false);
    expect(setSetting).toHaveBeenCalledWith("VERIFICATION_MODEL", "", false);
  });

  it("restores code and restarts inference when a backup exists", async () => {
    const { readUninstallMeta, writeUninstallMeta, clearPreviousBackup } = await import(
      "../../../../lib/model-catalog/uninstall-state"
    );
    (readUninstallMeta as any).mockResolvedValue({ currentVersion: "1.0", previousVersion: null });

    const { getSettingsRepo } = await import("../../../../lib/settings-repo");
    (getSettingsRepo as any).mockReturnValue({ setSetting: vi.fn() });

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
    (getSettingsRepo as any).mockReturnValue({ setSetting: vi.fn() });

    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes("restart-inference")) return { ok: true } as Response;
      if (String(url).includes("/docs")) return { ok: false } as Response; // never healthy
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
});
