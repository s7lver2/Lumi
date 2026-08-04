import type { Analysis, Image } from "../lib/api";

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
  const r = 6.5;
  const c = 2 * Math.PI * r;
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" className="shrink-0">
      <circle cx="12" cy="12" r={r * (24 / 15)} stroke="#33373d" strokeWidth="1.8" />
      <circle cx="12" cy="12" r={r * (24 / 15)} stroke="currentColor" strokeWidth="1.8"
        strokeLinecap="round" transform="rotate(-90 12 12)"
        strokeDasharray={`${(c * pct) / 100} ${c}`} pathLength={c} />
    </svg>
  );
}

export function ResultCard({ analysis, image }: { analysis: Analysis | null; image: Image | null }) {
  if (!analysis) return null;

  if (analysis.state !== "hecho") {
    const texto =
      analysis.state === "error"
        ? analysis.error ?? "el análisis falló y no dejó motivo"
        : "esperando al motor de inferencia";
    return (
      <div className="absolute left-1/2 top-12 z-20 w-[268px] -translate-x-1/2 rounded-card border border-white/[.07] bg-[rgba(24,26,30,.93)] p-3.5 shadow-lg shadow-black/40 backdrop-blur">
        <p className="text-[13px] text-fg">
          {analysis.state === "error" ? "El análisis falló" : "Análisis en cola"}
        </p>
        <p className={`mt-1 text-[10.5px] ${analysis.state === "error" ? "text-danger-fg" : "text-subtle"}`}>
          {texto}
        </p>
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
    <div className="absolute left-1/2 top-12 z-20 w-[268px] -translate-x-1/2 rounded-card border border-white/[.07] bg-[rgba(24,26,30,.93)] p-3.5 shadow-lg shadow-black/40 backdrop-blur">
      <div className="mb-2.5 flex items-center gap-2.5 text-fg">
        <Ring pct={pct} />
        <span className="text-[13px]">{pct}% · Resultado principal</span>
      </div>
      <p className="text-[10.5px] text-muted">Radio de búsqueda: {km} km.</p>
      {gap !== null && (
        <p className="text-[10.5px] text-warning-fg">
          El EXIF declara un GPS a {gap < 1000 ? `${Math.round(gap)} m` : `${(gap / 1000).toFixed(1)} km`} de aquí.
        </p>
      )}
    </div>
  );
}
