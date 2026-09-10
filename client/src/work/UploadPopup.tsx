import { useState } from "react";
import type { Image } from "../lib/api";
import { lumiUrl } from "../lib/bridge";
import { Backdrop, FloatingCard, Pop } from "../ui/FloatingCard";
import { Icon } from "../ui/Icon";
import { ModelPicker } from "./ModelPicker";
import { Center } from "../ui/layout";

const kb = (b: number) => (b < 1024 * 1024 ? `${Math.round(b / 1024)} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`);

/** Entre subir y analizar hacía falta un sitio donde mirar lo que has traído y
 *  decidir con qué modelo. Antes no existía: la imagen entraba y «Analizar
 *  esta imagen» lanzaba con `"mini"` escrito a mano en el código.
 *
 *  Las imágenes ya están subidas cuando esto se abre. Es a propósito: solo el
 *  servidor sabe leer el EXIF y hacer la miniatura, así que un popup previo a
 *  la subida no podría enseñar ni el GPS declarado ni la foto. */
export function UploadPopup({
  images, caseName, models, closing, busy, error, calibracionActivo,
  onAddMore, onDiscard, onAnalyze, onClose,
}: {
  images: Image[];
  caseName: string;
  models: string[];
  closing: boolean;
  busy: boolean;
  error: string | null;
  /** Spec 2026-09-10 §4d: con `modo_calibracion` apagado (o ausente en un
   *  servidor viejo), el selector de motor/dispositivo forzado ni siquiera se
   *  monta -- no es una función capada con explicación, es tooling que este
   *  servidor no ha activado. */
  calibracionActivo?: boolean;
  onAddMore: () => void;
  onDiscard: (id: number) => void;
  onAnalyze: (model: string, forzar?: { motor?: string; dispositivo?: string }) => void;
  onClose: () => void;
}) {
  const [model, setModel] = useState(models[0] ?? "");
  const [forzarMotor, setForzarMotor] = useState("");
  const [forzarDispositivo, setForzarDispositivo] = useState("");

  return (
    <>
      <Backdrop closing={closing} onClick={busy ? undefined : onClose} />
      <Center className="z-[45]">
      <Pop closing={closing} className="w-[470px]">
        <FloatingCard className="p-[17px]">
          <div className="flex items-center gap-2.5">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white/[.06] text-fg">
              <Icon name="globe" size={15} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-medium text-fg">Analizar en «{caseName}»</p>
              <p className="text-[11px] text-muted">Un análisis por imagen · el original queda intacto</p>
            </div>
            <button onClick={onClose} disabled={busy} aria-label="Cerrar"
              className="jg-press shrink-0 text-subtle hover:text-fg disabled:opacity-40">
              <Icon name="x" size={13} />
            </button>
          </div>

          <ModelPicker models={models} value={model} onChange={setModel} />

          {calibracionActivo && (
            <div className="mt-2.5 flex items-center gap-2 rounded-lg border border-dashed border-white/15 p-2.5">
              <input value={forzarMotor} onChange={(e) => setForzarMotor(e.target.value)}
                placeholder="forzar motor (opcional)"
                className="w-full rounded-md border border-border bg-elevated px-2 py-1 font-mono text-[10.5px] text-fg outline-none focus:border-white/40" />
              <input value={forzarDispositivo} onChange={(e) => setForzarDispositivo(e.target.value)}
                placeholder="forzar dispositivo (opcional)"
                className="w-full rounded-md border border-border bg-elevated px-2 py-1 font-mono text-[10.5px] text-fg outline-none focus:border-white/40" />
            </div>
          )}

          <p className="mt-3 text-[12px] text-fg">
            {images.length} {images.length === 1 ? "imagen seleccionada" : "imágenes seleccionadas"}
          </p>

          <div className="mt-2 max-h-[240px] space-y-[7px] overflow-y-auto pr-0.5">
            {images.map((im) => (
              <div key={im.id} className="flex items-center gap-3 rounded-[9px] bg-white/[.045] p-[9px_11px]">
                <img src={lumiUrl(`/v1/images/${im.id}/thumb`)} alt=""
                  className="h-[50px] w-[50px] shrink-0 rounded-[7px] bg-elevated object-cover" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[12px] text-fg">{im.filename}</p>
                  <p className="mt-[3px] font-mono text-[10px] text-muted">
                    {kb(im.bytes)}
                    {im.width && im.height ? ` · ${im.width}×${im.height}` : ""}
                  </p>
                </div>
                {/* El GPS declarado se avisa aquí y en ámbar, antes de lanzar:
                    saber que la cámara ya dice dónde estuvo cambia lo que
                    esperas del resultado. */}
                {im.exif_lat !== null && im.exif_lng !== null && (
                  <span className="shrink-0 rounded border border-warning/40 px-1.5 py-px text-[8.5px] text-warning-fg">
                    GPS en EXIF
                  </span>
                )}
                <button onClick={() => onDiscard(im.id)} disabled={busy}
                  title="Quitar del caso y borrarla del servidor" aria-label="Quitar"
                  className="jg-press shrink-0 text-subtle hover:text-danger-fg disabled:opacity-40">
                  <Icon name="x" size={12} />
                </button>
              </div>
            ))}
          </div>

          {error && (
            <div className="mt-3 flex items-start gap-2">
              <Icon name="alert" size={12} className="mt-px shrink-0 text-danger-fg" />
              <p className="text-[10.5px] leading-snug text-muted">{error}</p>
            </div>
          )}

          <div className="mt-4 flex items-center justify-between gap-3">
            <button onClick={onAddMore} disabled={busy}
              className="jg-press rounded-lg border border-white/15 px-4 py-2 text-[11.5px] text-fg disabled:opacity-40">
              Añadir más
            </button>
            <button onClick={() => onAnalyze(model, calibracionActivo
              ? { motor: forzarMotor || undefined, dispositivo: forzarDispositivo || undefined }
              : undefined)}
              disabled={busy || images.length === 0 || models.length === 0}
              className="jg-press rounded-lg bg-accent px-5 py-2 text-[11.5px] font-medium text-black disabled:opacity-40">
              {busy ? "Un momento…" : images.length === 1 ? "Analizar" : `Analizar ${images.length}`}
            </button>
          </div>
        </FloatingCard>
      </Pop>
      </Center>
    </>
  );
}
