import desreclamos from "../releases/desreclamos.json";

const ETIQUETA = "lumi-index"; // el mismo topic que fija catalogo::ETIQUETA en el Indexer

type Resumen = { quadkeys: string[]; paquetes: number; autores: number };

/** Agrega el catálogo publicado: repos con el topic `lumi-index`, sus fichas,
 *  y los desreclamos que esta misma web firma. Devuelve `null` si GitHub no
 *  responde — la sección lo dice, nunca inventa un número. */
export async function cobertura(): Promise<Resumen | null> {
  const cabeceras: Record<string, string> = { accept: "application/vnd.github+json" };
  if (process.env.GITHUB_LIBERACIONES_TOKEN) {
    cabeceras.authorization = `Bearer ${process.env.GITHUB_LIBERACIONES_TOKEN}`;
  }
  try {
    const busqueda = await fetch(
      `https://api.github.com/search/repositories?q=topic:${ETIQUETA}&per_page=100`,
      { headers: cabeceras, next: { revalidate: 3600 } },
    );
    if (!busqueda.ok) return null;
    const repos = ((await busqueda.json()).items ?? []) as { full_name: string }[];

    // Los paquetes retirados por la web no cuentan como cobertura.
    const retirados = new Set(
      ((desreclamos as { lista?: [string, string][] }).lista ?? []).map(([paquete]) => paquete),
    );

    const quadkeys = new Set<string>();
    const autores = new Set<string>();
    let paquetes = 0;

    for (const repo of repos) {
      // La ficha viaja en claro como asset del release más reciente.
      const rel = await fetch(
        `https://api.github.com/repos/${repo.full_name}/releases/latest`,
        { headers: cabeceras, next: { revalidate: 3600 } },
      );
      if (!rel.ok) continue;
      const assets = ((await rel.json()).assets ?? []) as { name: string; browser_download_url: string }[];
      const ficha = assets.find((a) => a.name === "ficha.json");
      if (!ficha) continue;

      const fr = await fetch(ficha.browser_download_url, { next: { revalidate: 3600 } });
      if (!fr.ok) continue;
      const f = (await fr.json()) as {
        paquete: string; autor: string; fuentes_por_quadkey: [string, string[]][];
      };
      if (retirados.has(f.paquete)) continue;

      paquetes += 1;
      autores.add(f.autor);
      for (const [qk] of f.fuentes_por_quadkey ?? []) quadkeys.add(qk);
    }

    return { quadkeys: [...quadkeys], paquetes, autores: autores.size };
  } catch {
    return null;
  }
}
