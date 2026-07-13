import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { GET } from "./route";

const REPO_ROOT = resolve(process.cwd(), "..", "..");
const LOG_DIR = resolve(REPO_ROOT, "data", "logs");

beforeAll(async () => {
  await mkdir(LOG_DIR, { recursive: true });
  const lines = Array.from({ length: 60 }, (_, i) => `line ${i}`).join("\n");
  await writeFile(resolve(LOG_DIR, "inference.log"), lines + "\n");
});

afterAll(async () => {
  await rm(resolve(LOG_DIR, "inference.log"), { force: true });
});

function makeRequest(service: string | null) {
  const url = service ? `http://localhost/api/health/logs?service=${service}` : "http://localhost/api/health/logs";
  return new Request(url);
}

describe("GET /api/health/logs", () => {
  it("returns only the last 50 lines of the requested service's log", async () => {
    const res = await GET(makeRequest("inference"));
    const json = await res.json();
    expect(json.lines).toHaveLength(50);
    expect(json.lines[0]).toBe("line 10");
    expect(json.lines[49]).toBe("line 59");
  });

  it("rejects an unrecognized service", async () => {
    const res = await GET(makeRequest("web"));
    expect(res.status).toBe(400);
  });

  it("returns an empty list when the log file doesn't exist yet", async () => {
    const res = await GET(makeRequest("worker"));
    const json = await res.json();
    expect(json.lines).toEqual([]);
  });
});
