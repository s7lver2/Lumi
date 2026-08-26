import { useEffect, useState } from "react";
import { api, type NetworkSettings, type NetworkView as NetworkViewData } from "../lib/api";
import { Icon } from "../ui/Icon";
import { Seccion } from "./AdminPanel";

const INPUT = "ml-auto rounded-lg border border-border bg-elevated px-2.5 py-1.5 font-mono text-[11px] text-fg outline-none transition-colors duration-300 ease-expo focus:border-white/40";

export function NetworkView({ token }: { token: string }) {
  const [data, setData] = useState<NetworkViewData | null>(null);
  const [borrador, setBorrador] = useState<NetworkSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () =>
    api.networkGet(token).then((d) => { setData(d); setBorrador(d.settings); }).catch((e) => setError(String(e)));

  useEffect(() => { void load(); }, [token]);

  async function guardar() {
    if (!borrador) return;
    setBusy(true); setError(null);
    try {
      const d = await api.networkPatch(borrador, token);
      setData(d); setBorrador(d.settings);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function reiniciar() {
    setBusy(true); setError(null);
    try {
      await api.networkRestart(token);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  if (!data || !borrador) {
    return <Seccion titulo="Red" grupo="Servidor"><p className="text-[11px] text-subtle">cargando</p></Seccion>;
  }

  const cambiado = JSON.stringify(borrador) !== JSON.stringify(data.settings);

  return (
    <Seccion titulo="Red" grupo="Servidor">
      <p className="text-[11px] text-muted">Puerto de escucha, dirección pública y transporte del servidor.</p>

      <div className="mt-4 rounded-card border border-border bg-panel">
        <Fila titulo="Puerto de escucha" sub="El puerto TCP local donde escucha lumid.">
          <input type="number" min={1} max={65535} value={borrador.bind_port}
            onChange={(e) => setBorrador({ ...borrador, bind_port: e.target.valueAsNumber || 0 })}
            className={`w-[90px] ${INPUT}`} />
        </Fila>
        <Fila titulo="Host público" sub="Dominio o IP incrustado en claves y tarjetas nuevas. Vacío = IP LAN autodetectada.">
          <input type="text" placeholder="autodetectada" value={borrador.public_host ?? ""}
            onChange={(e) => setBorrador({ ...borrador, public_host: e.target.value || null })}
            className={`w-[200px] ${INPUT}`} />
        </Fila>
        <Fila titulo="Puerto público" sub="Solo si hay NAT o port-forwarding. Vacío = igual al de escucha.">
          <input type="number" min={1} max={65535} placeholder={String(borrador.bind_port)}
            value={borrador.public_port ?? ""}
            onChange={(e) => setBorrador({ ...borrador, public_port: e.target.valueAsNumber || null })}
            className={`w-[90px] ${INPUT}`} />
        </Fila>
      </div>

      <div className="mt-4 rounded-card border border-border bg-panel">
        <ToggleFila
          titulo="QUIC / HTTP-3"
          sub="Listener adicional del lado servidor. El cliente de Lumi sigue hablando TCP+TLS: activarlo no cambia nada hoy, es infraestructura para el futuro."
          on={borrador.quic_enabled}
          onClick={() => setBorrador({ ...borrador, quic_enabled: !borrador.quic_enabled })}
        />
        <div className="grid transition-[grid-template-rows] duration-[420ms] ease-expo"
          style={{ gridTemplateRows: borrador.quic_enabled ? "1fr" : "0fr" }}>
          <div className="overflow-hidden">
            <div className="border-t border-border bg-black/15 pl-6">
              <Fila titulo="Puerto UDP" sub="Puerto del listener QUIC.">
                <input type="number" min={1} max={65535} value={borrador.quic_port}
                  onChange={(e) => setBorrador({ ...borrador, quic_port: e.target.valueAsNumber || 0 })}
                  className={`w-[90px] ${INPUT}`} />
              </Fila>
            </div>
          </div>
        </div>
      </div>

      {error && <p className="mt-3 text-[11px] text-danger-fg">{error}</p>}

      <div className="mt-4 flex items-center gap-2">
        <button onClick={guardar} disabled={busy || !cambiado}
          className="jg-press rounded-lg bg-accent px-3.5 py-1.5 text-[11px] font-medium text-black disabled:opacity-40">
          Guardar cambios
        </button>
        <button onClick={reiniciar} disabled={busy || !!data.restart_blocked_reason}
          title={data.restart_blocked_reason ?? undefined}
          className="jg-press rounded-lg border border-white/15 px-3.5 py-1.5 text-[11px] text-fg disabled:opacity-40">
          Reiniciar ahora
        </button>
        {data.restart_blocked_reason ? (
          <span className="flex items-center gap-1.5 text-[10.5px] text-warning-fg">
            <Icon name="alert" size={11} /> {data.restart_blocked_reason}
          </span>
        ) : cambiado ? (
          <span className="text-[10.5px] text-subtle">Cambiar puerto de escucha o QUIC exige reiniciar para aplicarse.</span>
        ) : null}
      </div>
    </Seccion>
  );
}

/** Fila de solo lectura+control, mismo esqueleto que ApiKeysView para las
 *  filas de credenciales: título y explicación a la izquierda, el control a
 *  la derecha (`ml-auto` dentro del propio input). */
function Fila({ titulo, sub, children }: { titulo: string; sub: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3.5 border-b border-border p-[13px_16px] last:border-b-0">
      <div className="min-w-0 flex-1">
        <p className="text-[12px] text-fg">{titulo}</p>
        <p className="mt-0.5 text-[10px] text-subtle">{sub}</p>
      </div>
      {children}
    </div>
  );
}

/** Interruptor deslizante, mismo tamaño y transición que `SecurityView`: es
 *  la misma decisión binaria ("activado, con opciones dependientes debajo")
 *  que Zero Trust o modo mantenimiento, así que usa el mismo control. */
function ToggleFila({ titulo, sub, on, onClick }: {
  titulo: string; sub: string; on: boolean; onClick: () => void;
}) {
  return (
    <div className="flex items-center gap-3.5 p-[13px_16px]">
      <button
        onClick={onClick}
        className={`relative h-[21px] w-9 shrink-0 cursor-pointer rounded-full border transition-colors duration-300 ease-expo ${
          on ? "border-white/30 bg-white/[.14]" : "border-border bg-elevated"
        }`}
      >
        <span className={`absolute left-[2px] top-[2px] h-[15px] w-[15px] rounded-full transition-transform duration-300 ease-expo ${
          on ? "translate-x-[15px] bg-fg" : "bg-subtle"
        }`} />
      </button>
      <div className="min-w-0">
        <p className="text-[12px] text-fg">{titulo}</p>
        <p className="mt-0.5 text-[10px] text-subtle">{sub}</p>
      </div>
    </div>
  );
}
