import { useState } from "react";

import type { Saludo } from "../lib/api";
import { ServicesStep } from "./ServicesStep";
import { Stepper } from "./Stepper";

const PASOS = ["Carpeta", "Servicios", "Runtime", "Modelos"];

/** Misma composición que el wizard del subsistema 1: 552 px, brandline ✦,
 *  stepper de burbujas, tarjeta de cristal. No es un componente nuevo. */
export function SetupWizard({ saludo, onListo }: { saludo: Saludo; onListo: () => void }) {
  // La carpeta ya existe cuando la app arranca (la crea el lado Rust), así que
  // el paso 1 nace hecho y el wizard abre directamente en Servicios.
  const [paso, setPaso] = useState(1);

  return (
    <div className="relative z-10 w-[552px]" style={{ animation: "jg-fade-rise .7s both" }}>
      <div className="mb-5 flex items-center gap-2.5">
        <span className="text-[15px] text-fg">✦</span>
        <span className="text-[17px] font-medium text-fg">Lumi Indexer</span>
        <span className="font-mono text-[9.5px] text-subtle">v{saludo.version}</span>
      </div>
      <Stepper pasos={PASOS} actual={paso} />
      {paso === 1 && <ServicesStep saludo={saludo} onListo={() => setPaso(2)} />}
      {paso >= 2 && (
        // Los pasos 3 y 4 los añade la tarea 11.
        <div className="rounded-card border border-white/[.13] bg-[rgba(16,19,25,.66)] p-[20px_22px] backdrop-blur-xl">
          <p className="text-sm text-fg">Servicios listos</p>
          <p className="mt-[5px] text-[11px] text-muted">El runtime y los modelos llegan en la tarea 11.</p>
          <button onClick={onListo} className="jg-press mt-4 rounded-lg bg-accent px-4 py-2 text-[11.5px] font-medium text-black">
            Entrar
          </button>
        </div>
      )}
    </div>
  );
}
