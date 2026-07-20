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
vi.mock("../../../../lib/model-catalog/classification-models", () => ({
  uninstallClassificationModel: vi.fn(),
  getClassificationModelHistory: vi.fn(),
}));
vi.mock("../../../../lib/db", () => ({ getPool: vi.fn(() => ({})) }));

vi.mock("../../../../lib/background-jobs", () => ({
  createJob: vi.fn().mockResolvedValue("job-1"),
  completeJob: vi.fn(),
  failJob: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

function makeRequest(body?: unknown) {
  return new Request("http://localhost/api/model-catalog/uninstall", { 
    method: "POST",
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
}

function makeGetRequest() {
  return new Request("http://localhost/api/model-catalog/uninstall", { method: "GET" });
}

describe("GET /api/model-catalog/uninstall", () => {
  it("reports unavailable when nothing has ever been installed", async () => {
    const { readUninstallMeta } = await import("../../../../lib/model-catalog/uninstall-state");
    (readUninstallMeta as any).mockResolvedValue({ currentVersion: null, previousVersion: null });

    const { GET } = await import("./route");
    const json = await (await GET(makeGetRequest())).json();
    expect(json).toEqual({ available: false, previousVersion: null });
  });

  it("reports the previous version when a backup is available", async () => {
    const { readUninstallMeta } = await import("../../../../lib/model-catalog/uninstall-state");
    (readUninstallMeta as any).mockResolvedValue({ currentVersion: "1.1", previousVersion: "1.0" });

    const { GET } = await import("./route");
    const json = await (await GET(makeGetRequest())).json();
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
});

describe("POST /api/model-catalog/uninstall — success path", () => {
  it("returns 202 with a jobId on an execution request", async () => {
    const { readUninstallMeta } = await import("../../../../lib/model-catalog/uninstall-state");
    (readUninstallMeta as any).mockResolvedValue({ currentVersion: "1.1", previousVersion: "1.0" });
    const { createJob } = await import("../../../../lib/background-jobs");

    const { POST } = await import("./route");
    const res = await POST(makeRequest());
    const json = await res.json();

    expect(res.status).toBe(202);
    expect(json).toEqual({ jobId: "job-1" });
    expect(createJob).toHaveBeenCalledWith(expect.anything(), "model-uninstall", "Model Snapshot/Classifier Rollback");
  });
});

describe("runModelUninstallJob — generic-classifier", () => {
  it("deactivates/reactivates via modelId and completes the job without restarting inference", async () => {
    const { runModelUninstallJob } = await import("./route");
    const { uninstallClassificationModel } = await import("../../../../lib/model-catalog/classification-models");
    const { completeJob } = await import("../../../../lib/background-jobs");
    
    (uninstallClassificationModel as any).mockResolvedValue({ restoredVersion: "0.9" });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const pool = {} as any;

    await runModelUninstallJob(pool, "job-1", { modelId: "wanda-v1", meta: { currentVersion: "1.0", previousVersion: "0.9" }, origin: "http://localhost" });

    expect(uninstallClassificationModel).toHaveBeenCalledWith(pool, "wanda-v1");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(completeJob).toHaveBeenCalledWith(pool, "job-1", { ok: true, version: "0.9" });
  });
});

describe("runModelUninstallJob — code-bundle", () => {
  it("restores the previous snapshot, restarts, rotates state, and completes the job", async () => {
    const { runModelUninstallJob } = await import("./route");
    const { writeUninstallMeta, clearPreviousBackup } = await import("../../../../lib/model-catalog/uninstall-state");
    const { restoreInferenceCode } = await import("../../../../lib/model-catalog/backup");
    const { completeJob } = await import("../../../../lib/background-jobs");

    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("restart-inference")) return { ok: true } as Response;
      if (url.includes("/docs")) return { ok: true } as Response;
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const pool = {} as any;

    await runModelUninstallJob(pool, "job-1", { modelId: undefined, meta: { currentVersion: "1.1", previousVersion: "1.0" }, origin: "http://localhost" });

    expect(restoreInferenceCode).toHaveBeenCalledWith(expect.stringContaining("inference"), "/fake/previous");
    expect(writeUninstallMeta).toHaveBeenCalledWith({ currentVersion: "1.0", previousVersion: null });
    expect(clearPreviousBackup).toHaveBeenCalled();
    expect(completeJob).toHaveBeenCalledWith(pool, "job-1", { ok: true, version: "1.0" });
  });

  it("fails the job and leaves state untouched when the restored service never becomes ready", async () => {
    const { runModelUninstallJob } = await import("./route");
    const { writeUninstallMeta, clearPreviousBackup } = await import("../../../../lib/model-catalog/uninstall-state");
    const { failJob } = await import("../../../../lib/background-jobs");

    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("restart-inference")) return { ok: true } as Response;
      if (url.includes("/docs")) return { ok: false } as Response;
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const pool = {} as any;

    await runModelUninstallJob(pool, "job-1", { modelId: undefined, meta: { currentVersion: "1.1", previousVersion: "1.0" }, origin: "http://localhost" });

    expect(writeUninstallMeta).not.toHaveBeenCalled();
    expect(clearPreviousBackup).not.toHaveBeenCalled();
    expect(failJob).toHaveBeenCalledWith(pool, "job-1", expect.stringContaining("Inference engine readiness check failed"));
  });
});

describe("GET /api/model-catalog/uninstall?modelId=...", () => {
  it("returns that model's own history instead of the global code-bundle one", async () => {
    const { getClassificationModelHistory } = await import("../../../../lib/model-catalog/classification-models");
    (getClassificationModelHistory as any).mockResolvedValue({ available: true, previousVersion: "0.9" });

    const { GET } = await import("./route");
    const res = await GET(new Request("http://localhost/api/model-catalog/uninstall?modelId=wanda-v1"));
    const json = await res.json();

    expect(json).toEqual({ available: true, previousVersion: "0.9" });
    expect(getClassificationModelHistory).toHaveBeenCalledWith(expect.anything(), "wanda-v1");
  });
});