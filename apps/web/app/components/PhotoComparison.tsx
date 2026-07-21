// apps/web/app/components/PhotoComparison.tsx
"use client";
import { useState } from "react";
import { ImageLightbox } from "./ImageLightbox";

export function PhotoComparison({
  queryImageUrl,
  candidateImageUrl,
}: {
  queryImageUrl: string;
  candidateImageUrl: string;
}) {
  const [lightbox, setLightbox] = useState<{ src: string; label: string } | null>(null);

  return (
    <>
      <div className="mt-3 flex gap-1.5">
        <div className="min-w-0 flex-1">
          <img
            src={queryImageUrl}
            alt="Tu foto"
            onClick={(e) => {
              e.stopPropagation();
              setLightbox({ src: queryImageUrl, label: "Tu foto" });
            }}
            className="aspect-[4/3] w-full cursor-zoom-in rounded-md border border-border object-cover"
          />
          <div className="mt-1 text-[10px] text-subtle">Tu foto</div>
        </div>
        <div className="min-w-0 flex-1">
          <img
            src={candidateImageUrl}
            alt="Street View"
            onClick={(e) => {
              e.stopPropagation();
              setLightbox({ src: candidateImageUrl, label: "Street View" });
            }}
            className="aspect-[4/3] w-full cursor-zoom-in rounded-md border border-accent-fg/40 object-cover"
          />
          <div className="mt-1 text-[10px] text-accent-fg">Street View</div>
        </div>
      </div>
      {lightbox && (
        <ImageLightbox src={lightbox.src} label={lightbox.label} onClose={() => setLightbox(null)} />
      )}
    </>
  );
}
