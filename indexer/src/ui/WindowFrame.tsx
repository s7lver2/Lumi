import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

import { Icon } from "./Icon";

/** Botones de ventana propios. La ventana va sin decoración del sistema
 *  (`decorations: false`), así que minimizar, maximizar y cerrar los tiene que
 *  ofrecer la interfaz: sin esto no habría forma de cerrar la aplicación.
 *
 *  44×38 y al ras de la esquina, como los del sistema. El rojo solo en el
 *  hover de cerrar: un botón permanentemente rojo pide que lo pulses. */
export function WindowControls() {
  const [max, setMax] = useState(false);
  const win = getCurrentWindow();

  useEffect(() => {
    void win.isMaximized().then(setMax).catch(() => {});
    // `onResized` cubre también el maximizar por doble clic o por atajo del
    // sistema, que no pasan por nuestros botones.
    const un = win.onResized(() => { void win.isMaximized().then(setMax).catch(() => {}); });
    return () => { void un.then((f) => f()); };
  }, []);

  return (
    <div className="flex h-full shrink-0">
      <Btn label="Minimizar" onClick={() => void win.minimize()}>
        <path d="M1 5h8" />
      </Btn>
      <Btn label={max ? "Restaurar" : "Maximizar"} onClick={() => void win.toggleMaximize()}>
        {max ? (
          <>
            <rect x="1" y="3" width="6" height="6" rx="1" />
            <path d="M3 3V2a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1H7" />
          </>
        ) : (
          <rect x="1" y="1" width="8" height="8" rx="1" />
        )}
      </Btn>
      <Btn label="Cerrar" danger onClick={() => void win.close()}>
        <path d="M1 1l8 8M9 1L1 9" />
      </Btn>
    </div>
  );
}

function Btn({ label, danger, onClick, children }: {
  label: string; danger?: boolean; onClick: () => void; children: React.ReactNode;
}) {
  return (
    <button onClick={onClick} title={label} aria-label={label}
      className={`grid h-full w-[44px] place-items-center text-subtle transition-colors duration-150
        ${danger ? "hover:bg-danger hover:text-white" : "hover:bg-white/[.07] hover:text-fg"}`}>
      <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.1">
        {children}
      </svg>
    </button>
  );
}

/** Una ventana sin decoración pierde también los bordes con los que el sistema
 *  la redimensiona. Estos ocho tiradores invisibles se los devuelven pidiéndole
 *  al propio sistema que arrastre el borde, que es lo que hace que el gesto se
 *  sienta nativo en vez de calculado a mano desde JavaScript. */
export function ResizeHandles() {
  const win = getCurrentWindow();
  const start = (dir: string) => (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    void win.startResizeDragging(dir as never);
  };
  const H = 5;
  const lados = [
    { d: "North", style: { top: 0, left: H, right: H, height: H, cursor: "ns-resize" } },
    { d: "South", style: { bottom: 0, left: H, right: H, height: H, cursor: "ns-resize" } },
    { d: "West", style: { left: 0, top: H, bottom: H, width: H, cursor: "ew-resize" } },
    { d: "East", style: { right: 0, top: H, bottom: H, width: H, cursor: "ew-resize" } },
    { d: "NorthWest", style: { top: 0, left: 0, width: H, height: H, cursor: "nwse-resize" } },
    { d: "NorthEast", style: { top: 0, right: 0, width: H, height: H, cursor: "nesw-resize" } },
    { d: "SouthWest", style: { bottom: 0, left: 0, width: H, height: H, cursor: "nesw-resize" } },
    { d: "SouthEast", style: { bottom: 0, right: 0, width: H, height: H, cursor: "nwse-resize" } },
  ];
  return (
    <>
      {lados.map((l) => (
        <div key={l.d} onPointerDown={start(l.d)}
          className="fixed z-[100]" style={{ position: "fixed", ...l.style }} />
      ))}
    </>
  );
}

// ponytail: el plan de la tarea 7 copia `client/src/ui/TitleBar.tsx` y pide
// cambiar en él "el único literal que nombra el producto", pero ese fichero no
// trae tal literal: es la barra del CLIENTE, atada a `useServer`, `Avatar` y
// `NotificationsPopover` (sesión, admin, telemetría del servidor) que el
// Indexer no tiene y que ninguna tarea de este plan pide crear. Tampoco existe
// un `WindowFrame` exportado en el fichero real — solo `WindowControls` y
// `ResizeHandles`, que es justo lo que el propio `App.tsx` de este plan da por
// hecho que existe. El techo es «no hay sesión de servidor que enseñar aquí»;
// la salida es esta barra mínima propia, con la misma altura (38 px), el mismo
// arrastre de ventana y los mismos controles, sin nada del cliente.
export function WindowFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-bg">
      <header data-tauri-drag-region
        className="relative z-[60] flex h-[38px] shrink-0 items-center gap-2.5 border-b border-border
          bg-[rgba(13,15,17,.92)] pl-2.5 backdrop-blur-md">
        <span className="grid h-[18px] w-[18px] shrink-0 place-items-center text-fg">
          <Icon name="logo" size={15} />
        </span>
        <span data-tauri-drag-region className="text-[11.5px] text-fg">Lumi Indexer</span>
        <span data-tauri-drag-region className="h-full flex-1" />
        <WindowControls />
      </header>
      <div className="relative min-h-0 flex-1">{children}</div>
      <ResizeHandles />
    </div>
  );
}
