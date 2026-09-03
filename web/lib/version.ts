import manifiesto from "../releases/versiones.json";

type Artefacto = { plataforma: string; url: string; bytes: number; sha256: string };
type Publicacion = {
  producto: string; version: string; publicado: string; retirada?: boolean;
  artefactos?: Artefacto[];
};

function ultimaPublicacion(producto: string): Publicacion | null {
  const pubs = (manifiesto.publicaciones ?? []) as Publicacion[];
  const validas = pubs.filter((p) => p.producto === producto && !p.retirada);
  if (validas.length === 0) return null;
  return validas.reduce((a, b) => (a.publicado > b.publicado ? a : b));
}

/** La publicación de `cliente` más reciente y no retirada. `null` si no hay
 *  ninguna — en ese caso el nav no enseña indicador, no enseña un cero. */
export function ultimaVersion(): { version: string; publicado: string } | null {
  const ultima = ultimaPublicacion("cliente");
  if (!ultima) return null;
  return { version: ultima.version, publicado: ultima.publicado };
}

/** Los artefactos reales del cliente para la última publicación — la lista
 *  que alimenta el selector de descarga del hero. Nunca se inventan
 *  plataformas: si el manifiesto solo publicó windows-x86_64, el selector
 *  solo ofrece esa. `[]` si no hay publicación de `cliente`. */
export function artefactosCliente(): Artefacto[] {
  return ultimaPublicacion("cliente")?.artefactos ?? [];
}
