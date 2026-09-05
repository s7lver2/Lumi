import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

import { api } from "../lib/api";
import { Overlay } from "./Overlay";
import { PerfPill } from "./PerfPill";

/** Botones de ventana propios. La ventana va sin decoración del sistema
 *  (`decorations: false`), así que minimizar, maximizar y cerrar los tiene que
 *  ofrecer la interfaz: sin esto no habría forma de cerrar la aplicación.
 *
 *  44×38 y al ras de la esquina, como los del sistema. El rojo solo en el
 *  hover de cerrar: un botón permanentemente rojo pide que lo pulses. */
export function WindowControls({ onPedirCierre }: { onPedirCierre: () => void }) {
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
      <Btn label="Cerrar" danger onClick={onPedirCierre}>
        <path d="M1 1l8 8M9 1L1 9" />
      </Btn>
    </div>
  );
}

/** #107: antes este botón cerraba directo (`win.close()`) y el gancho de
 *  `RunEvent::Exit` en Rust paraba Redis/Qdrant siempre, sin preguntar. Si
 *  ninguno de los dos es un proceso PROPIO (nada que parar de verdad), se
 *  cierra directo — el diálogo solo tiene sentido cuando hay algo que
 *  decidir. */
function CerrarDialog({ onCerrado }: { onCerrado: () => void }) {
  const [enCurso, setEnCurso] = useState(false);

  async function elegir(accion: "wsl" | "servicios" | "segundo-plano") {
    setEnCurso(true);
    try {
      if (accion === "wsl") await api.serviciosApagarWsl();
      else if (accion === "servicios") await api.serviciosParar();
      else await api.serviciosDejarEnSegundoPlano();
    } finally {
      onCerrado();
    }
  }

  return (
    <Overlay>
      <div className="w-[380px] rounded-card border border-white/[.13] bg-[rgba(16,19,25,.92)] p-[20px_22px] backdrop-blur-xl">
        <p className="text-sm text-fg">¿Qué hacemos con Redis y Qdrant?</p>
        <p className="mt-1.5 text-[10.5px] leading-relaxed text-subtle">
          Siguen corriendo en WSL. Puedes apagar la distribución entera, parar solo estos dos
          servicios, o dejarlos como están para que el próximo arranque sea instantáneo.
        </p>
        <div className="mt-4 flex flex-col gap-1.5">
          <button onClick={() => void elegir("segundo-plano")} disabled={enCurso}
            className="jg-press rounded-lg border border-border bg-[#0b0d0f] px-3.5 py-2 text-left text-[11.5px] text-fg disabled:opacity-40">
            Dejarlos en segundo plano
          </button>
          <button onClick={() => void elegir("servicios")} disabled={enCurso}
            className="jg-press rounded-lg border border-border bg-[#0b0d0f] px-3.5 py-2 text-left text-[11.5px] text-fg disabled:opacity-40">
            Parar Redis y Qdrant
          </button>
          <button onClick={() => void elegir("wsl")} disabled={enCurso}
            className="jg-press rounded-lg border border-border bg-[#0b0d0f] px-3.5 py-2 text-left text-[11.5px] text-fg disabled:opacity-40">
            Apagar WSL del todo
          </button>
        </div>
      </div>
    </Overlay>
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
  const [preguntando, setPreguntando] = useState(false);
  const win = getCurrentWindow();

  async function pedirCierre() {
    // Solo preguntar si hay algo propio que parar — un Redis/Qdrant ya
    // muertos, o adoptados de un proceso que no es el nuestro, no dejan nada
    // que decidir y cerrar directo es lo que ya pasaba antes de #107.
    const estado = await api.serviciosEstado().catch(() => []);
    if (estado.some((s) => s.vivo && s.propio)) setPreguntando(true);
    else void win.close();
  }

  return (
    // `h-full w-full` y NUNCA `h-screen w-screen`: `#root` se encoge a
    // `100% / --ui-scale` y luego se estira con `transform: scale()`. Un hijo
    // que mide en `vw` mide la ventana entera, se escala otra vez, y acaba un
    // 20% más ancho que la ventana: los botones se salían por la derecha y
    // todo el contenido quedaba descentrado hacia el mismo lado.
    <div className="flex h-full w-full flex-col overflow-hidden bg-bg">
      <header data-tauri-drag-region
        className="relative z-[60] flex h-[38px] shrink-0 items-center gap-2.5 border-b border-border
          bg-[rgba(13,15,17,.92)] pl-2.5 backdrop-blur-md">
        {/* La estrella real de la marca, no el rombo generico "logo" de
            Icon.tsx — misma identidad que el cliente. */}
        <span className="grid h-[18px] w-[18px] shrink-0 place-items-center text-fg">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" stroke="none">
            <path d="M12 2c.7 4.4 2.7 6.4 7 7-4.3.7-6.3 2.7-7 7-.7-4.4-2.7-6.4-7-7 4.3-.7 6.3-2.7 7-7z" />
          </svg>
        </span>
        <span data-tauri-drag-region className="text-[11.5px] text-fg">Lumi Indexer</span>
        <span data-tauri-drag-region className="h-full flex-1" />
        <PerfPill />
        <WindowControls onPedirCierre={() => void pedirCierre()} />
      </header>
      <div className="relative min-h-0 flex-1">{children}</div>
      <ResizeHandles />
      {preguntando && <CerrarDialog onCerrado={() => void win.close()} />}
    </div>
  );
}
