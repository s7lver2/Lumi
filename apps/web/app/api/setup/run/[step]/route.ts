// apps/web/app/api/setup/run/[step]/route.ts
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { getSettingsRepo } from "../../../../../lib/settings-repo";

// SECURITY BOUNDARY: this endpoint executes shell commands on the host. It is
// only acceptable because the app is self-hosted on a trusted network with no
// auth (spec §7.1, §10.3). Commands are fixed argv arrays keyed by step id —
// never built from request input. Refuses to run once setup is complete unless
// ?rerun=1 is present.
const REPO_ROOT = resolve(process.cwd(), "..", "..");
const INFER = resolve(REPO_ROOT, "services", "inference");
const STEPS: Record<string, { cmd: string; args: string[]; cwd: string }> = {
  migrate: { cmd: "pnpm", args: ["migrate:up"], cwd: resolve(REPO_ROOT, "db") },
  "inference-venv": { cmd: "python", args: ["-m", "venv", "venv"], cwd: INFER },
  "inference-deps": { cmd: resolve(INFER, "venv", "Scripts", "pip.exe"), args: ["install", "-r", "requirements.txt"], cwd: INFER },
  "inference-weights": {
    cmd: resolve(INFER, "venv", "Scripts", "python.exe"),
    args: ["-c", "import torch; torch.hub.load('gmberton/MegaLoc','get_trained_model'); import romatch; romatch.roma_outdoor(device='cpu')"],
    cwd: INFER,
  },
  "weights-retrieval": {
    cmd: resolve(INFER, "venv", "Scripts", "python.exe"),
    args: ["-c", "import torch; torch.hub.load('gmberton/MegaLoc','get_trained_model')"],
    cwd: INFER,
  },
  "weights-verification": {
    cmd: resolve(INFER, "venv", "Scripts", "python.exe"),
    args: ["-c", "import romatch; romatch.roma_outdoor(device='cpu')"],
    cwd: INFER,
  },
};

export async function POST(request: Request, { params }: { params: { step: string } }) {
  const step = STEPS[params.step];
  if (!step) return new Response("unknown step", { status: 404 });

  const rerun = new URL(request.url).searchParams.get("rerun") === "1";
  if (!rerun && (await getSettingsRepo().isSetupCompleted())) {
    return new Response("setup already completed", { status: 403 });
  }

  const stream = new ReadableStream({
    start(controller) {
      const enc = new TextEncoder();
      const send = (e: object) => controller.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`));
      // shell:true so `pnpm`/`python` resolve on Windows (pnpm is pnpm.cmd).
      // argv is fixed data (see security note), so shell use is not an injection vector.
      const child = spawn(step.cmd, step.args, { cwd: step.cwd, shell: true });
      child.stdout.on("data", (d) => send({ type: "log", line: d.toString() }));
      child.stderr.on("data", (d) => send({ type: "log", line: d.toString() }));
      child.on("error", (err) => { send({ type: "log", line: `error: ${err.message}` }); send({ type: "done", code: 1 }); controller.close(); });
      child.on("close", (code) => { send({ type: "done", code: code ?? 0 }); controller.close(); });
    },
  });
  return new Response(stream, {
    headers: { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" },
  });
}