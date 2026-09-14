# Menú de exportar — asistente en pasos con boceto en vivo — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rehacer `client/src/work/ExportPopup.tsx` como un asistente de 3 pasos (Aspecto /
Contenido / Firma) con un breadcrumb minimalista, filas de contenido con icono propio en vez
del interruptor tipo iOS, y un boceto CSS en vivo de la portada/pie de firma junto a los
controles.

**Architecture:** Un solo componente de React se reestructura internamente: estado nuevo
`paso` decide qué bloque de controles se pinta; dos subcomponentes de presentación nuevos
(`Pasos` para el breadcrumb, `FilaContenido` para cada fila con icono) sustituyen al
`Interruptor` de antes; un tercero (`BocetoInforme`) pinta la maqueta aproximada. Nada del
estado existente (`opts`, `excluidas`, `previewUrl`...) ni de las llamadas al backend
cambian.

**Tech Stack:** React + TypeScript, Tailwind (clases existentes del tema de `DESIGN.md`),
iconos SVG a mano ya definidos en `client/src/ui/Icon.tsx` (sin iconos nuevos).

## Global Constraints

- No se toca `ExportInformeOpts`, `routes/export.rs`, la plantilla `.tex.tera` ni
  `PdfPreviewPopup.tsx` — ver spec, sección "Alcance".
- Sin impresión directa desde el popup — el owner confirmó que Guardar + abrir el PDF basta.
- Sin interruptor tipo iOS en este popup — cada opción es una fila entera clicable con icono
  propio (reutilizado de `Icon.tsx`, ninguno nuevo) y un check que solo se ve si está activa.
- Sin barra de progreso ni burbujas numeradas para los pasos — breadcrumb de texto con filete
  bajo el paso activo.
- El boceto de la derecha es una maqueta CSS aproximada, nunca el PDF real compilado — eso lo
  sigue haciendo el botón "Vista previa" tal cual existe hoy.
- Este repo no tiene test runner de frontend (`client/package.json` no declara ninguno) y la
  convención del proyecto es "no tests a menos que se pidan explícitamente" — el ciclo de
  verificación de cada tarea es `tsc -b` (vía `npm run build`) + `npx oxlint` contra los
  ficheros tocados, comparando cualquier warning nuevo contra la base ya aceptada
  (`react-hooks/exhaustive-deps` y similares, preexistentes en el repo).
- Español para nombres de componentes, comentarios y copy de UI, igual que el resto del
  repo.

---

### Task 1: Asistente de 3 pasos con filas de icono (sin boceto todavía)

**Files:**
- Modify: `client/src/work/ExportPopup.tsx` (reescritura completa, 265 líneas → sustituido
  íntegro por el contenido de abajo)

**Interfaces:**
- Consumes: `ExportInformeOpts`, `previewInformePdf`, `lumiUrl` de `../lib/bridge`; `Image`
  de `../lib/api`; `Backdrop`/`FloatingCard`/`Pop` de `../ui/FloatingCard`; `Icon`,
  `IconName` de `../ui/Icon`; `Center` de `../ui/layout`; `PdfPreviewPopup` — todo ya
  existente, ninguna firma cambia.
- Produces: el componente exportado `ExportPopup` mantiene exactamente la misma firma de
  props que hoy (`token, caseId, caseName, images, firmadoPorDefecto, closing, onClose,
  onGuardar`) — quien lo usa (`CaseView.tsx`) no necesita ningún cambio. Internamente expone
  el tipo `PasoId = "aspecto" | "contenido" | "firma"` y el subcomponente `FilaContenido`,
  que la Tarea 2 reutiliza tal cual.

- [ ] **Step 1: Reemplazar el contenido completo de `ExportPopup.tsx`**

Sustituye TODO el fichero por:

```tsx
import { useState } from "react";
import type { Image } from "../lib/api";
import { lumiUrl, previewInformePdf, type ExportInformeOpts } from "../lib/bridge";
import { Backdrop, FloatingCard, Pop } from "../ui/FloatingCard";
import { Icon, type IconName } from "../ui/Icon";
import { Center } from "../ui/layout";
import { PdfPreviewPopup } from "./PdfPreviewPopup";

type PasoId = "aspecto" | "contenido" | "firma";

const PASOS: { id: PasoId; label: string }[] = [
  { id: "aspecto", label: "Aspecto" },
  { id: "contenido", label: "Contenido" },
  { id: "firma", label: "Firma" },
];

/** Breadcrumb de pasos -- nada de barra de progreso ni burbujas numeradas,
 *  que es el lenguaje del wizard de /setup y aquí leería como una operación
 *  larga cuando exportar no lo es. El paso activo lleva un filete debajo;
 *  los ya recorridos se pueden volver a tocar para saltar atrás. */
function Pasos({ actual, onIr }: { actual: PasoId; onIr: (p: PasoId) => void }) {
  const i = PASOS.findIndex((p) => p.id === actual);
  return (
    <div className="mb-4 flex items-baseline gap-4">
      {PASOS.map((p, idx) => (
        <button key={p.id} type="button" onClick={() => onIr(p.id)}
          className={`relative pb-1.5 text-[11.5px] transition-colors duration-300 ease-expo
            ${p.id === actual ? "text-fg" : idx < i ? "text-muted" : "text-subtle"}`}>
          {p.label}
          {p.id === actual && <span className="absolute inset-x-0 bottom-0 h-px bg-fg" />}
        </button>
      ))}
    </div>
  );
}

/** Una fila de contenido del informe: icono propio de lo que representa,
 *  etiqueta y un check que solo se ve si está activa -- sustituye al
 *  interruptor tipo iOS de antes ("muy básico", feedback directo del
 *  owner). Toda la fila es el control, sin pista ni perilla que arrastrar. */
function FilaContenido({ icono, activo, onChange, label, hint, deshabilitado }: {
  icono: IconName; activo: boolean; onChange: (v: boolean) => void;
  label: string; hint: string; deshabilitado?: boolean;
}) {
  return (
    <button type="button" disabled={deshabilitado} onClick={() => onChange(!activo)}
      className={`flex w-full items-center gap-2.5 rounded-lg px-1 py-2 text-left transition-colors
        duration-300 ease-expo hover:bg-white/[.03] ${deshabilitado ? "cursor-not-allowed opacity-40" : ""}`}>
      <Icon name={icono} size={15} className={activo ? "text-fg" : "text-subtle"} />
      <span className="min-w-0 flex-1">
        <span className={`block text-[12px] ${activo ? "text-fg" : "text-subtle"}`}>{label}</span>
        <small className="mt-0.5 block text-[9.5px] text-muted">{hint}</small>
      </span>
      <Icon name="check" size={12}
        className={`shrink-0 text-fg transition-opacity duration-200 ${activo ? "opacity-100" : "opacity-0"}`} />
    </button>
  );
}

type ClaveContenido =
  | "portada_estadisticas" | "exif_por_imagen" | "hipotesis_geolocalizacion"
  | "veredictos_agentes" | "integridad_sha256" | "rasgos_como_imagen";

const CAMPOS_CONTENIDO: { key: ClaveContenido; icono: IconName; label: string; hint: string }[] = [
  { key: "portada_estadisticas", icono: "pulse", label: "Portada con estadísticas", hint: "Resumen del caso y gráfico por modelo" },
  { key: "exif_por_imagen", icono: "image", label: "EXIF por imagen", hint: "GPS declarado por la cámara y datos del fichero" },
  { key: "hipotesis_geolocalizacion", icono: "globe", label: "Hipótesis de geolocalización", hint: "Coordenada principal, radio, alternativas" },
  { key: "veredictos_agentes", icono: "users", label: "Veredictos de agentes", hint: "Etiqueta, confianza y detalle de cada agente" },
  { key: "integridad_sha256", icono: "shield", label: "Integridad de archivo", hint: "Hash sha256 del original de cada foto, para cadena de custodia" },
  { key: "rasgos_como_imagen", icono: "boxes", label: "Rasgos como imagen", hint: "Recuadros OCR o mapa de profundidad, dibujados en vez de solo texto" },
];

/** Exportar, como popup -- asistente de 3 pasos (Aspecto/Contenido/Firma) en
 *  vez de una sola pantalla con ocho controles seguidos: el owner lo probó y
 *  lo calificó de "horrible" (ver `2026-09-14-menu-exportar-design.md`). La
 *  previsualización real del PDF sigue en su propio popup (`PdfPreviewPopup`)
 *  al pulsar «Vista previa», en el último paso. */
export function ExportPopup({
  token, caseId, caseName, images, firmadoPorDefecto, closing, onClose, onGuardar,
}: {
  token: string | undefined;
  caseId: number;
  caseName: string;
  images: Image[];
  firmadoPorDefecto: string;
  closing: boolean;
  onClose: () => void;
  onGuardar: (opts: ExportInformeOpts) => Promise<void>;
}) {
  const [paso, setPaso] = useState<PasoId>("aspecto");
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
    disposicion: "compacta",
  });
  const [excluidas, setExcluidas] = useState<Set<number>>(new Set());
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [generando, setGenerando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set<K extends keyof ExportInformeOpts>(k: K, v: ExportInformeOpts[K]) {
    setOpts((o) => ({ ...o, [k]: v }));
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

  const iPaso = PASOS.findIndex((p) => p.id === paso);
  const siguiente = PASOS[iPaso + 1] ?? null;
  const anterior = PASOS[iPaso - 1] ?? null;

  return (
    <>
      <Backdrop closing={closing} onClick={guardando ? undefined : onClose} />
      <Center className="z-[55]">
        <Pop closing={closing} className="w-[460px] max-w-[calc(100vw-48px)]">
          <FloatingCard className="flex max-h-[calc(100vh-64px)] flex-col p-[17px]">
            <div className="flex shrink-0 items-center gap-2">
              <span className="flex-1 truncate text-[13px] font-medium text-fg">Exportar «{caseName}»</span>
              <button onClick={onClose} aria-label="Cerrar"
                className="jg-press shrink-0 text-subtle hover:text-fg">
                <Icon name="x" size={13} />
              </button>
            </div>
            <p className="mb-4 mt-0.5 shrink-0 text-[10.5px] text-subtle">
              Informe forense en PDF -- el original queda intacto.
            </p>

            <Pasos actual={paso} onIr={setPaso} />

            <div className="overflow-y-auto pr-0.5">
              {paso === "aspecto" && (
                <div className="flex flex-col">
                  <FilaContenido icono="sparkle" activo={opts.tema === "oscuro"}
                    onChange={(v) => set("tema", v ? "oscuro" : "claro")}
                    label="Tema oscuro" hint="Apagado usa el documento imprimible de siempre (fondo claro)" />
                  <FilaContenido icono="layers" activo={opts.disposicion === "banda"}
                    onChange={(v) => set("disposicion", v ? "banda" : "compacta")}
                    deshabilitado={opts.tema !== "oscuro"}
                    label="Foto a ancho completo"
                    hint={opts.tema !== "oscuro"
                      ? "Solo disponible en el tema oscuro"
                      : "Miniatura grande en vez de al lado de los datos"} />
                </div>
              )}

              {paso === "contenido" && (
                <div className="flex flex-col">
                  {CAMPOS_CONTENIDO.map((c) => (
                    <FilaContenido key={c.key} icono={c.icono} activo={opts[c.key]}
                      onChange={(v) => set(c.key, v)} label={c.label} hint={c.hint} />
                  ))}
                </div>
              )}

              {paso === "firma" && (
                <>
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

                  <div className="mt-3">
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
                    <div className="mt-3">
                      <p className="text-[11px] text-muted">Imágenes incluidas</p>
                      <div className="mt-1.5 flex max-h-[180px] flex-col gap-1 overflow-y-auto rounded-[9px]
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
                </>
              )}

              {error && <p className="mt-3 text-[10.5px] leading-snug text-danger-fg">{error}</p>}
            </div>

            <div className="mt-3 flex shrink-0 gap-2">
              {anterior && (
                <button onClick={() => setPaso(anterior.id)}
                  className="jg-press shrink-0 rounded-[9px] px-3 py-2 text-[11.5px] text-subtle hover:text-fg">
                  ← Atrás
                </button>
              )}
              {siguiente ? (
                <button onClick={() => setPaso(siguiente.id)}
                  className="jg-press flex-1 rounded-[9px] bg-accent px-4 py-2 text-[11.5px] font-medium text-black">
                  Siguiente: {siguiente.label} →
                </button>
              ) : (
                <>
                  <button onClick={() => void generarPreview()} disabled={generando || guardando}
                    className="jg-press flex-1 rounded-[9px] border border-white/15 px-4 py-2 text-[11.5px] text-fg
                      disabled:opacity-40">
                    {generando ? "Compilando…" : previewUrl ? "Regenerar vista previa" : "Vista previa"}
                  </button>
                  <button onClick={() => void guardar()} disabled={guardando || generando}
                    className="jg-press flex-1 rounded-[9px] bg-accent px-4 py-2 text-[11.5px] font-medium text-black
                      disabled:opacity-40">
                    {guardando ? "Un momento…" : "Guardar informe"}
                  </button>
                </>
              )}
            </div>
          </FloatingCard>
        </Pop>
      </Center>

      {previewUrl && <PdfPreviewPopup url={previewUrl} onClose={cerrarPreview} />}
    </>
  );
}
```

- [ ] **Step 2: Comprobar que compila**

Run: `cd client && npm run build`
Expected: `tsc -b && vite build` termina sin errores (el mismo resultado que antes de tocar
el fichero — build limpio).

- [ ] **Step 3: Lint del fichero tocado**

Run: `cd client && npx oxlint src/work/ExportPopup.tsx`
Expected: sin warnings nuevos. (El fichero no usaba hooks con dependencias antes, así que no
debería aparecer ningún `react-hooks/exhaustive-deps` nuevo.)

- [ ] **Step 4: Commit**

```bash
git add client/src/work/ExportPopup.tsx
git commit -m "feat(export): popup de exportar como asistente de 3 pasos, sin switches

Reemplaza la lista plana de interruptores por Aspecto/Contenido/Firma con
breadcrumb minimalista y filas con icono propio + check -- feedback directo
del owner (\"se ve horrible\", \"muy básicas\" sobre los switches). Sin boceto
en vivo todavía, eso es la siguiente tarea.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: Boceto CSS en vivo junto a los controles

**Files:**
- Modify: `client/src/work/ExportPopup.tsx` (de la Task 1)

**Interfaces:**
- Consumes: `PasoId`, `ExportInformeOpts` de la Task 1 — sin cambios de tipo.
- Produces: `BocetoInforme`, un componente de presentación puro (`{ paso, opts } => JSX`)
  interno al fichero, sin más consumidores previstos.

- [ ] **Step 1: Añadir el componente `BocetoInforme`**

Inserta esto justo después de `FilaContenido` y antes de `type ClaveContenido = ...`:

```tsx
/** Maqueta CSS aproximada de la portada (pasos Aspecto/Contenido) o del pie
 *  de firma (paso Firma) -- NO es el PDF real: eso lo sigue compilando
 *  `tectonic` solo cuando se pulsa "Vista previa". Da una pista instantánea
 *  de qué va a llevar el informe sin ese coste en cada toque. */
function BocetoInforme({ paso, opts }: { paso: PasoId; opts: ExportInformeOpts }) {
  if (paso === "firma") {
    return (
      <div className="flex aspect-[210/297] flex-col justify-end rounded-[9px] border border-border bg-surface p-3.5">
        <div className="border-t border-white/10 pt-2">
          <div className="h-[3px] w-2/3 rounded-full bg-white/10" />
          <p className="mt-2 text-[9px] leading-snug text-subtle">
            {opts.firmado_por ? `Firmado por ${opts.firmado_por}` : "(sin firma)"}
          </p>
        </div>
      </div>
    );
  }
  return (
    <div className="flex aspect-[210/297] flex-col rounded-[9px] border border-border bg-surface p-3.5">
      <div className={`rounded-[6px] bg-elevated ${opts.disposicion === "banda" ? "h-[46%]" : "h-[34%]"}`} />
      {opts.portada_estadisticas && (
        <div className="mt-2.5 flex gap-1">
          <div className="h-[22px] flex-1 rounded bg-panel" />
          <div className="h-[22px] flex-1 rounded bg-panel" />
          <div className="h-[22px] flex-1 rounded bg-panel" />
        </div>
      )}
      <div className="mt-2.5 flex flex-col gap-1.5">
        <div className="h-[5px] w-[70%] rounded-full bg-border" />
        {opts.hipotesis_geolocalizacion && <div className="h-[5px] w-[90%] rounded-full bg-border" />}
        {opts.veredictos_agentes && <div className="h-[5px] w-[50%] rounded-full bg-border" />}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Ensanchar el popup y partir el cuerpo en dos columnas**

Cambia el ancho del `Pop`:

```tsx
        <Pop closing={closing} className="w-[460px] max-w-[calc(100vw-48px)]">
```
por:
```tsx
        <Pop closing={closing} className="w-[640px] max-w-[calc(100vw-48px)]">
```

Y sustituye el bloque que envuelve los tres `{paso === ...}` (empieza en
`<div className="overflow-y-auto pr-0.5">` y termina justo antes de
`<div className="mt-3 flex shrink-0 gap-2">`) por la misma lista de pasos envuelta en dos
columnas:

```tsx
            <div className="flex gap-5">
              <div className="min-w-0 flex-[1.15] overflow-y-auto pr-0.5">
                {paso === "aspecto" && (
                  <div className="flex flex-col">
                    <FilaContenido icono="sparkle" activo={opts.tema === "oscuro"}
                      onChange={(v) => set("tema", v ? "oscuro" : "claro")}
                      label="Tema oscuro" hint="Apagado usa el documento imprimible de siempre (fondo claro)" />
                    <FilaContenido icono="layers" activo={opts.disposicion === "banda"}
                      onChange={(v) => set("disposicion", v ? "banda" : "compacta")}
                      deshabilitado={opts.tema !== "oscuro"}
                      label="Foto a ancho completo"
                      hint={opts.tema !== "oscuro"
                        ? "Solo disponible en el tema oscuro"
                        : "Miniatura grande en vez de al lado de los datos"} />
                  </div>
                )}

                {paso === "contenido" && (
                  <div className="flex flex-col">
                    {CAMPOS_CONTENIDO.map((c) => (
                      <FilaContenido key={c.key} icono={c.icono} activo={opts[c.key]}
                        onChange={(v) => set(c.key, v)} label={c.label} hint={c.hint} />
                    ))}
                  </div>
                )}

                {paso === "firma" && (
                  <>
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

                    <div className="mt-3">
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
                      <div className="mt-3">
                        <p className="text-[11px] text-muted">Imágenes incluidas</p>
                        <div className="mt-1.5 flex max-h-[180px] flex-col gap-1 overflow-y-auto rounded-[9px]
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
                  </>
                )}

                {error && <p className="mt-3 text-[10.5px] leading-snug text-danger-fg">{error}</p>}
              </div>

              <div className="w-[190px] shrink-0">
                <BocetoInforme paso={paso} opts={opts} />
                <p className="mt-2 text-center text-[9.5px] text-subtle">boceto aproximado, no el PDF final</p>
              </div>
            </div>
```

- [ ] **Step 3: Comprobar que compila**

Run: `cd client && npm run build`
Expected: sin errores. Presta atención especial a que `opts`, `excluidas`, `images`,
`toggleImagen`, `set`, `error` sigan resolviéndose (siguen siendo el mismo closure de
componente, solo cambia el JSX que los envuelve).

- [ ] **Step 4: Lint del fichero tocado**

Run: `cd client && npx oxlint src/work/ExportPopup.tsx`
Expected: sin warnings nuevos.

- [ ] **Step 5: Commit**

```bash
git add client/src/work/ExportPopup.tsx
git commit -m "feat(export): boceto CSS en vivo de portada/firma junto a los controles

Panel fijo a la derecha con proporción A4 que refleja tema, disposición y
qué contenido está activado -- aproximado, no compila tectonic en cada
toque. La Vista previa real del último paso sigue siendo la fuente de
verdad antes de guardar.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Verificación manual (no automatizada)

Este popup no tiene test runner de frontend, así que el criterio final es manual: el usuario
prueba la app él mismo (preferencia ya establecida en este proyecto: no arrancar el preview
del navegador por iniciativa propia). Tras la Task 2, comprobar a ojo antes de darlo por
cerrado:

- Los tres pasos se recorren con "Siguiente"/"← Atrás" y también tocando el breadcrumb.
- "Foto a ancho completo" sigue deshabilitada y con su motivo cuando el tema no es oscuro.
- El boceto cambia al activar/desactivar cada fila del paso Contenido, y cambia de portada a
  pie de firma al entrar al paso Firma.
- "Vista previa" y "Guardar informe" siguen funcionando igual que antes (mismo
  `optsConSeleccion()`, mismo `onGuardar`).
