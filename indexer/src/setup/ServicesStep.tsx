import { useEffect, useState } from "react";

import { api, type EstadoServicio, type Saludo } from "../lib/api";
import { Icon } from "../ui/Icon";
import { LogBox } from "./LogBox";

export function ServicesStep({ saludo, onListo }: { saludo: Saludo; onListo: () => void }) {
  const [servicios, setServicios] = useState<EstadoServicio[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api.serviciosArrancar().catch((e) => setError(String(e)));
    const t = setInterval(() => { void api.serviciosEstado().then(setServicios); }, 800);
    return () => clearInterval(t);
  }, []);

  const todos = servicios.length > 0 && servicios.every((s) => s.vivo);

  return (
    <div className="rounded-card border border-white/[.13] bg-[rgba(16,19,25,.66)] p-[20px_22px] shadow-lg shadow-black/40 backdrop-blur-xl">
      <p className="text-sm text-fg">Levantando los servicios locales</p>
      <p className="mt-[5px] text-[11px] leading-relaxed text-muted">
        Redis para la cola, Qdrant para los vectores. Los dos escuchan solo en{" "}
        <span className="font-mono text-fg">127.0.0.1</span>, nunca en la red.
      </p>

      <div className="mt-4 flex flex-col gap-2">
        {servicios.map((s) => (
          <div key={s.nombre} className="flex items-center gap-2.5">
            <Icon
              name={s.vivo ? "check" : "refresh"}
              size={13}
              className={s.vivo ? "text-fg" : "text-draw-fg"}
            />
            <span className="flex-1 text-xs text-fg">{s.nombre}</span>
            <span className={`font-mono text-[10px] ${s.vivo ? "text-subtle" : "text-draw-fg"}`}>
              {s.vivo ? s.detalle : "arrancando"}
            </span>
          </div>
        ))}
      </div>

      <LogBox />

      {/* El aviso va aquí y no en un manual: es donde el operador se topa con
          el problema. */}
      <div className="mt-[13px] flex items-start gap-[7px]">
        <Icon name="alert" size={12} className="mt-px shrink-0 text-warning-fg" />
        <span className="text-[10.5px] leading-snug text-warning-fg">
          Redis no publica binarios oficiales para Windows. Este equipo es{" "}
          <span className="font-mono">{saludo.so}</span>
          {saludo.so === "windows"
            ? ", así que el Indexer tiene que instalarse dentro de WSL."
            : ", así que corre nativo."}
        </span>
      </div>

      {error && <p className="mt-2.5 text-[11px] text-danger-fg">{error}</p>}

      <div className="mt-[17px] flex items-center justify-between">
        <span className="font-mono text-[9.5px] text-subtle">puedes cerrar: se retoma solo</span>
        <button
          onClick={onListo}
          disabled={!todos}
          className="jg-press rounded-lg bg-accent px-4 py-2 text-[11.5px] font-medium text-black disabled:opacity-40"
        >
          Continuar
        </button>
      </div>
    </div>
  );
}
