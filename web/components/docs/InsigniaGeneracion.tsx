/** Insignia de generación para los modelos PROPIOS de Lumi (no aplica a
 *  terceros como RoMa o SALAD, que no son "generaciones" de nada nuestro):
 *  Lumi Preview es v1, Lumi 2 es v2. Se pinta en dos sitios a partir del
 *  MISMO dato (`arbolDocs.ts::generacion`) — el árbol lateral (compacta) y
 *  la cabecera de la propia página (normal) — para que no puedan
 *  desincronizarse entre sí. */
export function InsigniaGeneracion({
  version,
  compacta,
}: {
  version: "v1" | "v2" | "v3" | "?";
  compacta?: boolean;
}) {
  return (
    <span
      className={
        compacta
          ? "ml-1.5 rounded-[3px] border border-border px-[4px] font-mono text-[9px] uppercase text-subtle"
          : "mt-2 inline-block rounded-[4px] border border-border px-[6px] py-[1px] font-mono text-[10px] uppercase tracking-[.08em] text-subtle"
      }
    >
      {compacta ? version : `generación ${version}`}
    </span>
  );
}
