import { useEffect, useState } from "react";

import { api } from "../lib/api";

export function RendimientoPanel() {
  const [consumoBajo, setConsumoBajo] = useState<boolean | null>(null);
  const [autoarranque, setAutoarranque] = useState<boolean | null>(null);

  useEffect(() => { void api.colaConsumoLeer().then(setConsumoBajo); }, []);
  useEffect(() => { void api.autoarranqueLeer().then(setAutoarranque); }, []);

  async function cambiarConsumo(bajo: boolean) {
    setConsumoBajo(bajo);
    await api.colaConsumoFijar(bajo);
  }

  async function cambiarAutoarranque(v: boolean) {
    setAutoarranque(v);
    await api.autoarranqueFijar(v);
  }

  return (
    <div className="h-full overflow-y-auto p-8">
      <div className="mx-auto max-w-xl">
        <p className="text-sm text-fg">Rendimiento</p>
        <p className="mt-[5px] text-[11px] leading-relaxed text-muted">
          Cómo de agresivo es el Indexer con los recursos del equipo mientras trabaja de fondo.
        </p>

        <div className="mt-6">
          <p className="text-sm text-fg">Consumo al embeber</p>
          <p className="mt-[5px] text-[11px] leading-relaxed text-muted">
            Alto reparte más VRAM y usa prioridad normal de proceso — más rápido, pero nota el
            ordenador ocupado. Bajo usa un solo modelo a la vez con prioridad baja — más lento,
            pero puedes seguir trabajando con normalidad mientras corre.
          </p>
          <div className="mt-3 flex gap-2">
            {[
              { bajo: false, etiqueta: "Alto" },
              { bajo: true, etiqueta: "Bajo" },
            ].map(({ bajo, etiqueta }) => (
              <button
                key={etiqueta}
                onClick={() => void cambiarConsumo(bajo)}
                disabled={consumoBajo === null}
                className={`jg-press rounded-lg border px-3.5 py-2 text-[11.5px] disabled:opacity-40 ${
                  consumoBajo === bajo ? "border-white/30 bg-white/[.08] text-fg" : "border-border text-fg"
                }`}
              >
                {etiqueta}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-6">
          <label className="flex items-center justify-between gap-3 rounded-lg border border-border bg-[#0b0d0f] px-3 py-2.5">
            <span className="text-[11px] text-fg">
              Iniciar con el sistema
              <span className="mt-0.5 block text-[9.5px] text-subtle">Abre el Indexer automáticamente al encender el equipo.</span>
            </span>
            <button role="switch" aria-checked={autoarranque ?? false} disabled={autoarranque === null}
              onClick={() => void cambiarAutoarranque(!autoarranque)}
              className={`relative h-5 w-9 shrink-0 rounded-full border transition-colors disabled:opacity-40 ${
                autoarranque ? "border-draw bg-draw" : "border-white/15 bg-white/10"}`}>
              <span className={`absolute top-0.5 h-3.5 w-3.5 rounded-full bg-fg ring-1 ring-black/20 transition-transform ${
                autoarranque ? "translate-x-[18px]" : "translate-x-0.5"}`} />
            </button>
          </label>
        </div>
      </div>
    </div>
  );
}
