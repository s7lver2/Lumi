type Props = {
  glifo: "camino" | "engranaje" | "llave" | "mapa" | "caja" | "capas";
  className?: string;
};

/** Un glifo de trazo por rama de /docs — pequeño junto al nombre en el
 *  árbol, grande y muy tenue tras la cabecera de portada de cada rama
 *  (spec §3 C). Cinco formas simples, coherentes con el resto de iconos
 *  de la web (candado, check, chevron, info en DESIGN.md). */
export function GlifoRama({ glifo, className }: Props) {
  const comun = {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.7,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    className,
  };
  switch (glifo) {
    case "camino":
      return (
        <svg {...comun}>
          <path d="M4 20c2-6 4-9 8-9s6 3 8 9" />
          <circle cx="12" cy="6" r="2.6" />
        </svg>
      );
    case "engranaje":
      return (
        <svg {...comun}>
          <circle cx="12" cy="12" r="3.2" />
          <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1" />
        </svg>
      );
    case "llave":
      return (
        <svg {...comun}>
          <circle cx="7.5" cy="14.5" r="3.5" />
          <path d="M10 12l9-9M17 5l2 2M14 8l2 2" />
        </svg>
      );
    case "mapa":
      return (
        <svg {...comun}>
          <path d="M9 4L4 6v14l5-2 6 2 5-2V4l-5 2-6-2z" />
          <path d="M9 4v14M15 6v14" />
        </svg>
      );
    case "caja":
      return (
        <svg {...comun}>
          <path d="M4 8l8-4 8 4-8 4-8-4z" />
          <path d="M4 8v8l8 4 8-4V8M12 12v8" />
        </svg>
      );
    case "capas":
      // Tres generaciones apiladas, la de más arriba (la última) despegada
      // del resto — no un simple montón, una línea temporal vista de lado.
      return (
        <svg {...comun}>
          <path d="M4 17l8 4 8-4" />
          <path d="M4 12l8 4 8-4" />
          <path d="M12 3L4 7l8 4 8-4-8-4z" />
        </svg>
      );
  }
}
