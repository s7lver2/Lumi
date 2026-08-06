import { useEffect, useState } from "react";
import { api, type Case, type Project, type ProjectImage } from "../lib/api";
import { useReorder } from "../lib/useReorder";
import { useServer } from "../lib/store";
import { ContextMenu, menuAt, type MenuState } from "../ui/ContextMenu";
import { PromptDialog } from "../ui/PromptDialog";
import { CaseRow } from "./CaseRow";

/** Los casos del proyecto. El mapa de verdad vive dentro de cada caso, con sus
 *  resultados; aquí solo hay una lista que abrir, sin nada más que cargar. */
export function ProjectView({
  project, onOpenCase, rail, drawer,
}: {
  project: Project;
  onOpenCase: (c: Case) => void;
  rail: React.ReactNode;
  drawer: React.ReactNode;
}) {
  const token = useServer((s) => s.token) ?? undefined;
  const [cases, setCases] = useState<Case[] | null>(null);
  const [covers, setCovers] = useState<Map<number, number[]>>(new Map());
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [renaming, setRenaming] = useState<Case | null>(null);

  async function load() {
    try {
      setCases(await api.get<Case[]>(`/v1/projects/${project.id}/cases`, token));
    } catch (e) {
      setError(String(e));
    }
    // Las portadas salen de UNA llamada al catálogo del proyecto entero, no de
    // una por caso: cuarenta casos serían cuarenta peticiones para enseñar tres
    // miniaturas cada uno.
    try {
      const all = await api.get<ProjectImage[]>(`/v1/projects/${project.id}/images`, token);
      const m = new Map<number, number[]>();
      for (const im of all) {
        const v = m.get(im.case_id) ?? [];
        if (v.length < 3) { v.push(im.id); m.set(im.case_id, v); }
      }
      setCovers(m);
    } catch { /* sin portadas: las filas salen con el hueco vacío */ }
  }
  useEffect(() => { void load(); }, [project.id]);

  const list = cases ?? [];
  const orden = useReorder(`cases-${project.id}`, list, "y");

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

  async function rename(c: Case, name: string) {
    setBusy(true); setError(null);
    try {
      await api.patch(`/v1/cases/${c.id}`, { name }, token);
      setRenaming(null);
      await load();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove(c: Case) {
    setError(null);
    try {
      await api.del(`/v1/cases/${c.id}`, token);
      await load();
    } catch (e) {
      setError(String(e));
    }
  }

  return (
    // Anclado a los cuatro bordes, no `h-full`: ver el comentario gemelo en
    // CaseView — la altura no la resolvía la cadena flex.
    <div className="absolute inset-0 overflow-hidden"
      style={{ animation: "jg-page-fade-in 260ms cubic-bezier(.16,1,.3,1) both" }}>
      <div className="pointer-events-none absolute inset-0"
        style={{ background: "radial-gradient(120% 90% at 50% 35%, #16191d 0%, #0e0f11 70%)" }} />
      {rail}

      <div className="absolute inset-y-0 left-11 right-0 overflow-y-auto px-[26px] py-[22px]">
        {/* El título también vive sobre el mapa: sin una sombra detrás se pierde
            en cuanto le toca caer sobre un país claro. */}
        <h2 className="text-[16px] font-semibold tracking-[-.01em]"
          style={{ textShadow: "0 1px 12px rgba(6,8,10,.9)" }}>{project.name}</h2>

        <div className="mt-3.5 flex max-w-[760px] flex-col gap-1.5">
          {cases === null && <p className="py-6 text-center text-[11px] text-subtle">cargando</p>}

          {orden.items.map((c, i) => (
            <div key={c.id}
              style={{ animation: `jg-fade-rise 380ms ${Math.min(i, 8) * 40}ms cubic-bezier(.16,1,.3,1) both` }}>
              <CaseRow case_={c} covers={covers.get(c.id) ?? []}
                drag={orden.drag(c.id)}
                onOpen={() => { if (!orden.dragging) onOpenCase(c); }}
                onMenu={(e) => menuAt(e, c.name, [
                  { label: "Abrir", hint: "↵", onClick: () => onOpenCase(c) },
                  { label: "Renombrar", hint: "F2", onClick: () => setRenaming(c) },
                  null,
                  { label: "Eliminar caso", danger: true, onClick: () => void remove(c) },
                ], setMenu)} />
            </div>
          ))}

          <button onClick={() => setCreating(true)} title="Nuevo caso"
            className="jg-press rounded-[10px] border border-dashed border-white/[.14]
              bg-[rgba(16,18,21,.55)] p-[11px] text-center text-[13px] leading-none text-subtle
              backdrop-blur-md hover:border-white/25 hover:text-fg">
            +
          </button>
        </div>

        {error && <p className="mt-3 text-[11px] text-danger-fg">{error}</p>}
      </div>

      {drawer}
      <ContextMenu state={menu} onClose={() => setMenu(null)} />

      <PromptDialog open={creating} chrome icon="pin"
        title={`Nuevo caso en «${project.name}»`} subtitle="un caso, un sitio que averiguar"
        placeholder="Muelle 7" taken={list.map((c) => c.name)}
        busy={busy} error={error}
        onConfirm={create} onClose={() => { setCreating(false); setError(null); }} />

      <PromptDialog open={renaming !== null} chrome icon="pin"
        title="Renombrar caso" placeholder={renaming?.name ?? ""} confirmLabel="Guardar"
        taken={list.filter((c) => c.id !== renaming?.id).map((c) => c.name)}
        busy={busy} error={error}
        onConfirm={(n) => renaming && void rename(renaming, n)}
        onClose={() => { setRenaming(null); setError(null); }} />
    </div>
  );
}
