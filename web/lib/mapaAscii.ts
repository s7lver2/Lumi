import { feature } from "topojson-client";
import type { Topology, GeometryCollection } from "topojson-specification";
import landTopo from "world-atlas/land-110m.json";

/** Rasteriza la MISMA geografía real que usa `siluetaContinentes` en
 *  `tiles.ts` (world-atlas/land-110m.json) a una rejilla de caracteres
 *  ASCII — el mapa de fondo del hero de `/meetpro` es geografía de verdad,
 *  no ruido inventado con senoidales.
 *
 *  Fuerza bruta (cada celda comprueba sus sub-muestras contra TODOS los
 *  anillos del planeta): a 340x148 tarda unos 15-20s. Aceptable como coste
 *  de build de una página estática, nunca por petición — de ahí la caché de
 *  módulo: si el proceso de build llama dos veces con el mismo tamaño (o el
 *  dev server recarga la página sin reiniciar), no se vuelve a calcular. */

type Anillo = [number, number][];

let anillosCache: Anillo[] | null = null;
function anillosDelMundo(): Anillo[] {
  if (anillosCache) return anillosCache;
  const topologia = landTopo as unknown as Topology<{ land: GeometryCollection }>;
  const geometria = feature(topologia, topologia.objects.land) as unknown as {
    features: { geometry: { coordinates: Anillo[][] } }[];
  };
  const anillos: Anillo[] = [];
  for (const f of geometria.features) {
    for (const poligono of f.geometry.coordinates) {
      for (const anillo of poligono) anillos.push(anillo);
    }
  }
  anillosCache = anillos;
  return anillos;
}

/** Ray-casting estándar (par/impar), sin distinguir exterior de agujero —
 *  no hace falta: alternar por cada anillo cruzado ya da el resultado
 *  correcto tanto para contornos como para agujeros. */
function dentro(anillos: Anillo[], lon: number, lat: number): boolean {
  let c = false;
  for (const anillo of anillos) {
    for (let i = 0, j = anillo.length - 1; i < anillo.length; j = i++) {
      const [xi, yi] = anillo[i];
      const [xj, yj] = anillo[j];
      // Un anillo que cruza el antimeridiano (Rusia, Fiyi, la costa de la
      // Antártida) da un salto de longitud enorme entre estos dos vértices
      // consecutivos — sin ignorarlo, el ray-casting cuenta un cruce falso
      // que atraviesa el mapa entero de borde a borde (una banda horizontal
      // que no tiene nada que ver con la costa real). Mismo problema que ya
      // resuelve `anilloAPath` en este mismo `lib/`, aquí resuelto
      // ignorando ese tramo en vez de partir el anillo — para un test de
      // punto no hace falta partirlo, solo no contarlo como borde.
      if (Math.abs(xi - xj) > 180) continue;
      const cruza = (yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
      if (cruza) c = !c;
    }
  }
  return c;
}

const RAMPA = " ..::--==++**##%%@@";
const SUB = 2; // sub-muestras por celda en cada eje -> hasta SUB*SUB niveles

const cache = new Map<string, string>();

export function mapaAsciiMundo(cols: number, rows: number): string {
  const clave = `${cols}x${rows}`;
  const enCache = cache.get(clave);
  if (enCache) return enCache;

  const anillos = anillosDelMundo();
  const filas: string[] = [];
  for (let r = 0; r < rows; r++) {
    let fila = "";
    const lat0 = 90 - (r / rows) * 180;
    const lat1 = 90 - ((r + 1) / rows) * 180;
    for (let c = 0; c < cols; c++) {
      const lon0 = (c / cols) * 360 - 180;
      const lon1 = ((c + 1) / cols) * 360 - 180;
      let hits = 0;
      let total = 0;
      for (let sy = 0; sy < SUB; sy++) {
        for (let sx = 0; sx < SUB; sx++) {
          const lon = lon0 + ((sx + 0.5) / SUB) * (lon1 - lon0);
          const lat = lat0 + ((sy + 0.5) / SUB) * (lat1 - lat0);
          total++;
          if (dentro(anillos, lon, lat)) hits++;
        }
      }
      fila += RAMPA[Math.round((hits / total) * (RAMPA.length - 1))];
    }
    filas.push(fila);
  }

  // Limpieza de artefactos: alguna fila sale con una densidad de "tierra"
  // que no encaja con sus vecinas (resto del cruce de antimeridiano que el
  // filtro de arriba no cazó entero) o casi completamente rellena (ninguna
  // costa real cruza el mapa de borde a borde salvo la Antártida en los
  // polos, fuera del rango donde esto se dispara). Se sustituye por la fila
  // de arriba en vez de perseguir el borde exacto en los datos de origen.
  function densidad(f: string) {
    let n = 0;
    for (const ch of f) if (ch !== " ") n++;
    return n;
  }
  for (let pasada = 0; pasada < 2; pasada++) {
    for (let r = 1; r < filas.length - 1; r++) {
      const d = densidad(filas[r]);
      const vecinos = Math.max(densidad(filas[r - 1]), densidad(filas[r + 1]), 1);
      if ((d > vecinos * 1.8 && d > cols * 0.25) || d > cols * 0.92) {
        filas[r] = filas[r - 1];
      }
    }
  }

  const resultado = filas.join("\n");
  cache.set(clave, resultado);
  return resultado;
}
