// apps/web/lib/model-catalog/github.test.ts
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  ensureRepoWithTopic,
  upsertRelease,
  listReleasesForRepo,
  searchRepositoriesByTopic,
  downloadReleaseAsset,
} from "./github";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ensureRepoWithTopic", () => {
  it("creates the repo if missing, then adds the topic without dropping existing ones", async () => {
    const calls: Array<{ url: string; method?: string; body?: string }> = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method, body: init?.body as string });
      if (url.endsWith("/repos/inigo/lumi-model-catalog")) return { status: 404, ok: false } as Response;
      if (url.endsWith("/user/repos")) return { ok: true, status: 201 } as Response;
      if (url.endsWith("/topics") && !init?.method) return { ok: true, json: async () => ({ names: [] }) } as Response;
      if (url.endsWith("/topics") && init?.method === "PUT") return { ok: true, status: 200 } as Response;
      throw new Error(`unexpected fetch: ${url}`);
    }));

    await ensureRepoWithTopic("inigo", "lumi-model-catalog", "tok");

    const topicsPut = calls.find((c) => c.url.endsWith("/topics") && c.method === "PUT");
    expect(JSON.parse(topicsPut!.body!).names).toEqual(["lumi-model-catalog"]);
  });
});

describe("upsertRelease", () => {
  it("deletes an existing release with the same tag before creating a fresh one, then uploads assets", async () => {
    const calls: Array<{ url: string; method?: string }> = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method });
      if (url.includes("/releases/tags/lumi-preview-v1.1")) return { ok: true, json: async () => ({ id: 999 }) } as Response;
      if (url.includes("/releases/999") && init?.method === "DELETE") return { ok: true } as Response;
      if (url.endsWith("/releases") && init?.method === "POST") {
        return { ok: true, json: async () => ({ upload_url: "https://uploads.github.com/repos/inigo/lumi-model-catalog/releases/1000/assets{?name,label}" }) } as Response;
      }
      if (url.includes("uploads.github.com") && init?.method === "POST") return { ok: true } as Response;
      throw new Error(`unexpected fetch: ${url} ${init?.method}`);
    }));

    await upsertRelease(
      "inigo", "lumi-model-catalog", "lumi-preview-v1.1", "Lumi Preview v1.1",
      [{ name: "metadata.json.enc", data: Buffer.from("x") }], "tok"
    );

    expect(calls.some((c) => c.method === "DELETE")).toBe(true);
    expect(calls.some((c) => c.url.includes("uploads.github.com"))).toBe(true);
  });
});

describe("listReleasesForRepo", () => {
  it("maps GitHub's release shape to GithubRelease", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ([
        { tag_name: "lumi-preview-v1.0", name: "Lumi Preview v1.0", body: "", assets: [{ name: "code.zip.enc", url: "https://api.github.com/a/1" }] },
      ]),
    } as Response)));

    expect(await listReleasesForRepo("inigo", "lumi-model-catalog")).toEqual([
      { tagName: "lumi-preview-v1.0", name: "Lumi Preview v1.0", body: "", assets: [{ name: "code.zip.enc", url: "https://api.github.com/a/1" }] },
    ]);
  });
});

describe("searchRepositoriesByTopic", () => {
  it("maps search results to owner/repo pairs", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({ items: [{ owner: { login: "inigo" }, name: "lumi-model-catalog" }] }),
    } as Response)));

    expect(await searchRepositoriesByTopic("lumi-model-catalog")).toEqual([{ owner: "inigo", repo: "lumi-model-catalog" }]);
  });
});

describe("downloadReleaseAsset", () => {
  it("returns the asset bytes as a Buffer", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    } as Response)));

    const bytes = await downloadReleaseAsset("https://api.github.com/a/1", "tok");
    expect(bytes.equals(Buffer.from([1, 2, 3]))).toBe(true);
  });
});
