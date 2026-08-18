import { useEffect, useState } from "react";
import { api, type NetworkSettings, type NetworkView as NetworkViewData } from "../lib/api";
import { Icon } from "../ui/Icon";
import { Seccion } from "./AdminPanel";

/** Copia al portapapeles con feedback textual de 1.5s — no hay toast propio
 *  para esto, y no hace falta uno: es una acción de un solo paso. */
function useCopiado() {
  const [copiado, setCopiado] = useState(false);
  return {
    copiado,
    copiar: (texto: string) => {
      void navigator.clipboard.writeText(texto);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 1500);
    },
  };
}

export function NetworkView({ token }: { token: string }) {
  const [data, setData] = useState<NetworkViewData | null>(null);
  const [borrador, setBorrador] = useState<NetworkSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { copiado, copiar } = useCopiado();

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
    return (
      <Seccion titulo="Red" grupo="Servidor">
        <p className="text-[11px] text-subtle">cargando</p>
      </Seccion>
    );
  }

  const cambiado = JSON.stringify(borrador) !== JSON.stringify(data.settings);

  return (
    <Seccion titulo="Red" grupo="Servidor">
      <div className="rounded-[11px] border border-border bg-panel p-[13px_15px]">
        <div className="mb-2.5 text-[8.5px] uppercase tracking-[.15em] text-subtle">Escucha y dirección pública</div>
        <Fila etiqueta="Puerto de escucha (TCP)">
          <input type="number" min={1} max={65535} value={borrador.bind_port}
            onChange={(e) => setBorrador({ ...borrador, bind_port: e.target.valueAsNumber || 0 })}
            className="w-[100px] rounded-[9px] border border-border bg-[#0d0f12] px-[11px] py-[6px] font-mono text-[12.5px] text-fg outline-none focus:border-white/40" />
        </Fila>
        <Fila etiqueta="Host público (dominio o IP)">
          <input type="text" placeholder="autodetectada" value={borrador.public_host ?? ""}
            onChange={(e) => setBorrador({ ...borrador, public_host: e.target.value || null })}
            className="w-[220px] rounded-[9px] border border-border bg-[#0d0f12] px-[11px] py-[6px] font-mono text-[12.5px] text-fg outline-none focus:border-white/40" />
        </Fila>
        <Fila etiqueta="Puerto público (si hay port-forwarding)">
          <input type="number" min={1} max={65535} placeholder={String(borrador.bind_port)}
            value={borrador.public_port ?? ""}
            onChange={(e) => setBorrador({ ...borrador, public_port: e.target.valueAsNumber || null })}
            className="w-[100px] rounded-[9px] border border-border bg-[#0d0f12] px-[11px] py-[6px] font-mono text-[12.5px] text-fg outline-none focus:border-white/40" />
        </Fila>
        <p className="mt-2 max-w-[54ch] text-[10.5px] text-subtle">
          El host/puerto público es lo que se incrusta en claves y tarjetas nuevas.
          Distinto del puerto de escucha solo si hay NAT, port-forwarding o un proxy TCP transparente de por medio.
        </p>
      </div>

      <div className="mt-4 rounded-[11px] border border-border bg-panel p-[13px_15px]">
        <div className="mb-2.5 text-[8.5px] uppercase tracking-[.15em] text-subtle">QUIC / HTTP-3 (opcional)</div>
        <Fila etiqueta="Activado">
          <div className="flex gap-1.5">
            {([true, false] as const).map((v) => (
              <button key={String(v)} onClick={() => setBorrador({ ...borrador, quic_enabled: v })}
                className={`rounded border px-2 py-1 text-[10.5px] transition-colors duration-300 ease-expo ${
                  borrador.quic_enabled === v ? "border-accent text-fg" : "border-border text-subtle"}`}>
                {v ? "activado" : "desactivado"}
              </button>
            ))}
          </div>
        </Fila>
        <Fila etiqueta="Puerto UDP">
          <input type="number" min={1} max={65535} value={borrador.quic_port}
            onChange={(e) => setBorrador({ ...borrador, quic_port: e.target.valueAsNumber || 0 })}
            className="w-[100px] rounded-[9px] border border-border bg-[#0d0f12] px-[11px] py-[6px] font-mono text-[12.5px] text-fg outline-none focus:border-white/40" />
        </Fila>
        <p className="mt-2 max-w-[54ch] text-[10.5px] text-subtle">
          El cliente de Lumi Station todavía habla TCP+TLS exclusivamente — activar esto
          no cambia nada para él hoy. Es infraestructura para el futuro, anunciada en /v1/hello.
        </p>
      </div>

      <div className="mt-4 rounded-[11px] border border-border bg-panel p-[13px_15px]">
        <div className="mb-2.5 text-[8.5px] uppercase tracking-[.15em] text-subtle">Tarjeta de servidor actual</div>
        <div className="flex items-center gap-2">
          <code className="flex-1 truncate rounded-[9px] border border-border bg-[#0d0f12] px-[11px] py-[6px] font-mono text-[11px] text-fg">
            {data.server_card}
          </code>
          <button onClick={() => copiar(data.server_card)}
            className="jg-press shrink-0 rounded-lg border border-white/15 px-2.5 py-1.5 text-[10.5px] text-fg">
            {copiado ? "Copiada" : "Copiar"}
          </button>
        </div>
        <p className="mt-2 text-[10.5px] text-subtle">
          Compártela con quien necesite reconectar tras un cambio de dirección — sustituye a pedir acceso por SSH.
        </p>
      </div>

      {error && <p className="mt-3 text-[11px] text-danger-fg">{error}</p>}

      <div className="mt-4 flex gap-2">
        <button onClick={guardar} disabled={busy || !cambiado}
          className="jg-press rounded-lg bg-accent px-3.5 py-1.5 text-[11px] font-medium text-black disabled:opacity-40">
          Guardar cambios
        </button>
        <button onClick={reiniciar} disabled={busy || !!data.restart_blocked_reason}
          title={data.restart_blocked_reason ?? undefined}
          className="jg-press rounded-lg border border-white/15 px-3.5 py-1.5 text-[11px] text-fg disabled:opacity-40">
          Reiniciar ahora
        </button>
        {data.restart_blocked_reason && (
          <span className="flex items-center gap-1.5 text-[10.5px] text-warning-fg">
            <Icon name="alert" size={11} /> {data.restart_blocked_reason}
          </span>
        )}
      </div>
      {cambiado && (
        <p className="mt-2 text-[10.5px] text-subtle">
          Cambiar puerto de escucha o QUIC exige reiniciar para aplicarse.
        </p>
      )}
    </Seccion>
  );
}

function Fila({ etiqueta, children }: { etiqueta: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 border-b border-border py-[9px] text-[11px] last:border-none">
      <span className="w-[220px] shrink-0 text-subtle">{etiqueta}</span>
      {children}
    </div>
  );
}
