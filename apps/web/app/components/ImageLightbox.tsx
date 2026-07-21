// apps/web/app/components/ImageLightbox.tsx
"use client";

export function ImageLightbox({
  src,
  label,
  onClose,
}: {
  src: string;
  label: string;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-8"
      style={{ animation: "jg-backdrop-in 150ms ease-out both" }}
      onClick={onClose}
    >
      <div
        className="flex max-h-full max-w-full flex-col items-center gap-2"
        style={{ animation: "jg-lightbox-in 180ms cubic-bezier(.2,.85,.35,1) both" }}
        onClick={(e) => e.stopPropagation()}
      >
        <img src={src} alt={label} className="max-h-[80vh] max-w-[85vw] rounded-lg object-contain" />
        <div className="text-xs text-subtle">{label}</div>
      </div>
      <button
        onClick={onClose}
        className="absolute right-5 top-5 flex h-8 w-8 items-center justify-center rounded-md border border-white/15 bg-panel/80 text-subtle hover:text-fg"
        aria-label="Cerrar"
      >
        ✕
      </button>
    </div>
  );
}
