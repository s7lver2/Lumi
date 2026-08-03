import { useEffect, useState } from "react";
import { api, type AccessStatus } from "../lib/api";
import { clearSession, loadSession, type Server } from "../lib/session";
import { Icon } from "../ui/Icon";

const POLL_S = 30;

export function WaitingScreen({ server, onResolved, onCancel }: {
  server: Server | null; onResolved: (s: AccessStatus) => void; onCancel: () => void;
}) {
  const [left, setLeft] = useState(POLL_S);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ticket = loadSession()?.ticket;
    if (!ticket || !server) return;
    let alive = true;

    async function check() {
      try {
        await api.reconnect(server!.addr, server!.fingerprint);
        const s = await api.ticketGet<AccessStatus>("/v1/access-requests/status", ticket!);
        if (alive && s.status !== "pending") onResolved(s);
      } catch (e) {
        // 410 (caducada) y 409 (ya consumida) son definitivos; un fallo de red
        // no lo es. Se distingue por el texto porque `request` solo devuelve
        // el cuerpo del error.
        const t = String(e);
        if (alive && (t.includes("caducó") || t.includes("ya creó"))) setError(t);
      }
    }
    check();

    const tick = setInterval(() => {
      setLeft((n) => {
        if (n > 1) return n - 1;
        check();
        return POLL_S;
      });
    }, 1000);
    return () => { alive = false; clearInterval(tick); };
  }, [server, onResolved]);

  return (
    <>
      {/* Una vuelta cada 30 s: el mismo intervalo del sondeo, así el
          movimiento dice algo en vez de decorar. */}
      <div className="relative mx-auto mb-[18px] mt-0.5 h-[92px] w-[92px]">
        <div className="absolute inset-0 rounded-full"
          style={{
            background: "conic-gradient(from 0deg, rgba(133,183,235,.28), transparent 22%)",
            animation: "jg-sweep 30s linear infinite",
          }} />
        {[0, 16, 32].map((i) => (
          <div key={i} className="absolute rounded-full border border-white/[.09]"
            style={{ inset: i }} />
        ))}
        <div className="absolute left-1/2 top-1/2 h-[7px] w-[7px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-draw-fg"
          style={{ boxShadow: "0 0 10px 3px rgba(133,183,235,.4)", animation: "jg-core-pulse 3s ease-in-out infinite" }} />
      </div>

      <div className="flex items-center gap-2.5 py-[7px] text-xs text-muted">
        <Icon name="check" /> Recibida por el servidor
      </div>
      <div className="flex items-center gap-2.5 py-[7px] text-xs text-muted">
        <Icon name="spinner" /> Comprobando cada 30 s
        <span className="ml-auto font-mono text-[10.5px] text-subtle">{left} s</span>
      </div>
      <div className="my-3 h-px bg-border" />
      <p className="max-w-[54ch] text-[11px] text-muted">
        Puedes cerrar la app. Al volver se retoma la comprobación sola: la solicitud vive en
        el servidor, no aquí. Caduca a los 7 días sin respuesta.
      </p>

      {error && (
        <div className="mt-3.5 flex items-start gap-2.5 text-xs">
          <Icon name="alert" className="mt-0.5 text-danger-fg" />
          <span className="text-muted">{error}</span>
        </div>
      )}

      <div className="mt-4 flex justify-end">
        <button onClick={() => { clearSession(); onCancel(); }}
          className="rounded-lg border border-white/15 px-4 py-2 text-xs text-fg active:translate-y-px">
          Cancelar
        </button>
      </div>
    </>
  );
}
