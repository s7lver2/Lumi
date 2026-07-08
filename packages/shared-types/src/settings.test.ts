// packages/shared-types/src/settings.test.ts
import { describe, it, expect } from "vitest";
import { SETTINGS_SCHEMA, validateSettingValue } from "./settings";
import { RETRIEVAL_MODELS, VERIFICATION_MODELS } from "./models";

describe("SETTINGS_SCHEMA", () => {
  it("lists every product-level setting from spec §14.1", () => {
    const keys = SETTINGS_SCHEMA.map((s) => s.key);
    expect(keys).toEqual(
      expect.arrayContaining([
        "GOOGLE_MAPS_API_KEY",
        "MAPBOX_TOKEN",
        "MAX_AREA_KM2",
        "MAX_MONTHLY_BUDGET_USD",
        "MAX_CONCURRENT_REQUESTS",
        "STREET_VIEW_PRICE_PER_IMAGE_USD",
        "RETRIEVAL_MODEL",
        "VERIFICATION_MODEL",
      ])
    );
  });

  it("marks API keys/tokens as secret", () => {
    const key = SETTINGS_SCHEMA.find((s) => s.key === "GOOGLE_MAPS_API_KEY")!;
    const token = SETTINGS_SCHEMA.find((s) => s.key === "MAPBOX_TOKEN")!;
    expect(key.isSecret).toBe(true);
    expect(token.isSecret).toBe(true);
  });

  it("marks numeric limits as not secret", () => {
    const limit = SETTINGS_SCHEMA.find((s) => s.key === "MAX_AREA_KM2")!;
    expect(limit.isSecret).toBe(false);
    expect(limit.type).toBe("number");
  });

  it("exposes RETRIEVAL_MODEL/VERIFICATION_MODEL as enum settings with options derived from the registry (spec §15.3)", () => {
    const retrieval = SETTINGS_SCHEMA.find((s) => s.key === "RETRIEVAL_MODEL")!;
    const verification = SETTINGS_SCHEMA.find((s) => s.key === "VERIFICATION_MODEL")!;

    expect(retrieval.type).toBe("enum");
    expect(retrieval.isSecret).toBe(false);
    expect(retrieval.options).toEqual(RETRIEVAL_MODELS.map((m) => m.id));
    expect(retrieval.defaultValue).toBe("lumi-preview");

    expect(verification.type).toBe("enum");
    expect(verification.options).toEqual(VERIFICATION_MODELS.map((m) => m.id));
    expect(verification.defaultValue).toBe("laila");
  });
});

describe("validateSettingValue", () => {
  it("accepts a non-empty string for GOOGLE_MAPS_API_KEY", () => {
    expect(() =>
      validateSettingValue("GOOGLE_MAPS_API_KEY", "AIzaSyTest123")
    ).not.toThrow();
  });

  it("rejects an empty GOOGLE_MAPS_API_KEY", () => {
    expect(() => validateSettingValue("GOOGLE_MAPS_API_KEY", "")).toThrow(
      /required/i
    );
  });

  it("rejects a non-numeric MAX_AREA_KM2", () => {
    expect(() => validateSettingValue("MAX_AREA_KM2", "not-a-number")).toThrow(
      /number/i
    );
  });

  it("rejects MAX_AREA_KM2 <= 0", () => {
    expect(() => validateSettingValue("MAX_AREA_KM2", "0")).toThrow(
      /greater than 0/i
    );
  });

  it("accepts a valid MAX_AREA_KM2", () => {
    expect(() => validateSettingValue("MAX_AREA_KM2", "5")).not.toThrow();
  });

  it("allows an empty MAPBOX_TOKEN (optional per spec §5.1 fallback)", () => {
    expect(() => validateSettingValue("MAPBOX_TOKEN", "")).not.toThrow();
  });

  it("accepts a RETRIEVAL_MODEL value that is in the registry", () => {
    expect(() =>
      validateSettingValue("RETRIEVAL_MODEL", "lumi-preview")
    ).not.toThrow();
  });

  it("rejects a RETRIEVAL_MODEL value that isn't in the registry", () => {
    expect(() => validateSettingValue("RETRIEVAL_MODEL", "not-a-model")).toThrow(
      /one of/i
    );
  });
});