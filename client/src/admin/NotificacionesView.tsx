import { useEffect, useState } from "react";
import { api, type AvisoInfo, type UserSummary } from "../lib/api";
import { Avatar } from "../ui/Avatar";
import { Icon, type IconName } from "../ui/Icon";
import { usePopover } from "../ui/TitleBar";
import { AvisoEditor } from "./AvisoEditor";
import { Seccion } from "./AdminPanel";

const ICONOS: IconName[] = ["bell", "alert", "wrench", "boxes", "cloud", "shield", "globe", "layers"];
const DOC_VACIO = { type: "doc", content: [{ type: "paragraph" }] };

/** Los dos grupos con los que `#` puede referirse a todo el mundo de golpe,
 *  en vez de tener que elegir personas una a una. */
const GRUPOS: { valor: "todos" | "admins"; nombre: string; label: string }[] = [
  { valor: "todos", nombre: "todos", label: "Todos" },
  { valor: "admins", nombre: "administradores", label: "Administradores" },
];

type Chip = { tipo: "grupo"; valor: "todos" | "admins"; label: string } | { tipo: "usuario"; valor: string };

function ago(ts: number): string {
  const s = Math.max(0, Math.floor(Date.now() / 1000) - ts);
  if (s < 60) return "ahora";
  if (s < 3600) return `${Math.floor(s / 60)} min`;
  if (s < 86400) return `${Math.floor(s / 3600)} h`;
  return `${Math.floor(s / 86400)} d`;
}

export function NotificacionesView({ token }: { token: string }) {
  const [avisos, setAvisos] = useState<AvisoInfo[] | null>(null);
  const [componiendo, setComponiendo] = useState(false);

  function cargar() { return api.get<AvisoInfo[]>("/v1/admin/avisos", token).then(setAvisos); }
  useEffect(() => { void cargar(); }, [token]);

  async function borrar(id: number) {
    await api.del(`/v1/avisos/${id}`, token);
    void cargar();
  }

  return (
    <Seccion titulo="Notificaciones" grupo="Operación">
      <p className="text-[11px] text-muted">Avisos escritos por ti para quien esté conectado.</p>

      <div className="mt-4 flex items-baseline gap-3">
        <h3 className="text-[12.5px] font-medium">Avisos activos</h3>
        <button onClick={() => setComponiendo(true)}
          className="jg-press ml-auto rounded-lg bg-accent px-3 py-1.5 text-[11px] font-medium text-black">
          + Nueva notificación
        </button>
      </div>
      <div className="mt-2.5 rounded-card border border-border bg-panel">
        {(avisos ?? []).length === 0 && <p className="p-6 text-center text-[11px] text-subtle">Sin avisos.</p>}
        {(avisos ?? []).map((a, i) => (
          <div key={a.id}
            className={`flex items-start gap-3 border-b border-border p-[12px_16px] last:border-b-0 ${
              a.prioridad === "urgente" ? "bg-danger/[.04]" : ""}`}
            style={{ animation: `jg-fade-rise .38s ${Math.min(i, 6) * 35}ms cubic-bezier(.16,1,.3,1) both` }}>
            <span className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full ${
              a.prioridad === "urgente" ? "bg-danger/[.15] text-danger-fg" : "bg-draw/[.12] text-draw-fg"}`}>
              <Icon name={a.icono as IconName} size={12} />
            </span>
            <div className="min-w-0 flex-1">
              <AvisoEditor contenido={a.contenido} editable={false} />
              <p className="mt-1.5 flex items-center gap-2 text-[10px] text-subtle">
                {a.creado_por} · hace {ago(a.created_at)}
                {a.prioridad === "urgente" && (
                  <span className="rounded bg-danger/[.18] px-1.5 py-px text-[8.5px] uppercase text-danger-fg">urgente</span>
                )}
                <span className="rounded border border-border bg-elevated px-1.5 py-px text-[8.5px] text-subtle">{a.destino}</span>
              </p>
            </div>
            <button onClick={() => void borrar(a.id)}
              className="jg-press shrink-0 rounded-lg border border-danger/40 px-2.5 py-1 text-[9.5px] text-danger-fg">Eliminar</button>
          </div>
        ))}
      </div>

      {componiendo && (
        <ModalComponer token={token} onCerrar={() => setComponiendo(false)} onPublicado={() => { setComponiendo(false); void cargar(); }} />
      )}
    </Seccion>
  );
}

function ModalComponer({ token, onCerrar, onPublicado }: {
  token: string; onCerrar: () => void; onPublicado: () => void;
}) {
  const [contenido, setContenido] = useState<unknown>(DOC_VACIO);
  const [icono, setIcono] = useState<IconName>("bell");
  const [prioridad, setPrioridad] = useState<"normal" | "urgente">("normal");
  const [chips, setChips] = useState<Chip[]>([{ tipo: "grupo", valor: "todos", label: "Todos" }]);
  const [publicando, setPublicando] = useState(false);

  function quitar(chip: Chip) {
    setChips((cs) => cs.filter((c) => !(c.tipo === chip.tipo && c.valor === chip.valor)));
  }
  function agregarGrupo(g: (typeof GRUPOS)[number]) {
    setChips([{ tipo: "grupo", valor: g.valor, label: g.label }]);
  }
  function agregarUsuario(username: string) {
    setChips((cs) => [...cs.filter((c) => c.tipo !== "grupo"), { tipo: "usuario", valor: username }]);
  }

  async function publicar() {
    const grupo = chips.find((c): c is Extract<Chip, { tipo: "grupo" }> => c.tipo === "grupo");
    const usuarios = chips.filter((c): c is Extract<Chip, { tipo: "usuario" }> => c.tipo === "usuario").map((c) => c.valor);
    const destino = grupo ? grupo.valor : "personas";
    setPublicando(true);
    try {
      await api.post<AvisoInfo>("/v1/admin/avisos", { contenido, icono, prioridad, destino, usuarios }, token);
      onPublicado();
    } finally {
      setPublicando(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6"
      style={{ animation: "jg-backdrop-in 200ms ease-out both" }}
      onClick={(e) => { if (e.target === e.currentTarget) onCerrar(); }}>
      <div className="max-h-[86vh] w-full max-w-[560px] overflow-y-auto rounded-2xl border border-white/[.13]
        bg-[rgba(16,19,25,.94)] p-[20px_22px] backdrop-blur-xl"
        style={{ animation: "jg-popup-scale-in 220ms cubic-bezier(.2,.85,.35,1) both" }}>
        <h3 className="mb-4 text-[14px] font-medium">Nueva notificación</h3>

        {/* Vista previa: el icono y la prioridad no se eligen en una fila de
            botones aparte — se cambian tocando la propia preview de cómo se
            va a ver, cada uno con su propio popup. */}
        <div className="mb-3 flex items-center gap-3 rounded-card border border-border bg-panel p-3">
          <IconoBoton icono={icono} prioridad={prioridad} onChange={setIcono} />
          <div className="min-w-0 flex-1">
            <p className="text-[9px] uppercase tracking-[.06em] text-subtle">Vista previa</p>
            <p className="truncate text-[11px] text-muted">Así se ve el icono y la prioridad en la campana</p>
          </div>
          <PrioridadBoton prioridad={prioridad} onChange={setPrioridad} />
        </div>

        <AvisoEditor contenido={contenido} onChange={setContenido} />

        <div className="mt-2.5 rounded-card border border-border bg-panel p-3">
          <label className="mb-1.5 block text-[9px] uppercase tracking-[.06em] text-muted">Destinatarios</label>
          <DestinatarioInput token={token} chips={chips} onQuitar={quitar} onGrupo={agregarGrupo} onUsuario={agregarUsuario} />
        </div>

        <div className="mt-4 flex items-center gap-3">
          <p className="text-[9.5px] text-subtle">Llega a quien corresponda en cuanto se publica, sin recargar.</p>
          <button onClick={onCerrar} className="jg-press ml-auto rounded-lg px-3 py-1.5 text-[10.5px] text-subtle">Cancelar</button>
          <button disabled={publicando || chips.length === 0} onClick={() => void publicar()}
            className="jg-press rounded-lg bg-accent px-3 py-1.5 text-[11px] font-medium text-black disabled:opacity-40">
            {publicando ? "Publicando…" : "Publicar"}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Un solo campo para todo: escribir `#` sugiere los grupos fijos (todo el
 *  mundo, o solo administradores — sustituyen cualquier selección de
 *  personas); escribir un nombre busca usuarios y los añade con su avatar,
 *  como en `InviteDrawer.tsx`. Un grupo y personas concretas no conviven: el
 *  backend solo entiende un destino a la vez, así que elegir uno vacía el
 *  otro. */
/** El icono de la preview ES el botón que lo cambia — sin fila de botones
 *  aparte, se toca directamente lo que se está previsualizando. */
function IconoBoton({ icono, prioridad, onChange }: {
  icono: IconName; prioridad: "normal" | "urgente"; onChange: (i: IconName) => void;
}) {
  const [abierto, setAbierto, box] = usePopover();
  return (
    <div ref={box} className="relative shrink-0">
      <button type="button" onClick={() => setAbierto(!abierto)}
        className={`jg-press grid h-9 w-9 place-items-center rounded-full ${
          prioridad === "urgente" ? "bg-danger/[.15] text-danger-fg" : "bg-draw/[.12] text-draw-fg"}`}>
        <Icon name={icono} size={16} />
      </button>
      {abierto && (
        <div className="absolute left-0 top-[calc(100%+6px)] z-30 grid grid-cols-4 gap-1 rounded-lg
          border border-white/15 bg-[rgba(20,22,26,.98)] p-2 shadow-lg shadow-black/50"
          style={{ animation: "jg-popup-scale-in 160ms cubic-bezier(.2,.85,.35,1) both" }}>
          {ICONOS.map((i) => (
            <button key={i} type="button" onClick={() => { onChange(i); setAbierto(false); }}
              className={`jg-press grid h-8 w-8 place-items-center rounded-md border ${
                icono === i ? "border-white/35 bg-white/[.09] text-fg" : "border-border text-muted"}`}>
              <Icon name={i} size={14} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Igual: la etiqueta de prioridad de la preview es el botón que la cambia. */
function PrioridadBoton({ prioridad, onChange }: {
  prioridad: "normal" | "urgente"; onChange: (p: "normal" | "urgente") => void;
}) {
  const [abierto, setAbierto, box] = usePopover();
  return (
    <div ref={box} className="relative shrink-0">
      <button type="button" onClick={() => setAbierto(!abierto)}
        className={`jg-press rounded-full px-2.5 py-1 text-[10px] uppercase tracking-[.04em] ${
          prioridad === "urgente" ? "bg-danger/[.18] text-danger-fg" : "bg-draw/[.15] text-draw-fg"}`}>
        {prioridad === "urgente" ? "Urgente" : "Normal"}
      </button>
      {abierto && (
        <div className="absolute right-0 top-[calc(100%+6px)] z-30 overflow-hidden rounded-lg border
          border-white/15 bg-[rgba(20,22,26,.98)] shadow-lg shadow-black/50"
          style={{ animation: "jg-popup-scale-in 160ms cubic-bezier(.2,.85,.35,1) both" }}>
          {(["normal", "urgente"] as const).map((p) => (
            <button key={p} type="button" onClick={() => { onChange(p); setAbierto(false); }}
              className={`jg-press block w-full px-3 py-1.5 text-left text-[11px] ${
                p === "urgente" ? "text-danger-fg" : "text-draw-fg"} ${prioridad === p ? "bg-white/[.06]" : ""}`}>
              {p === "urgente" ? "Urgente" : "Normal"}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function DestinatarioInput({ token, chips, onQuitar, onGrupo, onUsuario }: {
  token: string; chips: Chip[];
  onQuitar: (c: Chip) => void;
  onGrupo: (g: (typeof GRUPOS)[number]) => void;
  onUsuario: (username: string) => void;
}) {
  const [texto, setTexto] = useState("");
  const [foco, setFoco] = useState(false);
  const [sugerencias, setSugerencias] = useState<UserSummary[]>([]);

  const esGrupo = texto.trim().startsWith("#");
  const yaElegidos = new Set(chips.filter((c) => c.tipo === "usuario").map((c) => c.valor));
  const gruposSugeridos = esGrupo
    ? GRUPOS.filter((g) => g.nombre.startsWith(texto.trim().slice(1).toLowerCase()))
    : [];

  useEffect(() => {
    if (esGrupo) { setSugerencias([]); return; }
    const t = setTimeout(() => {
      if (!texto.trim()) { setSugerencias([]); return; }
      api.get<UserSummary[]>(`/v1/users/search?q=${encodeURIComponent(texto.trim())}`, token)
        .then((all) => setSugerencias(all.filter((u) => !yaElegidos.has(u.username))))
        .catch(() => setSugerencias([]));
    }, 200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [texto, token, esGrupo]);

  function elegirGrupo(g: (typeof GRUPOS)[number]) {
    onGrupo(g);
    setTexto("");
  }
  function elegirUsuario(username: string) {
    onUsuario(username);
    setTexto("");
  }

  return (
    <div className="relative">
      <div className="mb-1.5 flex flex-wrap gap-1.5">
        {chips.map((c) => (
          <span key={`${c.tipo}:${c.valor}`}
            className="flex items-center gap-1.5 rounded-full border border-border bg-elevated py-1 pl-1.5 pr-1 text-[10.5px] text-fg"
            style={{ animation: "jg-popup-scale-in 160ms cubic-bezier(.2,.85,.35,1) both" }}>
            {c.tipo === "grupo" ? (
              <span className="grid h-[17px] w-[17px] shrink-0 place-items-center rounded-full bg-draw/[.18] text-draw-fg">#</span>
            ) : (
              <Avatar name={c.valor} size={17} />
            )}
            {c.tipo === "grupo" ? c.label : c.valor}
            <button onClick={() => onQuitar(c)} className="jg-press rounded p-0.5 text-subtle hover:text-danger-fg">
              <Icon name="x" size={9} />
            </button>
          </span>
        ))}
        {chips.length === 0 && <span className="text-[10px] italic text-subtle">nadie elegido todavía</span>}
      </div>
      <input value={texto} onChange={(e) => setTexto(e.target.value)}
        onFocus={() => setFoco(true)} onBlur={() => setTimeout(() => setFoco(false), 120)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && gruposSugeridos.length > 0) elegirGrupo(gruposSugeridos[0]);
          else if (e.key === "Backspace" && !texto && chips.length > 0) onQuitar(chips[chips.length - 1]);
        }}
        placeholder="nombre de usuario, o #todos / #administradores"
        className="w-full rounded-lg border border-border bg-elevated px-2.5 py-1.5 text-[11px]
          text-fg outline-none transition-colors duration-200 focus:border-white/40" />

      {foco && (gruposSugeridos.length > 0 || sugerencias.length > 0) && (
        <div className="absolute inset-x-0 top-[calc(100%+4px)] z-10 max-h-[170px] overflow-y-auto
          rounded-lg border border-white/10 bg-[rgba(20,22,26,.98)] p-1 shadow-lg shadow-black/50"
          style={{ animation: "jg-popup-scale-in 150ms cubic-bezier(.2,.85,.35,1) both" }}>
          {gruposSugeridos.map((g) => (
            <button key={g.valor} onMouseDown={() => elegirGrupo(g)}
              className="jg-press flex w-full items-center gap-2 rounded-md p-1.5 text-left text-[11px] text-fg hover:bg-white/[.05]">
              <span className="grid h-[19px] w-[19px] place-items-center rounded-full bg-draw/[.18] text-[10px] text-draw-fg">#</span>
              {g.label}
            </button>
          ))}
          {sugerencias.map((u) => (
            <button key={u.id} onMouseDown={() => elegirUsuario(u.username)}
              className="jg-press flex w-full items-center gap-2 rounded-md p-1.5 text-left text-[11px] text-fg hover:bg-white/[.05]">
              <Avatar name={u.username} size={19} />
              {u.username}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
