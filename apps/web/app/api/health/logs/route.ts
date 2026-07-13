import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const REPO_ROOT = resolve(process.cwd(), "..", "..");
const ALLOWED_SERVICES = new Set(["worker", "inference"]);
const MAX_LINES = 50;

export async function GET(request: Request) {
  const service = new URL(request.url).searchParams.get("service");
  if (!service || !ALLOWED_SERVICES.has(service)) {
    return NextResponse.json({ error: "unknown service" }, { status: 400 });
  }

  const logPath = resolve(REPO_ROOT, "data", "logs", `${service}.log`);
  try {
    const content = await readFile(logPath, "utf8");
    const lines = content.split("\n").filter((line) => line.length > 0);
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
