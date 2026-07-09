// apps/web/lib/query-image-store.ts
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** Directory query images are written to; overridable so tests don't touch ./data. */
function queryImageDir(): string {
  return process.env.QUERY_IMAGE_DIR ?? join(process.cwd(), "data", "queries");
}

/** Persists a query image and returns the absolute path it was written to. */
export async function saveQueryImage(
  searchId: string,
  bytes: Buffer,
  ext: string
): Promise<string> {
  const dir = queryImageDir();
  await mkdir(dir, { recursive: true });
  const path = join(dir, `${searchId}.${ext}`);
  await writeFile(path, bytes);
  return path;
}