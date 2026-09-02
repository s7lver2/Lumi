import { useEffect, useState } from "react";

import { api, type Saludo } from "../lib/api";
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

/** El hueco entre que la app ya sabe que el asistente inicial se completó una
 *  vez y que de verdad se puede entrar. Antes se saltaba directo: `lumid` no
 *  existe aquí, pero Redis y Qdrant sí, y son procesos hijos que MUEREN al
 *  cerrar el Indexer. Sin este paso, cada arranque tras el primero entraba
 *  con los dos servicios parados y ninguna pantalla lo decía — la cola de
 *  embebido simplemente no avanzaba nunca, en silencio.
 *
 *  En Windows se intenta DIRECTAMENTE `servicios_arrancar_wsl` (instala si
 *  falta, arranca dentro de WSL y adopta) en vez de `servicios_arrancar`
 *  —que en Windows se niega siempre por diseño, sin tocar WSL—: la versión
 *  anterior exigía ir a Ajustes a pulsar "Levantar en WSL" a mano en cada
 *  sesión, que es justo la fricción que hacía parecer que esto "no arrancaba
 *  nunca solo". El coste es que la primera vez puede tardar minutos
 *  (instala Redis y el binario de Qdrant dentro de la distribución).
 *
 *  Mismo vocabulario que `Booting`: brandline ✦, sin tarjeta de cristal. */
export function ServicesBoot({ saludo, onListo, onFallo }: {
  saludo: Saludo;
  onListo: () => void;
  onFallo: (mensaje: string) => void;
}) {
  const [instalando, setInstalando] = useState(false);
  const enWindows = saludo.so === "windows";

  useEffect(() => {
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
              onListo();
            } else if (++n >= TOPE_SONDEOS) {
              clearInterval(sondeo);
              // El detalle de CADA servicio, no un genérico: es el error real de
              // socket/HTTP que ya calcula `Servicios::estado`, y es lo primero
              // que hace falta para saber si es "no arrancó" o "arrancó pero no
              // en el puerto esperado".
              const detalle = s.map((x) => `${x.nombre}: ${x.detalle}`).join("\n");
              onFallo(`Redis y Qdrant no respondieron a tiempo.\n${detalle}`);
            }
          });
        }, 800);
      })
      .catch((e) => { if (vivo) { setInstalando(false); onFallo(String(e)); } });

    return () => { vivo = false; clearInterval(sondeo); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="relative z-10 flex w-[552px] flex-col items-center gap-1.5" style={{ animation: "jg-fade-rise .7s both" }}>
      <div className="flex items-center gap-2.5">
        <span className="text-[15px] text-fg">✦</span>
        <span className="text-[17px] font-medium text-fg">Lumi Indexer</span>
        <Icon name="refresh" size={13} className="ml-1 text-subtle" />
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
        // de un spinner mudo durante hasta 5 minutos, se ve en qué fase real
        // va (instalando redis / bajando qdrant / arrancando) — la señal de
        // que sigue avanzando y no está colgado.
        <div className="w-full">
          <LogBox />
        </div>
      )}
    </div>
  );
}
