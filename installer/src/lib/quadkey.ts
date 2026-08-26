/** Minimal, sin arrastrar los tipos de `geojson`: aquí solo hace falta un
 *  polígono con propiedades, no el estándar entero. */
export interface Poligono {
  type: "Feature";
  properties: Record<string, unknown>;
  geometry: { type: "Polygon"; coordinates: number[][][] };
}

/** El par (x, y) de una tesela z14 a partir de su quadkey, desentrelazando
 *  los bits pares/impares. Mismo camino que `tiles::quadkey_de`, a la
 *  inversa -- compartido con `teselaAPoligono` para no repetirlo. */
export function xyDeQuadkey(qk: string): { x: number; y: number } {
  let x = 0, y = 0;
  for (const c of qk) {
    const d = c.charCodeAt(0) - 48;
    x = (x << 1) | (d & 1);
    y = (y << 1) | ((d >> 1) & 1);
  }
  return { x, y };
}

/** El centro de una tesela z14 a partir de su quadkey, para dibujar su
 *  cuadrado en el mapa. Compartido entre `MapCanvas` (territorio) y
 *  `DownloadMap` (descarga en vivo): las dos pintan teselas del mismo
 *  quadkey. */
export function teselaAPoligono(qk: string): Poligono {
  const { x, y } = xyDeQuadkey(qk);
  const escala = 1 << qk.length;
  const lngDe = (tx: number) => (tx / escala) * 360 - 180;
  const latDe = (ty: number) => {
    const n = Math.PI * (1 - (2 * ty) / escala);
    return (Math.atan(Math.sinh(n)) * 180) / Math.PI;
  };
  const anillo = [
    [lngDe(x), latDe(y)],
    [lngDe(x + 1), latDe(y)],
    [lngDe(x + 1), latDe(y + 1)],
    [lngDe(x), latDe(y + 1)],
    [lngDe(x), latDe(y)],
  ];
  return { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [anillo] } };
}
