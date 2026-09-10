/// Acceso compartido a `web/releases/liberaciones-pendientes.json` vía la
/// API de contenidos de GitHub. Mismo repo/ruta y mismo patrón
/// lectura-modificación-escritura que ya usaba en solitario
/// `web/app/api/desreclamos/solicitar/route.ts` — factorizado aquí porque
/// las rutas nuevas de `/api/admin/liberaciones` necesitan leer y (una de
/// ellas) volver a escribir exactamente el mismo fichero.

const REPO_MONOREPO = "s7lver2/Lumi";
const RUTA_COLA = "web/releases/liberaciones-pendientes.json";

/// Fase 1 (`solicitar/route.ts`) nunca escribía `estado`: ausente significa
/// "pendiente". El panel admin sí lo escribe explícitamente al decidir, para
/// que quede constancia clara de "aprobada"/"rechazada" en el propio JSON en
/// vez de depender de que alguien borre la entrada.
export interface EntradaPendiente {
  paquete: string;
  quadkeys: string[];
  cuenta: string;
  fecha: string;
  estado?: "pendiente" | "aprobada" | "rechazada";
}

interface ContenidoGitHub {
  content: string;
  sha: string;
}

/// Lee la cola tal cual está en GitHub. Devuelve `sha: undefined` si el
/// fichero no existe todavía (primera solicitud de siempre) — no es un
/// error, es una lista vacía.
export async function leerCola(pat?: string): Promise<{ lista: EntradaPendiente[]; sha?: string }> {
  const url = `https://api.github.com/repos/${REPO_MONOREPO}/contents/${RUTA_COLA}`;
  const headers: Record<string, string> = { "user-agent": "lumi-web" };
  if (pat) headers.authorization = `Bearer ${pat}`;

  const r = await fetch(url, { headers, cache: "no-store" });
  if (r.status === 404) return { lista: [] };
  if (!r.ok) throw new Error(`no se pudo leer la cola pendiente: ${r.status}`);

  const j = (await r.json()) as ContenidoGitHub;
  const lista = JSON.parse(Buffer.from(j.content, "base64").toString("utf-8")) as EntradaPendiente[];
  return { lista, sha: j.sha };
}

/// Escribe la cola completa de vuelta con el PAT del proyecto
/// (`GITHUB_LIBERACIONES_TOKEN`) — el único testigo autorizado a modificar
/// este fichero. `sha` debe ser el de la última lectura, o GitHub rechaza el
/// PUT por conflicto (alguien más escribió entre medias).
export async function escribirCola(pat: string, lista: EntradaPendiente[], sha: string | undefined, mensaje: string): Promise<void> {
  const url = `https://api.github.com/repos/${REPO_MONOREPO}/contents/${RUTA_COLA}`;
  const contenido = Buffer.from(JSON.stringify(lista, null, 2)).toString("base64");

  const put = await fetch(url, {
    method: "PUT",
    headers: {
      authorization: `Bearer ${pat}`,
      "user-agent": "lumi-web",
      "content-type": "application/json",
    },
    body: JSON.stringify({ message: mensaje, content: contenido, sha }),
  });
  if (!put.ok) {
    throw new Error(`no se pudo escribir la cola pendiente: ${put.status}`);
  }
}

export function estaPendiente(e: EntradaPendiente): boolean {
  return e.estado === undefined || e.estado === "pendiente";
}
