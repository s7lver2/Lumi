// apps/web/app/api/library/[id]/exif/route.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import sharp from "sharp";
import { GET } from "./route";
import { addImage, resetLibraryForTests } from "../../../../../lib/image-library";

beforeEach(() => resetLibraryForTests());

describe("GET /api/library/:id/exif", () => {
  it("returns the exif summary for an existing image", async () => {
    const png = await sharp({ create: { width: 2, height: 2, channels: 3, background: { r: 0, g: 0, b: 0 } } }).png().toBuffer();
    const image = addImage({ bytes: png, filename: "a.png", mimeType: "image/png", width: 2, height: 2, sourceKind: "upload" });

    const res = await GET(new Request("http://x"), { params: { id: image.id } });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.exif.hasGps).toBe(false);
  });

  it("returns 404 for an unknown id", async () => {
    const res = await GET(new Request("http://x"), { params: { id: "nope" } });
    expect(res.status).toBe(404);
  });
});