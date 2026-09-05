import desreclamos from "../releases/desreclamos.json";

const ETIQUETA = "lumi-index"; // el mismo topic que fija catalogo::ETIQUETA en el Indexer

/** Una tesela reclamada, con su dueño — es lo que permite que el mapa
 *  interactivo de /indexado resalte "las teselas de fulano" en vez de solo
 *  contar cuántas hay. `Cobertura` (home) no necesita el detalle, solo el
 *  recuento, así que sigue usando `quadkeys`/`paquetes`/`autores`. */
export type TeselaCatalogo = { quadkey: string; autor: string; paquete: string };
type Resumen = { teselas: TeselaCatalogo[]; quadkeys: string[]; paquetes: number; autores: number };

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

    // Mapa por quadkey, no Set: cada tesela reclamada guarda quién la
    // reclamó. Si dos fichas declararan la misma tesela (no debería pasar
    // en un catálogo sano), la última en procesarse gana — mismo criterio
    // que el Set anterior, que también se quedaba con una sola.
    const porQuadkey = new Map<string, TeselaCatalogo>();
    const autores = new Set<string>();
    const paquetesVistos = new Set<string>();

    type Ficha = {
      paquete: string; autor: string; fuentes_por_quadkey: [string, string[]][];
      dependencias?: { paquete: string; autor: string; url: string }[];
    };

    function anotar(f: Ficha) {
      if (retirados.has(f.paquete) || paquetesVistos.has(f.paquete)) return;
      paquetesVistos.add(f.paquete);
      autores.add(f.autor);
      for (const [qk] of f.fuentes_por_quadkey ?? []) {
        porQuadkey.set(qk, { quadkey: qk, autor: f.autor, paquete: f.paquete });
      }
    }

    // Una dependencia declarada en una ficha no tiene por qué vivir en un
    // repo con el topic `lumi-index` propio: puede ser OTRO release del
    // MISMO repo (`.../releases/download/<otra-tag>/ficha.json`), que
    // `/releases/latest` nunca ve porque solo hay un "latest" por repo. Se
    // sigue la URL declarada directamente, igual que `lumid::instalar()`
    // camina `Ficha.dependencias[].url` en vez de asumir que todo paquete
    // tiene su propio repo buscable.
    const porVer: string[] = [];
    async function seguirDependencia(url: string) {
      try {
        const r = await fetch(url, { next: { revalidate: 3600 } });
        if (!r.ok) return;
        const f = (await r.json()) as Ficha;
        if (paquetesVistos.has(f.paquete)) return;
        anotar(f);
        for (const d of f.dependencias ?? []) if (!paquetesVistos.has(d.paquete)) porVer.push(d.url);
      } catch {
        // Una dependencia que no responde no tira abajo el resto del
        // catálogo — se omite, como una tesela rota en `lumid::instalar()`.
      }
    }

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
      const f = (await fr.json()) as Ficha;
      anotar(f);
      for (const d of f.dependencias ?? []) if (!paquetesVistos.has(d.paquete)) porVer.push(d.url);
    }

    // BFS igual que `lumid::instalar()`: las dependencias de una dependencia
    // también cuentan, y `paquetesVistos` corta cualquier ciclo.
    while (porVer.length > 0) {
      await seguirDependencia(porVer.pop()!);
    }

    const teselas = [...porQuadkey.values()];
    return { teselas, quadkeys: teselas.map((t) => t.quadkey), paquetes: paquetesVistos.size, autores: autores.size };
  } catch {
    return null;
  }
}

export type Contribuidor = { autor: string; teselas: number };

/** Ranking de autores por teselas publicadas — la misma cuenta que ya trae
 *  `cobertura()`, no una consulta aparte. Se pasa el `Resumen` ya resuelto
 *  para no repetir las llamadas a GitHub. */
export function topContribuidores(resumen: Resumen, n = 3): Contribuidor[] {
  const cuentas = new Map<string, number>();
  for (const t of resumen.teselas) cuentas.set(t.autor, (cuentas.get(t.autor) ?? 0) + 1);
  return [...cuentas.entries()]
    .map(([autor, teselas]) => ({ autor, teselas }))
    .sort((a, b) => b.teselas - a.teselas)
    .slice(0, n);
}
