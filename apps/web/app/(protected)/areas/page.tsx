// apps/web/app/(protected)/areas/page.tsx
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AreaCard, type AreaListItem } from "../../components/AreaCard";

export default function AreasPage() {
  const [areas, setAreas] = useState<AreaListItem[]>([]);
  useEffect(() => {
    fetch("/api/areas")
      .then((r) => r.json())
      .then((d) => setAreas(d.areas));
  }, []);

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="flex items-baseline justify-between">
        <h1 className="text-lg font-medium text-fg">Áreas indexadas</h1>
        <Link href="/index" className="rounded-md bg-accent px-3.5 py-2 text-xs font-medium text-black">
          Indexar nueva
        </Link>
      </div>
      <p className="mt-1 text-xs text-muted">{areas.length} áreas</p>
      <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {areas.map((a) => (
          <AreaCard key={a.id} area={a} />
        ))}
      </div>
    </div>
  );
}