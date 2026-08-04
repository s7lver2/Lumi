import { useEffect, useMemo, useState } from "react";
import { api, type Case, type Project, type Usage } from "../lib/api";
import { useServer } from "../lib/store";
import { Icon } from "../ui/Icon";
import { PromptDialog } from "../ui/PromptDialog";
import { MapCanvas, type Marker } from "./MapCanvas";
import { TopBar } from "./TopBar";

const GB = 1024 * 1024 * 1024;
const size = (b: number) =>
  b < GB ? `${Math.round(b / 1024 / 1024)} MB` : `${(b / GB).toFixed(1)} GB`;

export function ProjectView({
  project, onOpenCase, onProjects, rail,
}: {
  project: Project;
  onOpenCase: (c: Case) => void;
  onProjects: () => void;
  rail: React.ReactNode;
}) {
  const token = useServer((s) => s.token) ?? undefined;
  const [cases, setCases] = useState<Case[] | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
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

  async function create(name: string) {
    setBusy(true); setError(null);
    try {
      const c = await api.post<Case>(`/v1/projects/${project.id}/cases`, { name }, token);
      setCreating(false);
      onOpenCase(c);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  const list = cases ?? [];

  // Un marcador por caso resuelto. Es la lectura que la v1 no daba: la
  // investigación entera repartida geográficamente. Depende de `cases` y no de
  // `list`, que es un array nuevo en cada render y anularía el memo.
  const markers: Marker[] = useMemo(
    () =>
      (cases ?? [])
        .filter((c) => c.lat !== null && c.lng !== null)
        .map((c, i) => ({
          id: String(c.id), lat: c.lat!, lng: c.lng!, label: String(i + 1),
          kind: i === 0 ? ("top" as const) : ("alt" as const),
        })),
    [cases],
  );

  const pending = list.reduce((n, c) => n + (c.analyses - c.resolved), 0);
  const resolved = list.filter((c) => c.resolved > 0).length;
  // El número del marcador solo lo llevan los casos que están EN el mapa; en
  // la lista hay más, así que no vale con el índice de la fila.
  const markerNo = (id: number) => {
    const i = markers.findIndex((m) => m.id === String(id));
    return i < 0 ? null : i + 1;
  };

  return (
    <div className="relative h-full w-full"
      style={{ animation: "jg-page-fade-in 260ms cubic-bezier(.16,1,.3,1) both" }}>
      <MapCanvas markers={markers} onMarker={(id) => {
        const c = list.find((x) => String(x.id) === id);
        if (c) onOpenCase(c);
      }} />
      {rail}

      <TopBar
        crumbs={[{ label: "Proyectos", onClick: onProjects }, { label: project.name }]}
        right={
          <div className="flex items-center gap-2.5">
            <span className="rounded border px-1.5 py-px text-[8.5px] tracking-[.04em]
              border-white/[.28] text-fg">
              {project.role === "owner" ? "dueño" : "invitado"}
            </span>
            {/* Contado desde los casos recién leídos y no desde `project`, que
                viene del selector y se queda viejo en cuanto subes una foto. */}
            <span className="font-mono text-[10px] text-subtle">
              {list.length} {list.length === 1 ? "caso" : "casos"} ·{" "}
              {list.reduce((n, c) => n + c.images, 0)} imágenes
            </span>
          </div>
        } />

      <aside className="absolute bottom-0 left-11 top-[38px] z-20 flex w-[262px] flex-col
        border-r border-border bg-[rgba(16,18,21,.93)] p-[12px_11px] backdrop-blur-xl"
        style={{ animation: "jg-slide-left 300ms cubic-bezier(.16,1,.3,1) both" }}>
        <div className="mb-2.5 flex items-center justify-between">
          <span className="text-[8px] uppercase tracking-[.11em] text-subtle">Casos del proyecto</span>
          <button onClick={() => setCreating(true)} title="Nuevo caso"
            className="jg-press grid h-[18px] w-[18px] place-items-center rounded text-subtle hover:text-fg">
            <Icon name="plus" size={11} />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto">
          {cases === null && <p className="py-4 text-center text-[11px] text-subtle">cargando</p>}
          {cases !== null && list.length === 0 && (
            <p className="px-1 py-4 text-[11px] leading-relaxed text-subtle">
              Todavía no hay ningún caso. Un caso agrupa las imágenes de una misma
              investigación dentro de este proyecto.
            </p>
          )}

          {list.map((c, i) => {
            const no = markerNo(c.id);
            const listo = c.resolved > 0;
            return (
              <button key={c.id} onClick={() => onOpenCase(c)}
                style={{ animation: `jg-fade-rise 220ms ${Math.min(i, 8) * 26}ms cubic-bezier(.16,1,.3,1) both` }}
                className={`block w-full rounded-[9px] border p-[9px_10px] text-left
                  transition-colors duration-300 ease-expo hover:border-white/20 hover:bg-white/[.03]
                  ${listo ? "border-border" : "border-border opacity-[.78]"}`}>
                <div className="flex items-center gap-[7px]">
                  <span className={`grid h-4 w-4 shrink-0 place-items-center rounded-full text-[9px] ${
                    no === 1 ? "bg-fg text-black"
                      : no !== null ? "border border-white/[.22] text-muted"
                      : "border border-dashed border-[#3a3e44] text-subtle"
                  }`}>{no ?? "·"}</span>
                  <span className={`flex-1 truncate text-[11.5px] ${listo ? "text-fg" : "text-muted"}`}>
                    {c.name}
                  </span>
                </div>
                <div className="mt-[5px] pl-[23px] font-mono text-[10px] text-muted">
                  {c.images} {c.images === 1 ? "imagen" : "imágenes"} ·{" "}
                  {c.analyses === 0
                    ? "sin análisis"
                    : c.resolved === c.analyses
                      ? `${c.analyses} ${c.analyses === 1 ? "análisis" : "análisis"}`
                      : `${c.analyses - c.resolved} esperando al motor`}
                </div>
              </button>
            );
          })}
        </div>

        <button onClick={() => setCreating(true)}
          className="jg-press mt-1.5 block w-full rounded-[9px] border border-dashed border-border p-2
            text-center text-[11px] text-subtle hover:border-white/20 hover:text-fg">
          + nuevo caso
        </button>

        {error && !creating && <p className="mt-2.5 text-[11px] leading-snug text-danger-fg">{error}</p>}

        <div className="mt-3.5">
          <p className="text-[8px] uppercase tracking-[.11em] text-subtle">
            Almacenamiento del proyecto
          </p>
          <div className="mt-1.5 h-[3px] rounded bg-elevated">
            <div className="h-full rounded bg-fg transition-[width] duration-700 ease-expo"
              style={{ width: usage ? `${Math.min(100, (project.bytes / (usage.limit_gb * GB)) * 100)}%` : "0%" }} />
          </div>
          <p className="mt-1 font-mono text-[10px] text-subtle">
            {size(project.bytes)}
            {usage && ` · ${size(usage.used_bytes)} de ${usage.limit_gb} GB en total`}
          </p>
        </div>
      </aside>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 left-[306px] z-20 flex items-end
        justify-between bg-gradient-to-t from-[rgba(10,11,13,.94)] to-transparent px-[18px] py-3">
        <div className="flex gap-[30px]">
          <Field k="Proyecto" v={project.name} />
          <Field k="Casos resueltos" v={`${resolved} de ${list.length}`} />
          {pending > 0 && <Field k="Pendientes" v={`${pending} · sin motor`} dim />}
        </div>
      </div>

      <PromptDialog open={creating} title="Nuevo caso"
        subtitle="Un caso agrupa las imágenes de una misma investigación dentro de este proyecto."
        placeholder="nombre del caso" confirmLabel="Crear" busy={busy} error={error}
        onConfirm={create} onClose={() => { setCreating(false); setError(null); }} />
    </div>
  );
}

function Field({ k, v, dim }: { k: string; v: string; dim?: boolean }) {
  return (
    <div>
      <div className="text-[8px] uppercase tracking-[.11em] text-subtle">{k}</div>
      <div className={`mt-[3px] text-[11.5px] ${dim ? "text-subtle" : "text-fg"}`}>{v}</div>
    </div>
  );
}
