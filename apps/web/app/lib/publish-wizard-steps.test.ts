import { describe, it, expect } from "vitest";
import { canAdvanceFromAreaStep, canAdvanceFromDetailsStep, canPublish } from "./publish-wizard-steps";

describe("canAdvanceFromAreaStep", () => {
  it("is false with no area selected", () => {
    expect(canAdvanceFromAreaStep(null)).toBe(false);
    expect(canAdvanceFromAreaStep("")).toBe(false);
  });

  it("is true once an area id is selected", () => {
    expect(canAdvanceFromAreaStep("area-1")).toBe(true);
  });
});

describe("canAdvanceFromDetailsStep", () => {
  it("is false with a blank or whitespace-only title", () => {
    expect(canAdvanceFromDetailsStep("")).toBe(false);
    expect(canAdvanceFromDetailsStep("   ")).toBe(false);
  });

  it("is true with a real title", () => {
    expect(canAdvanceFromDetailsStep("Downtown Madrid")).toBe(true);
  });
});

describe("canPublish", () => {
  it("requires both a valid owner/repo shape and the ToS checkbox", () => {
    expect(canPublish("inigo/lumi-madrid", true)).toBe(true);
    expect(canPublish("inigo/lumi-madrid", false)).toBe(false);
    expect(canPublish("not-a-repo", true)).toBe(false);
    expect(canPublish("", true)).toBe(false);
  });
});
