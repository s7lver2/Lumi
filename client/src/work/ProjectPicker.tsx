import { useEffect, useMemo, useState } from "react";
import { api, type Project, type Usage } from "../lib/api";
import { useReorder } from "../lib/useReorder";
import { useServer } from "../lib/store";
import { ContextMenu, menuAt, type MenuState } from "../ui/ContextMenu";
import { Icon } from "../ui/Icon";
import { PromptDialog } from "../ui/PromptDialog";
import { UserTile } from "../ui/UserTile";

const GB = 1024 * 1024 * 1024;

function size(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < GB) return `${Math.round(bytes / 1024 / 1024)} MB`;
  return `${(bytes / GB).toFixed(1)} GB`;
}

type Vista = "grid" | "rows" | "dense";

/** Los proyectos, sin una sola frase que explique lo que ya se ve.
 *
 *  Las cifras van con su icono —carpeta, foto, disco— en vez de «4 casos · 61
 *  imágenes · 1,2 GB», y las tres vistas son la misma tarjeta con distinto
 *  flujo: rejilla para pocos, lista para verlos con sus cifras en línea, y
 *  compacta para quien tiene cuarenta y solo quiere el nombre. */
export function ProjectPicker({ onOpen, refresh }: {
  onOpen: (p: Project) => void;
  /** Sube al aceptar una invitación desde la campana. El componente no se
   *  desmonta al quedarse en el selector, así que sin esto la única forma de
   *  ver el proyecto nuevo era entrar a otro y volver. */
  refresh?: number;
}) {
  const token = useServer((s) => s.token) ?? undefined;
  const isAdmin = useServer((s) => s.isAdmin);
  const limits = useServer((s) => s.limits);

  const [list, setList] = useState<Project[] | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [q, setQ] = useState("");
  const [vista, setVista] = useState<Vista>(
    () => (localStorage.getItem("lumi.vista.proyectos") as Vista) ?? "grid",
  );
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState<Project | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);

  // Un admin salta los límites en el servidor, así que aquí también: ofrecerle
  // el botón apagado sería mentirle. `null` es «todavía no lo sé».
  const canCreate = isAdmin || limits === null || limits.can_create_projects;

  async function load() {
    try {
      const [p, u] = await Promise.all([
        api.get<Project[]>("/v1/projects", token),
        api.get<Usage>("/v1/me/usage", token),
      ]);
      setList(p);
      setUsage(u);
    } catch (e) {
      setError(String(e));
    }
  }
  useEffect(() => { void load(); }, [refresh]);

  const filtrados = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const all = list ?? [];
    return needle ? all.filter((p) => p.name.toLowerCase().includes(needle)) : all;
  }, [list, q]);

  const orden = useReorder("proyectos", filtrados, vista === "grid" ? "x" : "y");

  function cambiarVista(v: Vista) {
    setVista(v);
    localStorage.setItem("lumi.vista.proyectos", v);
  }

  /** Un proyecto solo admite una persona dentro a la vez. Se comprueba justo
   *  antes de entrar y no al listar: la lista se queda vieja enseguida, y decir
   *  «en uso» un minuto después de que se liberó sería mentir. */
  async function open(p: Project) {
    setError(null);
    setBusy(true);
    try {
      await api.post(`/v1/projects/${p.id}/enter`, {}, token);
      onOpen(p);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function create(name: string) {
    setBusy(true); setError(null);
    try {
      const p = await api.post<Project>("/v1/projects", { name }, token);
      setCreating(false);
      void open(p);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function rename(p: Project, name: string) {
    setBusy(true); setError(null);
    try {
      await api.patch(`/v1/projects/${p.id}`, { name }, token);
      setRenaming(null);
      await load();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove(p: Project) {
    setError(null);
    try {
      await api.del(`/v1/projects/${p.id}`, token);
      await load();
    } catch (e) {
      setError(String(e));
    }
  }

  const cont = vista === "grid"
    ? "grid gap-2.5 [grid-template-columns:repeat(auto-fill,minmax(232px,1fr))]"
    : vista === "rows"
      ? "flex max-w-[760px] flex-col gap-1.5"
      : "flex max-w-[660px] flex-col";

  return (
    <div className="flex h-full w-full flex-col bg-bg"
      style={{ animation: "jg-page-fade-in 260ms cubic-bezier(.16,1,.3,1) both" }}>

      <div className="min-h-0 flex-1 overflow-y-auto px-[26px] py-[22px]"
        style={{ background: "radial-gradient(90% 70% at 60% 0%, #16191d 0%, #0e0f11 70%)" }}>
        <div className="flex items-center gap-3">
          <h2 className="text-[16px] font-semibold tracking-[-.01em]">Proyectos</h2>

          <div className="ml-auto flex items-center gap-2 rounded-lg border border-border bg-surface
            px-2.5 py-[5px] transition-colors duration-300 ease-expo focus-within:border-white/25">
            <Icon name="search" size={12} className="text-subtle" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filtrar"
              className="w-[130px] bg-transparent text-[11.5px] text-fg outline-none placeholder:text-subtle" />
          </div>

          <div className="flex gap-0.5 rounded-lg border border-border bg-surface p-0.5">
            {([["grid", "Rejilla"], ["rows", "Lista"], ["dense", "Compacta"]] as const).map(([v, t]) => (
              <button key={v} onClick={() => cambiarVista(v)} title={t} aria-pressed={vista === v}
                className={`grid h-[22px] w-[26px] place-items-center rounded-md transition-colors
                  duration-300 ease-expo ${
                    vista === v ? "bg-white/[.07] text-fg" : "text-subtle hover:text-fg"}`}>
                <ViewIcon v={v} />
              </button>
            ))}
          </div>
        </div>

        <div className={`mt-4 ${cont}`}>
          {list === null && <p className="py-8 text-center text-[11px] text-subtle">cargando</p>}
          {list !== null && filtrados.length === 0 && q.trim() !== "" && (
            <p className="py-8 text-center text-[11px] text-subtle">ninguno se llama así</p>
          )}

          {orden.items.map((p, i) => (
            <Card key={p.id} project={p} vista={vista} delay={Math.min(i, 8) * 40}
              drag={orden.drag(p.id)}
              onOpen={() => { if (!orden.dragging && !busy) void open(p); }}
              onMenu={(e) => menuAt(e, p.name, [
                { label: "Abrir", hint: "↵", onClick: () => void open(p) },
                {
                  label: "Renombrar", hint: "F2", disabled: p.role !== "owner",
                  onClick: () => setRenaming(p),
                },
                null,
                {
                  label: "Eliminar proyecto", danger: true, disabled: p.role !== "owner",
                  onClick: () => void remove(p),
                },
              ], setMenu)} />
          ))}

          {list !== null && (
            <button onClick={() => canCreate && setCreating(true)} disabled={!canCreate}
              title={canCreate ? "Nuevo proyecto" : "tu cuenta no puede crear proyectos"}
              className={`jg-press rounded-card border border-dashed border-border text-[13px] leading-none
                text-subtle hover:border-white/20 hover:text-fg disabled:opacity-40 ${
                  vista === "grid" ? "grid min-h-[82px] place-items-center" : "p-2.5 text-center"}`}>
              +
            </button>
          )}
        </div>

        {error && <p className="mt-3 text-[11px] text-danger-fg">{error}</p>}
      </div>

      <footer className="flex h-[30px] shrink-0 items-center gap-2.5 border-t border-border bg-surface px-4">
        <span className="h-[3px] w-[110px] overflow-hidden rounded bg-elevated">
          <span className="block h-full rounded bg-fg transition-[width] duration-700 ease-expo"
            style={{ width: usage ? `${Math.min(100, (usage.used_bytes / (usage.limit_gb * GB)) * 100)}%` : "0%" }} />
        </span>
        {/* El origen del límite se dice siempre: uno sin origen visible es
            indepurable cuando alguien pregunta por qué no le caben más. */}
        <span className="font-mono text-[10px] text-subtle">
          {usage
            ? `${size(usage.used_bytes)} de ${usage.limit_gb} GB · ${
                usage.overridden ? "límite propio" : "heredado del global"}`
            : ""}
        </span>
      </footer>

      <ContextMenu state={menu} onClose={() => setMenu(null)} />

      <PromptDialog open={creating} title="Nuevo proyecto"
        subtitle="agrupa casos y a quien trabaja en ellos" placeholder="Costa norte"
        taken={(list ?? []).map((p) => p.name)} busy={busy} error={error}
        onConfirm={create} onClose={() => { setCreating(false); setError(null); }} />

      <PromptDialog open={renaming !== null} title="Renombrar proyecto"
        placeholder={renaming?.name ?? ""} confirmLabel="Guardar"
        taken={(list ?? []).filter((p) => p.id !== renaming?.id).map((p) => p.name)}
        busy={busy} error={error}
        onConfirm={(n) => renaming && void rename(renaming, n)}
        onClose={() => { setRenaming(null); setError(null); }} />
    </div>
  );
}

function ViewIcon({ v }: { v: Vista }) {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
      {v === "grid" ? (
        <>
          <rect x="2" y="2" width="5" height="5" rx="1" /><rect x="9" y="2" width="5" height="5" rx="1" />
          <rect x="2" y="9" width="5" height="5" rx="1" /><rect x="9" y="9" width="5" height="5" rx="1" />
        </>
      ) : v === "rows" ? (
        <><rect x="2" y="3" width="12" height="4" rx="1" /><rect x="2" y="9" width="12" height="4" rx="1" /></>
      ) : (
        <path d="M2 4h12M2 8h12M2 12h12" />
      )}
    </svg>
  );
}

function Card({ project, vista, delay, drag, onOpen, onMenu }: {
  project: Project;
  vista: Vista;
  delay: number;
  drag: Record<string, unknown>;
  onOpen: () => void;
  onMenu: (e: React.MouseEvent) => void;
}) {
  const stats = (
    <div className={`flex items-center gap-3 text-[10.5px] text-subtle ${vista === "grid" ? "mt-2" : ""} ${
      vista === "dense" ? "gap-3.5 text-[10px]" : ""}`}>
      <Stat icon="folder" v={String(project.cases)} />
      <Stat icon="image" v={String(project.images)} />
      <Stat icon="cloud" v={size(project.bytes)} />
      <span className="ml-auto flex items-center gap-1.5">
        {project.locked_by && (
          <span title={`${project.locked_by} está trabajando en este proyecto ahora mismo`}>
            <UserTile nombre={project.locked_by} conectado size={16} />
          </span>
        )}
        {project.role !== "owner" && (
          <span className="text-warning-fg" title="te invitaron a este proyecto">
            <Icon name="users" size={12} />
          </span>
        )}
      </span>
    </div>
  );

  const base = "jg-press group cursor-grab text-left transition-[border-color,background-color,transform] " +
    "duration-300 ease-expo active:cursor-grabbing data-[dragging]:scale-[.97] data-[dragging]:opacity-40";

  if (vista === "dense") {
    return (
      <button {...drag} onClick={onOpen} onContextMenu={onMenu}
        style={{ animation: `jg-fade-rise 380ms ${delay}ms cubic-bezier(.16,1,.3,1) both` }}
        className={`${base} flex items-center gap-3.5 border-b border-border px-2.5 py-1.5 hover:bg-white/[.035]`}>
        <span className="min-w-0 flex-1 truncate text-[12px] text-fg">{project.name}</span>
        {stats}
      </button>
    );
  }

  return (
    <button {...drag} onClick={onOpen} onContextMenu={onMenu}
      style={{ animation: `jg-fade-rise 380ms ${delay}ms cubic-bezier(.16,1,.3,1) both` }}
      className={`${base} rounded-card border border-border bg-[rgba(21,23,26,.6)]
        hover:border-white/20 hover:bg-[rgba(26,28,32,.75)] ${
          vista === "grid" ? "block p-3.5" : "flex items-center gap-3.5 p-[10px_12px]"}`}>
      <span className={`block truncate text-[12.5px] text-fg ${vista === "rows" ? "min-w-0 flex-1" : ""}`}>
        {project.name}
      </span>
      {stats}
    </button>
  );
}

function Stat({ icon, v }: { icon: "folder" | "image" | "cloud"; v: string }) {
  return (
    <span className="flex items-center gap-1">
      <Icon name={icon} size={12} className="opacity-75" />
      <span className="font-mono">{v}</span>
    </span>
  );
}
