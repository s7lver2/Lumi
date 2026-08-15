import { useEffect, useRef } from "react";
import maplibregl, { type StyleSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { lumiUrl } from "../lib/bridge";

/** Miniatura muda de un tema del catálogo: mismo camino que el mapa real
 *  (`work/mapEngine.ts` — estilo reescrito por el daemon, teselas por
 *  `transformRequest`), pero sin controles ni interacción, y pidiendo
 *  explícitamente ESTE tema en vez del que esté activo en el servidor.
 *  Si el proveedor rechaza la petición (tema de Mapbox sin clave guardada)
 *  se queda en blanco — el aviso de qué falta ya lo dice el resto de la
 *  tarjeta. */
export function MapThemePreview({ themeId }: { themeId: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelado = false;
    let mapa: maplibregl.Map | null = null;

    void (async () => {
      try {
        const res = await fetch(lumiUrl(`/v1/map/style?theme=${encodeURIComponent(themeId)}`));
        if (!res.ok || cancelado || !ref.current) return;
        const style = (await res.json()) as StyleSpecification & { sprite?: string };
        if (cancelado || !ref.current) return;
        if (style.sprite?.startsWith("/")) style.sprite = lumiUrl(style.sprite);
        mapa = new maplibregl.Map({
          container: ref.current,
          style: style as StyleSpecification,
          transformRequest: (url) => (url.startsWith("/v1/") ? { url: lumiUrl(url) } : { url }),
          // Un punto fijo cualquiera: lo que importa es el estilo, no el
          // sitio — todas las miniaturas del catálogo miran al mismo lugar
          // para que se puedan comparar entre sí.
          center: [2.15, 41.38],
          zoom: 8.5,
          interactive: false,
          attributionControl: false,
        });
      } catch {
        // Sin conexión al proveedor: la tarjeta se queda sin mapa de fondo,
        // no es un error que reportar aquí.
      }
    })();

    return () => { cancelado = true; mapa?.remove(); };
  }, [themeId]);

  return <div ref={ref} className="absolute inset-0" />;
}
