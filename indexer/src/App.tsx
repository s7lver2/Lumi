import { useEffect, useState } from "react";

import { IndexDetail } from "./catalog/IndexDetail";
import { IndexList } from "./catalog/IndexList";
import { DownloadView } from "./download/DownloadView";
import { IngestView } from "./ingest/IngestView";
import { api, type Saludo } from "./lib/api";
import { ReviewGrid } from "./review/ReviewGrid";
import { OriginsPanel } from "./settings/OriginsPanel";
import { ServicesPanel } from "./setup/ServicesPanel";
import { SetupWizard } from "./setup/SetupWizard";
import { TerritoryView } from "./territory/TerritoryView";
import { PlanetBackground } from "./ui/PlanetBackground";
import { Rail, type Destino } from "./ui/Rail";
import { WindowFrame } from "./ui/WindowFrame";

export function App() {
  const [saludo, setSaludo] = useState<Saludo | null>(null);
  const [dentro, setDentro] = useState(false);
  const [destino, setDestino] = useState<Destino>("indices");
  const [indiceAbierto, setIndiceAbierto] = useState<number | null>(null);
  const [pestana, setPestana] = useState<"servicios" | "origenes">("servicios");

  useEffect(() => { void api.saludo().then(setSaludo); }, []);

  // Al terminar la descarga se salta a revisión SOLO si hay algo que revisar:
  // una descarga de puro street view no tiene sueltas, y mandar al operador a
  // una rejilla vacía sería un paso de más.
  async function alTerminarDescarga() {
    const indiceId = indiceAbierto ?? 0;
    const pendientes = await api.revisionPendientes(indiceId);
    setDestino(pendientes.length > 0 ? "revision" : "indices");
  }

  return (
    <WindowFrame>
      <div className="relative h-full w-full overflow-hidden bg-bg">
        {!dentro && <PlanetBackground />}
        <div className="relative flex h-full items-center justify-center">
          {saludo && !dentro && <SetupWizard saludo={saludo} onListo={() => setDentro(true)} />}
        </div>

        {dentro && (
          <div className="absolute inset-0">
            <Rail activo={destino} onIr={(d) => { setDestino(d); if (d !== "descarga" && d !== "revision") setIndiceAbierto(null); }} />
            <div className="absolute inset-y-0 left-11 right-0">
              {destino === "indices" && (
                indiceAbierto === null
                  ? <IndexList onAbrir={setIndiceAbierto} />
                  : <IndexDetail id={indiceAbierto} onVolver={() => setIndiceAbierto(null)} />
              )}
              {destino === "territorio" && (
                <TerritoryView
                  nombre="nuevo-indice"
                  indiceId={indiceAbierto ?? undefined}
                  onDescargando={() => setDestino("descarga")}
                />
              )}
              {destino === "ingesta" && <IngestView indiceId={indiceAbierto ?? 0} />}
              {destino === "descarga" && <DownloadView onTerminado={() => void alTerminarDescarga()} />}
              {destino === "revision" && (
                <ReviewGrid indiceId={indiceAbierto ?? 0} onEmbeber={() => setDestino("indices")} />
              )}
              {destino === "ajustes" && saludo && (
                <div className="flex h-full flex-col">
                  <div className="flex shrink-0 gap-1 border-b border-border px-6 pt-4">
                    {(["servicios", "origenes"] as const).map((t) => (
                      <button
                        key={t}
                        onClick={() => setPestana(t)}
                        className={`rounded-t-lg px-3.5 py-2 text-[11.5px] transition-colors
                          ${pestana === t ? "bg-white/[.07] text-fg" : "text-subtle hover:text-fg"}`}
                      >
                        {t === "servicios" ? "Servicios locales" : "Orígenes de red"}
                      </button>
                    ))}
                  </div>
                  <div className="min-h-0 flex-1">
                    {pestana === "servicios" ? <ServicesPanel so={saludo.so} /> : <OriginsPanel />}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </WindowFrame>
  );
}
