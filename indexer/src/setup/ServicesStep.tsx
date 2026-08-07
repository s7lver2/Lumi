import { useEffect, useState } from "react";

import { api, type EstadoServicio, type Saludo } from "../lib/api";
import { Icon } from "../ui/Icon";
import { LogBox } from "./LogBox";

/// Sondeos antes de darse por vencido: 40 × 800 ms ≈ medio minuto. Qdrant
/// abre su `/readyz` en un par de segundos y Redis responde al PING antes;
/// si en treinta no están, no van a estar.
const TOPE_SONDEOS = 40;

export function ServicesStep({ saludo, onListo }: { saludo: Saludo; onListo: () => void }) {
  const [servicios, setServicios] = useState<EstadoServicio[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [rendido, setRendido] = useState(false);
  const [intento, setIntento] = useState(0);

  // El sondeo TERMINA: al levantarse los dos, al agotar el tope, o si arrancar
  // ni siquiera pudo empezar. Antes no paraba nunca, así que en un equipo sin
  // Redis (Windows) la app se quedaba llamando a Qdrant una vez por segundo
  // hasta que la cerrabas, y el rótulo decía «arrancando» eternamente sobre
  // algo que ya se sabía que no iba a arrancar.
  useEffect(() => {
    let sondeos = 0;
    let t: ReturnType<typeof setInterval> | undefined;
    setRendido(false);
    setError(null);

    const sondear = () => api.serviciosEstado().then(setServicios);

    void api
      .serviciosArrancar()
      .then(() => {
        t = setInterval(() => {
          void api.serviciosEstado().then((s) => {
            setServicios(s);
            sondeos += 1;
            if (s.length > 0 && s.every((x) => x.vivo)) clearInterval(t);
            else if (sondeos >= TOPE_SONDEOS) {
              clearInterval(t);
              setRendido(true);
            }
          });
        }, 800);
      })
      .catch((e) => {
        // No hay nada que esperar: se pinta el estado una vez, para que se vea
        // cuál de los dos falta, y se para.
        setError(String(e));
        setRendido(true);
        void sondear();
      });

    return () => clearInterval(t);
  }, [intento]);

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
              name={s.vivo ? "check" : rendido ? "alert" : "refresh"}
              size={13}
              className={s.vivo ? "text-fg" : rendido ? "text-danger-fg" : "text-draw-fg"}
            />
            <span className="flex-1 text-xs text-fg">{s.nombre}</span>
            <span
              className={`font-mono text-[10px] ${
                s.vivo ? "text-subtle" : rendido ? "text-danger-fg" : "text-draw-fg"
              }`}
            >
              {s.vivo ? s.detalle : rendido ? "no arranca" : "arrancando"}
            </span>
          </div>
        ))}
      </div>

      <LogBox />

      {/* El aviso va aquí y no en un manual: es donde el operador se topa con
          el problema. Se calla si ya hay un error, porque en Windows el error
          dice literalmente lo mismo y además apunta al README: verlo dos veces
          seguidas en dos colores solo hace ruido. */}
      <div className={`mt-[13px] flex items-start gap-[7px] ${error ? "hidden" : ""}`}>
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
        <div className="flex items-center gap-2">
          {rendido && !todos && (
            <button
              onClick={() => setIntento((n) => n + 1)}
              className="jg-press rounded-lg border border-border px-3.5 py-2 text-[11.5px] text-fg"
            >
              Reintentar
            </button>
          )}
          <button
            onClick={onListo}
            disabled={!todos}
            className="jg-press rounded-lg bg-accent px-4 py-2 text-[11.5px] font-medium text-black disabled:opacity-40"
          >
            Continuar
          </button>
        </div>
      </div>
    </div>
  );
}
