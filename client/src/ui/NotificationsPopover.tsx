import { useEffect, useState } from "react";
import { api, type AdminRequest, type AvisoInfo, type Invite } from "../lib/api";
import { useServer } from "../lib/store";
import { AvisoEditor } from "../admin/AvisoEditor";
import { Avatar } from "./Avatar";
import { Icon, type IconName } from "./Icon";
import { usePopover } from "./TitleBar";

// Misma referencia siempre que no haya avisos: el selector de zustand exige
// que dos lecturas sin cambios devuelvan el mismo objeto — un `?? []` en el
// propio selector crea un array nuevo en cada render y `useSyncExternalStore`
// nunca deja de considerarlo "cambiado", lo que dispara un bucle infinito.
const SIN_AVISOS: AvisoInfo[] = [];

// Persistido en el propio cliente: no hay "recibos de lectura" en el
// servidor para esto, y no hace falta — es una marca puramente local, igual
// que el resto de estado de UI que no necesita sincronizarse entre sesiones.
// Sin esto, cada reinicio de la app perdía el set y todo volvía a marcarse
// como no leído, aunque ya se hubiera visto.
const LEIDO_KEY = "lumi.notificaciones.leido";

function cargarLeido(): Set<string> {
  try {
    const v = JSON.parse(localStorage.getItem(LEIDO_KEY) ?? "[]");
    return Array.isArray(v) ? new Set(v) : new Set();
  } catch {
    return new Set();
  }
}

function ago(ts: number): string {
  const s = Math.max(0, Math.floor(Date.now() / 1000) - ts);
  if (s < 60) return "ahora";
  if (s < 3600) return `${Math.floor(s / 60)} min`;
  if (s < 86400) return `${Math.floor(s / 3600)} h`;
  return `${Math.floor(s / 86400)} d`;
}

interface ItemBase { id: number; who: string; at: number }
/** `kind` decide el icono y qué botones salen: una invitación se acepta,
 *  una solicitud se aprueba, un aviso solo se lee — no hay nada que
 *  decidir, así que no lleva fila de acciones. */
type Item =
  | (ItemBase & { kind: "invite"; text: string })
  | (ItemBase & { kind: "access"; text: string })
  | (ItemBase & { kind: "aviso"; contenido: unknown; icono: IconName; prioridad: "normal" | "urgente" });

/** La campana no es un atajo al panel de administración: es la bandeja de todo
 *  lo que te espera. Para cualquiera, las invitaciones a proyectos y los
 *  avisos del administrador; para el administrador, además, las solicitudes
 *  de cuenta. Los avisos no vienen de una petición propia — ya llegan por la
 *  misma telemetría que alimenta la tira de mantenimiento, filtrados por el
 *  propio servidor a lo que le toca ver a esta sesión.
 *
 *  Filas, no tarjetas: cuatro tarjetas con borde propio en 300 px de ancho son
 *  cuatro cajas compitiendo. Lo no leído se marca con un punto en el margen y
 *  no con un fondo de color — cuatro fondos distintos harían un semáforo. */
export function NotificationsPopover({ onProjectAccepted }: {
  /** Aceptar una invitación cambia la lista de proyectos de otro componente,
   *  que no se entera por su cuenta. */
  onProjectAccepted?: () => void;
}) {
  const token = useServer((s) => s.token) ?? undefined;
  const isAdmin = useServer((s) => s.isAdmin);
  const sampleAvisos = useServer((s) => s.sample?.avisos ?? SIN_AVISOS);
  const [items, setItems] = useState<Item[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [leido, setLeido] = useState<Set<string>>(cargarLeido);
  const [open, setOpen, box] = usePopover();

  useEffect(() => {
    localStorage.setItem(LEIDO_KEY, JSON.stringify([...leido]));
  }, [leido]);

  async function load() {
    const out: Item[] = [];
    // Cada fuente en su propio try: que el administrador no pueda leer una lista
    // no es motivo para dejarle sin la otra.
    try {
      const invites = await api.get<Invite[]>("/v1/me/invites", token);
      invites.forEach((i) => out.push({
        kind: "invite", id: i.project_id, who: i.invited_by,
        text: `te invitó a «${i.project_name}»`, at: i.added_at,
      }));
    } catch { /* sin invitaciones legibles */ }
    if (isAdmin) {
      try {
        const reqs = await api.get<AdminRequest[]>("/v1/admin/access-requests", token);
        reqs.filter((r) => r.status === "pending").forEach((r) => out.push({
          kind: "access", id: r.id, who: r.display_name,
          text: "pide una cuenta", at: r.created_at,
        }));
      } catch { /* idem */ }
    }
    out.sort((a, b) => b.at - a.at);
    setItems(out);
  }

  useEffect(() => {
    void load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [isAdmin, token]);

  const key = (i: Item) => `${i.kind}:${i.id}`;

  async function resolver(i: Item, si: boolean) {
    if (i.kind === "aviso") return;
    setBusy(key(i));
    try {
      if (i.kind === "invite") {
        await api.post(`/v1/invites/${i.id}/${si ? "accept" : "decline"}`, {}, token);
        // El selector de proyectos ya está montado desde antes de que esto
        // pase y solo carga su lista una vez: sin avisarle, el proyecto
        // nuevo no aparecía hasta salir a un proyecto y volver, que es lo
        // único que lo remonta.
        if (si) onProjectAccepted?.();
      } else {
        await api.post(`/v1/admin/access-requests/${i.id}/resolve`,
          { approve: si, granted_models: si ? ["mini"] : undefined }, token);
      }
      await load();
    } finally {
      setBusy(null);
    }
  }

  const avisoItems: Item[] = sampleAvisos.map((a) => ({
    kind: "aviso", id: a.id, who: a.creado_por, at: a.created_at,
    contenido: a.contenido, icono: a.icono as IconName, prioridad: a.prioridad,
  }));
  // Los avisos urgentes van primero (el servidor ya los ordena así dentro de
  // sí mismos); el resto, invitaciones/solicitudes/avisos normales, por
  // fecha — mismo criterio que la lista de gestión de Notificaciones.
  const todos = [...avisoItems, ...(items ?? [])].sort((a, b) => {
    const au = a.kind === "aviso" && a.prioridad === "urgente";
    const bu = b.kind === "aviso" && b.prioridad === "urgente";
    if (au !== bu) return au ? -1 : 1;
    return b.at - a.at;
  });

  const pendientes = todos.filter((i) => !leido.has(key(i))).length;

  return (
    <div ref={box} className="relative">
      <button onClick={() => setOpen(!open)} aria-label="Notificaciones"
        className="relative grid h-[26px] w-[26px] place-items-center rounded-[7px] text-subtle
          transition-colors duration-300 ease-expo hover:bg-white/[.05] hover:text-fg">
        <Icon name="bell" size={14} />
        {pendientes > 0 && (
          <span className="absolute right-[3px] top-[3px] h-[6px] w-[6px] rounded-full bg-draw-fg"
            style={{ animation: "jg-core-pulse 1.8s ease-in-out infinite" }} />
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-[30px] z-[70] w-[308px] overflow-hidden rounded-[11px]
          border border-white/[.12] bg-[rgba(20,22,26,.97)] shadow-lg shadow-black/50 backdrop-blur-xl"
          style={{ animation: "jg-popup-scale-in 180ms cubic-bezier(.2,.85,.35,1) both" }}>

          <div className="flex items-center gap-2 border-b border-border px-[11px] py-2.5">
            <span className="flex-1 text-[11.5px] text-fg">Notificaciones</span>
            {pendientes > 0 && (
              <button onClick={() => setLeido(new Set(todos.map(key)))}
                className="text-[10.5px] text-subtle transition-colors hover:text-fg">
                Marcar todas
              </button>
            )}
          </div>

          <div className="max-h-[290px] overflow-y-auto p-1">
            {items === null && <p className="py-5 text-center text-[11px] text-subtle">cargando</p>}
            {items !== null && todos.length === 0 && (
              <p className="py-5 text-center text-[11px] text-subtle">nada que atender</p>
            )}

            {todos.map((i) => {
              const k = key(i);
              return (
                <div key={k}
                  className={`relative flex gap-[9px] rounded-[9px] py-2 pl-3 pr-[9px]
                    transition-colors duration-300 hover:bg-white/[.04] ${
                    i.kind === "aviso" && i.prioridad === "urgente" ? "bg-danger/[.06]" : ""}`}>
                  {!leido.has(k) && (
                    <span className="absolute left-1 top-[15px] h-[4px] w-[4px] rounded-full bg-draw" />
                  )}
                  {i.kind === "invite" ? (
                    <Avatar name={i.who} size={22} />
                  ) : i.kind === "access" ? (
                    <span className="grid h-[22px] w-[22px] shrink-0 place-items-center rounded-full
                      bg-warning/[.12] text-warning-fg">
                      <Icon name="shield" size={12} />
                    </span>
                  ) : (
                    <span className={`grid h-[22px] w-[22px] shrink-0 place-items-center rounded-full ${
                      i.prioridad === "urgente" ? "bg-danger/[.15] text-danger-fg" : "bg-draw/[.12] text-draw-fg"}`}>
                      <Icon name={i.icono} size={12} />
                    </span>
                  )}

                  <div className="min-w-0 flex-1">
                    {i.kind === "aviso" ? (
                      <div className="text-[11.5px] leading-snug text-muted">
                        <b className="font-medium text-fg">{i.who}</b>{" "}
                        <AvisoEditor contenido={i.contenido} editable={false} />
                      </div>
                    ) : (
                      <p className="text-[11.5px] leading-snug text-muted">
                        <b className="font-medium text-fg">{i.who}</b> {i.text}
                      </p>
                    )}
                    {i.kind !== "aviso" && (
                      <div className="mt-[7px] flex gap-1.5">
                        <button disabled={busy === k} onClick={() => void resolver(i, true)}
                          className="jg-press rounded-md bg-accent px-2.5 py-1 text-[10.5px] font-medium
                            text-black disabled:opacity-40">
                          {i.kind === "invite" ? "Aceptar" : "Aprobar"}
                        </button>
                        <button disabled={busy === k} onClick={() => void resolver(i, false)}
                          className="jg-press rounded-md border border-white/15 px-2.5 py-[3px]
                            text-[10.5px] text-fg disabled:opacity-40">
                          Rechazar
                        </button>
                      </div>
                    )}
                  </div>

                  <span className="shrink-0 pt-0.5 font-mono text-[9.5px] text-[#4a4d52]">{ago(i.at)}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
