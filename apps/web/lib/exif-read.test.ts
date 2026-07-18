// apps/web/lib/exif-read.test.ts
import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { readExifSummary } from "./exif-read";

describe("readExifSummary", () => {
  it("returns all-null fields with hasGps false for an image with no EXIF", async () => {
    const png = await sharp({
      create: { width: 4, height: 4, channels: 3, background: { r: 0, g: 0, b: 0 } },
    }).png().toBuffer();

    const summary = await readExifSummary(png);

    expect(summary).toEqual({
      camera: null,
      aperture: null,
      shutterSpeed: null,
      iso: null,
      capturedAt: null,
      hasGps: false,
    });
  });

  it("does not throw on bytes that fail to decode", async () => {
    const summary = await readExifSummary(Buffer.from("not an image"));

    expect(summary.hasGps).toBe(false);
    expect(summary.camera).toBeNull();
  });
});