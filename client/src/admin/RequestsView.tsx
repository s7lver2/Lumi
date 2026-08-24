import { useEffect, useState } from "react";
import { api, type AdminRequest, type CreditRequestInfo } from "../lib/api";
import { KNOWN_MODELS as MODELS } from "../lib/models";
import { Icon } from "../ui/Icon";

function cuando(ts: number): string {
  return new Date(ts * 1000).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function Dato({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-border py-[5px] text-[10px] last:border-none">
      <span className="tracking-[.03em] text-subtle">{k}</span>
      <b className="text-right font-mono font-normal text-muted">{v}</b>
    </div>
  );
}

/** Icono circular por tipo, mismo tratamiento que ya usa
 *  `NotificationsPopover` para distinguir acceso/aviso — nunca una columna
 *  nueva en el grid, que ya está ajustado a mano para 4. */
function TipoIcono({ tipo }: { tipo: "acceso" | "credito" }) {
  return tipo === "acceso" ? (
    <span className="grid h-[22px] w-[22px] shrink-0 place-items-center rounded-full bg-warning/[.12] text-warning-fg">
      <Icon name="shield" size={12} />
    </span>
  ) : (
    <span className="grid h-[22px] w-[22px] shrink-0 place-items-center rounded-full bg-draw/[.12] text-draw-fg">
      <Icon name="lock" size={12} />
    </span>
  );
}

type Fila =
  | { tipo: "acceso"; r: AdminRequest }
  | { tipo: "credito"; r: CreditRequestInfo };

export function RequestsView({ token }: { token: string }) {
  const [acceso, setAcceso] = useState<AdminRequest[]>([]);
  const [credito, setCredito] = useState<CreditRequestInfo[]>([]);
  const [granted, setGranted] = useState<Record<number, string[]>>({});
  const [comoAdmin, setComoAdmin] = useState<Record<number, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [abierta, setAbierta] = useState<string | null>(null);

  const load = () => {
    api.get<AdminRequest[]>("/v1/admin/access-requests", token).then(setAcceso).catch((e) => setError(String(e)));
    api.get<CreditRequestInfo[]>("/v1/admin/credit-requests", token).then(setCredito).catch((e) => setError(String(e)));
  };

  useEffect(() => { load(); }, []);

  async function resolveAcceso(id: number, approve: boolean) {
    try {
      await api.post(`/v1/admin/access-requests/${id}/resolve`,
        { approve, granted_models: approve ? granted[id] ?? ["mini"] : undefined, as_admin: !!comoAdmin[id] }, token);
      load();
    } catch (e) { setError(String(e)); load(); }
  }

  async function resolveCredito(id: number, approve: boolean) {
    try {
      await api.post(`/v1/admin/credit-requests/${id}/resolve`, { approve }, token);
      load();
    } catch (e) { setError(String(e)); load(); }
  }

  const toggle = (id: number, m: string) =>
    setGranted((g) => {
      const cur = g[id] ?? ["mini"];
      return { ...g, [id]: cur.includes(m) ? cur.filter((x) => x !== m) : [...cur, m] };
    });

  const filas: Fila[] = [
    ...acceso.map((r): Fila => ({ tipo: "acceso", r })),
    ...credito.map((r): Fila => ({ tipo: "credito", r })),
  ].sort((a, b) => b.r.created_at - a.r.created_at);

  const pendientes = filas.filter((f) => f.r.status === "pending").length;
  const key = (f: Fila) => `${f.tipo}:${f.r.id}`;

  return (
    <>
      <p className="mb-4 text-xs text-muted">
        {pendientes} pendientes · provisional, el panel llega en el subsistema 3.
      </p>
      {error && <p className="mb-3 text-xs text-danger-fg">{error}</p>}

      {filas.length === 0 && (
        <div className="flex items-center gap-2.5 text-xs text-muted">
          <Icon name="user" /> No hay solicitudes.
        </div>
      )}

      {filas.map((f) => {
        const k = key(f);
        const abiertaAqui = abierta === k;
        return (
          <div key={k} className={`border-t border-border first:border-t-0 ${f.r.status !== "pending" ? "opacity-45" : ""}`}>
            <button onClick={() => setAbierta(abiertaAqui ? null : k)}
              className="grid w-full grid-cols-[1fr_122px_92px_22px] items-center gap-3 px-3.5 py-3 text-left transition-[background-color,padding-left] duration-[400ms] ease-expo hover:bg-white/[.03] hover:pl-[17px]">
              <span className="flex min-w-0 items-center gap-2 text-[11.5px] text-fg">
                <TipoIcono tipo={f.tipo} />
                <span className="flex min-w-0 items-baseline gap-2">
                  {f.tipo === "acceso" ? f.r.display_name : f.r.username}
                  <small className="truncate text-[9.5px] text-subtle">
                    {f.tipo === "acceso" ? f.r.message.slice(0, 48) : `${f.r.tipo} ${f.r.valor_actual} → ${f.r.valor_propuesto}`}
                  </small>
                </span>
              </span>
              <span className="font-mono text-[10.5px] text-muted">{cuando(f.r.created_at)}</span>
              <span className="text-right">
                <span className="rounded-[5px] border border-warning/40 px-1.5 py-px text-[8.5px] tracking-[.05em] text-warning-fg">
                  esperando
                </span>
              </span>
              <span className={`flex justify-end text-subtle transition-transform duration-500 ease-expo ${abiertaAqui ? "rotate-180 text-fg" : ""}`}>
                <Icon name="chevron" size={13} />
              </span>
            </button>

            <div className={`grid transition-[grid-template-rows] duration-[550ms] ease-expo ${abiertaAqui ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}>
              <div className="overflow-hidden">
                {f.tipo === "acceso" ? (
                  <div className="grid grid-cols-[1fr_262px] gap-5 px-3.5 pb-4 pt-0.5">
                    <div>
                      <span className="mb-1.5 block text-[8.5px] uppercase tracking-[.15em] text-subtle">Lo que escribió</span>
                      <p className="border-l-2 border-border py-0.5 pl-3 text-[11.5px] italic leading-[1.75] text-muted">{f.r.message}</p>
                    </div>
                    <div className="flex flex-col">
                      <Dato k="dispositivo" v={f.r.device ?? "no consta"} />
                      <Dato k="dirección" v={`${f.r.source_ip} · ${f.r.external ? "fuera de la red local" : "red local"}`} />
                      <Dato k="solicitado" v={new Date(f.r.created_at * 1000).toISOString().slice(0, 16).replace("T", " ")} />
                    </div>
                    <div className="col-span-2 flex items-center gap-2.5 pt-1">
                      <span className="mr-auto text-[10px] text-subtle">Al aprobar entra con los límites globales; se ajustan luego en Usuarios.</span>
                      {f.r.status === "pending" && (
                        <div className="flex items-center gap-2">
                          <button onClick={() => resolveAcceso(f.r.id, true)} className="rounded-lg bg-accent px-3 py-1.5 text-[11px] font-medium text-black active:translate-y-px">Aprobar</button>
                          <button onClick={() => resolveAcceso(f.r.id, false)} className="rounded-lg border border-white/15 px-3 py-1.5 text-[11px] text-fg active:translate-y-px">Rechazar</button>
                          <span className="ml-auto flex items-center gap-1.5 text-[11px] text-subtle">
                            entra como:
                            {(["usuario", "admin"] as const).map((rol) => {
                              const on = rol === "admin" ? !!comoAdmin[f.r.id] : !comoAdmin[f.r.id];
                              return (
                                <button key={rol}
                                  onClick={() => setComoAdmin((s) => ({ ...s, [f.r.id]: rol === "admin" }))}
                                  className={`rounded border px-1.5 py-0.5 text-[10.5px] capitalize transition-colors duration-300 ease-expo ${on ? "border-accent text-fg" : "border-border text-subtle"}`}>
                                  {rol}
                                </button>
                              );
                            })}
                          </span>
                          <span className="flex items-center gap-1.5 text-[11px] text-subtle">
                            conceder:
                            {MODELS.map((m) => {
                              const on = (granted[f.r.id] ?? ["mini"]).includes(m);
                              return (
                                <button key={m} onClick={() => toggle(f.r.id, m)}
                                  className={`rounded border px-1.5 py-0.5 text-[10.5px] transition-colors duration-300 ease-expo ${on ? "border-accent text-fg" : "border-border text-subtle"}`}>
                                  {m}
                                </button>
                              );
                            })}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-[1fr_262px] gap-5 px-3.5 pb-4 pt-0.5">
                    <div className="flex flex-col">
                      <Dato k="valor actual" v={`${f.r.valor_actual} / ${f.r.tipo === "diario" ? "día" : "semana"}`} />
                      <Dato k="valor propuesto" v={`${f.r.valor_propuesto} / ${f.r.tipo === "diario" ? "día" : "semana"}`} />
                      {f.r.mensaje && <Dato k="motivo" v={f.r.mensaje} />}
                    </div>
                    <div className="flex items-end justify-end gap-2">
                      {f.r.status === "pending" && (
                        <>
                          <button onClick={() => resolveCredito(f.r.id, false)} className="rounded-lg border border-white/15 px-3 py-1.5 text-[11px] text-fg active:translate-y-px">Rechazar</button>
                          <button onClick={() => resolveCredito(f.r.id, true)} className="rounded-lg bg-accent px-3 py-1.5 text-[11px] font-medium text-black active:translate-y-px">Aprobar</button>
                        </>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </>
  );
}
