import { MapRow } from "./MapRow";
import { Seccion } from "./AdminPanel";

/** Todas las credenciales de terceros DEL SERVIDOR. `MapRow` se muda aquí tal
 *  cual: es la configuración del proveedor de mapas, y su sitio es este. */
export function KeysView({ token }: { token: string }) {
  return (
    <Seccion titulo="API Keys" grupo="Servidor">
      <p className="text-[11px] leading-[1.72] text-subtle">
        Ninguna se muestra entera, ni después de guardarla.
      </p>

      <div className="mt-4">
        <MapRow token={token} />
      </div>

      {/* Declarada, no escondida: el 3a la pedirá para los pesos cuyo
          proveedor exige token propio. */}
      <div className="mt-3 flex items-center gap-3 rounded-[11px] border border-dashed
        border-border p-[11px_14px]">
        <span className="min-w-0 text-[11.5px] text-muted">
          Proveedor de pesos
          <small className="ml-2 text-[9.5px] text-subtle">
            para modelos tras la puerta de su proveedor
          </small>
        </span>
        <span className="ml-auto rounded-[5px] border border-warning/40 px-1.5 py-px
          text-[8.5px] tracking-[.05em] text-warning-fg">la pide el gestor de modelos</span>
      </div>

      <p className="mt-4 text-[11px] leading-[1.72] text-subtle">
        Las de los orígenes de red —Mapillary, Flickr, Google— viven en el Lumi Indexer.
      </p>
    </Seccion>
  );
}