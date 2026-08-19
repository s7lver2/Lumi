import { useEffect, useState } from "react";
import { api, type CpuDevice, type HardwareDevice } from "../lib/api";

/** Versión de solo lectura de Hardware, para el Resumen: mismos datos que
 *  `HardwareView`, sin sliders ni editores — un vistazo, no un control. */
export function HardwareGlance({ token }: { token: string }) {
  const [gpus, setGpus] = useState<HardwareDevice[] | null>(null);
  const [cpu, setCpu] = useState<CpuDevice | null>(null);

  useEffect(() => {
    api.hardwareListar(token).then(setGpus).catch(() => setGpus([]));
    api.cpuLeer(token).then(setCpu).catch(() => setCpu(null));
  }, [token]);

  const tempsCpu = cpu?.sample.nucleos.map((n) => n.temp_c).filter((t): t is number => t != null) ?? [];
  const tempCpuMedia = tempsCpu.length ? Math.round(tempsCpu.reduce((a, b) => a + b, 0) / tempsCpu.length) : null;

  return (
    <div className="rounded-card border border-border p-3.5">
      <p className="text-[12.5px] text-fg">Hardware</p>
      <p className="mb-3 text-[11px] text-muted">de un vistazo, sin entrar a Hardware</p>

      {gpus === null && <p className="text-[11px] text-subtle">cargando</p>}
      <div className="flex flex-col gap-1.5">
        {gpus?.map((d) => (
          <div key={d.index} className="flex items-center gap-2.5 rounded-lg border border-border px-2.5 py-1.5 text-[10.5px]">
            <span className="text-fg">GPU {d.index} · {d.name}</span>
            <span className="ml-auto font-mono text-subtle">
              {d.sample.temp_c ?? "—"}° · {(d.sample.vram_used_mb / 1024).toFixed(1)}/{(d.sample.vram_total_mb / 1024).toFixed(0)}GB
              {d.sample.power_draw_mw != null ? ` · ${(d.sample.power_draw_mw / 1000).toFixed(0)}W` : ""}
            </span>
          </div>
        ))}
        {cpu && (
          <div className="flex items-center gap-2.5 rounded-lg border border-border px-2.5 py-1.5 text-[10.5px]">
            <span className="text-fg">CPU</span>
            <span className="ml-auto font-mono text-subtle">
              {tempCpuMedia ?? "—"}°{cpu.sample.potencia_w != null ? ` · ${cpu.sample.potencia_w.toFixed(0)}W` : ""}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
