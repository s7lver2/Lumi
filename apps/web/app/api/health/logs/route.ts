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
  } catch {
    return NextResponse.json({ lines: [] });
  }
}
