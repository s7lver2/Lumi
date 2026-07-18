import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";

const lookupMock = vi.fn();
vi.mock("node:dns/promises", () => ({ lookup: (...args: any[]) => lookupMock(...args) }));

import { fetchImageUrl } from "./fetch-image-url";

beforeEach(() => {
  lookupMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("fetchImageUrl", () => {
  it("rejects non-http(s) schemes without making any network call", async () => {
    const result = await fetchImageUrl("file:///etc/passwd");

    expect(result).toEqual({ ok: false, reason: "Solo se permiten enlaces http o https" });
  });

  it("rejects a hostname that resolves to a private IP", async () => {
    lookupMock.mockResolvedValue({ address: "10.0.0.5", family: 4 });

    const result = await fetchImageUrl("http://internal.example/photo.jpg");

    expect(result).toEqual({ ok: false, reason: "El enlace apunta a una dirección no permitida" });
  });

  it("rejects a hostname that resolves to the cloud metadata IP", async () => {
    lookupMock.mockResolvedValue({ address: "169.254.169.254", family: 4 });

    const result = await fetchImageUrl("http://metadata.example/photo.jpg");

    expect(result.ok).toBe(false);
  });

  it("downloads bytes for a public IP and stops at the size cap", async () => {
    lookupMock.mockResolvedValue({ address: "93.184.216.34", family: 4 });

    const chunk = new Uint8Array(1024).fill(1);
    const totalChunks = 11 * 1024; // 11MB worth of 1KB chunks, exceeds the 10MB cap
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        body: {
          getReader: () => {
            let sent = 0;
            return {
              read: async () => {
                if (sent >= totalChunks) return { done: true, value: undefined };
                sent++;
                return { done: false, value: chunk };
              },
            };
          },
        },
      } as unknown as Response))
    );

    const result = await fetchImageUrl("http://example.com/photo.jpg");

    expect(result.ok).toBe(false);
  });
});
