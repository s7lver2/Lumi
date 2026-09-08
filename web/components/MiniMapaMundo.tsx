import { proyectar, siluetaContinentes } from "../lib/tiles";

/** El mismo mapa que `Cobertura.tsx` (geografía real, misma proyección),
 *  a tamaño de tarjeta y con puntos declarados a mano en vez de leídos del
 *  catálogo — aquí no se mide cobertura real, se ilustra dónde suele estar
 *  algo (idioma, especie, mercado de un coche). Los puntos son aproximados
 *  a propósito: transmiten la idea sin prometer un dato geográfico exacto. */
export function MiniMapaMundo({ puntos, ancho = 320, alto = 168 }: {
  puntos: { lon: number; lat: number }[];
  ancho?: number;
  alto?: number;
}) {
  const { path } = siluetaContinentes(ancho, alto);
  return (
    <svg viewBox={`0 0 ${ancho} ${alto}`} className="w-full" role="img" aria-hidden>
      <rect width={ancho} height={alto} fill="#101216" />
      <path d={path} fill="rgba(232,232,230,.08)" stroke="rgba(232,232,230,.16)" strokeWidth={0.6} />
      {puntos.map((p, i) => {
        const { x, y } = proyectar(p.lon, p.lat, ancho, alto);
        return (
          <circle
            key={i}
            cx={x}
            cy={y}
            r={2.6}
            fill="#f2f3f5"
            className="jg-baliza"
            style={{ animationDelay: `${(i % 7) * 0.25}s` }}
          />
        );
      })}
    </svg>
  );
}
