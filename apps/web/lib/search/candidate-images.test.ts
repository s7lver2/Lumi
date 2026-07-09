// apps/web/lib/search/candidate-images.test.ts
import { describe, it, expect, afterEach } from "vitest";
import { writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readImageBase64 } from "./candidate-images";

const DIR = join(tmpdir(), "netryx-cand-test");
afterEach(async () => rm(DIR, { recursive: true, force: true }));

describe("readImageBase64", () => {
  it("returns the file contents base64-encoded", async () => {
    await mkdir(DIR, { recursive: true });
    const path = join(DIR, "img.jpg");
    await writeFile(path, Buffer.from([1, 2, 3]));
    expect(await readImageBase64(path)).toBe(Buffer.from([1, 2, 3]).toString("base64"));
  });

  it("returns null when the file does not exist", async () => {
    expect(await readImageBase64(join(DIR, "missing.jpg"))).toBeNull();
  });
});