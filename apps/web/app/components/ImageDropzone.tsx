// apps/web/app/components/ImageDropzone.tsx
"use client";

import { useCallback, useRef, useState } from "react";
import Cropper, { type Area } from "react-easy-crop";
import { FloatingCard } from "./FloatingCard";

// Helper para procesar el recorte usando HTML5 Canvas de forma exacta
async function cropToFile(src: string, area: Area, name: string): Promise<File> {
  const img = document.createElement("img");
  img.src = src;
  await new Promise((res) => (img.onload = res));
  
  const canvas = document.createElement("canvas");
  // Renderizamos con el tamaño exacto de los píxeles recortados
  canvas.width = area.width;
  canvas.height = area.height;
  
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(
    img,
    area.x,
    area.y,
    area.width,
    area.height,
    0,
    0,
    area.width,
    area.height
  );
  
  const blob: Blob = await new Promise((res) => 
    canvas.toBlob((b) => res(b!), "image/jpeg", 0.92)
  );
  return new File([blob], name, { type: "image/jpeg" });
}

export function ImageDropzone({ onImage }: { onImage: (file: File) => void }) {
  const [src, setSrc] = useState<string | null>(null);
  const [rawFile, setRawFile] = useState<File | null>(null); // 🛠️ Solución: Almacena el File original
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const areaRef = useRef<Area | null>(null);

  const pick = useCallback((file: File) => {
    setRawFile(file);
    setSrc(URL.createObjectURL(file));
  }, []);

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) pick(file);
  }

  async function useCropped() {
    if (!src || !rawFile) return;
    const file = areaRef.current ? await cropToFile(src, areaRef.current, rawFile.name) : null;
    if (file) onImage(file);
  }

  async function useWhole() {
    if (!rawFile) return;
    onImage(rawFile); // 🛠️ Ahora funciona siempre, venga de drag&drop o de clic
  }

  // Vista de recorte activa
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
          <button 
            onClick={useCropped} 
            className="flex-1 rounded-md bg-accent py-2 text-xs font-medium text-black transition-all hover:brightness-110"
          >
            Buscar recorte
          </button>
          <button 
            onClick={useWhole} 
            className="flex-1 rounded-md bg-elevated py-2 text-xs text-fg hover:bg-white/10 transition-all"
          >
            Usar imagen completa
          </button>
        </div>
      </FloatingCard>
    );
  }

  // Vista inicial de captura / Dropzone
  return (
    <FloatingCard className="w-[420px]">
      <label
        onDragOver={(e) => e.preventDefault()}
        onDrop={onDrop}
        className="flex h-56 cursor-pointer flex-col items-center justify-center gap-2 rounded-card border border-dashed border-white/15 text-center transition-all hover:border-white/35"
      >
        <span className="text-sm text-fg">Arrastra una imagen o pulsa para subir</span>
        <span className="text-xs text-muted">JPG, PNG o WEBP</span>
        <input
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => e.target.files?.[0] && pick(e.target.files[0])}
        />
      </label>
    </FloatingCard>
  );
}