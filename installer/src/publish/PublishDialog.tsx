import { useEffect, useState } from "react";

import { api, type Previsualizacion, type Repo } from "../lib/api";
import { Icon } from "../ui/Icon";
import { descartar as descartarSeguimiento, estadoActual, iniciar as iniciarSeguimiento, suscribir } from "./publishTracker";

const KB = 1024;
function tamano(bytes: number): string {
  if (bytes < KB * KB) return `${(bytes / KB).toFixed(0)} KB`;
  if (bytes < KB * KB * KB) return `${(bytes / KB / KB).toFixed(1)} MB`;
  return `${(bytes / KB / KB / KB).toFixed(2)} GB`;
}

type Paso = 1 | 2 | 3 | "subiendo";

/** Tres pasos y ninguna sorpresa: se ve el troceado exacto y el peso antes de
 *  subir un byte, igual que se ven los euros antes de descargar. El paso 3
 *  —el descargo— solo aparece si el índice usó alguna fuente cuyos términos
 *  no permiten redistribuir; si no, el paso 2 lleva directo a publicar. */
/** El seguimiento de la subida vive en `publishTracker`, no aquí: el trabajo
 *  sigue en el backend aunque este diálogo se cierre, así que la barra de
 *  progreso se limita a mostrar lo que el tracker ya sabe en vez de sondear
 *  por su cuenta — eso es lo que permite reabrir el diálogo (o un aviso en
 *  cualquier otra pantalla) a mitad de una subida y verla seguir por donde iba. */
export function PublishDialog({ indiceId, nombre, onHecho }: {
  indiceId: number; nombre: string; onHecho: () => void;
}) {
  const enCurso = estadoActual();
  const yaSubiendoEsteIndice = enCurso?.indiceId === indiceId;
  const [paso, setPaso] = useState<Paso>(yaSubiendoEsteIndice ? "subiendo" : 1);
  const [repos, setRepos] = useState<Repo[]>([]);
  const [repo, setRepo] = useState("");
  const [filtro, setFiltro] = useState("");
  const [previa, setPrevia] = useState<Previsualizacion | null>(null);
  const [descargo, setDescargo] = useState(false);
  const [progreso, setProgreso] = useState(yaSubiendoEsteIndice ? enCurso.progreso : null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api.publicarRepos().then(setRepos);
    void api.publicarPrevisualizar(indiceId).then(setPrevia);
  }, [indiceId]);

  useEffect(() => suscribir((e) => {
    if (e?.indiceId !== indiceId) return;
    setProgreso(e.progreso);
    if (e.progreso.error) setError(e.progreso.error);
  }), [indiceId]);

  const hayNoRedistribuibles = (previa?.no_redistribuibles.length ?? 0) > 0;
  // Los ya etiquetados primero: son donde ya publicaste algo, y es lo que
  // vas a querer casi siempre en vez de bucear entre repos sin relación.
  const reposOrdenados = [...repos]
    .filter((r) => r.nombre.toLowerCase().includes(filtro.trim().toLowerCase()))
    .sort((a, b) => Number(b.tiene_etiqueta) - Number(a.tiene_etiqueta));

  async function publicar() {
    setError(null);
    setPaso("subiendo");
    try {
      await api.publicarArrancar(indiceId, repo, descargo);
    } catch (e) {
      setError(String(e));
      setPaso(3);
      return;
    }
    // Recién aquí existe de verdad algo que seguir: antes de que
    // `publicarArrancar` resuelva, el hueco de `Estado` puede seguir vacío o
    // guardar el resultado de la publicación anterior.
    iniciarSeguimiento(indiceId, nombre);
  }

  function siguienteDesdePaso2() {
    if (hayNoRedistribuibles) setPaso(3);
    else void publicar();
  }

  return (
    <div className="w-[520px] rounded-card border border-white/[.13] bg-[rgba(16,19,25,.66)] p-[20px_22px] backdrop-blur-xl">
      <p className="text-sm text-fg">Publicar «{nombre}»</p>

      {paso === 1 && (
        <div className="mt-4">
          <p className="text-[11px] leading-relaxed text-muted">
            Elige dónde vive. El repositorio recibe la etiqueta <span className="font-mono text-fg">lumi-index</span>,
            que es como te encuentran los demás.
          </p>

          {repos.length > 6 && (
            <div className="mt-2.5 flex items-center gap-2 rounded-lg border border-border bg-panel px-2.5 py-1.5">
              <Icon name="search" size={12} className="shrink-0 text-subtle" />
              <input
                value={filtro}
                onChange={(e) => setFiltro(e.target.value)}
                placeholder="Filtrar tus repositorios…"
                className="w-full bg-transparent text-[11.5px] text-fg outline-none placeholder:text-subtle"
              />
            </div>
          )}

          <div className="mt-2.5 flex max-h-[260px] flex-col gap-1.5 overflow-y-auto">
            {reposOrdenados.map((r) => (
              <button key={r.nombre} onClick={() => setRepo(r.nombre)}
                className={`jg-press flex items-center gap-2.5 rounded-lg border px-3 py-2 text-left ${
                  repo === r.nombre ? "border-fg/40 bg-white/[.05]" : "border-border"}`}>
                <span className={`grid h-3 w-3 shrink-0 place-items-center rounded-full border ${
                  repo === r.nombre ? "border-fg" : "border-subtle"}`}>
                  {repo === r.nombre && <span className="h-1.5 w-1.5 rounded-full bg-fg" />}
                </span>
                <span className="flex-1 truncate font-mono text-[11px] text-fg">{r.nombre}</span>
                {r.tiene_etiqueta && (
                  <span className="rounded-full border border-border px-1.5 py-px text-[9px] text-subtle">
                    ya tiene la etiqueta
                  </span>
                )}
                {r.privado && <span className="text-[9.5px] text-subtle">privado</span>}
              </button>
            ))}
            {repos.length > 0 && reposOrdenados.length === 0 && (
              <p className="text-[11px] text-subtle">Nada con «{filtro.trim()}».</p>
            )}
            {repos.length === 0 && <p className="text-[11px] text-subtle">Sin repositorios propios todavía.</p>}
          </div>

          <div className="mt-4 flex justify-end">
            <button onClick={() => setPaso(2)} disabled={!repo}
              className="jg-press rounded-lg bg-accent px-3.5 py-2 text-[11.5px] font-medium text-black disabled:opacity-40">
              Continuar
            </button>
          </div>
        </div>
      )}

      {paso === 2 && previa && (
        <div className="mt-4">
          <p className="text-[11px] leading-relaxed text-muted">
            Se sube en {previa.trozos.length} {previa.trozos.length === 1 ? "trozo" : "trozos"}, uno por zona.
          </p>
          <div className="mt-2.5 flex flex-col gap-1">
            {previa.trozos.map((t) => (
              <div key={t.zona} className="flex items-center justify-between rounded-lg border border-border px-3 py-1.5 font-mono text-[10.5px]">
                <span className="text-fg">{t.zona || "raíz"}</span>
                <span className="text-subtle">{t.quadkeys} teselas · {tamano(t.bytes)}</span>
              </div>
            ))}
          </div>
          <div className="mt-2.5 flex items-center justify-between text-[11px]">
            <span className="text-muted">Total</span>
            <span className="font-mono text-fg">{tamano(previa.bytes_total)}</span>
          </div>
          <div className="mt-4 flex justify-between">
            <button onClick={() => setPaso(1)} className="jg-press text-[11px] text-subtle underline">Atrás</button>
            <button onClick={siguienteDesdePaso2}
              className="jg-press rounded-lg bg-accent px-3.5 py-2 text-[11.5px] font-medium text-black">
              {hayNoRedistribuibles ? "Continuar" : "Publicar"}
            </button>
          </div>
        </div>
      )}

      {paso === 3 && previa && (
        <div className="mt-4">
          <p className="text-[11px] leading-relaxed text-muted">
            Este índice usó imágenes de <span className="font-mono text-fg">{previa.no_redistribuibles.join(", ")}</span>.
            Sus términos no permiten redistribuirlas. Al publicar, esas imágenes quedan accesibles en un
            repositorio a tu nombre: <b className="font-medium text-fg">la responsabilidad y cualquier
            reclamación de retirada son tuyas</b>, no de Lumi. Si el asset se retira, las teselas que
            reclama vuelven a quedar libres para todos.
          </p>
          <label className="mt-3.5 flex items-center gap-2 text-[11px] text-fg">
            <input type="checkbox" checked={descargo} onChange={(e) => setDescargo(e.target.checked)} />
            Entiendo y asumo la responsabilidad
          </label>
          {error && <p className="mt-2.5 text-[11px] text-danger-fg">{error}</p>}
          <div className="mt-4 flex justify-between">
            <button onClick={() => setPaso(2)} className="jg-press text-[11px] text-subtle underline">Atrás</button>
            <button onClick={() => void publicar()} disabled={!descargo}
              className="jg-press rounded-lg bg-accent px-3.5 py-2 text-[11.5px] font-medium text-black disabled:opacity-40">
              Publicar
            </button>
          </div>
        </div>
      )}

      {paso === "subiendo" && progreso && (
        <div className="mt-4">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[10.5px] text-muted">
              {progreso.asset || "preparando…"}{progreso.detalle && <> · {progreso.detalle}</>}
            </span>
            <span className="font-mono text-[10px] text-subtle">{progreso.hechos}/{progreso.total}</span>
          </div>
          <span className="mt-1.5 block h-1 overflow-hidden rounded-[2px] bg-elevated">
            <i className="block h-full bg-fg transition-[width] duration-300"
              style={{ width: progreso.total > 0 ? `${(progreso.hechos / progreso.total) * 100}%` : "0%" }} />
          </span>
          <div className="mt-3 flex max-h-[140px] flex-col gap-1 overflow-y-auto font-mono text-[10px] text-subtle">
            {progreso.registro.map((l, i) => (
              <div key={i} className="flex items-center gap-1.5">
                <Icon name="check" size={10} className="jg-stroke-draw text-fg" />
                {l}
              </div>
            ))}
          </div>
          {progreso.error && <p className="mt-2.5 text-[11px] text-danger-fg">{progreso.error}</p>}
          {progreso.terminado && !progreso.error && (
            <p className="mt-2.5 text-[11px] text-fg">Publicado.</p>
          )}
          <div className="mt-4 flex justify-end">
            <button onClick={() => { if (progreso.terminado) descartarSeguimiento(); onHecho(); }}
              className="jg-press rounded-lg border border-border px-3.5 py-2 text-[11.5px] text-fg">
              {progreso.terminado ? "Cerrar" : "Seguir en segundo plano"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
