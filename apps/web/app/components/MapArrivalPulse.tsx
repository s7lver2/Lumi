// apps/web/app/components/MapArrivalPulse.tsx
"use client";
import { useEffect, useState } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";

interface LatLng {
  lat: number;
  lng: number;
}

/**
 * A brief radiating-ring pulse at a specific map point — shown once when a
 * candidate is confirmed, so the "arrival" reads as a deliberate reveal
 * instead of the circle/marker just silently shrinking (see
 * ConfidenceCircleLayer.tsx's REFINED_RADIUS_KM collapse, which happens at
 * the same moment). Positioned via map.project(), so it must re-project on
 * every map move/zoom while visible — cheap, since it only runs for ~1.6s.
 */
export function MapArrivalPulse({ map, point }: { map: any; point: LatLng | null }) {
  const [screenPos, setScreenPos] = useState<{ x: number; y: number } | null>(null);
  const [visible, setVisible] = useState(false);
  const reduce = useReducedMotion();

  useEffect(() => {
    if (!map || !point) {
      setVisible(false);
      return;
    }
    setVisible(true);
    const update = () => {
      const p = map.project([point.lng, point.lat]);
      setScreenPos({ x: p.x, y: p.y });
    };
    update();
    map.on("move", update);
    const timeout = setTimeout(() => setVisible(false), 1600);
    return () => {
      map.off("move", update);
      clearTimeout(timeout);
    };
  }, [map, point]);

  if (reduce || !visible || !screenPos) return null;

  return (
    <div
      className="pointer-events-none absolute z-30"
      style={{ left: screenPos.x, top: screenPos.y, transform: "translate(-50%, -50%)" }}
    >
      <AnimatePresence>
        <motion.div
          initial={{ scale: 0.3, opacity: 0.8 }}
          animate={{ scale: 3.2, opacity: 0 }}
          transition={{ duration: 1.4, ease: "easeOut" }}
          className="h-6 w-6 rounded-full border-2 border-accent-fg"
        />
      </AnimatePresence>
    </div>
  );
}