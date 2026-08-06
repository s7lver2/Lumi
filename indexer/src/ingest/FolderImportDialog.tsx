import { open } from "@tauri-apps/plugin-dialog";
import { useState } from "react";

import { api, type Resumen } from "../lib/api";

const TIPOS = ["calle", "cenital", "suelta"] as const;

/** Mismo esqueleto que `LegacyImportDialog`, sin el aviso ámbar: una carpeta
 *  propia SÍ trae su procedencia, porque la declara quien la trae. */
export function FolderImportDialog({ indiceId, onHecho }: { indiceId: number; onHecho: () => void }) {
  const [ruta, setRuta] = useState<string | null>(null);
  const [tipo, setTipo] = useState<(typeof TIPOS)[number]>("calle");
  const [fuente, setFuente] = useState("carpeta:");
  const [licencia, setLicencia] = useState("");
  const [resumen, setResumen] = useState<Resumen | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function elegir() {
    const r = await open({ directory: true, multiple: false });
    if (typeof r === "string") setRuta(r);
  }

  async function importar() {
    if (!ruta) return;
    setError(null);
    try {
      setResumen(await api.ingestaCarpeta(indiceId, ruta, tipo, fuente, licencia || null));
      onHecho();
    } catch (e) { setError(String(e)); }
  }

  return (
    <div className="w-[552px] rounded-card border border-white/[.13] bg-[rgba(16,19,25,.66)] p-[20px_22px] backdrop-blur-xl">
      <div className="flex items-center gap-2.5">
        <span className="text-sm text-fg">✦</span>
        <span className="text-sm font-medium text-fg">Importar una carpeta local</span>
      </div>
      <button onClick={() => void elegir()}
        className="jg-press mt-3 w-full rounded-lg border border-border px-3 py-2 text-left font-mono text-[10px] text-muted">
        {ruta ?? "elegir carpeta…"}
      </button>

      <div className="mt-4 flex gap-2">
        <div className="flex-1">
          <p className="text-[8px] uppercase tracking-[.11em] text-subtle">Tipo</p>
          <div className="mt-1.5 flex gap-1.5">
            {TIPOS.map((t) => (
              <button key={t} onClick={() => setTipo(t)}
                className={`rounded-md border px-2.5 py-1 text-[11px] ${
                  tipo === t ? "border-white/[.28] text-fg" : "border-border text-subtle"}`}>
                {t}
              </button>
            ))}
          </div>
        </div>
        <div className="w-[214px]">
          <p className="text-[8px] uppercase tracking-[.11em] text-subtle">Fuente</p>
          <input value={fuente} onChange={(e) => setFuente(e.target.value)}
            className="mt-1.5 w-full rounded-md border border-border bg-[#0d0f12] px-2.5 py-1.5 text-[11px] text-fg outline-none" />
        </div>
      </div>
      <div className="mt-2.5">
        <p className="text-[8px] uppercase tracking-[.11em] text-subtle">Licencia (opcional)</p>
        <input value={licencia} onChange={(e) => setLicencia(e.target.value)}
          placeholder="CC BY-SA 4.0"
          className="mt-1.5 w-full rounded-md border border-border bg-[#0d0f12] px-2.5 py-1.5 text-[11px] text-fg outline-none placeholder:text-subtle" />
      </div>

      <p className="mt-3 font-mono text-[9.5px] text-subtle">
        el fichero original no se reescribe, ni se recomprime, ni se le quita el EXIF
      </p>

      {resumen && (
        <p className="mt-3 font-mono text-[10px] text-muted">
          {resumen.aceptadas} aceptadas · {resumen.saltadas} saltadas
        </p>
      )}
      {error && <p className="mt-3 text-[11px] text-danger-fg">{error}</p>}

      <div className="mt-4 flex justify-end">
        <button onClick={() => void importar()} disabled={!ruta}
          className="jg-press rounded-lg bg-accent px-4 py-2 text-[11.5px] font-medium text-black disabled:opacity-40">
          Importar
        </button>
      </div>
    </div>
  );
}
