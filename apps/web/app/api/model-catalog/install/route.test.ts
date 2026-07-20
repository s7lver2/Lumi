// apps/web/app/api/model-catalog/install/route.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import JSZip from "jszip";

// Shrink the real readiness-poll timeout/interval so tests that never
// become "ready" don't take 60 real seconds — must be set before route.ts
// is first imported, since it reads these into module-level constants.
process.env.MODEL_CATALOG_READY_TIMEOUT_MS = "20";
process.env.MODEL_CATALOG_READY_POLL_INTERVAL_MS = "5";

vi.mock("../../../../lib/model-catalog/github", () => ({ listReleasesForRepo: vi.fn(), downloadReleaseAsset: vi.fn() }));
vi.mock("../../../../lib/model-catalog/backup", () => ({ backupInferenceCode: vi.fn(), restoreInferenceCode: vi.fn(), persistBackup: vi.fn() }));
vi.mock("../../../../lib/model-catalog/uninstall-state", () => ({
  PREVIOUS_CODE_DIR: "/fake/previous",
  readUninstallMeta: vi.fn().mockResolvedValue({ currentVersion: null, previousVersion: null }),
  writeUninstallMeta: vi.fn(),
}));
vi.mock("../../../../lib/settings-repo", () => ({ getSettingsRepo: vi.fn(() => ({ setSetting: vi.fn() })) }));
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    rm: vi.fn(),
    mkdtemp: vi.fn().mockResolvedValue("/tmp/staging"),
    mkdir: vi.fn(),
    writeFile: vi.fn(),
    copyFile: vi.fn(),
    readdir: vi.fn().mockResolvedValue([]),
  };
});
vi.mock("../../../../lib/model-catalog/classification-models", () => ({ installClassificationModel: vi.fn() }));
vi.mock("../../../../lib/db", () => ({ getPool: vi.fn(() => ({})) }));

vi.mock("../../../../lib/background-jobs", () => ({
  createJob: vi.fn().mockResolvedValue("job-1"),
  completeJob: vi.fn(),
  failJob: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
});

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/model-catalog/install", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function mockRelease() {
  const { listReleasesForRepo, downloadReleaseAsset } = await import("../../../../lib/model-catalog/github");
  const { encryptBuffer } = await import("@netryx/settings-repo");
  const { MODEL_CATALOG_SHARED_KEY } = await import("../../../../lib/model-catalog/shared-key");

  const manifest = {
    kind: "code-bundle", bundleId: "lumi-preview", version: "1.1",
    backbones: [], description: "",
    benchmark: { accuracyWithin50m: 0.9, avgDistanceM: 5, sampleCount: 20, ranAt: "x" },
    verificationModelId: "roma-verify",
  };
  const zip = new JSZip();
  zip.file("main.py", "print('v1.1')");
  zip.file("requirements.txt", "torch==2.0.0");
  const zipBytes = await zip.generateAsync({ type: "nodebuffer" });

  (listReleasesForRepo as any).mockResolvedValue([
    { tagName: "lumi-preview-v1.1", name: "x", body: "", assets: [
      { name: "metadata.json.enc", url: "meta-url" },
      { name: "code.zip.enc", url: "code-url" },
    ] },
  ]);
  (downloadReleaseAsset as any).mockImplementation(async (url: string) => {
    if (url === "meta-url") return encryptBuffer(Buffer.from(JSON.stringify(manifest)), MODEL_CATALOG_SHARED_KEY);
    if (url === "code-url") return encryptBuffer(zipBytes, MODEL_CATALOG_SHARED_KEY);
    throw new Error(`unexpected asset url: ${url}`);
  });
}

describe("POST /api/model-catalog/install", () => {
  it("404s when the release/tag isn't found", async () => {
    const { listReleasesForRepo } = await import("../../../../lib/model-catalog/github");
    (listReleasesForRepo as any).mockResolvedValue([]);

    const { POST } = await import("./route");
    const res = await POST(makeRequest({ owner: "inigo", repo: "lumi-model-catalog", tag: "missing" }));
    expect(res.status).toBe(404);
  });

  it("400s when the release is missing expected assets", async () => {
    const { listReleasesForRepo } = await import("../../../../lib/model-catalog/github");
    (listReleasesForRepo as any).mockResolvedValue([{ tagName: "lumi-preview-v1.1", name: "x", body: "", assets: [] }]);

    const { POST } = await import("./route");
    const res = await POST(makeRequest({ owner: "inigo", repo: "lumi-model-catalog", tag: "lumi-preview-v1.1" }));
    expect(res.status).toBe(400);
  });
});

describe("POST /api/model-catalog/install — success path", () => {
  it("returns 202 with a jobId for a code-bundle release", async () => {
    await mockRelease();
    const { createJob } = await import("../../../../lib/background-jobs");

    const { POST } = await import("./route");
    const res = await POST(makeRequest({ owner: "inigo", repo: "lumi-model-catalog", tag: "lumi-preview-v1.1" }));
    const json = await res.json();

    expect(res.status).toBe(202);
    expect(json).toEqual({ jobId: "job-1" });
    expect(createJob).toHaveBeenCalledWith(expect.anything(), "model-install", "Lumi Preview v1.1");
  });

  it("returns 202 with a jobId for a generic-classifier release", async () => {
    const { listReleasesForRepo, downloadReleaseAsset } = await import("../../../../lib/model-catalog/github");
    const { encryptBuffer } = await import("@netryx/settings-repo");
    const { MODEL_CATALOG_SHARED_KEY } = await import("../../../../lib/model-catalog/shared-key");
    const manifest = {
      kind: "generic-classifier", modelId: "wanda-v1", version: "1.0",
      facets: [{ facet: "weather", hfModelId: "prithivMLmods/Weather-Image-Classification", strategy: "pipeline" }],
      benchmark: { sampleCount: 0, ranAt: "x", vramEstimateBytes: null }, description: "",
    };
    (listReleasesForRepo as any).mockResolvedValue([
      { tagName: "wanda-v1", name: "x", body: "", assets: [{ name: "metadata.json.enc", url: "meta-url" }] },
    ]);
    (downloadReleaseAsset as any).mockImplementation(async (url: string) => {
      if (url === "meta-url") return encryptBuffer(Buffer.from(JSON.stringify(manifest)), MODEL_CATALOG_SHARED_KEY);
      throw new Error(`unexpected asset url: ${url}`);
    });

    const { POST } = await import("./route");
    const res = await POST(makeRequest({ owner: "inigo", repo: "lumi-model-catalog", tag: "wanda-v1" }));
    const json = await res.json();

    expect(res.status).toBe(202);
    expect(json).toEqual({ jobId: "job-1" });
  });
});

describe("runModelInstallJob — generic-classifier", () => {
  it("installs and completes the job", async () => {
    const { runModelInstallJob } = await import("./run-job");
    const { installClassificationModel } = await import("../../../../lib/model-catalog/classification-models");
    const { completeJob } = await import("../../../../lib/background-jobs");
    const manifest = {
      kind: "generic-classifier" as const, modelId: "wanda-v1", version: "1.0",
      facets: [], benchmark: { sampleCount: 0, ranAt: "x", vramEstimateBytes: null }, description: "",
    };
    const pool = {} as any;

    await runModelInstallJob(pool, "job-1", { manifest, codeAssetUrl: undefined, origin: "http://localhost" });

    expect(installClassificationModel).toHaveBeenCalledWith(pool, manifest);
    expect(completeJob).toHaveBeenCalledWith(pool, "job-1", { ok: true, modelId: "wanda-v1", version: "1.0" });
  });
});

describe("runModelInstallJob — code-bundle", () => {
  it("backs up, swaps, restarts, confirms readiness, and completes the job", async () => {
    const { runModelInstallJob } = await import("./run-job");
    const { backupInferenceCode, restoreInferenceCode } = await import("../../../../lib/model-catalog/backup");
    (backupInferenceCode as any).mockResolvedValue("/tmp/backup-1");
    const { downloadReleaseAsset } = await import("../../../../lib/model-catalog/github");
    const { encryptBuffer } = await import("@netryx/settings-repo");
    const { MODEL_CATALOG_SHARED_KEY } = await import("../../../../lib/model-catalog/shared-key");
    const { completeJob } = await import("../../../../lib/background-jobs");

    const zip = new JSZip();
    zip.file("main.py", "print('v1.1')");
    const zipBytes = await zip.generateAsync({ type: "nodebuffer" });
    (downloadReleaseAsset as any).mockResolvedValue(encryptBuffer(zipBytes, MODEL_CATALOG_SHARED_KEY));

    const fsPromises = await import("node:fs/promises");
    (fsPromises.readdir as any).mockResolvedValue([{ name: "main.py", isDirectory: () => false }]);

    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("restart-inference")) return { ok: true } as Response;
      if (url.includes("/docs")) return { ok: true } as Response;
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const manifest = {
      kind: "code-bundle" as const, bundleId: "lumi-preview", version: "1.1", backbones: [], description: "",
      benchmark: { accuracyWithin50m: 0.9, avgDistanceM: 5, sampleCount: 20, ranAt: "x" },
      verificationModelId: "roma-verify",
    };
    const pool = {} as any;

    await runModelInstallJob(pool, "job-1", { manifest, codeAssetUrl: "code-url", origin: "http://localhost" });

    expect(backupInferenceCode).toHaveBeenCalledWith(expect.stringContaining("inference"));
    expect(restoreInferenceCode).not.toHaveBeenCalled();
    expect(completeJob).toHaveBeenCalledWith(pool, "job-1", { ok: true, version: "1.1" });
  });

  it("restores the backup and fails the job when the new version never becomes ready", async () => {
    const { runModelInstallJob } = await import("./run-job");
    const { backupInferenceCode, restoreInferenceCode } = await import("../../../../lib/model-catalog/backup");
    (backupInferenceCode as any).mockResolvedValue("/tmp/backup-1");
    const { downloadReleaseAsset } = await import("../../../../lib/model-catalog/github");
    const { encryptBuffer } = await import("@netryx/settings-repo");
    const { MODEL_CATALOG_SHARED_KEY } = await import("../../../../lib/model-catalog/shared-key");
    const { failJob } = await import("../../../../lib/background-jobs");

    const zip = new JSZip();
    zip.file("main.py", "print('v1.1')");
    const zipBytes = await zip.generateAsync({ type: "nodebuffer" });
    (downloadReleaseAsset as any).mockResolvedValue(encryptBuffer(zipBytes, MODEL_CATALOG_SHARED_KEY));

    const fsPromises = await import("node:fs/promises");
    (fsPromises.readdir as any).mockResolvedValue([{ name: "main.py", isDirectory: () => false }]);

    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("restart-inference")) return { ok: true } as Response;
      if (url.includes("/docs")) return { ok: false } as Response;
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const manifest = {
      kind: "code-bundle" as const, bundleId: "lumi-preview", version: "1.1", backbones: [], description: "",
      benchmark: { accuracyWithin50m: 0.9, avgDistanceM: 5, sampleCount: 20, ranAt: "x" },
    };
    const pool = {} as any;

    await runModelInstallJob(pool, "job-1", { manifest, codeAssetUrl: "code-url", origin: "http://localhost" });

    expect(restoreInferenceCode).toHaveBeenCalledWith(expect.stringContaining("inference"), "/tmp/backup-1");
    expect(failJob).toHaveBeenCalledWith(pool, "job-1", expect.stringContaining("se restauró la versión anterior"));
  });
});