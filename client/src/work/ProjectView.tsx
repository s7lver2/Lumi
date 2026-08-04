import { useEffect, useMemo, useState } from "react";
import { api, type Case, type Project, type Usage } from "../lib/api";
import { useServer } from "../lib/store";
import { MapCanvas, type Marker } from "./MapCanvas";

const GB = 1024 * 1024 * 1024;
const size = (b: number) =>
  b < GB ? `${Math.round(b / 1024 / 1024)} MB` : `${(b / GB).toFixed(1)} GB`;

export function ProjectView({
  project, onOpenCase, rail,
}: { project: Project; onOpenCase: (c: Case) => void; rail: React.ReactNode }) {
  const token = useServer((s) => s.token) ?? undefined;
  const [cases, setCases] = useState<Case[]>([]);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const [k, u] = await Promise.all([
        api.get<Case[]>(`/v1/projects/${project.id}/cases`, token),
        api.get<Usage>("/v1/me/usage", token),
      ]);
      setCases(k);
      setUsage(u);
    } catch (e) {
      setError(String(e));
    }
  }
  useEffect(() => { void load(); }, [project.id]);

  async function create() {
    if (!name.trim()) return;
    try {
      const c = await api.post<Case>(`/v1/projects/${project.id}/cases`, { name }, token);
      setName("");
      setCreating(false);
      setCases((v) => [...v, c]);
    } catch (e) {
      setError(String(e));
    }
  }

  // Un marcador por caso resuelto. Es la lectura que la v1 no daba: la
  // investigación entera repartida geográficamente.
  const markers: Marker[] = useMemo(
    () =>
      cases
        .filter((c) => c.lat !== null && c.lng !== null)
        .map((c, i) => ({
          id: String(c.id), lat: c.lat!, lng: c.lng!, label: String(i + 1),
          kind: i === 0 ? ("top" as const) : ("alt" as const),
        })),
    [cases],
  );

  const pending = cases.reduce((n, c) => n + (c.analyses - c.resolved), 0);
  const projectBytes = project.bytes;

  return (
    <div className="relative h-full w-full">
      <MapCanvas markers={markers} onMarker={(id) => {
        const c = cases.find((x) => String(x.id) === id);
        if (c) onOpenCase(c);
      }} />
      {rail}

      <aside className="absolute inset-y-0 left-10 z-20 w-[236px] overflow-y-auto border-r border-border bg-[rgba(16,18,21,.94)] p-3 backdrop-blur-xl">
        <div className="mb-2 flex items-baseline justify-between">
          <span className="truncate text-[13px] text-fg">{project.name}</span>
          <span className="shrink-0 text-[8px] uppercase tracking-[.11em] text-subtle">
            {cases.length} casos
          </span>
        </div>

        {cases.map((c, i) => (
          <button key={c.id} onClick={() => onOpenCase(c)}
            className="mb-1.5 block w-full rounded-lg border border-border p-2 text-left transition-colors duration-300 ease-expo hover:border-white/20">
            <div className="flex items-baseline gap-1.5">
              <span className="text-[9px] text-subtle">{i + 1}</span>
              <span className="flex-1 truncate text-[11.5px] text-fg">{c.name}</span>
              {c.resolved > 0 && (
                <span className="rounded border border-border px-1 text-[8.5px] text-subtle">resuelto</span>
              )}
            </div>
            <div className="mt-1 font-mono text-[10px] text-muted">
              {c.images} imágenes ·{" "}
              {c.analyses === 0
                ? "sin análisis"
                : c.resolved === c.analyses
                  ? `${c.analyses} análisis`
                  : `${c.analyses - c.resolved} esperando al motor`}
            </div>
          </button>
        ))}

        {creating ? (
          <div className="rounded-lg border border-dashed border-border p-2">
            <input autoFocus value={name} onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void create(); if (e.key === "Escape") setCreating(false); }}
              placeholder="nombre del caso"
              className="w-full bg-transparent text-[11.5px] text-fg outline-none placeholder:text-subtle" />
          </div>
        ) : (
          <button onClick={() => setCreating(true)}
            className="block w-full rounded-lg border border-dashed border-border p-2 text-center text-[11px] text-subtle hover:text-fg">
            + nuevo caso
          </button>
        )}

        {error && <p className="mt-2.5 text-[11px] text-danger-fg">{error}</p>}

        <div className="mt-3.5">
          <p className="text-[8px] uppercase tracking-[.11em] text-subtle">
            Almacenamiento del proyecto
          </p>
          <div className="mt-1.5 h-0.5 rounded bg-elevated">
            <div className="h-full rounded bg-fg"
              style={{ width: usage ? `${Math.min(100, (projectBytes / (usage.limit_gb * GB)) * 100)}%` : "0%" }} />
          </div>
          <p className="mt-1 font-mono text-[10px] text-subtle">
            {size(projectBytes)}
            {usage && ` · ${size(usage.used_bytes)} de ${usage.limit_gb} GB en total`}
          </p>
        </div>
      </aside>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex items-end justify-between bg-gradient-to-t from-[rgba(10,11,13,.92)] to-transparent px-4 py-2.5 pl-[286px]">
        <div className="flex items-end">
          <Field k="Proyecto" v={project.name} />
          <Field k="Casos resueltos" v={`${cases.filter((c) => c.resolved > 0).length} de ${cases.length}`} />
          {pending > 0 && <Field k="Pendientes" v={`${pending} · sin motor`} dim />}
        </div>
      </div>
    </div>
  );
}

function Field({ k, v, dim }: { k: string; v: string; dim?: boolean }) {
  return (
    <div className="mr-6">
      <div className="text-[8px] uppercase tracking-[.11em] text-subtle">{k}</div>
      <div className={`text-[11.5px] ${dim ? "text-subtle" : "text-fg"}`}>{v}</div>
    </div>
  );
}
