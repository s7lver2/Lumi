// apps/web/app/api/model-catalog/uninstall/route.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

process.env.MODEL_CATALOG_READY_TIMEOUT_MS = "20";
process.env.MODEL_CATALOG_READY_POLL_INTERVAL_MS = "5";

vi.mock("../../../../lib/model-catalog/backup", () => ({ restoreInferenceCode: vi.fn() }));
vi.mock("../../../../lib/model-catalog/uninstall-state", () => ({
  PREVIOUS_CODE_DIR: "/fake/previous",
  readUninstallMeta: vi.fn(),
  writeUninstallMeta: vi.fn(),
  clearPreviousBackup: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

function makeRequest() {
  return new Request("http://localhost/api/model-catalog/uninstall", { method: "POST" });
}

describe("GET /api/model-catalog/uninstall", () => {
  it("reports unavailable when nothing has ever been installed", async () => {
    const { readUninstallMeta } = await import("../../../../lib/model-catalog/uninstall-state");
    (readUninstallMeta as any).mockResolvedValue({ currentVersion: null, previousVersion: null });

    const { GET } = await import("./route");
    const json = await (await GET()).json();
    expect(json).toEqual({ available: false, previousVersion: null });
  });

  it("reports the previous version when a backup is available", async () => {
    const { readUninstallMeta } = await import("../../../../lib/model-catalog/uninstall-state");
    (readUninstallMeta as any).mockResolvedValue({ currentVersion: "1.1", previousVersion: "1.0" });

    const { GET } = await import("./route");
    const json = await (await GET()).json();
    expect(json).toEqual({ available: true, previousVersion: "1.0" });
  });
});

describe("POST /api/model-catalog/uninstall", () => {
  it("400s when nothing is currently installed", async () => {
    const { readUninstallMeta } = await import("../../../../lib/model-catalog/uninstall-state");
    (readUninstallMeta as any).mockResolvedValue({ currentVersion: null, previousVersion: null });

    const { POST } = await import("./route");
    const res = await POST(makeRequest());
    expect(res.status).toBe(400);
  });

  it("restores the previous snapshot, restarts, and rotates state on success", async () => {
    const { readUninstallMeta, writeUninstallMeta, clearPreviousBackup } = await import(
      "../../../../lib/model-catalog/uninstall-state"
    );
    const { restoreInferenceCode } = await import("../../../../lib/model-catalog/backup");
    (readUninstallMeta as any).mockResolvedValue({ currentVersion: "1.1", previousVersion: "1.0" });

    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("restart-inference")) return { ok: true } as Response;
      if (url.includes("/docs")) return { ok: true } as Response;
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { POST } = await import("./route");
    const res = await POST(makeRequest());
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ ok: true, version: "1.0" });
    expect(restoreInferenceCode).toHaveBeenCalledWith(expect.stringContaining("inference"), "/fake/previous");
    expect(writeUninstallMeta).toHaveBeenCalledWith({ currentVersion: "1.0", previousVersion: null });
    expect(clearPreviousBackup).toHaveBeenCalled();
  });

  it("502s and leaves state untouched when the restored service never becomes ready", async () => {
    const { readUninstallMeta, writeUninstallMeta, clearPreviousBackup } = await import(
      "../../../../lib/model-catalog/uninstall-state"
    );
    (readUninstallMeta as any).mockResolvedValue({ currentVersion: "1.1", previousVersion: "1.0" });

    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("restart-inference")) return { ok: true } as Response;
      if (url.includes("/docs")) return { ok: false } as Response;
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { POST } = await import("./route");
    const res = await POST(makeRequest());

    expect(res.status).toBe(502);
    expect(writeUninstallMeta).not.toHaveBeenCalled();
    expect(clearPreviousBackup).not.toHaveBeenCalled();
  });
});
