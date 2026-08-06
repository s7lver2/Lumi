import { useState } from "react";

import type { Saludo } from "../lib/api";
import { ModelsStep } from "./ModelsStep";
import { RuntimeStep } from "./RuntimeStep";
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
      {paso === 2 && <RuntimeStep onListo={() => setPaso(3)} />}
      {paso === 3 && <ModelsStep onListo={onListo} />}
    </div>
  );
}
