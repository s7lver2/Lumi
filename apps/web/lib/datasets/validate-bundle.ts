// apps/web/lib/datasets/validate-bundle.ts

// indexed_images.embedding is a fixed vector(8448) column, so a real area
// with a few thousand images produces a legitimately large dataset bundle
// (confirmed live: a 645MB compressed bundle got rejected by the previous
// 200MB cap). These limits are a safety net against a corrupt/malicious
// release ballooning memory usage during install (the whole bundle is
// buffered in memory — decryptBuffer's Buffer, then JSZip.loadAsync), not a
// hard technical ceiling, so they're sized with headroom above what a
// large-but-legitimate area actually produces today.
export const MAX_BUNDLE_COMPRESSED_BYTES = 2 * 1024 * 1024 * 1024; // 2GB
export const MAX_BUNDLE_DECOMPRESSED_BYTES = 4 * 1024 * 1024 * 1024; // 4GB
export const MAX_BUNDLE_FILE_COUNT = 20000;

export function assertCompressedSizeWithinLimit(byteLength: number): void {
  if (byteLength > MAX_BUNDLE_COMPRESSED_BYTES) {
    throw new Error(`Bundle too large: ${byteLength} bytes exceeds the ${MAX_BUNDLE_COMPRESSED_BYTES}-byte compressed limit`);
  }
}

export function assertFileCountWithinLimit(fileCount: number): void {
  if (fileCount > MAX_BUNDLE_FILE_COUNT) {
    throw new Error(`Bundle has too many files: ${fileCount} exceeds the ${MAX_BUNDLE_FILE_COUNT} limit`);
  }
}

export function assertDecompressedSizeWithinLimit(runningTotalBytes: number): void {
  if (runningTotalBytes > MAX_BUNDLE_DECOMPRESSED_BYTES) {
    throw new Error(`Bundle exceeds the ${MAX_BUNDLE_DECOMPRESSED_BYTES}-byte decompressed limit`);
  }
}

const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff]);

/** Sniffs the actual file content instead of trusting a ".jpg" extension —
 * every capture image in this app is a JPEG (spec's Security section). */
export function isLikelyJpeg(bytes: Buffer): boolean {
  return bytes.length >= 3 && bytes.subarray(0, 3).equals(JPEG_MAGIC);
}
