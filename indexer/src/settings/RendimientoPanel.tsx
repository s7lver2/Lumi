import { useEffect, useState } from "react";

import { api } from "../lib/api";

export function RendimientoPanel() {
  const [consumoBajo, setConsumoBajo] = useState<boolean | null>(null);

  useEffect(() => { void api.colaConsumoLeer().then(setConsumoBajo); }, []);

  async function cambiarConsumo(bajo: boolean) {
    setConsumoBajo(bajo);
    await api.colaConsumoFijar(bajo);
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
      </div>
    </div>
  );
}
