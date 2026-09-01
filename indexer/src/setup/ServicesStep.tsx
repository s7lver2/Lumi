import { useEffect, useState } from "react";

import { api, type EstadoServicio, type Saludo } from "../lib/api";
import { Icon } from "../ui/Icon";
import { LogBox } from "./LogBox";

/// Sondeos antes de darse por vencido. Qdrant abre su `/readyz` en un par de
/// segundos y Redis responde al PING antes; el tope solo importa para el
/// arranque en frío de WSL.
// 90 × 800ms ≈ 72s: el arranque en frío de WSL (VM parada) más qdrant
// cargando su almacén puede superar el medio minuto anterior en máquinas
// lentas — el margen sube, el sondeo sigue siendo el mismo mecanismo.
const TOPE_SONDEOS = 90;

export function ServicesStep({ saludo, onListo }: { saludo: Saludo; onListo: () => void }) {
  const [servicios, setServicios] = useState<EstadoServicio[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [rendido, setRendido] = useState(false);
  const [intento, setIntento] = useState(0);
  const [enCurso, setEnCurso] = useState(false);

  // El sondeo TERMINA: al levantarse los dos, al agotar el tope, o si arrancar
  // ni siquiera pudo empezar. Antes no paraba nunca, así que en un equipo sin
  // Redis (Windows) la app se quedaba llamando a Qdrant una vez por segundo
  // hasta que la cerrabas, y el rótulo decía «arrancando» eternamente sobre
  // algo que ya se sabía que no iba a arrancar.
  useEffect(() => {
    let t: ReturnType<typeof setInterval> | undefined;
    setRendido(false);
    setError(null);

    // `arrancar` en Windows se niega si falta alguno, y con razón: levantar
    // procesos en la distribución de alguien se pide, no se hace al abrir.
    // Ahí es donde entra el botón.
    void api
      .serviciosArrancar()
      .then(() => { t = sondear(); })
      .catch((e) => {
        setError(String(e));
        setRendido(true);
        void api.serviciosEstado().then(setServicios);
      });

    return () => clearInterval(t);
  }, [intento]);

  /// Sondea hasta que los dos estén vivos o se agote el tope. Devuelve el
  /// intervalo para poder cancelarlo al desmontar.
  function sondear() {
    let n = 0;
    const t = setInterval(() => {
      void api.serviciosEstado().then((s) => {
        setServicios(s);
        n += 1;
        if (s.length > 0 && s.every((x) => x.vivo)) clearInterval(t);
        else if (n >= TOPE_SONDEOS) {
          clearInterval(t);
          setRendido(true);
        }
      });
    }, 800);
    return t;
  }

  function levantarEnWsl() {
    setEnCurso(true);
    setError(null);
    setRendido(false);
    api
      .serviciosArrancarWsl()
      .then(() => {
        setEnCurso(false);
        // Se sondea aquí en vez de reiniciar el efecto: los servicios recién
        // lanzados tardan un par de segundos en escuchar, y volver a llamar a
        // `arrancar` en ese hueco se encontraría el puerto todavía vacío y
        // fallaría por una carrera.
        sondear();
      })
      .catch((e) => {
        setEnCurso(false);
        setError(String(e));
        setRendido(true);
      });
  }

  const todos = servicios.length > 0 && servicios.every((s) => s.vivo);
  const enWindows = saludo.so === "windows";

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

      {/* `whitespace-pre-wrap`: el error de Windows trae los dos comandos de
          WSL en sus propias líneas, y sin esto se aplastan en un párrafo del
          que no se puede copiar ninguno. */}
      {error && (
        <p className="mt-2.5 whitespace-pre-wrap text-[11px] leading-relaxed text-danger-fg">
          {error}
        </p>
      )}

      {/* La primera vez esto baja paquetes y un binario: puede tardar minutos.
          Decirlo evita que se lea como colgado y que se cierre a mitad. */}
      {enCurso && (
        <p className="mt-2.5 text-[11px] leading-relaxed text-draw-fg">
          Instalando y levantando dentro de WSL. La primera vez baja Redis de los repositorios de
          la distribución y el binario oficial de Qdrant, así que puede tardar unos minutos; el
          detalle va saliendo arriba.
        </p>
      )}

      <div className="mt-[17px] flex items-center justify-between">
        <span className="font-mono text-[9.5px] text-subtle">puedes cerrar: se retoma solo</span>
        <div className="flex items-center gap-2">
          {enWindows && !todos && (
            <button
              onClick={levantarEnWsl}
              disabled={enCurso}
              className="jg-press rounded-lg border border-border px-3.5 py-2 text-[11.5px] text-fg disabled:opacity-40"
            >
              {enCurso ? "Levantando en WSL…" : "Levantar en WSL"}
            </button>
          )}
          {rendido && !todos && !enCurso && (
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
