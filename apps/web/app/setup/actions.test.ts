// apps/web/app/setup/actions.test.ts
import { describe, it, expect, vi } from "vitest";
import { submitSetup } from "./actions";

function makeFormData(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

describe("submitSetup", () => {
  it("returns a field error and does not call completeSetup on invalid input", async () => {
    const repo = { completeSetup: vi.fn() };
    const result = await submitSetup(
      repo as any,
      makeFormData({
        GOOGLE_MAPS_API_KEY: "",
        MAPBOX_TOKEN: "",
        MAX_AREA_KM2: "5",
        MAX_MONTHLY_BUDGET_USD: "50",
        MAX_CONCURRENT_REQUESTS: "10",
        STREET_VIEW_PRICE_PER_IMAGE_USD: "0.007",
      })
    );
    expect(result.ok).toBe(false);
    expect(result.ok || result.error).toMatch(/required/i);
    expect(repo.completeSetup).not.toHaveBeenCalled();
  });

  it("calls completeSetup with all fields, marking API key/token as secret, and fills RETRIEVAL_MODEL/VERIFICATION_MODEL from their defaults since the wizard doesn't render those fields (spec §14.2 vs §15.3)", async () => {
    const repo = { completeSetup: vi.fn() };
    const result = await submitSetup(
      repo as any,
      makeFormData({
        GOOGLE_MAPS_API_KEY: "AIzaSyTest",
        MAPBOX_TOKEN: "",
        MAX_AREA_KM2: "5",
        MAX_MONTHLY_BUDGET_USD: "50",
        MAX_CONCURRENT_REQUESTS: "10",
        STREET_VIEW_PRICE_PER_IMAGE_USD: "0.007",
        // note: no RETRIEVAL_MODEL / VERIFICATION_MODEL field — not part of
        // the wizard's four steps (spec §14.2); they must still get written.
      })
    );

    expect(result.ok).toBe(true);
    expect(repo.completeSetup).toHaveBeenCalledWith([
      { key: "GOOGLE_MAPS_API_KEY", value: "AIzaSyTest", isSecret: true },
      { key: "MAPBOX_TOKEN", value: "", isSecret: true },
      { key: "MAX_AREA_KM2", value: "5", isSecret: false },
      { key: "MAX_MONTHLY_BUDGET_USD", value: "50", isSecret: false },
      { key: "MAX_CONCURRENT_REQUESTS", value: "10", isSecret: false },
      { key: "STREET_VIEW_PRICE_PER_IMAGE_USD", value: "0.007", isSecret: false },
      { key: "RETRIEVAL_MODEL", value: "lumi-preview", isSecret: false },
      { key: "VERIFICATION_MODEL", value: "laila", isSecret: false },
    ]);
  });
});