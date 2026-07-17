import sharp from "sharp";

const ALLOWED_FORMATS = new Set(["jpeg", "png", "webp", "gif", "avif"]);

export type ImageValidationResult =
  | { ok: true; width: number; height: number; format: "jpeg" | "png" | "webp" | "gif" | "avif" }
  | { ok: false; reason: string };

/**
 * Decodes `bytes` with sharp to confirm they are a real, safely-sized
 * image — never trust a client-reported MIME type or file extension,
 * both are trivially spoofable. `limitInputPixels` uses sharp's own
 * conservative default (~16384x16384) to reject decompression-bomb-style
 * inputs before they're fully decoded into memory.
 */
export async function validateImageBytes(bytes: Buffer): Promise<ImageValidationResult> {
  if (bytes.length === 0) {
    return { ok: false, reason: "El archivo está vacío" };
  }

  try {
    const metadata = await sharp(bytes, { limitInputPixels: 268402689 }).metadata();
    if (!metadata.format || !ALLOWED_FORMATS.has(metadata.format) || !metadata.width || !metadata.height) {
      return { ok: false, reason: "Formato de imagen no permitido" };
    }
    return {
      ok: true,
      width: metadata.width,
      height: metadata.height,
      format: metadata.format as "jpeg" | "png" | "webp" | "gif" | "avif",
    };
  } catch {
    return { ok: false, reason: "No se pudo decodificar la imagen" };
  }
}
