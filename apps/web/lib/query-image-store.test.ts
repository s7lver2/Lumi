// apps/web/lib/query-image-store.test.ts
import { describe, it, expect, afterEach } from "vitest";
import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { saveQueryImage } from "./query-image-store";

const DIR = join(tmpdir(), "netryx-query-test");

afterEach(async () => {
  await rm(DIR, { recursive: true, force: true });
});

describe("saveQueryImage", () => {
  it("writes the bytes to <QUERY_IMAGE_DIR>/<searchId>.<ext> and returns that path", async () => {
    process.env.QUERY_IMAGE_DIR = DIR;
    const bytes = Buffer.from([1, 2, 3, 4]);
    const path = await saveQueryImage("search-123", bytes, "jpg");
    expect(path).toBe(join(DIR, "search-123.jpg"));
    expect(await readFile(path)).toEqual(bytes);
  });
});