// apps/web/app/api/library/from-url/route.test.ts
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { POST } from "./route";
import { resetLibraryForTests } from "../../../../lib/image-library";
import * as fetchImageUrlModule from "../../../../lib/fetch-image-url";
import sharp from "sharp";

beforeEach(() => resetLibraryForTests());
afterEach(() => vi.restoreAllMocks());

describe("POST /api/library/from-url", () => {
  it("adds an image downloaded from an allowed URL", async () => {
    const png = await sharp({
      create: { width: 6, height: 6, channels: 3, background: { r: 1, g: 1, b: 1 } },
    }).png().toBuffer();
    vi.spyOn(fetchImageUrlModule, "fetchImageUrl").mockResolvedValue({ ok: true, bytes: png });

    const res = await POST(
      new Request("http://x/api/library/from-url", {
        method: "POST",
        body: JSON.stringify({ url: "https://example.com/photo.png" }),
        headers: { "content-type": "application/json" },
      })
    );
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.image.width).toBe(6);
    expect(body.image.sourceKind).toBe("url");
  });

  it("propagates a rejection from fetchImageUrl (e.g. SSRF-blocked) as a 400", async () => {
    vi.spyOn(fetchImageUrlModule, "fetchImageUrl").mockResolvedValue({
      ok: false,
      reason: "El enlace apunta a una dirección no permitida",
    });

    const res = await POST(
      new Request("http://x/api/library/from-url", {
        method: "POST",
        body: JSON.stringify({ url: "http://169.254.169.254/" }),
        headers: { "content-type": "application/json" },
      })
    );

    expect(res.status).toBe(400);
  });

  it("rejects a downloaded payload that isn't a real image", async () => {
    vi.spyOn(fetchImageUrlModule, "fetchImageUrl").mockResolvedValue({
      ok: true,
      bytes: Buffer.from("not an image"),
    });

    const res = await POST(
      new Request("http://x/api/library/from-url", {
        method: "POST",
        body: JSON.stringify({ url: "https://example.com/fake.png" }),
        headers: { "content-type": "application/json" },
      })
    );

    expect(res.status).toBe(400);
  });

  it("rejects a request missing the url field", async () => {
    const res = await POST(
      new Request("http://x/api/library/from-url", {
        method: "POST",
        body: JSON.stringify({}),
        headers: { "content-type": "application/json" },
      })
    );

    expect(res.status).toBe(400);
  });
});