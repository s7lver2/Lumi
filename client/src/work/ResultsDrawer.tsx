import { useEffect, useState } from "react";
import { lumiUrl } from "../lib/bridge";
import type { Analysis, Hipotesis, Image } from "../lib/api";
import { Drawer } from "./Drawer";
import { Icon } from "../ui/Icon";
import { CompareSlider } from "../ui/CompareSlider";

/** Metros entre dos coordenadas. Haversine con el radio medio de la Tierra:
 *  precisión de sobra para decir «el EXIF declara un GPS a 300 m de aquí». */
export function metersBetween(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(bLat - aLat);
  const dLng = rad(bLng - aLng);
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** La principal, con la misma forma que una alternativa — así una lista y un
 *  selector no necesitan dos caminos distintos para tratarlas. */
function principalComoHipotesis(a: Analysis): Hipotesis | null {
  if (a.state !== "hecho" || a.result_lat == null || a.result_lng == null) return null;
  return {
    lat: a.result_lat, lng: a.result_lng, radio_m: a.result_radius_m ?? 0,
    peso: a.result_confidence ?? 0, indice: "", autor: "",
    imagen_id: a.result_imagen_id,
    inliers: a.result_inliers, verificador: a.result_verificador,
    motivo_agente: null,
  };
}

const ETIQUETA_FASE: Record<string, string> = {
  embebiendo: "Calculando el vector de la imagen…",
  recuperando: "Buscando candidatos en el índice…",
  verificando: "Verificando geometría…",
};

/** Fase, ETA y posición en cola (spec de feedback de progreso: "fases del
 *  pipeline", "tiempo estimado" y "cuánta gente hay por delante"), en el
 *  cajón y no flotando sobre el mapa — es la misma información, pero ahí se
 *  perdía en cuanto el cajón de resultados tapaba el globo. `posicion` es
 *  0-based (0 = el siguiente); `etaS` puede llegar como `null` mientras el
 *  servidor todavía no tiene ninguna muestra con la que estimar. */
function FaseProgreso({ progreso }: {
  progreso: { fase?: string; etaS?: number | null; posicion?: number };
}) {
  const etiqueta = progreso.fase ? (ETIQUETA_FASE[progreso.fase] ?? "Procesando…") : null;
  const eta = progreso.etaS == null
    ? null
    : progreso.etaS < 60 ? `~${Math.max(1, Math.round(progreso.etaS))}s` : `~${Math.round(progreso.etaS / 60)}min`;
  return (
    <div className="flex flex-col gap-1 text-[11.5px] text-muted">
      <p>{etiqueta ?? "esperando al motor"}</p>
      {progreso.fase && (
        <p className="font-mono text-[10px] text-subtle">
          {eta ? `${eta} restante` : "aún sin estimación de tiempo"}
        </p>
      )}
      {progreso.posicion != null && (
        <p className="text-[10px] text-subtle">
          {progreso.posicion === 0 ? "el siguiente en correr" : `${progreso.posicion} por delante`}
        </p>
      )}
    </div>
  );
}

/** Insignia de verificación: SIEMPRE en `fg`/blanco, nunca verde — DESIGN.md
 *  lo prohíbe ("Completado se representa en blanco"). */
function InsigniaVerificacion({ h }: { h: Hipotesis }) {
  return (
    <div className="flex items-center gap-1.5 border-t border-border pt-2.5">
      {h.verificador ? (
        <>
          <Icon name="check" size={12} className="text-fg" />
          <span className="text-[10.5px] text-fg">
            verificado por {h.verificador} ·{" "}
            <span className="font-mono tabular-nums">{h.inliers}</span> correspondencias
          </span>
        </>
      ) : (
        <span className="text-[10.5px] text-subtle">sin verificación geométrica · coordenada de recuperación</span>
      )}
    </div>
  );
}

/** La mayor coincidencia, con tu foto y la de referencia lado a lado en un
 *  comparador arrastrable — o solo sus coordenadas si esta hipótesis no
 *  trae foto de referencia (motor que resolvió por su cuenta, o un análisis
 *  de antes de que este campo existiera). Clicable: lleva a la vista
 *  Detalle de la principal. */
function TarjetaPrincipal({ principal, image, onAbrir }: {
  principal: Hipotesis; image: Image | null; onAbrir: () => void;
}) {
  return (
    <div className="flex w-full flex-col gap-2.5 rounded-[10px] border border-border p-3">
      {principal.imagen_id != null && image ? (
        <CompareSlider
          izquierda={lumiUrl(`/v1/images/${image.id}/thumb`)}
          derecha={lumiUrl(`/v1/reference-images/${principal.imagen_id}/thumb`)}
          etiquetaIzquierda="tuya" etiquetaDerecha="referencia" />
      ) : null}
      {/* Antes el `<button>` envolvía TAMBIÉN el comparador de arriba: soltar
          el arrastre encima de él (un pointerdown+pointerup sin apenas
          moverse) contaba como clic y saltaba al detalle sin querer, a media
          comparación. Ahora solo el texto de abajo es lo que lleva ahí. */}
      <button onClick={onAbrir} className="flex flex-col gap-2.5 rounded-lg text-left
        transition-colors duration-300 ease-expo hover:text-fg">
        <div className="font-mono text-[18px] leading-none text-fg">
          {principal.lat.toFixed(4)}, {principal.lng.toFixed(4)}
        </div>
        <div className="flex gap-4">
          <div>
            <div className="text-[8px] uppercase tracking-[.08em] text-subtle">Radio</div>
            <div className="mt-0.5 font-mono text-[12.5px] text-fg">± {Math.round(principal.radio_m)} m</div>
          </div>
          <div>
            <div className="text-[8px] uppercase tracking-[.08em] text-subtle">Confianza</div>
            <div className="mt-0.5 font-mono text-[12.5px] text-fg">{principal.peso.toFixed(1)}×</div>
          </div>
        </div>
        <InsigniaVerificacion h={principal} />
      </button>
    </div>
  );
}

/** Las alternativas, compactas — cada una lleva a su propia vista Detalle. */
function ListaAlternativas({ alternativas, maxPeso, onAbrir }: {
  alternativas: Hipotesis[]; maxPeso: number; onAbrir: (i: number) => void;
}) {
  if (alternativas.length === 0) return null;
  return (
    <div className="flex flex-col gap-1.5 border-t border-border pt-2.5">
      <p className="text-[8px] uppercase tracking-[.08em] text-subtle">Alternativas</p>
      {alternativas.map((h, i) => (
        <button key={i} onClick={() => onAbrir(i)}
          className="flex items-center gap-2 rounded-lg px-1.5 py-1 text-left transition-colors
            duration-300 ease-expo hover:bg-white/[.04]">
          <span className="w-3 shrink-0 font-mono text-[9px] text-subtle">{i + 2}</span>
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-1.5">
              <span className="font-mono text-[10px] text-fg">{h.lat.toFixed(4)}, {h.lng.toFixed(4)}</span>
              <span className="font-mono text-[9px] text-subtle">± {Math.round(h.radio_m)} m</span>
            </div>
            <div className="mt-1 h-[3px] overflow-hidden rounded-full bg-white/[.06]">
              <div className="h-full bg-white/40" style={{ width: `${Math.max(6, (h.peso / maxPeso) * 100)}%` }} />
            </div>
          </div>
        </button>
      ))}
    </div>
  );
}

/** Una hipótesis sola, a fondo: se centra en el mapa al entrar (recupera
 *  `onCenter`, que la firma de `ResultsDrawer` ya aceptaba pero nadie
 *  disparaba desde aquí) y se enseña toda su info. El comparador SÍ se
 *  repite aquí para una alternativa (antes solo vivía en la principal): una
 *  alternativa trae su propio `imagen_id` igual que la principal, y sin el
 *  comparador no había forma de ver contra qué foto de referencia se estaba
 *  comparando esa hipótesis en concreto. */
function VistaDetalle({ h, image, onCenter, onVolver }: {
  h: Hipotesis; image: Image | null; onCenter: (lat: number, lng: number) => void; onVolver: () => void;
}) {
  useEffect(() => { onCenter(h.lat, h.lng); }, [h.lat, h.lng, onCenter]);
  return (
    <div className="flex flex-col gap-2.5 rounded-[10px] border border-border p-3">
      <button onClick={onVolver}
        className="-ml-1 flex w-fit items-center gap-1 rounded-[7px] px-1.5 py-1 text-[10.5px]
          text-subtle transition-colors duration-300 ease-expo hover:text-fg">
        <Icon name="back" size={11} /> Volver
      </button>
      {h.imagen_id != null && image ? (
        <CompareSlider
          izquierda={lumiUrl(`/v1/images/${image.id}/thumb`)}
          derecha={lumiUrl(`/v1/reference-images/${h.imagen_id}/thumb`)}
          etiquetaIzquierda="tuya" etiquetaDerecha="referencia" />
      ) : null}
      <div className="font-mono text-[18px] leading-none text-fg">
        {h.lat.toFixed(4)}, {h.lng.toFixed(4)}
      </div>
      <div className="flex gap-4">
        <div>
          <div className="text-[8px] uppercase tracking-[.08em] text-subtle">Radio</div>
          <div className="mt-0.5 font-mono text-[12.5px] text-fg">± {Math.round(h.radio_m)} m</div>
        </div>
        <div>
          <div className="text-[8px] uppercase tracking-[.08em] text-subtle">Confianza</div>
          <div className="mt-0.5 font-mono text-[12.5px] text-fg">{h.peso.toFixed(1)}×</div>
        </div>
        {h.indice && (
          <div>
            <div className="text-[8px] uppercase tracking-[.08em] text-subtle">Índice</div>
            <div className="mt-0.5 text-[11.5px] text-fg">{h.indice} · {h.autor}</div>
          </div>
        )}
      </div>
      <InsigniaVerificacion h={h} />
    </div>
  );
}

/** Lo que se sabe del intento seleccionado: la foto, el resultado y el GPS
 *  que declara la cámara. `analysis` ya viene resuelto por quien monta este
 *  componente (antes `ResultsDrawer` buscaba entre TODOS los intentos y
 *  además los listaba aquí mismo — eso ahora es trabajo de `AttemptsRail`
 *  y de `CaseView`, no de este componente).
 *
 *  Dos vistas por dentro: Comparar (la mayor coincidencia con ambas fotos,
 *  más la lista de alternativas) y Detalle (una hipótesis sola, centrada en
 *  el mapa). Se reinician a Comparar cada vez que cambia de análisis — la
 *  selección de un intento viejo no debería aterrizar en el detalle del
 *  intento anterior. */
export function ResultsDrawer({
  open, image, analysis, busy, progreso, onAnalyze, onCenter,
}: {
  open: boolean;
  image: Image | null;
  analysis: Analysis | null;
  busy: boolean;
  /** Fase/ETA/posición del análisis mostrado, si sigue en marcha y el owner
   *  tiene `progreso_detallado_activo`. `null` = no hay nada que enseñar
   *  (apagado, o todavía no ha llegado ningún evento para este análisis). */
  progreso: { fase?: string; etaS?: number | null; posicion?: number } | null;
  onAnalyze: () => void;
  onCenter: (lat: number, lng: number) => void;
}) {
  const exif = image?.exif_lat != null && image.exif_lng != null;
  const [vista, setVista] = useState<"comparar" | "detalle">("comparar");
  const [sel, setSel] = useState(0);
  useEffect(() => { setVista("comparar"); setSel(0); }, [analysis?.id]);

  const principal = analysis ? principalComoHipotesis(analysis) : null;
  const alternativas = analysis?.hypotheses ?? [];
  const todas = principal ? [principal, ...alternativas] : [];
  const maxPeso = Math.max(...todas.map((h) => h.peso), 1e-9);
  const seleccionada = todas[sel] ?? null;

  return (
    <Drawer open={open}>
      {image && (
        <div className="flex items-center gap-2.5 rounded-[9px] bg-white/[.03] p-[8px]">
          <img src={lumiUrl(`/v1/images/${image.id}/thumb`)} alt=""
            className="h-9 w-11 shrink-0 rounded bg-elevated object-cover" />
          <div className="min-w-0">
            <div className="truncate font-mono text-[10.5px] text-fg">{image.filename}</div>
            {analysis && (
              <div className="mt-0.5 font-mono text-[9px] text-subtle">{analysis.model}</div>
            )}
          </div>
        </div>
      )}

      {analysis && analysis.state !== "hecho" && (
        analysis.state === "error" ? (
          <p className="text-[11.5px] text-muted">{analysis.error ?? "falló sin dejar motivo"}</p>
        ) : progreso ? (
          <FaseProgreso progreso={progreso} />
        ) : (
          <p className="text-[11.5px] text-muted">esperando al motor</p>
        )
      )}

      {analysis?.nivel_efectivo && analysis.nivel_efectivo !== analysis.model && (
        <p className="flex items-start gap-2 text-[10.5px] leading-relaxed text-warning-fg">
          <Icon name="alert" size={12} className="mt-px shrink-0" />
          Se pidió {analysis.model} y corrió {analysis.nivel_efectivo}: a los índices instalados les
          faltan capas de vectores de los modelos que {analysis.model} necesita.
        </p>
      )}

      {vista === "detalle" && seleccionada ? (
        <VistaDetalle h={seleccionada} image={image} onCenter={onCenter} onVolver={() => setVista("comparar")} />
      ) : (
        <>
          {principal && (
            <TarjetaPrincipal principal={principal} image={image} onAbrir={() => { setSel(0); setVista("detalle"); }} />
          )}
          <ListaAlternativas alternativas={alternativas} maxPeso={maxPeso}
            onAbrir={(i) => { setSel(i + 1); setVista("detalle"); }} />
        </>
      )}

      {exif && (
        <div className="rounded-[10px] border border-warning/30 p-[8px_9px]">
          <div className="text-[9px] uppercase tracking-[.11em] text-subtle">E · EXIF</div>
          <div className="text-[11.5px] text-warning-fg">
            {image!.exif_lat!.toFixed(4)}, {image!.exif_lng!.toFixed(4)}
          </div>
        </div>
      )}

      <div className="flex-1" />
      <button onClick={onAnalyze} disabled={busy}
        className="jg-press w-full rounded-[9px] border border-white/15 px-3 py-2 text-[11.5px]
          text-fg disabled:opacity-40">
        {busy ? "Un momento…" : "Analizar otra vez"}
      </button>
    </Drawer>
  );
}
