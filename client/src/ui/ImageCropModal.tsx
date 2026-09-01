import { useEffect, useRef, useState } from "react";

const FRAME_W = 300;

/** Editor de recorte: arrastra para mover, el deslizador para hacer zoom,
 *  dentro de un marco fijo (círculo para avatar, rectángulo para banner).
 *  Sin librería externa — es arrastrar+zoom sobre un `<canvas>`, no hace
 *  falta más para esto. El recorte final sale ya al tamaño exacto que pide
 *  el servidor (`outputW`×`outputH`), así que `guardar_recortada` del lado
 *  Rust no tiene nada más que recortar. */
export function ImageCropModal({ imageDataUrl, aspect, shape, outputW, outputH, onConfirm, onCancel }: {
  imageDataUrl: string;
  /** Ancho/alto del marco visible. 1 para el avatar (círculo); `outputW/outputH` para el banner. */
  aspect: number;
  shape: "circle" | "rect";
  outputW: number;
  outputH: number;
  onConfirm: (blob: Blob) => void;
  onCancel: () => void;
}) {
  const frameH = FRAME_W / aspect;
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [ready, setReady] = useState(false);
  const [natural, setNatural] = useState({ w: 1, h: 1 });
  const [zoom, setZoom] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const drag = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);

  // Sin esto, arrastrar/hacer zoom aquí encima también scrollea el panel de
  // detrás — el backdrop no intercepta rueda/touch, y nada más en la app
  // bloquea el scroll del body mientras un modal está montado.
  useEffect(() => {
    const previo = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previo; };
  }, []);

  // Cubre el marco entero al zoom mínimo (1x): sin esto, una imagen más
  // apaisada o más vertical que el marco dejaría un borde vacío en vez de
  // recortar.
  const baseScale = Math.max(FRAME_W / natural.w, frameH / natural.h);
  const scale = baseScale * zoom;
  const dispW = natural.w * scale;
  const dispH = natural.h * scale;

  function clamp(p: { x: number; y: number }, w: number, h: number) {
    const minX = Math.min(0, FRAME_W - w);
    const minY = Math.min(0, frameH - h);
    return { x: Math.min(0, Math.max(minX, p.x)), y: Math.min(0, Math.max(minY, p.y)) };
  }

  // Al cambiar el zoom (o cargar la imagen), el recuadro puede quedar fuera
  // de los límites válidos — se recoloca dentro de lo permitido en vez de
  // dejar un hueco vacío asomando por un borde.
  useEffect(() => {
    setPos((p) => clamp(p, dispW, dispH));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom, natural]);

  function onLoad() {
    const img = imgRef.current!;
    setNatural({ w: img.naturalWidth, h: img.naturalHeight });
    setReady(true);
  }

  function onPointerDown(e: React.PointerEvent) {
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    drag.current = { startX: e.clientX, startY: e.clientY, origX: pos.x, origY: pos.y };
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!drag.current) return;
    const dx = e.clientX - drag.current.startX;
    const dy = e.clientY - drag.current.startY;
    setPos(clamp({ x: drag.current.origX + dx, y: drag.current.origY + dy }, dispW, dispH));
  }
  function onPointerUp() { drag.current = null; }

  function confirmar() {
    const canvas = document.createElement("canvas");
    canvas.width = outputW;
    canvas.height = outputH;
    const ctx = canvas.getContext("2d");
    if (!ctx || !imgRef.current) return;
    // De espacio "marco" (lo que se ve, ya con zoom/arrastre aplicado) a
    // espacio "píxel natural de la imagen": el recuadro visible [0,FRAME_W]
    // corresponde a este rectángulo fuente.
    const srcX = -pos.x / scale;
    const srcY = -pos.y / scale;
    const srcW = FRAME_W / scale;
    const srcH = frameH / scale;
    ctx.drawImage(imgRef.current, srcX, srcY, srcW, srcH, 0, 0, outputW, outputH);
    canvas.toBlob((blob) => { if (blob) onConfirm(blob); }, "image/jpeg", 0.92);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      style={{ animation: "jg-backdrop-in 200ms ease-out both" }}>
      <div className="w-[360px] max-w-[94vw] rounded-card border border-white/[.13] bg-[rgba(16,19,25,.96)] p-5 backdrop-blur-xl"
        style={{ animation: "jg-popup-scale-in 220ms cubic-bezier(.2,.85,.35,1) both" }}>
        <p className="mb-3 text-[13px] text-fg">Encuadra la imagen</p>

        <div
          onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
          className={`relative mx-auto touch-none select-none overflow-hidden border border-border bg-black/40 ${
            shape === "circle" ? "rounded-full" : "rounded-lg"}`}
          style={{ width: FRAME_W, height: frameH, cursor: "grab" }}>
          <img ref={imgRef} src={imageDataUrl} alt="" onLoad={onLoad} draggable={false}
            style={{
              position: "absolute", left: pos.x, top: pos.y,
              width: dispW || undefined, height: dispH || undefined,
              maxWidth: "none", opacity: ready ? 1 : 0,
            }} />
        </div>

        <input type="range" min={1} max={3} step={0.01} value={zoom}
          onChange={(e) => setZoom(e.target.valueAsNumber)}
          className="mt-3.5 w-full accent-fg" />

        <div className="mt-4 flex items-center justify-end gap-2">
          <button onClick={onCancel}
            className="rounded-lg border border-border px-3.5 py-1.5 text-[11px] text-subtle">
            Cancelar
          </button>
          <button onClick={confirmar} disabled={!ready}
            className="jg-press rounded-lg bg-accent px-3.5 py-1.5 text-[11px] font-medium text-black disabled:opacity-40">
            Aplicar
          </button>
        </div>
      </div>
    </div>
  );
}
