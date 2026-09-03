import { feature } from "topojson-client";
import type { Topology, GeometryCollection } from "topojson-specification";
import type { MultiPolygon } from "geojson";
import landTopo from "world-atlas/land-110m.json";
import { cobertura } from "../lib/catalogo";
import { RevelaSeccion } from "./RevelaSeccion";

/** Mapa de cobertura, alimentado por el catálogo real publicado en GitHub
 *  (lib/catalogo.ts) — no un canvas con balizas decorativas. Si GitHub no
 *  responde, la sección lo dice explícitamente; nunca un cero fabricado ni
 *  un mapa vacío en silencio.
 *
 *  La silueta de los continentes es geografía real (Natural Earth 110m vía
 *  world-atlas), no un bitmap aparte ni un trazado inventado a mano: se
 *  recorre el mismo `proyectar()` que ya posiciona las balizas, así que
 *  costa y balizas comparten exactamente la misma proyección — nunca
 *  podrían desalinearse entre sí. */

function quadkeyATile(quadkey: string) {
  let x = 0, y = 0;
  const z = quadkey.length;
  for (let i = z; i > 0; i--) {
    const mask = 1 << (i - 1);
    switch (quadkey[z - i]) {
      case "1": x |= mask; break;
      case "2": y |= mask; break;
      case "3": x |= mask; y |= mask; break;
      default: break;
    }
  }
  return { x, y, z };
}

function tileACentro(x: number, y: number, z: number) {
  const n = 2 ** z;
  const lon = ((x + 0.5) / n) * 360 - 180;
  const latRad = Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 0.5)) / n)));
  const lat = (latRad * 180) / Math.PI;
  return { lon, lat };
}

function proyectar(lon: number, lat: number, w: number, h: number) {
  return { x: ((lon + 180) / 360) * w, y: ((90 - lat) / 180) * h };
}

const W = 960, H = 460;

/** El anillo de un polígono, como una `M x,y L x,y … Z` de SVG — mismo
 *  proyector que las balizas, así que comparten exactamente el mismo
 *  mapeo lon/lat → píxel. */
function anilloAPath(anillo: [number, number][]): string {
  return anillo
    .map(([lon, lat], i) => {
      const { x, y } = proyectar(lon, lat, W, H);
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ") + "Z";
}

/** La silueta completa de los continentes (Natural Earth 110m), como un
 *  único `d` de SVG — se computa en el servidor una sola vez por
 *  renderizado, nunca viaja al cliente como JS. */
function siluetaContinentes(): string {
  const topologia = landTopo as unknown as Topology<{ land: GeometryCollection }>;
  const geometria = feature(topologia, topologia.objects.land) as unknown as {
    features: { geometry: MultiPolygon }[];
  };
  const partes: string[] = [];
  for (const f of geometria.features) {
    for (const poligono of f.geometry.coordinates) {
      for (const anillo of poligono) {
        partes.push(anilloAPath(anillo as [number, number][]));
      }
    }
  }
  return partes.join(" ");
}

export async function Cobertura() {
  const resumen = await cobertura();
  const costa = siluetaContinentes();

  return (
    <section id="cobertura" className="mx-auto max-w-[1180px] px-7 py-28">
      <RevelaSeccion>
        <span className="font-mono text-[11px] uppercase tracking-wide text-subtle">indexado</span>
        <h2 className="mt-2 text-[clamp(24px,3.4vw,36px)] font-semibold tracking-tight">
          Cuánto mundo ya reconoce Lumi
        </h2>
        <p className="mt-3 max-w-[70ch] leading-relaxed text-muted">
          Cada baliza marca una región con actividad de indexado sobre el terreno real, leída
          del catálogo publicado — el resto del mapa, sin marcar, es lo que aún falta por recorrer.
        </p>

        <div className="jg-micro mt-10 overflow-hidden rounded-card border border-border bg-panel hover:border-subtle">
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Mapa de cobertura">
            <rect width={W} height={H} fill="#101216" />
            <path d={costa} fill="rgba(232,232,230,.06)" stroke="rgba(232,232,230,.14)" strokeWidth={0.75} />
            {Array.from({ length: 12 }).map((_, i) => (
              <line key={`m${i}`} x1={(i / 12) * W} y1={0} x2={(i / 12) * W} y2={H} stroke="rgba(232,232,230,.06)" />
            ))}
            {Array.from({ length: 6 }).map((_, i) => (
              <line key={`p${i}`} x1={0} y1={(i / 6) * H} x2={W} y2={(i / 6) * H} stroke="rgba(232,232,230,.06)" />
            ))}
            {resumen?.quadkeys.map((qk) => {
              const t = quadkeyATile(qk);
              const { lon, lat } = tileACentro(t.x, t.y, t.z);
              const { x, y } = proyectar(lon, lat, W, H);
              return <circle key={qk} cx={x} cy={y} r={2.4} fill="#f2f3f5" opacity={0.85} />;
            })}
          </svg>
        </div>

        <div className="mt-5 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-2 font-mono text-[11px] text-subtle">
            <span className="h-1.5 w-1.5 rounded-full bg-accent" /> baliza = zona con actividad de indexado
          </div>
          {resumen && (
            <div className="flex gap-5 font-mono text-[11px] text-subtle">
              <span><span className="text-fg">{resumen.quadkeys.length}</span> zonas</span>
              <span><span className="text-fg">{resumen.paquetes}</span> paquetes</span>
              <span><span className="text-fg">{resumen.autores}</span> autores</span>
            </div>
          )}
        </div>

        {resumen === null && (
          <p className="mt-4 font-mono text-[11px] text-warning-fg">
            catálogo no disponible — no se pudo consultar GitHub
          </p>
        )}
      </RevelaSeccion>
    </section>
  );
}
