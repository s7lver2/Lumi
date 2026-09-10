import { useEffect, useMemo, useRef, useState } from "react";
import { api, type FeatureFlags, type Image, type MediaFolder, type ProjectImage } from "../lib/api";
import { blobToBase64, copyImageBytes, lumiUrl, overwriteImageBytes } from "../lib/bridge";
import { useDismissable } from "../lib/useDismissable";
import { ContextMenu, type MenuState } from "../ui/ContextMenu";
import { Icon } from "../ui/Icon";
import { Drawer } from "./Drawer";
import { ImageEditorPopup } from "./ImageEditorPopup";

type Modo = "caso" | "proyecto";

/** Panel Media (spec 2026-09-10 §3): la organización de las imágenes de un
 *  caso (y, si el servidor lo activó, de todo el proyecto), en el mismo
 *  carril de cajones que Resultados/Invitar/Exportar. Carpetas virtuales,
 *  metadato puro -- borrar una nunca borra sus imágenes. */
export function MediaDrawer({
  token, caseId, projectId, imagenesDelCaso, features, open, onClose, onAnalizar, onCambio,
}: {
  token: string | undefined;
  caseId: number;
  projectId: number;
  /** Ya cargadas por `CaseView` -- modo caso las reutiliza tal cual, sin
   *  pedirlas otra vez. */
  imagenesDelCaso: Image[];
  features: FeatureFlags | null;
  open: boolean;
  onClose: () => void;
  /** Click izquierdo en una imagen, o "Analizar" con varias seleccionadas
   *  (una petición por imagen, reutilizando el flujo que ya existe) -- lo
   *  decide `CaseView`, que es quien sabe abrir `AgentPickerPopup`/lanzar. */
  onAnalizar: (imagenes: Image[]) => void;
  /** Tras mover/borrar/sobrescribir/copiar: `CaseView` recarga su lista. */
  onCambio: () => void;
}) {
  const [modo, setModo] = useState<Modo>("caso");
  const [carpetas, setCarpetas] = useState<MediaFolder[]>([]);
  const [imagenesProyecto, setImagenesProyecto] = useState<ProjectImage[] | null>(null);
  const [carpetaActual, setCarpetaActual] = useState<number | null | "todas">("todas");
  const [seleccion, setSeleccion] = useState<Set<number>>(new Set());
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nuevaCarpeta, setNuevaCarpeta] = useState(false);
  const [nombreCarpeta, setNombreCarpeta] = useState("");
  const ultimoClick = useRef<number | null>(null);

  const puedeModoProyecto = features?.media_por_proyecto_activo ?? false;

  function cargarCarpetas(m: Modo) {
    api.get<MediaFolder[]>(`/v1/cases/${caseId}/media/folders?modo=${m}`, token).then(setCarpetas).catch(() => {});
  }
  useEffect(() => { if (open) cargarCarpetas(modo); }, [open, modo, caseId, token]);
  useEffect(() => {
    if (!open || modo !== "proyecto") return;
    api.get<ProjectImage[]>(`/v1/projects/${projectId}/images`, token).then(setImagenesProyecto).catch(() => {});
  }, [open, modo, projectId, token]);

  const imagenes: Image[] = useMemo(() => {
    const base: Image[] = modo === "proyecto" ? (imagenesProyecto ?? []) : imagenesDelCaso;
    if (carpetaActual === "todas") return base;
    return base.filter((im) => im.folder_id === carpetaActual);
  }, [modo, imagenesProyecto, imagenesDelCaso, carpetaActual]);

  function toggleSeleccion(id: number, e: React.MouseEvent) {
    setSeleccion((prev) => {
      const next = new Set(prev);
      if (e.shiftKey && ultimoClick.current !== null) {
        const ids = imagenes.map((i) => i.id);
        const a = ids.indexOf(ultimoClick.current), b = ids.indexOf(id);
        if (a !== -1 && b !== -1) {
          for (const i of ids.slice(Math.min(a, b), Math.max(a, b) + 1)) next.add(i);
          return next;
        }
      }
      if (e.ctrlKey || e.metaKey) {
        if (next.has(id)) next.delete(id); else next.add(id);
      } else {
        return new Set([id]);
      }
      return next;
    });
    ultimoClick.current = id;
  }

  async function crearCarpeta() {
    const nombre = nombreCarpeta.trim();
    if (!nombre) return;
    try {
      const c = await api.post<MediaFolder>(`/v1/cases/${caseId}/media/folders?modo=${modo}`, { nombre }, token);
      setCarpetas((v) => [...v, c].sort((a, b) => a.nombre.localeCompare(b.nombre)));
      setNuevaCarpeta(false);
      setNombreCarpeta("");
    } catch (e) {
      setError(String(e));
    }
  }

  async function borrarCarpeta(id: number) {
    try {
      await api.del(`/v1/media/folders/${id}`, token);
      setCarpetas((v) => v.filter((c) => c.id !== id));
      if (carpetaActual === id) setCarpetaActual("todas");
      onCambio();
    } catch (e) {
      setError(String(e));
    }
  }

  async function mover(ids: number[], folderId: number | null) {
    try {
      await Promise.all(ids.map((id) => api.patch(`/v1/images/${id}/mover`, { folder_id: folderId }, token)));
      onCambio();
    } catch (e) {
      setError(String(e));
    }
  }

  async function eliminar(ids: number[]) {
    if (!confirm(ids.length === 1 ? "¿Eliminar esta imagen? Es un borrado real." : `¿Eliminar ${ids.length} imágenes? Es un borrado real.`)) return;
    try {
      await Promise.all(ids.map((id) => api.del(`/v1/images/${id}`, token)));
      setSeleccion(new Set());
      onCambio();
    } catch (e) {
      setError(String(e));
    }
  }

  // --- Editar desde Media: recorte/blur/upscaler, luego Sobrescribir o Copia ---
  const [editando, setEditando] = useState<Image | null>(null);
  const editorPop = useDismissable(editando !== null, 180);
  const [pendienteBlob, setPendienteBlob] = useState<Blob | null>(null);

  function abrirEditor(img: Image) {
    setEditando(img);
  }
  async function guardar(modo_: "sobrescribir" | "copia") {
    if (!editando || !pendienteBlob) return;
    try {
      const base64 = await blobToBase64(pendienteBlob);
      if (modo_ === "sobrescribir") {
        await overwriteImageBytes(editando.id, base64, editando.filename);
      } else {
        await copyImageBytes(editando.id, base64, editando.filename);
      }
      setEditando(null);
      setPendienteBlob(null);
      onCambio();
    } catch (e) {
      setError(String(e));
    }
  }

  function menuContextual(e: React.MouseEvent, img: Image) {
    e.preventDefault();
    const ids = seleccion.has(img.id) ? Array.from(seleccion) : [img.id];
    setMenu({
      x: e.clientX, y: e.clientY, title: ids.length > 1 ? `${ids.length} imágenes` : img.filename,
      items: [
        { label: "Editar…", disabled: ids.length > 1, onClick: () => abrirEditor(img) },
        {
          label: "Mover a…",
          onClick: () => setMenu({
            x: e.clientX, y: e.clientY, title: "Mover a…",
            items: [
              { label: "Sin carpeta", onClick: () => void mover(ids, null) },
              ...carpetas.map((c) => ({ label: c.nombre, onClick: () => void mover(ids, c.id) })),
            ],
          }),
        },
        null,
        { label: "Eliminar", danger: true, onClick: () => void eliminar(ids) },
      ],
    });
  }

  return (
    <>
      <Drawer open={open}>
        <div className="flex items-center gap-2">
          <span className="flex-1 truncate text-[12px] text-fg">Media</span>
          <button onClick={onClose} aria-label="Cerrar"
            className="grid h-[22px] w-[22px] place-items-center rounded-md text-subtle
              transition-colors hover:bg-white/[.05] hover:text-fg">
            <Icon name="x" size={11} />
          </button>
        </div>

        {puedeModoProyecto && (
          <div className="flex rounded-lg border border-border p-0.5">
            {(["caso", "proyecto"] as Modo[]).map((m) => (
              <button key={m} onClick={() => { setModo(m); setCarpetaActual("todas"); setSeleccion(new Set()); }}
                className={`flex-1 rounded-md py-1 text-[10.5px] transition-colors
                  ${modo === m ? "bg-white/[.08] text-fg" : "text-subtle"}`}>
                {m === "caso" ? "Este caso" : "Todo el proyecto"}
              </button>
            ))}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-1.5">
          <button onClick={() => setCarpetaActual("todas")}
            className={`rounded-md border px-2 py-1 text-[10px]
              ${carpetaActual === "todas" ? "border-fg text-fg" : "border-border text-subtle"}`}>
            Todas
          </button>
          <button onClick={() => setCarpetaActual(null)}
            className={`rounded-md border px-2 py-1 text-[10px]
              ${carpetaActual === null ? "border-fg text-fg" : "border-border text-subtle"}`}>
            Sin carpeta
          </button>
          {carpetas.map((c) => (
            <button key={c.id} onClick={() => setCarpetaActual(c.id)}
              onContextMenu={(e) => {
                e.preventDefault();
                setMenu({ x: e.clientX, y: e.clientY, title: c.nombre, items: [
                  { label: "Borrar carpeta", danger: true, onClick: () => void borrarCarpeta(c.id) },
                ] });
              }}
              className={`flex items-center gap-1 rounded-md border px-2 py-1 text-[10px]
                ${carpetaActual === c.id ? "border-fg text-fg" : "border-border text-subtle"}`}>
              <Icon name="folder" size={10} /> {c.nombre}
            </button>
          ))}
          {nuevaCarpeta ? (
            <span className="flex items-center gap-1">
              <input autoFocus value={nombreCarpeta} onChange={(e) => setNombreCarpeta(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") void crearCarpeta(); if (e.key === "Escape") setNuevaCarpeta(false); }}
                placeholder="Nombre" className="w-24 rounded-md border border-border bg-[#0d0f12] px-1.5 py-1 text-[10px] text-fg outline-none" />
              <button onClick={() => void crearCarpeta()} className="jg-press text-subtle hover:text-fg"><Icon name="check" size={11} /></button>
            </span>
          ) : (
            <button onClick={() => setNuevaCarpeta(true)}
              className="flex items-center gap-1 rounded-md border border-dashed border-subtle/50 px-2 py-1 text-[10px] text-subtle">
              <Icon name="plus" size={10} /> Nueva carpeta
            </button>
          )}
        </div>

        {seleccion.size > 0 && (
          <div className="flex items-center gap-2 rounded-lg border border-border bg-white/[.03] px-2 py-1.5">
            <span className="text-[10.5px] text-fg">{seleccion.size} seleccionadas</span>
            <div className="ml-auto flex items-center gap-1.5">
              <button onClick={() => onAnalizar(imagenes.filter((i) => seleccion.has(i.id)))}
                className="jg-press rounded-md border border-white/15 px-2 py-1 text-[10px] text-fg">
                Analizar
              </button>
              <button onClick={() => void eliminar(Array.from(seleccion))}
                className="jg-press rounded-md border border-danger-fg/40 px-2 py-1 text-[10px] text-danger-fg">
                Eliminar
              </button>
            </div>
          </div>
        )}

        {error && <p className="text-[10.5px] leading-snug text-danger-fg">{error}</p>}

        <div className="grid grid-cols-3 gap-1.5 overflow-y-auto pr-0.5">
          {imagenes.map((im) => (
            <button key={im.id}
              onClick={(e) => {
                if (e.ctrlKey || e.metaKey || e.shiftKey) { toggleSeleccion(im.id, e); return; }
                if (seleccion.size > 0) { toggleSeleccion(im.id, e); return; }
                onAnalizar([im]);
              }}
              onContextMenu={(e) => menuContextual(e, im)}
              className={`group relative aspect-square overflow-hidden rounded-md border
                ${seleccion.has(im.id) ? "border-fg" : "border-border"}`}>
              <img src={lumiUrl(`/v1/images/${im.id}/thumb`)} alt="" className="h-full w-full object-cover" />
              {seleccion.has(im.id) && (
                <span className="absolute right-1 top-1 grid h-4 w-4 place-items-center rounded-full bg-fg text-[#111]">
                  <Icon name="check" size={9} />
                </span>
              )}
            </button>
          ))}
          {imagenes.length === 0 && (
            <p className="col-span-3 mt-4 text-center text-[11px] text-muted">
              {carpetaActual === "todas" ? "No hay imágenes aquí todavía." : "Esta carpeta está vacía."}
            </p>
          )}
        </div>
      </Drawer>

      <ContextMenu state={menu} onClose={() => setMenu(null)} />

      {editorPop.rendered && editando && (
        <EditorDesdeMedia imagen={editando} closing={editorPop.closing}
          onExportar={(blob) => setPendienteBlob(blob)}
          onCerrar={() => { setEditando(null); setPendienteBlob(null); }} />
      )}

      {pendienteBlob && editando && (
        <ConfirmarSobrescribirOCopia imagen={editando} token={token}
          onSobrescribir={() => void guardar("sobrescribir")}
          onCopia={() => void guardar("copia")}
          onCancelar={() => setPendienteBlob(null)} />
      )}
    </>
  );
}

/** El editor del punto 2, sobre una imagen YA EXISTENTE en vez de una recién
 *  elegida del disco -- misma `ImageEditorPopup`, la fuente es la imagen
 *  completa del servidor (`lumiUrl`) en vez de una ruta local. */
function EditorDesdeMedia({ imagen, closing, onExportar, onCerrar }: {
  imagen: Image;
  closing: boolean;
  onExportar: (blob: Blob) => void;
  onCerrar: () => void;
}) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    fetch(lumiUrl(`/v1/images/${imagen.id}`)).then((r) => r.blob()).then((b) => setSrc(URL.createObjectURL(b)));
    return () => { if (src) URL.revokeObjectURL(src); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imagen.id]);
  if (!src) return null;
  return (
    <ImageEditorPopup srcDataUrl={src} fileName={imagen.filename} closing={closing}
      // El upscaler desde Media sigue necesitando un `case_id` para
      // encolarse (mismo motivo que desde la subida) -- fuera de alcance de
      // esta entrega conectar ese botón aquí también sin duplicar la
      // imagen; se deja sin "Mejorar calidad" en este punto de entrada.
      upscaler={null}
      onExportar={onExportar} onOmitir={onCerrar} onCerrar={onCerrar} />
  );
}

function ConfirmarSobrescribirOCopia({ imagen, token, onSobrescribir, onCopia, onCancelar }: {
  imagen: Image;
  token: string | undefined;
  onSobrescribir: () => void;
  onCopia: () => void;
  onCancelar: () => void;
}) {
  const [desincronizados, setDesincronizados] = useState<number | null>(null);
  useEffect(() => {
    api.get<unknown[]>(`/v1/images/${imagen.id}/analisis-desincronizados`, token)
      .then((v) => setDesincronizados(v.length))
      .catch(() => setDesincronizados(0));
  }, [imagen.id, token]);
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70">
      <div className="w-[360px] rounded-card border border-white/[.13] bg-[rgba(16,19,25,.96)] p-5 backdrop-blur-xl">
        <p className="text-[13px] text-fg">¿Sobrescribir o guardar como copia?</p>
        <p className="mt-1.5 text-[11px] leading-relaxed text-muted">
          Sobrescribir reemplaza los bytes de «{imagen.filename}» (mismo id). Guardar como copia deja la
          original intacta y crea una imagen nueva.
        </p>
        {desincronizados !== null && desincronizados > 0 && (
          <p className="mt-2 flex items-start gap-1.5 text-[10.5px] leading-snug text-warning-fg">
            <Icon name="alert" size={12} className="mt-px shrink-0" />
            {desincronizados} análisis ya existentes de esta imagen quedarán mirando una versión anterior si
            se sobrescribe.
          </p>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onCancelar} className="rounded-lg border border-border px-3.5 py-1.5 text-[11px] text-subtle">
            Cancelar
          </button>
          <button onClick={onCopia} className="jg-press rounded-lg border border-white/15 px-3.5 py-1.5 text-[11px] text-fg">
            Guardar como copia
          </button>
          <button onClick={onSobrescribir} className="jg-press rounded-lg bg-accent px-3.5 py-1.5 text-[11px] font-medium text-black">
            Sobrescribir
          </button>
        </div>
      </div>
    </div>
  );
}
