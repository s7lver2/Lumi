// apps/web/app/api/setup/run/[step]/route.ts
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { getSettingsRepo } from "../../../../../lib/settings-repo";
import { killProcessOnPort } from "../../../../../lib/kill-port";
import { winPathToWsl } from "../../../../lib/wsl-path";

// SECURITY BOUNDARY: this endpoint executes shell commands on the host. It is
// only acceptable because the app is self-hosted on a trusted network with no
// auth (spec §7.1, §10.3). Commands are fixed argv arrays keyed by step id —
// never built from request input.
// The setup wizard always passes ?rerun=1 (setup is re-runnable from Settings),
// so the completed-guard only blocks stray external callers, not the wizard.
const REPO_ROOT = resolve(process.cwd(), "..", "..");
const INFER = resolve(REPO_ROOT, "services", "inference");
// winPathToWsl() throws on anything that isn't a Windows drive-letter path
// (see wsl-path.ts) — only ever call it when the host itself is Windows.
// The *-wsl steps below (and inferenceArgvFor's "wsl" branch) are the only
// consumers, and both only make sense on a Windows host in the first place.
const IS_WIN = process.platform === "win32";
const INFER_WSL = IS_WIN ? winPathToWsl(INFER) : "";

// Native (non-WSL) venv layout differs by host: Windows venvs put
// executables under venv/Scripts/*.exe, everything else (Linux, incl.
// Pop!_OS) under venv/bin/*. This is the one thing distinguishing
// runtime "windows" from runtime "linux" — both are otherwise the same
// "install directly on this host" path, just resolved per sys.platform
// like tools/templates/lumi_launcher.py's inference_command() does.
function venvBin(venvDir: string): string {
  return resolve(venvDir, IS_WIN ? "Scripts" : "bin");
}
function venvPython(venvDir: string): string {
  return resolve(venvBin(venvDir), IS_WIN ? "python.exe" : "python");
}
function venvPip(venvDir: string): string {
  return resolve(venvBin(venvDir), IS_WIN ? "pip.exe" : "pip");
}

// Runs `<script>` inside the default WSL2 distro via `bash -lc`. MUST be
// spawned with shell:false: with shell:true, Windows wraps the whole
// invocation in cmd.exe, and cmd.exe treats the `&&` INSIDE this script
// string as its own separator — splitting the command so the second half
// (e.g. "python3 -m venv ...") runs directly on Windows instead of inside
// WSL. Confirmed live: "'python3' no se reconoce como un comando..." is
// literally cmd.exe's own error, meaning the command never reached WSL.
function wslStep(script: string): { cmd: string; args: string[]; cwd: string; shell: boolean } {
  return { cmd: "wsl.exe", args: ["--", "bash", "-lc", script], cwd: INFER, shell: false };
}

// pip's own download/wheel-build cache (~/.cache/pip) lives in the WSL
// distro's home dir by default — which is on its ext4.vhdx virtual disk on
// C:, NOT on the /mnt/<drive> mount, regardless of where the venv itself is
// created. For a ~2.5GB torch install this is exactly the "the WSL venv is
// eating my C: drive" symptom, even though venv-wsl itself correctly lives
// under the project on the mounted drive. Redirecting PIP_CACHE_DIR next to
// the venv keeps the whole install on the same drive as the project.
function wslPipCacheExport(): string {
  return `export PIP_CACHE_DIR='${INFER_WSL}/.pip-cache-wsl' && `;
}

const STEPS: Record<string, { cmd: string; args: string[]; cwd: string; shell?: boolean; env?: NodeJS.ProcessEnv }> = {
  migrate: { cmd: "pnpm", args: ["migrate:up"], cwd: resolve(REPO_ROOT, "db") },
  // "python" on Windows; Debian/Ubuntu-based distros (Pop!_OS included) only
  // guarantee "python3" on PATH unless python-is-python3 is installed.
  "inference-venv": { cmd: IS_WIN ? "python" : "python3", args: ["-m", "venv", "venv"], cwd: INFER },
  "inference-deps": {
    cmd: venvPip(resolve(INFER, "venv")),
    args: ["install", "-r", "requirements.txt"],
    cwd: INFER,
    // pip's own wheel cache defaults to %LocalAppData%, not next to the
    // project — for a ~2.5GB torch install that's real space on whatever
    // drive Windows itself lives on. Keep it beside the venv instead.
    env: { ...process.env, PIP_CACHE_DIR: resolve(INFER, ".pip-cache") },
  },
};

// WSL2 variants (opt-in, spec: setup lets you choose where inference deps
// are installed) — same repo checkout, just entered via `wsl.exe` instead
// of the Windows shell. `requirements.txt`'s --extra-index-url hosts both
// platforms' wheels, so pip resolves the Linux cu121 build automatically
// when run from inside WSL. Requires WSL2 to already exist on the host
// (checked, not installed, by /api/setup/prereqs).
//
// Only registered when IS_WIN: wslCacheExport()/wslPipCacheExport() call
// winPathToWsl(), which throws on anything that isn't a Windows drive-letter
// path (see wsl-path.ts) — MODELS_CACHE_DIR/INFER are POSIX paths on Linux,
// so building these entries unconditionally (they used to sit directly in
// the STEPS object literal) crashed the whole module — and therefore every
// step, WSL or not — the moment a Linux host imported this route. Confirmed
// live: "Not an absolute Windows path: /home/.../data/models-cache" on a
// plain POST to /api/setup/run/inference-venv.
//
// "sudo -n" (non-interactive) is used on purpose: this pipe has no way to
// prompt for or forward a sudo password, so if the distro's user needs one,
// this fails fast with a clear "sudo: a password is required" in the
// console instead of hanging forever waiting for input that can never
// arrive. If that happens, run `sudo visudo` once inside WSL to allow
// passwordless apt for this user, or just install python3-venv manually.
//
// No DEBIAN_FRONTEND=noninteractive prefix — confirmed live: default
// sudoers policy rejects passing THROUGH arbitrary env vars ("sudo: sorry,
// you are not allowed to set the following environment variables:
// DEBIAN_FRONTEND"), even under `sudo -n`. `-y` alone is enough for these
// packages (no debconf prompts to suppress).
if (IS_WIN) {
  STEPS["inference-wsl-prereqs"] = wslStep(
    "sudo -n apt-get update && sudo -n apt-get install -y python3 python3-venv python3-pip"
  );
  STEPS["inference-venv-wsl"] = wslStep(`cd '${INFER_WSL}' && python3 -m venv venv-wsl`);
  STEPS["inference-deps-wsl"] = wslStep(`${wslPipCacheExport()}cd '${INFER_WSL}' && venv-wsl/bin/pip install -r requirements.txt`);
}

// "verify-services" is not a fixed-argv one-shot command like everything in
// STEPS above — it starts the inference service + worker as DETACHED
// background processes (they must survive after this request's stream
// closes) and polls the inference service's existing /docs reachability
// probe (see apps/web/app/api/setup/prereqs/route.ts) instead of waiting for
// a `close` event that would never come from a long-running server.
// Module-scope so re-running this step (e.g. the wizard's retry button)
// doesn't spawn duplicate processes for the lifetime of this Next.js server.
let verifyServicesStarted: { inference?: import("node:child_process").ChildProcess; worker?: import("node:child_process").ChildProcess } = {};

function inferenceArgvFor(runtime: string): { cmd: string; args: string[]; cwd: string; shell: boolean } | null {
  if (runtime === "wsl") {
    const venvWsl = resolve(INFER, "venv-wsl");
    if (!existsSync(venvWsl)) return null;
    const script = `cd '${INFER_WSL}' && venv-wsl/bin/uvicorn main:app --host 0.0.0.0 --port 8000`;
    return { cmd: "wsl.exe", args: ["--", "bash", "-lc", script], cwd: INFER, shell: false };
  }
  const venv = resolve(INFER, "venv");
  if (!existsSync(venv)) return null;
  return { cmd: venvPython(venv), args: ["-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"], cwd: INFER, shell: false };
}

async function waitForInferenceReady(timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch("http://localhost:8000/docs", { signal: AbortSignal.timeout(2000) });
      if (res.ok) return true;
    } catch {
      // not up yet, keep polling
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

async function runVerifyServices(send: (e: object) => void): Promise<number> {
  const runtime = (await getSettingsRepo().getSetting("INFERENCE_RUNTIME")) ?? (IS_WIN ? "windows" : "linux");

  if (!verifyServicesStarted.inference) {
    const argv = inferenceArgvFor(runtime);
    if (!argv) {
      send({ type: "log", line: `Entorno de inferencia (${runtime}) no instalado todavía — completa los pasos anteriores primero.\n` });
      return 1;
    }
    send({ type: "log", line: `Arrancando servicio de inferencia (${runtime})...\n` });
    verifyServicesStarted.inference = spawn(argv.cmd, argv.args, { cwd: argv.cwd, shell: argv.shell, detached: true, stdio: "ignore" });
    verifyServicesStarted.inference.unref();
  } else {
    send({ type: "log", line: "Servicio de inferencia ya estaba en marcha.\n" });
  }

  const ready = await waitForInferenceReady(45000);
  send({ type: "log", line: ready ? "Servicio de inferencia: listo.\n" : "Servicio de inferencia: no respondió a tiempo.\n" });
  if (!ready) return 1;

  if (!verifyServicesStarted.worker) {
    send({ type: "log", line: "Arrancando worker...\n" });
    verifyServicesStarted.worker = spawn("pnpm", ["--filter", "@netryx/worker", "start"], { cwd: REPO_ROOT, shell: true, detached: true, stdio: "ignore" });
    verifyServicesStarted.worker.unref();
    await new Promise((r) => setTimeout(r, 3000));
  }
  // No HTTP surface on the worker (pg-boss consumer, not a server) — "still
  // running 3s after launch" is the closest available signal without adding
  // a heartbeat table. exitCode stays null while a detached child is alive.
  const workerAlive = verifyServicesStarted.worker.exitCode === null;
  send({ type: "log", line: workerAlive ? "Worker: en marcha.\n" : `Worker: terminó (código ${verifyServicesStarted.worker.exitCode}).\n` });
  return workerAlive ? 0 : 1;
}

async function runRestartInference(send: (e: object) => void): Promise<number> {
  send({ type: "log", line: "Deteniendo servicio de inferencia...\n" });
  if (verifyServicesStarted.inference) {
    verifyServicesStarted.inference.kill();
  }
  await killProcessOnPort(8000);
  verifyServicesStarted.inference = undefined;

  const runtime = (await getSettingsRepo().getSetting("INFERENCE_RUNTIME")) ?? (IS_WIN ? "windows" : "linux");
  const argv = inferenceArgvFor(runtime);
  if (!argv) {
    send({ type: "log", line: `Entorno de inferencia (${runtime}) no instalado todavía.\n` });
    return 1;
  }

  send({ type: "log", line: "Arrancando servicio de inferencia...\n" });
  verifyServicesStarted.inference = spawn(argv.cmd, argv.args, { cwd: argv.cwd, shell: argv.shell, detached: true, stdio: "ignore" });
  verifyServicesStarted.inference.unref();

  const ready = await waitForInferenceReady(45000);
  send({ type: "log", line: ready ? "Servicio de inferencia: listo.\n" : "Servicio de inferencia: no respondió a tiempo.\n" });
  return ready ? 0 : 1;
}

export async function POST(request: Request, { params }: { params: { step: string } }) {
  if (params.step === "restart-inference") {
    const stream = new ReadableStream({
      async start(controller) {
        const enc = new TextEncoder();
        const send = (e: object) => controller.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`));
        const code = await runRestartInference(send);
        send({ type: "done", code });
        controller.close();
      },
    });
    return new Response(stream, {
      headers: { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" },
    });
  }

  if (params.step === "verify-services") {
    const stream = new ReadableStream({
      async start(controller) {
        const enc = new TextEncoder();
        const send = (e: object) => controller.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`));
        const code = await runVerifyServices(send);
        send({ type: "done", code });
        controller.close();
      },
    });
    return new Response(stream, {
      headers: { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" },
    });
  }

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
      // shell:true (the default here) so `pnpm`/`python` resolve on Windows
      // (pnpm is pnpm.cmd). WSL steps opt out (shell:false) — see wslStep()
      // above for why. argv is fixed data (see security note), so shell use
      // is not an injection vector either way.
      const child = spawn(step.cmd, step.args, { cwd: step.cwd, shell: step.shell ?? true, env: step.env ?? process.env });
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