import { Backdrop, FloatingCard, Pop } from "../ui/FloatingCard";
import { Icon } from "../ui/Icon";
import { Center } from "../ui/layout";

/** Solo la vista del PDF -- la configuración vive en `ExportDrawer`, que es
 *  quien genera `url` (un blob) y quien la revoca al cerrar. Sin controles
 *  propios: cambiar qué lleva el informe se hace en el cajón, no aquí. */
export function PdfPreviewPopup({ url, onClose }: { url: string; onClose: () => void }) {
  return (
    <>
      <Backdrop closing={false} onClick={onClose} />
      <Center className="z-[55]">
        <Pop closing={false} className="w-[820px] max-w-[calc(100vw-48px)]">
          <FloatingCard className="flex max-h-[calc(100vh-64px)] flex-col p-[17px]">
            <div className="flex shrink-0 items-center gap-2.5">
              <span className="min-w-0 flex-1 text-[12.5px] text-fg">Vista previa del informe</span>
              <button onClick={onClose} aria-label="Cerrar"
                className="jg-press shrink-0 text-subtle hover:text-fg">
                <Icon name="x" size={13} />
              </button>
            </div>
            {/* El visor de PDF nativo de WebView2 (el `<embed>` de abajo) rasteriza
                a una resolución interna baja y fija, así que a tamaño real se ve
                pixelado -- el PDF en sí no tiene nada, por eso al descargarlo se ve
                bien. El truco es forzarlo a rasterizar al doble de tamaño (donde sí
                tiene detalle de sobra) y encogerlo de vuelta con `transform: scale`,
                que es una operación de compositor, no un reescalado con pérdida. */}
            <div className="relative mt-3 min-h-[540px] flex-1 overflow-hidden rounded-[9px] border border-white/10 bg-white/[.03]">
              <embed src={url} type="application/pdf"
                className="absolute left-0 top-0 h-[200%] w-[200%] origin-top-left [transform:scale(0.5)]" />
            </div>
          </FloatingCard>
        </Pop>
      </Center>
    </>
  );
}
