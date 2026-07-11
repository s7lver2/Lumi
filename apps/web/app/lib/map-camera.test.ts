// apps/web/app/lib/map-camera.test.ts
import { describe, it, expect, vi } from "vitest";
import { flyToRegion, flyToPoint } from "./map-camera";

describe("flyToRegion", () => {
  it("flies to the region centroid at a broad, exploratory zoom", () => {
    const map = { flyTo: vi.fn() };
    flyToRegion(map, { centroid: { lat: 40.4, lng: -3.7 } });
    expect(map.flyTo).toHaveBeenCalledWith(
      expect.objectContaining({ center: [-3.7, 40.4], zoom: 15, pitch: 50 })
    );
  });
});

describe("flyToPoint", () => {
  it("flies to the exact point at a tight, close-up zoom", () => {
    const map = { flyTo: vi.fn() };
    flyToPoint(map, { lat: 40.4, lng: -3.7 });
    expect(map.flyTo).toHaveBeenCalledWith(
      expect.objectContaining({ center: [-3.7, 40.4], zoom: 17, pitch: 60 })
    );
  });

  it("does nothing when map is not yet ready", () => {
    expect(() => flyToPoint(null, { lat: 40.4, lng: -3.7 })).not.toThrow();
  });
});