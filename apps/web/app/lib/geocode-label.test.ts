// apps/web/app/lib/geocode-label.test.ts
import { describe, it, expect } from "vitest";
import { formatMapboxLabel, formatNominatimLabel } from "./geocode-label";

describe("formatMapboxLabel", () => {
  it("joins place + region + country from a Mapbox feature context", () => {
    const feature = {
      text: "San Jose",
      context: [
        { id: "region.1", text: "California" },
        { id: "country.1", text: "United States" },
      ],
    };
    expect(formatMapboxLabel(feature)).toBe("San Jose, California, United States");
  });
});

describe("formatNominatimLabel", () => {
  it("prefers city/town/village, then state, then country", () => {
    const addr = { city: "San Jose", state: "California", country: "United States" };
    expect(formatNominatimLabel(addr)).toBe("San Jose, California, United States");
  });
  it("falls back to town/village when city is absent", () => {
    expect(formatNominatimLabel({ village: "Lakeway", state: "Texas", country: "United States" })).toBe(
      "Lakeway, Texas, United States"
    );
  });
});