// apps/web/lib/kill-port.ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * Finds and kills whatever process is listening on `port`, regardless of
 * which parent process spawned it (tools/build.py, lumi_launcher.py, or
 * this app's own setup-wizard spawn all use port 8000 for the inference
 * service) — needed because the restart flow (spec's "Apply / restart
 * flow" section) can't assume it has an in-process handle to the running
 * inference process. Resolves true if something was found and killed,
 * false if nothing was listening there.
 */
export async function killProcessOnPort(port: number): Promise<boolean> {
  if (process.platform === "win32") {
    try {
      const { stdout } = await execFileAsync("netstat", ["-ano"]);
      const line = stdout.split("\n").find((l) => l.includes(`:${port} `) && l.includes("LISTENING"));
      if (!line) return false;
      const pid = line.trim().split(/\s+/).pop();
      if (!pid) return false;
      await execFileAsync("taskkill", ["/PID", pid, "/F"]);
      return true;
    } catch {
      return false;
    }
  }

  try {
    const { stdout } = await execFileAsync("lsof", ["-ti", `:${port}`]);
    const pids = stdout.split("\n").map((l) => l.trim()).filter(Boolean);
    if (pids.length === 0) return false;
    for (const pid of pids) {
      await execFileAsync("kill", ["-9", pid]);
    }
    return true;
  } catch {
    return false;
  }
}