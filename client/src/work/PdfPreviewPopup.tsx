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
            <div className="mt-3 min-h-[540px] flex-1 overflow-hidden rounded-[9px] border border-white/10 bg-white/[.03]">
              <embed src={url} type="application/pdf" className="h-full min-h-[540px] w-full" />
            </div>
          </FloatingCard>
        </Pop>
      </Center>
    </>
  );
}
