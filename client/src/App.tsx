import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { PlanetBackground } from "./ui/PlanetBackground";
import { Wizard } from "./wizard/Wizard";
import { PairStep } from "./wizard/PairStep";
import { AdminStep } from "./wizard/AdminStep";
import { ProvisionStep } from "./wizard/ProvisionStep";
import { TitleBar } from "./ui/TitleBar";
import { ResizeHandles } from "./ui/WindowFrame";
import { StatusOverlay } from "./ui/StatusOverlay";
import { EntryScreen } from "./entry/EntryScreen";
import { AdminPanel } from "./admin/AdminPanel";
import { ConnectionBanner } from "./ui/ConnectionBanner";
import { DebugOrb } from "./dev/DebugOrb";
import { useServer } from "./lib/store";
import { useWorkspace } from "./lib/workspace";
import { api, type Hello, type Me, type Sample } from "./lib/api";
import { setAuth } from "./lib/bridge";
import { loadSession, updateSession } from "./lib/session";
import { ProjectPicker } from "./work/ProjectPicker";
import { ProjectView } from "./work/ProjectView";
import { CaseView } from "./work/CaseView";
import { Rail } from "./work/Rail";
import { InviteDrawer } from "./work/InviteDrawer";
import type { DrawerId } from "./work/Drawer";

export default function App() {
  const [step, setStep] = useState(0);
  const [resuming, setResuming] = useState(true);
  const [mode, setMode] = useState<"entry" | "wizard" | "picker" | "project" | "case" | "admin">("entry");
  const [adminBusy, setAdminBusy] = useState(false);
  const [runtimeDone, setRuntimeDone] = useState(false);
  /** Resultados e invitar piden el mismo carril de la derecha, así que el
   *  estado es uno solo: abrir cualquiera de los dos recoge el otro. */
  const [drawer, setDrawer] = useState<DrawerId>(null);
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
            const me = await api.get<Me>("/v1/auth/me", session.token);
            useServer.getState().setToken(session.token);
            setAuth(session.token);
            useServer.getState().setUser(me.username, me.is_admin, me.limits);
            await invoke("start_telemetry", { token: session.token });
            // El aprovisionamiento sigue siendo cosa del owner: si el servidor
            // no está listo del todo, se vuelve al wizard donde se dejó.
            //
            // Fuera de ese caso, TODO el mundo aterriza en el selector de
            // proyectos, también el administrador: administrar es una tarea
            // más, no un modo de vida. Antes entraba directo al panel y la
            // aplicación de verdad le quedaba escondida detrás de "Cerrar".
            if (me.is_admin && h.state !== "ready") { setStep(2); setMode("wizard"); }
            else setMode("picker");
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

  /** Solo una persona a la vez dentro de un proyecto: salir de verdad tiene
   *  que soltar el candado, no solo cambiar de pantalla. Best effort — si la
   *  llamada falla (red caída, app cerrándose), el candado caduca solo al
   *  cabo de las horas que marca `STALE_AFTER` en el servidor. */
  function leaveProject() {
    const { project } = useWorkspace.getState();
    const token = useServer.getState().token;
    if (project && token) {
      void api.post(`/v1/projects/${project.id}/leave`, {}, token).catch(() => {});
    }
  }

  /** Salir a mano. Es el mismo desmontaje que hace la expulsión por
   *  desconexión, y por eso vive en un solo sitio: dejar el token del puente
   *  nativo puesto tras cerrar sesión sería dejar abierta la puerta de las
   *  imágenes. */
  function signOut() {
    leaveProject();
    updateSession({ token: undefined });
    useServer.getState().setToken(null);
    useServer.getState().setUser("", false, null);
    setAuth(null);
    useWorkspace.getState().clear();
    setDrawer(null);
    setMode("entry");
  }

  /** Volver al selector: soltar el candado y olvidar el proyecto. */
  function toProjects() {
    leaveProject();
    useWorkspace.getState().clear();
    setDrawer(null);
    setMode("picker");
  }

  const blockedByDisconnect = status !== "ok" &&
    (mode === "picker" || mode === "project" || mode === "case" || mode === "admin");

  const { project: proyectoActual, case_: casoActual } = useWorkspace();
  /** Las migas de la barra de título salen del modo, no de cada pantalla: la
   *  barra es una sola para toda la aplicación y tiene que saber dónde estás
   *  sin que cada vista se lo cuente. */
  const crumbs =
    mode === "entry" || mode === "wizard"
      ? [{ label: "Lumi Station" }]
      : mode === "admin"
        ? [{ label: "Proyectos", onClick: () => setMode("picker") }, { label: "Administración" }]
        : mode === "picker" || !proyectoActual
          ? [{ label: "Proyectos" }]
          : mode === "case" && casoActual
            ? [
                { label: "Proyectos", onClick: () => toProjects() },
                { label: proyectoActual.name, onClick: () => { useWorkspace.getState().setCase(null); setMode("project"); } },
                { label: casoActual.name },
              ]
            : [{ label: "Proyectos", onClick: () => toProjects() }, { label: proyectoActual.name }];

  return (
    <div className="relative flex h-full flex-col overflow-hidden">
      <PlanetBackground dead={status !== "ok"} />
      {/* Una sola franja arriba para todo: migas, estado del servidor,
          notificaciones, cuenta y los botones de la ventana. La telemetría ya
          no es una franja permanente de 70 px — vive en su píldora. */}
      <TitleBar crumbs={crumbs} onOpenAdmin={() => { leaveProject(); setMode("admin"); }}
        onSignOut={signOut} />
      <ResizeHandles />
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
        // El selector de proyectos también ocupa la ventana entera desde el
        // rediseño: centrarlo lo dejaba flotando con dos paneles a media asta.
        mode === "project" || mode === "case" || mode === "picker"
          ? "" : "items-center justify-center overflow-y-auto"
      } ${blockedByDisconnect ? "pointer-events-none opacity-50" : ""}`}>
      {resuming ? null : status !== "ok" && !blockedByDisconnect && mode !== "entry" ? (
        // Sustituye al wizard en el mismo hueco: no es una capa flotante
        // encima ("popup"), es lo que se ve mientras dure el estado. La
        // franja de arriba es hermana de este bloque, por eso sigue visible.
        // NUNCA en "entry": un `hello` que sobrevive de una reconexión a
        // medias no significa que haya una sesión que proteger, y tapar el
        // formulario de login con "reconectando" deja al usuario sin forma
        // de entrar aunque el servidor esté perfectamente sano.
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
        <ProjectPicker
          onOpen={(p) => { useWorkspace.getState().setProject(p); setMode("project"); }} />
      ) : (
        (() => {
          const { project, case_ } = useWorkspace.getState();
          if (!project) { setMode("picker"); return null; }
          const rail = (
            <Rail active={drawer === "invite" ? "members" : "cases"}
              canManage={project.role === "owner"} isAdmin={isAdmin}
              onCases={() => {
                setDrawer(null);
                if (mode === "case") { useWorkspace.getState().setCase(null); setMode("project"); }
              }}
              onMembers={() => setDrawer(drawer === "invite" ? null : "invite")}
              // El panel de administración es una parada aparte: mientras se
              // está ahí no se está trabajando en el proyecto, así que se
              // suelta el candado para no bloquearlo a los demás por nada.
              onAdmin={() => { leaveProject(); setMode("admin"); }}
              onLeave={toProjects} />
          );
          // Los dos cajones comparten hueco, así que comparten estado: abrir
          // uno recoge el otro sin que ninguna pantalla tenga que enterarse.
          const cajon = (
            <InviteDrawer project={project} open={drawer === "invite"}
              onClose={() => setDrawer(null)} />
          );
          return mode === "case" && case_ ? (
            <CaseView project={project} case_={case_} rail={rail} drawer={cajon}
              drawerId={drawer} setDrawer={setDrawer} />
          ) : (
            <ProjectView project={project} rail={rail} drawer={cajon}
              onOpenCase={(c) => { useWorkspace.getState().setCase(c); setMode("case"); }} />
          );
        })()
      )}
      </div>
      {import.meta.env.DEV && <DebugOrb />}
    </div>
  );
}
