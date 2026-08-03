import { useState } from "react";
import { loadServers, loadSession, type Server } from "../lib/session";
import { LoginForm } from "./LoginForm";
import { AddServerForm } from "./AddServerForm";

export type EntryView = "login" | "add" | "request" | "waiting" | "resolved" | "password";

/** Marco compartido: la marca, el subtítulo y la tarjeta. Mismo esqueleto que
 *  el wizard, sin el stepper: aquí no hay pasos numerados que recorrer. */
export function Pane({ title, subtitle, children }: {
  title: string; subtitle: string; children: React.ReactNode;
}) {
  return (
    <div className="relative z-10 mx-auto w-full max-w-xl px-6 py-9">
      <div className="mb-1 flex items-center gap-2.5" style={{ animation: "jg-fade-rise .7s both" }}>
        <span className="text-fg" style={{ animation: "jg-lock-breathe 2.4s ease-in-out infinite" }}>✦</span>
        <span className="text-[17px] font-medium text-fg">{title}</span>
      </div>
      <p className="mb-6 text-xs text-muted" style={{ animation: "jg-fade-rise .7s .06s both" }}>{subtitle}</p>
      <div className="rounded-card border border-white/[.13] bg-[rgba(16,19,25,.66)] p-5 shadow-lg shadow-black/40 backdrop-blur-xl"
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
  // Con un ticket guardado se aterriza en la espera, no en el login: es lo que
  // el usuario estaba haciendo, y sobrevive a cerrar la app.
  const [view, setView] = useState<EntryView>(
    saved.length === 0 ? "add" : loadSession()?.ticket ? "waiting" : "login",
  );

  if (view === "add") {
    return (
      <Pane title="Añadir un servidor" subtitle="pega la clave que te han pasado.">
        <AddServerForm
          onAdded={(addr) => { setServer(loadServers().find((s) => s.addr === addr) ?? null); setView("login"); }}
          onOwnerKey={onOwnerKey}
          onBack={() => setView("login")} />
      </Pane>
    );
  }

  return (
    <Pane title="Lumi Station" subtitle="inicia sesión en tu servidor.">
      <LoginForm server={server} onServer={setServer} onAdd={() => setView("add")}
        onRequest={() => setView("request")} onSignedIn={onSignedIn}
        onMustChange={() => setView("password")} />
    </Pane>
  );
}
