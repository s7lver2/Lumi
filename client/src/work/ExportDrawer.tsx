import { useState } from "react";
import type { Image } from "../lib/api";
import { lumiUrl, previewInformePdf, type ExportInformeOpts } from "../lib/bridge";
import { Icon } from "../ui/Icon";
import { Drawer } from "./Drawer";
import { PdfPreviewPopup } from "./PdfPreviewPopup";

/** Interruptor de sección del informe -- mismo `role="switch"` y misma
 *  animación que ya usa `AjustesView`. */
function Interruptor({ activo, onChange, label, hint }: {
  activo: boolean; onChange: (v: boolean) => void; label: string; hint: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <span className="text-[12px] text-fg">
        {label}
        <small className="mt-0.5 block text-[10.5px] text-subtle">{hint}</small>
      </span>
      <button role="switch" aria-checked={activo} onClick={() => onChange(!activo)}
        className={`relative h-5 w-10 shrink-0 rounded-full border transition-colors duration-300 ease-expo
          ${activo ? "border-accent bg-accent" : "border-white/15 bg-white/10"}`}>
        <span className={`absolute top-0.5 h-3.5 w-3.5 rounded-full bg-fg ring-1 ring-black/20
          transition-transform duration-300 ease-expo ${activo ? "translate-x-[18px]" : "translate-x-0.5"}`} />
      </button>
    </div>
  );
}

/** Exportar vive en el mismo carril que Resultados e Invitar (`DrawerId`), no
 *  en un botón flotante sobre el mapa -- es una sección del caso, no una
 *  acción de un click. La previsualización real del PDF necesita más ancho
 *  del que caben los 360px del cajón, así que sale a su propio popup
 *  (`PdfPreviewPopup`) al pulsar «Vista previa»; la configuración (qué lleva,
 *  quién firma) sí cabe aquí sin problema. */
export function ExportDrawer({
  token, caseId, caseName, images, firmadoPorDefecto, open, onClose, onGuardar,
}: {
  token: string | undefined;
  caseId: number;
  caseName: string;
  /** Del caso actual -- para el selector de qué imágenes entran en el
   *  informe. Todas marcadas por defecto. */
  images: Image[];
  /** Precargado con el usuario de la sesión actual -- el investigador puede
   *  borrarlo o cambiarlo antes de generar. */
  firmadoPorDefecto: string;
  open: boolean;
  onClose: () => void;
  /** El padre reutiliza el comando Tauri que ya sabía abrir el diálogo de
   *  guardado nativo -- este cajón solo decide la config, no cómo se guarda. */
  onGuardar: (opts: ExportInformeOpts) => Promise<void>;
}) {
  const [opts, setOpts] = useState<ExportInformeOpts>({
    portada_estadisticas: true,
    exif_por_imagen: true,
    hipotesis_geolocalizacion: true,
    veredictos_agentes: true,
    firmado_por: firmadoPorDefecto,
    integridad_sha256: true,
    rasgos_como_imagen: true,
    imagenes_incluidas: null,
    notas: "",
    tema: "oscuro",
  });
  // Aparte de `opts.imagenes_incluidas` (que solo se rellena al mandar la
  // petición, y con `null` cuando están todas): el set de qué está marcado
  // ahora mismo en la lista. Empieza vacío = "todas" hasta que `images`
  // llega la primera vez.
  const [excluidas, setExcluidas] = useState<Set<number>>(new Set());
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [generando, setGenerando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set<K extends keyof ExportInformeOpts>(k: K, v: ExportInformeOpts[K]) {
    setOpts((o) => ({ ...o, [k]: v }));
    // Cambiar un interruptor invalida la previsualización que hay generada --
    // ya no corresponde a la config actual.
    setPreviewUrl((anterior) => {
      if (anterior) URL.revokeObjectURL(anterior);
      return null;
    });
  }

  function toggleImagen(id: number) {
    setExcluidas((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
    setPreviewUrl((anterior) => {
      if (anterior) URL.revokeObjectURL(anterior);
      return null;
    });
  }

  // `null` (todas) mientras nada se ha desmarcado -- el comportamiento de
  // siempre sin tocar nada, igual que manda el backend por defecto.
  function optsConSeleccion(): ExportInformeOpts {
    if (excluidas.size === 0) return { ...opts, imagenes_incluidas: null };
    const incluidas = images.filter((im) => !excluidas.has(im.id)).map((im) => im.id);
    return { ...opts, imagenes_incluidas: incluidas };
  }

  async function generarPreview() {
    if (!token) return;
    setGenerando(true);
    setError(null);
    try {
      const base64 = await previewInformePdf(caseId, optsConSeleccion(), token);
      const bin = atob(base64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const blob = new Blob([bytes], { type: "application/pdf" });
      setPreviewUrl((anterior) => {
        if (anterior) URL.revokeObjectURL(anterior);
        return URL.createObjectURL(blob);
      });
    } catch (e) {
      setError(String(e));
    } finally {
      setGenerando(false);
    }
  }

  async function guardar() {
    setGuardando(true);
    setError(null);
    try {
      await onGuardar(optsConSeleccion());
    } catch (e) {
      setError(String(e));
    } finally {
      setGuardando(false);
    }
  }

  function cerrarPreview() {
    setPreviewUrl((anterior) => {
      if (anterior) URL.revokeObjectURL(anterior);
      return null;
    });
  }

  return (
    <>
      <Drawer open={open}>
        <div className="flex items-center gap-2">
          <span className="flex-1 truncate text-[12px] text-fg">Exportar «{caseName}»</span>
          <button onClick={onClose} aria-label="Cerrar"
            className="grid h-[22px] w-[22px] place-items-center rounded-md text-subtle
              transition-colors hover:bg-white/[.05] hover:text-fg">
            <Icon name="x" size={11} />
          </button>
        </div>
        <p className="text-[10.5px] text-subtle">Informe forense en PDF -- el original queda intacto.</p>

        <div className="flex flex-col divide-y divide-white/10">
          <Interruptor activo={opts.tema === "oscuro"} onChange={(v) => set("tema", v ? "oscuro" : "claro")}
            label="Tema oscuro" hint="Apagado usa el documento imprimible de siempre (fondo claro)" />
          <Interruptor activo={opts.portada_estadisticas} onChange={(v) => set("portada_estadisticas", v)}
            label="Portada con estadísticas" hint="Resumen del caso y gráfico por modelo" />
          <Interruptor activo={opts.exif_por_imagen} onChange={(v) => set("exif_por_imagen", v)}
            label="EXIF por imagen" hint="GPS declarado por la cámara y datos del fichero" />
          <Interruptor activo={opts.hipotesis_geolocalizacion} onChange={(v) => set("hipotesis_geolocalizacion", v)}
            label="Hipótesis de geolocalización" hint="Coordenada principal, radio, alternativas" />
          <Interruptor activo={opts.veredictos_agentes} onChange={(v) => set("veredictos_agentes", v)}
            label="Veredictos de agentes" hint="Etiqueta, confianza y detalle de cada agente" />
          <Interruptor activo={opts.integridad_sha256} onChange={(v) => set("integridad_sha256", v)}
            label="Integridad de archivo" hint="Hash sha256 del original de cada foto, para cadena de custodia" />
          <Interruptor activo={opts.rasgos_como_imagen} onChange={(v) => set("rasgos_como_imagen", v)}
            label="Rasgos como imagen" hint="Recuadros OCR o mapa de profundidad, dibujados en vez de solo texto" />
        </div>

        <div>
          <label className="block text-[11px] text-muted" htmlFor="firmado-por">Firmado por</label>
          <input id="firmado-por" type="text" value={opts.firmado_por}
            onChange={(e) => set("firmado_por", e.target.value)}
            placeholder="(sin firma)"
            className="mt-1.5 w-full rounded-[9px] border border-border bg-[#0d0f12] px-2.5 py-[7px]
              text-[12px] text-fg outline-none transition-[border-color] duration-300 ease-expo
              placeholder:text-subtle focus:border-white/40" />
          <p className="mt-1.5 text-[10px] text-subtle">
            Vacío omite la sección de firma. La fecha es la de generación, no la de creación del caso.
          </p>
        </div>

        <div>
          <label className="block text-[11px] text-muted" htmlFor="notas-informe">Notas del investigador</label>
          <textarea id="notas-informe" value={opts.notas} rows={3}
            onChange={(e) => set("notas", e.target.value)}
            placeholder="Observaciones o contexto del caso (opcional)"
            className="mt-1.5 w-full resize-none rounded-[9px] border border-border bg-[#0d0f12] px-2.5 py-[7px]
              text-[12px] text-fg outline-none transition-[border-color] duration-300 ease-expo
              placeholder:text-subtle focus:border-white/40" />
          <p className="mt-1.5 text-[10px] text-subtle">Vacío omite la sección entera del informe.</p>
        </div>

        {images.length > 0 && (
          <div>
            <p className="text-[11px] text-muted">Imágenes incluidas</p>
            <div className="mt-1.5 flex max-h-[220px] flex-col gap-1 overflow-y-auto rounded-[9px]
              border border-border bg-[#0d0f12] p-1.5">
              {images.map((im) => {
                const incluida = !excluidas.has(im.id);
                return (
                  <label key={im.id}
                    className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 hover:bg-white/[.04]">
                    <input type="checkbox" checked={incluida} onChange={() => toggleImagen(im.id)}
                      className="h-3.5 w-3.5 shrink-0 accent-accent" />
                    <img src={lumiUrl(`/v1/images/${im.id}/thumb`)} alt=""
                      className="h-6 w-6 shrink-0 rounded bg-elevated object-cover" />
                    <span className="truncate text-[11px] text-fg">{im.filename}</span>
                  </label>
                );
              })}
            </div>
            <p className="mt-1.5 text-[10px] text-subtle">
              Todas marcadas por defecto -- desmarca las que no deban entrar en el informe.
            </p>
          </div>
        )}

        {error && <p className="text-[10.5px] leading-snug text-danger-fg">{error}</p>}

        <div className="flex-1" />

        <div className="flex flex-col gap-2">
          <button onClick={() => void generarPreview()} disabled={generando || guardando}
            className="jg-press rounded-[9px] border border-white/15 px-4 py-2 text-[11.5px] text-fg
              disabled:opacity-40">
            {generando ? "Compilando…" : previewUrl ? "Regenerar vista previa" : "Vista previa"}
          </button>
          <button onClick={() => void guardar()} disabled={guardando || generando}
            className="jg-press rounded-[9px] bg-accent px-4 py-2 text-[11.5px] font-medium text-black
              disabled:opacity-40">
            {guardando ? "Un momento…" : "Guardar informe"}
          </button>
        </div>
      </Drawer>

      {previewUrl && <PdfPreviewPopup url={previewUrl} onClose={cerrarPreview} />}
    </>
  );
}
