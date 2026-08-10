import { xyDeQuadkey } from "../lib/quadkey";

const LADO = 8;
const HUECO = 2;

interface Grupo {
  ocupadas: Set<string>;
  ancho: number;
  alto: number;
}

/** Agrupa los quadkeys en islas contiguas (8-vecinos) y normaliza cada una a
 *  su propia esquina: son las "manchas" que vienen de índices o zonas
 *  distintas, y agruparlas por separado es lo que evita que dos publicaciones
 *  a miles de km entre sí aplasten el dibujo de la que sea más pequeña. */
function agrupar(quadkeys: string[]): Grupo[] {
  const puntos = quadkeys.map(xyDeQuadkey);
  const claves = new Set(puntos.map((p) => `${p.x},${p.y}`));
  const visto = new Set<string>();
  const grupos: Grupo[] = [];

  for (const p0 of puntos) {
    const k0 = `${p0.x},${p0.y}`;
    if (visto.has(k0)) continue;
    visto.add(k0);
    const pila = [p0];
    const isla: { x: number; y: number }[] = [];
    while (pila.length > 0) {
      const c = pila.pop()!;
      isla.push(c);
      for (const dx of [-1, 0, 1]) {
        for (const dy of [-1, 0, 1]) {
          if (dx === 0 && dy === 0) continue;
          const nk = `${c.x + dx},${c.y + dy}`;
          if (claves.has(nk) && !visto.has(nk)) {
            visto.add(nk);
            pila.push({ x: c.x + dx, y: c.y + dy });
          }
        }
      }
    }
    const xs = isla.map((t) => t.x);
    const ys = isla.map((t) => t.y);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    grupos.push({
      ocupadas: new Set(isla.map((t) => `${t.x - minX},${t.y - minY}`)),
      ancho: Math.max(...xs) - minX + 1,
      alto: Math.max(...ys) - minY + 1,
    });
  }
  return grupos.sort((a, b) => b.ancho * b.alto - a.ancho * a.alto);
}

/** Dónde está el terreno que cubre una cuenta, a partir de sus quadkeys
 *  reales -- no es una ilustración, cada cuadro es una tesela z14 de verdad.
 *  Cada mancha se dibuja a su propia escala de cuadrícula: esto no pretende
 *  ser un mapa geográfico, solo la forma de la cobertura. */
export function CoverageMap({ quadkeys }: { quadkeys: string[] }) {
  if (quadkeys.length === 0) return null;
  const grupos = agrupar(quadkeys);

  return (
    <div className="flex min-h-[110px] flex-wrap items-center gap-6 rounded-lg border border-border p-4"
      style={{ background: "radial-gradient(120% 90% at 50% 30%, #1a1d21 0%, #131518 55%, #0d0f11 100%)" }}>
      {grupos.map((g, i) => (
        <div key={i}
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(${g.ancho}, ${LADO}px)`,
            gridTemplateRows: `repeat(${g.alto}, ${LADO}px)`,
            gap: HUECO,
          }}>
          {Array.from({ length: g.ancho * g.alto }).map((_, idx) => {
            const x = idx % g.ancho;
            const y = Math.floor(idx / g.ancho);
            const hay = g.ocupadas.has(`${x},${y}`);
            return (
              <i key={idx} className="block rounded-[2px]"
                style={{ width: LADO, height: LADO, background: hay ? "rgba(133,183,235,.45)" : "transparent" }} />
            );
          })}
        </div>
      ))}
    </div>
  );
}
