import { useEffect, useState } from "react";

import { api } from "../lib/api";
import { Icon } from "../ui/Icon";
import { LogBox } from "./LogBox";

export function RuntimeStep({ onListo }: { onListo: () => void }) {
  const [listo, setListo] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api.runtimeListo().then((l) => {
      if (l) { setListo(true); return; }
      void api.runtimeInstalar().then(() => setListo(true)).catch((e) => setError(String(e)));
    });
  }, []);

  return (
    <div className="rounded-card border border-white/[.13] bg-[rgba(16,19,25,.66)] p-[20px_22px] backdrop-blur-xl">
      <p className="text-sm text-fg">Instalando el runtime</p>
      <p className="mt-[5px] text-[11px] leading-relaxed text-muted">
        Un entorno de Python con torch. Son varios gigabytes: puedes cerrar la ventana, se retoma solo.
      </p>
      <div className="mt-4 flex items-center gap-2.5">
        <Icon name={listo ? "check" : "refresh"} size={13} className={listo ? "text-fg" : "text-draw-fg"} />
        <span className="flex-1 text-xs text-fg">venv + torch</span>
        <span className={`font-mono text-[10px] ${listo ? "text-subtle" : "text-draw-fg"}`}>
          {listo ? "instalado" : "descargando"}
        </span>
      </div>
      <LogBox />
      {error && <p className="mt-2.5 text-[11px] text-danger-fg">{error}</p>}
      <div className="mt-[17px] flex justify-end">
        <button onClick={onListo} disabled={!listo}
          className="jg-press rounded-lg bg-accent px-4 py-2 text-[11.5px] font-medium text-black disabled:opacity-40">
          Continuar
        </button>
      </div>
    </div>
  );
}
