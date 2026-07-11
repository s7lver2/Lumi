// apps/web/app/components/MapDropTarget.tsx
"use client";
import { useEffect, useState } from "react";

// Drag detection lives on `window`, not on this overlay: an element with
// `pointer-events: none` (which we need so the map stays clickable) can't
// receive drag events at all, so listening on the element itself is a
// chicken-and-egg dead end — it never learns a drag started. Window-level
// listeners always fire, and the rendered overlay is purely visual.
export function MapDropTarget({ onFiles }: { onFiles: (files: File[]) => void }) {
  const [over, setOver] = useState(false);

  useEffect(() => {
    // Only react to drags that actually carry files (ignore text/element drags).
    const hasFiles = (e: DragEvent) =>
      Array.from(e.dataTransfer?.types ?? []).includes("Files");

    const onDragOver = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault(); // required, or the browser blocks the drop
      setOver(true);
    };
    const onDragLeave = (e: DragEvent) => {
      // relatedTarget is null when the cursor leaves the window entirely.
      if (e.relatedTarget === null) setOver(false);
    };
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault(); // stop the browser from navigating to the dropped file
      setOver(false);
      const files = Array.from(e.dataTransfer?.files ?? []).filter((f) =>
        f.type.startsWith("image/")
      );
      if (files.length) onFiles(files);
    };

    window.addEventListener("dragover", onDragOver);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("drop", onDrop);
    };
  }, [onFiles]);

  if (!over) return null;
  return (
    <div className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center bg-accent/10 ring-2 ring-inset ring-accent-fg/40">
      <span className="rounded-card bg-panel/80 px-4 py-2 text-sm text-fg backdrop-blur-md">
        Suelta la imagen para buscar
      </span>
    </div>
  );
}
