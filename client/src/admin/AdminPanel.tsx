import { useState } from "react";
import { useServer } from "../lib/store";
import { Icon } from "../ui/Icon";
import { RequestsView } from "./RequestsView";
import { UsersView } from "./UsersView";

export function AdminPanel({ token, onClose }: { token: string; onClose: () => void }) {
  const [tab, setTab] = useState<"requests" | "users">("requests");
  const [copied, setCopied] = useState(false);
  const addr = useServer((s) => s.addr);
  const fingerprint = useServer((s) => s.hello?.fingerprint) ?? "";
  // La tarjeta pública, formada igual que ServerCard::Display en lumi-proto:
  // lumi1s_<addr>_<huella>. Sin secreto: es lo que se reparte al equipo para
  // que pidan acceso, y hasta ahora no se mostraba en ningún sitio de la app
  // pese a que la spec lo prometía ("botón de copiar" en el panel de admin).
  const card = `lumi1s_${addr}_${fingerprint}`;

  function copy() {
    navigator.clipboard.writeText(card);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }

  return (
    <div className="relative z-10 mx-auto w-full max-w-3xl px-6 py-9">
      <div className="mb-1 flex items-center gap-2.5" style={{ animation: "jg-fade-rise .7s both" }}>
        <span className="text-fg">✦</span>
        <span className="text-[17px] font-medium text-fg">
          {tab === "requests" ? "Solicitudes de acceso" : "Usuarios"}
        </span>
        <div className="ml-auto flex gap-2">
          <button onClick={() => setTab(tab === "requests" ? "users" : "requests")}
            className="rounded-lg border border-white/15 px-3 py-1.5 text-[11px] text-fg">
            {tab === "requests" ? "Usuarios" : "Solicitudes"}
          </button>
          <button onClick={onClose} className="rounded-lg border border-white/15 px-3 py-1.5 text-[11px] text-fg">
            Cerrar
          </button>
        </div>
      </div>

      <div className="mb-5 flex items-center gap-2.5 rounded-lg border border-border bg-[rgba(16,19,25,.5)] px-3 py-2"
        style={{ animation: "jg-fade-rise .75s .04s both" }}>
        <span className="whitespace-nowrap text-[11px] text-muted">Tarjeta del servidor</span>
        <span className="truncate font-mono text-[11px] text-fg">{card}</span>
        <button onClick={copy}
          className="ml-auto flex shrink-0 items-center gap-1.5 rounded border border-white/15 px-2 py-1 text-[10.5px] text-fg hover:border-white/30">
          <Icon name={copied ? "check" : "clock"} size={11} />
          {copied ? "copiada" : "copiar"}
        </button>
      </div>

      <div style={{ animation: "jg-fade-rise .8s .1s both" }}>
        {tab === "requests" ? <RequestsView token={token} /> : <UsersView token={token} />}
      </div>
    </div>
  );
}
