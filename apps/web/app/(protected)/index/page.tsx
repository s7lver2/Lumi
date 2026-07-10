"use client";

import { useState, useEffect, useCallback } from "react";
import { MapCanvas } from "../../components/MapCanvas";
import { IndexingDrawTool } from "../../components/IndexingDrawTool";
import { FloatingCard } from "../../components/FloatingCard";
import { JobProgressBar } from "../../components/JobProgressBar";
import { useIndexingStore } from "../../stores/useIndexingStore";

// Componentes del Task 4 e interfaces de dibujo avanzados importados
import { AreasNotification } from "../../components/AreasNotification";
import { AreasPopup } from "../../components/AreasPopup";
import { DrawToolbar } from "../../components/DrawToolbar";

export default function IndexPage() {
  const [map, setMap] = useState<any>(null);
  const { drawnPolygon, areaKm2, estimate, activeJobId, setEstimate, startJob } = useIndexingStore();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Estados para el control y despliegue del historial de áreas (Task 4)
  const [areasOpen, setAreasOpen] = useState(false);
  const [areasCount, setAreasCount] = useState<number>(0);
  const [areasIndexing, setAreasIndexing] = useState<number>(0);

  // Estado local para sincronizar el modo de dibujo de Mapbox Draw (Task 7/8)
  const [drawMode, setDrawMode] = useState<string>("simple_select");

  // Estado para almacenar y controlar el límite de presupuesto consumido en el mes
  const [usage, setUsage] = useState<{ monthlySpendUsd: number; monthlyBudgetUsd: number } | null>(null);

  // SE EXTRAE: Función reutilizable y memorizada para consultar el conteo y estados de las áreas
  const refetchAreaCounts = useCallback(() => {
    fetch("/api/areas")
      .then((r) => r.json())
      .then((data) => {
        const areas = Array.isArray(data) ? data : data?.areas ?? [];
        setAreasCount(areas.length);
        setAreasIndexing(areas.filter((a: any) => a.status === "indexing").length);
      })
      .catch(() => {
        setAreasCount(0);
        setAreasIndexing(0);
      });
  }, []);

  // Carga los datos de consumo e inicializa el conteo de áreas creadas
  useEffect(() => {
    fetch("/api/usage")
      .then((r) => r.json())
      .then(setUsage)
      .catch(() => setUsage(null));

    refetchAreaCounts();
  }, [refetchAreaCounts]);

  async function handleEstimate() {
    if (!drawnPolygon) return;
    setBusy(true);
    setError(null);
    const res = await fetch("/api/areas/estimate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ polygon: drawnPolygon, areaKm2 }),
    });
    const json = await res.json();
    setBusy(false);
    if (!res.ok) return setError(json.error);
    setEstimate({ pointsEstimated: json.pointsEstimated, estimatedCostUsd: json.estimatedCostUsd });
  }

  async function handleConfirm() {
    if (!drawnPolygon) return;
    setBusy(true);
    const res = await fetch("/api/areas", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ polygon: drawnPolygon, areaKm2 }),
    });
    const json = await res.json();
    setBusy(false);
    if (!res.ok) return setError(json.error);
    startJob(json.areaId);
    
    setAreasCount((prev) => prev + 1);
  }

  async function handleShowAreaOnMap(id: string) {
    try {
      const res = await fetch(`/api/areas/${id}`);
      if (!res.ok) return;
      const data = await res.json();
      
      if (map && data?.area?.geometry && data?.points) {
        if (map.isStyleLoaded()) {
          renderAreaOnMap(map, data.area.geometry, data.points);
        } else {
          map.once("load", () => renderAreaOnMap(map, data.area.geometry, data.points));
        }
      }
    } catch (err) {
      console.error("Error al renderizar el área seleccionada:", err);
    }
  }

  // Manejadores ficticios / puentes para las funciones de limpieza e historial
  // Estas interactúan directamente a través de referencias o eventos con <IndexingDrawTool />
  function handleClearPolygon() {
    window.dispatchEvent(new CustomEvent("draw-clear"));
    setEstimate(null);
  }

  // Las funciones handleUndo y handleRedo quedan declaradas para uso del DrawToolbar
  function handleUndo() {
    const event = new CustomEvent("draw-undo");
    window.dispatchEvent(event);
  }

  function handleRedo() {
    const event = new CustomEvent("draw-redo");
    window.dispatchEvent(event);
  }

  function handleChangeMode(mode: string) {
    setDrawMode(mode);
    const event = new CustomEvent("draw-change-mode", { detail: { mode } });
    window.dispatchEvent(event);
  }

  return (
    <>
      <MapCanvas onReady={(m) => setMap(m)} />
      {map && (
        <IndexingDrawTool 
          map={map} 
          onModeChange={(currentMode) => setDrawMode(currentMode)}
        />
      )}

      {/* Botón/Toast de notificación flotante arriba a la derecha, con el
          popup de historial en el MISMO contenedor flex (en flujo normal,
          justo debajo) para que nunca se solapen. */}
      <div className="absolute right-4 top-4 z-50 flex flex-col items-end space-y-3">
        <AreasNotification
          count={areasCount}
          indexing={areasIndexing}
          onOpen={() => setAreasOpen(true)}
        />
        {areasOpen && (
          <AreasPopup
            onClose={() => setAreasOpen(false)}
            onShowArea={(id) => handleShowAreaOnMap(id)}
            onChanged={refetchAreaCounts}
          />
        )}
      </div>

      {/* Barra de herramientas flotante central inferior (se oculta si hay un Job activo) */}
      {!activeJobId && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-40">
          <DrawToolbar 
            mode={drawMode} 
            onModeChange={handleChangeMode} 
            onUndo={handleUndo} 
            onRedo={handleRedo} 
            onClear={handleClearPolygon} 
          />
        </div>
      )}

      {drawnPolygon && (
        <div className="absolute left-4 top-4 z-40">
          <FloatingCard className="px-3 py-2 text-xs text-fg">
            Área dibujada: {areaKm2.toFixed(1)} km²
          </FloatingCard>
        </div>
      )}

      {/* CONTENEDOR DE INTERFAZ LATERAL */}
      <div className="absolute right-4 top-20 w-72 space-y-4 z-40">

        {/* PANEL ORIGINAL DE INDEXACIÓN */}
        <FloatingCard className="p-4">
          <h1 className="text-sm font-medium text-fg">Indexar área</h1>
          {!drawnPolygon && !activeJobId && (
            <p className="mt-1 text-xs text-muted">Dibuja un polígono sobre el mapa para empezar.</p>
          )}

          {activeJobId ? (
            <div className="mt-4">
              <JobProgressBar />
            </div>
          ) : drawnPolygon ? (
            <div className="mt-4 space-y-3">
              {!estimate ? (
                <button
                  onClick={handleEstimate}
                  disabled={busy}
                  className="w-full rounded-md bg-elevated py-2 text-xs text-fg hover:bg-white/10"
                >
                  {busy ? "Calculando…" : "Estimar coste"}
                </button>
              ) : (
                <>
                  <div>
                    <div className="text-[11px] uppercase tracking-wide text-subtle">Coste estimado</div>
                    <div className="mt-1 text-2xl font-medium text-accent-fg">
                      ~${estimate.estimatedCostUsd.toFixed(2)}
                    </div>
                    
                    {usage && (
                      <div className="mt-2 text-[11px] text-subtle">
                        Presupuesto del mes: ${usage.monthlySpendUsd.toFixed(2)} / ${usage.monthlyBudgetUsd.toFixed(2)}
                      </div>
                    )}

                    <div className="mt-1 text-xs text-muted">
                      {estimate.pointsEstimated.toLocaleString()} puntos ·{" "}
                      {(estimate.pointsEstimated * 4).toLocaleString()} imágenes
                    </div>
                  </div>
                  <button
                    onClick={handleConfirm}
                    disabled={busy}
                    className="w-full rounded-md bg-accent py-2.5 text-xs font-medium text-black hover:brightness-110"
                  >
                    Indexar área
                  </button>
                </>
              )}
            </div>
          ) : null}

          {error && <p className="mt-3 text-xs text-danger-fg">{error}</p>}
        </FloatingCard>
      </div>
    </>
  );
}

function renderAreaOnMap(map: any, areaGeometry: any, pointsGeometry: any) {
  if (!map) return;

  if (map.getLayer("area-poly-line")) map.removeLayer("area-poly-line");
  if (map.getSource("area-poly")) map.removeSource("area-poly");
  if (map.getLayer("area-points-dots")) map.removeLayer("area-points-dots");
  if (map.getSource("area-points")) map.removeSource("area-points");

  map.addSource("area-poly", { type: "geojson", data: areaGeometry });
  map.addLayer({
    id: "area-poly-line",
    type: "line",
    source: "area-poly",
    paint: { "line-color": "#85b7eb", "line-width": 1.5 },
  });

  map.addSource("area-points", { type: "geojson", data: pointsGeometry });
  map.addLayer({
    id: "area-points-dots",
    type: "circle",
    source: "area-points",
    paint: { "circle-radius": 2.5, "circle-color": "#e8e8e6", "circle-opacity": 0.8 },
  });

  if (areaGeometry.coordinates && areaGeometry.coordinates[0]) {
    const coordinates = areaGeometry.coordinates[0];
    const bounds = coordinates.reduce((acc: any, coord: any) => {
      return [
        [Math.min(acc[0][0], coord[0]), Math.min(acc[0][1], coord[1])],
        [Math.max(acc[1][0], coord[0]), Math.max(acc[1][1], coord[1])],
      ];
    }, [[coordinates[0][0], coordinates[0][1]], [coordinates[0][0], coordinates[0][1]]]);

    map.fitBounds(bounds, { padding: 40, maxZoom: 15 });
  }
}