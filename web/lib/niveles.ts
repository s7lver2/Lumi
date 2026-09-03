import mini from "../../registros/niveles/mini.json";
import pro from "../../registros/niveles/pro.json";
import vision from "../../registros/niveles/vision.json";

export type Nivel = {
  id: string; nombre: string;
  recuperacion: string[]; geometricos: string[]; agentes: string[];
  cae_a: string | null;
};

/** Los tres niveles, en orden de menos a más. Salen del registro, así que la
 *  página no puede desincronizarse de lo que el servidor ejecuta de verdad. */
export function niveles(): Nivel[] {
  return [mini, pro, vision] as Nivel[];
}
