// apps/web/lib/inference-client.test.ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { embedQueryImage } from "./inference-client";

afterEach(() => vi.unstubAllGlobals());

describe("embedQueryImage", () => {
  it("POSTs one image with augment=true and returns the single descriptor", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ embeddings: [[0.1, 0.2, 0.3]] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const vec = await embedQueryImage("aaaa", "http://localhost:8000");

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:8000/embed",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ images_base64: ["aaaa"], augment: true }),
      })
    );
    expect(vec).toEqual([0.1, 0.2, 0.3]);
  });

  it("throws when the inference service responds non-OK", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 503, text: async () => "model not loaded" })
    );
    await expect(embedQueryImage("aaaa", "http://localhost:8000")).rejects.toThrow(
      /Inference service \/embed failed \(503\): model not loaded/
    );
  });
});