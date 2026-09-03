import manifiesto from "../releases/versiones.json";

type Publicacion = { producto: string; version: string; publicado: string; retirada?: boolean };

/** La publicación de `cliente` más reciente y no retirada. `null` si no hay
 *  ninguna — en ese caso el nav no enseña indicador, no enseña un cero. */
export function ultimaVersion(): { version: string; publicado: string } | null {
  const pubs = (manifiesto.publicaciones ?? []) as Publicacion[];
  const validas = pubs.filter((p) => p.producto === "cliente" && !p.retirada);
  if (validas.length === 0) return null;
  const ultima = validas.reduce((a, b) => (a.publicado > b.publicado ? a : b));
  return { version: ultima.version, publicado: ultima.publicado };
}
