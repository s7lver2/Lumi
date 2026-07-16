// apps/web/lib/datasets/validate-bundle.ts

export const MAX_BUNDLE_COMPRESSED_BYTES = 200 * 1024 * 1024; // 200MB
export const MAX_BUNDLE_DECOMPRESSED_BYTES = 1024 * 1024 * 1024; // 1GB
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
