import { useEffect, useState } from "react";

import { api, type Nivel } from "../lib/api";

function slugDe(nombre: string): string {
  return nombre
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/-+$/, "")
    .replace(/^-+/, "");
}

/** El slug de aquí es solo la vista previa: el que de verdad cuenta lo calcula
 *  Rust en `indice_crear`, y si algún día divergen es ese el que manda. */
export function NewIndexDialog({ onCancelar, onCreado }: {
  onCancelar: () => void;
  onCreado: (id: number) => void;
}) {
  const [nombre, setNombre] = useState("");
  const [creando, setCreando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [niveles, setNiveles] = useState<Nivel[]>([]);
  const [elegido, setElegido] = useState<string | null>(null);

  useEffect(() => { void api.nivelesLista().then(setNiveles); }, []);

  async function crear() {
    if (!nombre.trim() || !elegido) return;
    setCreando(true);
    setError(null);
    try {
      onCreado(await api.indiceCrear(nombre.trim(), [elegido]));
    } catch (e) {
      setError(String(e));
    } finally {
      setCreando(false);
    }
  }

  return (
    <div className="w-[400px] rounded-card border border-white/[.13] bg-[rgba(16,19,25,.66)] p-[20px_22px] backdrop-blur-xl">
      <p className="text-sm text-fg">Nuevo índice</p>
      <p className="mt-1 text-[10.5px] text-subtle">
        El nombre y para qué niveles vas a embeber es lo que hace falta para empezar.
      </p>

      <label className="mt-3.5 block text-[10.5px] text-subtle">Nombre</label>
      <input
        autoFocus
        value={nombre}
        onChange={(e) => setNombre(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") void crear(); }}
        placeholder="lugo-norte"
        className="mt-1 w-full rounded-lg border border-border bg-[#0b0d0f] px-3 py-2
          text-[12px] text-fg outline-none focus:border-draw"
      />
      {nombre.trim() && (
        <p className="mt-1.5 font-mono text-[9.5px] text-subtle">
          slug: <span className="text-fg">{slugDe(nombre.trim())}</span> · se deriva del nombre
        </p>
      )}

      <label className="mt-3.5 block text-[10.5px] text-subtle">Nivel a embeber</label>
      <p className="mt-0.5 text-[9.5px] leading-relaxed text-subtle">
        Fija hasta qué nivel llega este índice — más alto pide más modelos de recuperación, más
        tiempo de GPU y disco por imagen. Se fija al crear el índice y no se puede cambiar después.
      </p>
      <div className="mt-2 grid grid-cols-3 gap-1.5">
        {niveles.map((n) => (
          <button key={n.id} type="button" onClick={() => setElegido(n.id)}
            className={`rounded-lg border px-3 py-2 text-left transition-colors
              ${elegido === n.id ? "border-draw bg-draw/[.08]" : "border-border bg-[#0b0d0f] hover:border-white/25"}`}>
            <span className="block text-[11.5px] text-fg">{n.nombre}</span>
            <span className="font-mono text-[9.5px] text-subtle">
              {n.recuperacion.length} {n.recuperacion.length === 1 ? "modelo" : "modelos"}
            </span>
          </button>
        ))}
      </div>
      {error && <p className="mt-2 text-[10.5px] text-danger-fg">{error}</p>}

      <div className="mt-4 flex justify-end gap-2">
        <button onClick={onCancelar}
          className="jg-press rounded-lg border border-border px-4 py-2 text-[11.5px] text-fg">
          Cancelar
        </button>
        <button onClick={() => void crear()} disabled={!nombre.trim() || !elegido || creando}
          className="jg-press rounded-lg bg-accent px-4 py-2 text-[11.5px] font-medium text-black disabled:opacity-40">
          {creando ? "Creando…" : "Crear"}
        </button>
      </div>
    </div>
  );
}
