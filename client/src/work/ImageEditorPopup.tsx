import { useEffect, useRef, useState } from "react";
import { Backdrop, FloatingCard, Pop } from "../ui/FloatingCard";
import { Icon } from "../ui/Icon";
import { Center } from "../ui/layout";

const PROFUNDIDAD_HISTORIAL = 20;

type Herramienta = "recorte" | "girar" | "blur" | "tono";

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
  upscaler: { onUpscale: (blob: Blob, factor: 1 | 2 | 4) => Promise<Blob> } | null;
  onExportar: (blob: Blob) => void;
  onOmitir: () => void;
  onCerrar: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const contenedorRef = useRef<HTMLDivElement>(null);
  const [herramienta, setHerramienta] = useState<Herramienta>("recorte");
  const [radio, setRadio] = useState(24);
  // Vista previa en directo vía CSS `filter` sobre el propio <canvas> (no
  // toca los píxeles todavía); "Aplicar tono" es lo que de verdad redibuja
  // el lienzo y genera el snapshot -- mismo criterio que "Aplicar recorte":
  // los sliders son una previsualización, no un compromiso.
  const [brillo, setBrillo] = useState(100);
  const [contraste, setContraste] = useState(100);
  // 1 = ajuste automático de siempre (`ajustarOverlay`). El contenedor se
  // vuelve desplazable (`overflow-auto` más abajo) en vez de llevar un pan a
  // mano: el scroll nativo del navegador ya resuelve mover la vista por una
  // imagen más grande que el hueco, sin estado ni gestos propios que
  // mantener.
  const [zoom, setZoom] = useState(1);
  const [cargando, setCargando] = useState(true);
  const [mejorando, setMejorando] = useState(false);
  const [factorUpscale, setFactorUpscale] = useState<1 | 2 | 4>(4);
  const [error, setError] = useState<string | null>(null);

  // Escala pantalla→canvas: el `<canvas>` interno vive a resolución nativa,
  // pero se pinta más pequeño (`display: w/h` fijos abajo) para caber en el
  // popup -- todo lo que llega por eventos de puntero está en coordenadas de
  // pantalla y hay que convertirlo antes de tocar el canvas.
  const escalaRef = useRef(1);
  const zoomRef = useRef(1);
  const [caja, setCaja] = useState<Caja | null>(null);
  // `null` = recorte libre (el de siempre). Un número fija ancho/alto -- las
  // esquinas dejan de deformar la caja y la mantienen a esa proporción; los
  // manejadores de borde (un solo eje) se ocultan mientras hay una fijada,
  // porque estirar un solo lado rompería la proporción que se acaba de pedir.
  const [aspecto, setAspecto] = useState<number | null>(null);

  function aplicarProporcion(r: number | null) {
    setAspecto(r);
    const canvas = canvasRef.current;
    if (r === null || !caja || !canvas) return;
    let w = caja.w;
    let h = w / r;
    if (h > canvas.height) { h = canvas.height; w = h * r; }
    if (w > canvas.width) { w = canvas.width; h = w / r; }
    const cx = caja.x + caja.w / 2;
    const cy = caja.y + caja.h / 2;
    const x = Math.max(0, Math.min(canvas.width - w, cx - w / 2));
    const y = Math.max(0, Math.min(canvas.height - h, cy - h / 2));
    setCaja({ x, y, w, h });
  }
  const arrastreRef = useRef<
    | { modo: "mover"; ox: number; oy: number }
    | { modo: "esquina"; esquina: "nw" | "ne" | "sw" | "se"; anclaX: number; anclaY: number }
    | { modo: "borde"; borde: "n" | "s" | "e" | "w" }
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
    const base = Math.min(MAX_W / canvas.width, MAX_H / canvas.height, 1);
    const escala = base * zoomRef.current;
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
      // Con el lienzo ahora siempre montado (ver el `hidden`/`contents` de
      // más abajo) esto no debería pasar nunca -- si pasa, mejor decirlo (y
      // sacar al esqueleto de en medio para que el error se vea) que
      // quedarse ahí para siempre en silencio, que es como se reportó este
      // mismo bug la primera vez.
      if (!canvas) { setError("no se pudo preparar el lienzo del editor"); setCargando(false); return; }
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

  // El área de agarre es más grande que el cuadrado de 14px que se dibuja
  // (ver `dibujarOverlay`) -- clavar el dedo o el cursor justo encima de un
  // handle es más difícil de lo que parece en pantalla; el punto de agarre
  // real crece sin que el handle visual también lo haga.
  const TOLERANCIA_AGARRE = 20;
  function esquinaEn(p: { x: number; y: number }, c: Caja): "nw" | "ne" | "sw" | "se" | null {
    const esc = escalaRef.current || 1;
    const tol = TOLERANCIA_AGARRE / esc;
    const esquinas: [("nw" | "ne" | "sw" | "se"), number, number][] = [
      ["nw", c.x, c.y], ["ne", c.x + c.w, c.y], ["sw", c.x, c.y + c.h], ["se", c.x + c.w, c.y + c.h],
    ];
    for (const [nombre, ex, ey] of esquinas) {
      if (Math.abs(p.x - ex) < tol && Math.abs(p.y - ey) < tol) return nombre;
    }
    return null;
  }

  // Los manejadores de borde solo existen en recorte libre: estirar un solo
  // lado con una proporción fijada rompería justo lo que se acaba de pedir.
  function bordeEn(p: { x: number; y: number }, c: Caja): "n" | "s" | "e" | "w" | null {
    if (aspecto !== null) return null;
    const esc = escalaRef.current || 1;
    const tol = TOLERANCIA_AGARRE / esc;
    const bordes: [("n" | "s" | "e" | "w"), number, number][] = [
      ["n", c.x + c.w / 2, c.y], ["s", c.x + c.w / 2, c.y + c.h],
      ["w", c.x, c.y + c.h / 2], ["e", c.x + c.w, c.y + c.h / 2],
    ];
    for (const [nombre, ex, ey] of bordes) {
      if (Math.abs(p.x - ex) < tol && Math.abs(p.y - ey) < tol) return nombre;
    }
    return null;
  }

  // Cursor nativo del sistema por encima de cada zona de agarre -- antes el
  // cursor se quedaba en la flecha por defecto sobre toda la caja de
  // recorte, sin ninguna pista de qué se puede hacer antes de arrastrar.
  function cursorDeEsquina(esquina: "nw" | "ne" | "sw" | "se"): string {
    return esquina === "nw" || esquina === "se" ? "nwse-resize" : "nesw-resize";
  }
  function cursorDeBorde(borde: "n" | "s" | "e" | "w"): string {
    return borde === "n" || borde === "s" ? "ns-resize" : "ew-resize";
  }
  function cursorDeRecorte(p: { x: number; y: number }, c: Caja): string {
    const esquina = esquinaEn(p, c);
    if (esquina) return cursorDeEsquina(esquina);
    const borde = bordeEn(p, c);
    if (borde) return cursorDeBorde(borde);
    if (p.x >= c.x && p.x <= c.x + c.w && p.y >= c.y && p.y <= c.y + c.h) return "move";
    return "default";
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
      const opuesta: Record<typeof esquina, [number, number]> = {
        nw: [caja.x + caja.w, caja.y + caja.h], ne: [caja.x, caja.y + caja.h],
        sw: [caja.x + caja.w, caja.y], se: [caja.x, caja.y],
      };
      const [anclaX, anclaY] = opuesta[esquina];
      arrastreRef.current = { modo: "esquina", esquina, anclaX, anclaY };
      if (overlayRef.current) overlayRef.current.style.cursor = cursorDeEsquina(esquina);
      return;
    }
    const borde = bordeEn(p, caja);
    if (borde) {
      arrastreRef.current = { modo: "borde", borde };
      if (overlayRef.current) overlayRef.current.style.cursor = cursorDeBorde(borde);
      return;
    }
    if (p.x >= caja.x && p.x <= caja.x + caja.w && p.y >= caja.y && p.y <= caja.y + caja.h) {
      arrastreRef.current = { modo: "mover", ox: p.x - caja.x, oy: p.y - caja.y };
      if (overlayRef.current) overlayRef.current.style.cursor = "move";
    }
  }

  function onPointerMove(e: React.PointerEvent) {
    const a = arrastreRef.current;
    if (!a) {
      if (herramienta === "blur") { dibujarOverlay(puntoCanvas(e)); return; }
      if (herramienta === "recorte" && caja && overlayRef.current) {
        overlayRef.current.style.cursor = cursorDeRecorte(puntoCanvas(e), caja);
      }
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
      return;
    }
    if (a.modo === "borde") {
      let { x, y, w, h } = caja;
      const x2 = x + w, y2 = y + h;
      if (a.borde === "n") { y = Math.min(p.y, y2 - 10); h = y2 - y; }
      if (a.borde === "s") { h = Math.max(10, p.y - y); }
      if (a.borde === "w") { x = Math.min(p.x, x2 - 10); w = x2 - x; }
      if (a.borde === "e") { w = Math.max(10, p.x - x); }
      x = Math.max(0, x); y = Math.max(0, y);
      w = Math.min(w, canvas.width - x); h = Math.min(h, canvas.height - y);
      setCaja({ x, y, w, h });
      return;
    }
    // a.modo === "esquina"
    if (aspecto !== null) {
      const dx = p.x - a.anclaX;
      const dy = p.y - a.anclaY;
      let w = Math.max(10, Math.abs(dx));
      let h = w / aspecto;
      if (Math.abs(dy) / (h || 1) > Math.abs(dx) / (w || 1)) {
        h = Math.max(10, Math.abs(dy));
        w = h * aspecto;
      }
      let x = dx >= 0 ? a.anclaX : a.anclaX - w;
      let y = dy >= 0 ? a.anclaY : a.anclaY - h;
      x = Math.max(0, Math.min(canvas.width - w, x));
      y = Math.max(0, Math.min(canvas.height - h, y));
      w = Math.min(w, canvas.width - x); h = Math.min(h, canvas.height - y);
      setCaja({ x, y, w, h });
      return;
    }
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
      const esc = escalaRef.current || 1;
      ctx.fillStyle = "rgba(0,0,0,.55)";
      ctx.fillRect(0, 0, overlay.width, overlay.height);
      ctx.clearRect(caja.x, caja.y, caja.w, caja.h);
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 2 / esc;
      ctx.strokeRect(caja.x, caja.y, caja.w, caja.h);

      // Rejilla de tercios: ayuda de composición estándar, siempre visible
      // mientras se recorta.
      ctx.strokeStyle = "rgba(255,255,255,.35)";
      ctx.lineWidth = 1 / esc;
      for (const f of [1 / 3, 2 / 3]) {
        ctx.beginPath();
        ctx.moveTo(caja.x + caja.w * f, caja.y);
        ctx.lineTo(caja.x + caja.w * f, caja.y + caja.h);
        ctx.moveTo(caja.x, caja.y + caja.h * f);
        ctx.lineTo(caja.x + caja.w, caja.y + caja.h * f);
        ctx.stroke();
      }

      // Manejadores de esquina: cuadrados de 14px de pantalla (antes puntos
      // de 5px), con halo cuando se está arrastrando justo ese -- "cogido"
      // de verdad, no solo un cursor que cambia.
      const lado = 14 / esc;
      const agarrando = arrastreRef.current?.modo === "esquina" ? arrastreRef.current.esquina : null;
      const esquinas: [string, number, number][] = [
        ["nw", caja.x, caja.y], ["ne", caja.x + caja.w, caja.y],
        ["sw", caja.x, caja.y + caja.h], ["se", caja.x + caja.w, caja.y + caja.h],
      ];
      for (const [nombre, ex, ey] of esquinas) {
        const activa = nombre === agarrando;
        const l = activa ? lado * 1.15 : lado;
        if (activa) {
          ctx.fillStyle = "rgba(255,255,255,.18)";
          ctx.beginPath();
          ctx.arc(ex, ey, l, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillStyle = "#fff";
        ctx.fillRect(ex - l / 2, ey - l / 2, l, l);
      }

      // Manejadores de borde (un eje), solo en recorte libre.
      if (aspecto === null) {
        const anchoBorde = 14 / esc, altoBorde = 8 / esc;
        const bordes: [number, number, number, number][] = [
          [caja.x + caja.w / 2, caja.y, anchoBorde, altoBorde],
          [caja.x + caja.w / 2, caja.y + caja.h, anchoBorde, altoBorde],
          [caja.x, caja.y + caja.h / 2, altoBorde, anchoBorde],
          [caja.x + caja.w, caja.y + caja.h / 2, altoBorde, anchoBorde],
        ];
        ctx.fillStyle = "rgba(255,255,255,.85)";
        for (const [ex, ey, w, h] of bordes) {
          ctx.fillRect(ex - w / 2, ey - h / 2, w, h);
        }
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

  // Fuera de recorte no hay agarres que calcular en cada movimiento de
  // ratón (eso lo hace `onPointerMove`/`onPointerDown` mientras la
  // herramienta activa es "recorte"), así que sin este efecto el cursor se
  // podía quedar "atascado" en un nwse-resize al cambiar de herramienta.
  useEffect(() => {
    if (overlayRef.current && herramienta !== "recorte") {
      overlayRef.current.style.cursor = herramienta === "blur" ? "none" : "default";
    }
  }, [herramienta]);

  useEffect(() => {
    zoomRef.current = zoom;
    ajustarOverlay();
    dibujarOverlay();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom]);

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

  // Rotar intercambia ancho/alto del lienzo -- por eso hace falta un canvas
  // temporal del tamaño ya girado, igual que ya hace `aplicarRecorte`.
  function rotar90() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const nuevo = document.createElement("canvas");
    nuevo.width = canvas.height;
    nuevo.height = canvas.width;
    const ctx = nuevo.getContext("2d");
    if (!ctx) return;
    ctx.translate(nuevo.width / 2, nuevo.height / 2);
    ctx.rotate(Math.PI / 2);
    ctx.drawImage(canvas, -canvas.width / 2, -canvas.height / 2);
    canvas.width = nuevo.width;
    canvas.height = nuevo.height;
    canvas.getContext("2d")?.drawImage(nuevo, 0, 0);
    ajustarOverlay();
    setCaja(null);
    snapshot();
  }

  function voltear(eje: "h" | "v") {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const nuevo = document.createElement("canvas");
    nuevo.width = canvas.width;
    nuevo.height = canvas.height;
    const ctx = nuevo.getContext("2d");
    if (!ctx) return;
    if (eje === "h") { ctx.translate(canvas.width, 0); ctx.scale(-1, 1); }
    else { ctx.translate(0, canvas.height); ctx.scale(1, -1); }
    ctx.drawImage(canvas, 0, 0);
    canvas.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
    canvas.getContext("2d")?.drawImage(nuevo, 0, 0);
    snapshot();
  }

  // Redibuja el canvas con el filtro ya "horneado" en los píxeles -- igual
  // que el blur, que tampoco deja el filtro puesto sobre el elemento, lo
  // aplica y lo suelta.
  function aplicarTono() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const nuevo = document.createElement("canvas");
    nuevo.width = canvas.width;
    nuevo.height = canvas.height;
    const ctx = nuevo.getContext("2d");
    if (!ctx) return;
    ctx.filter = `brightness(${brillo}%) contrast(${contraste}%)`;
    ctx.drawImage(canvas, 0, 0);
    canvas.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
    canvas.style.filter = "";
    canvas.getContext("2d")?.drawImage(nuevo, 0, 0);
    setBrillo(100);
    setContraste(100);
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
            const mejorado = await upscaler.onUpscale(blob, factorUpscale);
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

            {cargando && (
              // Skeleton con la forma real del editor (barra de herramientas +
              // lienzo) en vez de un spinner suelto -- se nota antes qué va a
              // aparecer, y una foto grande que tarda en llegar no se siente
              // como si la pantalla se hubiera quedado colgada.
              <div className="mt-4 animate-pulse">
                <div className="flex items-center gap-2">
                  <div className="h-[30px] w-[92px] rounded-lg bg-elevated" />
                  <div className="h-[30px] w-[76px] rounded-lg bg-elevated" />
                  <div className="ml-auto h-[26px] w-[60px] rounded-md bg-elevated" />
                </div>
                <div className="mt-3 rounded-xl bg-elevated" style={{ height: 300 }} />
              </div>
            )}
            {/* El lienzo vive FUERA del `if (cargando)` de arriba a propósito,
                aunque quede oculto detrás del esqueleto: `canvasRef` tiene que
                existir YA cuando `img.onload` (el efecto de más abajo) vaya a
                dibujar en él. Antes el canvas solo se montaba cuando
                `cargando` pasaba a `false` -- pero lo único que ponía
                `cargando` a `false` era ese mismo `onload`, que comprobaba
                `canvasRef.current` y se rendía en silencio si todavía era
                `null` (`if (!canvas) return`, sin error, sin log). Con una
                imagen que tarda lo bastante en decodificar como para que el
                efecto corra antes de que React monte el `else` de abajo --
                lo que "cuando haces drag and drop" reproducía siempre, no el
                selector de archivos, aunque el camino final sea el mismo --
                el editor se quedaba en el esqueleto para siempre. */}
            <div className={cargando ? "hidden" : "contents"}>
                <div className="mt-4 flex items-center gap-1">
                  {([
                    ["recorte", "crop", "Recortar"],
                    ["girar", "girar", "Girar y voltear"],
                    ["blur", "blur", "Difuminar"],
                    ["tono", "sparkle", "Brillo y contraste"],
                  ] as const).map(([id, icono, titulo], i) => (
                    <>
                      {i === 2 && <div key="sep" className="mx-1 h-5 w-px bg-border" />}
                      <button key={id} onClick={() => setHerramienta(id)} disabled={bloqueado} title={titulo}
                        className={`jg-press grid h-8 w-8 place-items-center rounded-lg border
                          ${herramienta === id ? "border-fg bg-white/[.06] text-fg" : "border-transparent text-subtle hover:text-fg"}`}>
                        <Icon name={icono} size={14} />
                      </button>
                    </>
                  ))}
                  <div className="ml-auto flex items-center gap-1">
                    <button onClick={() => setZoom((z) => Math.max(1, +(z - 0.5).toFixed(1)))}
                      disabled={bloqueado || zoom <= 1} title="Alejar"
                      className="jg-press rounded-md p-1.5 text-subtle hover:text-fg disabled:opacity-30">
                      −
                    </button>
                    <span className="w-8 text-center font-mono text-[10px] text-subtle">{zoom.toFixed(1)}×</span>
                    <button onClick={() => setZoom((z) => Math.min(4, +(z + 0.5).toFixed(1)))}
                      disabled={bloqueado || zoom >= 4} title="Acercar"
                      className="jg-press rounded-md p-1.5 text-subtle hover:text-fg disabled:opacity-30">
                      +
                    </button>
                    <div className="mx-1 h-5 w-px bg-border" />
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

                <div className="mt-2 flex min-h-[26px] items-center gap-2">
                  {herramienta === "recorte" && (
                    <div className="flex w-full items-center gap-1.5">
                      {([["Libre", null], ["1:1", 1], ["4:3", 4 / 3], ["16:9", 16 / 9]] as const).map(([etq, r]) => (
                        <button key={etq} onClick={() => aplicarProporcion(r)}
                          className={`jg-press rounded-md border px-2 py-1 text-[10px]
                            ${aspecto === r ? "border-fg text-fg" : "border-border text-subtle"}`}>
                          {etq}
                        </button>
                      ))}
                      {caja && (
                        <span className="ml-auto font-mono text-[10px] text-subtle">
                          {Math.round(caja.w)} × {Math.round(caja.h)} px
                        </span>
                      )}
                    </div>
                  )}
                  {herramienta === "blur" && (
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-subtle">radio</span>
                      <input type="range" min={6} max={80} value={radio}
                        onChange={(e) => setRadio(e.target.valueAsNumber)}
                        className="w-24 accent-fg" />
                    </div>
                  )}
                  {herramienta === "girar" && (
                    <div className="flex items-center gap-1.5">
                      <button onClick={rotar90} disabled={bloqueado}
                        className="jg-press flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-[10.5px] text-fg">
                        <Icon name="girar" size={12} /> Rotar 90°
                      </button>
                      <button onClick={() => voltear("h")} disabled={bloqueado}
                        className="jg-press rounded-md border border-border px-2.5 py-1 text-[10.5px] text-fg">
                        Voltear horizontal
                      </button>
                      <button onClick={() => voltear("v")} disabled={bloqueado}
                        className="jg-press rounded-md border border-border px-2.5 py-1 text-[10.5px] text-fg">
                        Voltear vertical
                      </button>
                    </div>
                  )}
                  {herramienta === "tono" && (
                    <div className="flex w-full items-center gap-3">
                      <span className="text-[10px] text-subtle">brillo</span>
                      <input type="range" min={40} max={160} value={brillo}
                        onChange={(e) => setBrillo(e.target.valueAsNumber)} className="w-20 accent-fg" />
                      <span className="text-[10px] text-subtle">contraste</span>
                      <input type="range" min={40} max={160} value={contraste}
                        onChange={(e) => setContraste(e.target.valueAsNumber)} className="w-20 accent-fg" />
                      <button onClick={aplicarTono} disabled={bloqueado}
                        className="jg-press ml-auto rounded-md border border-white/15 px-3 py-1 text-[10.5px] text-fg">
                        Aplicar tono
                      </button>
                    </div>
                  )}
                </div>

                <div ref={contenedorRef} className="mt-3 flex items-center justify-center overflow-auto rounded-xl border
                  border-border bg-black/30 p-2" style={{ minHeight: 300, maxHeight: 420 }}>
                  <div className="relative" style={{ lineHeight: 0 }}>
                    <canvas ref={canvasRef} className="rounded-md"
                      style={herramienta === "tono" ? { filter: `brightness(${brillo}%) contrast(${contraste}%)` } : undefined} />
                    <canvas ref={overlayRef}
                      className="absolute left-0 top-0 touch-none"
                      style={{ cursor: herramienta === "blur" ? "none" : "default" }}
                      onPointerDown={bloqueado ? undefined : onPointerDown}
                      onPointerMove={bloqueado ? undefined : onPointerMove}
                      onPointerUp={bloqueado ? undefined : onPointerUp} />
                    {mejorando && (
                      <div className="absolute inset-0 grid grid-cols-10 grid-rows-7">
                        {Array.from({ length: 70 }).map((_, i) => (
                          <div key={i} className="border border-white/50"
                            style={{ animation: `jg-alert-pulse 1.8s ease-in-out ${(i % 10) * 0.08 + Math.floor(i / 10) * 0.05}s infinite` }} />
                        ))}
                      </div>
                    )}
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
                      <div className="flex items-center gap-2">
                        {!mejorando && (
                          <div className="flex items-center gap-1 rounded-md border border-border p-0.5">
                            {([1, 2, 4] as const).map((f) => (
                              <button key={f} onClick={() => setFactorUpscale(f)}
                                className={`rounded px-2 py-1 text-[10px] ${
                                  factorUpscale === f ? "bg-white/[.08] text-fg" : "text-subtle"}`}>
                                {f}×
                              </button>
                            ))}
                          </div>
                        )}
                        <button onClick={() => void mejorarCalidad()} disabled={bloqueado}
                          className="jg-press flex items-center gap-1.5 rounded-lg border border-white/15 px-3 py-2
                            text-[11.5px] text-fg disabled:opacity-40">
                          <Icon name="sparkle" size={13} />
                          {mejorando ? "Mejorando…" : "Mejorar calidad"}
                        </button>
                      </div>
                    )}
                  </div>
                  <button onClick={() => exportarBlob(onExportar)} disabled={bloqueado}
                    className="jg-press rounded-lg bg-accent px-5 py-2 text-[11.5px] font-medium text-black
                      disabled:opacity-40">
                    Usar esta versión
                  </button>
                </div>
            </div>
          </FloatingCard>
        </Pop>
      </Center>
    </>
  );
}
