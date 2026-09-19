export type PaginaArbol = {
  titulo: string;
  /** Slug dentro de la rama, ej. "el-viaje-de-una-foto". La ruta completa es
   *  `/docs/<rama.id>/<pagina.ruta>`. */
  ruta: string;
  pendiente: boolean;
  /** Solo para la rama "modelos": qué generación propia de Lumi es esta
   *  página (Lumi Preview = v1, Lumi 2 = v2...). Se pinta como insignia
   *  tanto en el árbol lateral como en la propia página — un solo dato,
   *  no dos copias que puedan desincronizarse. */
  generacion?: "v1" | "v2" | "v3" | "?";
};

export type RamaArbol = {
  id: string;
  titulo: string;
  /** Nombre del glifo de trazo dibujado a mano en `GlifoRama.tsx`. */
  glifo: "camino" | "engranaje" | "llave" | "mapa" | "caja" | "capas";
  paginas: PaginaArbol[];
};

export const arbolDocs: RamaArbol[] = [
  {
    id: "como-funciona",
    titulo: "Cómo funciona",
    glifo: "camino",
    paginas: [
      { titulo: "De qué va todo esto", ruta: "de-que-va-todo-esto", pendiente: true },
      { titulo: "Mini, Pro y Vision", ruta: "mini-pro-y-vision", pendiente: false },
      { titulo: "El viaje de una foto", ruta: "el-viaje-de-una-foto", pendiente: false },
      { titulo: "El índice y la cobertura", ruta: "indice-y-cobertura", pendiente: true },
      { titulo: "Recuperación: los candidatos", ruta: "recuperacion", pendiente: false },
      { titulo: "Verificación: la geometría", ruta: "verificacion", pendiente: false },
      { titulo: "Agentes: lo que se ve en la foto", ruta: "agentes", pendiente: false },
      { titulo: "El veredicto y su confianza", ruta: "veredicto", pendiente: false },
      { titulo: "La cola y el reparto de GPU", ruta: "cola-y-gpu", pendiente: true },
      { titulo: "Confianza y transporte", ruta: "confianza-y-transporte", pendiente: true },
    ],
  },
  {
    id: "modelos",
    titulo: "Modelos",
    glifo: "capas",
    paginas: [
      // No es un catálogo de terceros como "las tecnologías" — es la
      // identidad propia de Lumi: la primera generación de modelo
      // (Preview, v1) y los tres niveles del producto que la sustituyeron,
      // los tres juntos la segunda generación (v2) — no cada uno una
      // versión distinta. Lumi Stellar (generación "Stelle") es el modelo
      // frontera de la v3: tiene nombre, pero sigue sin forma confirmada
      // ni garantía de llegar a existir — de ahí la insignia "?" en vez de
      // comprometerse a "v3".
      { titulo: "Lumi Preview", ruta: "lumi-preview", pendiente: false, generacion: "v1" },
      { titulo: "Lumi Mini", ruta: "lumi-mini", pendiente: true, generacion: "v2" },
      { titulo: "Lumi Pro", ruta: "lumi-pro", pendiente: true, generacion: "v2" },
      { titulo: "Lumi Vision", ruta: "lumi-vision", pendiente: true, generacion: "v2" },
      { titulo: "Lumi Stellar", ruta: "lumi-stellar", pendiente: false, generacion: "?" },
    ],
  },
  {
    id: "tecnologias",
    titulo: "Las tecnologías",
    glifo: "engranaje",
    paginas: [
      // Una página por CATEGORÍA del registro, no por fichero — con veinte
      // modelos individuales el árbol se volvía ilegible y la mayoría de
      // páginas habrían sido un párrafo casi vacío. Las tres rutas se
      // corresponden 1:1 con las tres carpetas reales de `registros/`
      // (verificadores, motores, modelos) que ya escanea
      // `scripts/indice-docs.mjs`. `depth-anything-v2` y `paddleocr`
      // desaparecieron del catálogo porque sus registros ya no existen:
      // el rediseño de agentes (5c) eliminó el camino de OCR por separado.
      { titulo: "Verificadores geométricos", ruta: "verificadores-geometricos", pendiente: false },
      { titulo: "Motores", ruta: "motores", pendiente: false },
      { titulo: "Modelos de recuperación", ruta: "modelos-de-recuperacion", pendiente: false },
      { titulo: "Qdrant y HNSW", ruta: "qdrant-y-hnsw", pendiente: true },
      { titulo: "SQLite y Redis", ruta: "sqlite-y-redis", pendiente: true },
      { titulo: "Tauri", ruta: "tauri", pendiente: true },
      { titulo: "Ed25519 y el emparejado", ruta: "ed25519-y-el-emparejado", pendiente: true },
    ],
  },
  {
    id: "empezar",
    titulo: "Empezar",
    glifo: "llave",
    paginas: [
      { titulo: "Instalar lumid", ruta: "instalar-lumid", pendiente: true },
      { titulo: "Emparejar el cliente", ruta: "emparejar-cliente", pendiente: true },
      { titulo: "Actualizar", ruta: "actualizar", pendiente: true },
      { titulo: "Compilar a mano", ruta: "compilar-a-mano", pendiente: true },
      { titulo: "Cuando algo no arranca", ruta: "cuando-algo-no-arranca", pendiente: true },
      { titulo: "Modo mantenimiento", ruta: "modo-mantenimiento", pendiente: true },
    ],
  },
  {
    id: "indexar",
    titulo: "Indexar territorio",
    glifo: "mapa",
    paginas: [
      { titulo: "Qué es un .lumidx", ruta: "que-es-un-lumidx", pendiente: true },
      { titulo: "Orígenes de red", ruta: "origenes-de-red", pendiente: true },
      { titulo: "Presupuesto", ruta: "presupuesto", pendiente: true },
      { titulo: "Sellado", ruta: "sellado", pendiente: true },
      { titulo: "Publicación", ruta: "publicacion", pendiente: true },
      { titulo: "Reclamo de territorio", ruta: "reclamo-de-territorio", pendiente: true },
      { titulo: "Levantar en WSL", ruta: "levantar-en-wsl", pendiente: true },
    ],
  },
  {
    id: "repo",
    titulo: "El repo por dentro",
    glifo: "caja",
    paginas: [
      { titulo: "El workspace", ruta: "el-workspace", pendiente: true },
      { titulo: "Rust ↔ Python", ruta: "rust-python", pendiente: true },
      { titulo: "Las tres bases de datos", ruta: "las-tres-bases-de-datos", pendiente: true },
      { titulo: "Compilar cada mitad", ruta: "compilar-cada-mitad", pendiente: true },
      { titulo: "Convenciones", ruta: "convenciones", pendiente: true },
    ],
  },
];

export function ramaDeRuta(idRama: string): RamaArbol | undefined {
  return arbolDocs.find((r) => r.id === idRama);
}

export function paginaDeRuta(idRama: string, ruta: string): PaginaArbol | undefined {
  return ramaDeRuta(idRama)?.paginas.find((p) => p.ruta === ruta);
}

export function siguienteYAnterior(
  idRama: string,
  ruta: string
): { anterior: (PaginaArbol & { ramaId: string }) | null; siguiente: (PaginaArbol & { ramaId: string }) | null } {
  const rama = ramaDeRuta(idRama);
  if (!rama) return { anterior: null, siguiente: null };
  const escritas = rama.paginas.filter((p) => !p.pendiente);
  const i = escritas.findIndex((p) => p.ruta === ruta);
  return {
    anterior: i > 0 ? { ...escritas[i - 1], ramaId: idRama } : null,
    siguiente: i >= 0 && i < escritas.length - 1 ? { ...escritas[i + 1], ramaId: idRama } : null,
  };
}
