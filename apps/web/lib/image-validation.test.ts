import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { validateImageBytes } from "./image-validation";

describe("validateImageBytes", () => {
  it("accepts a real PNG and reports its dimensions and format", async () => {
    const png = await sharp({
      create: { width: 12, height: 8, channels: 3, background: { r: 1, g: 2, b: 3 } },
    }).png().toBuffer();

    const result = await validateImageBytes(png);

    expect(result).toEqual({ ok: true, width: 12, height: 8, format: "png" });
  });

  it("accepts a real JPEG", async () => {
    const jpeg = await sharp({
      create: { width: 20, height: 10, channels: 3, background: { r: 10, g: 20, b: 30 } },
    }).jpeg().toBuffer();

    const result = await validateImageBytes(jpeg);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.format).toBe("jpeg");
  });

  it("rejects bytes that are not a decodable image", async () => {
    const result = await validateImageBytes(Buffer.from("this is not an image, just text"));

    expect(result).toEqual({ ok: false, reason: "No se pudo decodificar la imagen" });
  });

  it("rejects an empty buffer", async () => {
    const result = await validateImageBytes(Buffer.alloc(0));

    expect(result.ok).toBe(false);
  });
});
