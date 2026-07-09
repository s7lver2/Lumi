// apps/web/app/components/ImageDropzone.tsx
"use client";

import { useCallback, useRef, useState } from "react";
import Cropper, { type Area } from "react-easy-crop";
import { FloatingCard } from "./FloatingCard";

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

export function ImageDropzone({ onImage }: { onImage: (file: File) => void }) {
  const [src, setSrc] = useState<string | null>(null);
  const [name, setName] = useState("query.jpg");
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const areaRef = useRef<Area | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const pick = useCallback((file: File) => {
    setName(file.name);
    setSrc(URL.createObjectURL(file));
  }, []);

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) pick(file);
  }

  async function useCropped() {
    if (!src) return;
    const file = areaRef.current ? await cropToFile(src, areaRef.current, name) : null;
    if (file) onImage(file);
  }

  async function useWhole() {
    if (!inputRef.current?.files?.[0]) return;
    onImage(inputRef.current.files[0]);
  }

  if (src) {
    return (
      <FloatingCard className="w-[420px] p-4">
        <div className="relative h-64 w-full overflow-hidden rounded-md bg-black">
          <Cropper
            image={src}
            crop={crop}
            zoom={zoom}
            aspect={1}
            onCropChange={setCrop}
            onZoomChange={setZoom}
            onCropComplete={(_, areaPixels) => (areaRef.current = areaPixels)}
          />
        </div>
        <div className="mt-3 flex gap-2">
          <button onClick={useCropped} className="flex-1 rounded-md bg-accent py-2 text-xs font-medium text-black">
            Buscar recorte
          </button>
          <button onClick={useWhole} className="flex-1 rounded-md bg-elevated py-2 text-xs text-fg hover:bg-white/10">
            Usar imagen completa
          </button>
        </div>
      </FloatingCard>
    );
  }

  return (
    <FloatingCard className="w-[420px]">
      <label
        onDragOver={(e) => e.preventDefault()}
        onDrop={onDrop}
        className="flex h-56 cursor-pointer flex-col items-center justify-center gap-2 rounded-card border border-dashed border-white/15 text-center"
      >
        <span className="text-sm text-fg">Arrastra una imagen o pulsa para subir</span>
        <span className="text-xs text-muted">JPG, PNG o WEBP</span>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => e.target.files?.[0] && pick(e.target.files[0])}
        />
      </label>
    </FloatingCard>
  );
}