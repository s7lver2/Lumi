#!/usr/bin/env node
// Genera web/lib/indiceDocs.json y web/lib/registrosDocs.generated.json a
// partir de web/app/docs/**/page.mdx y de registros/**/*.json en la raíz
// del repo. Es el único punto que lee fuera de web/ (spec §2): en tiempo de
// ejecución del sitio nada sale de web/, todo pasa por estos dos ficheros
// generados. Se engancha como predev/prebuild en package.json.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIR = path.resolve(AQUI, "..");
const REPO_DIR = path.resolve(WEB_DIR, "..");
const DOCS_DIR = path.join(WEB_DIR, "app", "docs");
const LIB_DIR = path.join(WEB_DIR, "lib");

// Duplicado deliberado de web/lib/slug.ts: este script corre en Node antes
// de que exista ningún paso de compilación de TypeScript, así que no puede
// importar ese fichero. Debe producir exactamente el mismo id que
// EncabezadoDocs calcula en el navegador. // ponytail
function slugificar(texto) {
  return texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-+|-+$)/g, "");
}

function listarMdx(dir) {
  const resultado = [];
  for (const entrada of readdirSync(dir, { withFileTypes: true })) {
    const ruta = path.join(dir, entrada.name);
    if (entrada.isDirectory()) resultado.push(...listarMdx(ruta));
    else if (entrada.name === "page.mdx") resultado.push(ruta);
  }
  return resultado;
}

function fechaGitDelFichero(rutaAbsoluta) {
  try {
    const salida = execFileSync("git", ["log", "-1", "--format=%cI", "--", rutaAbsoluta], {
      cwd: REPO_DIR,
      encoding: "utf8",
    }).trim();
    return salida || null;
  } catch {
    return null;
  }
}

function extraerExportString(texto, nombre) {
  const m = texto.match(new RegExp(`export const ${nombre} = "((?:[^"\\\\]|\\\\.)*)";`));
  return m ? m[1].replace(/\\"/g, '"') : null;
}

function extraerExportArray(texto, nombre) {
  const m = texto.match(new RegExp(`export const ${nombre} = (\\[[\\s\\S]*?\\]);`));
  if (!m) return [];
  // El array solo contiene literales de string (rutas de fichero), así que
  // un Function() controlado sobre nuestro propio contenido versionado es
  // seguro y evita añadir un parser JSON5 solo para permitir comentarios. // ponytail
  return new Function(`return ${m[1]};`)();
}

function extraerEncabezados(texto) {
  const lineas = texto.split("\n");
  const encabezados = [];
  for (let i = 0; i < lineas.length; i++) {
    const m = lineas[i].match(/^(##|###) (.+)$/);
    if (!m) continue;
    const nivel = m[1].length;
    const texto2 = m[2].trim();
    let parrafo = "";
    for (let j = i + 1; j < lineas.length; j++) {
      const l = lineas[j].trim();
      if (l.startsWith("#")) break;
      if (l.length > 0 && !l.startsWith("<") && !l.startsWith("export ")) {
        parrafo = l;
        break;
      }
    }
    encabezados.push({ id: slugificar(texto2), texto: texto2, nivel, parrafo });
  }
  return encabezados;
}

function extraerTecIds(texto) {
  const ids = [];
  const re = /<Tec id="([^"]+)"/g;
  let m;
  while ((m = re.exec(texto))) ids.push(m[1]);
  return ids;
}

// --- Construcción del árbol esperado (duplicado mínimo de arbolDocs.ts) ---
// ponytail: el árbol real vive en web/lib/arbolDocs.ts (TypeScript). Este
// script solo necesita, de cada página no pendiente, su rama+ruta para
// validar que existe un page.mdx — así que basta con un requerimiento
// dinámico: se listan los page.mdx existentes y se comparan contra las
// rutas de arbolDocs.ts leyendo ese fichero como texto (sin ejecutar TS).
function leerArbolComoTexto() {
  const contenido = readFileSync(path.join(LIB_DIR, "arbolDocs.ts"), "utf8");
  const ramas = [];
  const reRama = /id:\s*"([^"]+)"[\s\S]*?titulo:\s*"([^"]+)"[\s\S]*?paginas:\s*\[([\s\S]*?)\n\s*\],\n\s*\},/g;
  let m;
  while ((m = reRama.exec(contenido))) {
    const [, id, titulo, bloquePaginas] = m;
    const paginas = [];
    const rePagina = /ruta:\s*"([^"]+)",\s*pendiente:\s*(true|false)/g;
    let mp;
    while ((mp = rePagina.exec(bloquePaginas))) {
      paginas.push({ ruta: mp[1], pendiente: mp[2] === "true" });
    }
    ramas.push({ id, titulo, paginas });
  }
  return ramas;
}

function main() {
  const errores = [];
  const arbol = leerArbolComoTexto();
  const ficherosMdx = existsSync(DOCS_DIR) ? listarMdx(DOCS_DIR) : [];

  // 1. Toda ruta del árbol sin marcar pendiente debe tener su .mdx.
  for (const rama of arbol) {
    for (const pagina of rama.paginas) {
      if (pagina.pendiente) continue;
      const esperado = path.join(DOCS_DIR, rama.id, pagina.ruta, "page.mdx");
      if (!existsSync(esperado)) {
        errores.push(`falta ${path.relative(REPO_DIR, esperado)} (declarada no-pendiente en arbolDocs.ts)`);
      }
    }
  }

  // 2. Recopilar todos los ids de Tec citados, para validarlos contra las
  //    rutas reales de la rama "tecnologias".
  const idsTecnologiasValidos = new Set(
    (arbol.find((r) => r.id === "tecnologias")?.paginas ?? []).map((p) => p.ruta)
  );

  const paginas = [];
  for (const rutaMdx of ficherosMdx) {
    const relativo = path.relative(DOCS_DIR, rutaMdx); // "<ramaId>/<ruta>/page.mdx"
    const [ramaId, ruta] = relativo.split(path.sep);
    const ramaDef = arbol.find((r) => r.id === ramaId);
    const paginaDef = ramaDef?.paginas.find((p) => p.ruta === ruta);
    const texto = readFileSync(rutaMdx, "utf8");

    const frase = extraerExportString(texto, "frase");
    if (!frase) {
      errores.push(`${path.relative(REPO_DIR, rutaMdx)} no exporta "frase" (obligatoria, spec §2)`);
    }

    for (const id of extraerTecIds(texto)) {
      if (!idsTecnologiasValidos.has(id)) {
        errores.push(`${path.relative(REPO_DIR, rutaMdx)} referencia <Tec id="${id}"> pero no existe esa ruta en la rama tecnologias`);
      }
    }

    const procedencia = extraerExportArray(texto, "procedencia");
    const fechaMdx = fechaGitDelFichero(rutaMdx);
    let envejecida = false;
    if (fechaMdx) {
      for (const fichero of procedencia) {
        const abs = path.join(REPO_DIR, fichero);
        if (!existsSync(abs)) continue;
        const fechaFichero = fechaGitDelFichero(abs);
        if (fechaFichero && fechaFichero > fechaMdx) envejecida = true;
      }
    }

    paginas.push({
      ruta: `/docs/${ramaId}/${ruta}`,
      ramaId,
      ramaTitulo: ramaDef?.titulo ?? ramaId,
      titulo: paginaDef?.titulo ?? ruta,
      frase: frase ?? "",
      encabezados: extraerEncabezados(texto),
      procedencia,
      fechaMdx,
      envejecida,
    });
  }

  // registrosDocs.generated.json se escribe siempre, aunque falle la
  // validación de páginas de abajo: no depende de qué .mdx existan, y
  // web/lib/registros.ts lo importa de forma estática — si esta escritura
  // quedara detrás del `process.exit(1)` de la validación, el import
  // rompería la compilación de TypeScript en cualquier tarea que use
  // <Dato>/<Ficha> mientras las seis páginas de la fase 1 no existan
  // todas (no ocurre hasta la Tarea 10). // ponytail
  const registrosDir = path.join(REPO_DIR, "registros");
  const categorias = ["modelos", "verificadores", "motores"];
  const salida = {};
  const niveles = readdirSync(path.join(registrosDir, "niveles"))
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(path.join(registrosDir, "niveles", f), "utf8")));

  for (const categoria of categorias) {
    const dir = path.join(registrosDir, categoria);
    if (!existsSync(dir)) continue;
    for (const fichero of readdirSync(dir)) {
      if (!fichero.endsWith(".json")) continue;
      const datos = JSON.parse(readFileSync(path.join(dir, fichero), "utf8"));
      const activoEnNiveles = niveles
        .filter((n) =>
          [n.recuperacion, n.geometricos, n.agentes].some((lista) => Array.isArray(lista) && lista.includes(datos.id))
        )
        .map((n) => n.nombre);
      const ficheroUrl = datos.fichero_url ?? datos.pesos_url ?? null;
      salida[datos.id] = {
        id: datos.id,
        nombre: datos.nombre,
        categoria,
        tipo: datos.tipo,
        licencia: datos.licencia,
        dims: datos.dims,
        ficheroPesos: ficheroUrl ? ficheroUrl.split("/").pop() : undefined,
        sha256: datos.sha256,
        activoEnNiveles,
        alternativaNoActiva: activoEnNiveles.length === 0,
      };
    }
  }
  writeFileSync(path.join(LIB_DIR, "registrosDocs.generated.json"), JSON.stringify(salida, null, 2));

  // indiceDocs.json también se escribe siempre, por la misma razón que
  // registrosDocs.generated.json de arriba: EnlacePrevio/Tec/PiePaginaDocs/
  // Buscador lo importan de forma estática, así que tiene que existir en
  // disco (aunque incompleto, con las páginas que sí se pudieron leer) para
  // que TypeScript resuelva esos imports mientras el árbol todavía declara
  // rutas no-pendientes sin su .mdx. El build sigue fallando igual después
  // — `next dev`/`next build` no arrancan si predev/prebuild sale con
  // código 1 — así que esto no relaja la validación, solo evita que un
  // fichero ausente rompa `tsc --noEmit` durante tareas intermedias. // ponytail
  writeFileSync(path.join(LIB_DIR, "indiceDocs.json"), JSON.stringify({ paginas }, null, 2));

  console.log(`indice-docs: ${paginas.length} página(s) indexada(s), ${Object.keys(salida).length} registro(s) copiado(s).`);

  if (errores.length > 0) {
    console.error("indice-docs: build inválido —");
    for (const e of errores) console.error(`  - ${e}`);
    process.exit(1);
  }
}

main();
