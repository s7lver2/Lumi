// apps/web/app/api/library/[id]/route.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import sharp from "sharp";
import { DELETE, PATCH } from "./route";
import { addImage, getImage, resetLibraryForTests } from "../../../../lib/image-library";

beforeEach(() => resetLibraryForTests());

async function pngBuffer(width: number, height: number) {
  return sharp({ create: { width, height, channels: 3, background: { r: 1, g: 1, b: 1 } } }).png().toBuffer();
}

describe("DELETE /api/library/:id", () => {
  it("removes an existing image", async () => {
    const image = addImage({
      bytes: await pngBuffer(4, 4),
      filename: "a.png",
      mimeType: "image/png",
      width: 4,
      height: 4,
      sourceKind: "upload",
    });

    const res = await DELETE(new Request("http://x", { method: "DELETE" }), { params: { id: image.id } });

    expect(res.status).toBe(204);
    expect(getImage(image.id)).toBeUndefined();
  });

  it("returns 404 for an unknown id", async () => {
    const res = await DELETE(new Request("http://x", { method: "DELETE" }), { params: { id: "nope" } });
    expect(res.status).toBe(404);
  });
});

describe("PATCH /api/library/:id", () => {
  it("replaces the image bytes with a validated crop", async () => {
    const image = addImage({
      bytes: await pngBuffer(10, 10),
      filename: "a.png",
      mimeType: "image/png",
      width: 10,
      height: 10,
      sourceKind: "upload",
    });
    const cropped = await pngBuffer(5, 5);
    const form = new FormData();
    form.append("image", new File([cropped], "a.png", { type: "image/png" }));

    const res = await PATCH(new Request("http://x", { method: "PATCH", body: form }), { params: { id: image.id } });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.image.width).toBe(5);
    expect(getImage(image.id)?.width).toBe(5);
  });

  it("rejects invalid crop bytes without touching the existing image", async () => {
    const image = addImage({
      bytes: await pngBuffer(10, 10),
      filename: "a.png",
      mimeType: "image/png",
      width: 10,
      height: 10,
      sourceKind: "upload",
    });
    const form = new FormData();
    form.append("image", new File([Buffer.from("not an image")], "a.png", { type: "image/png" }));

    const res = await PATCH(new Request("http://x", { method: "PATCH", body: form }), { params: { id: image.id } });

    expect(res.status).toBe(400);
    expect(getImage(image.id)?.width).toBe(10);
  });

  it("returns 404 for an unknown id", async () => {
    const form = new FormData();
    form.append("image", new File([await pngBuffer(2, 2)], "a.png", { type: "image/png" }));

    const res = await PATCH(new Request("http://x", { method: "PATCH", body: form }), { params: { id: "nope" } });

    expect(res.status).toBe(404);
  });
});