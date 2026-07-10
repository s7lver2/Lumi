// apps/web/app/settings/mask.test.ts
import { describe, it, expect } from "vitest";
import { maskSecret } from "./mask";

describe("maskSecret", () => {
  it("shows the first 4 chars then 12 dots", () => {
    expect(maskSecret("AIzaSyRealSecret")).toBe("AIza" + "•".repeat(12));
  });
  it("handles values shorter than 4 chars", () => {
    expect(maskSecret("AI")).toBe("AI" + "•".repeat(12));
  });
  it("returns empty string for empty input", () => {
    expect(maskSecret("")).toBe("");
  });
});