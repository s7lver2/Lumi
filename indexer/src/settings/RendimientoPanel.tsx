import { useEffect, useState } from "react";

import { api } from "../lib/api";

export function RendimientoPanel() {
  const [consumoBajo, setConsumoBajo] = useState<boolean | null>(null);
  const [autoarranque, setAutoarranque] = useState<boolean | null>(null);
  const [hfTokenHay, setHfTokenHay] = useState<boolean | null>(null);
  const [hfTokenCampo, setHfTokenCampo] = useState("");
  const [hfTokenGuardando, setHfTokenGuardando] = useState(false);

  useEffect(() => { void api.colaConsumoLeer().then(setConsumoBajo); }, []);
  useEffect(() => { void api.autoarranqueLeer().then(setAutoarranque); }, []);
  useEffect(() => { void api.hfTokenHay().then(setHfTokenHay); }, []);

  async function cambiarConsumo(bajo: boolean) {
    setConsumoBajo(bajo);
    await api.colaConsumoFijar(bajo);
  }

  async function cambiarAutoarranque(v: boolean) {
    setAutoarranque(v);
    await api.autoarranqueFijar(v);
  }

  async function guardarHfToken() {
    setHfTokenGuardando(true);
    try {
      await api.hfTokenGuardar(hfTokenCampo);
      setHfTokenHay(hfTokenCampo.length > 0);
      setHfTokenCampo("");
    } finally {
      setHfTokenGuardando(false);
    }
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

        <div className="mt-6">
          <p className="text-sm text-fg">Token de HuggingFace</p>
          <p className="mt-[5px] text-[11px] leading-relaxed text-muted">
            Sin token, HuggingFace limita bastante la velocidad de descarga de los pesos que vienen
            de ahí (MegaLoc, Qwen3-VL...). Uno gratuito de solo lectura, desde{" "}
            <span className="font-mono text-subtle">huggingface.co/settings/tokens</span>, basta.
          </p>
          <div className="mt-3 flex gap-2">
            <input
              type="password"
              value={hfTokenCampo}
              onChange={(e) => setHfTokenCampo(e.target.value)}
              placeholder={hfTokenHay ? "ya hay uno guardado — pega otro para reemplazarlo" : "hf_…"}
              className="min-w-0 flex-1 rounded-lg border border-border bg-[#0b0d0f] px-3 py-2 font-mono text-[11px]
                text-fg placeholder:text-subtle focus:outline-none focus:ring-1 focus:ring-white/20"
            />
            <button onClick={() => void guardarHfToken()} disabled={hfTokenGuardando || !hfTokenCampo}
              className="jg-press rounded-lg border border-border px-3.5 py-2 text-[11.5px] text-fg disabled:opacity-40">
              Guardar
            </button>
          </div>
          {hfTokenHay && (
            <p className="mt-1.5 text-[9.5px] text-subtle">Ya tienes uno guardado. Deja el campo vacío y guarda para quitarlo.</p>
          )}
        </div>
      </div>
    </div>
  );
}
