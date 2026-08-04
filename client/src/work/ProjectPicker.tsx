import { useEffect, useMemo, useRef, useState } from "react";
import { api, type Project, type ProjectMember, type Usage } from "../lib/api";
import { useServer } from "../lib/store";
import { Icon } from "../ui/Icon";

const GB = 1024 * 1024 * 1024;

function size(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < GB) return `${Math.round(bytes / 1024 / 1024)} MB`;
  return `${(bytes / GB).toFixed(1)} GB`;
}

function ago(ts: number): string {
  const s = Math.max(0, Math.floor(Date.now() / 1000) - ts);
  if (s < 60) return "ahora mismo";
  if (s < 3600) return `hace ${Math.floor(s / 60)} min`;
  if (s < 86400) return `hace ${Math.floor(s / 3600)} h`;
  return `hace ${Math.floor(s / 86400)} d`;
}

const FECHA = new Intl.DateTimeFormat("es-ES", { day: "numeric", month: "short", year: "numeric" });
const fecha = (ts: number) => FECHA.format(new Date(ts * 1000));

/** Se elige el proyecto ANTES de entrar, como en Burp: a pantalla completa y a
 *  dos paneles. La lista de la izquierda es para recorrer; el panel de la
 *  derecha es para decidir, y por eso enseña las cifras y los miembros del
 *  proyecto marcado sin tener que abrirlo. */
export function ProjectPicker({
  onOpen, onAdmin, onSignOut,
}: { onOpen: (p: Project) => void; onAdmin: () => void; onSignOut: () => void }) {
  const token = useServer((s) => s.token) ?? undefined;
  const username = useServer((s) => s.username);
  const isAdmin = useServer((s) => s.isAdmin);
  const limits = useServer((s) => s.limits);
  const addr = useServer((s) => s.addr);
  const version = useServer((s) => s.hello?.version ?? "");

  const [list, setList] = useState<Project[] | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [members, setMembers] = useState<ProjectMember[] | null>(null);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<number | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  // Una sola vez al montar. Con un `ref` de callback esto se repetiría en cada
  // render y le robaría el foco al campo de filtro en cuanto tecleases.
  useEffect(() => { root.current?.focus(); }, []);

  // Un admin salta los límites en el servidor (`routes/projects.rs`), así que
  // aquí tiene que saltárselos también: ofrecerle el botón deshabilitado sería
  // mentirle. `null` es "todavía no lo sé", y ahí se ofrece: el servidor tiene
  // la última palabra y contesta con el motivo escrito.
  const canCreate = isAdmin || limits === null || limits.can_create_projects;

  async function load() {
    try {
      const [p, u] = await Promise.all([
        api.get<Project[]>("/v1/projects", token),
        api.get<Usage>("/v1/me/usage", token),
      ]);
      setList(p);
      setUsage(u);
      setSel((s) => (s !== null && p.some((x) => x.id === s) ? s : p[0]?.id ?? null));
    } catch (e) {
      setError(String(e));
    }
  }
  useEffect(() => { void load(); }, []);

  // Los miembros son una llamada por proyecto, así que se piden solo del que
  // está marcado y no de los de la lista entera.
  useEffect(() => {
    if (sel === null) { setMembers(null); return; }
    let dead = false;
    setMembers(null);
    api.get<ProjectMember[]>(`/v1/projects/${sel}/members`, token)
      .then((m) => { if (!dead) setMembers(m); })
      .catch(() => { if (!dead) setMembers([]); });
    return () => { dead = true; };
  }, [sel, token]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const all = list ?? [];
    return needle ? all.filter((p) => p.name.toLowerCase().includes(needle)) : all;
  }, [list, q]);

  const current = list?.find((p) => p.id === sel) ?? null;

  async function create(name: string) {
    if (!name.trim()) { setDraft(null); return; }
    setBusy(true); setError(null);
    try {
      const p = await api.post<Project>("/v1/projects", { name }, token);
      setDraft(null);
      onOpen(p);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function rename(name: string) {
    if (!current || !name.trim() || name === current.name) { setRenaming(false); return; }
    setBusy(true); setError(null);
    try {
      await api.patch(`/v1/projects/${current.id}`, { name }, token);
      setRenaming(false);
      await load();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!current) return;
    setBusy(true); setError(null);
    try {
      await api.del(`/v1/projects/${current.id}`, token);
      setSel(null);
      await load();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  // Flechas para recorrer y Enter para abrir: quien elige proyecto veinte veces
  // al día no quiere soltar el teclado.
  function onKey(e: React.KeyboardEvent) {
    if (draft !== null || renaming) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const i = shown.findIndex((p) => p.id === sel);
      const next = e.key === "ArrowDown" ? i + 1 : i - 1;
      if (next >= 0 && next < shown.length) setSel(shown[next].id);
    } else if (e.key === "Enter" && current) {
      onOpen(current);
    }
  }

  return (
    <div ref={root} className="flex h-full w-full flex-col bg-bg outline-none"
      style={{ animation: "jg-page-fade-in 260ms cubic-bezier(.16,1,.3,1) both" }}
      tabIndex={-1} onKeyDown={onKey}>

      {/* cabecera */}
      <header className="flex h-[52px] shrink-0 items-center justify-between border-b border-border bg-surface px-[18px]">
        <div className="flex items-center gap-2.5">
          <span className="text-fg"><Icon name="logo" size={17} /></span>
          <span className="text-[13px]">Lumi Station</span>
          {version && <span className="font-mono text-[9.5px] text-subtle">v{version}</span>}
        </div>
        <div className="flex items-center gap-3.5">
          {addr && <span className="font-mono text-[10px] text-subtle">{addr}</span>}
          <span className="h-3.5 w-px bg-border" />
          <span className="text-[11px] text-muted">{username}</span>
          {isAdmin && <span className="rounded border border-white/25 px-1.5 py-px text-[8.5px] text-fg">admin</span>}
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* ── lista ── */}
        <div className="flex w-[352px] shrink-0 flex-col border-r border-border">
          <div className="p-[13px] pb-2.5">
            <div className="flex items-center gap-2 rounded-lg border border-border bg-surface px-2.5 py-[7px]
              focus-within:border-white/25 transition-colors duration-300 ease-expo">
              <Icon name="search" size={12} className="text-subtle" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filtrar proyectos"
                className="w-full bg-transparent text-[11.5px] text-fg outline-none placeholder:text-subtle" />
            </div>
          </div>
          <p className="px-[15px] pb-[7px] text-[8px] uppercase tracking-[.11em] text-subtle">
            {list === null
              ? "cargando"
              : `${shown.length} ${shown.length === 1 ? "proyecto" : "proyectos"} · ordenados por actividad`}
          </p>

          <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto px-[9px]">
            {list !== null && shown.length === 0 && q.trim() !== "" && (
              <p className="px-2 py-6 text-center text-[11px] text-subtle">
                ningún proyecto se llama así
              </p>
            )}
            {shown.map((p, i) => (
              <button key={p.id} onClick={() => setSel(p.id)} onDoubleClick={() => onOpen(p)}
                style={{ animation: `jg-fade-rise 220ms ${Math.min(i, 8) * 26}ms cubic-bezier(.16,1,.3,1) both` }}
                className={`relative block w-full rounded-[9px] border p-[10px_11px] text-left transition-colors duration-300 ease-expo ${
                  sel === p.id
                    ? "border-white/[.22] bg-white/[.045]"
                    : "border-border hover:border-white/15 hover:bg-white/[.02]"
                }`}>
                {sel === p.id && (
                  <span className="absolute inset-y-[11px] left-0 w-0.5 rounded-r bg-fg" />
                )}
                <div className="flex items-baseline justify-between gap-2.5">
                  <span className="truncate text-[12.5px] text-fg">{p.name}</span>
                  <span className="shrink-0 font-mono text-[9.5px] text-subtle">{ago(p.updated_at)}</span>
                </div>
                <div className="mt-1 font-mono text-[10px] text-muted">
                  {p.cases} {p.cases === 1 ? "caso" : "casos"} · {p.images} imágenes · {size(p.bytes)}
                </div>
                <div className="mt-[7px] flex gap-1.5">
                  <Chip strong={p.role === "owner"}>{p.role === "owner" ? "dueño" : "invitado"}</Chip>
                </div>
              </button>
            ))}
          </div>

          <div className="border-t border-border p-[9px]">
            {draft !== null ? (
              <div className="rounded-[9px] border border-dashed border-white/25 p-[9px]">
                {/* Intro confirma; Escape y perder el foco cancelan. Crear al
                    perder el foco parecía cómodo hasta que un clic en
                    cualquier sitio te dejaba un proyecto sin nombre — y si la
                    creación fallaba, el blur posterior lo intentaba otra vez y
                    salían dos. */}
                <input autoFocus value={draft} disabled={busy}
                  onChange={(e) => setDraft(e.target.value)}
                  onBlur={() => setDraft(null)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void create(draft);
                    if (e.key === "Escape") setDraft(null);
                  }}
                  placeholder="nombre del proyecto"
                  className="w-full bg-transparent text-center text-[11.5px] text-fg outline-none placeholder:text-subtle" />
              </div>
            ) : (
              <button onClick={() => canCreate && setDraft("")} disabled={!canCreate}
                title={canCreate ? undefined : "tu cuenta no puede crear proyectos; habla con el administrador"}
                className="jg-press block w-full rounded-[9px] border border-dashed border-border p-[9px]
                  text-center text-[11px] text-subtle hover:border-white/20 hover:text-fg disabled:opacity-40">
                + Nuevo proyecto
              </button>
            )}
          </div>
        </div>

        {/* ── detalle ── */}
        <div className="flex min-w-0 flex-1 flex-col px-[30px] py-[26px]"
          style={{ background: "radial-gradient(90% 70% at 70% 0%, #16191d 0%, #0e0f11 70%)" }}>
          {current === null ? (
            <div className="flex flex-1 items-center justify-center">
              <p className="max-w-[280px] text-center text-[11.5px] leading-relaxed text-subtle">
                {list === null
                  ? "cargando tus proyectos"
                  : "todavía no hay ningún proyecto. Crea el primero abajo a la izquierda: cada uno tiene sus casos y sus imágenes, separados del resto."}
              </p>
            </div>
          ) : (
            <div key={current.id} className="flex min-h-0 flex-1 flex-col"
              style={{ animation: "jg-slide-right 240ms cubic-bezier(.16,1,.3,1) both" }}>
              <p className="text-[8px] uppercase tracking-[.11em] text-subtle">Proyecto seleccionado</p>

              {renaming ? (
                <input autoFocus defaultValue={current.name} disabled={busy}
                  onBlur={() => setRenaming(false)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void rename((e.target as HTMLInputElement).value);
                    if (e.key === "Escape") setRenaming(false);
                  }}
                  className="mt-2 w-full border-b border-white/25 bg-transparent text-[23px] font-medium
                    tracking-[-.015em] text-fg outline-none" />
              ) : (
                <h2 className="mt-2 truncate text-[23px] font-medium tracking-[-.015em]">{current.name}</h2>
              )}

              <div className="mt-2.5 flex gap-1.5">
                <Chip strong={current.role === "owner"}>
                  {current.role === "owner" ? "eres el dueño" : "estás invitado"}
                </Chip>
                <Chip>creado el {fecha(current.created_at)}</Chip>
              </div>

              <div className="mt-[26px] grid grid-cols-4 gap-px overflow-hidden rounded-[10px] border border-border bg-border">
                <Stat k="Casos" v={String(current.cases)} />
                <Stat k="Imágenes" v={String(current.images)} />
                <Stat k="Última actividad" v={ago(current.updated_at)} small />
                <Stat k="En disco" v={size(current.bytes)} />
              </div>

              <div className="mt-6 min-h-0">
                <p className="text-[8px] uppercase tracking-[.11em] text-subtle">Miembros</p>
                <div className="mt-2.5 flex flex-wrap gap-[7px]">
                  {members === null ? (
                    <span className="text-[11px] text-subtle">cargando</span>
                  ) : (
                    members.map((m) => (
                      <span key={m.user_id}
                        className="flex items-center gap-[7px] rounded-full border border-border py-1 pl-[5px] pr-[11px]">
                        <span className="grid h-[19px] w-[19px] place-items-center rounded-full bg-elevated text-[9px] text-fg">
                          {m.username.slice(0, 1).toUpperCase()}
                        </span>
                        <span className="text-[11px]">{m.username}</span>
                        {m.role === "owner" && <Chip strong>dueño</Chip>}
                      </span>
                    ))
                  )}
                </div>
                {current.role === "owner" && (
                  <p className="mt-2.5 text-[10.5px] text-subtle">
                    Se invita desde dentro del proyecto, en el carril de la izquierda.
                  </p>
                )}
              </div>

              {error && (
                <div className="mt-4 flex items-start gap-2.5">
                  <Icon name="alert" className="mt-0.5 text-danger-fg" />
                  <span className="text-[11px] leading-snug text-muted">{error}</span>
                </div>
              )}

              <div className="flex-1" />
              <div className="flex items-center justify-between gap-4">
                <span className="font-mono text-[10px] text-subtle">
                  Doble clic o Intro para abrir
                </span>
                <div className="flex gap-2">
                  {current.role === "owner" && (
                    <>
                      <button onClick={() => setRenaming(true)} disabled={busy}
                        className="jg-press rounded-lg border border-white/15 px-4 py-2 text-[11.5px] text-fg disabled:opacity-40">
                        Renombrar
                      </button>
                      <DeleteButton name={current.name} busy={busy} onConfirm={() => void remove()} />
                    </>
                  )}
                  <button onClick={() => onOpen(current)} disabled={busy}
                    className="jg-press rounded-lg bg-accent px-5 py-2 text-[11.5px] font-medium text-black disabled:opacity-40">
                    Abrir proyecto
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* barra de estado */}
      <footer className="flex h-[34px] shrink-0 items-center justify-between border-t border-border bg-surface px-[15px]">
        <div className="flex items-center gap-2.5">
          <span className="text-[8px] uppercase tracking-[.11em] text-subtle">Almacenamiento</span>
          <span className="h-[3px] w-[120px] overflow-hidden rounded bg-elevated">
            <span className="block h-full rounded bg-fg transition-[width] duration-700 ease-expo"
              style={{ width: usage ? `${Math.min(100, (usage.used_bytes / (usage.limit_gb * GB)) * 100)}%` : "0%" }} />
          </span>
          {/* El origen del límite se dice siempre: uno sin origen visible es
              indepurable cuando alguien pregunta por qué no le caben más. */}
          <span className="font-mono text-[10px] text-subtle">
            {usage
              ? `${size(usage.used_bytes)} de ${usage.limit_gb} GB · ${usage.overridden ? "límite propio" : "heredado del global"}`
              : ""}
          </span>
        </div>
        <div className="flex items-center gap-3">
          {isAdmin && (
            <button onClick={onAdmin}
              className="jg-press flex items-center gap-1.5 text-[10.5px] text-subtle hover:text-fg">
              <Icon name="shield" size={11} /> Administración
            </button>
          )}
          <button onClick={onSignOut} className="jg-press text-[10.5px] text-subtle hover:text-fg">
            Cerrar sesión
          </button>
        </div>
      </footer>
    </div>
  );
}

function Chip({ children, strong }: { children: React.ReactNode; strong?: boolean }) {
  return (
    <span className={`rounded border px-1.5 py-px text-[8.5px] tracking-[.04em] ${
      strong ? "border-white/[.28] text-fg" : "border-border text-subtle"
    }`}>{children}</span>
  );
}

function Stat({ k, v, small }: { k: string; v: string; small?: boolean }) {
  return (
    <div className="bg-surface px-[15px] py-[13px]">
      <div className="text-[8px] uppercase tracking-[.11em] text-subtle">{k}</div>
      <div className={`mt-1 ${small ? "text-[13px]" : "text-[20px]"}`}>{v}</div>
    </div>
  );
}

/** Borrar un proyecto se lleva sus casos, sus imágenes y sus análisis, y no hay
 *  papelera. El botón pide el segundo clic en sí mismo en vez de abrir un
 *  diálogo: el aviso está donde está el peligro. */
function DeleteButton({ name, busy, onConfirm }:
  { name: string; busy: boolean; onConfirm: () => void }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <button disabled={busy}
      onClick={() => (armed ? onConfirm() : setArmed(true))}
      onBlur={() => setArmed(false)}
      title={armed ? undefined : `Borrar «${name}» y todo lo que contiene`}
      className={`jg-press rounded-lg border px-4 py-2 text-[11.5px] disabled:opacity-40 ${
        armed ? "border-danger/60 text-danger-fg" : "border-white/15 text-subtle hover:text-fg"
      }`}>
      {armed ? "¿Seguro? Se borra todo" : "Borrar"}
    </button>
  );
}
