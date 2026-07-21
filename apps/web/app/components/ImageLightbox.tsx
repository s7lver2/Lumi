// apps/web/app/components/ImageLightbox.tsx
"use client";
import { useRef } from "react";
import { useDismissable } from "../../lib/useDismissable";

interface LightboxContent {
  src: string;
  label: string;
}

export function ImageLightbox({
  content,
  onClose,
}: {
  content: LightboxContent | null;
  onClose: () => void;
}) {
  const { rendered, closing } = useDismissable(content !== null, 180);
  // Keeps the last real content visible while the close animation plays —
  // the caller nulls its state immediately on close, before the exit
  // animation finishes.
  const lastContent = useRef<LightboxContent | null>(null);
  if (content) lastContent.current = content;

  if (!rendered || !lastContent.current) return null;
  const shown = content ?? lastContent.current;

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-8"
      style={{ animation: `${closing ? "jg-backdrop-out" : "jg-backdrop-in"} 180ms ease-out both` }}
      onClick={onClose}
    >
      <div
        className="flex max-h-full max-w-full flex-col items-center gap-2"
        style={{ animation: `${closing ? "jg-lightbox-out" : "jg-lightbox-in"} 200ms cubic-bezier(.2,.85,.35,1) both` }}
        onClick={(e) => e.stopPropagation()}
      >
        <img src={shown.src} alt={shown.label} className="max-h-[80vh] max-w-[85vw] rounded-lg object-contain" />
        <div className="text-xs text-subtle">{shown.label}</div>
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
