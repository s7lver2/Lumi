import { open } from "@tauri-apps/plugin-dialog";
import { useEffect, useRef, useState } from "react";

import { api, type Informe, type ProgresoSellado } from "../lib/api";
import { Icon } from "../ui/Icon";

const ETAPAS: Record<string, string> = {
  comprobando: "Comprobando que las filas cuadran con los vectores…",
  vectores: "Escribiendo fragmentos de vectores…",
  imágenes: "Copiando imágenes…",
  manifiesto: "Escribiendo manifiesto y cobertura…",
  firmando: "Firmando SHA256SUMS…",
};

/** Sellar es irreversible: por eso el botón se niega a existir habilitado
 *  mientras las cuentas no cuadran, y por eso no hay verde — lo que cuadra va
 *  con `check` blanco, lo que no con el triángulo en `danger-fg`.
 *
 *  El sellado de verdad tarda (Qdrant por fragmento, copiar cada imagen), así
 *  que arranca en segundo plano y esto sondea `paquete_sellar_progreso` en
 *  vez de esperar a un único comando bloqueante — mismo patrón que
 *  `LegacyImportDialog`. Antes el botón decía «Sellando…» sin nada más, y en
 *  un índice de miles de imágenes eso es indistinguible de colgado. */
export function SealDialog({ indiceId, nombre, onSellado }: {
  indiceId: number; nombre: string; onSellado: () => void;
}) {
  const [destino, setDestino] = useState<string | null>(null);
  const [progreso, setProgreso] = useState<ProgresoSellado | null>(null);
  const [informe, setInforme] = useState<Informe | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sondeo = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => { if (sondeo.current) clearInterval(sondeo.current); };
  }, []);

  async function elegirDestino() {
    const r = await open({ directory: true, multiple: false });
    if (typeof r === "string") setDestino(r);
  }

  async function sellar() {
    if (!destino) return;
    setError(null);
    setInforme(null);
    setProgreso({ etapa: "arrancando", hechos: 0, total: 0, terminado: false, informe: null, error: null });
    try {
      await api.paqueteSellarArrancar(indiceId, destino);
    } catch (e) {
      setError(String(e));
      setProgreso(null);
      return;
    }
    sondeo.current = setInterval(async () => {
      const p = await api.paqueteSellarProgreso();
      setProgreso(p);
      if (p.terminado) {
        if (sondeo.current) clearInterval(sondeo.current);
        if (p.error) setError(p.error);
        else if (p.informe) { setInforme(p.informe); if (p.informe.cuadra) onSellado(); }
      }
    }, 400);
  }

  const sellando = progreso !== null && !progreso.terminado;

  return (
    <div className="w-[480px] rounded-card border border-white/[.13] bg-[rgba(16,19,25,.66)] p-[20px_22px] backdrop-blur-xl">
      <div className="mx-auto grid h-[52px] w-[52px] place-items-center rounded-full bg-warning/[.08]">
        <Icon name="lock" size={32} className="text-warning-fg" />
      </div>
      <p className="mt-3 text-center text-sm text-fg">Sellar «{nombre}»</p>
      <p className="mt-1.5 text-center text-[11px] leading-relaxed text-muted">
        Sellar es irreversible: un paquete sellado no se sigue llenando.
      </p>

      <button onClick={() => void elegirDestino()} disabled={sellando}
        className="jg-press mt-4 w-full rounded-lg border border-border px-3 py-2 text-left font-mono text-[10px] text-muted disabled:opacity-40">
        {destino ?? "elegir carpeta de destino…"}
      </button>

      {progreso && (
        <div className="mt-3">
          <div className="flex items-center justify-between">
            <span className="text-[10.5px] text-muted">{ETAPAS[progreso.etapa] ?? progreso.etapa}</span>
            {progreso.total > 0 && (
              <span className="font-mono text-[10px] text-subtle">{progreso.hechos}/{progreso.total}</span>
            )}
          </div>
          <span className="mt-1.5 block h-1 overflow-hidden rounded-[2px] bg-elevated">
            <i
              className={`block h-full bg-fg ${progreso.total > 0 ? "transition-[width] duration-300" : "animate-pulse"}`}
              style={{ width: progreso.total > 0 ? `${(progreso.hechos / progreso.total) * 100}%` : "100%" }}
            />
          </span>
        </div>
      )}

      {informe && (
        <div className="mt-3 flex flex-col gap-1.5">
          {informe.por_modelo.map(([modelo, esperadas, vectores]) => {
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
      )}

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
