import { useEffect, useState } from "react";
import { api, type HardwareDevice } from "../lib/api";
import { useServer } from "../lib/store";
import { HardwareEditor } from "./HardwareEditor";
import { Icon } from "../ui/Icon";

export function HardwareView({ token }: { token: string }) {
  const [dispositivos, setDispositivos] = useState<HardwareDevice[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [avanzado, setAvanzado] = useState(false);
  const [editando, setEditando] = useState<number | null>(null);
  const capPotencia = useServer((s) => s.hello?.capabilities.find((c) => c.id === "hardware_potencia"));
  const capCurvas = useServer((s) => s.hello?.capabilities.find((c) => c.id === "hardware_curvas"));

  useEffect(() => {
    api.hardwareListar(token).then(setDispositivos).catch((e) => setError(String(e)));
  }, [token]);

  const [errorAplicar, setErrorAplicar] = useState<string | null>(null);

  // Básico: el slider de potencia se aplica directo desde la fila, acotado al
  // rango de fábrica — nunca puede salir de rango, así que nunca dispara la
  // confirmación de "soy consciente" (esa solo existe en avanzado).
  async function aplicarBasico(index: number, potencia_w: number) {
    setErrorAplicar(null);
    try {
      const dev = await api.hardwareAplicar(index, { potencia_w, confirmado: false }, token);
      setDispositivos((prev) => prev!.map((x) => (x.index === dev.index ? dev : x)));
    } catch (e) {
      setErrorAplicar(String(e));
    }
  }

  if (error) return <p className="px-6 pt-5 text-[11px] text-danger-fg">{error}</p>;
  if (!dispositivos) return <p className="px-6 pt-5 text-[11px] text-subtle">cargando</p>;

  return (
    <div className="px-6 pb-8 pt-5">
      <div className="flex items-end justify-between border-b border-border pb-[11px]">
        <h2 className="text-[21px] font-medium tracking-[-.025em]">Hardware</h2>
        <div className="relative flex w-[126px] rounded-lg border border-border bg-surface p-[3px]">
          <span className="absolute left-[3px] top-[3px] h-[calc(100%-6px)] w-[60px] rounded-md bg-elevated
            transition-transform duration-[420ms] ease-expo"
            style={{ transform: avanzado ? "translateX(60px)" : "translateX(0)" }} />
          {(["Básico", "Avanzado"] as const).map((l, i) => (
            <button key={l} onClick={() => setAvanzado(i === 1)}
              className={`relative z-10 flex-1 py-[5px] text-[10px] transition-colors
                ${(i === 1) === avanzado ? "text-fg" : "text-subtle"}`}>
              {l}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-3 space-y-2.5">
        {dispositivos.map((d) => (
          <div key={d.index}
            onClick={() => avanzado && capCurvas?.state !== "off" && setEditando(d.index)}
            className={`rounded-[14px] border border-border/70 bg-panel p-[18px_20px]
              transition-colors ${avanzado ? "cursor-pointer hover:border-border" : ""}`}>
            <div className="flex items-center gap-6">
              <Icon name="gpu" size={44} className="shrink-0 text-subtle" />
              <div className="w-[150px] shrink-0">
                <div className="text-[13.5px] text-fg">{d.name}</div>
                <div className="mt-0.5 font-mono text-[9.5px] text-subtle">GPU {d.index}</div>
              </div>
              <div className="relative h-16 w-16 shrink-0">
                <svg viewBox="0 0 64 64" className="absolute inset-0">
                  <circle cx="32" cy="32" r="27" fill="none" stroke="#1a1c1f" strokeWidth={4} />
                  <circle cx="32" cy="32" r="27" fill="none" strokeWidth={4} strokeLinecap="round"
                    stroke={d.perfil && d.perfil.potencia_w > d.rango.potencia_max_w ? "#e88f8f" : "#e8e8e6"}
                    strokeDasharray={`${((d.sample.temp_c ?? 0) / 100) * 170} 170`}
                    transform="rotate(-90 32 32)" />
                </svg>
                <span className="absolute inset-0 flex items-center justify-center font-mono text-[14px]">
                  {d.sample.temp_c ?? "—"}°
                </span>
              </div>
              <div className="flex flex-1 gap-6">
                <Stat
                  v={d.sample.power_draw_mw != null ? `${(d.sample.power_draw_mw / 1000).toFixed(0)}` : "—"}
                  u="W" l="potencia"
                  alerta={!!d.perfil && d.perfil.potencia_w > d.rango.potencia_max_w}
                />
                <Stat
                  v={(d.sample.vram_used_mb / 1024).toFixed(1)}
                  u={`/ ${(d.sample.vram_total_mb / 1024).toFixed(0)}GB`}
                  l="vram"
                />
                <Stat v={`${d.sample.clock_mhz ?? "—"}`} u="MHz" l="reloj" />
                <Stat v={`${d.sample.fan_pct ?? "—"}`} u="%" l="ventilador" />
              </div>
              {d.perfil && d.perfil.potencia_w > d.rango.potencia_max_w && (
                <span className="rounded-full border border-danger/40 bg-danger/10 px-2.5 py-[3px] text-[9px] text-danger-fg">
                  ⚠ sobre fábrica
                </span>
              )}
            </div>

            {!avanzado && capPotencia?.state !== "off" && (
              <div className="mt-3 border-t border-border/60 pt-3" onClick={(e) => e.stopPropagation()}>
                <input
                  type="range" min={d.rango.potencia_min_w} max={d.rango.potencia_max_w}
                  defaultValue={d.perfil?.potencia_w ?? d.rango.potencia_max_w}
                  onPointerUp={(e) => aplicarBasico(d.index, +(e.target as HTMLInputElement).value)}
                  className="w-full accent-fg"
                />
                <div className="flex justify-between font-mono text-[9px] text-subtle">
                  <span>{d.rango.potencia_min_w}W</span><span>{d.rango.potencia_max_w}W</span>
                </div>
                {errorAplicar && <p className="mt-1.5 text-[10.5px] text-danger-fg">{errorAplicar}</p>}
              </div>
            )}
          </div>
        ))}
      </div>

      {editando !== null && (() => {
        const d = dispositivos.find((x) => x.index === editando)!;
        return (
          <HardwareEditor
            device={d} token={token} onCerrar={() => setEditando(null)}
            onAplicado={(nuevo) => setDispositivos((prev) => prev!.map((x) => (x.index === nuevo.index ? nuevo : x)))}
            curvasHabilitadas={capCurvas?.state !== "off"}
            curvasMotivo={capCurvas?.reason ?? null}
          />
        );
      })()}

      {(capPotencia?.state === "off" || capCurvas?.state === "off") && (
        <p className="mt-4 text-[10.5px] leading-relaxed text-subtle">
          {capPotencia?.state === "off" && <>Potencia: {capPotencia.reason} </>}
          {capCurvas?.state === "off" && <>Curvas: {capCurvas.reason}</>}
        </p>
      )}
    </div>
  );
}

function Stat({ v, u, l, alerta }: { v: string; u: string; l: string; alerta?: boolean }) {
  return (
    <div>
      <div className={`font-mono text-[16px] ${alerta ? "text-danger-fg" : "text-fg"}`}>
        {v}<small className="ml-0.5 text-[9.5px] text-subtle">{u}</small>
      </div>
      <div className="text-[8px] uppercase tracking-[.07em] text-subtle">{l}</div>
    </div>
  );
}
