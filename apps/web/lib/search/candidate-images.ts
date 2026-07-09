// apps/web/lib/search/candidate-images.ts
import { readFile } from "node:fs/promises";

/** Reads an image file as base64, or null if it is missing. */
export async function readImageBase64(path: string): Promise<string | null> {
  try {
    const bytes = await readFile(path);
    return bytes.toString("base64");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}