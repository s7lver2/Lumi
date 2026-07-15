// apps/web/lib/kill-port.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const execFileMock = vi.fn();
vi.mock("node:child_process", () => ({ execFile: (...args: any[]) => execFileMock(...args) }));

beforeEach(() => {
  execFileMock.mockReset();
});

function mockExecFileOnce(stdout: string) {
  execFileMock.mockImplementationOnce((_cmd: string, _args: string[], cb: (err: unknown, res: { stdout: string; stderr: string }) => void) => {
    cb(null, { stdout, stderr: "" });
  });
}

describe("killProcessOnPort (non-Windows path)", () => {
  it("kills every pid lsof returns for the port and resolves true", async () => {
    vi.stubGlobal("process", { ...process, platform: "linux" });
    mockExecFileOnce("1234\n5678\n"); // lsof -ti :8000
    mockExecFileOnce(""); // kill -9 1234
    mockExecFileOnce(""); // kill -9 5678

    const { killProcessOnPort } = await import("./kill-port");
    const result = await killProcessOnPort(8000);

    expect(result).toBe(true);
    expect(execFileMock).toHaveBeenCalledTimes(3);
    expect(execFileMock.mock.calls[0][0]).toBe("lsof");
    expect(execFileMock.mock.calls[1]).toEqual(expect.arrayContaining(["kill"]));
  });

  it("resolves false when nothing is listening on the port", async () => {
    vi.stubGlobal("process", { ...process, platform: "linux" });
    execFileMock.mockImplementationOnce((_cmd: string, _args: string[], cb: (err: unknown) => void) => {
      cb(new Error("lsof: no process found"));
    });

    const { killProcessOnPort } = await import("./kill-port");
    expect(await killProcessOnPort(8000)).toBe(false);
  });
});