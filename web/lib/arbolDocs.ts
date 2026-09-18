export type PaginaArbol = {
  titulo: string;
  /** Slug dentro de la rama, ej. "el-viaje-de-una-foto". La ruta completa es
   *  `/docs/<rama.id>/<pagina.ruta>`. */
  ruta: string;
  pendiente: boolean;
};

export type RamaArbol = {
  id: string;
  titulo: string;
  /** Nombre del glifo de trazo dibujado a mano en `GlifoRama.tsx`. */
  glifo: "camino" | "engranaje" | "llave" | "mapa" | "caja";
  paginas: PaginaArbol[];
};

export const arbolDocs: RamaArbol[] = [
  {
    id: "como-funciona",
    titulo: "Cómo funciona",
    glifo: "camino",
    paginas: [
      { titulo: "De qué va todo esto", ruta: "de-que-va-todo-esto", pendiente: true },
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
    id: "tecnologias",
    titulo: "Las tecnologías",
    glifo: "engranaje",
    paginas: [
      { titulo: "Cómo leer estas páginas", ruta: "como-leer-estas-paginas", pendiente: true },
      { titulo: "RoMa", ruta: "roma", pendiente: false },
      { titulo: "RoMa v2", ruta: "roma-v2", pendiente: true },
      { titulo: "tiny-RoMa", ruta: "tiny-roma", pendiente: true },
      { titulo: "EfficientLoFTR", ruta: "efficient-loftr", pendiente: true },
      { titulo: "LightGlue + ALIKED", ruta: "lightglue-aliked", pendiente: true },
      { titulo: "DINOv2", ruta: "dinov2", pendiente: true },
      { titulo: "SALAD", ruta: "salad", pendiente: true },
      { titulo: "AnyLoc", ruta: "anyloc", pendiente: true },
      { titulo: "EigenPlaces", ruta: "eigenplaces", pendiente: true },
      { titulo: "CosPlace", ruta: "cosplace", pendiente: true },
      { titulo: "DINO-Mix", ruta: "dino-mix", pendiente: true },
      { titulo: "CliqueMining", ruta: "cliquemining", pendiente: true },
      { titulo: "Lumi-2 y Lumi-preview", ruta: "lumi-2-y-lumi-preview", pendiente: true },
      { titulo: "Qwen3-VL", ruta: "qwen3-vl", pendiente: true },
      { titulo: "Depth-Anything v2", ruta: "depth-anything-v2", pendiente: true },
      { titulo: "PaddleOCR", ruta: "paddleocr", pendiente: true },
      { titulo: "Real-ESRGAN", ruta: "real-esrgan", pendiente: true },
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
