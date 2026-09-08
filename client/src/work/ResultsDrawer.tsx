import { useEffect, useState } from "react";
import { lumiUrl } from "../lib/bridge";
import type { Analysis, DichoDeAgente, Hipotesis, Image } from "../lib/api";
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
    <button onClick={onAbrir} className="flex w-full flex-col gap-2.5 rounded-[10px] border border-border p-3 text-left
      transition-colors duration-300 ease-expo hover:border-white/20">
      {principal.imagen_id != null && image ? (
        <CompareSlider
          izquierda={lumiUrl(`/v1/images/${image.id}/thumb`)}
          derecha={lumiUrl(`/v1/reference-images/${principal.imagen_id}/thumb`)}
          etiquetaIzquierda="tuya" etiquetaDerecha="referencia" />
      ) : null}
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
 *  disparaba desde aquí) y se enseña toda su info. Sin foto de comparación:
 *  el slider es cosa de la vista Comparar, no se duplica. */
function VistaDetalle({ h, onCenter, onVolver }: {
  h: Hipotesis; onCenter: (lat: number, lng: number) => void; onVolver: () => void;
}) {
  useEffect(() => { onCenter(h.lat, h.lng); }, [h.lat, h.lng, onCenter]);
  return (
    <div className="flex flex-col gap-2.5 rounded-[10px] border border-border p-3">
      <button onClick={onVolver}
        className="-ml-1 flex w-fit items-center gap-1 rounded-[7px] px-1.5 py-1 text-[10.5px]
          text-subtle transition-colors duration-300 ease-expo hover:text-fg">
        <Icon name="back" size={11} /> Volver
      </button>
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

/** Icono propio por agente — no una plantilla repetida con el icono
 *  cambiado (DESIGN.md prohíbe rejillas de tarjetas idénticas). El de
 *  `hora-sombras` es el único cuyo dibujo depende del dato real: la aguja
 *  rota al ángulo estimado a partir de la hora que dice `etiqueta`
 *  ("~13:00" → 13h). El resto son formas fijas. */
function AgenteIcono({ agente, etiqueta, apagado }: { agente: string; etiqueta: string; apagado: boolean }) {
  const color = apagado ? "#6a6c70" : "#e8e8e6";
  if (agente === "hora-sombras") {
    const m = /(\d{1,2})(?::\d{2})?/.exec(etiqueta);
    const hora = m ? Number(m[1]) : 12;
    // Mediodía (12h) = aguja recta hacia arriba (0°); cada hora de
    // diferencia gira 15° (360°/24h) hacia el lado que corresponda.
    const grados = (hora - 12) * 15;
    return (
      <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.7}
        strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
        <circle cx="12" cy="12" r="8.5" />
        <line x1="12" y1="12" x2="12" y2="6" transform={`rotate(${grados} 12 12)`}
          style={{ transition: "transform 1.1s cubic-bezier(.16,1,.3,1)" }} />
        <circle cx="12" cy="12" r=".6" fill={color} stroke="none" />
      </svg>
    );
  }
  if (agente === "clima-aparente") {
    return <Icon name="cloud" size={26} className={apagado ? "text-subtle" : "text-fg"} />;
  }
  if (agente === "lado-conduccion") {
    return <Icon name="via" size={26} className={apagado ? "text-subtle" : "text-fg"} />;
  }
  // "idioma" y cualquier agente futuro sin icono propio: bocadillo genérico.
  return <Icon name="bocadillo" size={26} className={apagado ? "text-subtle" : "text-fg"} />;
}

/** Lo que la imagen dice de sí misma. Una tarjeta por agente, con su icono
 *  propio y su frase de motivo visible — antes era una lista apretada de
 *  una columna con todos los `detalle` concatenados al final. Los
 *  abstenidos NO desaparecen: se ven apagados, diciendo que no hubo señal
 *  suficiente. */
function AgentesPanel({ agentes }: { agentes: DichoDeAgente[] }) {
  if (agentes.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <p className="text-[9px] uppercase tracking-[.11em] text-subtle">Lo que dice la imagen</p>
      {agentes.map((d) => {
        const calla = d.etiqueta === "abstiene";
        return (
          <div key={d.agente}
            className={`flex items-center gap-3 rounded-lg bg-white/[.03] p-2.5 ${calla ? "opacity-50" : ""}`}>
            <AgenteIcono agente={d.agente} etiqueta={d.etiqueta} apagado={calla} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-[10.5px] text-fg">{d.nombre}</span>
                {!calla && <span className="font-mono text-[9px] tabular-nums text-subtle">{d.confianza.toFixed(2)}</span>}
              </div>
              <div className="mt-0.5 text-[12px] text-fg">{calla ? "sin señal suficiente" : d.etiqueta}</div>
              {!calla && d.detalle && (
                <p className="mt-0.5 text-[9.5px] leading-snug text-subtle">{d.detalle}</p>
              )}
            </div>
          </div>
        );
      })}
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
  open, image, analysis, busy, onAnalyze, onCenter,
}: {
  open: boolean;
  image: Image | null;
  analysis: Analysis | null;
  busy: boolean;
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
        <p className="text-[11.5px] text-muted">
          {analysis.state === "error" ? analysis.error ?? "falló sin dejar motivo" : "esperando al motor"}
        </p>
      )}

      {analysis?.nivel_efectivo && analysis.nivel_efectivo !== analysis.model && (
        <p className="flex items-start gap-2 text-[10.5px] leading-relaxed text-warning-fg">
          <Icon name="alert" size={12} className="mt-px shrink-0" />
          Se pidió {analysis.model} y corrió {analysis.nivel_efectivo}: a los índices instalados les
          faltan capas de vectores de los modelos que {analysis.model} necesita.
        </p>
      )}

      {vista === "detalle" && seleccionada ? (
        <VistaDetalle h={seleccionada} onCenter={onCenter} onVolver={() => setVista("comparar")} />
      ) : (
        <>
          {principal && (
            <TarjetaPrincipal principal={principal} image={image} onAbrir={() => { setSel(0); setVista("detalle"); }} />
          )}
          <ListaAlternativas alternativas={alternativas} maxPeso={maxPeso}
            onAbrir={(i) => { setSel(i + 1); setVista("detalle"); }} />
        </>
      )}

      {analysis && <AgentesPanel agentes={analysis.agentes} />}
      {analysis?.state === "hecho" && analysis.agentes.length === 0 && (
        <p className="text-[10px] leading-relaxed text-subtle">
          Los agentes no llegaron a correr: sus modelos no están instalados en este servidor.
        </p>
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
