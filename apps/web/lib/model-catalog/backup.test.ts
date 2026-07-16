// apps/web/lib/model-catalog/backup.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { backupInferenceCode, restoreInferenceCode } from "./backup";

let inferenceDir: string;

beforeEach(async () => {
  inferenceDir = await mkdtemp(join(tmpdir(), "lumi-fake-inference-"));
  await writeFile(join(inferenceDir, "main.py"), "version-1");
  await mkdir(join(inferenceDir, "models"));
  await writeFile(join(inferenceDir, "models", "registry.py"), "version-1-registry");
  await mkdir(join(inferenceDir, "venv"));
  await writeFile(join(inferenceDir, "venv", "leave-me-alone.py"), "venv-file");
});

afterEach(async () => {
  await rm(inferenceDir, { recursive: true, force: true });
});

describe("backupInferenceCode / restoreInferenceCode", () => {
  it("backs up all .py files, then a later 'install' overwriting them can be restored", async () => {
    const backupDir = await backupInferenceCode(inferenceDir);

    // Simulate installing a new version by overwriting main.py.
    await writeFile(join(inferenceDir, "main.py"), "version-2");
    await writeFile(join(inferenceDir, "models", "registry.py"), "version-2-registry");

    await restoreInferenceCode(inferenceDir, backupDir);

    expect((await readFile(join(inferenceDir, "main.py"), "utf8"))).toBe("version-1");
    expect((await readFile(join(inferenceDir, "models", "registry.py"), "utf8"))).toBe("version-1-registry");
    // venv/ was never touched by backup/restore at all.
    expect((await readFile(join(inferenceDir, "venv", "leave-me-alone.py"), "utf8"))).toBe("venv-file");
  });
});
