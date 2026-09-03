import climaAparente from "../../registros/agentes/clima-aparente.json";
import dimensiones from "../../registros/agentes/dimensiones.json";
import escena from "../../registros/agentes/escena.json";
import estacion from "../../registros/agentes/estacion.json";
import horaSombras from "../../registros/agentes/hora-sombras.json";
import idioma from "../../registros/agentes/idioma.json";
import ladoConduccion from "../../registros/agentes/lado-conduccion.json";
import matricula from "../../registros/agentes/matricula.json";
import meteorologia from "../../registros/agentes/meteorologia.json";
import senalizacion from "../../registros/agentes/senalizacion.json";
import toponimos from "../../registros/agentes/toponimos.json";
import vegetacion from "../../registros/agentes/vegetacion.json";

export type Agente = { id: string; nombre: string; tipo: string; restriccion?: string };

const REGISTRO = [
  climaAparente, dimensiones, escena, estacion, horaSombras, idioma,
  ladoConduccion, matricula, meteorologia, senalizacion, toponimos, vegetacion,
] as Agente[];

/** Los doce agentes reales, ordenados por nombre. */
export function agentes(): Agente[] {
  return [...REGISTRO].sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
}
