import { useEffect, useRef, useState } from "react";

import { api, type Clasificacion, type Estimacion, type FichaOrigen, type Punto, type SondeoTesela } from "../lib/api";
import { Overlay } from "../ui/Overlay";
import { AvailabilityPanel } from "./AvailabilityPanel";
import { BlockedDialog } from "./BlockedDialog";
import { CoveragePanel } from "./CoveragePanel";
import { EstimateDialog } from "./EstimateDialog";
import { MapCanvas } from "./MapCanvas";
import { MapLegend } from "./MapLegend";
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
  onDescargando?: (imagenesEstimadas: number) => void;
}) {
  const [dibujo, setDibujo] = useState<Punto[]>([]);
  const [clasificacion, setClasificacion] = useState<Clasificacion | null>(null);
  const [mostrarPlan, setMostrarPlan] = useState(false);

  const [fichas, setFichas] = useState<FichaOrigen[]>([]);
  const [activos, setActivos] = useState<Set<string>>(new Set());
  const [sondeos, setSondeos] = useState<SondeoTesela[]>([]);
  const [sondeando, setSondeando] = useState(false);
  const [sondeoProgreso, setSondeoProgreso] = useState<{ hechos: number; total: number } | null>(null);
  const sondeoTick = useRef<ReturnType<typeof setInterval> | null>(null);
  const [tokenMapillary, setTokenMapillary] = useState<string | null>(null);
  const [estimacion, setEstimacion] = useState<Estimacion | null>(null);
  const [nuevasPorOrigen, setNuevasPorOrigen] = useState<Record<string, string[]>>({});
  const [confirmandoPlan, setConfirmandoPlan] = useState(false);
  const [confirmandoDescarga, setConfirmandoDescarga] = useState(false);

  useEffect(() => { void api.origenesLista().then(setFichas); }, []);
  useEffect(() => { void api.claveLeer("mapillary").then(setTokenMapillary); }, []);
  // Nunca al mover el mapa, siempre al abrir Territorio: sin esto la
  // cobertura remota que decide qué tesela está "reclamada" puede quedarse
  // vacía si nunca se pasó antes por Índices o Ajustes.
  useEffect(() => { void api.catalogoRefrescar(); }, []);

  // La clasificación necesita saber contra QUÉ orígenes se pregunta, porque
  // una tesela heredada puede seguir sin cubrir en alguno de ellos.
  async function alTerminarDibujo(p: Punto[]) {
    setDibujo(p);
    setSondeos([]);
    setClasificacion(await api.territorioClasificar(p, fichas.map((f) => f.id), indiceId));
  }

  function cambiarActivo(id: string, on: boolean) {
    const nuevos = new Set(activos);
    if (on) nuevos.add(id); else nuevos.delete(id);
    setActivos(nuevos);
  }

  // Sondea en segundo plano y sondea el progreso cada 300 ms: cada origen
  // avanza a su propio ritmo (Mapillary en segundos, Google/KartaView más
  // despacio porque comparten el limitador de Overpass), así que esperar al
  // final para pintar algo dejaba el mapa entero gris durante todo ese rato.
  // Con esto, cada resultado que llega se pinta en cuanto llega.
  async function sondear() {
    if (!clasificacion) return;
    setSondeando(true);
    setSondeos([]);
    setSondeoProgreso(null);
    await api.sondearAreaArrancar(clasificacion.teselas.map(([qk]) => qk));
    sondeoTick.current = setInterval(async () => {
      const p = await api.sondearAreaProgreso();
      setSondeos(p.resultados);
      setSondeoProgreso({ hechos: p.hechos, total: p.total });
      if (p.terminado) {
        if (sondeoTick.current) clearInterval(sondeoTick.current);
        setSondeando(false);
      }
    }, 300);
  }

  useEffect(() => {
    return () => { if (sondeoTick.current) clearInterval(sondeoTick.current); };
  }, []);

  function reiniciar() {
    if (sondeoTick.current) clearInterval(sondeoTick.current);
    setDibujo([]);
    setClasificacion(null);
    setMostrarPlan(false);
    setSondeos([]);
    setSondeando(false);
    setSondeoProgreso(null);
    setEstimacion(null);
    setNuevasPorOrigen({});
  }

  // El plan del 7a solo distingue local/catálogo/nuevo en bloque. Sin un
  // catálogo remoto real (el 8), lo "nuevo" del bloque es lo mismo para todos
  // los orígenes activos: cada origen que se encienda tiene que preguntarse
  // por las mismas teselas sin cobertura local.
  async function alConfirmarPlan() {
    if (!clasificacion) return;
    setConfirmandoPlan(true);
    try {
      // Lo heredado se anota PRIMERO: si el operador cierra a mitad de la
      // descarga, lo que ya estaba adjuntado sigue dentro del índice.
      //
      // `flatMap` y no `filter`+`map`: TypeScript no estrecha la unión de
      // `EstadoTesela` a través de un `filter`, así que `e.indice` no compilaría.
      if (indiceId !== undefined) {
        const heredadas = clasificacion.teselas.flatMap(([qk, e]) =>
          e.estado === "local" ? [[qk, e.indice, e.sha256] as [string, string, string]] : [],
        );
        if (heredadas.length > 0) await api.territorioHeredar(indiceId, heredadas);
      }
      const nuevas = clasificacion.teselas.filter(([, e]) => e.estado === "nuevo").map(([qk]) => qk);
      const nuevasMap: Record<string, string[]> = {};
      for (const f of activos) nuevasMap[f] = nuevas;
      setNuevasPorOrigen(nuevasMap);
      setEstimacion(await api.estimarArea(nuevasMap));
    } finally {
      setConfirmandoPlan(false);
    }
  }

  async function confirmarDescarga(soloGratis: boolean) {
    if (!estimacion || indiceId === undefined) {
      reiniciar();
      return;
    }
    setConfirmandoDescarga(true);
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
    // Lo único que se sabe de antemano sobre cuántas imágenes van a caer: la
    // estimación del sondeo, sumada solo entre los orígenes que de verdad
    // entran en esta descarga. Sin esto, el ETA de la descarga no tiene con
    // qué medir "cuánto falta" mientras una sola tesela tarda minutos.
    const imagenesEstimadas = estimacion.lineas
      .filter((l) => activas.has(l.fuente))
      .reduce((s, l) => s + l.unidades, 0);
    await api.descargaArrancar(indiceId, nuevas, presupuesto, imagenesEstimadas);
    // Sin `setConfirmandoDescarga(false)`: `reiniciar()` desmonta el diálogo
    // entero, así que dejarlo en `true` no se llega a ver.
    reiniciar();
    onDescargando?.(imagenesEstimadas);
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

      {/* Sin esto no hay ninguna pista de que hay una barra de herramientas de
          dibujo abajo: la capa de disponibilidad, la cobertura y el plan solo
          aparecen DESPUÉS de cerrar una forma, y hasta entonces el mapa vacío
          no dice cómo se empieza. Encima de la barra, no al lado: ahí es
          donde está la herramienta que resuelve la pista. */}
      {!clasificacion && (
        <div className="pointer-events-none absolute bottom-[62px] left-1/2 z-20 -translate-x-1/2
          whitespace-nowrap rounded-card border border-white/[.13] bg-[rgba(16,19,25,.72)]
          px-3.5 py-2 shadow-lg shadow-black/40 backdrop-blur-xl">
          <p className="text-[11px] text-fg">
            Elige una herramienta y dibuja el área a indexar sobre el mapa.
          </p>
        </div>
      )}

      {clasificacion && !mostrarPlan && (
        <AvailabilityPanel
          fichas={fichas}
          activos={activos}
          sondeos={sondeos}
          sondeando={sondeando}
          progreso={sondeoProgreso}
          onCambiar={cambiarActivo}
          onSondear={() => void sondear()}
        />
      )}

      {clasificacion && !mostrarPlan && (
        <CoveragePanel c={clasificacion} onPlanear={() => setMostrarPlan(true)} />
      )}

      {clasificacion && !mostrarPlan && <MapLegend />}

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
            cargando={confirmandoPlan}
            onCancelar={() => setMostrarPlan(false)}
            onConfirmar={() => void alConfirmarPlan()}
          />
        </Overlay>
      )}

      {estimacion && (
        <Overlay>
          <EstimateDialog
            e={estimacion}
            cargando={confirmandoDescarga}
            onCancelar={() => setEstimacion(null)}
            onConfirmar={(soloGratis) => void confirmarDescarga(soloGratis)}
          />
        </Overlay>
      )}
    </div>
  );
}
