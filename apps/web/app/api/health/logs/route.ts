import { NextResponse } from "next/server";
import { open } from "node:fs/promises";
import { resolve } from "node:path";

const REPO_ROOT = resolve(process.cwd(), "..", "..");
const ALLOWED_SERVICES = new Set(["worker", "inference"]);
const MAX_LINES = 50;
// Bounds memory/IO regardless of how large data/logs/{tag}.log has grown —
// tools/build.py and tools/templates/lumi_launcher.py's _pump_tagged also
// cap that file's on-disk size, but this endpoint stays bounded on its own
// even against an untruncated or externally-grown file.
const TAIL_BYTES = 8192;

/** Reads only the last TAIL_BYTES of logPath instead of the whole file.
 * Returns whether the read started after byte 0 — if so, the first line
 * of the returned text is likely a partial line cut off mid-way and
 * should be dropped by the caller. */
async function readLogTail(logPath: string): Promise<{ text: string; truncated: boolean }> {
  const handle = await open(logPath, "r");
  try {
    const { size } = await handle.stat();
    const start = Math.max(0, size - TAIL_BYTES);
    const length = size - start;
    const buffer = Buffer.alloc(length);
    if (length > 0) {
      await handle.read(buffer, 0, length, start);
    }
    return { text: buffer.toString("utf8"), truncated: start > 0 };
  } finally {
    await handle.close();
  }
}

export async function GET(request: Request) {
  const service = new URL(request.url).searchParams.get("service");
  if (!service || !ALLOWED_SERVICES.has(service)) {
    return NextResponse.json({ error: "unknown service" }, { status: 400 });
  }

  const logPath = resolve(REPO_ROOT, "data", "logs", `${service}.log`);
  try {
    const { text, truncated } = await readLogTail(logPath);
    const rawLines = text.split("\n");
    if (truncated) {
      rawLines.shift();
    }
    const lines = rawLines.filter((line) => line.length > 0);
    return NextResponse.json({ lines: lines.slice(-MAX_LINES) });
  } catch (err) {
    // Only treat file-not-found as "no lines yet"; propagate other errors as 500
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return NextResponse.json({ lines: [] });
    }
    return NextResponse.json(
      { error: "Failed to read log file" },
      { status: 500 }
    );
  }
}
