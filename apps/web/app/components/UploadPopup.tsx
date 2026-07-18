// apps/web/app/components/UploadPopup.tsx
"use client";
import { useState } from "react";
import { FloatingCard } from "./FloatingCard";
import { Menu } from "./Menu";
import { RETRIEVAL_MODELS } from "@netryx/shared-types";
import { ModePicker } from "./ModePicker";
import { CropDialog } from "./CropDialog";

interface Selected { file: File; url: string; displayName: string }

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

export function UploadPopup({
  files,
  onAddMore,
  onRemove,
  onSearch,
  busy,
  onCropSave,
}: {
  files: Selected[];
  onAddMore: (files: File[]) => void;
  onRemove: (index: number) => void;
  onSearch: () => void;
  busy: boolean;
  onCropSave: (index: number, croppedFile: File) => void;
}) {
  const [model, setModel] = useState(RETRIEVAL_MODELS[0]?.id ?? "lumi-preview");
  const [cropTarget, setCropTarget] = useState<{ index: number; url: string; name: string } | null>(null);

  return (
    <div className="absolute left-1/2 top-6 z-20 w-[460px] -translate-x-1/2">
      <FloatingCard className="p-4">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white/5 text-accent-fg">◎</span>
            <div>
              <div className="text-sm font-medium text-fg">Buscar región</div>
              <div className="text-xs text-muted">Áreas indexadas · geolocalización aproximada</div>
            </div>
          </div>
        </div>
        <ModePicker value={model} onChange={setModel} />
        <div className="mt-3 text-sm text-fg">{files.length} imagen{files.length === 1 ? "" : "es"} seleccionada{files.length === 1 ? "" : "s"}</div>
        <div className="mt-2.5 space-y-2">
          {files.map((f, i) => (
            <div key={f.url} className="flex items-center gap-3.5 rounded-lg bg-white/5 p-3">
              <img src={f.url} alt="" className="h-14 w-14 shrink-0 rounded-md object-cover" />
              <div className="min-w-0 flex-1 space-y-1.5">
                <div className="truncate text-[13px] leading-none text-fg">{f.displayName}</div>
                <div className="text-[11px] leading-none text-muted">
                  {formatSize(f.file.size)} · {(f.file.type.split("/")[1] ?? "img").toUpperCase()}
                </div>
                <button
                  onClick={() => setCropTarget({ index: i, url: f.url, name: f.file.name })}
                  className="flex items-center gap-1 rounded-md border border-white/[.15] px-2 py-0.5 text-[9.5px] text-fg transition-transform hover:scale-[1.04] active:scale-[.93]"
                >
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M6 3v14a2 2 0 0 0 2 2h14M3 6h14a2 2 0 0 1 2 2v14" /></svg>
                  Recortar
                </button>
              </div>
              <button onClick={() => onRemove(i)} className="shrink-0 text-subtle hover:text-fg" aria-label="Quitar">✕</button>
            </div>
          ))}
        </div>
        <div className="mt-4 flex items-center justify-between">
          <label className="cursor-pointer rounded-md border border-white/10 px-3 py-1.5 text-xs text-fg hover:bg-white/10">
            Añadir más
            <input type="file" accept="image/*" multiple className="hidden"
              onChange={(e) => e.target.files && onAddMore(Array.from(e.target.files))} />
          </label>
          <button onClick={onSearch} disabled={busy || files.length === 0}
            className="rounded-md bg-accent px-4 py-1.5 text-xs font-medium text-black disabled:opacity-50">
            {busy ? "Subiendo…" : "Buscar"}
          </button>
        </div>
      </FloatingCard>

      {cropTarget && (
        <CropDialog
          imageUrl={cropTarget.url}
          filename={cropTarget.name}
          onCancel={() => setCropTarget(null)}
          onSave={(croppedFile) => {
            onCropSave(cropTarget.index, croppedFile);
            setCropTarget(null);
          }}
        />
      )}
    </div>
  );
}