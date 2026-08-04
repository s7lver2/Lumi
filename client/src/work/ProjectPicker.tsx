import { useEffect, useState } from "react";
import { api, type Project, type Usage } from "../lib/api";
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
  if (s < 3600) return `hace ${Math.max(1, Math.floor(s / 60))} min`;
  if (s < 86400) return `hace ${Math.floor(s / 3600)} h`;
  return `hace ${Math.floor(s / 86400)} d`;
}

export function ProjectPicker({ onOpen }: { onOpen: (p: Project) => void }) {
  const token = useServer((s) => s.token) ?? undefined;
  const [list, setList] = useState<Project[] | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [sel, setSel] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const [p, u] = await Promise.all([
        api.get<Project[]>("/v1/projects", token),
        api.get<Usage>("/v1/me/usage", token),
      ]);
      setList(p);
      setUsage(u);
      setSel((s) => s ?? p[0]?.id ?? null);
    } catch (e) {
      setError(String(e));
    }
  }
  useEffect(() => { void load(); }, []);

  async function create() {
    if (!name.trim()) return;
    setError(null);
    try {
      const p = await api.post<Project>("/v1/projects", { name }, token);
      setName("");
      setCreating(false);
      onOpen(p);
    } catch (e) {
      setError(String(e));
    }
  }

  const open = () => {
    const p = list?.find((x) => x.id === sel);
    if (p) onOpen(p);
  };

  return (
    <div className="w-[420px] rounded-card border border-white/[.13] bg-[rgba(16,19,25,.86)] p-5 shadow-lg shadow-black/40 backdrop-blur-xl">
      <p className="text-[13px] text-fg">Elige un proyecto</p>
      <p className="mb-3.5 text-[11px] text-muted">
        cada proyecto tiene sus casos y sus imágenes, separados del resto
      </p>

      {list === null ? (
        <p className="py-6 text-center text-[11px] text-subtle">cargando</p>
      ) : (
        <div className="max-h-[46vh] space-y-2 overflow-y-auto">
          {list.map((p) => (
            <button key={p.id} onClick={() => setSel(p.id)} onDoubleClick={() => onOpen(p)}
              className={`block w-full rounded-lg border p-2.5 text-left transition-colors duration-300 ease-expo ${
                sel === p.id ? "border-white/25 bg-white/[.05]" : "border-border hover:border-white/15"
              }`}>
              <div className="flex items-baseline justify-between gap-3">
                <span className="truncate text-[12.5px] text-fg">{p.name}</span>
                <span className="shrink-0 font-mono text-[10px] text-subtle">{ago(p.updated_at)}</span>
              </div>
              <div className="mt-1 font-mono text-[10px] text-muted">
                {p.cases} casos · {p.images} imágenes · {size(p.bytes)}
                {p.role === "member" && " · invitado"}
              </div>
            </button>
          ))}

          {creating ? (
            <div className="rounded-lg border border-dashed border-border p-2.5">
              <input autoFocus value={name} onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") void create(); if (e.key === "Escape") setCreating(false); }}
                placeholder="nombre del proyecto"
                className="w-full bg-transparent text-[12.5px] text-fg outline-none placeholder:text-subtle" />
            </div>
          ) : (
            <button onClick={() => setCreating(true)}
              className="block w-full rounded-lg border border-dashed border-border p-2.5 text-center text-[11px] text-subtle hover:text-fg">
              + nuevo proyecto
            </button>
          )}
        </div>
      )}

      {error && (
        <div className="mt-3 flex items-start gap-2.5 text-xs">
          <Icon name="alert" className="mt-0.5 text-danger-fg" />
          <span className="text-muted">{error}</span>
        </div>
      )}

      <div className="mt-4 flex items-center justify-between gap-4">
        {/* El origen del límite se dice siempre: uno sin origen visible es
            indepurable cuando alguien pregunta por qué no le caben más. */}
        <span className="font-mono text-[10px] text-subtle">
          {usage
            ? `${size(usage.used_bytes)} de ${usage.limit_gb} GB · ${usage.overridden ? "límite propio" : "heredado del global"}`
            : ""}
        </span>
        <button onClick={creating ? create : open} disabled={!creating && sel === null}
          className="shrink-0 rounded-lg bg-accent px-5 py-2 text-xs font-medium text-black transition-transform duration-300 ease-expo active:translate-y-px disabled:opacity-40">
          {creating ? "Crear" : "Abrir"}
        </button>
      </div>
    </div>
  );
}
