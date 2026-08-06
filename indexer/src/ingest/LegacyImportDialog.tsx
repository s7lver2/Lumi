import { open } from "@tauri-apps/plugin-dialog";
import { useState } from "react";

import { api, type Resumen } from "../lib/api";
import { Icon } from "../ui/Icon";

const TIPOS = ["calle", "cenital", "suelta"] as const;

export function LegacyImportDialog({ indiceId, onHecho }: { indiceId: number; onHecho: () => void }) {
  const [ruta, setRuta] = useState<string | null>(null);
  const [tipo, setTipo] = useState<(typeof TIPOS)[number]>("calle");
  const [fuente, setFuente] = useState("desconocida");
  const [resumen, setResumen] = useState<Resumen | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function elegir() {
    const r = await open({ multiple: false, filters: [{ name: "Paquete de la v1", extensions: ["enc"] }] });
    if (typeof r === "string") setRuta(r);
  }

  async function importar() {
    if (!ruta) return;
    setError(null);
    try {
      setResumen(await api.ingestaLegacy(indiceId, ruta, tipo, fuente, fuente !== "desconocida"));
      onHecho();
    } catch (e) { setError(String(e)); }
  }

  return (
    <div className="w-[552px] rounded-card border border-white/[.13] bg-[rgba(16,19,25,.66)] p-[20px_22px] backdrop-blur-xl">
      <div className="flex items-center gap-2.5">
        <span className="text-sm text-fg">✦</span>
        <span className="text-sm font-medium text-fg">Importar un paquete de la v1</span>
      </div>
      <button onClick={() => void elegir()}
        className="jg-press mt-3 w-full rounded-lg border border-border px-3 py-2 text-left font-mono text-[10px] text-muted">
        {ruta ?? "elegir bundle.zip.enc…"}
      </button>

      {/* El manifiesto de la v1 no trae procedencia. No se adivina: se pide. */}
      <div className="mt-4 rounded-lg border border-warning/[.3] bg-warning/[.05] p-3">
        <div className="flex items-start gap-2">
          <Icon name="alert" size={13} className="mt-px shrink-0 text-warning-fg" />
          <div>
            <p className="text-[11.5px] text-warning-fg">Este paquete no dice de dónde salieron sus imágenes</p>
            <p className="mt-1 text-[10.5px] leading-snug text-muted">
              El manifiesto de la v1 lleva coordenadas y vectores, pero no proveedor ni atribución.
              Puedes declararlo tú si lo sabes; quedará anotado como declarado por el operador, no
              leído del material.
            </p>
          </div>
        </div>
        <div className="mt-3 flex gap-2">
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
              className={`mt-1.5 w-full rounded-md border border-border bg-[#0d0f12] px-2.5 py-1.5 text-[11px] outline-none ${
                fuente === "desconocida" ? "text-warning-fg" : "text-fg"}`} />
          </div>
        </div>
      </div>

      {resumen && (
        <p className="mt-3 font-mono text-[10px] text-muted">
          {resumen.aceptadas} aceptadas · {resumen.con_vector} ya traían vector · {resumen.saltadas} saltadas
        </p>
      )}
      {error && <p className="mt-3 text-[11px] text-danger-fg">{error}</p>}

      <div className="mt-4 flex items-center justify-between">
        <span className="font-mono text-[9.5px] text-subtle">los vectores vienen dentro · no se gasta GPU</span>
        <button onClick={() => void importar()} disabled={!ruta}
          className="jg-press rounded-lg bg-accent px-4 py-2 text-[11.5px] font-medium text-black disabled:opacity-40">
          Importar
        </button>
      </div>
    </div>
  );
}
