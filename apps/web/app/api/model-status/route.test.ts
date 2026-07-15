import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../lib/health", () => ({
  fetchModelStatus: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/model-status", () => {
  it("proxies whatever fetchModelStatus resolves with", async () => {
    const health = await import("../../../lib/health");
    (health.fetchModelStatus as any).mockResolvedValue({
      loading: "retrieval",
      lowVramMode: true,
      gpuNote: "GPU detectada: RTX 3050 (6 GB)",
    });

    const { GET } = await import("./route");
    const res = await GET();
    const json = await res.json();

    expect(json).toEqual({
      loading: "retrieval",
      lowVramMode: true,
      gpuNote: "GPU detectada: RTX 3050 (6 GB)",
    });
  });

  it("passes through the loading: null, lowVramMode: false fallback", async () => {
    const health = await import("../../../lib/health");
    (health.fetchModelStatus as any).mockResolvedValue({
      loading: null,
      lowVramMode: false,
      gpuNote: "Estado de la GPU desconocido — servicio de inferencia no disponible.",
    });

    const { GET } = await import("./route");
    const res = await GET();
    const json = await res.json();

    expect(json).toEqual({
      loading: null,
      lowVramMode: false,
      gpuNote: "Estado de la GPU desconocido — servicio de inferencia no disponible.",
    });
  });
});
