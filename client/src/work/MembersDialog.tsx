import { useEffect, useState } from "react";
import { api, type Project, type ProjectMember } from "../lib/api";
import { useServer } from "../lib/store";
import { Avatar } from "../ui/Avatar";

export function MembersDialog({ project, onClose }: { project: Project; onClose: () => void }) {
  const token = useServer((s) => s.token) ?? undefined;
  const [rows, setRows] = useState<ProjectMember[]>([]);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      setRows(await api.get<ProjectMember[]>(`/v1/projects/${project.id}/members`, token));
    } catch (e) {
      setError(String(e));
    }
  }
  useEffect(() => { void load(); }, [project.id]);

  async function add() {
    if (!name.trim()) return;
    setError(null);
    try {
      await api.post(`/v1/projects/${project.id}/members`, { username: name }, token);
      setName("");
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
    // El carril y la barra superior se dibujan encima de esta misma capa, no
    // le restan espacio real: centrar en `inset-0` a secas deja el diálogo
    // corrido hacia esa esquina. `pl-11 pt-[38px]` descuentan justo lo que
    // ocupan, así el centro percibido es el del mapa visible, no el de la
    // ventana entera.
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/50 pl-11 pt-[38px]"
      onClick={onClose}>
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

        <div className="mt-3 flex gap-2">
          <input value={name} onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void add(); }}
            placeholder="nombre de usuario"
            className="flex-1 rounded-lg border border-border bg-[#0d0f12] px-3 py-2 text-[12.5px] text-fg outline-none transition-[border-color] duration-300 ease-expo focus:border-white/40" />
          <button onClick={add}
            className="rounded-lg border border-white/15 px-3 text-xs text-fg active:translate-y-px">
            Invitar
          </button>
        </div>

        {error && <p className="mt-2.5 text-[11px] text-danger-fg">{error}</p>}

        <div className="mt-4 text-right">
          <button onClick={onClose} className="text-[11px] text-muted hover:text-fg">Cerrar</button>
        </div>
      </div>
    </div>
  );
}
