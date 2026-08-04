import type { Analysis, Image } from "../lib/api";
import { FloatingCard } from "../ui/FloatingCard";
import { Icon } from "../ui/Icon";

/** Metros entre dos coordenadas. Haversine con el radio medio de la Tierra:
 *  la precisión de sobra para decir "el EXIF declara un GPS a 300 m de aquí". */
export function metersBetween(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(bLat - aLat);
  const dLng = rad(bLng - aLng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function Ring({ pct }: { pct: number }) {
  const r = 14;
  const c = 2 * Math.PI * r;
  return (
    <svg width="30" height="30" viewBox="0 0 36 36" fill="none" className="shrink-0">
      <circle cx="18" cy="18" r={r} stroke="#33373d" strokeWidth="2.6" />
      <circle cx="18" cy="18" r={r} stroke="currentColor" strokeWidth="2.6" strokeLinecap="round"
        transform="rotate(-90 18 18)"
        strokeDasharray={`${(c * pct) / 100} ${c}`}
        style={{ transition: "stroke-dasharray .9s cubic-bezier(.16,1,.3,1)" }} />
    </svg>
  );
}

/** Flota sobre el mapa, centrada horizontalmente en el lienzo visible (a la
 *  derecha del carril, y a la izquierda de la barra de resultados si está
 *  montada — `offset` es su ancho). El centrado es flexbox, no `left: 50%` +
 *  `translate`: solo hace falta ajustar los bordes del contenedor, sin
 *  calcular a mano dónde cae el punto medio. La distancia al techo (66px) es
 *  aparte, vía `margin-top` en el hijo, porque esta tarjeta cuelga cerca de
 *  arriba y no en medio de la pantalla. */
export function ResultCard({ analysis, image, offset = 0 }:
  { analysis: Analysis | null; image: Image | null; offset?: number }) {
  if (!analysis) return null;

  const frame = "pointer-events-none absolute left-11 top-0 z-20 flex justify-center";

  if (analysis.state !== "hecho") {
    const fallo = analysis.state === "error";
    return (
      <div className={frame} style={{ right: offset }}>
        <FloatingCard className="pointer-events-auto mt-[66px] w-[286px] p-3.5">
          <div style={{ animation: "jg-popup-scale-in 220ms cubic-bezier(.2,.85,.35,1) both" }}>
            <p className="text-[13px] text-fg">{fallo ? "El análisis falló" : "Análisis en cola"}</p>
            <p className={`mt-1 text-[10.5px] leading-snug ${fallo ? "text-danger-fg" : "text-subtle"}`}>
              {fallo
                ? analysis.error ?? "el análisis falló y no dejó motivo"
                : "esperando al motor de inferencia"}
            </p>
          </div>
        </FloatingCard>
      </div>
    );
  }

  const pct = Math.round((analysis.result_confidence ?? 0) * 100);
  const km = ((analysis.result_radius_m ?? 0) / 1000).toFixed(2);
  const gap =
    image?.exif_lat != null && image.exif_lng != null && analysis.result_lat != null
      ? metersBetween(analysis.result_lat, analysis.result_lng!, image.exif_lat, image.exif_lng)
      : null;

  return (
    <div className={frame} style={{ right: offset }}>
      <FloatingCard className="pointer-events-auto mt-[66px] w-[286px] p-3.5">
        <div style={{ animation: "jg-popup-scale-in 240ms cubic-bezier(.2,.85,.35,1) both" }}>
          <div className="flex items-center gap-[11px] text-fg">
            <Ring pct={pct} />
            <div className="min-w-0">
              <p className="text-[15px]">{pct} % · Resultado principal</p>
              <p className="mt-0.5 truncate font-mono text-[10px] text-muted">
                {analysis.result_lat!.toFixed(6)}, {analysis.result_lng!.toFixed(6)}
              </p>
            </div>
          </div>

          <div className="my-3 h-px bg-white/[.07]" />

          <div className="flex justify-between">
            <Field k="Radio" v={`${km} km`} />
            <Field k="Modelo" v={analysis.model} />
            {/* Nadie ha comprobado este resultado contra el terreno, y decirlo
                es parte del trabajo forense, no un adorno. */}
            <Field k="Estado" v="sin verificar" dim />
          </div>

          {gap !== null && (
            <div className="mt-[11px] flex items-start gap-[7px] border-t border-warning/20 pt-[11px]">
              <Icon name="alert" size={12} className="mt-px shrink-0 text-warning-fg" />
              <p className="text-[10.5px] leading-snug text-warning-fg">
                El EXIF declara un GPS a{" "}
                {gap < 1000 ? `${Math.round(gap)} m` : `${(gap / 1000).toFixed(1)} km`} de aquí.
              </p>
            </div>
          )}
        </div>
      </FloatingCard>
    </div>
  );
}

function Field({ k, v, dim }: { k: string; v: string; dim?: boolean }) {
  return (
    <div>
      <div className="text-[8px] uppercase tracking-[.11em] text-subtle">{k}</div>
      <div className={`mt-[3px] text-[11.5px] ${dim ? "text-subtle" : "text-fg"}`}>{v}</div>
    </div>
  );
}
