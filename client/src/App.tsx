import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { PlanetBackground } from "./ui/PlanetBackground";
import { Wizard } from "./wizard/Wizard";
import { PairStep } from "./wizard/PairStep";
import { AdminStep } from "./wizard/AdminStep";
import { ProvisionStep } from "./wizard/ProvisionStep";
import { TelemetryStrip } from "./ui/TelemetryStrip";
import { StatusOverlay } from "./ui/StatusOverlay";
import { EntryScreen } from "./entry/EntryScreen";
import { AdminPanel } from "./admin/AdminPanel";
import { ConnectionBanner } from "./ui/ConnectionBanner";
import { DebugOrb } from "./dev/DebugOrb";
import { useServer } from "./lib/store";
import { useWorkspace } from "./lib/workspace";
import { api, type Hello, type Sample } from "./lib/api";
import { setAuth } from "./lib/bridge";
import { loadSession, updateSession } from "./lib/session";
import { ProjectPicker } from "./work/ProjectPicker";
import { ProjectView } from "./work/ProjectView";
import { CaseView } from "./work/CaseView";
import { Rail } from "./work/Rail";
import { MembersDialog } from "./work/MembersDialog";

export default function App() {
  const [step, setStep] = useState(0);
  const [collapsed, setCollapsed] = useState(false);
  const [resuming, setResuming] = useState(true);
  const [mode, setMode] = useState<"entry" | "wizard" | "picker" | "project" | "case" | "admin">("entry");
  const [notifs, setNotifs] = useState(0);
  const [adminBusy, setAdminBusy] = useState(false);
  const [runtimeDone, setRuntimeDone] = useState(false);
  const [members, setMembers] = useState(false);
  const hello = useServer((s) => s.hello);
  const isAdmin = useServer((s) => s.isAdmin);
  const bootstrapToken = useServer((s) => s.bootstrapToken);
  const [status, setStatus] = useState<"ok" | "reboot" | "error" | "sealed" | "lost">("ok");
  const fails = useRef(0);
  // `mode` fresco dentro del intervalo: el efecto de sondeo no se reinicia
  // cuando cambias de modo (solo depende de `paired`), así que sin esto la
  // comprobación de expulsión vería siempre el modo de cuando arrancó.
  const modeRef = useRef(mode);
  useEffect(() => { modeRef.current = mode; }, [mode]);
  // Desde cuándo lleva caída la conexión. `null` mientras responde. Sirve
  // para expulsar al login tras demasiado tiempo sin servidor, no solo para
  // decidir el tono del aviso.
  const downSince = useRef<number | null>(null);
  const KICK_AFTER_MS = 2 * 60 * 1000;

  useEffect(() => {
    const un = listen<Sample>("telemetry", (e) => useServer.getState().setSample(e.payload));
    return () => { un.then((f) => f()); };
  }, []);

  // Al reabrir la app, retomar donde estabas en vez de exigir la clave de
  // vinculación otra vez (es de un solo uso: para entonces ya está gastada).
  // La decisión de en qué modo aterrizar sale de la VERDAD del servidor
  // (hello.state, /v1/auth/me), no de un número de paso guardado a ciegas.
  useEffect(() => {
    const session = loadSession();
    if (!session?.addr || !session?.fingerprint) { setResuming(false); return; }
    (async () => {
      try {
        const h = await api.reconnect(session.addr, session.fingerprint);
        useServer.getState().setHello(h);
        useServer.getState().setAddr(session.addr);

        // Servidor sin reclamar: esto es el flujo del owner, no el de entrada.
        if (h.state === "unclaimed") {
          if (session.bootstrapToken) {
            useServer.getState().setBootstrapToken(session.bootstrapToken);
            setStep(1);
            setMode("wizard");
          } else {
            setMode("entry");
          }
          return;
        }
        if (session.token) {
          try {
            const me = await api.get<{ username: string; is_admin: boolean }>("/v1/auth/me", session.token);
            useServer.getState().setToken(session.token);
            setAuth(session.token);
            useServer.getState().setUser(me.username, me.is_admin);
            await invoke("start_telemetry", { token: session.token });
            // El aprovisionamiento sigue siendo cosa del owner: si el servidor
            // no está listo del todo, se vuelve al wizard donde se dejó.
            if (me.is_admin && h.state !== "ready") { setStep(2); setMode("wizard"); }
            else setMode(me.is_admin ? "admin" : "picker");
            return;
          } catch {
            // 403 (cambio pendiente) o token caducado: la entrada lo resuelve.
            updateSession({ token: undefined });
          }
        }
        setMode("entry");
      } catch {
        // No se pudo reconectar (servidor apagado, red, dirección cambiada).
        // No se borra la sesión por un fallo puntual: puede ser pasajero.
        setMode("entry");
      } finally {
        setResuming(false);
      }
    })();
  }, []);

  // Sondear solo DESPUÉS de vincular. Antes no hay servidor al que sondear:
  // `request` falla con "sin servidor vinculado" y el contador de fallos
  // levantaba el overlay de reconexión sin que el usuario hubiera pegado
  // siquiera la clave.
  const paired = hello !== null;
  useEffect(() => {
    if (!paired) return;
    const t = setInterval(async () => {
      try {
        const h = await api.get<Hello>("/v1/hello");
        useServer.getState().setHello(h);
        const wasDown = fails.current > 0;
        fails.current = 0;
        downSince.current = null;
        setStatus(h.locked ? "sealed" : wasDown ? "reboot" : "ok");
      } catch {
        fails.current += 1;
        if (downSince.current === null) downSince.current = Date.now();
        setStatus(fails.current > 20 ? "lost" : "reboot");
        // Solo afecta a una sesión de usuario ya dentro (app/admin): durante
        // el wizard del owner, `StatusOverlay` ya cubre esto con reintento
        // manual, y no tiene sentido "desloguear" a quien está instalando.
        const kicked = modeRef.current === "picker" || modeRef.current === "project" ||
          modeRef.current === "case" || modeRef.current === "admin";
        if (kicked && Date.now() - downSince.current > KICK_AFTER_MS) {
          updateSession({ token: undefined });
          useServer.getState().setToken(null);
          setAuth(null);
          useWorkspace.getState().clear();
          setMode("entry");
          setStatus("ok");
          fails.current = 0;
          downSince.current = null;
        }
      }
    }, 3000);
    return () => clearInterval(t);
  }, [paired]);

  async function unseal(passphrase: string) {
    await api.post("/v1/unseal", { passphrase });
  }

  const blockedByDisconnect = status !== "ok" &&
    (mode === "picker" || mode === "project" || mode === "case" || mode === "admin");

  return (
    <div className="relative flex h-full flex-col overflow-hidden">
      <PlanetBackground dead={status !== "ok"} />
      {/* Nunca en "entry": una reconexión a medio hacer deja `hello` con
          datos aunque no haya sesión válida, y la franja se veía encima del
          login sin que hubiera nada real que mostrar todavía. Y solo para
          admin: CPU, GPU y cola son datos de hardware del servidor, no algo
          que un investigador normal necesite ver en cada pantalla. */}
      {mode !== "entry" && isAdmin && (
        <TelemetryStrip collapsed={collapsed} onToggle={() => setCollapsed((c) => !c)}
          notifs={notifs}
          onNotifs={mode === "picker" || mode === "project" || mode === "case" || mode === "admin" ? () => {
            setNotifs(0);
            setMode(useServer.getState().isAdmin ? "admin" : "picker");
          } : undefined} />
      )}
      {/* Para app/admin, la desconexión es un banner + bloqueo, no una
          pantalla completa: la sesión de un usuario normal no tiene un
          formulario de desbloqueo que mostrar, solo hay que impedir que
          actúe sobre datos que pueden estar desactualizados. El wizard del
          owner sigue usando el StatusOverlay de página completa, porque
          "sellado" y "error de arranque" sí necesitan su propio hueco. */}
      {blockedByDisconnect && <ConnectionBanner />}
      {/* El wizard se centra en el espacio que deja la franja, en vez de
          colgar de arriba dejando media pantalla vacía. */}
      <div className={`relative flex flex-1 overflow-hidden ${
        mode === "project" || mode === "case" ? "" : "items-center justify-center overflow-y-auto"
      } ${blockedByDisconnect ? "pointer-events-none opacity-50" : ""}`}>
      {resuming ? null : status !== "ok" && !blockedByDisconnect ? (
        // Sustituye al wizard en el mismo hueco: no es una capa flotante
        // encima ("popup"), es lo que se ve mientras dure el estado. La
        // franja de arriba es hermana de este bloque, por eso sigue visible.
        <StatusOverlay
          status={status}
          queue={useServer.getState().sample?.queue_depth ?? 0}
          onRetry={() => setStatus("ok")}
          onUnseal={unseal}
        />
      ) : mode === "entry" ? (
        <EntryScreen
          onSignedIn={() => setMode(useServer.getState().isAdmin ? "admin" : "picker")}
          onOwnerKey={(key) => { useServer.getState().setKey(key); setStep(0); setMode("wizard"); }} />
      ) : mode === "admin" ? (
        <AdminPanel token={useServer.getState().token!} onClose={() => setMode("picker")} />
      ) : mode === "wizard" ? (
        <Wizard step={step} title="Lumi Station" subtitle="vincular servidor"
          // Del paso 3 (runtime) no se puede volver al 2 (admin): la cuenta ya
          // se creó y el token de bootstrap ya se consumió, así que no hay
          // nada que "deshacer" volviendo atrás.
          onBack={step > 0 && step !== 2 ? () => setStep((s) => s - 1) : undefined}
          onNext={() => {
            if (step === 1) { document.getElementById("admin-submit")?.click(); return; }
            // Datos y Modelos (subsistemas 3-5) todavía no existen: el paso 2
            // (runtime) es el último construido, así que terminar de instalar
            // lleva directo a la app en vez de a un paso vacío. El owner es
            // admin, así que va al panel — igual que al reabrir la app.
            if (step === 2) { setMode(useServer.getState().isAdmin ? "admin" : "picker"); return; }
            setStep((s) => s + 1);
          }}
          nextDisabled={
            (step === 0 && (!hello || hello.state !== "unclaimed")) ||
            (step === 2 && !runtimeDone)
          }
          nextLabel={step === 2 ? "Terminar" : "Siguiente"}
          nextBusy={step === 1 && adminBusy}>
          {step === 0 && <PairStep onDone={() => setStep(1)} />}
          {step === 1 && <AdminStep bootstrapToken={bootstrapToken} onDone={() => setStep(2)} onBusyChange={setAdminBusy} />}
          {step === 2 && <ProvisionStep onDone={() => setMode("picker")} onStatusChange={setRuntimeDone} />}
        </Wizard>
      ) : mode === "picker" ? (
        <ProjectPicker onOpen={(p) => {
          useWorkspace.getState().setProject(p);
          setMode("project");
        }} />
      ) : mode === "project" || mode === "case" ? (
        (() => {
          const { project, case_ } = useWorkspace.getState();
          if (!project) { setMode("picker"); return null; }
          const rail = (
            <Rail canManage={project.role === "owner"}
              onProjects={() => { useWorkspace.getState().clear(); setMode("picker"); }}
              onMembers={() => setMembers(true)} />
          );
          return (
            <>
              {mode === "case" && case_ ? (
                <CaseView project={project} case_={case_} rail={rail}
                  onBack={() => { useWorkspace.getState().setCase(null); setMode("project"); }} />
              ) : (
                <ProjectView project={project} rail={rail}
                  onOpenCase={(c) => { useWorkspace.getState().setCase(c); setMode("case"); }} />
              )}
              {members && <MembersDialog project={project} onClose={() => setMembers(false)} />}
            </>
          );
        })()
      ) : (
        <div className="text-xs text-muted">
          <p>Sesión iniciada como {useServer.getState().username}.</p>
          {/* Sin esto, un admin que pulsaba "Cerrar" en su propio panel se
              quedaba aquí sin ninguna forma visible de volver: la única
              salida era la campana de la franja, que no es obvia. */}
          {useServer.getState().isAdmin && (
            <button onClick={() => setMode("admin")}
              className="mt-3 rounded-lg border border-white/15 px-4 py-2 text-xs text-fg active:translate-y-px">
              Volver al panel de administración
            </button>
          )}
        </div>
      )}
      </div>
      {import.meta.env.DEV && <DebugOrb />}
    </div>
  );
}
