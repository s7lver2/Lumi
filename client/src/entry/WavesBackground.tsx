/** Fondo de las pantallas de entrada. Reemplaza al planeta SOLO aquí — el
 *  wizard del owner y la app ya logueada siguen usando `PlanetBackground`,
 *  protegido en DESIGN.md.
 *
 *  Cinco capas onduladas duplicadas a 200% de ancho, desplazadas en bucle con
 *  `lumi-planet-spin` (el mismo keyframe translateX que ya usa el planeta) a
 *  velocidades y sentidos distintos para que no se sincronicen. Solo colores
 *  de la tabla de DESIGN.md: border/subtle para las líneas, draw/draw-fg para
 *  el pulso — nada nuevo. */

const LAYERS = [
  { path: "M0,40 Q80,-10 160,40 T320,40 T480,40 T640,40 T800,40", color: "#26282c", width: 1.3, opacity: .4, duration: "40s", reverse: false },
  { path: "M0,80 Q80,35 160,80 T320,80 T480,80 T640,80 T800,80", color: "#6a6c70", width: 1.1, opacity: .22, duration: "18s", reverse: true },
  { path: "M0,175 Q80,210 160,175 T320,175 T480,175 T640,175 T800,175", color: "#6a6c70", width: 1, opacity: .3, duration: "27s", reverse: false },
  { path: "M0,215 Q80,195 160,215 T320,215 T480,215 T640,215 T800,215", color: "#26282c", width: 1, opacity: .8, duration: "12s", reverse: true },
];

const PULSE = { path: "M0,130 Q80,85 160,130 T320,130 T480,130 T640,130 T800,130", color: "#378add" };

function duplicated(path: string) {
  // La segunda mitad repite la primera desplazada 800px: el bucle de
  // translateX(-50%) no deja costura visible.
  const shifted = path.replace(/(-?\d+(?:\.\d+)?),/g, (_m, n) => `${Number(n) + 800},`);
  return `${path} ${shifted}`;
}

export function WavesBackground() {
  return (
    <div className="fixed inset-0 -z-10 overflow-hidden bg-[#08090a]">
      <div className="absolute inset-0"
        style={{ background: "radial-gradient(ellipse at 50% 40%, transparent 40%, #050607 100%)" }} />
      {LAYERS.map((l, i) => (
        <svg key={i} viewBox="0 0 800 240" preserveAspectRatio="none"
          className="absolute left-0 top-0 h-full w-[200%]"
          style={{ animation: `lumi-planet-spin ${l.duration} linear infinite`, animationDirection: l.reverse ? "reverse" : "normal" }}>
          <path d={duplicated(l.path)} fill="none" stroke={l.color} strokeWidth={l.width} opacity={l.opacity} />
        </svg>
      ))}
      <svg viewBox="0 0 800 240" preserveAspectRatio="none" className="absolute left-0 top-0 h-full w-[200%]"
        style={{ animation: "lumi-planet-spin 22s linear infinite" }}>
        <path d={duplicated(PULSE.path)} fill="none" stroke={PULSE.color} strokeWidth={1}
          style={{ animation: "jg-core-pulse 3.4s ease-in-out infinite" }} />
      </svg>
    </div>
  );
}
