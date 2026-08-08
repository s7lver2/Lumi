import { useEffect, useState } from "react";

import { api, type Clasificacion, type Estimacion, type FichaOrigen, type Punto, type SondeoTesela } from "../lib/api";
import { Overlay } from "../ui/Overlay";
import { AvailabilityPanel } from "./AvailabilityPanel";
import { BlockedDialog } from "./BlockedDialog";
import { CoveragePanel } from "./CoveragePanel";
import { EstimateDialog } from "./EstimateDialog";
import { MapCanvas } from "./MapCanvas";
import { PlanDialog } from "./PlanDialog";

/** Dibujar, clasificar y decidir: el plan si hay algo nuevo, el bloqueo si no
 *  queda nada. Confirmar el plan anota primero lo heredado y solo después crea
 *  los lotes de lo nuevo — si se corta a la mitad, lo heredado ya está dentro. */
export function TerritoryView({
  nombre,
  indiceId,
  onDescargando,
}: {
  nombre: string;
  indiceId?: number;
  onDescargando?: () => void;
}) {
  const [dibujo, setDibujo] = useState<Punto[]>([]);
  const [clasificacion, setClasificacion] = useState<Clasificacion | null>(null);
  const [mostrarPlan, setMostrarPlan] = useState(false);

  const [fichas, setFichas] = useState<FichaOrigen[]>([]);
  const [activos, setActivos] = useState<Set<string>>(new Set());
  const [sondeos, setSondeos] = useState<SondeoTesela[]>([]);
  const [sondeando, setSondeando] = useState(false);
  const [tokenMapillary, setTokenMapillary] = useState<string | null>(null);
  const [estimacion, setEstimacion] = useState<Estimacion | null>(null);
  const [nuevasPorOrigen, setNuevasPorOrigen] = useState<Record<string, string[]>>({});

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
    setEstimacion(null);
    setNuevasPorOrigen({});
  }

  // El plan del 7a solo distingue local/catálogo/nuevo en bloque. Sin un
  // catálogo remoto real (el 8), lo "nuevo" del bloque es lo mismo para todos
  // los orígenes activos: cada origen que se encienda tiene que preguntarse
  // por las mismas teselas sin cobertura local.
  async function alConfirmarPlan() {
    if (!clasificacion) return;
    const nuevas = clasificacion.teselas.filter(([, e]) => e.estado === "nuevo").map(([qk]) => qk);
    const nuevasMap: Record<string, string[]> = {};
    for (const f of activos) nuevasMap[f] = nuevas;
    setNuevasPorOrigen(nuevasMap);
    setEstimacion(await api.estimarArea(nuevasMap));
  }

  async function confirmarDescarga(soloGratis: boolean) {
    if (!estimacion || indiceId === undefined) {
      reiniciar();
      return;
    }
    const activas = soloGratis
      ? new Set(estimacion.lineas.filter((l) => l.coste_eur === 0).map((l) => l.fuente))
      : new Set(estimacion.lineas.map((l) => l.fuente));
    const nuevas = Object.fromEntries(
      Object.entries(nuevasPorOrigen).filter(([f]) => activas.has(f)),
    );
    // El presupuesto que viaja con la descarga es LO ESTIMADO, no lo que queda
    // del mes: así un origen que se desmadre se queda sin saldo en su propio
    // trabajo en vez de comerse el tope entero.
    const presupuesto = soloGratis ? 0 : estimacion.total_eur;
    await api.descargaArrancar(indiceId, nuevas, presupuesto);
    reiniciar();
    onDescargando?.();
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
        <Overlay>
          <BlockedDialog c={clasificacion} onAjustar={reiniciar} onInstalar={reiniciar} />
        </Overlay>
      )}

      {clasificacion && mostrarPlan && clasificacion.nuevas > 0 && !estimacion && (
        <Overlay>
          <PlanDialog
            nombre={nombre}
            c={clasificacion}
            onCancelar={() => setMostrarPlan(false)}
            onConfirmar={() => void alConfirmarPlan()}
          />
        </Overlay>
      )}

      {estimacion && (
        <Overlay>
          <EstimateDialog
            e={estimacion}
            onCancelar={() => setEstimacion(null)}
            onConfirmar={(soloGratis) => void confirmarDescarga(soloGratis)}
          />
        </Overlay>
      )}
    </div>
  );
}
