import { useState } from "react";

import { api, type Proyecto } from "../lib/api";

/** Crea el repo directamente por la API de GitHub y lo etiqueta en el acto —
 *  a diferencia de publicar en uno ya existente (donde la etiqueta llega sola
 *  a la primera subida), aquí no hay «primera subida» que la dispare. */
export function NewProjectDialog({ onCancelar, onCreado }: {
  onCancelar: () => void;
  onCreado: (p: Proyecto) => void;
}) {
  const [nombre, setNombre] = useState("");
  const [privado, setPrivado] = useState(true);
  const [creando, setCreando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function crear() {
    if (!nombre.trim()) return;
    setCreando(true);
    setError(null);
    try {
      onCreado(await api.proyectoCrear(nombre.trim(), privado));
    } catch (e) {
      setError(String(e));
    } finally {
      setCreando(false);
    }
  }

  return (
    <div className="w-[400px] rounded-card border border-white/[.13] bg-[rgba(16,19,25,.66)] p-[20px_22px] backdrop-blur-xl">
      <p className="text-sm text-fg">Nuevo proyecto</p>
      <p className="mt-1 text-[10.5px] text-subtle">
        Crea un repositorio nuevo en GitHub con la etiqueta <span className="font-mono text-fg">lumi-index</span> ya
        puesta. Los índices que crees después viven dentro de él.
      </p>

      <label className="mt-3.5 block text-[10.5px] text-subtle">Nombre del repositorio</label>
      <input
        autoFocus
        value={nombre}
        onChange={(e) => setNombre(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") void crear(); }}
        placeholder="lugo-norte"
        className="mt-1 w-full rounded-lg border border-border bg-[#0b0d0f] px-3 py-2
          text-[12px] text-fg outline-none focus:border-draw"
      />

      <label className="mt-3.5 flex items-center justify-between gap-3 rounded-lg border border-border bg-[#0b0d0f] px-3 py-2.5">
        <span className="text-[11px] text-fg">
          Privado
          <span className="mt-0.5 block text-[9.5px] text-subtle">Solo tú lo ves en GitHub hasta que publiques.</span>
        </span>
        <button role="switch" aria-checked={privado} onClick={() => setPrivado(!privado)}
          className={`relative h-5 w-9 shrink-0 rounded-full border transition-colors ${
            privado ? "border-draw bg-draw" : "border-white/15 bg-white/10"}`}>
          <span className={`absolute top-0.5 h-3.5 w-3.5 rounded-full bg-fg ring-1 ring-black/20 transition-transform ${
            privado ? "translate-x-[18px]" : "translate-x-0.5"}`} />
        </button>
      </label>

      {error && <p className="mt-2 text-[10.5px] text-danger-fg">{error}</p>}

      <div className="mt-4 flex justify-end gap-2">
        <button onClick={onCancelar}
          className="jg-press rounded-lg border border-border px-4 py-2 text-[11.5px] text-fg">
          Cancelar
        </button>
        <button onClick={() => void crear()} disabled={!nombre.trim() || creando}
          className="jg-press rounded-lg bg-accent px-4 py-2 text-[11.5px] font-medium text-black disabled:opacity-40">
          {creando ? "Creando…" : "Crear"}
        </button>
      </div>
    </div>
  );
}
