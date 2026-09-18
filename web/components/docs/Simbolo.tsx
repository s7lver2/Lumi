const REPO_GITHUB = "https://github.com/s7lver2/Lumi/blob/main";

/** Un símbolo de código (módulo::función, tipo, etc.) mencionado en prosa
 *  enlaza al fichero que lo define — nunca a una línea concreta, porque un
 *  número de línea queda mal al primer commit y nadie se entera (spec §3 A,
 *  "Símbolos enlazados"). */
export function Simbolo({ ruta, children }: { ruta: string; children: React.ReactNode }) {
  return (
    <a href={`${REPO_GITHUB}/${ruta}`} className="font-mono text-fg no-underline hover:underline">
      {children}
    </a>
  );
}
