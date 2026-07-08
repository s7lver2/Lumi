// apps/worker/src/street-view.test.ts
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { downloadCaptures } from "./street-view";
import type { SampledPoint } from "@netryx/shared-types";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function metadataResponse(panoId: string, ok = true) {
  return {
    ok: true,
    json: async () => (ok ? { status: "OK", pano_id: panoId, date: "2024-06" } : { status: "ZERO_RESULTS" }),
  };
}

function imageResponse(bodyByte: number, status = 200) {
  return {
    ok: status < 400,
    status,
    arrayBuffer: async () => new Uint8Array([bodyByte]).buffer,
  };
}

describe("downloadCaptures", () => {
  it("fetches metadata then the static image for each point/heading pair", async () => {
    const points: SampledPoint[] = [{ lat: 37.7749, lng: -122.4194 }];
    const fetchMock = vi
      .fn()
      // point 0 heading 0: metadata then image
      .mockResolvedValueOnce(metadataResponse("pano-a"))
      .mockResolvedValueOnce(imageResponse(1))
      // point 0 heading 90
      .mockResolvedValueOnce(metadataResponse("pano-a"))
      .mockResolvedValueOnce(imageResponse(2))
      // heading 180
      .mockResolvedValueOnce(metadataResponse("pano-a"))
      .mockResolvedValueOnce(imageResponse(3))
      // heading 270
      .mockResolvedValueOnce(metadataResponse("pano-a"))
      .mockResolvedValueOnce(imageResponse(4));
    vi.stubGlobal("fetch", fetchMock);

    const result = await downloadCaptures(points, [0, 90, 180, 270], {
      apiKey: "test-key",
      maxConcurrent: 2,
      existingPanoHeadings: new Set(),
    });

    expect(result.captures).toHaveLength(4);
    expect(result.failedPoints).toBe(0);
    expect(result.captures.every((c) => c.panoId === "pano-a")).toBe(true);
    expect(new Set(result.captures.map((c) => c.heading))).toEqual(new Set([0, 90, 180, 270]));
  });

  it("skips a pano/heading pair already present in existingPanoHeadings without downloading the image", async () => {
    const points: SampledPoint[] = [{ lat: 1, lng: 1 }];
    const fetchMock = vi.fn().mockResolvedValueOnce(metadataResponse("pano-dup"));
    vi.stubGlobal("fetch", fetchMock);

    const result = await downloadCaptures(points, [0], {
      apiKey: "test-key",
      maxConcurrent: 2,
      existingPanoHeadings: new Set(["pano-dup:0"]),
    });

    expect(result.captures).toHaveLength(0);
    expect(fetchMock).toHaveBeenCalledTimes(1); // metadata only, no static image fetch
  });

  it("counts a point with no coverage on any heading as failed, not throwing", async () => {
    const points: SampledPoint[] = [{ lat: 1, lng: 1 }];
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(metadataResponse("unused", false))
    );

    const result = await downloadCaptures(points, [0, 90, 180, 270], {
      apiKey: "test-key",
      maxConcurrent: 2,
      existingPanoHeadings: new Set(),
    });

    expect(result.captures).toHaveLength(0);
    expect(result.failedPoints).toBe(1);
  });

  it("retries a 500 once with backoff, then succeeds, and does not double-count it as failed", async () => {
    const points: SampledPoint[] = [{ lat: 1, lng: 1 }];
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(metadataResponse("pano-retry"))
      .mockResolvedValueOnce(imageResponse(0, 500)) // first attempt fails
      .mockResolvedValueOnce(imageResponse(9)); // retry succeeds
    vi.stubGlobal("fetch", fetchMock);

    const result = await downloadCaptures(points, [0], {
      apiKey: "test-key",
      maxConcurrent: 1,
      existingPanoHeadings: new Set(),
      retryBaseDelayMs: 1,
    });

    expect(result.captures).toHaveLength(1);
    expect(result.failedPoints).toBe(0);
  }, 10000);

  it("never issues more than maxConcurrent in-flight point/heading downloads at once", async () => {
    const points: SampledPoint[] = Array.from({ length: 6 }, (_, i) => ({ lat: i, lng: i }));
    let inFlight = 0;
    let maxObservedInFlight = 0;

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        inFlight += 1;
        maxObservedInFlight = Math.max(maxObservedInFlight, inFlight);
        await new Promise((r) => setTimeout(r, 5));
        inFlight -= 1;
        return url.includes("metadata")
          ? metadataResponse("pano-x")
          : imageResponse(1);
      })
    );

    await downloadCaptures(points, [0], {
      apiKey: "test-key",
      maxConcurrent: 2,
      existingPanoHeadings: new Set(),
    });

    expect(maxObservedInFlight).toBeLessThanOrEqual(2);
  }, 10000);
});