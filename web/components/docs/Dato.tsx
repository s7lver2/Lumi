import { campoRegistro } from "../../lib/registros";

export function Dato({ id, campo }: { id: string; campo: string }) {
  const valor = campoRegistro(id, campo as never);
  return <span className="font-mono text-fg">{String(valor)}</span>;
}
