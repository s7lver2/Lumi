// ponytail: @types/react 19 movió el namespace JSX global a React.JSX; el
// plan asumía React 18. Mismo tipo, ruta distinta.
const PATHS: Record<string, React.JSX.Element> = {
  check: <path d="M20 6 9 17l-5-5" />,
  pause: <path d="M9 5v14M15 5v14" />,
  spinner: <path d="M21 12a9 9 0 1 1-2.64-6.36" />,
  refresh: <><path d="M21 12a9 9 0 1 1-2.64-6.36" /><path d="M21 3.5V9h-5.5" /></>,
  alert: (
    <>
      <path d="M12 3.2 22.2 20.8H1.8z" />
      <g style={{ animation: "jg-alert-pulse 2.2s ease-in-out infinite" }}>
        <path d="M12 9.8v4.4" />
        <circle cx="12" cy="17.4" r=".6" fill="currentColor" stroke="none" />
      </g>
    </>
  ),
  chevron: <path d="M6 9l6 6 6-6" />,
  "signal-off": (
    <>
      {[
        "M4.5 9.6a12 12 0 0 1 15 0",
        "M7.7 13.1a7.6 7.6 0 0 1 8.6 0",
        "M10.8 16.5a3.2 3.2 0 0 1 2.4 0",
      ].map((d, i) => (
        <path key={d} d={d} style={{ animation: `jg-scan 2.4s ${i * 0.18}s ease-in-out infinite` }} />
      ))}
      <circle cx="12" cy="19.4" r=".6" fill="currentColor" stroke="none" />
      <path d="M3.8 3.8 20.2 20.2" />
    </>
  ),
  x: <path d="M18 6 6 18M6 6l12 12" />,
  github: <path d="M12 3.5c-4.6 0-8 3.5-8 7.9 0 3.5 2.2 6.5 5.4 7.5.4.1.5-.2.5-.4v-1.4c-2.2.5-2.7-1-2.7-1-.4-1-.9-1.2-.9-1.2-.7-.5.1-.5.1-.5.8.1 1.2.8 1.2.8.7 1.2 1.9.9 2.4.7.1-.5.3-.9.5-1.1-1.8-.2-3.7-.9-3.7-4 0-.9.3-1.6.8-2.2-.1-.2-.4-1 .1-2.1 0 0 .7-.2 2.2.8a7.4 7.4 0 0 1 4 0c1.5-1 2.2-.8 2.2-.8.5 1.1.2 1.9.1 2.1.5.6.8 1.3.8 2.2 0 3.1-1.9 3.8-3.7 4 .3.3.6.8.6 1.6v2.4c0 .2.1.5.5.4A8.1 8.1 0 0 0 20 11.4c0-4.4-3.4-7.9-8-7.9Z" />,
  user: <><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  device: <><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8M12 16v4" /></>,
  shield: <path d="M12 3l8 4v5c0 5-3.5 7.5-8 9-4.5-1.5-8-4-8-9V7l8-4z" />,
  plus: <path d="M12 5v14M5 12h14" />,
  bell: (
    <>
      <path d="M18 8a6 6 0 1 0-12 0c0 7-3 8-3 8h18s-3-1-3-8" />
      <path d="M13.7 21a2 2 0 0 1-3.4 0" />
    </>
  ),
  logo: <path d="M12 2l9 4.5-9 4.5-9-4.5L12 2z" />,
  layers: (
    <>
      <path d="M12 2l9 4.5-9 4.5-9-4.5L12 2z" />
      <path d="M3 12l9 4.5 9-4.5" />
      <path d="M3 17l9 4.5 9-4.5" />
    </>
  ),
  users: (
    <>
      <path d="M16 20v-1.5a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4V20" />
      <circle cx="9" cy="7" r="3.5" />
      <path d="M22 20v-1.5a4 4 0 0 0-3-3.87M16 3.6a4 4 0 0 1 0 7.75" />
    </>
  ),
  search: <><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.35-4.35" /></>,
  image: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="8.5" cy="9.5" r="1.4" />
      <path d="M21 16l-5-5a2 2 0 0 0-2.8 0L4 20" />
    </>
  ),
  folder: <path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />,
  back: <path d="M15 5l-7 7 7 7" />,
  trash: <><path d="M4 7h16M10 7V4.5h4V7M6 7l1 13h10l1-13" /></>,
  globe: <><circle cx="12" cy="12" r="9" /><path d="M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18M3 12h18" /></>,
  logout: <><path d="M15 17l5-5-5-5" /><path d="M20 12H9" /><path d="M12 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h6" /></>,
  expand: <path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2h-3M8 21H5a2 2 0 0 1-2-2v-3" />,
  /** Candado quieto. `LockIcon` es el que respira, y respirando tres veces en
   *  una columna de widgets bloqueados distrae más de lo que informa. */
  lock: <><rect x="5" y="11" width="14" height="9" rx="1.5" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></>,
  cloud: <path d="M6 16a4 4 0 0 1 .8-7.9 5.5 5.5 0 0 1 10.6 1.4A3.5 3.5 0 0 1 17 16z" />,
  boxes: <><rect x="4" y="4" width="7" height="7" rx="1.5" /><rect x="13" y="13" width="7" height="7" rx="1.5" /></>,
  // Tres deslizadores con su mando en alturas distintas: el gesto universal de
  // «ajustes», que `boxes` (dos cajas apiladas) no comunicaba en absoluto.
  ajustes: (
    <>
      <path d="M4 7h6M16 7h4" />
      <circle cx="12" cy="7" r="2.2" />
      <path d="M4 12h2M12 12h8" />
      <circle cx="8.5" cy="12" r="2.2" />
      <path d="M4 17h10M18 17h2" />
      <circle cx="16" cy="17" r="2.2" />
    </>
  ),
  territorio: (
    <>
      <path d="M9 3 3 5.5v15L9 18l6 3 6-2.5v-15L15 6z" />
      <path d="M9 3v15M15 6v15" />
    </>
  ),
  ingesta: (
    <>
      <path d="M12 15V3" />
      <path d="M7.5 10.5 12 15l4.5-4.5" />
      <path d="M4 18.5h16" />
    </>
  ),
  pin: (
    <>
      <path d="M12 21s7-5.5 7-11a7 7 0 1 0-14 0c0 5.5 7 11 7 11z" />
      <circle cx="12" cy="10" r="2.4" />
    </>
  ),
  // ponytail: no la trae el plan explícitamente en la tarea 7, pero
  // CoveragePanel y BlockedDialog (tarea 15) piden `name="info"` — sin ella
  // esas pantallas no compilan. Un icono más, mismo patrón que los otros tres.
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 8h.01M11 12h1v5h1" /></>,
  poligono: <><path d="M4 4h7l9 9-7 7-9-9z" /><circle cx="8.5" cy="8.5" r=".6" fill="currentColor" stroke="none" /></>,
  rectangulo: <rect x="4" y="4" width="16" height="16" rx="2" />,
  circulo: <circle cx="12" cy="12" r="8" />,
  // Un lápiz: la herramienta que edita un trazo ya cerrado, distinta de
  // dibujar uno nuevo.
  editar: <><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></>,
  // Deshacer/rehacer como un par de flechas en espejo, mismo trazo, para que
  // se lean como opuestos a simple vista.
  deshacer: <><path d="M9 14 4 9l5-5" /><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" /></>,
  rehacer: <><path d="M15 14l5-5-5-5" /><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13" /></>,
  restar: <path d="M5 12h14" />,
  mano: (
    <>
      <path d="M12 2v20M2 12h20" />
      <path d="M5 9 2 12l3 3M19 9l3 3-3 3M9 5l3-3 3 3M9 19l3 3 3-3" />
    </>
  ),
  // Tres nodos conectados: un vector saliendo de una imagen. Es el icono de
  // la cola de embebido, aparte de "ingesta" (la flecha de descarga) porque
  // son destinos distintos ahora — bajar imágenes no es lo mismo que
  // convertirlas en vectores.
  embebido: (
    <>
      <circle cx="6" cy="6" r="2.1" />
      <circle cx="18" cy="6" r="2.1" />
      <circle cx="12" cy="18" r="2.1" />
      <path d="M7.7 7.3 10.7 16M16.3 7.3 13.3 16M8.1 6h7.8" />
    </>
  ),
};

/** El candado es aparte: su arco se anima al abrirse. */
export function LockIcon({ size = 13, open = false, className = "" }:
  { size?: number; open?: boolean; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className={className}
      style={open ? undefined : { animation: "jg-lock-breathe 2.6s ease-in-out infinite" }}>
      <rect x="5" y="11" width="14" height="9" rx="1.5" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4"
        style={{
          transformBox: "fill-box", transformOrigin: "0% 100%",
          transform: open ? "translateY(-2.2px) rotate(-17deg)" : "none",
          transition: "transform .75s cubic-bezier(.16,1,.3,1)",
        }} />
    </svg>
  );
}

export function Icon({ name, size = 13, className = "" }:
  { name: keyof typeof PATHS; size?: number; className?: string }) {
  const spin = name === "spinner" || name === "refresh";
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={name === "check" || name === "chevron" ? 2 : 1.8}
      strokeLinecap="round" strokeLinejoin="round"
      className={`shrink-0 ${className}`}
      style={spin ? { animation: `lumi-spin ${size > 20 ? 2.6 : 1.1}s linear infinite` } : undefined}>
      {PATHS[name]}
    </svg>
  );
}
