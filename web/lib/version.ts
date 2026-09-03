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

export type ProductoDescargable = { producto: string; version: string; artefactos: Artefacto[] };

// Los cuatro binarios que de verdad publica tools/release_flow.py — nunca se
// inventa un quinto. El CLI `lumi` no está en esta lista porque no se
// publica todavía (ver /install, que instala vía script en vez de binario).
const PRODUCTOS_PUBLICABLES = ["cliente", "indexer", "lumid", "instalador"] as const;

/** La última publicación de cada producto real, con sus artefactos. Un
 *  producto que nunca se publicó, o que solo tiene publicaciones retiradas,
 *  no aparece — el selector nunca ofrece un producto sin nada que
 *  descargar. */
export function productosDescargables(): ProductoDescargable[] {
  const resultado: ProductoDescargable[] = [];
  for (const producto of PRODUCTOS_PUBLICABLES) {
    const ultima = ultimaPublicacion(producto);
    if (ultima && ultima.artefactos?.length) {
      resultado.push({ producto, version: ultima.version, artefactos: ultima.artefactos });
    }
  }
  return resultado;
}
