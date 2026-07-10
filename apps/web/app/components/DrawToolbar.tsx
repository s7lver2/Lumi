// apps/web/app/components/DrawToolbar.tsx
"use client";
export function DrawToolbar({
  mode, onModeChange, onUndo, onRedo, onClear,
}: {
  mode: string;
  onModeChange: (m: "polygon" | "rectangle" | "circle") => void;
  onUndo: () => void; onRedo: () => void; onClear: () => void;
}) {
  const btn = (active: boolean) =>
    `rounded-md px-2.5 py-1.5 text-xs ${active ? "bg-accent text-black" : "text-fg hover:bg-white/10"}`;
  return (
    <div className="inline-flex gap-1 rounded-card border border-white/10 bg-panel/80 p-1 backdrop-blur-md shadow-lg shadow-black/40">
      <button className={btn(mode === "polygon")} onClick={() => onModeChange("polygon")}>Polígono</button>
      <button className={btn(mode === "rectangle")} onClick={() => onModeChange("rectangle")}>Rectángulo</button>
      <button className={btn(mode === "circle")} onClick={() => onModeChange("circle")}>Círculo</button>
      <span className="mx-1 w-px bg-white/10" />
      <button className={btn(false)} onClick={onUndo} aria-label="Deshacer">↶</button>
      <button className={btn(false)} onClick={onRedo} aria-label="Rehacer">↷</button>
      <button className={btn(false)} onClick={onClear}>Borrar</button>
    </div>
  );
}