import { useState } from "react";

export function ConfirmarPeligro({
  motivo, onCancelar, onConfirmar,
}: { motivo: string; onCancelar: () => void; onConfirmar: () => void }) {
  const [texto, setTexto] = useState("");
  const ok = texto.trim().toLowerCase() === "soy consciente";

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70"
      style={{ animation: "jg-backdrop-in .28s ease both" }}>
      <div className="w-[300px] rounded-card border border-border bg-panel p-5 text-center"
        style={{ animation: "jg-popup-scale-in .3s cubic-bezier(.16,1,.3,1) both" }}>
        <div className="mx-auto mb-3 grid h-[52px] w-[52px] place-items-center rounded-full
          border border-danger/40 bg-danger/10">
          <span className="text-[26px] text-danger-fg">⚠</span>
        </div>
        <p className="text-[13px] font-medium text-fg">Vas a superar el límite de fábrica</p>
        <p className="mt-1.5 text-[10.5px] leading-relaxed text-muted">{motivo}</p>
        <p className="mt-3.5 text-left text-[10px] text-subtle">
          Escribe <b className="font-mono text-fg">soy consciente</b> para aplicar de todas formas
        </p>
        <input
          value={texto} onChange={(e) => setTexto(e.target.value)}
          placeholder="soy consciente"
          className="mt-1.5 w-full rounded-lg border border-border bg-bg px-2.5 py-2 text-[11.5px] text-fg"
        />
        <div className="mt-3 flex justify-center gap-2">
          <button onClick={onCancelar} className="jg-press rounded-lg px-3.5 py-1.5 text-[10.5px] text-subtle">
            Cancelar
          </button>
          <button
            onClick={onConfirmar} disabled={!ok}
            className="jg-press rounded-lg border border-danger/40 bg-danger/20 px-3.5 py-1.5
              text-[11px] text-danger-fg disabled:opacity-50"
          >
            Aplicar de todas formas
          </button>
        </div>
      </div>
    </div>
  );
}
