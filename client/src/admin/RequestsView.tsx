import { useEffect, useState } from "react";
import { api, type AdminRequest } from "../lib/api";
import { KNOWN_MODELS as MODELS } from "../lib/models";
import { Icon } from "../ui/Icon";

function cuando(ts: number): string {
  return new Date(ts * 1000).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function Dato({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-border py-[5px] text-[10px] last:border-none">
      <span className="tracking-[.03em] text-subtle">{k}</span>
      <b className="text-right font-mono font-normal text-muted">{v}</b>
    </div>
  );
}

export function RequestsView({ token }: { token: string }) {
  const [rows, setRows] = useState<AdminRequest[]>([]);
  const [granted, setGranted] = useState<Record<number, string[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [abierta, setAbierta] = useState<number | null>(null);

  const load = () =>
    api
      .get<AdminRequest[]>("/v1/admin/access-requests", token)
      .then(setRows)
      .catch((e) => setError(String(e)));

  useEffect(() => {
    load();
  }, []);

  async function resolve(id: number, approve: boolean) {
    try {
      await api.post(
        `/v1/admin/access-requests/${id}/resolve`,
        { approve, granted_models: approve ? granted[id] ?? ["mini"] : undefined },
        token
      );
      load();
    } catch (e) {
      setError(String(e));
      load();
    }
  }

  const toggle = (id: number, m: string) =>
    setGranted((g) => {
      const cur = g[id] ?? ["mini"];
      return { ...g, [id]: cur.includes(m) ? cur.filter((x) => x !== m) : [...cur, m] };
    });

  const pending = rows.filter((r) => r.status === "pending");

  return (
    <>
      <p className="mb-4 text-xs text-muted">
        {pending.length} pendientes · provisional, el panel llega en el subsistema 3.
      </p>
      {error && <p className="mb-3 text-xs text-danger-fg">{error}</p>}

      {rows.length === 0 && (
        <div className="flex items-center gap-2.5 text-xs text-muted">
          <Icon name="user" /> No hay solicitudes.
        </div>
      )}

      {rows.map((r) => (
        <div
          key={r.id}
          className={`border-t border-border first:border-t-0 ${
            r.status !== "pending" ? "opacity-45" : ""
          }`}
        >
          {/* Cabecera pulsable */}
          <button
            onClick={() => setAbierta(abierta === r.id ? null : r.id)}
            className="grid w-full grid-cols-[1fr_122px_92px_22px] items-center gap-3 px-3.5 py-3 text-left transition-[background-color,padding-left] duration-[400ms] ease-expo hover:bg-white/[.03] hover:pl-[17px]"
          >
            <span className="flex min-w-0 items-baseline gap-2 text-[11.5px] text-fg">
              {r.display_name}
              <small className="truncate text-[9.5px] text-subtle">
                {r.message.slice(0, 48)}
              </small>
            </span>
            <span className="font-mono text-[10.5px] text-muted">
              {cuando(r.created_at)}
            </span>
            <span className="text-right">
              <span className="rounded-[5px] border border-warning/40 px-1.5 py-px text-[8.5px] tracking-[.05em] text-warning-fg">
                esperando
              </span>
            </span>
            <span
              className={`flex justify-end text-subtle transition-transform duration-500 ease-expo ${
                abierta === r.id ? "rotate-180 text-fg" : ""
              }`}
            >
              <Icon name="chevron" size={13} />
            </span>
          </button>

          {/* Cuerpo desplegable */}
          <div
            className={`grid transition-[grid-template-rows] duration-[550ms] ease-expo ${
              abierta === r.id ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
            }`}
          >
            <div className="overflow-hidden">
              <div className="grid grid-cols-[1fr_262px] gap-5 px-3.5 pb-4 pt-0.5">
                <div>
                  <span className="mb-1.5 block text-[8.5px] uppercase tracking-[.15em] text-subtle">
                    Lo que escribió
                  </span>
                  <p className="border-l-2 border-border py-0.5 pl-3 text-[11.5px] italic leading-[1.75] text-muted">
                    {r.message}
                  </p>
                </div>
                <div className="flex flex-col">
                  <Dato k="dispositivo" v={r.device ?? "no consta"} />
                  <Dato
                    k="dirección"
                    v={`${r.source_ip} · ${
                      r.external ? "fuera de la red local" : "red local"
                    }`}
                  />
                  <Dato
                    k="solicitado"
                    v={new Date(r.created_at * 1000)
                      .toISOString()
                      .slice(0, 16)
                      .replace("T", " ")}
                  />
                </div>
                <div className="col-span-2 flex items-center gap-2.5 pt-1">
                  <span className="mr-auto text-[10px] text-subtle">
                    Al aprobar entra con los límites globales; se ajustan luego en Usuarios.
                  </span>

                  {/* Botones de resolver – conservados exactamente igual */}
                  {r.status === "pending" && (
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => resolve(r.id, true)}
                        className="rounded-lg bg-accent px-3 py-1.5 text-[11px] font-medium text-black active:translate-y-px"
                      >
                        Aprobar
                      </button>
                      <button
                        onClick={() => resolve(r.id, false)}
                        className="rounded-lg border border-white/15 px-3 py-1.5 text-[11px] text-fg active:translate-y-px"
                      >
                        Rechazar
                      </button>
                      <span className="ml-auto flex items-center gap-1.5 text-[11px] text-subtle">
                        conceder:
                        {MODELS.map((m) => {
                          const on = (granted[r.id] ?? ["mini"]).includes(m);
                          return (
                            <button
                              key={m}
                              onClick={() => toggle(r.id, m)}
                              className={`rounded border px-1.5 py-0.5 text-[10.5px] transition-colors duration-300 ease-expo ${
                                on
                                  ? "border-accent text-fg"
                                  : "border-border text-subtle"
                              }`}
                            >
                              {m}
                            </button>
                          );
                        })}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      ))}
    </>
  );
}