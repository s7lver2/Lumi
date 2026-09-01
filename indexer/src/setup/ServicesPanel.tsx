import { useEffect, useRef, useState } from "react";

import { api, type EstadoServicio } from "../lib/api";
import { Icon } from "../ui/Icon";
import { LogBox } from "./LogBox";

/// Mismo tope que `ServicesBoot`/`ServicesStep`/`ServicesFailDialog`: 40 ×
/// 800 ms ≈ medio minuto.
const TOPE_SONDEOS = 40;

/** El estado de Redis y Qdrant desde dentro de la aplicación, para no tener
 *  que ir a buscarlos a una terminal.
 *
 *  La distinción que este panel existe para enseñar es PROPIO frente a
 *  ADOPTADO. Uno propio es un proceso hijo del Indexer: se puede parar desde
 *  aquí y muere al cerrar la aplicación. Uno adoptado ya estaba escuchando
 *  cuando llegamos —un servicio del sistema, una terminal, otra instancia— y
 *  no es nuestro para matarlo. Confundirlos es justamente cómo se acaba con un
 *  Qdrant huérfano ocupando el puerto sin que nadie sepa quién lo arrancó. */
export function ServicesPanel({ so }: { so: string }) {
  const [servicios, setServicios] = useState<EstadoServicio[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [enCurso, setEnCurso] = useState<null | "levantar" | "parar">(null);
  const [concurrencia, setConcurrencia] = useState<number | null>(null);
  const vivo = useRef(true);
  useEffect(() => { vivo.current = true; return () => { vivo.current = false; }; }, []);

  const refrescar = () => api.serviciosEstado().then(setServicios);

  useEffect(() => { void api.colaConcurrenciaLeer().then(setConcurrencia); }, []);

  async function cambiarConcurrencia(n: number) {
    setConcurrencia(n);
    await api.colaConcurrenciaFijar(n);
  }

  // Aquí sí se sondea de continuo, pero despacio y solo mientras el panel está
  // abierto: es una pantalla de vigilancia, no una espera.
  useEffect(() => {
    void refrescar();
    const t = setInterval(() => void refrescar(), 2000);
    return () => clearInterval(t);
  }, []);

  async function accion(cual: "levantar" | "parar") {
    setEnCurso(cual);
    setError(null);
    try {
      if (cual === "parar") {
        await api.serviciosParar();
        return;
      }
      await (so === "windows" ? api.serviciosArrancarWsl() : api.serviciosArrancar());
      // El comando resuelve en cuanto los procesos se LANZAN, no cuando ya
      // escuchan de verdad — sin sondear aquí, el botón se reactivaba antes
      // de que Qdrant/Redis estuvieran listos y parecía que hacía falta
      // pulsarlo otra vez, cuando el primer intento ya iba en camino. Mismo
      // patrón que `ServicesFailDialog`/`ServicesStep`.
      for (let n = 0; n < TOPE_SONDEOS; n++) {
        await new Promise((r) => setTimeout(r, 800));
        if (!vivo.current) return;
        const s = await api.serviciosEstado();
        if (s.length > 0 && s.every((x) => x.vivo)) return;
      }
      if (vivo.current) setError("Se lanzaron pero no llegaron a responder a tiempo. El log de abajo tiene el detalle.");
    } catch (e) {
      if (vivo.current) setError(String(e));
    } finally {
      if (vivo.current) {
        setEnCurso(null);
        void refrescar();
      }
    }
  }

  const alguno = servicios.some((s) => s.vivo);
  const todos = servicios.length > 0 && servicios.every((s) => s.vivo);

  return (
    <div className="h-full overflow-y-auto p-8">
      <div className="mx-auto max-w-xl">
        <p className="text-sm text-fg">Servicios locales</p>
        <p className="mt-[5px] text-[11px] leading-relaxed text-muted">
          Redis para la cola, Qdrant para los vectores. Los dos escuchan solo en{" "}
          <span className="font-mono text-fg">127.0.0.1</span>, nunca en la red.
        </p>

        <div className="mt-5 flex flex-col gap-px overflow-hidden rounded-card border border-border">
          {servicios.map((s) => (
            <div key={s.nombre} className="flex items-center gap-3 bg-panel px-4 py-3">
              <Icon
                name={s.vivo ? "check" : "alert"}
                size={13}
                className={s.vivo ? "text-fg" : "text-danger-fg"}
              />
              <span className="text-xs text-fg">{s.nombre}</span>
              {s.vivo && (
                <span
                  className={`rounded px-1.5 py-px font-mono text-[9.5px] ${
                    s.propio ? "bg-white/[.07] text-muted" : "bg-warning/20 text-warning-fg"
                  }`}
                  title={
                    s.propio
                      ? "Lo lanzó el Indexer: se para desde aquí y muere al cerrar la aplicación."
                      : "Ya estaba escuchando cuando arrancamos. No es nuestro, así que no lo matamos."
                  }
                >
                  {s.propio ? "propio" : "adoptado"}
                </span>
              )}
              <span
                className={`ml-auto truncate font-mono text-[10px] ${
                  s.vivo ? "text-subtle" : "text-danger-fg"
                }`}
              >
                {s.vivo ? s.detalle : "parado"}
              </span>
            </div>
          ))}
        </div>

        {/* Qdrant no tiene apagado por API: solo se le puede matar el proceso.
            Si es adoptado no hay proceso nuestro que matar, y prometer un
            botón que no va a funcionar es peor que decirlo. */}
        {servicios.some((s) => s.vivo && !s.propio) && (
          <p className="mt-2.5 text-[10.5px] leading-snug text-warning-fg">
            Lo marcado como <span className="font-mono">adoptado</span> no lo arrancamos nosotros:
            seguirá vivo al cerrar el Indexer y hay que pararlo donde se lanzó.
          </p>
        )}

        {error && (
          <p className="mt-2.5 whitespace-pre-wrap text-[11px] leading-relaxed text-danger-fg">
            {error}
          </p>
        )}

        <div className="mt-4 flex gap-2">
          <button
            onClick={() => void accion("levantar")}
            disabled={enCurso !== null || todos}
            className="jg-press rounded-lg border border-border px-3.5 py-2 text-[11.5px] text-fg disabled:opacity-40"
          >
            {enCurso === "levantar" ? "Levantando…" : so === "windows" ? "Levantar en WSL" : "Levantar"}
          </button>
          <button
            onClick={() => void accion("parar")}
            disabled={enCurso !== null || !alguno}
            className="jg-press rounded-lg border border-border px-3.5 py-2 text-[11.5px] text-fg disabled:opacity-40"
          >
            {enCurso === "parar" ? "Parando…" : "Parar"}
          </button>
        </div>

        <div className="mt-7 border-t border-border pt-5">
          <p className="text-sm text-fg">Concurrencia de embebido</p>
          <p className="mt-[5px] text-[11px] leading-relaxed text-muted">
            Cuántos modelos pueden tener pesos cargados en la GPU a la vez. Con una sola GPU,
            más de uno reparte la memoria en vez de sumarla — súbelo solo si te sobra VRAM.
          </p>
          <div className="mt-3 flex gap-2">
            {[1, 2].map((n) => (
              <button
                key={n}
                onClick={() => void cambiarConcurrencia(n)}
                disabled={concurrencia === null}
                className={`jg-press rounded-lg border px-3.5 py-2 text-[11.5px] disabled:opacity-40 ${
                  concurrencia === n ? "border-white/30 bg-white/[.08] text-fg" : "border-border text-fg"
                }`}
              >
                {n === 1 ? "1 · uno por uno" : "2 · como mucho"}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-5">
          <LogBox />
        </div>
      </div>
    </div>
  );
}
