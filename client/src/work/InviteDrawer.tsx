import { useEffect, useRef, useState } from "react";
import { api, type Project, type ProjectMember, type UserSummary } from "../lib/api";
import { useServer } from "../lib/store";
import { Avatar } from "../ui/Avatar";
import { Icon } from "../ui/Icon";
import { Drawer } from "./Drawer";

/** Invitar es mirar una lista y escribir un nombre; no hace falta un diálogo
 *  que tape el mapa para eso. Sale por el mismo carril que los resultados y con
 *  la misma anchura, y por eso solo puede haber uno abierto (ver `DrawerId`). */
export function InviteDrawer({ project, open, onClose }:
  { project: Project; open: boolean; onClose: () => void }) {
  const token = useServer((s) => s.token) ?? undefined;
  const [rows, setRows] = useState<ProjectMember[]>([]);
  const [name, setName] = useState("");
  const [sugg, setSugg] = useState<UserSummary[]>([]);
  const [showSugg, setShowSugg] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounce = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  async function load() {
    try {
      setRows(await api.get<ProjectMember[]>(`/v1/projects/${project.id}/members`, token));
    } catch (e) {
      setError(String(e));
    }
  }
  useEffect(() => { if (open) void load(); }, [project.id, open]);

  const ya = new Set(rows.map((m) => m.username.toLowerCase()));

  // Un respiro entre pulsación y petición: si no, se manda una al servidor por
  // cada letra.
  useEffect(() => {
    clearTimeout(debounce.current);
    if (!name.trim()) { setSugg([]); return; }
    debounce.current = setTimeout(() => {
      api.get<UserSummary[]>(`/v1/users/search?q=${encodeURIComponent(name.trim())}`, token)
        .then((all) => setSugg(all.filter((u) => !ya.has(u.username.toLowerCase()))))
        .catch(() => setSugg([]));
    }, 200);
    return () => clearTimeout(debounce.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name]);

  async function add(username: string) {
    if (!username.trim()) return;
    setError(null);
    setShowSugg(false);
    try {
      await api.post(`/v1/projects/${project.id}/members`, { username }, token);
      setName("");
      setSugg([]);
      await load();
    } catch (e) {
      setError(String(e));
    }
  }

  async function drop(userId: number) {
    setError(null);
    try {
      await api.del(`/v1/projects/${project.id}/members/${userId}`, token);
      await load();
    } catch (e) {
      setError(String(e));
    }
  }

  return (
    <Drawer open={open}>
      <div className="flex items-center gap-2">
        <span className="flex-1 truncate text-[12px] text-fg">Quién entra en «{project.name}»</span>
        <button onClick={onClose} aria-label="Cerrar"
          className="grid h-[22px] w-[22px] place-items-center rounded-md text-subtle
            transition-colors hover:bg-white/[.05] hover:text-fg">
          <Icon name="x" size={11} />
        </button>
      </div>

      {rows.map((m) => (
        <div key={m.user_id} className="flex items-center gap-2 rounded-[9px] border border-border p-1.5">
          <Avatar name={m.username} size={20} userId={m.user_id} />
          <span className={`min-w-0 flex-1 truncate text-[11.5px] ${
            m.status === "pending" ? "text-muted" : "text-fg"}`}>{m.username}</span>
          <span className="shrink-0 text-[8.5px] uppercase tracking-[.1em] text-subtle">
            {m.role === "owner" ? "dueño" : m.status === "pending" ? "pendiente" : "dentro"}
          </span>
          {m.role !== "owner" && (
            <button onClick={() => void drop(m.user_id)} aria-label="Quitar"
              className="shrink-0 px-0.5 text-[11px] text-subtle hover:text-danger-fg">✕</button>
          )}
        </div>
      ))}

      <div className="relative mt-1 flex gap-1.5">
        <input value={name} autoComplete="off"
          onChange={(e) => { setName(e.target.value); setShowSugg(true); }}
          onFocus={() => setShowSugg(true)}
          onBlur={() => setTimeout(() => setShowSugg(false), 120)}
          onKeyDown={(e) => { if (e.key === "Enter") void add(name); }}
          placeholder="nombre de usuario"
          className="min-w-0 flex-1 rounded-[9px] border border-border bg-[#0d0f12] px-2.5 py-[7px]
            text-[12px] text-fg outline-none transition-[border-color] duration-300 ease-expo
            placeholder:text-subtle focus:border-white/40" />
        <button onClick={() => void add(name)}
          className="jg-press shrink-0 rounded-[9px] border border-white/15 px-2.5 text-[11.5px] text-fg">
          Invitar
        </button>

        {showSugg && sugg.length > 0 && (
          <div className="absolute inset-x-0 top-[calc(100%+4px)] z-10 max-h-[150px] overflow-y-auto
            rounded-[9px] border border-white/10 bg-[rgba(20,22,26,.98)] p-1 shadow-lg shadow-black/50"
            style={{ animation: "jg-fade-rise 140ms cubic-bezier(.16,1,.3,1) both" }}>
            {sugg.map((u) => (
              // `onMouseDown` y no `onClick`: el blur del campo dispara primero
              // y con `onClick` la lista ya se habría cerrado.
              <button key={u.id} onMouseDown={() => void add(u.username)}
                className="jg-press flex w-full items-center gap-2 rounded-md p-1.5 text-left hover:bg-white/[.05]">
                <Avatar name={u.username} size={17} userId={u.id} />
                <span className="text-[11.5px] text-fg">{u.username}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {error && <p className="text-[10.5px] leading-snug text-danger-fg">{error}</p>}

      <div className="flex-1" />
      <p className="text-[10.5px] text-subtle">Una invitación no entra hasta que se acepta.</p>
    </Drawer>
  );
}
