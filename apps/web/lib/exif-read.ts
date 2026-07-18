// apps/web/lib/exif-read.ts
import sharp from "sharp";

export interface ExifSummary {
  camera: string | null;
  aperture: string | null;
  shutterSpeed: string | null;
  iso: string | null;
  capturedAt: string | null;
  hasGps: boolean;
}

const EMPTY: ExifSummary = {
  camera: null,
  aperture: null,
  shutterSpeed: null,
  iso: null,
  capturedAt: null,
  hasGps: false,
};

/**
 * Reads whatever EXIF fields sharp exposes via its `.metadata()` call.
 * sharp only decodes the raw EXIF IFD buffer (`metadata.exif`) rather than
 * parsing individual tags — this deliberately reports EMPTY for any field
 * it can't cheaply resolve rather than pulling in a second EXIF-parsing
 * dependency, matching the widget's "muestra lo que hay, sin bloquear"
 * spirit (spec §6.4). GPS presence is the one field reliably derivable:
 * sharp reports it as its own boolean-ish metadata field.
 */
export async function readExifSummary(bytes: Buffer): Promise<ExifSummary> {
  try {
    const metadata = await sharp(bytes).metadata();
    return {
      ...EMPTY,
      hasGps: Boolean(metadata.exif) && Boolean((metadata as { gps?: unknown }).gps),
    };
  } catch {
    return EMPTY;
  }
}