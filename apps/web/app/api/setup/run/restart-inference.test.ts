// apps/web/app/api/setup/run/restart-inference.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../../lib/settings-repo", () => ({
  getSettingsRepo: vi.fn(() => ({ getSetting: vi.fn().mockResolvedValue("linux"), isSetupCompleted: vi.fn().mockResolvedValue(true) })),
}));
vi.mock("../../../../lib/kill-port", () => ({ killProcessOnPort: vi.fn().mockResolvedValue(true) }));
vi.mock("node:child_process", () => ({
  spawn: vi.fn(() => ({ unref: vi.fn(), exitCode: null, kill: vi.fn() })),
}));
// inferenceArgvFor() in [step]/route.ts gates on existsSync(venv dir). Mock it
// so this test is deterministic regardless of whether services/inference/venv
// actually exists on the machine running the suite (it's gitignored, so a
// fresh clone/CI has no venv and would otherwise make the handler bail out).
vi.mock("node:fs", () => ({ existsSync: vi.fn(() => true) }));

async function readAllEvents(res: Response): Promise<Array<Record<string, unknown>>> {
  const text = await res.text();
  return text
    .split("\n\n")
    .filter((chunk) => chunk.startsWith("data: "))
    .map((chunk) => JSON.parse(chunk.slice("data: ".length)));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
});

describe("POST /api/setup/run/restart-inference", () => {
  it("kills whatever is on port 8000, respawns inference, and reports readiness", async () => {
    const { killProcessOnPort } = await import("../../../../lib/kill-port");
    const { existsSync } = await import("node:fs");
    const { POST } = await import("./[step]/route");

    const res = await POST(new Request("http://localhost/api/setup/run/restart-inference", { method: "POST" }), {
      params: { step: "restart-inference" },
    });
    const events = await readAllEvents(res);

    expect(killProcessOnPort).toHaveBeenCalledWith(8000);
    expect(events.some((e) => e.type === "log" && String(e.line).includes("Deteniendo"))).toBe(true);
    expect(events[events.length - 1]).toEqual({ type: "done", code: 0 });
    // Proves the mock (not a leftover venv/ on disk) is what makes the "done"
    // assertion above pass: inferenceArgvFor() calls existsSync(.../venv), and
    // without this mock the outcome would depend on the filesystem.
    expect(existsSync).toHaveBeenCalledWith(expect.stringContaining("venv"));
  });
});
