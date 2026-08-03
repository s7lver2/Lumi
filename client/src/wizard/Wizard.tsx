import type { ReactNode } from "react";
import { Icon } from "../ui/Icon";

export const STEPS = ["Vincular", "Admin", "Runtime", "Datos", "Modelos", "Listo"] as const;

export function Wizard({ step, title, subtitle, children, onBack, onNext, nextLabel = "Siguiente", nextDisabled }: {
  step: number; title: string; subtitle: string; children: ReactNode;
  onBack?: () => void; onNext?: () => void; nextLabel?: string; nextDisabled?: boolean;
}) {
  return (
    <div className="relative z-10 mx-auto w-full max-w-xl px-6 py-9">
      <div className="mb-1 flex items-center gap-2.5" style={{ animation: "jg-fade-rise .7s both" }}>
        <span className="text-fg" style={{ animation: "jg-lock-breathe 2.4s ease-in-out infinite" }}>✦</span>
        <span className="text-[17px] font-medium text-fg">{title}</span>
      </div>
      <p className="mb-6 text-xs text-muted" style={{ animation: "jg-fade-rise .7s .06s both" }}>
        Paso {step + 1} de {STEPS.length} · {subtitle}
      </p>

      {/* gap-x-2 es un backstop: sin él, un flex-1 con min-width:auto deja
          que el texto de la columna se desborde sobre la vecina cuando la
          palabra ("Vincular", "Runtime") es más ancha que su porción
          equitativa — es justo lo que se veía pegado en la captura. */}
      <div className="relative mb-6 flex items-start justify-between gap-x-2" style={{ animation: "jg-fade-rise .7s .12s both" }}>
        <div className="absolute left-[6%] right-[6%] top-3.5 h-0.5 bg-white/[.09]" />
        <div className="absolute left-[6%] top-3.5 h-0.5 rounded bg-accent transition-[width] duration-[900ms] ease-expo"
          style={{ width: `${(step / (STEPS.length - 1)) * 88}%` }} />
        {STEPS.map((label, i) => {
          const state = i < step ? "done" : i === step ? "now" : "todo";
          return (
            <div key={label} className="relative flex min-w-0 flex-1 flex-col items-center gap-1.5">
              <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full font-mono text-[11px] transition-all duration-500 ease-expo ${
                state === "done" ? "border border-accent bg-accent text-black"
                : state === "now" ? "border-2 border-accent bg-bg text-fg"
                : "border border-white/15 bg-white/5 text-subtle"}`}>
                {state === "done" ? <Icon name="check" size={13} /> : i + 1}
              </div>
              <span className={`text-center text-[10.5px] leading-tight ${i === step ? "text-fg" : "text-subtle"}`}>{label}</span>
            </div>
          );
        })}
      </div>

      <div className="rounded-card border border-white/[.13] bg-[rgba(16,19,25,.66)] p-5 shadow-lg shadow-black/40 backdrop-blur-xl"
        style={{ animation: "jg-fade-rise .8s .18s both" }}>
        {children}
      </div>

      <div className="mt-4 flex items-center justify-between gap-3">
        <button onClick={onBack} disabled={!onBack}
          className="rounded-lg border border-white/15 px-4 py-2 text-xs text-fg transition-transform duration-300 ease-expo active:translate-y-px disabled:opacity-40">
          Atrás
        </button>
        {onNext && (
          <button onClick={onNext} disabled={nextDisabled}
            className="rounded-lg bg-accent px-5 py-2 text-xs font-medium text-black transition-transform duration-300 ease-expo active:translate-y-px disabled:opacity-40">
            {nextLabel}
          </button>
        )}
      </div>
    </div>
  );
}
