// apps/web/app/api/library/[id]/bytes/route.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import sharp from "sharp";
import { GET } from "./route";
import { addImage, resetLibraryForTests } from "../../../../../lib/image-library";

beforeEach(() => resetLibraryForTests());

describe("GET /api/library/:id/bytes", () => {
  it("returns the raw bytes with the correct content-type", async () => {
    const png = await sharp({
      create: { width: 3, height: 3, channels: 3, background: { r: 5, g: 5, b: 5 } },
    }).png().toBuffer();
    const image = addImage({
      bytes: png, filename: "a.png", mimeType: "image/png", width: 3, height: 3, sourceKind: "upload",
    });

    const res = await GET(new Request("http://x"), { params: { id: image.id } });
    const body = Buffer.from(await res.arrayBuffer());

    expect(res.headers.get("content-type")).toBe("image/png");
    expect(body.equals(png)).toBe(true);
  });

  it("returns 404 for an unknown id", async () => {
    const res = await GET(new Request("http://x"), { params: { id: "nope" } });
    expect(res.status).toBe(404);
  });
});