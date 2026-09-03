"use client";

import { useEffect, useState } from "react";

const PALABRAS = ["where", "when", "how"];

/** La palabra final del titular del hero va cambiando — "it tells you
 *  where" pasa a "when", "how" — en vez de quedarse fija. Se detiene en la
 *  primera palabra bajo prefers-reduced-motion. */
export function PalabraRotativa() {
  const [i, setI] = useState(0);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = setInterval(() => setI((v) => (v + 1) % PALABRAS.length), 2200);
    return () => clearInterval(id);
  }, []);

  return (
    <span className="relative inline-grid align-baseline">
      {PALABRAS.map((palabra, idx) => (
        <span
          key={palabra}
          className="col-start-1 row-start-1 transition-all duration-500 ease-out"
          style={{
            opacity: idx === i ? 1 : 0,
            transform: idx === i ? "translateY(0)" : "translateY(-10px)",
            transitionTimingFunction: "cubic-bezier(.16,1,.3,1)",
          }}
          aria-hidden={idx !== i}
        >
          {palabra}
        </span>
      ))}
    </span>
  );
}
