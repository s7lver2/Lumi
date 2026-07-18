"use client";
import { useEffect, useState } from "react";
import { InfoTooltip } from "../InfoTooltip";

interface ExifSummary {
  camera: string | null;
  aperture: string | null;
  shutterSpeed: string | null;
  iso: string | null;
  capturedAt: string | null;
  hasGps: boolean;
}

const WARN_ICON = (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#ef9f27" strokeWidth="1.8" strokeLinejoin="round">
    <path d="M12 3.5l9.3 16.5H2.7z" /><line x1="12" y1="10" x2="12" y2="14" /><circle cx="12" cy="17" r=".6" fill="#ef9f27" stroke="none" />
  </svg>
);

export function ExifMetadataWidget({ imageId, estimatedTime }: { imageId: string; estimatedTime: string | null }) {
  const [exif, setExif] = useState<ExifSummary | null>(null);

  useEffect(() => {
    fetch(`/api/library/${imageId}/exif`)
      .then((r) => r.json())
      .then((data) => setExif(data.exif));
  }, [imageId]);

  if (!exif) return <div className="text-[9.5px] text-muted">Cargando metadatos…</div>;

  const exifTimeMismatchesEstimate = Boolean(exif.capturedAt && estimatedTime && exif.capturedAt !== estimatedTime);

  return (
    <div className="grid grid-cols-2 gap-2">
      {exif.camera && (
        <div className="flex items-center gap-1.5" style={{ animation: "jg-fade-rise .4s ease .02s both" }}>
          <span className="text-[9.5px] text-fg">{exif.camera}</span>
        </div>
      )}
      {exif.aperture && (
        <div className="flex items-center gap-1.5" style={{ animation: "jg-fade-rise .4s ease .08s both" }}>
          <span className="text-[9.5px] text-fg">{exif.aperture}</span>
        </div>
      )}
      {exif.shutterSpeed && (
        <div className="flex items-center gap-1.5" style={{ animation: "jg-fade-rise .4s ease .14s both" }}>
          <span className="text-[9.5px] text-fg">{exif.shutterSpeed}</span>
        </div>
      )}
      {exif.iso && (
        <div className="flex items-center gap-1.5" style={{ animation: "jg-fade-rise .4s ease .2s both" }}>
          <span className="text-[9.5px] text-fg">{exif.iso}</span>
        </div>
      )}
      {exif.capturedAt && (
        <div className="flex items-center gap-1.5" style={{ animation: "jg-fade-rise .4s ease .26s both" }}>
          <span className="text-[9.5px] text-fg">{exif.capturedAt}</span>
          {exifTimeMismatchesEstimate && (
            <span className="group relative inline-flex cursor-help">
              {WARN_ICON}
              <span className="pointer-events-none absolute bottom-[135%] left-1/2 z-10 w-max max-w-[190px] -translate-x-1/2 rounded-lg border border-[#ef9f27]/35 bg-panel px-2 py-1.5 text-[9px] leading-[1.4] text-fg opacity-0 shadow-lg shadow-black/45 transition-opacity group-hover:opacity-100">
                El EXIF se puede editar fácilmente y no coincide con la hora estimada por sombras ({estimatedTime})
              </span>
            </span>
          )}
        </div>
      )}
      <div className="col-span-2 flex items-center gap-1.5" style={{ animation: "jg-fade-rise .4s ease .32s both" }}>
        <span className="text-[9.5px] text-muted">{exif.hasGps ? "Datos GPS presentes" : "Sin datos GPS en el archivo"}</span>
      </div>
    </div>
  );
}