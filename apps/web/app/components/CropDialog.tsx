// apps/web/app/components/CropDialog.tsx
"use client";
import { useRef, useState } from "react";
import Cropper, { type Area } from "react-easy-crop";
import { FloatingCard } from "./FloatingCard";

type AspectOption = "free" | "1:1" | "16:9";
const ASPECT_VALUES: Record<AspectOption, number | undefined> = { free: undefined, "1:1": 1, "16:9": 16 / 9 };

/** Ported verbatim from the now-deleted ImageDropzone.tsx — canvas-based
 * exact-pixel crop, unchanged. */
async function cropToFile(src: string, area: Area, name: string): Promise<File> {
  const img = document.createElement("img");
  img.src = src;
  await new Promise((res) => (img.onload = res));

  const canvas = document.createElement("canvas");
  canvas.width = area.width;
  canvas.height = area.height;

  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(img, area.x, area.y, area.width, area.height, 0, 0, area.width, area.height);

  const blob: Blob = await new Promise((res) => canvas.toBlob((b) => res(b!), "image/jpeg", 0.92));
  return new File([blob], name, { type: "image/jpeg" });
}

export function CropDialog({
  imageUrl, filename, onCancel, onSave,
}: {
  imageUrl: string;
  filename: string;
  onCancel: () => void;
  onSave: (file: File) => void;
}) {
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [aspect, setAspect] = useState<AspectOption>("free");
  const areaRef = useRef<Area | null>(null);

  async function handleSave() {
    if (!areaRef.current) return;
    const file = await cropToFile(imageUrl, areaRef.current, filename);
    onSave(file);
  }

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/60">
      <FloatingCard className="w-[320px] overflow-hidden">
        <div className="flex items-center justify-between border-b border-white/[.08] p-3.5">
          <span className="text-[11.5px] font-medium text-fg">Recortar imagen</span>
          <button onClick={onCancel} className="text-subtle hover:text-fg" aria-label="Cerrar">✕</button>
        </div>

        <div className="relative aspect-square w-full bg-black">
          <Cropper
            image={imageUrl}
            crop={crop}
            zoom={zoom}
            aspect={ASPECT_VALUES[aspect]}
            onCropChange={setCrop}
            onZoomChange={setZoom}
            onCropComplete={(_, areaPixels) => (areaRef.current = areaPixels)}
          />
        </div>

        <div className="p-3.5">
          <div className="flex items-center gap-2.5">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="text-muted"><circle cx="10" cy="10" r="6" /><line x1="14.5" y1="14.5" x2="20" y2="20" /></svg>
            <input
              type="range" min={1} max={3} step={0.05} value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
              className="flex-1"
            />
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="text-muted"><circle cx="11" cy="11" r="8" /><line x1="16.5" y1="16.5" x2="21" y2="21" /></svg>
          </div>

          <div className="mt-3.5 flex justify-center gap-2">
            {(["1:1", "16:9", "free"] as AspectOption[]).map((opt) => (
              <button
                key={opt}
                onClick={() => setAspect(opt)}
                className={`rounded-md border px-2.5 py-1 text-[10px] ${
                  aspect === opt ? "border-white/15 text-fg" : "border-white/10 text-muted"
                }`}
              >
                {opt === "free" ? "Libre" : opt}
              </button>
            ))}
          </div>

          <div className="mt-4 flex justify-between">
            <button onClick={onCancel} className="rounded-lg border border-white/[.12] px-3.5 py-1.5 text-[11.5px] text-fg">
              Cancelar
            </button>
            <button onClick={handleSave} className="rounded-lg bg-accent px-4 py-1.5 text-[11.5px] font-medium text-black">
              Guardar recorte
            </button>
          </div>
        </div>
      </FloatingCard>
    </div>
  );
}