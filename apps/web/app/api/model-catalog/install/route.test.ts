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

  async function mockRelease() {
    const { listReleasesForRepo, downloadReleaseAsset } = await import("../../../../lib/model-catalog/github");
    const { encryptBuffer } = await import("@netryx/settings-repo");
    const { MODEL_CATALOG_SHARED_KEY } = await import("../../../../lib/model-catalog/shared-key");

    const manifest = {
      bundleId: "lumi-preview", version: "1.1",
      backbones: [], description: "",
      benchmark: { accuracyWithin50m: 0.9, avgDistanceM: 5, sampleCount: 20, ranAt: "x" },
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

  it("backs up, swaps, restarts, and confirms readiness on a successful install", async () => {
    await mockRelease();
    const { backupInferenceCode, restoreInferenceCode } = await import("../../../../lib/model-catalog/backup");
    (backupInferenceCode as any).mockResolvedValue("/tmp/backup-1");

    const fsPromises = await import("node:fs/promises");
    (fsPromises.readdir as any).mockResolvedValue([{ name: "main.py", isDirectory: () => false }]);

    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("restart-inference")) return { ok: true } as Response;
      if (url.includes("/docs")) return { ok: true } as Response;
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { POST } = await import("./route");
    const res = await POST(makeRequest({ owner: "inigo", repo: "lumi-model-catalog", tag: "lumi-preview-v1.1" }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ ok: true, version: "1.1" });
    expect(backupInferenceCode).toHaveBeenCalledWith(expect.stringContaining("inference"));
    expect(fsPromises.copyFile).toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/api/setup/run/restart-inference"), expect.objectContaining({ method: "POST" }));
    expect(restoreInferenceCode).not.toHaveBeenCalled();
    // Both the staging dir and the backup dir must be cleaned up — a leaked
    // backup dir was a real bug this test guards against.
    expect(fsPromises.rm).toHaveBeenCalledWith("/tmp/staging", expect.anything());
    expect(fsPromises.rm).toHaveBeenCalledWith("/tmp/backup-1", expect.anything());
  });

  it("restores the backup, restarts again, and reports the outcome when the new version never becomes ready", async () => {
    await mockRelease();
    const { backupInferenceCode, restoreInferenceCode } = await import("../../../../lib/model-catalog/backup");
    (backupInferenceCode as any).mockResolvedValue("/tmp/backup-1");
    (restoreInferenceCode as any).mockResolvedValue(undefined);

    const fsPromises = await import("node:fs/promises");
    (fsPromises.readdir as any).mockResolvedValue([{ name: "main.py", isDirectory: () => false }]);

    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("restart-inference")) return { ok: true } as Response;
      if (url.includes("/docs")) return { ok: false } as Response; // never comes back healthy
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { POST } = await import("./route");
    const res = await POST(makeRequest({ owner: "inigo", repo: "lumi-model-catalog", tag: "lumi-preview-v1.1" }));
    const json = await res.json();

    expect(res.status).toBe(502);
    expect(json.ok).toBe(false);
    expect(json.restoredVersion).toBe(true);
    expect(json.restoredHealthy).toBe(false); // /docs never returns ok, even after the restore restart
    expect(restoreInferenceCode).toHaveBeenCalledWith(expect.stringContaining("inference"), "/tmp/backup-1");
    const restartCalls = fetchMock.mock.calls.filter(([url]) => String(url).includes("restart-inference"));
    expect(restartCalls.length).toBe(2); // once for the new version, once for the restore
  });

  it("restores the backup and 400s when the file swap itself throws mid-copy", async () => {
    await mockRelease();
    const { backupInferenceCode, restoreInferenceCode } = await import("../../../../lib/model-catalog/backup");
    (backupInferenceCode as any).mockResolvedValue("/tmp/backup-1");

    const fsPromises = await import("node:fs/promises");
    (fsPromises.readdir as any).mockResolvedValue([{ name: "main.py", isDirectory: () => false }]);
    (fsPromises.copyFile as any).mockRejectedValue(new Error("disk full"));

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));

    const { POST } = await import("./route");
    const res = await POST(makeRequest({ owner: "inigo", repo: "lumi-model-catalog", tag: "lumi-preview-v1.1" }));

    expect(res.status).toBe(400);
    expect(restoreInferenceCode).toHaveBeenCalledWith(expect.stringContaining("inference"), "/tmp/backup-1");
  });

  it("rejects a release whose code bundle contains a file outside the managed .py/requirements.txt scope, before touching the backup or the real inference dir", async () => {
    const { listReleasesForRepo, downloadReleaseAsset } = await import("../../../../lib/model-catalog/github");
    const { encryptBuffer } = await import("@netryx/settings-repo");
    const { MODEL_CATALOG_SHARED_KEY } = await import("../../../../lib/model-catalog/shared-key");
    const { backupInferenceCode } = await import("../../../../lib/model-catalog/backup");

    const manifest = {
      bundleId: "lumi-preview", version: "1.1", backbones: [], description: "",
      benchmark: { accuracyWithin50m: 0.9, avgDistanceM: 5, sampleCount: 20, ranAt: "x" },
    };
    const zip = new JSZip();
    zip.file("main.py", "print('v1.1')");
    zip.file("sneaky.sh", "#!/bin/sh\necho pwned");
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

    const { POST } = await import("./route");
    const res = await POST(makeRequest({ owner: "inigo", repo: "lumi-model-catalog", tag: "lumi-preview-v1.1" }));

    expect(res.status).toBe(400);
    expect(backupInferenceCode).not.toHaveBeenCalled();
  });
});
