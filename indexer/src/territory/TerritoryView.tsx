import { useState } from "react";

import { api, type Clasificacion, type Punto } from "../lib/api";
import { BlockedDialog } from "./BlockedDialog";
import { CoveragePanel } from "./CoveragePanel";
import { MapCanvas } from "./MapCanvas";
import { PlanDialog } from "./PlanDialog";

/** Dibujar, clasificar y decidir: el plan si hay algo nuevo, el bloqueo si no
 *  queda nada. Confirmar el plan anota primero lo heredado y solo después crea
 *  los lotes de lo nuevo — si se corta a la mitad, lo heredado ya está dentro. */
export function TerritoryView({ nombre }: { nombre: string }) {
  const [dibujo, setDibujo] = useState<Punto[]>([]);
  const [clasificacion, setClasificacion] = useState<Clasificacion | null>(null);
  const [mostrarPlan, setMostrarPlan] = useState(false);

  async function alTerminarDibujo(p: Punto[]) {
    setDibujo(p);
    setClasificacion(await api.territorioClasificar(p));
  }

  function reiniciar() {
    setDibujo([]);
    setClasificacion(null);
    setMostrarPlan(false);
  }

  return (
    <div className="relative flex h-full">
      <div className="flex-1">
        <MapCanvas dibujo={dibujo} clasificacion={clasificacion} onPoligonoListo={(p) => void alTerminarDibujo(p)} />
      </div>

      {clasificacion && !mostrarPlan && (
        <CoveragePanel c={clasificacion} onPlanear={() => setMostrarPlan(true)} />
      )}

      {clasificacion && mostrarPlan && clasificacion.nuevas === 0 && (
        <div className="absolute inset-0 z-40 grid place-items-center bg-black/40">
          <BlockedDialog c={clasificacion} onAjustar={reiniciar} onInstalar={reiniciar} />
        </div>
      )}

      {clasificacion && mostrarPlan && clasificacion.nuevas > 0 && (
        <div className="absolute inset-0 z-40 grid place-items-center bg-black/40">
          <PlanDialog nombre={nombre} c={clasificacion} onCancelar={() => setMostrarPlan(false)} onConfirmar={reiniciar} />
        </div>
      )}
    </div>
  );
}
