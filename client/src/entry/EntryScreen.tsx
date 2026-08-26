import { useState } from "react";
import { loadServers, loadSession, type Server } from "../lib/session";
import { LoginForm } from "./LoginForm";
import { AddServerForm } from "./AddServerForm";
import { RequestForm } from "./RequestForm";
import { WaitingScreen } from "./WaitingScreen";
import { ResolvedScreen } from "./ResolvedScreen";
import { ChangePasswordForm } from "./ChangePasswordForm";
import { WavesBackground } from "./WavesBackground";
import type { AccessStatus } from "../lib/api";
import { AjustesView } from "../settings/AjustesView";
import { Icon } from "../ui/Icon";

export type EntryView = "login" | "add" | "request" | "waiting" | "resolved" | "password" | "ajustes";

/** Marco compartido: la marca, el subtítulo y la tarjeta. Mismo esqueleto que
 *  el wizard, sin el stepper: aquí no hay pasos numerados que recorrer. */
export function Pane({ title, subtitle, children }: {
  title: string; subtitle: string; children: React.ReactNode;
}) {
  return (
    <div className="relative z-10 mx-auto w-full max-w-sm px-6 py-9">
      <div className="mb-1 flex items-center gap-2.5" style={{ animation: "jg-fade-rise .7s both" }}>
        <span className="text-fg" style={{ animation: "jg-lock-breathe 2.4s ease-in-out infinite" }}>✦</span>
        <span className="text-[17px] font-medium text-fg">{title}</span>
      </div>
      <p className="mb-6 text-xs text-muted" style={{ animation: "jg-fade-rise .7s .06s both" }}>{subtitle}</p>
      <div className="rounded-card border border-white/[.13] bg-[rgba(16,19,25,.66)] p-4 shadow-lg shadow-black/40 backdrop-blur-xl"
        style={{ animation: "jg-fade-rise .8s .18s both" }}>
        {children}
      </div>
    </div>
  );
}

export function EntryScreen({ onSignedIn, onOwnerKey }: {
  onSignedIn: () => void; onOwnerKey: (key: string) => void;
}) {
  const saved = loadServers();
  const [server, setServer] = useState<Server | null>(saved[0] ?? null);
  // El login es SIEMPRE la pantalla por defecto, con servidores guardados o
  // sin ellos: añadir uno vive dentro del desplegable, no reemplaza al login.
  // Excepción: con un ticket guardado se aterriza en la espera, porque es lo
  // que el usuario estaba haciendo y sobrevive a cerrar la app.
  const [view, setView] = useState<EntryView>(loadSession()?.ticket ? "waiting" : "login");
  const [resolved, setResolved] = useState<AccessStatus | null>(null);

  if (view === "ajustes") {
    return <AjustesView onBack={() => setView("login")} />;
  }

  // Fuera de las ramas de `view`: EntryScreen no se remonta al cambiar de
  // vista, así que esto tampoco — la animación de las capas sigue su ciclo
  // sin reiniciarse cada vez que pasas de login a "añadir servidor" y vuelta.
  let pane;
  if (view === "add") {
    pane = (
      <Pane title="Añadir un servidor" subtitle="pega la clave que te han pasado.">
        <AddServerForm
          onAdded={(addr) => { setServer(loadServers().find((s) => s.addr === addr) ?? null); setView("login"); }}
          onOwnerKey={onOwnerKey}
          onBack={() => setView("login")} />
      </Pane>
    );
  } else if (view === "request") {
    pane = (
      <Pane title="Solicitar acceso" subtitle="el administrador recibirá tu petición.">
        <RequestForm server={server} onSent={() => setView("waiting")} onBack={() => setView("login")} />
      </Pane>
    );
  } else if (view === "waiting") {
    pane = (
      <Pane title="Solicitud enviada" subtitle="esperando a que el administrador responda.">
        <WaitingScreen server={server}
          onResolved={(s) => { setResolved(s); setView("resolved"); }}
          onCancel={() => setView("login")} />
      </Pane>
    );
  } else if (view === "resolved" && resolved) {
    const ok = resolved.status === "approved";
    pane = (
      <Pane title={ok ? "Acceso aprobado" : "Solicitud rechazada"}
        subtitle={ok ? "crea tu cuenta para empezar." : "el administrador no ha concedido el acceso."}>
        <ResolvedScreen status={resolved}
          onCreated={() => setView("login")}
          onRetry={() => setView("request")}
          onBack={() => setView("login")} />
      </Pane>
    );
  } else if (view === "password") {
    pane = (
      <Pane title="Cambia tu contraseña" subtitle="hace falta antes de entrar.">
        <ChangePasswordForm onDone={onSignedIn} onCancel={() => setView("login")} />
      </Pane>
    );
  } else {
    pane = (
      <Pane title="Lumi" subtitle="inicia sesión en tu servidor.">
        <LoginForm server={server} onServer={setServer} onAdd={() => setView("add")}
          onRequest={() => setView("request")} onSignedIn={onSignedIn}
          onMustChange={() => setView("password")} />
      </Pane>
    );
  }

  // El fondo va FUERA del if/else: EntryScreen no se remonta al cambiar de
  // vista, así que esto tampoco — la animación de las capas sigue su ciclo
  // sin reiniciarse cada vez que pasas de login a "añadir servidor" y vuelta.
  return (
    <>
      <WavesBackground />
      {pane}
      <button onClick={() => setView("ajustes")}
        className="fixed bottom-4 left-4 z-10 grid h-8 w-8 place-items-center rounded-full
          border border-white/15 bg-[rgba(16,19,25,.66)] text-subtle backdrop-blur-xl
          transition-colors duration-300 ease-expo hover:text-fg"
        title="Ajustes">
        <Icon name="ajustes" size={14} />
      </button>
    </>
  );
}
