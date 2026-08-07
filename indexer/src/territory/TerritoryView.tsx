import { useEffect, useState } from "react";

import { api, type Clasificacion, type FichaOrigen, type Punto, type SondeoTesela } from "../lib/api";
import { AvailabilityPanel } from "./AvailabilityPanel";
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

  const [fichas, setFichas] = useState<FichaOrigen[]>([]);
  const [activos, setActivos] = useState<Set<string>>(new Set());
  const [sondeos, setSondeos] = useState<SondeoTesela[]>([]);
  const [sondeando, setSondeando] = useState(false);
  const [tokenMapillary, setTokenMapillary] = useState<string | null>(null);

  useEffect(() => { void api.origenesLista().then(setFichas); }, []);
  useEffect(() => { void api.claveLeer("mapillary").then(setTokenMapillary); }, []);

  // La clasificación necesita saber contra QUÉ orígenes se pregunta, porque
  // una tesela heredada puede seguir sin cubrir en alguno de ellos.
  async function alTerminarDibujo(p: Punto[]) {
    setDibujo(p);
    setSondeos([]);
    setClasificacion(await api.territorioClasificar(p, fichas.map((f) => f.id)));
  }

  function cambiarActivo(id: string, on: boolean) {
    const nuevos = new Set(activos);
    if (on) nuevos.add(id); else nuevos.delete(id);
    setActivos(nuevos);
  }

  async function sondear() {
    if (!clasificacion) return;
    setSondeando(true);
    try {
      setSondeos(await api.sondearArea(clasificacion.teselas.map(([qk]) => qk)));
    } finally {
      setSondeando(false);
    }
  }

  function reiniciar() {
    setDibujo([]);
    setClasificacion(null);
    setMostrarPlan(false);
    setSondeos([]);
  }

  return (
    <div className="relative flex h-full">
      <div className="flex-1">
        <MapCanvas
          dibujo={dibujo}
          clasificacion={clasificacion}
          onPoligonoListo={(p) => void alTerminarDibujo(p)}
          activos={activos}
          sondeos={sondeos}
          tokenMapillary={tokenMapillary}
        />
      </div>

      {clasificacion && !mostrarPlan && (
        <AvailabilityPanel
          fichas={fichas}
          activos={activos}
          sondeos={sondeos}
          sondeando={sondeando}
          onCambiar={cambiarActivo}
          onSondear={() => void sondear()}
        />
      )}

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
