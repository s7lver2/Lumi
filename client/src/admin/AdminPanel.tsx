import { useState } from "react";
import { RequestsView } from "./RequestsView";
import { UsersView } from "./UsersView";

export function AdminPanel({ token, onClose }: { token: string; onClose: () => void }) {
  const [tab, setTab] = useState<"requests" | "users">("requests");
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
      <div style={{ animation: "jg-fade-rise .8s .1s both" }}>
        {tab === "requests" ? <RequestsView token={token} /> : <UsersView token={token} />}
      </div>
    </div>
  );
}
