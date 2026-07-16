// apps/web/app/api/models/route.test.ts
import { describe, it, expect } from "vitest";

describe("GET /api/models", () => {
  it("self-describes every retrieval model's id/status/version and its own endpoints", async () => {
    const { GET } = await import("./route");
    const res = await GET();
    const json = await res.json();

    const lumiPreview = json.models.find((m: any) => m.id === "lumi-preview");
    expect(lumiPreview).toBeDefined();
    expect(lumiPreview.displayName).toBe("Lumi Preview");
    expect(lumiPreview.status).toBe("preview");
    expect(lumiPreview.version).toBe("1.0");
    expect(lumiPreview.endpoints.estimate).toEqual({
      method: "POST",
      path: "/api/models/lumi-preview/estimate",
      description: expect.any(String),
    });
    expect(lumiPreview.endpoints.refine).toEqual({
      method: "POST",
      path: "/api/models/lumi-preview/refine",
      description: expect.any(String),
    });
  });
});
