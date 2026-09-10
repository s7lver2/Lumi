import { useEffect, useRef, useState } from "react";
import { Backdrop, FloatingCard, Pop } from "../ui/FloatingCard";
import { Icon } from "../ui/Icon";
import { Center } from "../ui/layout";

const PROFUNDIDAD_HISTORIAL = 20;

type Herramienta = "recorte" | "blur";

/** Caja de recorte en espacio de canvas (píxeles reales, no de pantalla). */
interface Caja { x: number; y: number; w: number; h: number }

/** Editor pre-subida (spec 2026-09-10 §2): recorte de proporción libre y
 *  blur de pincel manual, todo en el navegador/WebView sobre un
 *  `<canvas>` -- sin llamada de red salvo que el investigador pida
 *  "Mejorar calidad" (gated por `upscaler`). Se abre ANTES de
 *  `UploadPopup`/del flujo de Media, con un botón "Omitir" que salta
 *  directo sin tocar la imagen: el editor es siempre opcional.
 *
 *  Deshacer/rehacer es una pila de snapshots del `<canvas>` entero
 *  (`toDataURL`), no de `ImageData` -- el recorte cambia las dimensiones del
 *  lienzo, y `ImageData` no sobrevive a eso sin recalcular a mano. Un
 *  snapshot por foto es más memoria que un delta, pero con el tope de 20
 *  pasos y fotos de tamaño de subida normal es una cantidad razonable —
 *  ponytail: la alternativa (deltas) es la optimización correcta el día que
 *  20 snapshots de una foto de 24MP sean un problema real, no antes. */
export function ImageEditorPopup({
  srcDataUrl, fileName, closing, upscaler, onExportar, onOmitir, onCerrar,
}: {
  srcDataUrl: string;
  fileName: string;
  closing: boolean;
  /** `null` con `upscaler_activo` apagado: el botón directamente no existe,
   *  no un botón deshabilitado con una explicación (spec: "no hay nada
   *  capado que explicar"). */
  upscaler: { onUpscale: (blob: Blob) => Promise<Blob> } | null;
  onExportar: (blob: Blob) => void;
  onOmitir: () => void;
  onCerrar: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const contenedorRef = useRef<HTMLDivElement>(null);
  const [herramienta, setHerramienta] = useState<Herramienta>("recorte");
  const [radio, setRadio] = useState(24);
  const [cargando, setCargando] = useState(true);
  const [mejorando, setMejorando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Escala pantalla→canvas: el `<canvas>` interno vive a resolución nativa,
  // pero se pinta más pequeño (`display: w/h` fijos abajo) para caber en el
  // popup -- todo lo que llega por eventos de puntero está en coordenadas de
  // pantalla y hay que convertirlo antes de tocar el canvas.
  const escalaRef = useRef(1);
  const [caja, setCaja] = useState<Caja | null>(null);
  const arrastreRef = useRef<
    | { modo: "mover"; ox: number; oy: number }
    | { modo: "esquina"; esquina: "nw" | "ne" | "sw" | "se" }
    | { modo: "pintar" }
    | null
  >(null);

  const historial = useRef<string[]>([]);
  const historialIdx = useRef(-1);
  const [puedeDeshacer, setPuedeDeshacer] = useState(false);
  const [puedeRehacer, setPuedeRehacer] = useState(false);

  function actualizarBotonesHistorial() {
    setPuedeDeshacer(historialIdx.current > 0);
    setPuedeRehacer(historialIdx.current < historial.current.length - 1);
  }

  function snapshot() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const data = canvas.toDataURL("image/png");
    // Cortar el futuro cuando se edita después de deshacer: es el
    // comportamiento estándar de cualquier editor con deshacer/rehacer.
    historial.current = historial.current.slice(0, historialIdx.current + 1);
    historial.current.push(data);
    if (historial.current.length > PROFUNDIDAD_HISTORIAL) historial.current.shift();
    historialIdx.current = historial.current.length - 1;
    actualizarBotonesHistorial();
  }

  function cargarDataUrlEnCanvas(data: string, cb?: () => void) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const img = new Image();
    img.onload = () => {
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d");
      ctx?.drawImage(img, 0, 0);
      ajustarOverlay();
      cb?.();
    };
    img.src = data;
  }

  function ajustarOverlay() {
    const canvas = canvasRef.current;
    const overlay = overlayRef.current;
    const cont = contenedorRef.current;
    if (!canvas || !overlay || !cont) return;
    const MAX_W = 620;
    const MAX_H = 420;
    const escala = Math.min(MAX_W / canvas.width, MAX_H / canvas.height, 1);
    escalaRef.current = escala;
    const w = Math.round(canvas.width * escala);
    const h = Math.round(canvas.height * escala);
    overlay.width = canvas.width;
    overlay.height = canvas.height;
    for (const el of [canvas, overlay]) {
      el.style.width = `${w}px`;
      el.style.height = `${h}px`;
    }
  }

  // Carga inicial: la imagen de origen (data: URL, del selector de archivos
  // o del panel Media) al canvas de trabajo, y una caja de recorte inicial
  // que cubre el 80% central -- nunca la imagen entera por defecto, para
  // que se note que hay algo que arrastrar.
  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      canvas.getContext("2d")?.drawImage(img, 0, 0);
      ajustarOverlay();
      const w = img.naturalWidth * 0.8;
      const h = img.naturalHeight * 0.8;
      setCaja({ x: (img.naturalWidth - w) / 2, y: (img.naturalHeight - h) / 2, w, h });
      historial.current = [canvas.toDataURL("image/png")];
      historialIdx.current = 0;
      actualizarBotonesHistorial();
      setCargando(false);
    };
    img.onerror = () => setError("no se pudo leer la imagen");
    img.src = srcDataUrl;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [srcDataUrl]);

  useEffect(() => {
    const previo = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previo; };
  }, []);

  function deshacer() {
    if (historialIdx.current <= 0) return;
    historialIdx.current -= 1;
    cargarDataUrlEnCanvas(historial.current[historialIdx.current]);
    actualizarBotonesHistorial();
  }
  function rehacer() {
    if (historialIdx.current >= historial.current.length - 1) return;
    historialIdx.current += 1;
    cargarDataUrlEnCanvas(historial.current[historialIdx.current]);
    actualizarBotonesHistorial();
  }

  function puntoCanvas(e: React.PointerEvent): { x: number; y: number } {
    const overlay = overlayRef.current!;
    const rect = overlay.getBoundingClientRect();
    const escala = escalaRef.current || 1;
    return { x: (e.clientX - rect.left) / escala, y: (e.clientY - rect.top) / escala };
  }

  const TAM_ESQUINA = 14;
  function esquinaEn(p: { x: number; y: number }, c: Caja): "nw" | "ne" | "sw" | "se" | null {
    const esc = escalaRef.current || 1;
    const tol = TAM_ESQUINA / esc;
    const esquinas: [("nw" | "ne" | "sw" | "se"), number, number][] = [
      ["nw", c.x, c.y], ["ne", c.x + c.w, c.y], ["sw", c.x, c.y + c.h], ["se", c.x + c.w, c.y + c.h],
    ];
    for (const [nombre, ex, ey] of esquinas) {
      if (Math.abs(p.x - ex) < tol && Math.abs(p.y - ey) < tol) return nombre;
    }
    return null;
  }

  function aplicarBlurEn(px: number, py: number) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    // Blur REAL con textura de fondo visible: se renderiza una copia
    // difuminada de todo el canvas (`ctx.filter`, no un rectángulo opaco) y
    // se pega solo el círculo del pincel, recortado con `clip()`.
    const off = document.createElement("canvas");
    off.width = canvas.width;
    off.height = canvas.height;
    const octx = off.getContext("2d");
    if (!octx) return;
    octx.filter = `blur(${radio}px)`;
    octx.drawImage(canvas, 0, 0);
    ctx.save();
    ctx.beginPath();
    ctx.arc(px, py, radio, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(off, 0, 0);
    ctx.restore();
  }

  function onPointerDown(e: React.PointerEvent) {
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    const p = puntoCanvas(e);
    if (herramienta === "blur") {
      arrastreRef.current = { modo: "pintar" };
      aplicarBlurEn(p.x, p.y);
      dibujarOverlay();
      return;
    }
    if (!caja) return;
    const esquina = esquinaEn(p, caja);
    if (esquina) {
      arrastreRef.current = { modo: "esquina", esquina };
    } else if (p.x >= caja.x && p.x <= caja.x + caja.w && p.y >= caja.y && p.y <= caja.y + caja.h) {
      arrastreRef.current = { modo: "mover", ox: p.x - caja.x, oy: p.y - caja.y };
    }
  }

  function onPointerMove(e: React.PointerEvent) {
    const a = arrastreRef.current;
    if (!a) {
      if (herramienta === "blur") dibujarOverlay(puntoCanvas(e));
      return;
    }
    const p = puntoCanvas(e);
    const canvas = canvasRef.current;
    if (a.modo === "pintar") {
      aplicarBlurEn(p.x, p.y);
      dibujarOverlay(p);
      return;
    }
    if (!caja || !canvas) return;
    if (a.modo === "mover") {
      const x = Math.max(0, Math.min(canvas.width - caja.w, p.x - a.ox));
      const y = Math.max(0, Math.min(canvas.height - caja.h, p.y - a.oy));
      setCaja({ ...caja, x, y });
    } else {
      let { x, y, w, h } = caja;
      const x2 = x + w, y2 = y + h;
      if (a.esquina === "nw") { x = Math.min(p.x, x2 - 10); y = Math.min(p.y, y2 - 10); w = x2 - x; h = y2 - y; }
      if (a.esquina === "ne") { y = Math.min(p.y, y2 - 10); w = Math.max(10, p.x - x); h = y2 - y; }
      if (a.esquina === "sw") { x = Math.min(p.x, x2 - 10); w = x2 - x; h = Math.max(10, p.y - y); }
      if (a.esquina === "se") { w = Math.max(10, p.x - x); h = Math.max(10, p.y - y); }
      x = Math.max(0, x); y = Math.max(0, y);
      w = Math.min(w, canvas.width - x); h = Math.min(h, canvas.height - y);
      setCaja({ x, y, w, h });
    }
  }

  function onPointerUp() {
    if (arrastreRef.current?.modo === "pintar") snapshot();
    arrastreRef.current = null;
  }

  function dibujarOverlay(cursor?: { x: number; y: number }) {
    const overlay = overlayRef.current;
    if (!overlay) return;
    const ctx = overlay.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, overlay.width, overlay.height);
    if (herramienta === "recorte" && caja) {
      ctx.fillStyle = "rgba(0,0,0,.55)";
      ctx.fillRect(0, 0, overlay.width, overlay.height);
      ctx.clearRect(caja.x, caja.y, caja.w, caja.h);
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 2 / (escalaRef.current || 1);
      ctx.strokeRect(caja.x, caja.y, caja.w, caja.h);
      const r = 5 / (escalaRef.current || 1);
      ctx.fillStyle = "#fff";
      for (const [ex, ey] of [[caja.x, caja.y], [caja.x + caja.w, caja.y], [caja.x, caja.y + caja.h], [caja.x + caja.w, caja.y + caja.h]]) {
        ctx.beginPath();
        ctx.arc(ex, ey, r, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (herramienta === "blur" && cursor) {
      ctx.strokeStyle = "rgba(255,255,255,.85)";
      ctx.lineWidth = 1.5 / (escalaRef.current || 1);
      ctx.beginPath();
      ctx.arc(cursor.x, cursor.y, radio, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  useEffect(() => { dibujarOverlay(); }, [caja, herramienta]); // eslint-disable-line react-hooks/exhaustive-deps

  function aplicarRecorte() {
    const canvas = canvasRef.current;
    if (!canvas || !caja) return;
    const nuevo = document.createElement("canvas");
    nuevo.width = Math.round(caja.w);
    nuevo.height = Math.round(caja.h);
    const ctx = nuevo.getContext("2d");
    ctx?.drawImage(canvas, caja.x, caja.y, caja.w, caja.h, 0, 0, nuevo.width, nuevo.height);
    canvas.width = nuevo.width;
    canvas.height = nuevo.height;
    canvas.getContext("2d")?.drawImage(nuevo, 0, 0);
    ajustarOverlay();
    setCaja(null);
    snapshot();
  }

  function exportarBlob(cb: (blob: Blob) => void) {
    canvasRef.current?.toBlob((blob) => { if (blob) cb(blob); }, "image/jpeg", 0.92);
  }

  async function mejorarCalidad() {
    if (!upscaler) return;
    setMejorando(true);
    setError(null);
    try {
      await new Promise<void>((resolve, reject) => {
        exportarBlob(async (blob) => {
          try {
            const mejorado = await upscaler.onUpscale(blob);
            const url = URL.createObjectURL(mejorado);
            cargarDataUrlEnCanvas(url, () => { URL.revokeObjectURL(url); snapshot(); resolve(); });
          } catch (e) {
            reject(e);
          }
        });
      });
    } catch (e) {
      setError(String(e));
    } finally {
      setMejorando(false);
    }
  }

  const bloqueado = mejorando;

  return (
    <>
      <Backdrop closing={closing} onClick={bloqueado ? undefined : onCerrar} />
      <Center className="z-[52]">
        <Pop closing={closing} className="w-[700px] max-w-[calc(100vw-48px)]">
          <FloatingCard className="p-[17px]">
            <div className="flex items-center gap-2.5">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white/[.06] text-fg">
                <Icon name="crop" size={15} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-medium text-fg">Editar antes de subir</p>
                <p className="truncate text-[11px] text-muted">{fileName}</p>
              </div>
              <button onClick={onCerrar} disabled={bloqueado} aria-label="Cerrar"
                className="jg-press shrink-0 text-subtle hover:text-fg disabled:opacity-40">
                <Icon name="x" size={13} />
              </button>
            </div>

            {cargando ? (
              <div className="mt-6 flex items-center justify-center py-16">
                <Icon name="spinner" size={20} className="text-muted" />
              </div>
            ) : (
              <>
                <div className="mt-4 flex items-center gap-2">
                  <button onClick={() => setHerramienta("recorte")} disabled={bloqueado}
                    className={`jg-press flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[11px]
                      ${herramienta === "recorte" ? "border-fg bg-white/[.06] text-fg" : "border-border text-muted"}`}>
                    <Icon name="crop" size={13} /> Recorte
                  </button>
                  <button onClick={() => setHerramienta("blur")} disabled={bloqueado}
                    className={`jg-press flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[11px]
                      ${herramienta === "blur" ? "border-fg bg-white/[.06] text-fg" : "border-border text-muted"}`}>
                    <Icon name="blur" size={13} /> Blur
                  </button>
                  {herramienta === "blur" && (
                    <div className="ml-1 flex items-center gap-2">
                      <span className="text-[10px] text-subtle">radio</span>
                      <input type="range" min={6} max={80} value={radio}
                        onChange={(e) => setRadio(e.target.valueAsNumber)}
                        className="w-24 accent-fg" />
                    </div>
                  )}
                  <div className="ml-auto flex items-center gap-1">
                    <button onClick={deshacer} disabled={!puedeDeshacer || bloqueado} title="Deshacer"
                      className="jg-press rounded-md p-1.5 text-subtle hover:text-fg disabled:opacity-30">
                      <Icon name="undo" size={14} />
                    </button>
                    <button onClick={rehacer} disabled={!puedeRehacer || bloqueado} title="Rehacer"
                      className="jg-press rounded-md p-1.5 text-subtle hover:text-fg disabled:opacity-30">
                      <Icon name="redo" size={14} />
                    </button>
                  </div>
                </div>

                <div ref={contenedorRef} className="mt-3 flex items-center justify-center rounded-xl border
                  border-border bg-black/30 p-2" style={{ minHeight: 300 }}>
                  <div className="relative" style={{ lineHeight: 0 }}>
                    <canvas ref={canvasRef} className="rounded-md" />
                    <canvas ref={overlayRef}
                      className="absolute left-0 top-0 touch-none"
                      style={{ cursor: herramienta === "blur" ? "none" : "default" }}
                      onPointerDown={bloqueado ? undefined : onPointerDown}
                      onPointerMove={bloqueado ? undefined : onPointerMove}
                      onPointerUp={bloqueado ? undefined : onPointerUp} />
                  </div>
                </div>

                {herramienta === "recorte" && caja && (
                  <div className="mt-2 flex justify-end">
                    <button onClick={aplicarRecorte} disabled={bloqueado}
                      className="jg-press rounded-lg border border-white/15 px-3 py-1.5 text-[11px] text-fg">
                      Aplicar recorte
                    </button>
                  </div>
                )}

                {error && (
                  <div className="mt-3 flex items-start gap-2">
                    <Icon name="alert" size={12} className="mt-px shrink-0 text-danger-fg" />
                    <p className="text-[10.5px] leading-snug text-muted">{error}</p>
                  </div>
                )}

                <div className="mt-4 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <button onClick={onOmitir} disabled={bloqueado}
                      className="jg-press rounded-lg border border-white/15 px-4 py-2 text-[11.5px] text-fg
                        disabled:opacity-40">
                      Omitir
                    </button>
                    {upscaler && (
                      <button onClick={() => void mejorarCalidad()} disabled={bloqueado}
                        className="jg-press flex items-center gap-1.5 rounded-lg border border-white/15 px-3 py-2
                          text-[11.5px] text-fg disabled:opacity-40">
                        <Icon name="sparkle" size={13} />
                        {mejorando ? "Mejorando…" : "Mejorar calidad"}
                      </button>
                    )}
                  </div>
                  <button onClick={() => exportarBlob(onExportar)} disabled={bloqueado}
                    className="jg-press rounded-lg bg-accent px-5 py-2 text-[11.5px] font-medium text-black
                      disabled:opacity-40">
                    Usar esta versión
                  </button>
                </div>
              </>
            )}
          </FloatingCard>
        </Pop>
      </Center>
    </>
  );
}
