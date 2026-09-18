import { Icon } from "../ui/Icon";

/** Icono propio por agente — no una plantilla repetida con el icono
 *  cambiado (DESIGN.md prohíbe rejillas de tarjetas idénticas). Compartido
 *  entre el popup de resultado y el selector del modo Agentes.
 *
 *  Se resuelve por el campo `icono` de la ficha (`registros/agentes/*.json`),
 *  nunca por el `id` del agente -- añadir un agente nuevo no debería tocar
 *  este fichero salvo que quiera un dibujo que no exista todavía (spec
 *  2026-09-17 §7).
 *
 *  `hora-solar` es el único cuyo dibujo depende del dato real: la aguja rota
 *  al ángulo estimado a partir de la hora que dice `etiqueta` ("mediodia" →
 *  12h). El resto son formas fijas, sin dato detrás. */
export function AgenteIcono({ icono, etiqueta, apagado, size = 26 }: {
  icono: string; etiqueta?: string; apagado: boolean; size?: number;
}) {
  const color = apagado ? "#6a6c70" : "#e8e8e6";

  if (icono === "hora-solar") {
    const HORAS: Record<string, number> = {
      amanecer: 7, "media-manana": 10, mediodia: 12, "media-tarde": 15, atardecer: 18, noche: 22,
    };
    const hora = etiqueta && etiqueta in HORAS ? HORAS[etiqueta] : 12;
    // Mediodía (12h) = aguja recta hacia arriba (0°); cada hora de
    // diferencia gira 15° (360°/24h) hacia el lado que corresponda.
    const grados = (hora - 12) * 15;
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.7}
        strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
        <circle cx="12" cy="12" r="8.5" />
        <line x1="12" y1="12" x2="12" y2="6" transform={`rotate(${grados} 12 12)`}
          style={{ transition: "transform 1.1s cubic-bezier(.16,1,.3,1)" }} />
        <circle cx="12" cy="12" r=".6" fill={color} stroke="none" />
      </svg>
    );
  }
  if (icono === "volante") {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.7}
        strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
        <circle cx="12" cy="12" r="8" />
        <circle cx="12" cy="12" r="2" />
        <path d="M12 6v4M8.5 15.5 10.5 13M15.5 15.5 13.5 13" />
      </svg>
    );
  }
  if (icono === "escritura") {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.7}
        strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
        <path d="M4 19V8l4-4h8l4 4v11" />
        <path d="M8 19v-6h8v6M9 9h6" />
      </svg>
    );
  }
  if (icono === "meteorologia") {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.7}
        strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
        <path d="M6 14a4 4 0 0 1 .8-7.9 5.5 5.5 0 0 1 10.6 1.4A3.5 3.5 0 0 1 17 14z" />
        <path d="M8 18v2M12 18.5v2M16 18v2" />
      </svg>
    );
  }
  if (icono === "vegetacion") {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.7}
        strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
        <path d="M12 3 8 9h2.5L7 15h4v6h2v-6h4l-3.5-6H16z" />
      </svg>
    );
  }
  if (icono === "matricula") {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.7}
        strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
        <rect x="3" y="8" width="18" height="8" rx="1.5" />
        <path d="M6.5 12h3M12 12h5.5" />
      </svg>
    );
  }
  if (icono === "senalizacion") {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.7}
        strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
        <path d="M12 4 21 20H3Z" />
        <path d="M12 10v3.5" />
        <circle cx="12" cy="16.3" r=".55" fill={color} stroke="none" />
      </svg>
    );
  }
  if (icono === "toponimos") {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.7}
        strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
        <circle cx="10" cy="10" r="6.5" />
        <path d="M7.3 8.3h5.4M7.3 11.3h3.4" />
        <path d="M14.8 14.8 20 20" />
      </svg>
    );
  }
  // Icono futuro sin dibujo propio todavía: bocadillo genérico, nunca un
  // hueco en blanco.
  return <Icon name="bocadillo" size={size} className={apagado ? "text-subtle" : "text-fg"} />;
}
