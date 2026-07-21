// apps/web/lib/inference-client.test.ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { embedQueryImage, classifyQueryImage } from "./inference-client";

afterEach(() => vi.unstubAllGlobals());

describe("embedQueryImage", () => {
  it("POSTs one image with augment=true and returns the single descriptor", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ embeddings: [[0.1, 0.2, 0.3]] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const vec = await embedQueryImage("aaaa", "http://localhost:8000", {} as any);

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
    await expect(embedQueryImage("aaaa", "http://localhost:8000", {} as any)).rejects.toThrow(
      /Inference service \/embed failed \(503\): model not loaded/
    );
  });
});

describe("classifyQueryImage", () => {
  it("POSTs the image to /models/{modelId}/classify and returns the groups", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        groups: [
          { facet: "time_of_day", labels: [{ name: "foto tomada al mediodía", score: 0.72 }, { name: "foto tomada de noche", score: 0.1 }] },
        ],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const groups = await classifyQueryImage("aaaa", "wanda-v1", "http://localhost:8000", {} as any);

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:8000/models/wanda-v1/classify",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ image_base64: "aaaa" }),
      })
    );
    expect(groups).toEqual([
      { facet: "time_of_day", labels: [{ name: "foto tomada al mediodía", score: 0.72 }, { name: "foto tomada de noche", score: 0.1 }] },
    ]);
  });

  it("throws when the inference service responds non-OK", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 404, text: async () => "Unknown or inactive classification model id: wanda-v1" })
    );
    await expect(classifyQueryImage("aaaa", "wanda-v1", "http://localhost:8000", {} as any)).rejects.toThrow(
      /Inference service \/models\/wanda-v1\/classify failed \(404\): Unknown or inactive classification model id: wanda-v1/
    );
  });
});