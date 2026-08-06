import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";

import { PlanetBackground } from "./ui/PlanetBackground";
import { WindowFrame } from "./ui/WindowFrame";

interface Saludo { version: string; so: string; dir: string }

export function App() {
  const [saludo, setSaludo] = useState<Saludo | null>(null);
  useEffect(() => { void invoke<Saludo>("saludo").then(setSaludo); }, []);

  return (
    <WindowFrame>
      <div className="relative h-full w-full overflow-hidden bg-bg">
        <PlanetBackground />
        <div className="relative z-10 flex h-full items-center justify-center">
          <div className="flex items-center gap-2.5" style={{ animation: "jg-fade-rise .7s both" }}>
            <span className="text-fg">✦</span>
            <span className="text-[17px] font-medium text-fg">Lumi Indexer</span>
            <span className="font-mono text-[9.5px] text-subtle">
              {saludo ? `v${saludo.version} · ${saludo.so} · ${saludo.dir}` : "…"}
            </span>
          </div>
        </div>
      </div>
    </WindowFrame>
  );
}
