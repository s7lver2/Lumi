import { describe, it, expect, afterEach } from "vitest";
import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { captureImagePath, saveCaptureImage } from "./image-store";

const DIR = join(tmpdir(), "netryx-sv-test");
afterEach(async () => {
  await rm(DIR, { recursive: true, force: true });
});

describe("image-store", () => {
  it("derives a deterministic path from pano id + heading", () => {
    process.env.STREET_VIEW_IMAGE_DIR = DIR;
    expect(captureImagePath("pano-a", 90)).toBe(join(DIR, "pano-a_90.jpg"));
  });

  it("writes decoded bytes to that path and returns it", async () => {
    process.env.STREET_VIEW_IMAGE_DIR = DIR;
    const base64 = Buffer.from([9, 8, 7]).toString("base64");
    const path = await saveCaptureImage("pano-b", 0, base64);
    expect(path).toBe(join(DIR, "pano-b_0.jpg"));
    expect(await readFile(path)).toEqual(Buffer.from([9, 8, 7]));
  });
});