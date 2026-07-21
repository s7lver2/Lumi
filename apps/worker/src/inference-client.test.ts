// apps/worker/src/inference-client.test.ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { embedImages } from "./inference-client";

afterEach(() => vi.unstubAllGlobals());

describe("embedImages", () => {
  it("POSTs a batch of base64 images and returns their embeddings in order", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ embeddings: [[0.1, 0.2], [0.3, 0.4]] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await embedImages(["aaaa", "bbbb"], "http://localhost:8000", {} as any);

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:8000/embed",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ images_base64: ["aaaa", "bbbb"] }),
      })
    );
    expect(result).toEqual([[0.1, 0.2], [0.3, 0.4]]);
  });

  it("throws a descriptive error when the service responds with a non-OK status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 503, text: async () => "model not loaded" })
    );

    await expect(embedImages(["aaaa"], "http://localhost:8000", {} as any)).rejects.toThrow(
      /Inference service \/embed failed \(503\): model not loaded/
    );
  });
});