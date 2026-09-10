import { Icon } from "../ui/Icon";

/** Icono propio por agente — no una plantilla repetida con el icono
 *  cambiado (DESIGN.md prohíbe rejillas de tarjetas idénticas). Compartido
 *  entre el panel de resultados (`ResultsDrawer`) y el selector del modo
 *  Agentes (`AgentesView`): es el mismo agente, la misma cara en las dos
 *  pantallas.
 *
 *  El de `hora-sombras` es el único cuyo dibujo depende del dato real: la
 *  aguja rota al ángulo estimado a partir de la hora que dice `etiqueta`
 *  ("~13:00" → 13h) — solo tiene sentido con un veredicto ya resuelto, así
 *  que en el selector (sin `etiqueta` todavía) se queda quieta al mediodía.
 *  El resto son formas fijas, sin dato detrás. */
export function AgenteIcono({ agente, etiqueta, apagado, size = 26 }: {
  agente: string; etiqueta?: string; apagado: boolean; size?: number;
}) {
  const color = apagado ? "#6a6c70" : "#e8e8e6";
  // Un veredicto de agente fusionado llega como "<fusionado>.<sub>" (p.ej.
  // "condiciones-ambientales.clima-aparente") — la sub-pregunta es la que
  // tiene un icono propio y significativo, así que se usa esa mitad para
  // decidir el dibujo. Un id sin punto (agente suelto, o la propia tarjeta
  // fusionada en el picker) se queda tal cual.
  agente = agente.includes(".") ? agente.split(".").pop()! : agente;
  if (agente === "hora-sombras") {
    const m = etiqueta ? /(\d{1,2})(?::\d{2})?/.exec(etiqueta) : null;
    const hora = m ? Number(m[1]) : 12;
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
  // Tarjetas del picker de las tres fichas fusionadas (spec 2026-09-10 §1):
  // el icono es el de la primera de sus sub-preguntas, no uno nuevo — es la
  // misma cara que ya tenía esa pregunta cuando era un agente suelto.
  if (agente === "condiciones-ambientales" || agente === "clima-aparente") {
    return <Icon name="cloud" size={size} className={apagado ? "text-subtle" : "text-fg"} />;
  }
  if (agente === "indicios-viales" || agente === "lado-conduccion") {
    return <Icon name="via" size={size} className={apagado ? "text-subtle" : "text-fg"} />;
  }
  if (agente === "meteorologia") {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.7}
        strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
        <path d="M6 14a4 4 0 0 1 .8-7.9 5.5 5.5 0 0 1 10.6 1.4A3.5 3.5 0 0 1 17 14z" />
        <path d="M8 18v2M12 18.5v2M16 18v2" />
      </svg>
    );
  }
  if (agente === "estacion") {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.7}
        strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
        <path d="M12 3c5 2 7 6 7 10a7 7 0 0 1-14 0c0-4 2-8 7-10Z" />
        <path d="M12 21V9" />
      </svg>
    );
  }
  if (agente === "vegetacion") {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.7}
        strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
        <path d="M12 3 8 9h2.5L7 15h4v6h2v-6h4l-3.5-6H16z" />
      </svg>
    );
  }
  if (agente === "escena") {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.7}
        strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
        <path d="M3 21V9.5l5-4 5 4V21" />
        <path d="M13 21v-7h4v7" />
        <path d="M17 21v-4.5h4V21" />
      </svg>
    );
  }
  if (agente === "dimensiones") {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.7}
        strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
        <rect x="4" y="4" width="16" height="16" rx="2" />
        <path d="M4 15l4-4 4 3 5-6" />
      </svg>
    );
  }
  if (agente === "matricula") {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.7}
        strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
        <rect x="3" y="8" width="18" height="8" rx="1.5" />
        <path d="M6.5 12h3M12 12h5.5" />
      </svg>
    );
  }
  if (agente === "senalizacion") {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.7}
        strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
        <path d="M12 4 21 20H3Z" />
        <path d="M12 10v3.5" />
        <circle cx="12" cy="16.3" r=".55" fill={color} stroke="none" />
      </svg>
    );
  }
  if (agente === "texto-en-escena" || agente === "toponimos") {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.7}
        strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
        <circle cx="10" cy="10" r="6.5" />
        <path d="M7.3 8.3h5.4M7.3 11.3h3.4" />
        <path d="M14.8 14.8 20 20" />
      </svg>
    );
  }
  // "idioma" y cualquier agente futuro sin icono propio: bocadillo genérico.
  return <Icon name="bocadillo" size={size} className={apagado ? "text-subtle" : "text-fg"} />;
}
