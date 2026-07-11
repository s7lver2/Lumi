// packages/geo-sampling/src/overpass.test.ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchStreetGeometry } from "./overpass";

afterEach(() => {
  vi.unstubAllGlobals();
});

const SAMPLE_RESPONSE = {
  elements: [
    {
      type: "way",
      id: 1,
      tags: { highway: "residential" },
      geometry: [
        { lat: 37.7749, lon: -122.4194 },
        { lat: 37.7755, lon: -122.4194 },
        { lat: 37.776, lon: -122.419 },
      ],
    },
    {
      type: "node", // non-way elements must be ignored
      id: 2,
      lat: 37.775,
      lon: -122.419,
    },
  ],
};

describe("fetchStreetGeometry", () => {
  it("POSTs an Overpass QL query built from the polygon and returns LineStrings in [lng, lat] order", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => SAMPLE_RESPONSE,
    });
    vi.stubGlobal("fetch", fetchMock);

    const polygon: [number, number][] = [
      [-122.42, 37.774],
      [-122.418, 37.774],
      [-122.418, 37.777],
      [-122.42, 37.777],
      [-122.42, 37.774],
    ];

    const lines = await fetchStreetGeometry(polygon);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://overpass-api.de/api/interpreter");
    expect(init.method).toBe("POST");
    expect(init.body).toContain("highway");
    expect(init.body).toContain("37.774"); // polygon coords made it into the query

    expect(lines).toHaveLength(1);
    expect(lines[0].type).toBe("LineString");
    expect(lines[0].coordinates[0]).toEqual([-122.4194, 37.7749]);
  });

  it("throws a clear error when Overpass responds with a persistent non-OK status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 504, json: async () => ({}) })
    );

    await expect(
      fetchStreetGeometry([[0, 0], [0, 1], [1, 1], [1, 0], [0, 0]], { retryBaseDelayMs: 1 })
    ).rejects.toThrow(/Overpass request failed \(504\)/);
  });

  it("retries once on a transient 504 and succeeds on the next attempt", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 504, json: async () => ({}) })
      .mockResolvedValueOnce({ ok: true, json: async () => SAMPLE_RESPONSE });
    vi.stubGlobal("fetch", fetchMock);

    const lines = await fetchStreetGeometry(
      [[0, 0], [0, 1], [1, 1], [1, 0], [0, 0]],
      { retryBaseDelayMs: 1 }
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(lines).toHaveLength(1);
  });

  it("does not retry a non-retryable status (e.g. a bad request)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 400, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchStreetGeometry([[0, 0], [0, 1], [1, 1], [1, 0], [0, 0]], { retryBaseDelayMs: 1 })
    ).rejects.toThrow(/Overpass request failed \(400\)/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries on a 429 (Overpass rate limit) and succeeds on the next attempt", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 429, headers: new Map(), json: async () => ({}) })
      .mockResolvedValueOnce({ ok: true, headers: new Map(), json: async () => SAMPLE_RESPONSE });
    vi.stubGlobal("fetch", fetchMock);

    const lines = await fetchStreetGeometry(
      [[0, 0], [0, 1], [1, 1], [1, 0], [0, 0]],
      { retryBaseDelayMs: 1 }
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(lines).toHaveLength(1);
  });

  it("waits for the Retry-After duration (seconds) on a 429 instead of the default backoff", async () => {
    vi.useFakeTimers();
    const headers = { get: (name: string) => (name.toLowerCase() === "retry-after" ? "2" : null) };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 429, headers, json: async () => ({}) })
      .mockResolvedValueOnce({ ok: true, headers: { get: () => null }, json: async () => SAMPLE_RESPONSE });
    vi.stubGlobal("fetch", fetchMock);

    const promise = fetchStreetGeometry([[0, 0], [0, 1], [1, 1], [1, 0], [0, 0]], { retryBaseDelayMs: 1 });

    await vi.advanceTimersByTimeAsync(1900);
    expect(fetchMock).toHaveBeenCalledTimes(1); // hasn't waited the full 2s yet

    await vi.advanceTimersByTimeAsync(200);
    await promise;
    expect(fetchMock).toHaveBeenCalledTimes(2);

    vi.useRealTimers();
  });
});