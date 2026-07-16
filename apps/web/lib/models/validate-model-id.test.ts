// apps/web/lib/models/validate-model-id.test.ts
import { describe, it, expect } from "vitest";
import { validateModelId } from "./validate-model-id";

describe("validateModelId", () => {
  it("passes when modelId is known and currently active", () => {
    expect(validateModelId("lumi-preview", ["lumi-preview"], "lumi-preview")).toEqual({ ok: true });
  });

  it("404s on an unknown modelId", () => {
    const result = validateModelId("nope", ["lumi-preview"], "lumi-preview");
    expect(result).toEqual({ ok: false, status: 404, error: expect.stringContaining("nope") });
  });

  it("409s on a known modelId that isn't the currently active one", () => {
    const result = validateModelId("future-model", ["lumi-preview", "future-model"], "lumi-preview");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(409);
      expect(result.error).toContain("future-model");
      expect(result.error).toContain("lumi-preview");
    }
  });
});
