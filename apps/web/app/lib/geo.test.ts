// apps/web/app/lib/geo.test.ts
import { describe, it, expect } from "vitest";
import { polygonAreaKm2 } from "./geo";

describe("polygonAreaKm2", () => {
  it("computes the area of a ~1km x ~1km box near the equator as ~1 km²", () => {
    // 0.009 deg lat ~= 1 km; at the equator 0.009 deg lng ~= 1 km too.
    const ring: [number, number][] = [
      [0, 0],
      [0.009, 0],
      [0.009, 0.009],
      [0, 0.009],
      [0, 0],
    ];
    const area = polygonAreaKm2(ring);
    expect(area).toBeGreaterThan(0.9);
    expect(area).toBeLessThan(1.1);
  });

  it("returns 0 for a degenerate ring", () => {
    expect(polygonAreaKm2([[0, 0], [0, 0], [0, 0]])).toBe(0);
  });
});