import registros from "./registrosDocs.generated.json";

type RegistroDoc = {
  id: string;
  nombre: string;
  categoria: string;
  tipo?: string;
  licencia?: string;
  dims?: number;
  ficheroPesos?: string;
  sha256?: string;
  activoEnNiveles: string[];
  alternativaNoActiva: boolean;
};

const TABLA = registros as Record<string, RegistroDoc>;

/** Lee un campo de un registro ya volcado a registrosDocs.generated.json
 *  (spec §2: "Dato de campo: imprime un valor leído de registros/, no
 *  tecleado"). Lanza si el id o el campo no existen — un <Dato> que señala
 *  a la nada debe romper el build, no imprimir "undefined" en silencio. */
export function campoRegistro(id: string, campo: keyof RegistroDoc): unknown {
  const registro = TABLA[id];
  if (!registro) throw new Error(`campoRegistro: no existe el registro "${id}" en registrosDocs.generated.json`);
  const valor = registro[campo];
  if (valor === undefined) throw new Error(`campoRegistro: el registro "${id}" no tiene el campo "${String(campo)}"`);
  return valor;
}

export function registroCompleto(id: string): RegistroDoc {
  const registro = TABLA[id];
  if (!registro) throw new Error(`registroCompleto: no existe el registro "${id}" en registrosDocs.generated.json`);
  return registro;
}
