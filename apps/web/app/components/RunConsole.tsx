// apps/web/app/components/RunConsole.tsx
"use client";
import { useEffect, useRef } from "react";

export function RunConsole({ lines }: { lines: string[] }) {
  const ref = useRef<HTMLPreElement>(null);
  useEffect(() => { if (ref.current) ref.current.scrollTop = ref.current.scrollHeight; }, [lines]);
  if (lines.length === 0) return null;
  return (
    <pre ref={ref}
      className="mt-3 max-h-56 overflow-y-auto rounded-md border border-white/10 bg-black/40 p-3 font-mono text-[11px] leading-relaxed text-muted backdrop-blur-md">
      {lines.join("")}
    </pre>
  );
}