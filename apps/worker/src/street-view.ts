// apps/worker/src/street-view.ts
import pLimit from "p-limit";
import type { SampledPoint, StreetViewCapture } from "@netryx/shared-types";

const METADATA_ENDPOINT = "https://maps.googleapis.com/maps/api/streetview/metadata";
const STATIC_ENDPOINT = "https://maps.googleapis.com/maps/api/streetview";

export interface DownloadOptions {
  apiKey: string;
  maxConcurrent: number;
  /** Set of `${panoId}:${heading}` pairs already in indexed_images — skip these (spec §4 step 4, §6.2). */
  existingPanoHeadings: Set<string>;
  retries?: number;
  retryBaseDelayMs?: number;
}

export interface DownloadResult {
  captures: StreetViewCapture[];
  /** Points where every heading came back with no Street View coverage. */
  failedPoints: number;
}

async function withRetry<T>(
  fn: () => Promise<T>,
  retries: number,
  baseDelayMs: number
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, baseDelayMs * 2 ** attempt));
      }
    }
  }
  throw lastError;
}

async function fetchMetadata(
  point: SampledPoint,
  heading: number,
  apiKey: string
): Promise<{ panoId: string; date: string | null } | null> {
  const url = `${METADATA_ENDPOINT}?location=${point.lat},${point.lng}&heading=${heading}&key=${apiKey}`;
  const res = await fetch(url);
  
  if (!res.ok) {
    throw new Error(`Street View Metadata API returned status ${res.status}`);
  }
  
  const body = (await res.json()) as { status: string; pano_id?: string; date?: string };
  if (body.status !== "OK" || !body.pano_id) return null;
  return { panoId: body.pano_id, date: body.date ?? null };
}

async function fetchImage(
  panoId: string,
  heading: number,
  apiKey: string,
  retries: number,
  retryBaseDelayMs: number
): Promise<string> {
  return withRetry(
    async () => {
      const url = `${STATIC_ENDPOINT}?pano=${panoId}&heading=${heading}&size=640x640&key=${apiKey}`;
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(`Street View Static API returned ${res.status} for pano ${panoId}`);
      }
      const buf = await res.arrayBuffer();
      return Buffer.from(buf).toString("base64");
    },
    retries,
    retryBaseDelayMs
  );
}

/**
 * Downloads Street View captures for every point × heading pair, deduping
 * against already-indexed pano/heading pairs and respecting a concurrency
 * cap (spec §4, §6.2, §12.2 MAX_CONCURRENT_REQUESTS). Concurrency limiting
 * is applied cleanly at the point-level to prevent p-limit deadlocks.
 */
export async function downloadCaptures(
  points: SampledPoint[],
  headings: readonly number[],
  options: DownloadOptions
): Promise<DownloadResult> {
  const limit = pLimit(options.maxConcurrent);
  const retries = options.retries ?? 1;
  const retryBaseDelayMs = options.retryBaseDelayMs ?? 200;
  const seenThisRun = new Set(options.existingPanoHeadings);

  const perPointResults = await Promise.all(
    points.map((point) =>
      limit(async () => {
        const captures: StreetViewCapture[] = [];
        let anyCoverage = false;

        for (const heading of headings) {
          // FIX: El limit() interno ha sido removido. Ahora llamamos directamente usando la estrategia de reintentos.
          const meta = await withRetry(
            () => fetchMetadata(point, heading, options.apiKey),
            retries,
            retryBaseDelayMs
          ).catch(() => null); // Si tras los reintentos falla por completo, tratamos como sin cobertura en este heading

          if (!meta) continue;
          anyCoverage = true;

          const dedupeKey = `${meta.panoId}:${heading}`;
          if (seenThisRun.has(dedupeKey)) continue;
          seenThisRun.add(dedupeKey);

          const imageBase64 = await fetchImage(
            meta.panoId,
            heading,
            options.apiKey,
            retries,
            retryBaseDelayMs
          );

          captures.push({
            panoId: meta.panoId,
            heading,
            lat: point.lat,
            lng: point.lng,
            captureDate: meta.date,
            imageBase64,
          });
        }

        return { captures, failed: !anyCoverage };
      })
    )
  );

  const captures = perPointResults.flatMap((r) => r.captures);
  const failedPoints = perPointResults.filter((r) => r.failed).length;

  return { captures, failedPoints };
}