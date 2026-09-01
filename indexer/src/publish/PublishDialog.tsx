import { useEffect, useState } from "react";

import { api, type Previsualizacion } from "../lib/api";
import { Icon } from "../ui/Icon";
import { descartar as descartarSeguimiento, estadoActual, iniciar as iniciarSeguimiento, suscribir } from "./publishTracker";

const KB = 1024;
function tamano(bytes: number): string {
  if (bytes < KB * KB) return `${(bytes / KB).toFixed(0)} KB`;
  if (bytes < KB * KB * KB) return `${(bytes / KB / KB).toFixed(1)} MB`;
  return `${(bytes / KB / KB / KB).toFixed(2)} GB`;
}

type Paso = 2 | 3 | "subiendo";

/** El índice ya sabe dónde vive desde que nació (`proyecto`, fijado al
 *  crearlo dentro de un proyecto) — este diálogo ya no pregunta dónde
 *  publicar, va directo al troceado. El paso 3 —el descargo— solo aparece si
 *  el índice usó alguna fuente cuyos términos no permiten redistribuir; si
 *  no, el paso 2 lleva directo a publicar. */
/** El seguimiento de la subida vive en `publishTracker`, no aquí: el trabajo
 *  sigue en el backend aunque este diálogo se cierre, así que la barra de
 *  progreso se limita a mostrar lo que el tracker ya sabe en vez de sondear
 *  por su cuenta — eso es lo que permite reabrir el diálogo (o un aviso en
 *  cualquier otra pantalla) a mitad de una subida y verla seguir por donde iba. */
export function PublishDialog({ indiceId, nombre, proyecto, onHecho }: {
  indiceId: number; nombre: string; proyecto: string; onHecho: () => void;
}) {
  const enCurso = estadoActual();
  const yaSubiendoEsteIndice = enCurso?.indiceId === indiceId;
  const [paso, setPaso] = useState<Paso>(yaSubiendoEsteIndice ? "subiendo" : 2);
  const [previa, setPrevia] = useState<Previsualizacion | null>(null);
  const [descargo, setDescargo] = useState(false);
  const [progreso, setProgreso] = useState(yaSubiendoEsteIndice ? enCurso.progreso : null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api.publicarPrevisualizar(indiceId).then(setPrevia);
  }, [indiceId]);

  useEffect(() => suscribir((e) => {
    if (e?.indiceId !== indiceId) return;
    setProgreso(e.progreso);
    if (e.progreso.error) setError(e.progreso.error);
  }), [indiceId]);

  const hayNoRedistribuibles = (previa?.no_redistribuibles.length ?? 0) > 0;

  async function publicar() {
    setError(null);
    setPaso("subiendo");
    try {
      await api.publicarArrancar(indiceId, proyecto, descargo);
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
      <p className="mt-1 font-mono text-[10.5px] text-subtle">{proyecto}</p>

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
          <div className="mt-4 flex justify-end">
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
