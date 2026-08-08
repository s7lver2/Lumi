import { useState } from "react";

import { Overlay } from "../ui/Overlay";
import { FolderImportDialog } from "./FolderImportDialog";
import { LegacyImportDialog } from "./LegacyImportDialog";

/** Monta los dos diálogos de origen tras sus dos botones. Cada diálogo enseña
 *  su propio resumen y su propia lista de saltadas al terminar: no hace falta
 *  duplicar ese estado aquí. */
export function IngestView({ indiceId }: { indiceId: number }) {
  const [abierto, setAbierto] = useState<"carpeta" | "legacy" | null>(null);

  return (
    <div className="relative flex h-full flex-col items-center justify-center gap-4 p-8">
      <div className="flex gap-3">
        <button onClick={() => setAbierto("carpeta")}
          className="jg-press rounded-lg border border-border px-4 py-2 text-[12px] text-fg">
          Importar carpeta local
        </button>
        <button onClick={() => setAbierto("legacy")}
          className="jg-press rounded-lg border border-border px-4 py-2 text-[12px] text-fg">
          Importar paquete de la v1
        </button>
      </div>

      {abierto === "carpeta" && (
        <Overlay>
          <FolderImportDialog indiceId={indiceId} onHecho={() => setAbierto(null)} />
        </Overlay>
      )}
      {abierto === "legacy" && (
        <Overlay>
          <LegacyImportDialog indiceId={indiceId} onHecho={() => setAbierto(null)} />
        </Overlay>
      )}
    </div>
  );
}
