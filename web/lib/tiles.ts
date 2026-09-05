import { feature } from "topojson-client";
import type { Topology, GeometryCollection } from "topojson-specification";
import type { MultiPolygon } from "geojson";
import landTopo from "world-atlas/land-110m.json";

/** Geometría de teselas z14 y proyección equirectangular, compartida por
 *  `Cobertura` (home) y el mapa interactivo de `/indexado` — antes vivía
 *  duplicada en `Cobertura.tsx` a mano; ambas secciones necesitan la misma
 *  matemática (quadkey → lon/lat → píxel) para no desalinearse entre sí. */

export function quadkeyATile(quadkey: string) {
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

export function tileACentro(x: number, y: number, z: number) {
  const n = 2 ** z;
  const lon = ((x + 0.5) / n) * 360 - 180;
  const latRad = Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 0.5)) / n)));
  const lat = (latRad * 180) / Math.PI;
  return { lon, lat };
}

/** Límites lon/lat de una tesela (fórmula estándar de Web Mercator) — la
 *  misma proyección que `tileACentro`, pero las cuatro esquinas en vez del
 *  centro: es lo que necesita dibujar un rectángulo de verdad en vez de un
 *  punto. */
export function tileBounds(x: number, y: number, z: number) {
  const n = 2 ** z;
  const lonOeste = (x / n) * 360 - 180;
  const lonEste = ((x + 1) / n) * 360 - 180;
  const latNorte = (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI;
  const latSur = (Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 1)) / n))) * 180) / Math.PI;
  return { lonOeste, lonEste, latNorte, latSur };
}

export function proyectar(lon: number, lat: number, w: number, h: number) {
  return { x: ((lon + 180) / 360) * w, y: ((90 - lat) / 180) * h };
}

/** El anillo de un polígono, como uno o más `M x,y L x,y … Z` de SVG.
 *  Rusia, Fiyi y demás geometría que cruza el antimeridiano (lon 180 →
 *  -180) generan un salto enorme entre dos vértices consecutivos del
 *  anillo; sin cortar ahí, esos dos puntos se unen con una línea recta que
 *  atraviesa el mapa entero de borde a borde. Se corta el trazo (nuevo `M`)
 *  cada vez que la longitud salta más de 180°, en vez de unir esos dos
 *  puntos. */
function anilloAPath(anillo: [number, number][], w: number, h: number): string {
  const subrutas: string[] = [];
  let actual: string[] = [];
  let lonAnterior: number | null = null;
  for (const [lon, lat] of anillo) {
    const salto = lonAnterior !== null && Math.abs(lon - lonAnterior) > 180;
    if (salto && actual.length) {
      subrutas.push(actual.join(" ") + "Z");
      actual = [];
    }
    const { x, y } = proyectar(lon, lat, w, h);
    actual.push(`${actual.length === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`);
    lonAnterior = lon;
  }
  if (actual.length) subrutas.push(actual.join(" ") + "Z");
  return subrutas.join(" ");
}

const RADIO_TIERRA_KM = 6371;

/** Área esférica de un anillo (fórmula de Chamberlain & Duquette para
 *  polígonos sobre una esfera — JPL, "Some Algorithms for Polygons on a
 *  Sphere"), a salvo del mismo salto de antimeridiano que el trazado. El
 *  término "+2" no es cosmético: sin él la fórmula se dispara para un
 *  anillo que encierra un polo (verificado contra el área analítica de un
 *  casquete polar — daba ~65× de más sin el "+2"). */
export function areaAnilloKm2(anillo: [number, number][]): number {
  let suma = 0;
  for (let i = 0; i < anillo.length; i++) {
    const [lon1, lat1] = anillo[i];
    const [lon2, lat2] = anillo[(i + 1) % anillo.length];
    const deltaLon = (((lon2 - lon1 + 540) % 360) - 180) * (Math.PI / 180);
    suma += deltaLon * (2 + Math.sin((lat1 * Math.PI) / 180) + Math.sin((lat2 * Math.PI) / 180));
  }
  return Math.abs((suma * RADIO_TIERRA_KM * RADIO_TIERRA_KM) / 2);
}

/** Límites lon/lat de una tesela z14 y su área esférica exacta — mismo
 *  cálculo que `areaAnilloKm2` pero para un rectángulo, así que el área de
 *  tesela y el área de continente son directamente comparables. */
export function areaTeselaKm2(x: number, y: number, z: number): number {
  const { lonOeste, lonEste, latNorte, latSur } = tileBounds(x, y, z);
  const deltaLon = ((lonEste - lonOeste) * Math.PI) / 180;
  const deltaSinLat = Math.sin((latNorte * Math.PI) / 180) - Math.sin((latSur * Math.PI) / 180);
  return deltaLon * deltaSinLat * RADIO_TIERRA_KM * RADIO_TIERRA_KM;
}

/** La silueta completa de los continentes (Natural Earth 110m) — el
 *  trazado SVG y el área total en km², calculados juntos porque comparten
 *  la misma geometría. Corre en el servidor una sola vez por renderizado;
 *  nunca viaja al cliente como JS. */
export function siluetaContinentes(w: number, h: number): { path: string; areaKm2: number } {
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
        partes.push(anilloAPath(anillo as [number, number][], w, h));
        const area = areaAnilloKm2(anillo as [number, number][]);
        areaKm2 += i === 0 ? area : -area;
      });
    }
  }
  return { path: partes.join(" "), areaKm2 };
}
