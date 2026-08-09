import type { Clasificacion } from "../lib/api";

/** Los tres grupos en el orden en que se ejecutan: primero lo que se adjunta,
 *  después lo que se descarga con su atribución, y al final lo nuevo. */
export function PlanDialog({
  nombre,
  c,
  cargando,
  onCancelar,
  onConfirmar,
}: {
  nombre: string;
  c: Clasificacion;
  cargando: boolean;
  onCancelar: () => void;
  onConfirmar: () => void;
}) {
  const total = c.locales + c.catalogo + c.nuevas + c.reclamadas;
  const heredado = c.locales + c.catalogo + c.reclamadas;
  const heredadoPct = total === 0 ? 0 : Math.round((heredado / total) * 100);

  // Por autor, para el desglose — no viene calculado del backend porque es
  // solo para esta pantalla informativa, no para ninguna decisión de coste.
  const autoresReclamo = new Map<string, number>();
  for (const [, e] of c.teselas) {
    if (e.estado === "reclamada") autoresReclamo.set(e.autor, (autoresReclamo.get(e.autor) ?? 0) + 1);
  }

  return (
    <div className="w-[480px] rounded-card border border-white/[.13] bg-[rgba(16,19,25,.66)] p-[20px_22px] backdrop-blur-xl">
      <p className="text-sm text-fg">Plan para «{nombre}»</p>

      <div className="mt-3 flex flex-col gap-2.5 text-[11px]">
        {c.locales > 0 && (
          <div className="rounded-lg border border-border px-3 py-2">
            <p className="text-fg">Se adjunta</p>
            <p className="mt-0.5 font-mono text-[10px] text-subtle">{c.locales} teselas ya en este equipo</p>
          </div>
        )}
        {c.catalogo > 0 && (
          <div className="rounded-lg border border-border px-3 py-2">
            <p className="text-fg">Se descarga</p>
            <p className="mt-0.5 font-mono text-[10px] text-subtle">
              {c.catalogo} teselas · {(c.bytes_a_descargar / (1024 * 1024)).toFixed(1)} MB
            </p>
            {c.autores.map(([autor]) => (
              <p key={autor} className="mt-0.5 font-mono text-[10px] text-subtle">de {autor}, con su licencia y atribución</p>
            ))}
          </div>
        )}
        {c.reclamadas > 0 && (
          <div className="rounded-lg border border-warning/[.35] bg-warning/[.05] px-3 py-2">
            <p className="text-fg">Reclamadas por otros</p>
            <p className="mt-0.5 font-mono text-[10px] text-subtle">
              {c.reclamadas} teselas · no se descargan ni se pagan
            </p>
            {[...autoresReclamo.entries()].map(([autor, n]) => (
              <p key={autor} className="mt-0.5 font-mono text-[10px] text-subtle">{n} de {autor}</p>
            ))}
            <p className="mt-1.5 text-[10.5px] leading-relaxed text-subtle">
              Ni las descargas del proveedor ni te descargas sus paquetes: no entran en tu índice. Tu
              ficha declara que esa zona la cubren ellos, y quien instale tu índice desde el catálogo
              se los baja también.
            </p>
          </div>
        )}
        {c.nuevas > 0 && (
          <div className="rounded-lg border border-border px-3 py-2">
            <p className="text-fg">Se indexa nuevo</p>
            <p className="mt-0.5 font-mono text-[10px] text-subtle">{c.nuevas} teselas · cuota del proveedor · GPU</p>
          </div>
        )}
      </div>

      <div className="mt-3.5 rounded-lg border border-border bg-[#0b0d0f] px-3 py-2.5">
        <p className="font-mono text-[10px] leading-[1.85] text-muted">
          Al terminar, «{nombre}» será{" "}
          <b className="font-normal text-fg">{heredadoPct} % trabajo heredado</b> y{" "}
          <b className="font-normal text-fg">{100 - heredadoPct} % indexado aquí</b>.<br />
          <em className="not-italic text-subtle">
            Eso queda escrito en el manifiesto y se enseña en el catálogo.
          </em>
        </p>
      </div>

      <div className="mt-4 flex justify-end gap-2">
        <button
          onClick={onCancelar}
          disabled={cargando}
          className="jg-press rounded-lg border border-border px-4 py-2 text-[11.5px] text-fg disabled:opacity-40"
        >
          Cancelar
        </button>
        {/* Clasificar contra la red (`estimar_area`) puede tardar unos
            segundos; sin este cambio de texto, ese hueco se lee como que el
            botón no ha hecho nada. */}
        <button
          onClick={onConfirmar}
          disabled={cargando}
          className="jg-press flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-[11.5px] font-medium text-black disabled:opacity-70"
        >
          {cargando && (
            <span className="h-3 w-3 animate-spin rounded-full border-[1.5px] border-black/30 border-t-black" />
          )}
          {cargando ? "Calculando…" : "Confirmar"}
        </button>
      </div>
    </div>
  );
}
