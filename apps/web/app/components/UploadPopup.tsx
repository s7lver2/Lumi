// apps/web/app/components/UploadPopup.tsx
"use client";
import { useState } from "react";
import { FloatingCard } from "./FloatingCard";
import { Menu } from "./Menu";
import { RETRIEVAL_MODELS } from "@netryx/shared-types";

interface Selected { file: File; url: string }

export function UploadPopup({
  files, onAddMore, onRemove, onSearch, busy,
}: {
  files: Selected[];
  onAddMore: (files: File[]) => void;
  onRemove: (index: number) => void;
  onSearch: () => void;
  busy: boolean;
}) {
  const [model, setModel] = useState(RETRIEVAL_MODELS[0]?.id ?? "lumi-preview");
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
        <div className="mt-3 flex items-center justify-between rounded-md bg-white/5 px-3 py-2">
          <span className="text-xs text-muted">Modelo</span>
          <Menu value={model} onChange={setModel}
            options={RETRIEVAL_MODELS.map((m) => ({ value: m.id, label: m.displayName, hint: m.status }))} />
        </div>
        <div className="mt-3 text-sm text-fg">{files.length} imagen{files.length === 1 ? "" : "es"} seleccionada{files.length === 1 ? "" : "s"}</div>
        <div className="mt-2 space-y-2">
          {files.map((f, i) => (
            <div key={f.url} className="flex items-center gap-3 rounded-md bg-white/5 p-2">
              <img src={f.url} alt="" className="h-12 w-16 rounded object-cover" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs text-fg">{f.file.name}</div>
                <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted">
                  <span>{Math.round(f.file.size / 1024)}kb {f.file.type.split("/")[1]}</span>
                  <span className="rounded bg-white/5 px-1.5 py-0.5">METADATA</span>
                </div>
              </div>
              <button onClick={() => onRemove(i)} className="text-subtle hover:text-fg" aria-label="Quitar">✕</button>
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
    </div>
  );
}