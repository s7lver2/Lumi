// apps/web/lib/runtime-marker.test.ts
import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeRuntimeMarker } from "./runtime-marker";

describe("writeRuntimeMarker", () => {
  let dir: string | undefined;
  afterEach(async () => { if (dir) await rm(dir, { recursive: true, force: true }); });

  it("writes {\"inferenceRuntime\": <value>} to data/runtime-config.json under repoRoot", async () => {
    dir = await mkdtemp(join(tmpdir(), "lumi-runtime-marker-"));
    await writeRuntimeMarker("wsl", dir);
    const written = JSON.parse(await readFile(join(dir, "data", "runtime-config.json"), "utf8"));
    expect(written).toEqual({ inferenceRuntime: "wsl" });
  });

  it("creates the data/ directory if it doesn't exist yet", async () => {
    dir = await mkdtemp(join(tmpdir(), "lumi-runtime-marker-"));
    // dir/data does not exist yet — writeRuntimeMarker must create it.
    await writeRuntimeMarker("windows", dir);
    const written = JSON.parse(await readFile(join(dir, "data", "runtime-config.json"), "utf8"));
    expect(written).toEqual({ inferenceRuntime: "windows" });
  });
});