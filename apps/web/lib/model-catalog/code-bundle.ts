// apps/web/lib/model-catalog/code-bundle.ts
import { readdir, readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import JSZip from "jszip";

const EXCLUDED_DIRS = new Set(["venv", "data", "__pycache__", ".pytest_cache"]);

async function collectFiles(dir: string, root: string, out: string[]): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (EXCLUDED_DIRS.has(entry.name)) continue;
      await collectFiles(join(dir, entry.name), root, out);
      continue;
    }
    if (entry.name.endsWith(".py") || entry.name === "requirements.txt") {
      out.push(join(dir, entry.name));
    }
  }
}

/**
 * Zips services/inference's own wrapper code (spec's "Catalog manifest +
 * publish flow" section) — every .py file plus requirements.txt, never
 * venv/ (the installed dependencies themselves) or data/ (model weight
 * caches, indexed images) which are either huge, machine-specific, or
 * both.
 */
export async function buildInferenceCodeZip(inferenceDir: string): Promise<Uint8Array> {
  const filePaths: string[] = [];
  await collectFiles(inferenceDir, inferenceDir, filePaths);

  const zip = new JSZip();
  for (const filePath of filePaths) {
    const relPath = relative(inferenceDir, filePath).split(sep).join("/");
    zip.file(relPath, await readFile(filePath));
  }
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}
