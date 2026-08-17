import { useState } from "react";
import { api, type CpuDevice } from "../lib/api";
import { ConfirmarPeligro } from "./ConfirmarPeligro";
import { Icon } from "../ui/Icon";

type Pestana = "potencia" | "sensores";

export function CpuEditor({
  device, token, onCerrar, onAplicado, potenciaHabilitada, potenciaMotivo,
}: {
  device: CpuDevice; token: string; onCerrar: () => void;
  onAplicado: (d: CpuDevice) => void;
  potenciaHabilitada: boolean; potenciaMotivo: string | null;
}) {
  const [pestana, setPestana] = useState<Pestana>("potencia");
  const perfil = device.perfil ?? { pl1_w: device.rango.potencia_max_w, pl2_w: device.rango.potencia_max_w };
  const [pl1, setPl1] = useState(perfil.pl1_w);
  const [pl2, setPl2] = useState(perfil.pl2_w);
  const [confirmando, setConfirmando] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const AMD_AVISO = "Vas a aplicar un control sin garantía del fabricante (ryzenadj, acceso directo a registros del SMU) — esto se pide siempre en AMD, dentro o fuera de rango, no solo al superar un límite.";

  async function aplicar(confirmado: boolean) {
    setError(null);
    // En AMD el modal de "soy consciente" se exige SIEMPRE al aplicar
    // potencia, incluso dentro de rango — es la única plataforma sin
    // interfaz oficial de kernel detrás, y el diseño lo trata como un riesgo
    // aparte del de "salirse de fábrica". Se decide en el cliente, antes de
    // llamar siquiera al backend, porque el backend solo sabe de rango.
    if (device.fabricante === "amd" && !confirmado) {
      setConfirmando(AMD_AVISO);
      return;
    }
    try {
      const dev = await api.cpuAplicar({ pl1_w: pl1, pl2_w: pl2, confirmado }, token);
      setConfirmando(null);
      onAplicado(dev);
      onCerrar();
    } catch (e) {
      const msg = String(e);
      if (!confirmado) { setConfirmando(msg); return; }
      setError(msg);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
      <div className="w-[620px] max-w-[94vw] overflow-hidden rounded-card border border-border bg-panel"
        style={{ animation: "jg-popup-scale-in .3s cubic-bezier(.16,1,.3,1) both" }}>

        <div className="flex items-center gap-3 border-b border-border px-5 py-4">
          <Icon name="device" size={26} className="text-subtle" />
          <div className="flex-1">
            <div className="text-[14px] text-fg">CPU · {device.fabricante}</div>
            <div className="text-[9.5px] text-subtle">editando perfil avanzado</div>
          </div>
          <button onClick={onCerrar} className="jg-press rounded-lg px-2 py-1 text-subtle">✕</button>
        </div>

        <div className="flex gap-6 border-b border-border px-5">
          {(["potencia", "sensores"] as Pestana[]).map((p) => (
            <button key={p} onClick={() => setPestana(p)}
              className={`border-b-2 py-2.5 text-[11px] capitalize transition-colors
                ${pestana === p ? "border-fg text-fg" : "border-transparent text-subtle hover:text-muted"}`}>
              {p}
            </button>
          ))}
        </div>

        <div className="min-h-[220px] p-5">
          {pestana === "potencia" && (
            potenciaHabilitada ? (
              <div>
                {device.fabricante === "amd" && (
                  <p className="mb-3 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-[10.5px] text-danger-fg">
                    ⚠ Este control usa ryzenadj, sin garantía del fabricante — más riesgo que cualquier
                    otro control de esta sección, dentro o fuera de rango.
                  </p>
                )}
                {device.rango.aproximado && (
                  <p className="mb-3 text-[10px] text-subtle">
                    El rango de esta CPU es una aproximación (50–100% del TDP declarado), no un dato leído del hardware.
                  </p>
                )}
                <div className="mb-3">
                  <div className="mb-1 text-[9px] uppercase tracking-[.08em] text-subtle">
                    {device.fabricante === "amd" ? "slow/stapm limit (PL1)" : "PL1 (sostenido)"}
                  </div>
                  <input type="range" min={device.rango.potencia_min_w} max={device.rango.potencia_max_w * 1.2}
                    value={pl1} onChange={(e) => setPl1(+e.target.value)} className="w-full accent-fg" />
                  <span className="font-mono text-[10px] text-muted">{pl1.toFixed(0)}W</span>
                </div>
                <div>
                  <div className="mb-1 text-[9px] uppercase tracking-[.08em] text-subtle">
                    {device.fabricante === "amd" ? "fast limit (PL2)" : "PL2 (boost)"}
                  </div>
                  <input type="range" min={device.rango.potencia_min_w} max={device.rango.potencia_max_w * 1.2}
                    value={pl2} onChange={(e) => setPl2(+e.target.value)} className="w-full accent-fg" />
                  <span className="font-mono text-[10px] text-muted">{pl2.toFixed(0)}W</span>
                </div>
              </div>
            ) : (
              <p className="text-[11px] text-muted">{potenciaMotivo}</p>
            )
          )}

          {pestana === "sensores" && (
            <table className="w-full text-[11px]">
              <thead>
                <tr className="text-left text-[8.5px] uppercase tracking-[.06em] text-subtle">
                  <th className="pb-1.5">núcleo</th><th className="pb-1.5">temperatura</th><th className="pb-1.5">uso</th>
                </tr>
              </thead>
              <tbody className="font-mono">
                {device.sample.nucleos.map((n) => (
                  <tr key={n.indice}>
                    <td className="py-1 text-fg">{n.indice}</td>
                    <td>{n.temp_c ?? "—"}°C</td>
                    <td>{n.uso_pct.toFixed(0)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {error && <p className="px-5 pb-2 text-[10.5px] text-danger-fg">{error}</p>}
        <div className="flex items-center justify-between border-t border-border bg-bg px-5 py-3.5">
          <span className="text-[9.5px] text-subtle">
            los cambios se aplican al pulsar «Aplicar» · un valor fuera de rango pedirá confirmación
          </span>
          <div className="flex gap-2">
            <button onClick={onCerrar} className="jg-press rounded-lg border border-border px-3.5 py-1.5 text-[11px] text-subtle">
              Cancelar
            </button>
            <button onClick={() => aplicar(false)} className="jg-press rounded-lg bg-accent px-3.5 py-1.5 text-[11px] font-medium text-black">
              Aplicar cambios
            </button>
          </div>
        </div>
      </div>

      {confirmando && (
        <ConfirmarPeligro
          motivo={confirmando}
          onCancelar={() => setConfirmando(null)}
          onConfirmar={() => aplicar(true)}
        />
      )}
    </div>
  );
}
