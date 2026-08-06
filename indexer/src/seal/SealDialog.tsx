import { open } from "@tauri-apps/plugin-dialog";
import { useState } from "react";

import { api, type Informe } from "../lib/api";
import { Icon } from "../ui/Icon";

/** Sellar es irreversible: por eso el botón se niega a existir habilitado
 *  mientras las cuentas no cuadran, y por eso no hay verde — lo que cuadra va
 *  con `check` blanco, lo que no con el triángulo en `danger-fg`. */
export function SealDialog({ indiceId, nombre, onSellado }: {
  indiceId: number; nombre: string; onSellado: () => void;
}) {
  const [informe, setInforme] = useState<Informe | null>(null);
  const [destino, setDestino] = useState<string | null>(null);
  const [sellando, setSellando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function elegirDestino() {
    const r = await open({ directory: true, multiple: false });
    if (typeof r === "string") setDestino(r);
  }

  async function sellar() {
    if (!destino) return;
    setSellando(true);
    setError(null);
    try {
      const i = await api.paqueteSellar(indiceId, destino);
      setInforme(i);
      if (i.cuadra) onSellado();
    } catch (e) {
      setError(String(e));
    } finally {
      setSellando(false);
    }
  }

  return (
    <div className="w-[480px] rounded-card border border-white/[.13] bg-[rgba(16,19,25,.66)] p-[20px_22px] backdrop-blur-xl">
      <div className="mx-auto grid h-[52px] w-[52px] place-items-center rounded-full bg-warning/[.08]">
        <Icon name="lock" size={32} className="text-warning-fg" />
      </div>
      <p className="mt-3 text-center text-sm text-fg">Sellar «{nombre}»</p>
      <p className="mt-1.5 text-center text-[11px] leading-relaxed text-muted">
        Sellar es irreversible: un paquete sellado no se sigue llenando.
      </p>

      <button onClick={() => void elegirDestino()}
        className="jg-press mt-4 w-full rounded-lg border border-border px-3 py-2 text-left font-mono text-[10px] text-muted">
        {destino ?? "elegir carpeta de destino…"}
      </button>

      <div className="mt-3 flex flex-col gap-1.5">
        {informe?.por_modelo.map(([modelo, esperadas, vectores]) => {
          const ok = esperadas === vectores;
          return (
            <div key={modelo}
              className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[11px] ${
                ok ? "" : "bg-danger/[.07]"}`}>
              <Icon name={ok ? "check" : "alert"} size={13} className={ok ? "text-fg" : "text-danger-fg"} />
              <span className="flex-1 text-fg">{modelo}</span>
              <span className={`font-mono ${ok ? "text-subtle" : "text-danger-fg"}`}>
                {vectores} / {esperadas}
              </span>
            </div>
          );
        })}
      </div>

      {informe && !informe.cuadra && (
        <p className="mt-2.5 text-[10.5px] leading-snug text-danger-fg">
          Las filas no cuadran con los vectores: falta terminar de embeber antes de poder sellar.
        </p>
      )}
      {error && <p className="mt-2.5 text-[11px] text-danger-fg">{error}</p>}

      <div className="mt-4 rounded-lg border border-border bg-[#0b0d0f] px-3 py-2.5">
        <p className="font-mono text-[10px] leading-[1.85] text-muted">
          manifiesto.json · indice.db · cobertura.json<br />
          fragmentos/&lt;quadkey z14&gt;/*.b1 *.i8 · imagenes/ · SHA256SUMS
        </p>
      </div>

      <div className="mt-4 flex justify-end">
        <button onClick={() => void sellar()} disabled={!destino || sellando || (informe ? !informe.cuadra : false)}
          className="jg-press rounded-lg bg-accent px-4 py-2 text-[11.5px] font-medium text-black disabled:opacity-40">
          {sellando ? "Sellando…" : "Sellar"}
        </button>
      </div>
    </div>
  );
}
