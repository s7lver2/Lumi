import { useEffect, useState } from "react";

import { CatalogSearch } from "../catalog/CatalogSearch";
import { ProfileDialog } from "../catalog/ProfileDialog";
import { RemoteRepos } from "../catalog/RemoteRepos";
import { api, type DependenciaRota, type Proyecto, type ResumenIndice } from "../lib/api";
import { Icon } from "../ui/Icon";
import { Overlay } from "../ui/Overlay";
import { NewProjectDialog } from "./NewProjectDialog";
import { ProjectDetail } from "./ProjectDetail";
import { ProjectRow } from "./ProjectRow";

/** Maestro-detalle de proyectos (repos de GitHub etiquetados `lumi-index`) —
 *  sustituye a la antigua pantalla de Índices: un índice ya no se crea
 *  suelto, vive dentro de un proyecto elegido de antemano. Mismo esqueleto de
 *  grid `[206px_1fr]` que AdminPanel/ProfileView/AjustesView (`client/`),
 *  adaptado: la columna lateral aquí es una lista de datos filtrable, no una
 *  navegación fija de secciones. */
export function ProjectsView({ onAbrir }: { onAbrir: (id: number) => void }) {
  const [proyectos, setProyectos] = useState<Proyecto[] | null>(null);
  const [seleccionado, setSeleccionado] = useState<string | null>(null);
  const [filtro, setFiltro] = useState("");
  const [creando, setCreando] = useState(false);
  const [cuenta, setCuenta] = useState<string | null>(null);
  const [rotas, setRotas] = useState<DependenciaRota[]>([]);
  const [indicesLocales, setIndicesLocales] = useState<ResumenIndice[]>([]);

  const cargar = () => void api.proyectosLista().then(setProyectos, () => setProyectos([]));
  useEffect(cargar, []);
  useEffect(() => { void api.indicesLista().then(setIndicesLocales); }, []);
  useEffect(() => { void api.catalogoDependenciasRotas().then(setRotas, () => {}); }, []);
  // Nunca al mover el mapa, siempre al abrir esta pantalla: es lo que
  // mantiene el catálogo remoto (RemoteRepos, el buscador) al día sin
  // pedirlo a mano.
  useEffect(() => { void api.catalogoRefrescar(); }, []);

  const t = filtro.trim().toLowerCase();
  const filtrados = (proyectos ?? []).filter((p) => p.repo.toLowerCase().includes(t));
  const actual = (proyectos ?? []).find((p) => p.repo === seleccionado) ?? null;

  return (
    <div className="grid h-full w-full grid-cols-[206px_1fr] overflow-hidden bg-bg">
      <div className="flex flex-col border-r border-border">
        <div className="flex flex-col gap-2 border-b border-border p-3">
          <div className="flex items-center gap-1.5 rounded-lg border border-border bg-panel px-2 py-1.5">
            <Icon name="search" size={11} className="shrink-0 text-subtle" />
            <input value={filtro} onChange={(e) => setFiltro(e.target.value)}
              placeholder="Buscar proyecto…"
              className="w-full bg-transparent text-[11px] text-fg outline-none placeholder:text-subtle" />
          </div>
          <button onClick={() => setCreando(true)}
            className="jg-press rounded-lg border border-border px-2.5 py-1.5 text-[10.5px] text-fg">
            + Nuevo proyecto
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-1.5">
          {proyectos !== null && proyectos.length === 0 && (
            <p className="p-3 text-center text-[10.5px] leading-relaxed text-subtle">
              Sin proyectos todavía. Crea uno para empezar a indexar.
            </p>
          )}
          {filtrados.map((p) => (
            <ProjectRow key={p.repo} p={p} activo={p.repo === seleccionado} onAbrir={() => setSeleccionado(p.repo)} />
          ))}
        </div>
      </div>

      <div className="overflow-y-auto">
        {actual ? (
          <ProjectDetail proyecto={actual} onAbrirIndice={onAbrir} onCambiado={cargar} />
        ) : (
          <div className="mx-auto flex max-w-[640px] flex-col gap-4 p-8">
            <CatalogSearch locales={indicesLocales} onAbrirLocal={onAbrir} onAbrirCuenta={setCuenta} />
            <p className="text-[11px] leading-relaxed text-subtle">
              Elige un proyecto de la izquierda, o crea uno nuevo, para ver sus índices.
            </p>

            {rotas.length > 0 && (
              <div className="rounded-card border border-warning/40 bg-warning/[.07] p-3.5">
                <p className="text-[11.5px] text-warning-fg">
                  {rotas.length === 1 ? "Una dependencia" : `${rotas.length} dependencias`} de lo que
                  publicaste ha desaparecido
                </p>
                <div className="mt-1.5 flex flex-col gap-1">
                  {rotas.map((r) => (
                    <div key={r.paquete} className="flex items-center justify-between text-[11px]">
                      <span className="text-muted">
                        «{r.indice}» dependía de <span className="font-mono text-fg">{r.paquete}</span> de{" "}
                        <span className="font-mono">{r.autor}</span>
                      </span>
                      <span className="font-mono text-[10px] text-subtle">{r.quadkeys} teselas</span>
                    </div>
                  ))}
                </div>
                <p className="mt-2 text-[10.5px] leading-relaxed text-muted">
                  Esas teselas están libres otra vez: el reclamo se cayó con el paquete.
                </p>
              </div>
            )}

            <RemoteRepos />
          </div>
        )}
      </div>

      {cuenta && (
        <Overlay>
          <ProfileDialog cuenta={cuenta} onCerrar={() => setCuenta(null)} />
        </Overlay>
      )}

      {creando && (
        <Overlay>
          <NewProjectDialog
            onCancelar={() => setCreando(false)}
            onCreado={(p) => { setCreando(false); cargar(); setSeleccionado(p.repo); }}
          />
        </Overlay>
      )}
    </div>
  );
}
