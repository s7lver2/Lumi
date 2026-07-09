// apps/web/app/lib/coords.test.ts
import { describe, it, expect } from "vitest";
import { formatCoords } from "./coords";

describe("formatCoords", () => {
  it("formats lat,lng to six decimal places", () => {
    expect(formatCoords(37.2803331, -121.9035009)).toBe("37.280333, -121.903501");
  });
});