import { describe, it, expect, vi, afterEach } from "vitest";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("GET /api/model-status", () => {
  it("proxies the inference service's /model-status response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ loading: "retrieval", lowVramMode: true }),
    }));

    const { GET } = await import("./route");
    const res = await GET();
    const json = await res.json();

    expect(json).toEqual({ loading: "retrieval", lowVramMode: true });
  });

  it("reports loading: null, lowVramMode: false when the inference service is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));

    const { GET } = await import("./route");
    const res = await GET();
    const json = await res.json();

    expect(json).toEqual({ loading: null, lowVramMode: false });
  });
});
