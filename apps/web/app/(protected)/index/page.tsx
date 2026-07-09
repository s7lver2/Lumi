// apps/web/app/(protected)/index/page.tsx
"use client";

import { useState, useEffect } from "react";
import { MapCanvas } from "../../components/MapCanvas";
import { IndexingDrawTool } from "../../components/IndexingDrawTool";
import { FloatingCard } from "../../components/FloatingCard";
import { JobProgressBar } from "../../components/JobProgressBar";
import { useIndexingStore } from "../../stores/useIndexingStore";

// 🛠️ IMPORTACIÓN TEMPORAL PARA LA VERIFICACIÓN DE DROPZONE
import { ImageDropzone } from "../../components/ImageDropzone";

export default function IndexPage() {
  const [map, setMap] = useState<any>(null);
  const { drawnPolygon, areaKm2, estimate, activeJobId, setEstimate, startJob } = useIndexingStore();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Estado para almacenar y controlar el límite de presupuesto consumido en el mes
  const [usage, setUsage] = useState<{ monthlySpendUsd: number; monthlyBudgetUsd: number } | null>(null);

  // Carga los datos de consumo al montar el componente
  useEffect(() => {
    fetch("/api/usage")
      .then((r) => r.json())
      .then(setUsage)
      .catch(() => setUsage(null));
  }, []);

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
  }

  return (
    <>
      <MapCanvas onReady={(m) => setMap(m)} />
      {map && <IndexingDrawTool map={map} />}

      {drawnPolygon && (
        <div className="absolute left-4 top-4">
          <FloatingCard className="px-3 py-2 text-xs text-fg">
            Área dibujada: {areaKm2.toFixed(1)} km²
          </FloatingCard>
        </div>
      )}

      {/* CONTENEDOR DE INTERFAZ LATERAL */}
      <div className="absolute right-4 top-4 w-72 space-y-4">
        
        {/* 🛠️ TARJETA SCRATCH TEMPORAL PARA COMPROBAR EL DROPZONE */}
        <FloatingCard className="p-4 border border-dashed border-accent/40">
          <h2 className="text-xs font-semibold text-accent-fg uppercase tracking-wider mb-2">
            Test: Image Dropzone
          </h2>
          <ImageDropzone 
            onImage={(file) => {
              console.log("📸 [Dropzone Event] Archivo recibido en la página:");
              console.log(`Nombre: ${file.name} | Tamaño: ${(file.size / 1024).toFixed(2)} KB`);
            }} 
          />
        </FloatingCard>

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
                    
                    {/* Línea de presupuesto renderizada dinámicamente debajo de la estimación */}
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