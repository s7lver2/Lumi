// apps/web/app/components/MapDropTarget.tsx
"use client";
import { useEffect, useState } from "react";

type Tab = "images" | "link" | "recent";

interface LibraryImageSummary {
  id: string;
  filename: string;
  sizeBytes: number;
  width: number;
  height: number;
  addedAt: number;
  sourceKind: "upload" | "url";
}

const IMAGE_ICON = (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="8.5" cy="9.5" r="1.4" /><path d="M21 16l-5-5a2 2 0 0 0-2.8 0L4 20" />
  </svg>
);
const LINK_ICON = (
  <svg width="13.5" height="13.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 17H7a5 5 0 0 1 0-10h2" /><path d="M15 7h2a5 5 0 0 1 0 10h-2" /><line x1="8" y1="12" x2="16" y2="12" />
  </svg>
);
const RECENT_ICON = (
  <svg width="13.5" height="13.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3.5 2" />
  </svg>
);

interface ReadyImage { id: string; filename: string }

export function MapDropTarget({ onImagesReady }: { onImagesReady: (images: ReadyImage[]) => void }) {
  const [tab, setTab] = useState<Tab>("images");
  const [dragging, setDragging] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [linkState, setLinkState] = useState<"idle" | "checking" | "verified" | "rejected">("idle");
  const [linkError, setLinkError] = useState<string | null>(null);
  const [recentImages, setRecentImages] = useState<LibraryImageSummary[]>([]);
  const [selectedRecent, setSelectedRecent] = useState<Set<string>>(new Set());
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  useEffect(() => {
    if (tab !== "recent") return;
    fetch("/api/library")
      .then((r) => r.json())
      .then((data) => setRecentImages(data.images ?? []));
  }, [tab]);

  async function uploadFiles(files: File[]) {
    setUploading(true);
    setUploadError(null);
    const ready: ReadyImage[] = [];
    let lastError: string | null = null;
    try {
      for (const file of files) {
        const form = new FormData();
        form.append("image", file);
        const res = await fetch("/api/library", { method: "POST", body: form });
        const data = await res.json().catch(() => null);
        if (res.ok && data) {
          ready.push({ id: data.image.id, filename: data.image.filename });
        } else {
          lastError = data?.error ?? "No se pudo subir la imagen";
        }
      }
    } catch {
      lastError = "No se pudo conectar con el servidor";
    }
    setUploading(false);
    if (ready.length > 0) onImagesReady(ready);
    if (lastError && ready.length === 0) setUploadError(lastError);
  }

  async function submitLink() {
    setLinkState("checking");
    setLinkError(null);
    const res = await fetch("/api/library/from-url", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: linkUrl }),
    });
    const data = await res.json();
    if (res.ok) {
      setLinkState("verified");
      onImagesReady([{ id: data.image.id, filename: data.image.filename }]);
    } else {
      setLinkState("rejected");
      setLinkError(data.error ?? "No se pudo verificar el enlace");
    }
  }

  function toggleRecent(id: string) {
    setSelectedRecent((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  return (
    <div className="absolute left-1/2 top-1/2 z-20 w-[300px] -translate-x-1/2 -translate-y-1/2">
      <div
        className={`overflow-hidden rounded-card border bg-panel/80 backdrop-blur-md shadow-lg shadow-black/40 transition-colors ${
          dragging ? "border-white/40" : "border-white/10"
        }`}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          uploadFiles(Array.from(e.dataTransfer.files));
        }}
      >
        {tab === "images" && (
          <div className="p-6 text-center">
            <div className="mx-auto mb-3.5 flex h-10 w-10 items-center justify-center rounded-[10px] border border-white/20 text-muted">
              {IMAGE_ICON}
            </div>
            <div className="text-[13px] font-medium text-fg">Sube fotos para empezar tu búsqueda</div>
            <div className="mt-1 text-[11px] text-muted">Arrastra y suelta imágenes desde tu equipo</div>
            <label className={`mt-4 inline-block rounded-lg bg-accent px-4 py-2 text-[11.5px] font-medium text-black transition-transform duration-150 ${
              uploading ? "cursor-wait opacity-60" : "cursor-pointer hover:scale-[1.03] active:scale-[.92]"
            }`}>
              {uploading ? "Subiendo…" : "Seleccionar archivos…"}
              <input
                type="file" accept="image/*" multiple className="hidden" disabled={uploading}
                onChange={(e) => e.target.files && uploadFiles(Array.from(e.target.files))}
              />
            </label>
            {uploadError && <div className="mt-3 text-[10.5px] text-danger-fg">{uploadError}</div>}
          </div>
        )}

        {tab === "link" && (
          <div className="p-6 text-center">
            <div className="mb-3 text-[12.5px] font-medium text-fg">Pega el enlace de una imagen</div>
            <input
              value={linkUrl}
              onChange={(e) => { setLinkUrl(e.target.value); setLinkState("idle"); }}
              placeholder="https://ejemplo.com/foto.jpg"
              className="w-full rounded-lg border border-white/15 bg-bg px-2.5 py-2 text-[11.5px] text-fg"
            />
            {linkState === "checking" && (
              <div className="mt-3 flex items-center justify-center gap-1.5 text-[11px] text-muted">
                <span className="inline-block h-2.5 w-2.5 animate-spin rounded-full border-2 border-white/25 border-t-fg" />
                Verificando enlace y contenido…
              </div>
            )}
            {linkState === "verified" && (
              <div className="mt-3 flex items-center justify-center gap-1.5 text-[10.5px] font-medium text-fg">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
                Enlace verificado — imagen segura
              </div>
            )}
            {linkState === "rejected" && linkError && (
              <div className="mt-3 text-[10.5px] text-danger-fg">{linkError}</div>
            )}
            <button
              onClick={submitLink}
              disabled={!linkUrl || linkState === "checking"}
              className="mt-4 rounded-lg bg-accent px-4 py-2 text-[11.5px] font-medium text-black disabled:opacity-40"
            >
              Cargar imagen
            </button>
          </div>
        )}

        {tab === "recent" && (
          <div className="p-3.5 pt-3.5">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[10.5px] font-medium text-fg">{recentImages.length} imágenes en memoria</span>
              <span className="text-[10px] text-muted">{selectedRecent.size} seleccionadas</span>
            </div>
            <div className="grid max-h-[150px] grid-cols-3 gap-1.5 overflow-y-auto">
              {recentImages.map((img) => (
                <button
                  key={img.id}
                  onClick={() => toggleRecent(img.id)}
                  className={`relative aspect-square overflow-hidden rounded-md border-2 bg-white/5 transition-transform hover:scale-[1.06] active:scale-95 ${
                    selectedRecent.has(img.id) ? "border-fg" : "border-white/15"
                  }`}
                >
                  <img
                    src={`/api/library/${img.id}/bytes`}
                    alt={img.filename}
                    loading="lazy"
                    className="h-full w-full object-cover"
                  />
                  {selectedRecent.has(img.id) && (
                    <span className="absolute left-0.5 top-0.5 flex h-3 w-3 items-center justify-center rounded-sm bg-accent text-[8px] text-black">✓</span>
                  )}
                </button>
              ))}
            </div>
            <button
              onClick={() =>
                onImagesReady(
                  recentImages
                    .filter((img) => selectedRecent.has(img.id))
                    .map((img) => ({ id: img.id, filename: img.filename }))
                )
              }
              disabled={selectedRecent.size === 0}
              className="mt-2.5 w-full rounded-lg bg-accent py-1.5 text-[11px] font-medium text-black disabled:opacity-40"
            >
              Usar seleccionadas ({selectedRecent.size})
            </button>
          </div>
        )}

        <div className="flex gap-1 border-t border-white/[.08] p-2">
          {([
            ["images", "Imágenes", IMAGE_ICON],
            ["link", "Enlace", LINK_ICON],
            ["recent", "Recientes", RECENT_ICON],
          ] as const).map(([key, label, icon]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg py-1.5 text-[10.5px] transition-transform hover:scale-[1.02] active:scale-[.93] ${
                tab === key ? "bg-white/5 font-medium text-fg" : "text-muted"
              }`}
            >
              <span className={tab === key ? "text-fg" : "text-subtle"}>{icon}</span>
              {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}