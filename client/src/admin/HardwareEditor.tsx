import { useState } from "react";
import { api, type HardwareDevice, type PuntoCurva } from "../lib/api";
import { CurvaEditable } from "./CurvaEditable";
import { ConfirmarPeligro } from "./ConfirmarPeligro";
import { Icon } from "../ui/Icon";

type Pestana = "potencia" | "ventilador" | "reloj" | "sensores";

export function HardwareEditor({
  device, token, onCerrar, onAplicado, curvasHabilitadas, curvasMotivo,
}: {
  device: HardwareDevice; token: string; onCerrar: () => void;
  onAplicado: (d: HardwareDevice) => void;
  curvasHabilitadas: boolean; curvasMotivo: string | null;
}) {
  const [pestana, setPestana] = useState<Pestana>("ventilador");
  const perfil = device.perfil ?? {
    potencia_w: device.rango.potencia_max_w,
    offset_nucleo_mhz: 0,
    offset_memoria_mhz: 0,
    curva_ventilador: [
      { temp_c: 30, valor: 30 }, { temp_c: 50, valor: 45 }, { temp_c: 65, valor: 60 },
      { temp_c: 75, valor: 75 }, { temp_c: 85, valor: 90 }, { temp_c: 95, valor: 100 },
    ] as PuntoCurva[],
  };
  const [potenciaW, setPotenciaW] = useState(perfil.potencia_w);
  const [curvaVentilador, setCurvaVentilador] = useState(perfil.curva_ventilador);
  const [offsetNucleo, setOffsetNucleo] = useState(perfil.offset_nucleo_mhz);
  const [offsetMemoria, setOffsetMemoria] = useState(perfil.offset_memoria_mhz);
  const [confirmando, setConfirmando] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function aplicar(confirmado: boolean) {
    setError(null);
    try {
      const dev = await api.hardwareAplicar(device.index, {
        potencia_w: potenciaW,
        // Si `hardware_curvas` está `off`, ni siquiera se mandan estos tres
        // campos — mandarlos igual haría que el backend intentara el
        // subproceso `nvidia-settings` sabiendo ya que va a fallar, y el
        // usuario vería un error de "no se pudo" en vez de que el control
        // simplemente no exista para él.
        ...(curvasHabilitadas ? {
          offset_nucleo_mhz: offsetNucleo,
          offset_memoria_mhz: offsetMemoria,
          curva_ventilador: curvaVentilador,
        } : {}),
        confirmado,
      }, token);
      setConfirmando(null);
      onAplicado(dev);
      onCerrar();
    } catch (e) {
      const msg = String(e);
      // El backend responde 409 con el motivo en el cuerpo cuando hace falta
      // confirmación — `api.patch` propaga el texto de error tal cual.
      if (!confirmado) { setConfirmando(msg); return; }
      setError(msg);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
      <div className="w-[860px] max-w-[94vw] overflow-hidden rounded-card border border-border bg-panel"
        style={{ animation: "jg-popup-scale-in .3s cubic-bezier(.16,1,.3,1) both" }}>

        <div className="flex items-center gap-3 border-b border-border px-5 py-4">
          <Icon name="gpu" size={26} className="text-subtle" />
          <div className="flex-1">
            <div className="text-[14px] text-fg">{device.name} · GPU {device.index}</div>
            <div className="text-[9.5px] text-subtle">editando perfil avanzado</div>
          </div>
          <button onClick={onCerrar} className="jg-press rounded-lg px-2 py-1 text-subtle">✕</button>
        </div>

        <div className="flex gap-6 border-b border-border px-5">
          {(["potencia", "ventilador", "reloj", "sensores"] as Pestana[]).map((p) => (
            <button key={p} onClick={() => setPestana(p)}
              className={`border-b-2 py-2.5 text-[11px] capitalize transition-colors
                ${pestana === p ? "border-fg text-fg" : "border-transparent text-subtle hover:text-muted"}`}>
              {p}
            </button>
          ))}
        </div>

        <div className="flex min-h-[330px]">
          {pestana === "potencia" && (
            <div className="flex-1 p-5">
              <div className="mb-1.5 text-[9px] uppercase tracking-[.08em] text-subtle">límite de potencia</div>
              <input type="range" min={device.rango.potencia_min_w} max={device.rango.potencia_max_w * 1.2}
                value={potenciaW} onChange={(e) => setPotenciaW(+e.target.value)} className="w-full accent-fg" />
              <div className="flex justify-between font-mono text-[9px] text-subtle">
                <span>{device.rango.potencia_min_w}W</span>
                <span className="text-fg">{potenciaW}W</span>
                <span>{device.rango.potencia_max_w}W fábrica</span>
              </div>
            </div>
          )}

          {pestana === "ventilador" && (
            curvasHabilitadas ? (
              <div className="flex-1 p-5">
                <CurvaEditable
                  puntos={curvaVentilador} onChange={setCurvaVentilador}
                  ejeXMin={30} ejeXMax={100} ejeYMin={0} ejeYMax={100}
                  zonaPeligroDesde={device.rango.temp_throttle_c}
                  formatoPunto={(p) => `${p.temp_c}° → ${p.valor}%`}
                />
              </div>
            ) : (
              <p className="flex-1 p-5 text-[11px] text-muted">{curvasMotivo}</p>
            )
          )}

          {pestana === "reloj" && (
            curvasHabilitadas ? (
              <div className="flex-1 p-5">
                <div className="mb-3">
                  <div className="mb-1 text-[9px] uppercase tracking-[.08em] text-subtle">offset núcleo</div>
                  <input type="range" min={-100} max={200} value={offsetNucleo}
                    onChange={(e) => setOffsetNucleo(+e.target.value)} className="w-full accent-fg" />
                  <span className="font-mono text-[10px] text-muted">{offsetNucleo} MHz</span>
                </div>
                <div>
                  <div className="mb-1 text-[9px] uppercase tracking-[.08em] text-subtle">offset memoria</div>
                  <input type="range" min={-200} max={800} value={offsetMemoria}
                    onChange={(e) => setOffsetMemoria(+e.target.value)} className="w-full accent-draw" />
                  <span className="font-mono text-[10px] text-muted">{offsetMemoria} MHz</span>
                </div>
              </div>
            ) : (
              <p className="flex-1 p-5 text-[11px] text-muted">{curvasMotivo}</p>
            )
          )}

          {pestana === "sensores" && (
            <div className="flex-1 p-5">
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="text-left text-[8.5px] uppercase tracking-[.06em] text-subtle">
                    <th className="pb-1.5">sensor</th><th className="pb-1.5">valor</th><th className="pb-1.5">rango de fábrica</th>
                  </tr>
                </thead>
                <tbody className="font-mono">
                  <tr><td className="py-1 text-fg">temperatura</td><td>{device.sample.temp_c ?? "—"}°C</td>
                    <td className="text-subtle">hasta {device.rango.temp_throttle_c ?? "—"}°</td></tr>
                  <tr><td className="py-1 text-fg">potencia</td><td>{potenciaW}W</td>
                    <td className="text-subtle">{device.rango.potencia_min_w}–{device.rango.potencia_max_w}W</td></tr>
                  <tr><td className="py-1 text-fg">ventilador</td><td>{device.sample.fan_pct ?? "—"}%</td><td className="text-subtle">0–100%</td></tr>
                  <tr><td className="py-1 text-fg">reloj</td><td>{device.sample.clock_mhz ?? "—"} MHz</td><td className="text-subtle">—</td></tr>
                </tbody>
              </table>
            </div>
          )}
        </div>

        {error && <p className="px-5 pb-2 text-[10.5px] text-danger-fg">{error}</p>}
        <div className="flex items-center justify-between border-t border-border bg-bg px-5 py-3.5">
          <span className="text-[9.5px] text-subtle">
            los cambios se aplican al pulsar «Aplicar» · un valor fuera de fábrica pedirá confirmación
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
