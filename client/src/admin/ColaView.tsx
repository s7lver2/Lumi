import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { api, type EventoAdmin, type PendienteView, type QueueView } from "../lib/api";
import { ago } from "../lib/time";
import { Icon } from "../ui/Icon";
import { UserTile } from "../ui/UserTile";
import { Seccion } from "./AdminPanel";

const RAZON_LABEL: Record<string, string> = {
  bloqueado: "bloqueado",
  desconectado: "sin conexión",
  limite_alcanzado: "límite alcanzado",
};

type Vista = "cinta" | "tabla";

export function ColaView({ token, onAbrirUsuario }: {
  token: string; onAbrirUsuario: (id: number) => void;
}) {
  const [q, setQ] = useState<QueueView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [vista, setVista] = useState<Vista>(
    () => (localStorage.getItem("lumi.cola.vista") as Vista) ?? "cinta"
  );

  useEffect(() => {
    localStorage.setItem("lumi.cola.vista", vista);
  }, [vista]);

  const cargar = useCallback(
    () =>
      api.get<QueueView>("/v1/queue", token)
        .then((v) => { setQ(v); setError(null); })
        .catch((e) => setError(String(e))),
    [token]
  );

  useEffect(() => {
    void cargar();
    const un = listen<EventoAdmin>("admin-events", (e) => {
      if (e.payload === "ColaCambio") void cargar();
    });
    return () => { void un.then((f) => f()); };
  }, [cargar]);

  const listos = q?.trabajadores.filter((w) => w.listo).length ?? 0;

  return (
    <Seccion titulo="Cola" grupo="Operación">
      <div className="mb-4 flex gap-2.5">
        <div className="flex-1 rounded-[11px] border border-border bg-panel p-3">
          <div className="font-mono text-[19px] text-fg">{q?.pendientes ?? "—"}</div>
          <div className="mt-0.5 text-[10px] text-muted">pendientes</div>
        </div>
        <div className="flex-1 rounded-[11px] border border-border bg-panel p-3">
          <div className="font-mono text-[19px] text-fg">{q?.en_curso ?? "—"}</div>
          <div className="mt-0.5 text-[10px] text-muted">en curso</div>
        </div>
        <div className="flex-1 rounded-[11px] border border-border bg-panel p-3">
          <div className="font-mono text-[19px] text-fg">{listos}/{q?.trabajadores.length ?? 0}</div>
          <div className="mt-0.5 text-[10px] text-muted">trabajadores listos</div>
        </div>
      </div>

      <div className="mb-4 inline-flex gap-0.5 rounded-lg border border-border bg-elevated p-[3px]">
        {(["cinta", "tabla"] as const).map((v) => (
          <button key={v} onClick={() => setVista(v)}
            className={`rounded-md px-3 py-1 text-[11px] capitalize transition-colors ${
              vista === v ? "bg-panel text-fg" : "text-subtle hover:text-fg"
            }`}>
            {v}
          </button>
        ))}
      </div>

      {error && <p className="text-[11px] text-danger-fg">{error}</p>}
      {!error && q === null && <p className="text-[11px] text-subtle">cargando</p>}

      {q && (vista === "cinta"
        ? <VistaCinta q={q} token={token} onAbrirUsuario={onAbrirUsuario} onCambiado={cargar} />
        : <VistaTabla q={q} token={token} onAbrirUsuario={onAbrirUsuario} onCambiado={cargar} />)}
    </Seccion>
  );
}

function BadgeRazon({ razon }: { razon: PendienteView["razon"] }) {
  if (!razon) return <span className="text-[10.5px] text-subtle">esperando hueco</span>;
  return (
    <span className={`rounded-full px-2 py-0.5 text-[9.5px] ${
      razon === "bloqueado" ? "bg-danger/[.12] text-danger-fg" : "bg-warning/[.12] text-warning-fg"
    }`}>
      {RAZON_LABEL[razon]}
    </span>
  );
}

function VistaTabla({ q, token, onAbrirUsuario, onCambiado }: {
  q: QueueView; token: string; onAbrirUsuario: (id: number) => void; onCambiado: () => void;
}) {
  return (
    <>
      <table className="w-full border-collapse text-[11.5px]">
        <thead>
          <tr className="text-left text-[9.5px] uppercase tracking-[.08em] text-subtle">
            <th className="border-b border-border px-2.5 py-2 font-normal">Dueño</th>
            <th className="border-b border-border px-2.5 py-2 font-normal">Caso</th>
            <th className="border-b border-border px-2.5 py-2 font-normal">Nivel</th>
            <th className="border-b border-border px-2.5 py-2 font-normal">Esperando</th>
            <th className="border-b border-border px-2.5 py-2 font-normal">Motivo</th>
            <th className="border-b border-border px-2.5 py-2 font-normal" />
          </tr>
        </thead>
        <tbody>
          {q.pendientes_detalle.length === 0 ? (
            <tr><td colSpan={6} className="px-2.5 py-4 text-[11px] text-subtle">nada esperando turno</td></tr>
          ) : q.pendientes_detalle.map((p) => (
            <FilaPendiente key={p.id} p={p} token={token} onAbrirUsuario={onAbrirUsuario} onCambiado={onCambiado} />
          ))}
        </tbody>
      </table>

      <div className="mb-2 mt-6 text-[8.5px] uppercase tracking-[.15em] text-subtle">Trabajadores</div>
      {q.trabajadores.length === 0 ? (
        <p className="text-[11px] text-subtle">ningún trabajador ha llegado a lanzarse</p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {q.trabajadores.map((w) => (
            <div key={w.dispositivo}
              className="flex items-center gap-2.5 rounded-lg border border-border px-2.5 py-1.5">
              <Icon name={w.listo ? "check" : "clock"} size={12}
                className={w.listo ? "text-draw-fg" : "text-subtle"} />
              <span className="font-mono text-[11px] text-fg">{w.dispositivo}</span>
              <span className="text-[10.5px] text-subtle">
                {w.listo
                  ? (w.modelo ? `listo · ${w.modelo}` : "listo · sin modelo cargado")
                  : "cargando todavía"}
              </span>
              {w.trabajo !== null && (
                <span className="ml-auto font-mono text-[10.5px] text-muted">análisis #{w.trabajo}</span>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function FilaPendiente({ p, token, onAbrirUsuario, onCambiado }: {
  p: PendienteView; token: string; onAbrirUsuario: (id: number) => void; onCambiado: () => void;
}) {
  const [confirmando, setConfirmando] = useState(false);
  const [cancelando, setCancelando] = useState(false);
  const [fallo, setFallo] = useState<string | null>(null);

  async function cancelar() {
    setCancelando(true);
    setFallo(null);
    try {
      await api.del(`/v1/analyses/${p.id}`, token);
      onCambiado();
    } catch (e) {
      setFallo(String(e));
      setCancelando(false);
      setConfirmando(false);
    }
  }

  return (
    <tr className="hover:bg-white/[.015]">
      <td className="border-b border-border px-2.5 py-2">
        <button onClick={() => onAbrirUsuario(p.user_id)}
          className="text-fg underline decoration-border decoration-1 underline-offset-2 hover:decoration-fg">
          {p.username}
        </button>
      </td>
      <td className="border-b border-border px-2.5 py-2 text-fg">{p.case_nombre}</td>
      <td className="border-b border-border px-2.5 py-2 font-mono text-muted">{p.nivel}</td>
      <td className="border-b border-border px-2.5 py-2 font-mono text-muted">{ago(p.creado_en)}</td>
      <td className="border-b border-border px-2.5 py-2"><BadgeRazon razon={p.razon} /></td>
      <td className="border-b border-border px-2.5 py-2 text-right">
        {fallo && <div className="mb-1 text-[9.5px] text-danger-fg">{fallo}</div>}
        {confirmando ? (
          <span className="inline-flex items-center gap-2 text-[10.5px]">
            <span className="text-warning-fg">¿seguro?</span>
            <button onClick={() => setConfirmando(false)} className="text-subtle">no</button>
            <button onClick={cancelar} disabled={cancelando}
              className="rounded-lg border border-danger/40 px-2 py-1 text-danger-fg">sí</button>
          </span>
        ) : (
          <button onClick={() => setConfirmando(true)}
            className="rounded-lg border border-danger/40 px-2.5 py-1 text-[10.5px] text-danger-fg">
            cancelar
          </button>
        )}
      </td>
    </tr>
  );
}

/** Anima una tarjeta volando de su posición actual (el pool de pendientes)
 *  hasta el carril del trabajador que la recogió — un nodo aparte, fuera de
 *  React, porque es una animación de un único disparo entre dos árboles de
 *  React distintos (el pool y los carriles), no un estado que algo deba
 *  recordar. Se borra sola al terminar. */
function volar(origenEl: HTMLElement, laneEl: HTMLElement, texto: string) {
  const from = origenEl.getBoundingClientRect();
  const to = laneEl.getBoundingClientRect();
  const ghost = document.createElement("div");
  ghost.className = "rounded-[10px] border border-border bg-panel px-2.5 py-2 text-[11px] text-fg";
  ghost.style.position = "fixed";
  ghost.style.zIndex = "60";
  ghost.style.pointerEvents = "none";
  ghost.style.left = `${from.left}px`;
  ghost.style.top = `${from.top}px`;
  ghost.style.width = `${from.width}px`;
  ghost.style.transition = "transform .55s cubic-bezier(.22,1,.36,1), opacity .55s ease";
  ghost.textContent = texto;
  document.body.appendChild(ghost);
  const dx = to.left + 44 - from.width / 2 - from.left;
  const dy = to.top + to.height / 2 - from.height / 2 - from.top;
  requestAnimationFrame(() => {
    ghost.style.transform = `translate(${dx}px, ${dy}px) scale(.82)`;
    ghost.style.opacity = "0";
  });
  setTimeout(() => ghost.remove(), 600);
}

function VistaCinta({ q, token, onAbrirUsuario, onCambiado }: {
  q: QueueView; token: string; onAbrirUsuario: (id: number) => void; onCambiado: () => void;
}) {
  const [pool, setPool] = useState<PendienteView[]>(q.pendientes_detalle);
  const [saliendo, setSaliendo] = useState<Set<number>>(new Set());
  const poolRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const laneRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const primerRender = useRef(true);

  // Cuando llega un `q` nuevo, un pendiente que estaba en el pool y ya no
  // está pudo pasar por dos caminos: un trabajador lo recogió (vuela hasta
  // su carril) o alguien lo canceló (se desvanece donde estaba). Ambos se
  // quedan un instante en pantalla en vez de desaparecer de golpe.
  useEffect(() => {
    if (primerRender.current) {
      primerRender.current = false;
      setPool(q.pendientes_detalle);
      return;
    }
    const nuevosIds = new Set(q.pendientes_detalle.map((p) => p.id));
    const seFueron = pool.filter((p) => !nuevosIds.has(p.id));
    if (seFueron.length === 0) {
      setPool(q.pendientes_detalle);
      return;
    }
    seFueron.forEach((p) => {
      const destino = q.trabajadores.find((w) => w.trabajo === p.id);
      const origenEl = poolRefs.current.get(p.id);
      const laneEl = destino && laneRefs.current.get(destino.dispositivo);
      if (origenEl && laneEl) volar(origenEl, laneEl, p.username);
    });
    setSaliendo((s) => new Set([...s, ...seFueron.map((p) => p.id)]));
    const t = setTimeout(() => {
      setSaliendo((s) => {
        const n = new Set(s);
        seFueron.forEach((p) => n.delete(p.id));
        return n;
      });
      setPool(q.pendientes_detalle);
    }, 560);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  return (
    <div className="grid grid-cols-[224px_1fr] gap-5">
      <div>
        <div className="mb-2.5 text-[8.5px] uppercase tracking-[.16em] text-subtle">Pendientes</div>
        <div className="flex flex-col gap-2">
          {pool.length === 0 && <p className="text-[11px] text-subtle">nada esperando turno</p>}
          {pool.map((p) => (
            <div key={p.id}
              ref={(el) => { if (el) poolRefs.current.set(p.id, el); else poolRefs.current.delete(p.id); }}
              className={`flex items-center gap-2 rounded-[11px] border border-border bg-panel p-2 transition-all duration-300 ${
                saliendo.has(p.id) ? "scale-95 opacity-0" : "opacity-100"
              }`}
              style={saliendo.has(p.id) ? undefined : { animation: "jg-fade-rise .4s cubic-bezier(.22,1,.36,1) both" }}>
              <UserTile nombre={p.username} conectado={!p.razon} userId={p.user_id} size={27} />
              <div className="min-w-0 flex-1">
                <button onClick={() => onAbrirUsuario(p.user_id)}
                  className="block truncate text-[10.5px] text-fg hover:underline">
                  {p.username}
                </button>
                <div className="truncate text-[9px] text-muted">{p.case_nombre}</div>
                <div className="mt-1 flex flex-wrap items-center gap-1">
                  <span className="rounded-[4px] bg-elevated px-1.5 py-px text-[8.5px] text-muted">{p.nivel}</span>
                  {p.razon && (
                    <span className={`rounded-full px-1.5 py-px text-[8.5px] ${
                      p.razon === "bloqueado" ? "bg-danger/[.13] text-danger-fg" : "bg-warning/[.13] text-warning-fg"
                    }`}>
                      {RAZON_LABEL[p.razon]}
                    </span>
                  )}
                </div>
              </div>
              <BotonCancelar id={p.id} token={token} onCambiado={onCambiado} />
            </div>
          ))}
        </div>
      </div>

      <div>
        {q.trabajadores.length === 0 ? (
          <p className="text-[11px] text-subtle">ningún trabajador ha llegado a lanzarse</p>
        ) : q.trabajadores.map((w) => (
          <div key={w.dispositivo} className="border-t border-border py-3.5 first:border-t-0">
            <div className="mb-2.5 flex items-baseline gap-2 px-1">
              <span className="font-mono text-[12px] text-fg">{w.dispositivo}</span>
              <span className="text-[9.5px] text-subtle">
                {w.listo ? (w.modelo ? `nivel ${w.modelo} cargado` : "listo") : "cargando todavía"}
              </span>
            </div>
            <div ref={(el) => { if (el) laneRefs.current.set(w.dispositivo, el); else laneRefs.current.delete(w.dispositivo); }}
              className={`relative flex h-[62px] items-center overflow-hidden rounded-[11px] border border-border bg-panel/40 ${
                w.trabajo !== null ? "px-[44px]" : "justify-center"
              }`}>
              {w.trabajo !== null && (
                <div className="absolute inset-y-0 left-[44px] w-0 border-l border-dashed border-border" />
              )}
              {w.trabajo !== null ? (
                <div key={w.trabajo}
                  className="relative flex w-[150px] items-center gap-2 rounded-[10px] border border-white/[.18] bg-elevated p-2 shadow-[0_2px_10px_rgba(0,0,0,.25)]"
                  style={{ animation: "jg-fade-rise .4s cubic-bezier(.22,1,.36,1) both" }}>
                  <div className="pointer-events-none absolute inset-0 animate-pulse rounded-[10px] border border-white/20" />
                  <UserTile nombre={w.dueno_actual ?? "?"} conectado userId={w.dueno_actual_id ?? undefined} size={26} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[10.5px] text-fg">{w.dueno_actual}</div>
                    <div className="truncate text-[9px] text-muted">{w.caso_actual}</div>
                  </div>
                </div>
              ) : (
                <span className="text-[10.5px] text-subtle">sin trabajo activo</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function BotonCancelar({ id, token, onCambiado }: { id: number; token: string; onCambiado: () => void }) {
  const [confirmando, setConfirmando] = useState(false);
  const [cancelando, setCancelando] = useState(false);

  async function cancelar() {
    setCancelando(true);
    try {
      await api.del(`/v1/analyses/${id}`, token);
      onCambiado();
    } catch {
      setCancelando(false);
      setConfirmando(false);
    }
  }

  if (confirmando) {
    return (
      <span className="ml-auto flex shrink-0 items-center gap-1.5 text-[9.5px]">
        <button onClick={() => setConfirmando(false)} className="text-subtle">no</button>
        <button onClick={cancelar} disabled={cancelando} className="text-danger-fg">sí</button>
      </span>
    );
  }
  return (
    <button onClick={() => setConfirmando(true)}
      className="ml-auto shrink-0 text-[9.5px] text-subtle hover:text-danger-fg">
      cancelar
    </button>
  );
}
