import { useEffect, useRef, useState } from "react";

import { api, type Diagnostico } from "../lib/api";
import { Icon } from "../ui/Icon";
import { LogBox } from "./LogBox";

/// Mismo tope que `ServicesBoot`/`ServicesStep`.
// 90 × 800ms ≈ 72s: el arranque en frío de WSL (VM parada) más qdrant
// cargando su almacén puede superar el medio minuto anterior en máquinas
// lentas — el margen sube, el sondeo sigue siendo el mismo mecanismo.
const TOPE_SONDEOS = 90;

/** El popup cuando Redis y/o Qdrant no arrancaron solos al abrir la app.
 *  Misma composición que los estados anómalos de Lumi (DESIGN.md):
 *  icono grande centrado con halo, título corto, una línea de contexto, el
 *  detalle crudo, fila de botones.
 *
 *  En Windows «Levantar en WSL» vive AQUÍ, no solo en Ajustes: obligar a
 *  salir del popup, encontrar la pestaña de Servicios y pulsar el mismo
 *  botón desde otro sitio era la fricción que hacía parecer que esto "seguía
 *  sin arrancar" cuando en realidad solo faltaba pulsar el único botón que
 *  de verdad lanza algo en Windows — `servicios_arrancar` (lo que prueba
 *  `ServicesBoot`) se niega a tocar WSL sin este consentimiento explícito.
 *
 *  El diagnóstico de abajo (`servicios_diagnostico`) y el log crudo son lo
 *  que evita el «no sé por qué no arranca»: sin ellos, el único rastro de un
 *  `bail!` sin proceso hijo de por medio era este mismo mensaje, y nada más
 *  quedaba para pegar en un informe de fallo. */
export function ServicesFailDialog({ mensaje, onListo, onReintentar, onAjustes }: {
  mensaje: string;
  onListo: () => void;
  onReintentar: () => void;
  onAjustes: () => void;
}) {
  const [diag, setDiag] = useState<Diagnostico | null>(null);
  const [levantando, setLevantando] = useState(false);
  const [errorWsl, setErrorWsl] = useState<string | null>(null);
  const vivo = useRef(true);

  useEffect(() => {
    vivo.current = true;
    void api.serviciosDiagnostico().then(setDiag);
    return () => { vivo.current = false; };
  }, [mensaje]);

  async function levantarEnWsl() {
    setLevantando(true);
    setErrorWsl(null);
    try {
      await api.serviciosArrancarWsl();
      // Los servicios recién lanzados en WSL tardan un par de segundos en
      // escuchar: se sondea aquí en vez de asumir que ya están listos, igual
      // que hace `ServicesBoot` con el arranque nativo.
      for (let n = 0; n < TOPE_SONDEOS; n++) {
        await new Promise((r) => setTimeout(r, 800));
        if (!vivo.current) return;
        const s = await api.serviciosEstado();
        if (s.length > 0 && s.every((x) => x.vivo)) { onListo(); return; }
      }
      if (vivo.current) setErrorWsl("Se lanzaron pero no llegaron a responder a tiempo. El log de abajo tiene el detalle.");
    } catch (e) {
      if (vivo.current) setErrorWsl(String(e));
    } finally {
      if (vivo.current) {
        setLevantando(false);
        void api.serviciosDiagnostico().then(setDiag);
      }
    }
  }

  const enWindows = diag?.so === "windows";

  return (
    <div className="relative z-10 w-[552px] rounded-card border border-white/[.13] bg-[rgba(16,19,25,.66)]
      p-[24px_26px] shadow-lg shadow-black/40 backdrop-blur-xl" style={{ animation: "jg-fade-rise .7s both" }}>
      <div className="relative mx-auto grid h-14 w-14 place-items-center">
        <span className="absolute inset-0 rounded-full bg-danger/[.14]" style={{ filter: "blur(18px)" }} />
        <Icon name="alert" size={32} className="relative text-danger-fg" />
      </div>
      <p className="mt-3 text-center text-sm text-fg">Los servicios locales no arrancaron</p>
      <p className="mt-1.5 text-center text-[11px] leading-relaxed text-muted">
        El Indexer necesita Redis y Qdrant vivos para trabajar.{" "}
        {enWindows
          ? "Ninguno publica binario oficial para Windows: van dentro de WSL."
          : "Se puede reintentar, o resolverlo a mano desde Ajustes."}
      </p>

      <p className="mt-4 whitespace-pre-wrap rounded-lg border border-border bg-[#0b0d0f] px-3 py-2.5
        text-[11px] leading-relaxed text-danger-fg">
        {mensaje}
      </p>

      {diag && (
        <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 rounded-lg border border-border px-3 py-2.5
          font-mono text-[10px] text-muted">
          <Fila etiqueta="SO" valor={diag.so} />
          <Fila etiqueta="redis-server en PATH" valor={diag.redis_en_path ? "sí" : "no"} />
          <Fila etiqueta="qdrant en PATH" valor={diag.qdrant_en_path ? "sí" : "no"} />
          {diag.wsl_responde !== null && (
            <Fila etiqueta="wsl.exe responde" valor={diag.wsl_responde ? "sí" : "no"} />
          )}
          <Fila etiqueta={`Redis :${diag.redis_puerto}`} valor={diag.estado.find((s) => s.nombre === "Redis")?.detalle ?? "—"} />
          <Fila etiqueta={`Qdrant :${diag.qdrant_puerto}`} valor={diag.estado.find((s) => s.nombre === "Qdrant")?.detalle ?? "—"} />
        </div>
      )}

      {enWindows && diag?.wsl_responde === false && (
        <p className="mt-3 text-[10.5px] leading-snug text-warning-fg">
          <code className="font-mono">wsl.exe</code> no respondió: WSL no parece estar instalado o
          habilitado en este equipo. «Levantar en WSL» no puede funcionar sin eso — instálalo
          primero (<code className="font-mono">wsl --install</code> desde PowerShell como
          administrador) y reinicia.
        </p>
      )}

      {levantando && (
        <p className="mt-3 text-[11px] leading-relaxed text-draw-fg">
          Levantando dentro de WSL. La primera vez baja Redis de los repositorios de la
          distribución y el binario oficial de Qdrant, así que puede tardar unos minutos; el
          detalle va saliendo abajo.
        </p>
      )}
      {errorWsl && (
        <p className="mt-3 whitespace-pre-wrap text-[11px] leading-relaxed text-danger-fg">{errorWsl}</p>
      )}

      <LogBox />

      <div className="mt-5 flex items-center justify-between">
        <button onClick={onAjustes} className="text-[10.5px] text-subtle hover:text-fg">
          Ir a Ajustes en su lugar
        </button>
        <div className="flex gap-2">
          {enWindows ? (
            <button
              onClick={() => void levantarEnWsl()}
              disabled={levantando || diag?.wsl_responde === false}
              className="jg-press rounded-lg bg-accent px-4 py-2 text-[11.5px] font-medium text-black disabled:opacity-40"
            >
              {levantando ? "Levantando en WSL…" : "Levantar en WSL"}
            </button>
          ) : (
            <button onClick={onReintentar}
              className="jg-press rounded-lg bg-accent px-4 py-2 text-[11.5px] font-medium text-black">
              Reintentar
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Fila({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <div className="flex items-baseline gap-1.5 truncate">
      <span className="shrink-0 text-subtle">{etiqueta}:</span>
      <span className="truncate text-fg">{valor}</span>
    </div>
  );
}
