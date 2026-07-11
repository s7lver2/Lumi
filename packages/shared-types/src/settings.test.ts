// packages/shared-types/src/settings.test.ts
import { describe, it, expect } from "vitest";
import { SETTINGS_SCHEMA, validateSettingValue, getSettingDefinition } from "./settings";
import { DEFAULT_CONFIRM_THRESHOLD } from "./search";
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
  it("defines VERIFICATION_CONFIRM_THRESHOLD as a 0-1 slider setting with a sane default", () => {
    const def = getSettingDefinition("VERIFICATION_CONFIRM_THRESHOLD");
    expect(def.type).toBe("slider");
    expect(def.min).toBe(0);
    expect(def.max).toBe(1);
    expect(def.defaultValue).toBe("0.5");
    expect(() => validateSettingValue("VERIFICATION_CONFIRM_THRESHOLD", "0.7")).not.toThrow();
  });
  it("accepts a fractional slider value and rejects one outside min/max", () => {
    expect(() => validateSettingValue("VERIFICATION_CONFIRM_THRESHOLD", "0.55")).not.toThrow();
    expect(() => validateSettingValue("VERIFICATION_CONFIRM_THRESHOLD", "1.5")).toThrow(/between/i);
  });
  it("has a confirm threshold in (0, 1] (spec §9.3)", () => {
    expect(DEFAULT_CONFIRM_THRESHOLD).toBeGreaterThan(0);
    expect(DEFAULT_CONFIRM_THRESHOLD).toBeLessThanOrEqual(1);
  });
  it("defines Google free-tier settings defaulting to 0", () => {
    expect(getSettingDefinition("GOOGLE_FREE_MONTHLY_CREDIT_USD").defaultValue).toBe("0");
    expect(getSettingDefinition("GOOGLE_FREE_MONTHLY_IMAGES").defaultValue).toBe("0");
  });
});