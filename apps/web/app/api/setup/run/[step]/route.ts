// apps/web/app/api/setup/run/[step]/route.ts
import { spawn } from "node:child_process";
import { resolve } from "node:path";

// SECURITY: executes shell commands. Only for the self-hosted, trusted-network
// setup flow with no auth (spec §7.1, §10.3). Commands are fixed argv arrays —
// never built from request input.
const REPO_ROOT = resolve(process.cwd(), "..", "..");
const STEPS: Record<string, { cmd: string; args: string[]; cwd: string }> = {
  migrate: { cmd: "pnpm", args: ["migrate:up"], cwd: resolve(REPO_ROOT, "db") },
  "inference-venv": { cmd: "python", args: ["-m", "venv", "venv"], cwd: resolve(REPO_ROOT, "services", "inference") },
  "inference-deps": { cmd: resolve(REPO_ROOT, "services", "inference", "venv", "Scripts", "pip.exe"), args: ["install", "-r", "requirements.txt"], cwd: resolve(REPO_ROOT, "services", "inference") },
  "inference-weights": { cmd: resolve(REPO_ROOT, "services", "inference", "venv", "Scripts", "python.exe"), args: ["-c", "import torch; torch.hub.load('gmberton/MegaLoc','get_trained_model'); import romatch; romatch.roma_outdoor(device='cpu')"], cwd: resolve(REPO_ROOT, "services", "inference") },
};

export async function POST(_req: Request, { params }: { params: { step: string } }) {
  const step = STEPS[params.step];
  if (!step) return new Response("unknown step", { status: 404 });

  const stream = new ReadableStream({
    start(controller) {
      const enc = new TextEncoder();
      const send = (e: object) => controller.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`));
      const child = spawn(step.cmd, step.args, { cwd: step.cwd, shell: false });
      child.stdout.on("data", (d) => send({ type: "log", line: d.toString() }));
      child.stderr.on("data", (d) => send({ type: "log", line: d.toString() }));
      child.on("error", (err) => { send({ type: "log", line: `error: ${err.message}` }); send({ type: "done", code: 1 }); controller.close(); });
      child.on("close", (code) => { send({ type: "done", code: code ?? 0 }); controller.close(); });
    },
  });
  return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" } });
}