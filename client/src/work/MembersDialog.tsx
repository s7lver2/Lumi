import { useEffect, useRef, useState } from "react";
import { api, type Project, type ProjectMember, type UserSummary } from "../lib/api";
import { useServer } from "../lib/store";
import { Avatar } from "../ui/Avatar";
import { Center } from "../ui/layout";

export function MembersDialog({ project, onClose }: { project: Project; onClose: () => void }) {
  const token = useServer((s) => s.token) ?? undefined;
  const [rows, setRows] = useState<ProjectMember[]>([]);
  const [name, setName] = useState("");
  const [suggestions, setSuggestions] = useState<UserSummary[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounce = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  async function load() {
    try {
      setRows(await api.get<ProjectMember[]>(`/v1/projects/${project.id}/members`, token));
    } catch (e) {
      setError(String(e));
    }
  }
  useEffect(() => { void load(); }, [project.id]);

  const already = new Set(rows.map((m) => m.username.toLowerCase()));

  // Sugerencias mientras se escribe, con un pequeño respiro entre pulsación y
  // petición para no mandar una al servidor por cada letra.
  useEffect(() => {
    clearTimeout(debounce.current);
    if (!name.trim()) { setSuggestions([]); return; }
    debounce.current = setTimeout(() => {
      api.get<UserSummary[]>(`/v1/users/search?q=${encodeURIComponent(name.trim())}`, token)
        .then((all) => setSuggestions(all.filter((u) => !already.has(u.username.toLowerCase()))))
        .catch(() => setSuggestions([]));
    }, 200);
    return () => clearTimeout(debounce.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name]);

  async function add(username: string) {
    if (!username.trim()) return;
    setError(null);
    setShowSuggestions(false);
    try {
      await api.post(`/v1/projects/${project.id}/members`, { username }, token);
      setName("");
      setSuggestions([]);
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
    <Center className="z-40 bg-black/50" blocking onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}
        className="w-[360px] rounded-card border border-white/[.13] bg-[rgba(16,19,25,.9)] p-5 shadow-lg shadow-black/40 backdrop-blur-xl">
        <p className="text-[13px] text-fg">Quién entra en {project.name}</p>
        <p className="mb-3.5 text-[11px] text-muted">
          una invitación no entra hasta que se acepta; renombrar, borrar e invitar son solo del dueño
        </p>

        {rows.map((m) => (
          <div key={m.user_id} className="mb-1.5 flex items-center gap-2 rounded-lg border border-border p-2">
            <Avatar name={m.username} />
            <span className={`flex-1 truncate text-[11.5px] ${m.status === "pending" ? "text-muted" : "text-fg"}`}>
              {m.username}
            </span>
            <span className="text-[8.5px] uppercase tracking-[.11em] text-subtle">
              {m.role === "owner" ? "dueño" : m.status === "pending" ? "invitación enviada" : "invitado"}
            </span>
            {m.role !== "owner" && (
              <button onClick={() => void drop(m.user_id)}
                className="text-[11px] text-subtle hover:text-danger-fg">quitar</button>
            )}
          </div>
        ))}

        <div className="relative mt-3 flex gap-2">
          <input value={name}
            onChange={(e) => { setName(e.target.value); setShowSuggestions(true); }}
            onFocus={() => setShowSuggestions(true)}
            onBlur={() => setTimeout(() => setShowSuggestions(false), 120)}
            onKeyDown={(e) => { if (e.key === "Enter") void add(name); }}
            placeholder="nombre de usuario"
            className="flex-1 rounded-lg border border-border bg-[#0d0f12] px-3 py-2 text-[12.5px] text-fg outline-none transition-[border-color] duration-300 ease-expo focus:border-white/40" />
          <button onClick={() => void add(name)}
            className="rounded-lg border border-white/15 px-3 text-xs text-fg active:translate-y-px">
            Invitar
          </button>

          {showSuggestions && suggestions.length > 0 && (
            <div className="absolute inset-x-0 top-[calc(100%+4px)] z-10 max-h-[160px] overflow-y-auto
              rounded-lg border border-white/10 bg-[rgba(20,22,26,.98)] p-1 shadow-lg shadow-black/50"
              style={{ animation: "jg-fade-rise 140ms cubic-bezier(.16,1,.3,1) both" }}>
              {suggestions.map((u) => (
                // `onMouseDown` y no `onClick`: el blur del input dispara primero
                // y con `onClick` la lista ya se habría ocultado antes de que
                // el clic llegara a registrarse.
                <button key={u.id} onMouseDown={() => void add(u.username)}
                  className="jg-press flex w-full items-center gap-2 rounded-md p-1.5 text-left hover:bg-white/[.05]">
                  <Avatar name={u.username} size={17} />
                  <span className="text-[11.5px] text-fg">{u.username}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {error && <p className="mt-2.5 text-[11px] text-danger-fg">{error}</p>}

        <div className="mt-4 text-right">
          <button onClick={onClose} className="text-[11px] text-muted hover:text-fg">Cerrar</button>
        </div>
      </div>
    </Center>
  );
}
