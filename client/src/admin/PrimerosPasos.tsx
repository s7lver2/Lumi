import { useState } from "react";
import type { Seccion } from "./Sidebar";

const OCULTO_KEY = "lumi.resumen.primerosPasos.oculto";

export interface Chequeo {
  label: string;
  hecho: boolean;
  /** A dónde navegar si se pulsa "Ir →". Ausente = no hay acción directa. */
  ir?: Seccion;
}

/** Chequeos derivados de datos que `ResumenView` ya pidió — este componente
 *  no hace ninguna petición propia. Se colapsa solo en cuanto no queda
 *  nada pendiente (mismo `grid-template-rows` que ya usa `SecurityView`
 *  para sus paneles expandibles); antes de eso se puede cerrar a mano, y
 *  esa decisión se recuerda en este navegador — igual que
 *  `lumi.notificaciones.leido` — permanente para este perfil. */
export function PrimerosPasos({ chequeos, onIr }: { chequeos: Chequeo[]; onIr: (s: Seccion) => void }) {
  const [oculto, setOculto] = useState(() => localStorage.getItem(OCULTO_KEY) === "1");
  const pendientes = chequeos.filter((c) => !c.hecho).length;
  const visible = !oculto && pendientes > 0;

  function cerrar() {
    localStorage.setItem(OCULTO_KEY, "1");
    setOculto(true);
  }

  return (
    <div className="grid transition-[grid-template-rows] duration-[420ms] ease-expo"
      style={{ gridTemplateRows: visible ? "1fr" : "0fr" }}>
      <div className="overflow-hidden">
        <div className="mb-4 overflow-hidden rounded-[11px] border border-white/[.14]">
          <div className="flex items-center gap-2.5 px-3.5 pb-2.5 pt-3">
            <p className="text-[11.5px] text-fg">Primeros pasos</p>
            <span className="text-[9.5px] text-subtle">{pendientes} de {chequeos.length} pendientes</span>
            <button onClick={cerrar} className="ml-auto text-[11px] text-subtle hover:text-fg">✕</button>
          </div>
          <div className="mx-3.5 mb-2.5 h-[2px] overflow-hidden rounded-sm bg-border">
            <div className="h-full bg-fg transition-[width] duration-500 ease-expo"
              style={{ width: `${((chequeos.length - pendientes) / chequeos.length) * 100}%` }} />
          </div>
          {chequeos.map((c, i) => (
            <div key={i}
              style={{ animation: `jg-fade-rise .5s ${i * 40}ms cubic-bezier(.16,1,.3,1) both` }}
              className="flex items-center gap-2.5 border-t border-border px-3.5 py-2 text-[10.5px]">
              <span className={`grid h-[13px] w-[13px] shrink-0 place-items-center rounded-[3px] border text-[9px] font-bold ${
                c.hecho ? "border-fg bg-fg text-bg" : "border-white/25 text-transparent"}`}>
                ✓
              </span>
              <span className={c.hecho ? "text-subtle line-through" : "text-muted"}>{c.label}</span>
              {!c.hecho && c.ir && (
                <button onClick={() => onIr(c.ir!)} className="ml-auto shrink-0 text-[10px] text-draw-fg hover:underline">
                  Ir →
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
