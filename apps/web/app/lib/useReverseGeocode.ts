// apps/web/app/lib/useReverseGeocode.ts
"use client";

import { useEffect, useState } from "react";

const memo = new Map<string, string | null>();

export function useReverseGeocode(lat: number, lng: number): string | null {
  const k = `${lat.toFixed(4)},${lng.toFixed(4)}`;
  const [label, setLabel] = useState<string | null>(() => memo.get(k) ?? null);

  useEffect(() => {
    if (memo.has(k)) {
      setLabel(memo.get(k) ?? null);
      return;
    }
    let alive = true;
    fetch(`/api/geocode?lat=${lat}&lng=${lng}`)
      .then((r) => r.json())
      .then((d) => {
        memo.set(k, d.label ?? null);
        if (alive) setLabel(d.label ?? null);
      })
      .catch(() => alive && setLabel(null));
    return () => {
      alive = false;
    };
  }, [k, lat, lng]);

  return label;
}