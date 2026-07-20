// apps/web/lib/datasets/parse-manifest-buffer.ts

const OPEN = new Set([0x5b, 0x7b]); // [ {
const CLOSE = new Set([0x5d, 0x7d]); // ] }
const QUOTE = 0x22; // "
const BACKSLASH = 0x5c; // \
const COMMA = 0x2c; // ,
const OPEN_BRACKET = 0x5b; // [

/**
 * Splits a JSON array's elements into raw Buffer slices without ever
 * decoding the array (or the document it lives in) to a JS string — walks
 * bytes directly, tracking bracket/string depth. `buf[openBracketIndex]`
 * must be the array's own `[`. Returns each element as a Buffer slice
 * (exactly the bytes between separating commas) plus the index right
 * after the closing `]`.
 */
function splitTopLevelArrayItems(buf: Buffer, openBracketIndex: number): { items: Buffer[]; endIndex: number } {
  if (buf[openBracketIndex] !== OPEN_BRACKET) {
    throw new Error("splitTopLevelArrayItems: expected '[' at the given index");
  }
  const items: Buffer[] = [];
  let i = openBracketIndex + 1;
  let itemStart = i;
  let depth = 0;
  let inString = false;
  let escaped = false;

  while (i < buf.length) {
    const c = buf[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === BACKSLASH) escaped = true;
      else if (c === QUOTE) inString = false;
      i++;
      continue;
    }
    if (c === QUOTE) {
      inString = true;
      i++;
      continue;
    }
    if (OPEN.has(c)) {
      depth++;
      i++;
      continue;
    }
    if (c === 0x5d /* ] */ && depth === 0) {
      if (i > itemStart) items.push(buf.subarray(itemStart, i));
      return { items, endIndex: i + 1 };
    }
    if (CLOSE.has(c)) {
      depth--;
      i++;
      continue;
    }
    if (c === COMMA && depth === 0) {
      items.push(buf.subarray(itemStart, i));
      i++;
      itemStart = i;
      continue;
    }
    i++;
  }
  throw new Error("splitTopLevelArrayItems: array was never closed");
}

function findAsciiKey(buf: Buffer, key: string, fromIndex = 0): number {
  const idx = buf.indexOf(Buffer.from(key, "utf8"), fromIndex);
  if (idx === -1) throw new Error(`parseManifestBuffer: expected to find ${JSON.stringify(key)} in manifest.json`);
  return idx;
}

/**
 * Parses a dataset manifest.json buffer into the exact same object graph
 * `JSON.parse(buf.toString("utf8"))` would produce, but never materializes
 * the whole document (or even one area's images/points array) as a single
 * JS string. `indexed_images.embedding` is a fixed `vector(8448)` column,
 * so a real area's manifest.json can run into the hundreds of MB — the
 * naive `buf.toString("utf8")` + `JSON.parse()` throws "RangeError: Invalid
 * string length" once the decoded text exceeds V8's ~512M-character string
 * limit (confirmed live installing a real published dataset). Mirrors
 * export-bundle.ts's `serializeManifest`, which avoids the same limit on
 * the write side by never building the whole document as one string
 * either — this is its read-side counterpart. Only ever calls
 * `JSON.parse` on small per-element slices (one image/point at a time,
 * matching the writer's one-entry-at-a-time approach), then reassembles
 * them into a plain object so `validateDatasetManifest` needs no changes.
 */
export function parseManifestBuffer(buf: Buffer): unknown {
  const areasKeyIdx = findAsciiKey(buf, '"areas":[');
  const areasArrayStart = areasKeyIdx + '"areas":['.length - 1;

  const headerText = buf.subarray(0, areasArrayStart + 1).toString("utf8") + "]}";
  const header = JSON.parse(headerText) as Record<string, unknown>;

  const { items: areaBuffers } = splitTopLevelArrayItems(buf, areasArrayStart);

  const areas = areaBuffers.map((areaBuf) => {
    const imagesKeyIdx = findAsciiKey(areaBuf, '"images":[');
    const imagesArrayStart = imagesKeyIdx + '"images":['.length - 1;

    // Everything before "images" is the area's own scalar fields, always
    // ending in a comma the writer inserts right before the "images" key
    // (serializeManifest's template literal always emits `,"images":[`
    // verbatim) — drop that trailing comma before closing the object.
    const restText = areaBuf.subarray(0, imagesKeyIdx - 1).toString("utf8") + "}";
    const rest = JSON.parse(restText) as Record<string, unknown>;

    const { items: imageItems, endIndex: afterImages } = splitTopLevelArrayItems(areaBuf, imagesArrayStart);
    const images = imageItems.map((item) => JSON.parse(item.toString("utf8")));

    const pointsKeyIdx = findAsciiKey(areaBuf, '"points":[', afterImages);
    const pointsArrayStart = pointsKeyIdx + '"points":['.length - 1;
    const { items: pointItems } = splitTopLevelArrayItems(areaBuf, pointsArrayStart);
    const points = pointItems.map((item) => JSON.parse(item.toString("utf8")));

    return { ...rest, images, points };
  });

  return { ...header, areas };
}
