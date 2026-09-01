import { useEffect, useRef, useState } from "react";
import maplibregl, { type StyleSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { lumiUrl } from "../lib/bridge";
import { Icon } from "../ui/Icon";

/** Miniatura muda de un tema del catálogo: mismo camino que el mapa real
 *  (`work/mapEngine.ts` — estilo reescrito por el daemon, teselas por
 *  `transformRequest`), pero sin controles ni interacción, y pidiendo
 *  explícitamente ESTE tema en vez del que esté activo en el servidor.
 *  Si el proveedor rechaza la petición (tema de Mapbox sin clave guardada)
 *  se muestra un icono de fallo en vez de quedarse en blanco para
 *  siempre (#76) — el aviso de qué falta ya lo dice el resto de la
 *  tarjeta, esto es solo la señal visual de que ESTA miniatura en
 *  concreto no cargó. */
export function MapThemePreview({ themeId }: { themeId: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [fallo, setFallo] = useState(false);

  useEffect(() => {
    let cancelado = false;
    let mapa: maplibregl.Map | null = null;
    setFallo(false);

    void (async () => {
      try {
        const res = await fetch(lumiUrl(`/v1/map/style?theme=${encodeURIComponent(themeId)}`));
        if (cancelado) return;
        if (!res.ok) { setFallo(true); return; }
        if (!ref.current) return;
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
          // El catálogo es cerrado y el daemon ya comprobó la forma del
          // estilo al reescribirlo — el validador de MapLibre es más
          // estricto que el propio Mapbox con campos de sus estilos
          // oficiales (mismo motivo que `work/mapEngine.ts`).
          validateStyle: false,
        });
        // `on("error")` es la única forma de ver un fallo de tesela/glyph: esos
        // pasan DENTRO del bucle de eventos de MapLibre, no como una excepción
        // que este `try` pudiera atrapar.
        mapa.on("error", (e) => { console.error(`[preview ${themeId}]`, e.error); setFallo(true); });
      } catch (e) {
        console.error(`[preview ${themeId}] no se pudo montar`, e);
        if (!cancelado) setFallo(true);
      }
    })();

    return () => { cancelado = true; mapa?.remove(); };
  }, [themeId]);

  if (fallo) {
    return (
      <div style={{ position: "absolute", inset: 0 }}
        className="grid place-items-center bg-elevated text-subtle">
        <Icon name="alert" size={18} />
      </div>
    );
  }

  // Estilo en línea, no clase: `maplibre-gl.css` fuerza `.maplibregl-map {
  // position: relative }` sobre este mismo elemento (MapLibre le añade esa
  // clase), y con la misma especificidad que `.absolute` de Tailwind, la
  // hoja que cargue después gana la cascada. Perder el `position: absolute`
  // aquí deja `inset-0` sin efecto — el div (y el canvas de dentro) se sale
  // del flujo normal y crece con un alto sin relación con la tarjeta.
  return <div ref={ref} style={{ position: "absolute", inset: 0 }} />;
}
