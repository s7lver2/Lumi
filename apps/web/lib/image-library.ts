import { randomUUID } from "node:crypto";

export interface LibraryImage {
  id: string;
  filename: string;
  bytes: Buffer;
  mimeType: string;
  sizeBytes: number;
  width: number;
  height: number;
  addedAt: number;
  sourceKind: "upload" | "url";
}

/** Per-image cap — closes the door on decompression-bomb-style inputs
 * reaching the in-memory library at all (spec §2.1). */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

/** Library-wide cap. Worst-case memory: MAX_IMAGE_BYTES * MAX_LIBRARY_SIZE
 * = 300MB, acceptable for a single-process, single-user, self-hosted app. */
export const MAX_LIBRARY_SIZE = 30;

// Module-level singleton: the library lives only in this Node process's
// memory and is intentionally wiped on every restart (spec's explicit
// requirement — no disk/DB persistence for this store).
let library = new Map<string, LibraryImage>();

export function addImage(input: {
  bytes: Buffer;
  filename: string;
  mimeType: string;
  width: number;
  height: number;
  sourceKind: "upload" | "url";
}): LibraryImage {
  if (input.bytes.length > MAX_IMAGE_BYTES) {
    throw new Error(`La imagen supera el tamaño máximo permitido (10MB)`);
  }

  const image: LibraryImage = {
    id: randomUUID(),
    filename: input.filename,
    bytes: input.bytes,
    mimeType: input.mimeType,
    sizeBytes: input.bytes.length,
    width: input.width,
    height: input.height,
    addedAt: Date.now(),
    sourceKind: input.sourceKind,
  };

  library.set(image.id, image);

  if (library.size > MAX_LIBRARY_SIZE) {
    const oldest = [...library.values()].sort((a, b) => a.addedAt - b.addedAt)[0];
    library.delete(oldest.id);
  }

  return image;
}

export function getImage(id: string): LibraryImage | undefined {
  return library.get(id);
}

export function listImages(): LibraryImage[] {
  return [...library.values()]
    .reverse()
    .sort((a, b) => b.addedAt - a.addedAt);
}

export function removeImage(id: string): void {
  library.delete(id);
}

/** Used by the crop-save flow (Task 6) — keeps the same id/filename/addedAt
 * so the image doesn't appear to "move" or duplicate in the library grid. */
export function replaceImageBytes(
  id: string,
  bytes: Buffer,
  width: number,
  height: number
): LibraryImage | undefined {
  const existing = library.get(id);
  if (!existing) return undefined;

  const updated: LibraryImage = { ...existing, bytes, width, height, sizeBytes: bytes.length };
  library.set(id, updated);
  return updated;
}

/** Test-only — resets the module-level singleton between test cases. */
export function resetLibraryForTests(): void {
  library = new Map<string, LibraryImage>();
}
