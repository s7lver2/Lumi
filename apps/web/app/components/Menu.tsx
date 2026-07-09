// apps/web/app/components/Menu.tsx
"use client";
import { useEffect, useRef, useState } from "react";

export interface MenuOption { value: string; label: string; hint?: string }

export function Menu({
  label, options, value, onChange,
}: { label?: string; options: MenuOption[]; value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);
  const current = options.find((o) => o.value === value);
  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 rounded-md border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs text-fg hover:bg-white/10">
        {current?.label ?? label} <span className="text-subtle">▾</span>
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-1 min-w-44 overflow-hidden rounded-card border border-white/10 bg-panel/80 backdrop-blur-md shadow-lg shadow-black/40">
          {options.map((o) => (
            <button key={o.value} onClick={() => { onChange(o.value); setOpen(false); }}
              className={`block w-full px-3 py-2 text-left text-xs hover:bg-white/10 ${o.value === value ? "text-accent-fg" : "text-fg"}`}>
              {o.label}{o.hint && <span className="ml-2 text-subtle">{o.hint}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}