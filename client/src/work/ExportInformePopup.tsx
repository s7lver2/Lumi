import { useState } from "react";
import { previewInformePdf, type ExportInformeOpts } from "../lib/bridge";
import { Backdrop, FloatingCard, Pop } from "../ui/FloatingCard";
import { Icon } from "../ui/Icon";
import { Center } from "../ui/layout";

/** Interruptor de sección del informe -- mismo `role="switch"` y misma
 *  animación que ya usa `AjustesView`, solo con etiqueta+descripción a la
 *  izquierda en vez de a la derecha (aquí hay cuatro seguidos, y la etiqueta
 *  larga necesita todo el ancho de la fila). */
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

/** Popup de exportación del informe forense -- reemplaza el botón directo
 *  que hasta la 2.0.36 llamaba a `exportCasePdf` sin preguntar nada. Mismo
 *  chasis que `UploadPopup`/`AgentPickerPopup`/`AgentResultPopup`
 *  (`Backdrop`+`Center`+`Pop`+`FloatingCard`), más ancho que los tres porque
 *  lleva una previsualización real del PDF al lado de los controles.
 *
 *  La previsualización NO se regenera en cada tecla del campo de firma: solo
 *  al pulsar «Generar previsualización» o al tocar un interruptor -- generar
 *  un PDF de verdad (tectonic de por medio) en cada pulsación de tecla
 *  saturaría al servidor sin necesidad. */
export function ExportInformePopup({
  token, caseId, caseName, firmadoPorDefecto, closing, onClose, onGuardar,
}: {
  token: string | undefined;
  caseId: number;
  caseName: string;
  /** Precargado con el usuario de la sesión actual -- el investigador puede
   *  borrarlo o cambiarlo antes de generar. */
  firmadoPorDefecto: string;
  closing: boolean;
  onClose: () => void;
  /** El padre reutiliza el comando Tauri que ya sabía abrir el diálogo de
   *  guardado nativo -- este popup solo decide la config, no cómo se guarda. */
  onGuardar: (opts: ExportInformeOpts) => Promise<void>;
}) {
  const [opts, setOpts] = useState<ExportInformeOpts>({
    portada_estadisticas: true,
    exif_por_imagen: true,
    hipotesis_geolocalizacion: true,
    veredictos_agentes: true,
    firmado_por: firmadoPorDefecto,
  });
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [generando, setGenerando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set<K extends keyof ExportInformeOpts>(k: K, v: ExportInformeOpts[K]) {
    setOpts((o) => ({ ...o, [k]: v }));
  }

  async function generarPreview() {
    if (!token) return;
    setGenerando(true);
    setError(null);
    try {
      const base64 = await previewInformePdf(caseId, opts, token);
      // Blob URL, no `data:` -- lo pide la tarea explícitamente, y además un
      // PDF de varias páginas como `data:` URI infla el árbol DOM del
      // `<embed>` sin necesidad.
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

  // Cambiar un interruptor invalida la previsualización que hay en pantalla
  // -- ya no corresponde a la config actual -- pero no la regenera sola: eso
  // sigue siendo cosa del botón, para no lanzar tectonic en cada clic.
  function setYInvalida<K extends keyof ExportInformeOpts>(k: K, v: ExportInformeOpts[K]) {
    set(k, v);
    setPreviewUrl((anterior) => {
      if (anterior) URL.revokeObjectURL(anterior);
      return null;
    });
  }

  async function guardar() {
    setGuardando(true);
    setError(null);
    try {
      await onGuardar(opts);
    } catch (e) {
      setError(String(e));
    } finally {
      setGuardando(false);
    }
  }

  function cerrar() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    onClose();
  }

  return (
    <>
      <Backdrop closing={closing} onClick={generando || guardando ? undefined : cerrar} />
      <Center className="z-[55]">
        <Pop closing={closing} className="w-[960px] max-w-[calc(100vw-48px)]">
          <FloatingCard className="flex max-h-[calc(100vh-64px)] flex-col p-[17px]">
            <div className="flex shrink-0 items-center gap-2.5">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white/[.06] text-fg">
                <Icon name="doc-descarga" size={15} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-medium text-fg">Exportar informe · «{caseName}»</p>
                <p className="text-[11px] text-muted">Elige qué lleva y previsualízalo antes de guardar</p>
              </div>
              <button onClick={cerrar} disabled={guardando} aria-label="Cerrar"
                className="jg-press shrink-0 text-subtle hover:text-fg disabled:opacity-40">
                <Icon name="x" size={13} />
              </button>
            </div>

            <div className="mt-4 grid min-h-0 flex-1 grid-cols-[280px_1fr] gap-4 overflow-y-auto pr-0.5">
              <div className="flex flex-col divide-y divide-white/10">
                <Interruptor activo={opts.portada_estadisticas}
                  onChange={(v) => setYInvalida("portada_estadisticas", v)}
                  label="Portada con estadísticas" hint="Resumen del caso y gráfico por modelo" />
                <Interruptor activo={opts.exif_por_imagen}
                  onChange={(v) => setYInvalida("exif_por_imagen", v)}
                  label="EXIF por imagen" hint="GPS declarado por la cámara y datos del fichero" />
                <Interruptor activo={opts.hipotesis_geolocalizacion}
                  onChange={(v) => setYInvalida("hipotesis_geolocalizacion", v)}
                  label="Hipótesis de geolocalización" hint="Coordenada principal, radio, alternativas" />
                <Interruptor activo={opts.veredictos_agentes}
                  onChange={(v) => setYInvalida("veredictos_agentes", v)}
                  label="Veredictos de agentes" hint="Etiqueta, confianza y detalle de cada agente" />

                <div className="pt-3">
                  <label className="block text-[11px] text-muted" htmlFor="firmado-por">Firmado por</label>
                  <input id="firmado-por" type="text" value={opts.firmado_por}
                    onChange={(e) => setYInvalida("firmado_por", e.target.value)}
                    placeholder="(sin firma)"
                    className="mt-1.5 w-full rounded-lg border border-white/15 bg-white/[.04] px-2.5 py-1.5
                      text-[12px] text-fg outline-none focus:border-fg" />
                  <p className="mt-1.5 text-[10px] text-subtle">
                    Vacío omite la sección de firma entera. La fecha es la de generación, no la de creación del caso.
                  </p>
                </div>

                <div className="flex-1" />

                <div className="flex flex-col gap-2 pt-3">
                  <button onClick={() => void generarPreview()} disabled={generando || guardando}
                    className="jg-press rounded-lg border border-white/15 px-4 py-2 text-[11.5px] text-fg
                      disabled:opacity-40">
                    {generando ? "Compilando…" : previewUrl ? "Regenerar previsualización" : "Generar previsualización"}
                  </button>
                  <button onClick={() => void guardar()} disabled={guardando || generando}
                    className="jg-press rounded-lg bg-accent px-4 py-2 text-[11.5px] font-medium text-black
                      disabled:opacity-40">
                    {guardando ? "Un momento…" : "Guardar informe"}
                  </button>
                </div>

                {error && (
                  <div className="mt-3 flex items-start gap-2">
                    <Icon name="alert" size={12} className="mt-px shrink-0 text-danger-fg" />
                    <p className="text-[10.5px] leading-snug text-muted">{error}</p>
                  </div>
                )}
              </div>

              <div className="min-h-[420px] overflow-hidden rounded-[9px] border border-white/10 bg-white/[.03]">
                {previewUrl ? (
                  <embed src={previewUrl} type="application/pdf" className="h-full min-h-[420px] w-full" />
                ) : (
                  <div className="flex h-full min-h-[420px] items-center justify-center p-6 text-center">
                    <p className="text-[11.5px] text-subtle">
                      {generando ? "Compilando el informe con tectonic…" : "Pulsa «Generar previsualización» para ver el PDF aquí."}
                    </p>
                  </div>
                )}
              </div>
            </div>
          </FloatingCard>
        </Pop>
      </Center>
    </>
  );
}
