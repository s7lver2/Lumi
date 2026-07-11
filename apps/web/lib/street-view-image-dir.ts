// apps/web/lib/street-view-image-dir.ts
import { resolve } from "node:path";

/**
 * Mirrors apps/worker/src/image-store.ts's imageDir() default EXACTLY, so
 * apps/web writes/reads capture image files from the same physical
 * directory the worker uses — critical for area import/export, since
 * indexed_images.image_path is an ABSOLUTE path written by whichever
 * process saved the file, and there's no other synchronization between the
 * two processes' idea of "where images live" besides this shared env var.
 * If STREET_VIEW_IMAGE_DIR isn't set (.env ships it commented out), the
 * worker's own default resolves relative to ITS OWN process.cwd()
 * (apps/worker, since `pnpm --filter @netryx/worker start` sets cwd there),
 * i.e. "<repo_root>/apps/worker/data/street-view" — NOT apps/web's own cwd.
 * Replicating that exact path (not apps/web's cwd) here is required for
 * imported images to actually land where the worker (and its own dedup
 * checks) will look for them on a fresh clone with no override.
 */
export function streetViewImageDir(): string {
  if (process.env.STREET_VIEW_IMAGE_DIR) return process.env.STREET_VIEW_IMAGE_DIR;
  const repoRoot = resolve(process.cwd(), "..", "..");
  return resolve(repoRoot, "apps", "worker", "data", "street-view");
}

export function captureImagePath(panoId: string, heading: number): string {
  return resolve(streetViewImageDir(), `${panoId}_${heading}.jpg`);
}
