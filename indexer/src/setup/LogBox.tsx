import { useEffect, useRef, useState } from "react";

import { api } from "../lib/api";

/** El log crudo, servido por offset como el runner del subsistema 1: la
 *  interfaz se engancha y se desengancha sin perder líneas. Son gigabytes y
 *  minutos de instalación; una barra sin log es mirar a ciegas. */
export function LogBox() {
  const [lineas, setLineas] = useState<string[]>([]);
  const fondo = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let vivo = true;
    let desde = 0;
    const tick = async () => {
      const nuevas = await api.serviciosLog(desde);
      if (!vivo || nuevas.length === 0) return;
      desde += nuevas.length;
      setLineas((v) => [...v, ...nuevas]);
    };
    void tick();
    const t = setInterval(() => void tick(), 500);
    return () => { vivo = false; clearInterval(t); };
  }, []);

  useEffect(() => { fondo.current?.scrollIntoView({ block: "end" }); }, [lineas]);

  return (
    <div className="mt-[15px] max-h-[132px] overflow-hidden rounded-lg border border-border bg-[#0b0d0f] px-3 py-2.5">
      {lineas.length === 0 && <p className="font-mono text-[10px] text-subtle">sin salida todavía</p>}
      {lineas.map((l, i) => (
        <p key={`${i}-${l}`} className="font-mono text-[10px] leading-[1.85] text-muted">{l}</p>
      ))}
      <div ref={fondo} />
    </div>
  );
}
