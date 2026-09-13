import { useCallback, useEffect, useState } from "react";

import { api } from "../lib/api";
import { Icon } from "../ui/Icon";
import { LogBox } from "./LogBox";

/** Sondeos antes de darse por vencido. Qdrant abre su `/readyz` en un par de
 *  segundos y Redis responde al PING antes; el tope solo importa para el
 *  arranque en frío de WSL. Mismo tope que `ServicesStep`. */
// 375 × 800ms ≈ 5min: un arranque en frío de WSL (VM parada tras ~8 min de
// inactividad o tras reiniciar Windows) suma `apt-get update` + instalar
// Redis + bajar el binario de Qdrant, y eso de sobra supera los 72s
// anteriores la primera vez. No se distingue "primera vez" de "ya instalado"
// aquí (más simple, ponytail): un arranque ya instalado sigue resolviendo en
// segundos, así que el margen generoso no cuesta nada salvo en el caso de
// fallo real, que ahora tarda más en avisar.
const TOPE_SONDEOS = 375;

export type EstadoServicios = "arrancando" | "vivo" | "fallo";

export type Servicios = {
  estado: EstadoServicios;
  /// El error real de cada servicio cuando `estado` es `fallo`. Es el detalle
  /// de socket/HTTP que ya calcula `Servicios::estado`, no un genérico.
  detalle: string | null;
  /// Solo en Windows y solo mientras la primera instalación dentro de WSL
  /// sigue en marcha: es lo que justifica que esto pueda tardar minutos.
  instalando: boolean;
  reintentar: () => void;
};

/** Levanta Redis y Qdrant y sondea hasta que responden, **sin bloquear a
 *  nadie**. Antes esto era un portón: `ServicesBoot` no dejaba entrar a la
 *  aplicación hasta que los dos respondían, con un tope de cinco minutos. Pero
 *  los dos servicios los necesita SOLO la cola de embebido — revisar imágenes,
 *  mirar el catálogo, dibujar territorio, descargar y publicar no los tocan.
 *  El operador esperaba por infraestructura que la pantalla a la que iba no iba
 *  a usar, y con los vectores en un disco mecánico esa espera podía ser de
 *  verdad larga.
 *
 *  Ahora corre de fondo desde que se entra, su estado se publica como un punto
 *  en el carril, y solo la pantalla de embebido exige que esté vivo.
 *
 *  En Windows se intenta DIRECTAMENTE `servicios_arrancar_wsl` (instala si
 *  falta, arranca dentro de WSL y adopta) en vez de `servicios_arrancar` —que
 *  en Windows se niega siempre por diseño, sin tocar WSL—: la versión anterior
 *  exigía ir a Ajustes a pulsar "Levantar en WSL" a mano en cada sesión. */
export function useServicios(activo: boolean, enWindows: boolean): Servicios {
  const [estado, setEstado] = useState<EstadoServicios>("arrancando");
  const [detalle, setDetalle] = useState<string | null>(null);
  const [instalando, setInstalando] = useState(false);
  const [intento, setIntento] = useState(0);

  const reintentar = useCallback(() => {
    setEstado("arrancando");
    setDetalle(null);
    setIntento((n) => n + 1);
  }, []);

  useEffect(() => {
    if (!activo) return;
    let vivo = true;
    let sondeo: ReturnType<typeof setInterval> | undefined;

    if (enWindows) setInstalando(true);
    const arranque = enWindows ? api.serviciosArrancarWsl() : api.serviciosArrancar();

    void arranque
      .then(() => {
        if (vivo) setInstalando(false);
        let n = 0;
        sondeo = setInterval(() => {
          void api.serviciosEstado().then((s) => {
            if (!vivo) return;
            if (s.length > 0 && s.every((x) => x.vivo)) {
              clearInterval(sondeo);
              setEstado("vivo");
            } else if (++n >= TOPE_SONDEOS) {
              clearInterval(sondeo);
              const porServicio = s.map((x) => `${x.nombre}: ${x.detalle}`).join("\n");
              setDetalle(`Redis y Qdrant no respondieron a tiempo.\n${porServicio}`);
              setEstado("fallo");
            }
          });
        }, 800);
      })
      .catch((e) => {
        if (!vivo) return;
        setInstalando(false);
        setDetalle(String(e));
        setEstado("fallo");
      });

    return () => { vivo = false; clearInterval(sondeo); };
  }, [activo, enWindows, intento]);

  return { estado, detalle, instalando, reintentar };
}

/** Lo que se enseña mientras los servicios siguen levantándose. Ya no es una
 *  pantalla completa que tapa la aplicación: se pinta donde iría la rejilla de
 *  progreso del embebido, que es la única pantalla que los necesita.
 *
 *  Mismo vocabulario que `Booting`: brandline ✦, sin tarjeta de cristal. */
export function ServiciosArrancando({ enWindows, instalando }: {
  enWindows: boolean;
  instalando: boolean;
}) {
  return (
    <div className="flex flex-col items-center gap-1.5" style={{ animation: "jg-fade-rise .7s both" }}>
      <div className="flex items-center gap-2.5">
        <Icon name="refresh" size={13} className="text-subtle" />
        <span className="text-[11px] text-subtle">
          {enWindows ? "levantando Redis y Qdrant dentro de WSL…" : "levantando Redis y Qdrant…"}
        </span>
      </div>
      {instalando && enWindows && (
        <p className="max-w-[420px] text-center text-[10.5px] leading-relaxed text-subtle">
          La primera vez instala Redis y el binario de Qdrant dentro de la distribución: puede
          tardar unos minutos. Los arranques siguientes son instantáneos.
        </p>
      )}
      {enWindows && (
        // Mismo `servicios_log` que ya alimenta `ServicesFailDialog`: en vez
        // de un spinner mudo, se ve en qué fase real va (instalando redis /
        // bajando qdrant / arrancando) — la señal de que sigue avanzando.
        <div className="w-full">
          <LogBox />
        </div>
      )}
    </div>
  );
}
