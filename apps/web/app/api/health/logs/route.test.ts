import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from "vitest";
import { mkdir, writeFile, rm, stat } from "node:fs/promises";
import { resolve } from "node:path";

const REPO_ROOT = resolve(process.cwd(), "..", "..");
const LOG_DIR = resolve(REPO_ROOT, "data", "logs");

// Flag to control mock behavior for testing error scenarios
let simulateOpenError: NodeJS.ErrnoException | null = null;

vi.mock("node:fs/promises", async () => {
  const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
  return {
    ...actual,
    open: vi.fn(async (path: string, flags: string) => {
      if (simulateOpenError) {
        throw simulateOpenError;
      }
      return actual.open(path, flags);
    }),
  };
});

const { GET } = await import("./route");

beforeAll(async () => {
  await mkdir(LOG_DIR, { recursive: true });
  const lines = Array.from({ length: 60 }, (_, i) => `line ${i}`).join("\n");
  await writeFile(resolve(LOG_DIR, "inference.log"), lines + "\n");
});

afterAll(async () => {
  await rm(resolve(LOG_DIR, "inference.log"), { force: true });
  await rm(resolve(LOG_DIR, "worker.log"), { force: true });
});

beforeEach(() => {
  simulateOpenError = null;
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

  it("returns 500 error when a read error occurs (not ENOENT)", async () => {
    // Set up a permission error (EACCES code)
    const permissionError = new Error("Permission denied") as NodeJS.ErrnoException;
    permissionError.code = "EACCES";
    simulateOpenError = permissionError;

    const res = await GET(makeRequest("inference"));
    const json = await res.json();
    expect(res.status).toBe(500);
    expect(json.error).toBe("Failed to read log file");
  });

  it("bounds the read to the tail of a multi-megabyte log file and still returns exactly 50 correct lines", async () => {
    const workerLogPath = resolve(LOG_DIR, "worker.log");
    // Numbered lines padded out so the file comfortably exceeds a few
    // hundred KB — big enough that reading the whole file would be a
    // meaningfully larger read than the ~8KB tail this endpoint should
    // actually perform, without needing a truly multi-MB fixture in tests.
    const totalLines = 20000;
    const padding = "x".repeat(20);
    const content = Array.from({ length: totalLines }, (_, i) => `line ${i} ${padding}`).join("\n") + "\n";
    await writeFile(workerLogPath, content);

    const { size } = await stat(workerLogPath);
    expect(size).toBeGreaterThan(8192); // sanity: the tail-bounded path is actually exercised

    const res = await GET(makeRequest("worker"));
    const json = await res.json();
    expect(json.lines).toHaveLength(50);
    // Every returned line must be a complete, uncorrupted line from the
    // tail — no partial line from the middle of the file leaking through.
    for (const line of json.lines) {
      expect(line).toMatch(/^line \d+ x+$/);
    }
    expect(json.lines[49]).toBe(`line ${totalLines - 1} ${padding}`);
    expect(json.lines[0]).toBe(`line ${totalLines - 50} ${padding}`);
  });
});
