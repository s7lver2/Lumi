"use client";

import { useEffect, useState } from "react";
import type { EntradaPendiente } from "@/lib/liberaciones";

/// Client component: la lista es la única parte de `/admin` que necesita
/// interacción (aprobar/rechazar quita la fila sin recargar, cerrar sesión
/// dispara una petición). El resto de la página (`page.tsx`) es un Server
/// Component que solo decide si mostrar esto o el botón de login.
export function PanelLiberaciones() {
  const [pendientes, setPendientes] = useState<EntradaPendiente[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [enCurso, setEnCurso] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/admin/liberaciones")
      .then(async (r) => {
        if (!r.ok) throw new Error(`${r.status}`);
        return r.json() as Promise<{ pendientes: EntradaPendiente[] }>;
      })
      .then((j) => setPendientes(j.pendientes))
      .catch(() => setError("No se pudo cargar la cola de solicitudes."));
  }, []);

  async function decidir(paquete: string, decision: "aprobada" | "rechazada") {
    setEnCurso(paquete);
    try {
      const r = await fetch(`/api/admin/liberaciones/${encodeURIComponent(paquete)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision }),
      });
      if (!r.ok) throw new Error(`${r.status}`);
      setPendientes((prev) => (prev ?? []).filter((e) => e.paquete !== paquete));
    } catch {
      setError(`No se pudo registrar la decisión para ${paquete}.`);
    } finally {
      setEnCurso(null);
    }
  }

  if (error) {
    return <p className="text-[13px] text-danger-fg">{error}</p>;
  }
  if (pendientes === null) {
    return <p className="text-[13px] text-subtle">Cargando…</p>;
  }
  if (pendientes.length === 0) {
    return <p className="text-[13px] text-subtle">No hay solicitudes pendientes.</p>;
  }

  return (
    <div className="flex flex-col gap-2">
      {pendientes.map((e) => (
        <div
          key={e.paquete}
          className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-border bg-panel px-4 py-3"
        >
          <div className="flex flex-col gap-1">
            <span className="font-mono text-[13px] text-fg">{e.paquete}</span>
            <span className="font-mono text-[11.5px] text-muted">
              {e.cuenta} · {new Date(e.fecha).toISOString()} · {e.quadkeys.length} teselas
            </span>
          </div>
          <div className="flex gap-2">
            <button
              disabled={enCurso === e.paquete}
              onClick={() => decidir(e.paquete, "aprobada")}
              className="jg-micro rounded-card border border-border px-3 py-1.5 text-[12px] font-medium text-fg hover:border-subtle hover:bg-elevated disabled:opacity-40"
            >
              Aprobar
            </button>
            <button
              disabled={enCurso === e.paquete}
              onClick={() => decidir(e.paquete, "rechazada")}
              className="jg-micro rounded-card border border-border px-3 py-1.5 text-[12px] font-medium text-danger-fg hover:border-danger hover:bg-elevated disabled:opacity-40"
            >
              Rechazar
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

export function BotonCerrarSesion() {
  return (
    <button
      onClick={async () => {
        await fetch("/api/admin/logout", { method: "POST" });
        window.location.href = "/admin";
      }}
      className="jg-micro rounded-card border border-border px-3 py-1.5 text-[12px] font-medium text-muted hover:border-subtle hover:bg-elevated hover:text-fg"
    >
      Cerrar sesión
    </button>
  );
}
