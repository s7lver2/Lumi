import { useEffect, useState } from "react";

import { IndexDetail } from "./catalog/IndexDetail";
import { IndexList } from "./catalog/IndexList";
import { IngestView } from "./ingest/IngestView";
import { api, type Saludo } from "./lib/api";
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

  useEffect(() => { void api.saludo().then(setSaludo); }, []);

  return (
    <WindowFrame>
      <div className="relative h-full w-full overflow-hidden bg-bg">
        {!dentro && <PlanetBackground />}
        <div className="relative flex h-full items-center justify-center">
          {saludo && !dentro && <SetupWizard saludo={saludo} onListo={() => setDentro(true)} />}
        </div>

        {dentro && (
          <div className="absolute inset-0">
            <Rail activo={destino} onIr={(d) => { setDestino(d); setIndiceAbierto(null); }} />
            <div className="absolute inset-y-0 left-11 right-0">
              {destino === "indices" && (
                indiceAbierto === null
                  ? <IndexList onAbrir={setIndiceAbierto} />
                  : <IndexDetail id={indiceAbierto} onVolver={() => setIndiceAbierto(null)} />
              )}
              {destino === "territorio" && <TerritoryView nombre="nuevo-indice" />}
              {destino === "ingesta" && <IngestView indiceId={indiceAbierto ?? 0} />}
              {destino === "ajustes" && (
                <p className="flex h-full items-center justify-center text-[13px] text-muted">
                  Sin ajustes propios todavía.
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </WindowFrame>
  );
}
