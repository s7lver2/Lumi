// apps/web/lib/datasets/validate-bundle.test.ts
import { describe, it, expect } from "vitest";
import {
  assertCompressedSizeWithinLimit,
  assertFileCountWithinLimit,
  assertDecompressedSizeWithinLimit,
  isLikelyJpeg,
  MAX_BUNDLE_COMPRESSED_BYTES,
  MAX_BUNDLE_DECOMPRESSED_BYTES,
  MAX_BUNDLE_FILE_COUNT,
} from "./validate-bundle";

describe("assertCompressedSizeWithinLimit", () => {
  it("passes under the limit and throws over it", () => {
    expect(() => assertCompressedSizeWithinLimit(1024)).not.toThrow();
    expect(() => assertCompressedSizeWithinLimit(MAX_BUNDLE_COMPRESSED_BYTES + 1)).toThrow(/too large/);
  });
});

describe("assertFileCountWithinLimit", () => {
  it("passes under the limit and throws over it", () => {
    expect(() => assertFileCountWithinLimit(10)).not.toThrow();
    expect(() => assertFileCountWithinLimit(MAX_BUNDLE_FILE_COUNT + 1)).toThrow(/too many files/);
  });
});

describe("assertDecompressedSizeWithinLimit", () => {
  it("passes under the limit and throws over it", () => {
    expect(() => assertDecompressedSizeWithinLimit(1024)).not.toThrow();
    expect(() => assertDecompressedSizeWithinLimit(MAX_BUNDLE_DECOMPRESSED_BYTES + 1)).toThrow(/decompressed limit/);
  });
});

describe("isLikelyJpeg", () => {
  it("is true for bytes starting with the JPEG magic number", () => {
    expect(isLikelyJpeg(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]))).toBe(true);
  });

  it("is false for non-JPEG bytes, including a disguised .jpg extension", () => {
    expect(isLikelyJpeg(Buffer.from("<html><body>not a jpeg</body></html>"))).toBe(false);
    expect(isLikelyJpeg(Buffer.from([]))).toBe(false);
  });
});
