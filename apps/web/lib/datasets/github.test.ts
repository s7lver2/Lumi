// apps/web/lib/datasets/github.test.ts
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
  it("creates the repo if it doesn't exist, then adds the topic without dropping existing ones", async () => {
    const calls: Array<{ url: string; method?: string; body?: string }> = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method, body: init?.body as string });
      if (url.endsWith("/repos/inigo/lumi-madrid")) return { status: 404, ok: false } as Response;
      if (url.endsWith("/user/repos")) return { ok: true, status: 201 } as Response;
      if (url.endsWith("/topics") && (!init || init.method === undefined)) {
        return { ok: true, json: async () => ({ names: ["existing-topic"] }) } as Response;
      }
      if (url.endsWith("/topics") && init?.method === "PUT") return { ok: true, status: 200 } as Response;
      throw new Error(`unexpected fetch: ${url}`);
    }));

    await ensureRepoWithTopic("inigo", "lumi-madrid", "tok");

    const createCall = calls.find((c) => c.url.endsWith("/user/repos"));
    expect(createCall).toBeDefined();
    expect(JSON.parse(createCall!.body!).auto_init).toBe(true);
    const topicsPut = calls.find((c) => c.url.endsWith("/topics") && c.method === "PUT");
    expect(JSON.parse(topicsPut!.body!).names).toEqual(["existing-topic", "lumi-dataset"]);
  });

  it("does nothing extra when the repo exists and already has the topic", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/repos/inigo/lumi-madrid")) return { ok: true, status: 200 } as Response;
      if (url.endsWith("/topics") && !init?.method) {
        return { ok: true, json: async () => ({ names: ["lumi-dataset"] }) } as Response;
      }
      throw new Error(`unexpected fetch: ${url}`);
    }));

    await expect(ensureRepoWithTopic("inigo", "lumi-madrid", "tok")).resolves.toBeUndefined();
  });
});

describe("upsertRelease", () => {
  it("deletes an existing release with the same tag before creating a fresh one, then uploads assets", async () => {
    const calls: Array<{ url: string; method?: string }> = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method });
      if (url.includes("/releases/tags/lumi-preview-v1.0")) {
        return { ok: true, json: async () => ({ id: 999 }) } as Response;
      }
      if (url.includes("/releases/999") && init?.method === "DELETE") return { ok: true } as Response;
      if (url.endsWith("/releases") && init?.method === "POST") {
        return { ok: true, json: async () => ({ upload_url: "https://uploads.github.com/repos/inigo/lumi-madrid/releases/1000/assets{?name,label}" }) } as Response;
      }
      if (url.includes("uploads.github.com") && init?.method === "POST") return { ok: true } as Response;
      throw new Error(`unexpected fetch: ${url} ${init?.method}`);
    }));

    await upsertRelease(
      "inigo", "lumi-madrid", "lumi-preview-v1.0", "Lumi Preview v1.0",
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
        { tag_name: "lumi-preview-v1.0", name: "Lumi Preview v1.0", body: "", assets: [{ name: "bundle.zip.enc", url: "https://api.github.com/a/1" }] },
      ]),
    } as Response)));

    const releases = await listReleasesForRepo("inigo", "lumi-madrid");
    expect(releases).toEqual([
      { tagName: "lumi-preview-v1.0", name: "Lumi Preview v1.0", body: "", assets: [{ name: "bundle.zip.enc", url: "https://api.github.com/a/1" }] },
    ]);
  });
});

describe("searchRepositoriesByTopic", () => {
  it("maps search results to owner/repo pairs", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({ items: [{ owner: { login: "inigo" }, name: "lumi-madrid" }] }),
    } as Response)));

    expect(await searchRepositoriesByTopic("lumi-dataset")).toEqual([{ owner: "inigo", repo: "lumi-madrid" }]);
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

describe("listUserRepositories", () => {
  it("maps a single page of results to UserRepository", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      headers: { get: () => null },
      json: async () => ([
        { owner: { login: "inigo" }, name: "lumi-madrid", private: false, description: "desc" },
      ]),
    } as unknown as Response)));

    const { listUserRepositories } = await import("./github");
    expect(await listUserRepositories("tok")).toEqual([
      { owner: "inigo", repo: "lumi-madrid", private: false, description: "desc" },
    ]);
  });

  it("follows the Link header to page through all results", async () => {
    let call = 0;
    vi.stubGlobal("fetch", vi.fn(async () => {
      call += 1;
      if (call === 1) {
        return {
          ok: true,
          headers: { get: () => '<https://api.github.com/user/repos?page=2>; rel="next"' },
          json: async () => ([{ owner: { login: "inigo" }, name: "repo-one", private: false, description: null }]),
        } as unknown as Response;
      }
      return {
        ok: true,
        headers: { get: () => null },
        json: async () => ([{ owner: { login: "inigo" }, name: "repo-two", private: true, description: null }]),
      } as unknown as Response;
    }));

    const { listUserRepositories } = await import("./github");
    const result = await listUserRepositories("tok");
    expect(result).toEqual([
      { owner: "inigo", repo: "repo-one", private: false, description: null },
      { owner: "inigo", repo: "repo-two", private: true, description: null },
    ]);
    expect(call).toBe(2);
  });
});

describe("getAuthenticatedLogin", () => {
  it("returns the token's own login", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({ login: "inigo" }),
    } as Response)));

    const { getAuthenticatedLogin } = await import("./github");
    expect(await getAuthenticatedLogin("tok")).toBe("inigo");
  });
});