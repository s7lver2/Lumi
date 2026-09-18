/** Convierte un texto de encabezado en un id de ancla estable: minúsculas,
 *  sin acentos, espacios y símbolos a guiones. Usada tanto por
 *  `EncabezadoDocs` (para poner el id real en el DOM) como por
 *  `scripts/indice-docs.mjs` (para que el índice del buscador enlace al
 *  mismo id) — dos usos, una sola definición de qué es un slug válido. */
export function slugificar(texto: string): string {
  return texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-+|-+$)/g, "");
}
