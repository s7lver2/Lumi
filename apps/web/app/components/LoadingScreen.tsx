// apps/web/app/components/LoadingScreen.tsx
"use client";
import { useEffect, useState } from "react";

export function BootGate({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    // Warm the map config so the first map mount is instant; resolve either way.
    fetch("/api/map-config").catch(() => {}).finally(() => setReady(true));
  }, []);
  if (!ready) {
    return (
      <div className="fixed inset-0 flex flex-col items-center justify-center gap-4 bg-bg">
        <div className="text-2xl font-medium tracking-wide text-fg">Lumi</div>
        <div className="h-1 w-40 overflow-hidden rounded-full bg-white/10">
          <div className="h-full w-1/3 animate-pulse bg-accent" />
        </div>
      </div>
    );
  }
  return <>{children}</>;
}