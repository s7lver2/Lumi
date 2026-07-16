// apps/web/lib/model-catalog/code-bundle.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import JSZip from "jszip";
import { buildInferenceCodeZip } from "./code-bundle";

let fakeInferenceDir: string;

beforeAll(async () => {
  fakeInferenceDir = await mkdtemp(join(tmpdir(), "lumi-fake-inference-"));
  await writeFile(join(fakeInferenceDir, "main.py"), "print('hello')");
  await writeFile(join(fakeInferenceDir, "requirements.txt"), "torch==2.0.0");
  await mkdir(join(fakeInferenceDir, "models"));
  await writeFile(join(fakeInferenceDir, "models", "registry.py"), "RETRIEVAL_MODELS = []");
  await mkdir(join(fakeInferenceDir, "venv"));
  await writeFile(join(fakeInferenceDir, "venv", "should-not-be-included.py"), "x = 1");
  await mkdir(join(fakeInferenceDir, "data"));
  await writeFile(join(fakeInferenceDir, "data", "should-not-be-included.bin"), "x");
});

afterAll(async () => {
  await rm(fakeInferenceDir, { recursive: true, force: true });
});

describe("buildInferenceCodeZip", () => {
  it("includes .py files and requirements.txt, excludes venv/ and data/", async () => {
    const zipBytes = await buildInferenceCodeZip(fakeInferenceDir);
    const zip = await JSZip.loadAsync(zipBytes);
    const names = Object.keys(zip.files);

    expect(names).toContain("main.py");
    expect(names).toContain("requirements.txt");
    expect(names).toContain("models/registry.py");
    expect(names.some((n) => n.includes("venv"))).toBe(false);
    expect(names.some((n) => n.includes("data"))).toBe(false);
  });
});
