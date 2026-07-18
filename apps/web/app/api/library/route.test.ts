import { describe, it, expect, beforeEach } from "vitest";
import sharp from "sharp";
import { GET, POST } from "./route";
import { resetLibraryForTests } from "../../../lib/image-library";

beforeEach(() => resetLibraryForTests());

describe("POST /api/library", () => {
  it("adds a valid image and returns its summary", async () => {
    const png = await sharp({
      create: { width: 4, height: 4, channels: 3, background: { r: 1, g: 2, b: 3 } },
    }).png().toBuffer();
    const form = new FormData();
    form.append("image", new File([png], "test.png", { type: "image/png" }));

    const res = await POST(new Request("http://x/api/library", { method: "POST", body: form }));
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.image.filename).toBe("test.png");
    expect(body.image.width).toBe(4);
    expect(body.image.bytes).toBeUndefined();
  });

  it("rejects a request whose bytes are not a real image", async () => {
    const form = new FormData();
    form.append("image", new File([Buffer.from("not an image")], "fake.png", { type: "image/png" }));

    const res = await POST(new Request("http://x/api/library", { method: "POST", body: form }));

    expect(res.status).toBe(400);
  });

  it("rejects a request with no image field", async () => {
    const res = await POST(new Request("http://x/api/library", { method: "POST", body: new FormData() }));

    expect(res.status).toBe(400);
  });
});

describe("GET /api/library", () => {
  it("lists previously added images newest-first", async () => {
    const png = await sharp({
      create: { width: 2, height: 2, channels: 3, background: { r: 0, g: 0, b: 0 } },
    }).png().toBuffer();
    const form1 = new FormData();
    form1.append("image", new File([png], "a.png", { type: "image/png" }));
    await POST(new Request("http://x/api/library", { method: "POST", body: form1 }));

    const form2 = new FormData();
    form2.append("image", new File([png], "b.png", { type: "image/png" }));
    await POST(new Request("http://x/api/library", { method: "POST", body: form2 }));

    const res = await GET();
    const body = await res.json();

    expect(body.images.map((i: { filename: string }) => i.filename)).toEqual(["b.png", "a.png"]);
  });
});
