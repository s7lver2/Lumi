import { useEffect, useState } from "react";

import { api, type Saludo } from "./lib/api";
import { SetupWizard } from "./setup/SetupWizard";
import { PlanetBackground } from "./ui/PlanetBackground";
import { WindowFrame } from "./ui/WindowFrame";

export function App() {
  const [saludo, setSaludo] = useState<Saludo | null>(null);
  const [dentro, setDentro] = useState(false);

  useEffect(() => { void api.saludo().then(setSaludo); }, []);

  return (
    <WindowFrame>
      <div className="relative h-full w-full overflow-hidden bg-bg">
        {!dentro && <PlanetBackground />}
        <div className="relative flex h-full items-center justify-center">
          {saludo && !dentro && <SetupWizard saludo={saludo} onListo={() => setDentro(true)} />}
          {dentro && <p className="text-[13px] text-muted">El catálogo llega en la tarea 14.</p>}
        </div>
      </div>
    </WindowFrame>
  );
}
