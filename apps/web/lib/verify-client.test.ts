// apps/web/lib/verify-client.test.ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { verifyCandidates } from "./verify-client";

afterEach(() => vi.unstubAllGlobals());

describe("verifyCandidates", () => {
  it("POSTs the query + candidates and maps the results", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [{ inliers: 42, reproj_error: 1.5, score: 0.8 }],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const out = await verifyCandidates("Q", ["C1"], "http://localhost:8000");

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:8000/verify",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ query_image_base64: "Q", candidate_images_base64: ["C1"] }),
      })
    );
    expect(out).toEqual([{ inliers: 42, reprojError: 1.5, score: 0.8 }]);
  });

  it("throws on non-OK", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 503, text: async () => "not loaded" })
    );
    await expect(verifyCandidates("Q", ["C1"], "http://localhost:8000")).rejects.toThrow(
      /Inference service \/verify failed \(503\): not loaded/
    );
  });
});