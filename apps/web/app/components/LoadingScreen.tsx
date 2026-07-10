// apps/web/app/components/LoadingScreen.tsx
"use client";
import { useEffect, useState } from "react";
import { PlanetBackground } from "./PlanetBackground";

export function BootGate({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    fetch("/api/map-config").catch(() => {}).finally(() => setReady(true));
  }, []);
  if (!ready) {
    return (
      <div className="fixed inset-0 flex flex-col items-center justify-center overflow-hidden">
        <PlanetBackground satellite />
        <div className="relative text-center" style={{ marginBottom: 120 }}>
          <div className="text-5xl font-medium tracking-[6px] text-fg">Lumi</div>
          <p className="mt-2 text-sm text-muted">Preparando tu espacio de trabajo…</p>
          <div className="relative mx-auto mt-5 h-[3px] w-56 overflow-hidden rounded-full bg-white/10">
            <div className="lumi-anim absolute left-0 top-0 h-full w-2/5 rounded-full"
              style={{ background: "linear-gradient(90deg,transparent,#f4f6f9,transparent)", animation: "lumi-shimmer 1.6s ease-in-out infinite" }} />
          </div>
        </div>
      </div>
    );
  }
  return <>{children}</>;
}