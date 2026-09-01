import { NextRequest, NextResponse } from "next/server";

/// Fase 1 de la liberación de teselas (BUG_BOUNTY #38): el Indexer, autenticado
/// con el mismo testigo de GitHub que ya usa para publicar, pide aquí que se
/// libere territorio suyo. La clave privada Ed25519 que firma
/// `desreclamos.json` NUNCA pasa por este fichero ni por ningún otro de
/// `web/` — vive solo en `~/.lumi-indexer/desreclamos.key` de quien firma
/// (ver `crates/lumi-index/src/desreclamos.rs`). Esta ruta solo verifica
/// propiedad y apunta la solicitud; firmarla sigue siendo un paso manual y
/// offline con `firmar_desreclamos` (Tarea 3 de este mismo plan).
///
/// Contrato: POST, header `Authorization: Bearer <testigo de GitHub del
/// usuario>`, body `{repo, paquete, quadkeys}`. El `repo` (owner/nombre) hace
/// falta porque `paquete` por sí solo no localiza la ficha — es el mismo dato
/// que el Indexer ya conoce de sobra (`catalogo::mios` agrupa exactamente
/// así). Nunca se confía en el campo `cuenta` que pudiera mandar el cliente:
/// el login real sale de `GET /user` con el propio testigo.

/// Repositorio de este monorepo — donde vive `web/releases/` y donde se
/// apunta la cola de solicitudes pendientes. No es configurable: es el mismo
/// repo que sirve esta API.
const REPO_MONOREPO = "s7lver2/Lumi";
const RUTA_COLA = "web/releases/liberaciones-pendientes.json";

interface SolicitudBody {
  repo?: string;
  paquete?: string;
  quadkeys?: string[];
}

interface FichaRemota {
  paquete: string;
  autor: string;
}

interface EntradaPendiente {
  paquete: string;
  quadkeys: string[];
  cuenta: string;
  fecha: string;
}

async function loginDeGithub(testigo: string): Promise<string | null> {
  const r = await fetch("https://api.github.com/user", {
    headers: { authorization: `Bearer ${testigo}`, "user-agent": "lumi-web" },
  });
  if (!r.ok) return null;
  const u = (await r.json()) as { login?: string };
  return u.login ?? null;
}

/// La misma búsqueda que hace el Indexer (`catalogo::fichas_de_repo`): todos
/// los releases del repo, todos los assets `ficha.json`, hasta encontrar el
/// que declara este `paquete`. Sin caché — esto no corre al mover el mapa,
/// corre una vez por solicitud.
async function fichaDelPaquete(repo: string, paquete: string): Promise<FichaRemota | null> {
  const rr = await fetch(`https://api.github.com/repos/${repo}/releases?per_page=100`, {
    headers: { "user-agent": "lumi-web" },
  });
  if (!rr.ok) return null;
  const releases = (await rr.json()) as { assets: { name: string; browser_download_url: string }[] }[];
  for (const rel of releases) {
    for (const asset of rel.assets.filter((a) => a.name === "ficha.json")) {
      const fr = await fetch(asset.browser_download_url);
      if (!fr.ok) continue;
      const ficha = (await fr.json()) as FichaRemota;
      if (ficha.paquete === paquete) return ficha;
    }
  }
  return null;
}

/// Lee-modifica-escribe `liberaciones-pendientes.json` con el PAT del propio
/// proyecto (nunca el del usuario, que solo sirvió para verificar identidad).
/// Un fichero ausente (primera solicitud de siempre) es un array vacío, no un
/// error.
async function anadirALaCola(pat: string, entrada: EntradaPendiente): Promise<void> {
  const url = `https://api.github.com/repos/${REPO_MONOREPO}/contents/${RUTA_COLA}`;
  const actual = await fetch(url, {
    headers: { authorization: `Bearer ${pat}`, "user-agent": "lumi-web" },
  });

  let lista: EntradaPendiente[] = [];
  let sha: string | undefined;
  if (actual.status === 200) {
    const j = (await actual.json()) as { content: string; sha: string };
    lista = JSON.parse(Buffer.from(j.content, "base64").toString("utf-8"));
    sha = j.sha;
  } else if (actual.status !== 404) {
    throw new Error(`no se pudo leer la cola pendiente: ${actual.status}`);
  }

  lista.push(entrada);
  const contenido = Buffer.from(JSON.stringify(lista, null, 2)).toString("base64");

  const put = await fetch(url, {
    method: "PUT",
    headers: {
      authorization: `Bearer ${pat}`,
      "user-agent": "lumi-web",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      message: `liberación pendiente: ${entrada.paquete} (${entrada.quadkeys.length} teselas) de ${entrada.cuenta}`,
      content: contenido,
      sha,
    }),
  });
  if (!put.ok) {
    throw new Error(`no se pudo escribir la cola pendiente: ${put.status}`);
  }
}

export async function POST(req: NextRequest) {
  const auth = req.headers.get("authorization") ?? "";
  const testigo = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length) : "";
  if (!testigo) {
    return NextResponse.json({ error: "falta el testigo de GitHub" }, { status: 401 });
  }

  let body: SolicitudBody;
  try {
    body = (await req.json()) as SolicitudBody;
  } catch {
    return NextResponse.json({ error: "cuerpo inválido" }, { status: 400 });
  }
  const { repo, paquete, quadkeys } = body;
  if (!repo || !paquete || !quadkeys || quadkeys.length === 0) {
    return NextResponse.json({ error: "faltan repo, paquete o quadkeys" }, { status: 400 });
  }

  const login = await loginDeGithub(testigo);
  if (!login) {
    return NextResponse.json({ error: "testigo de GitHub inválido" }, { status: 401 });
  }

  const ficha = await fichaDelPaquete(repo, paquete);
  if (!ficha) {
    return NextResponse.json({ error: "no se encontró ese paquete en ese repositorio" }, { status: 404 });
  }
  if (ficha.autor !== login) {
    return NextResponse.json({ error: "esa cuenta no es la autora de ese paquete" }, { status: 403 });
  }

  // El PAT del propio proyecto para escribir en `web/releases/`. Si no está
  // configurado en Vercel, esto falla de forma explícita en vez de fingir que
  // la solicitud se guardó.
  const pat = process.env.GITHUB_LIBERACIONES_TOKEN;
  if (!pat) {
    return NextResponse.json(
      { error: "el servidor no tiene configurado GITHUB_LIBERACIONES_TOKEN" },
      { status: 500 },
    );
  }

  try {
    await anadirALaCola(pat, { paquete, quadkeys, cuenta: login, fecha: new Date().toISOString() });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 502 });
  }

  return NextResponse.json({ ok: true });
}
