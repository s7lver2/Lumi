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

/** El porcentaje real puede ser diminuto (un puñado de teselas contra
 *  toda la tierra firme del planeta) — mostrarlo con 1-2 decimales fijos
 *  lo redondearía a "0.00%", que se lee como "no hay nada" en vez de "hay
 *  poco todavía". Más decimales cuanto más pequeño es el número. */
function formatoPorcentaje(p: number): string {
  if (p === 0) return "0%";
  if (p < 0.001) return "< 0.001%";
  if (p < 1) return `${p.toFixed(3)}%`;
  return `${p.toFixed(1)}%`;
}

/** El anillo de un polígono, como uno o más `M x,y L x,y … Z` de SVG —
 *  mismo proyector que las balizas, mismo mapeo lon/lat → píxel. Rusia,
 *  Fiyi y demás geometría que cruza el antimeridiano (lon 180 → -180)
 *  generan un salto enorme entre dos vértices consecutivos del anillo; sin
 *  cortar ahí, esos dos puntos se unen con una línea recta que atraviesa
 *  el mapa entero de borde a borde — la "línea rara" que aparecía sobre
 *  Rusia y bajo la Antártida. Se corta el trazo (nuevo `M`) cada vez que
 *  la longitud salta más de 180°, en vez de unir esos dos puntos. */
function anilloAPath(anillo: [number, number][]): string {
  const subrutas: string[] = [];
  let actual: string[] = [];
  let lonAnterior: number | null = null;
  for (const [lon, lat] of anillo) {
    const salto = lonAnterior !== null && Math.abs(lon - lonAnterior) > 180;
    if (salto && actual.length) {
      subrutas.push(actual.join(" ") + "Z");
      actual = [];
    }
    const { x, y } = proyectar(lon, lat, W, H);
    actual.push(`${actual.length === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`);
    lonAnterior = lon;
  }
  if (actual.length) subrutas.push(actual.join(" ") + "Z");
  return subrutas.join(" ");
}

const RADIO_TIERRA_KM = 6371;

/** Área esférica de un anillo (fórmula de Chamberlain & Duquette para
 *  polígonos sobre una esfera — JPL, "Some Algorithms for Polygons on a
 *  Sphere"), a salvo del mismo salto de antimeridiano que el trazado: la
 *  diferencia de longitud entre vértices consecutivos se envuelve al
 *  rango [-180°, 180°] en vez de tomarse tal cual.
 *
 *  El término "+2" no es cosmético: sin él, la fórmula da bien el área de
 *  polígonos "normales" pero se dispara para un anillo que encierra un
 *  polo (como la Antártida, cuya costa da la vuelta completa a las 360°
 *  de longitud) — se verificó contra el área analítica de un casquete
 *  polar antes de fiarse del resultado en tierra real (daba ~65× de más
 *  sin el "+2"). */
function areaAnilloKm2(anillo: [number, number][]): number {
  let suma = 0;
  for (let i = 0; i < anillo.length; i++) {
    const [lon1, lat1] = anillo[i];
    const [lon2, lat2] = anillo[(i + 1) % anillo.length];
    const deltaLon = (((lon2 - lon1 + 540) % 360) - 180) * (Math.PI / 180);
    suma += deltaLon * (2 + Math.sin((lat1 * Math.PI) / 180) + Math.sin((lat2 * Math.PI) / 180));
  }
  return Math.abs((suma * RADIO_TIERRA_KM * RADIO_TIERRA_KM) / 2);
}

/** La silueta completa de los continentes (Natural Earth 110m) — el
 *  trazado SVG y el área total en km², calculados juntos porque comparten
 *  la misma geometría. Todo esto corre en el servidor una sola vez por
 *  renderizado; nunca viaja al cliente como JS. */
function siluetaContinentes(): { path: string; areaKm2: number } {
  const topologia = landTopo as unknown as Topology<{ land: GeometryCollection }>;
  const geometria = feature(topologia, topologia.objects.land) as unknown as {
    features: { geometry: MultiPolygon }[];
  };
  const partes: string[] = [];
  let areaKm2 = 0;
  for (const f of geometria.features) {
    for (const poligono of f.geometry.coordinates) {
      // El primer anillo es el contorno exterior; el resto (si los hay)
      // son agujeros y restan del área en vez de sumar.
      poligono.forEach((anillo, i) => {
        partes.push(anilloAPath(anillo as [number, number][]));
        const area = areaAnilloKm2(anillo as [number, number][]);
        areaKm2 += i === 0 ? area : -area;
      });
    }
  }
  return { path: partes.join(" "), areaKm2 };
}

/** Límites lon/lat de una tesela z14 (fórmula estándar de Web Mercator) y
 *  su área esférica exacta — mismo cálculo que `areaAnilloKm2` pero para
 *  un rectángulo, así que el área de tesela y el área de continente son
 *  directamente comparables (misma unidad, mismo método). */
function areaTeselaKm2(x: number, y: number, z: number): number {
  const n = 2 ** z;
  const lonOeste = (x / n) * 360 - 180;
  const lonEste = ((x + 1) / n) * 360 - 180;
  const latNorte = (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI;
  const latSur = (Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 1)) / n))) * 180) / Math.PI;
  const deltaLon = ((lonEste - lonOeste) * Math.PI) / 180;
  const deltaSinLat = Math.sin((latNorte * Math.PI) / 180) - Math.sin((latSur * Math.PI) / 180);
  return deltaLon * deltaSinLat * RADIO_TIERRA_KM * RADIO_TIERRA_KM;
}

export async function Cobertura() {
  const resumen = await cobertura();
  const { path: costa, areaKm2: areaTierraKm2 } = siluetaContinentes();

  // % de tierra indexada, no % del globo — el globo es sobre todo océano,
  // y esa cifra sería minúscula e ilegible. Se compara área contra área
  // (km² real de cada tesela reclamada contra el km² real de tierra firme),
  // no recuento de teselas contra recuento de teselas, porque una tesela
  // z14 cubre mucho más terreno cerca del ecuador que cerca de los polos.
  // Una tesela costera cuenta su área completa aunque parte caiga en el
  // mar — de ahí la nota "estimado", no un dato exacto al metro cuadrado.
  const areaReclamadaKm2 = resumen
    ? resumen.quadkeys.reduce((acc, qk) => {
        const t = quadkeyATile(qk);
        return acc + areaTeselaKm2(t.x, t.y, t.z);
      }, 0)
    : 0;
  const porcentajeIndexado = resumen ? Math.min(100, (areaReclamadaKm2 / areaTierraKm2) * 100) : 0;

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
            {resumen?.quadkeys.map((qk, i) => {
              const t = quadkeyATile(qk);
              const { lon, lat } = tileACentro(t.x, t.y, t.z);
              const { x, y } = proyectar(lon, lat, W, H);
              // Parpadeo sutil y desfasado por baliza — nunca a la vez, o se
              // lee como un parpadeo de pantalla en vez de actividad viva.
              // El desfase sale del índice, no de Math.random(): server
              // component, tiene que dar el mismo marcado en cada render.
              return (
                <circle
                  key={qk}
                  cx={x}
                  cy={y}
                  r={2.4}
                  fill="#f2f3f5"
                  className="jg-baliza"
                  style={{ animationDelay: `${(i % 11) * 0.27}s` }}
                />
              );
            })}
          </svg>
        </div>

        {resumen && (
          <div className="mt-5">
            <div className="flex items-baseline justify-between font-mono text-[11px] text-subtle">
              <span>tierra firme indexada</span>
              <span className="text-fg tabular-nums">{formatoPorcentaje(porcentajeIndexado)}</span>
            </div>
            <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-elevated">
              <div
                className="h-full rounded-full bg-fg"
                style={{ width: `${Math.max(porcentajeIndexado, porcentajeIndexado > 0 ? 0.4 : 0)}%` }}
              />
            </div>
            <p className="mt-1.5 font-mono text-[10px] text-subtle">
              estimado por área de tesela reclamada, no por metro cuadrado exacto — una tesela costera
              cuenta entera aunque parte caiga en el mar
            </p>
          </div>
        )}

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
