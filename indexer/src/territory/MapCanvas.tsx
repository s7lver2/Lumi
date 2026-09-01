import { lineString } from "@turf/helpers";
import { nearestPointOnLine } from "@turf/nearest-point-on-line";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { useEffect, useRef, useState } from "react";

import { api, type Clasificacion, type LugarReciente, type Punto, type SondeoTesela } from "../lib/api";
import { color } from "../lib/origenes";
import { teselaAPoligono, type Poligono } from "../lib/quadkey";
import { Icon } from "../ui/Icon";

/** Ease-out cúbico, la misma curva que MapCanvas del subsistema 6, para que
 *  los vuelos se sientan igual en las dos aplicaciones. Nunca `essential`:
 *  eso pisa el «reducir movimiento» del sistema operativo. */
const EASE_OUT_CUBIC = (t: number) => 1 - Math.pow(1 - t, 3);

const RADIO_TIERRA_M = 6_371_000;

/** Las propiedades de un rasgo del mapa. Los tipos de `mapbox-gl` no exponen
 *  `properties` en `GeoJSONFeature`, y leerlas es justo lo que hace falta para
 *  saber en qué estado está la tesela que se acaba de pulsar. */
function propsDe(f: unknown): Record<string, string> {
  return ((f as { properties?: Record<string, string> } | undefined)?.properties ?? {});
}

function poligonoGeoJSON(puntos: Punto[]): Poligono {
  const anillo = puntos.map((p) => [p.lng, p.lat]);
  if (anillo.length > 0) anillo.push(anillo[0]);
  return {
    type: "Feature",
    properties: {},
    geometry: { type: "Polygon", coordinates: [anillo] },
  };
}

/** Pinta el trazo en curso sobre la fuente "dibujo". Función de módulo (no un
 *  closure dentro de `load`) para poder llamarla también desde el efecto que
 *  sincroniza la herramienta "editar" con el prop `dibujo`, fuera de ese
 *  closure. */
function pintarDibujoEn(m: mapboxgl.Map, pts: Punto[]) {
  (m.getSource("dibujo") as mapboxgl.GeoJSONSource | undefined)?.setData({
    type: "FeatureCollection",
    features: pts.length >= 3 ? [poligonoGeoJSON(pts)] : [],
  });
}

function verticesGeoJSON(anillo: Punto[]) {
  return {
    type: "FeatureCollection" as const,
    features: anillo.map((p, i) => ({
      type: "Feature" as const,
      properties: { i },
      geometry: { type: "Point" as const, coordinates: [p.lng, p.lat] },
    })),
  };
}

/** Un resultado del buscador de lugares, con lo necesario para el panel de
 *  información (tipo, jerarquía geográfica) además de para volar hasta él. */
interface LugarBuscado {
  nombre: string;
  lng: number;
  lat: number;
  tipo: string[];
  contexto: { id: string; text: string }[];
}

const NOMBRE_TIPO: Record<string, string> = {
  country: "país", region: "región/provincia", postcode: "código postal",
  district: "distrito", place: "ciudad/pueblo", locality: "localidad",
  neighborhood: "barrio", address: "dirección", poi: "punto de interés",
};

/** Divide el `place_name` de Mapbox en el nombre principal y el contexto que
 *  desambigua (país/región) — hoy se pintan en dos líneas separadas en vez de
 *  truncar el contexto en una sola. */
function partirNombre(nombre: string): { principal: string; contexto: string } {
  const i = nombre.indexOf(",");
  return i === -1
    ? { principal: nombre, contexto: "" }
    : { principal: nombre.slice(0, i), contexto: nombre.slice(i + 1).trim() };
}

/** Haversine, metros. Solo hace falta para el radio en vivo del círculo: no
 *  merece traer una dependencia por una fórmula de cuatro líneas. */
function metrosEntre(a: Punto, b: Punto): number {
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * RADIO_TIERRA_M * Math.asin(Math.sqrt(s));
}

/** Un polígono de `lados` vértices aproximando el círculo de `radioM` metros
 *  centrado en `centro`. 48 lados es indistinguible de un círculo a la escala
 *  en que se dibuja territorio (varios km²) y barato de reclasificar. */
function circuloAPuntos(centro: Punto, radioM: number, lados = 48): Punto[] {
  const lat0 = (centro.lat * Math.PI) / 180;
  const pts: Punto[] = [];
  for (let i = 0; i < lados; i++) {
    const ang = (2 * Math.PI * i) / lados;
    const dLat = (radioM * Math.cos(ang)) / RADIO_TIERRA_M;
    const dLng = (radioM * Math.sin(ang)) / (RADIO_TIERRA_M * Math.cos(lat0));
    pts.push({ lat: centro.lat + (dLat * 180) / Math.PI, lng: centro.lng + (dLng * 180) / Math.PI });
  }
  return pts;
}

/** Las cuatro esquinas del rectángulo alineado a lat/lng entre dos puntos
 *  opuestos. No es el rectángulo "en pantalla" (eso giraría con el mapa); es
 *  el rectángulo en el terreno, que es lo que el 7a clasifica. */
function rectanguloAPuntos(a: Punto, b: Punto): Punto[] {
  return [
    { lat: a.lat, lng: a.lng },
    { lat: a.lat, lng: b.lng },
    { lat: b.lat, lng: b.lng },
    { lat: b.lat, lng: a.lng },
  ];
}

type Herramienta = "mano" | "poligono" | "rectangulo" | "circulo" | "editar";

const HERRAMIENTAS: { id: Herramienta; icon: "mano" | "poligono" | "rectangulo" | "circulo" | "editar"; titulo: string }[] = [
  { id: "mano", icon: "mano", titulo: "Mover el mapa — arrastra para desplazarte, sin dibujar nada" },
  { id: "poligono", icon: "poligono", titulo: "Polígono a mano — clic por esquina, doble clic para cerrar" },
  { id: "rectangulo", icon: "rectangulo", titulo: "Rectángulo — arrastra de una esquina a la opuesta" },
  { id: "circulo", icon: "circulo", titulo: "Círculo — arrastra del centro hacia fuera" },
  { id: "editar", icon: "editar", titulo: "Editar — arrastra un vértice, doble clic en un lado para añadir uno, clic derecho para borrarlo" },
];

export function MapCanvas({
  dibujo,
  clasificacion,
  onPoligonoListo,
  onVerticeEditado,
  combineMode,
  onCombineModeChange,
  activos,
  sondeos,
  tokenMapillary,
  onLugarBuscadoChange,
}: {
  dibujo: Punto[][];
  clasificacion: Clasificacion | null;
  onPoligonoListo: (p: Punto[]) => void;
  onVerticeEditado?: (anillo: Punto[]) => void;
  combineMode: "sustituir" | "sumar" | "restar";
  onCombineModeChange: (m: "sustituir" | "sumar" | "restar") => void;
  activos?: Set<string>;
  sondeos?: SondeoTesela[];
  tokenMapillary?: string | null;
  /** Avisa al padre de si hay un lugar buscado seleccionado ahora mismo —
   *  su panel de info y el de disponibilidad de `TerritoryView` comparten
   *  posición y no pueden estar los dos a la vez (#61). */
  onLugarBuscadoChange?: (hay: boolean) => void;
}) {
  const contenedor = useRef<HTMLDivElement>(null);
  const mapa = useRef<mapboxgl.Map | null>(null);
  const puntos = useRef<Punto[]>([]);
  // "mano" por defecto: mover el mapa para mirar alrededor no debería
  // dibujar nada. Antes el polígono era la herramienta por defecto y un clic
  // cualquiera —para fijarse en un sitio— añadía una esquina sin querer.
  const [herramienta, setHerramienta] = useState<Herramienta>("mano");
  const herramientaRef = useRef<Herramienta>("mano");
  // El mapa se monta una sola vez (efecto con `[]`); sin refs, sus manejadores
  // de evento se quedarían con la `herramienta` y el `onPoligonoListo` del
  // primer render para siempre — el mismo bug de cierre que dejaba los puntos
  // de Mapillary sin pintar (ver más abajo).
  const onPoligonoListoRef = useRef(onPoligonoListo);
  const onVerticeEditadoRef = useRef(onVerticeEditado);
  useEffect(() => { onVerticeEditadoRef.current = onVerticeEditado; }, [onVerticeEditado]);
  // El anillo que se está editando ahora mismo — se resincroniza cada vez
  // que cambian la herramienta activa o el trazo confirmado, y el arrastre
  // lee/escribe aquí en vez de en el estado de React para no re-renderizar
  // en cada `mousemove`.
  const anilloEditando = useRef<Punto[]>([]);
  const arrastrandoVertice = useRef<number | null>(null);
  // `null` mientras se pregunta, `false` cuando se sabe que no hay clave. Sin
  // este estado el mapa se quedaba en un `<div>` vacío para siempre y nadie
  // decía por qué: exactamente el fallo silencioso que PRODUCT.md prohíbe.
  const [hayClave, setHayClave] = useState<boolean | null>(null);
  // La misma clave del mapa sirve para el geocodificador de la búsqueda: es
  // el mismo producto de Mapbox, no una cuenta aparte.
  const claveMapaRef = useRef<string | null>(null);
  const [busqueda, setBusqueda] = useState("");
  const [sugerencias, setSugerencias] = useState<LugarBuscado[]>([]);
  const [lugarSeleccionado, setLugarSeleccionado] = useState<LugarBuscado | null>(null);
  const [buscando, setBuscando] = useState(false);
  const sondeoBusqueda = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [recientes, setRecientes] = useState<LugarReciente[]>([]);
  const [foco, setFoco] = useState(false);
  // El popup de solo lectura que sigue al ratón sobre una tesela reclamada —
  // aparte del popup de clic (con botón "Reportar"), que se queda fijo.
  const popupHover = useRef<mapboxgl.Popup | null>(null);

  useEffect(() => { void api.territorioRecientesLeer().then(setRecientes); }, []);

  useEffect(() => { herramientaRef.current = herramienta; }, [herramienta]);
  useEffect(() => { onPoligonoListoRef.current = onPoligonoListo; }, [onPoligonoListo]);

  useEffect(() => { onLugarBuscadoChange?.(lugarSeleccionado !== null); }, [lugarSeleccionado, onLugarBuscadoChange]);

  // Dibujar/seleccionar una forma de territorio limpia el lugar buscado: el
  // panel de disponibilidad que aparece con la forma y el panel de info de
  // búsqueda comparten sitio, así que no tiene sentido dejar los dos abiertos.
  useEffect(() => {
    if (dibujo.length > 0) setLugarSeleccionado(null);
  }, [dibujo]);

  useEffect(() => {
    let vivo = true;
    void api.mapboxClave().then((clave) => {
      if (!vivo) return;
      setHayClave(!!clave);
      claveMapaRef.current = clave;
      if (!clave || !contenedor.current) return;
      mapboxgl.accessToken = clave;
      const m = new mapboxgl.Map({
        container: contenedor.current,
        style: "mapbox://styles/mapbox/dark-v11",
        center: [-8.4115, 43.3623],
        zoom: 12,
      });
      m.on("load", () => {
        m.addSource("dibujo", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        m.addLayer({ id: "dibujo-relleno", type: "fill", source: "dibujo",
          paint: { "fill-color": "rgba(55,138,221,.07)" } });
        m.addLayer({ id: "dibujo-borde", type: "line", source: "dibujo",
          paint: { "line-color": "#85b7eb", "line-width": 1.6 } });

        m.addSource("teselas", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        m.addLayer({
          id: "teselas-relleno", type: "fill", source: "teselas",
          paint: {
            "fill-color": [
              "match", ["get", "estado"],
              "local", "rgba(232,232,230,.13)",
              "catalogo", "rgba(55,138,221,.15)",
              // Reclamada por otro: ámbar tenue. No es una advertencia, es un
              // "esto ya lo cubre alguien" — por eso el borde marca más que el
              // relleno.
              "reclamada", "rgba(239,159,39,.13)",
              "rgba(255,255,255,.015)", // nuevo
            ],
          },
        });
        m.addLayer({
          id: "teselas-borde", type: "line", source: "teselas",
          paint: {
            "line-color": [
              "match", ["get", "estado"],
              "reclamada", "rgba(239,159,39,.45)",
              "rgba(255,255,255,.2)",
            ],
            // El punteado es SOLO para lo nuevo: una tesela sin indexar es
            // una ausencia, no una advertencia. El ámbar queda para el
            // bloqueo, no para esto.
            "line-dasharray": ["match", ["get", "estado"], "nuevo", ["literal", [2, 2]], ["literal", [1, 0]]],
          },
        });

        // El sombreado de los que solo se pueden sondear por muestreo. Una
        // sola fuente para todos: el color sale de la propiedad `fuente` de
        // cada rasgo, así que encender un origen más no añade una capa más.
        m.addSource("sondeos", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        m.addLayer({
          id: "sondeos-relleno",
          type: "fill",
          source: "sondeos",
          paint: {
            "fill-color": ["get", "color"],
            "fill-opacity": ["match", ["get", "nivel"], "mucho", 0.30, "poco", 0.13, 0],
          },
        }, "teselas-borde");

        // Los vértices del trazo actual, editables con la herramienta
        // "editar". Fuente aparte de "dibujo": esta pinta puntos arrastrables,
        // no la línea/relleno del trazo.
        m.addSource("vertices", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        m.addLayer({
          id: "vertices-puntos", type: "circle", source: "vertices",
          paint: {
            "circle-radius": 4.5,
            "circle-color": "#85b7eb",
            "circle-stroke-width": 1.4,
            "circle-stroke-color": "#0c0e12",
          },
        });

        // El cursor cambia sobre una tesela reclamada, con la herramienta
        // "mano": es la única pista de que ahí hay algo que mirar antes de
        // hacer clic.
        m.on("mouseenter", "teselas-relleno", (e) => {
          const props = propsDe(e.features?.[0]);
          if (herramientaRef.current !== "mano" || props.estado !== "reclamada") return;
          m.getCanvas().style.cursor = "pointer";
          const autor = String(props.autor ?? "");
          const paquete = String(props.paquete ?? "");
          popupHover.current = new mapboxgl.Popup({
            closeButton: false, closeOnClick: false, className: "lumi-popup-hover",
          })
            .setLngLat(e.lngLat)
            .setHTML(`<div class="font-mono text-[10px] leading-relaxed"><b>${autor}</b><br/>${paquete}</div>`)
            .addTo(m);
        });
        m.on("mousemove", "teselas-relleno", (e) => {
          if (herramientaRef.current !== "mano") return;
          popupHover.current?.setLngLat(e.lngLat);
        });
        m.on("mouseleave", "teselas-relleno", () => {
          m.getCanvas().style.cursor = "";
          popupHover.current?.remove();
          popupHover.current = null;
        });

        // Al pulsar una tesela reclamada: quién la cubre y sus fuentes. NINGÚN
        // botón de instalar — lo reclamado viaja como dependencia de tu ficha,
        // no dentro de tu índice.
        //
        // ponytail: «Reportar» copia el reporte al portapapeles en vez de
        // mandarlo. Qué cuenta como baja calidad lo decide el subsistema 9, y
        // ese endpoint todavía no existe; la salida es cambiar este
        // `clipboard.writeText` por un POST cuando exista.
        m.on("click", "teselas-relleno", (e) => {
          if (herramientaRef.current !== "mano") return;
          const props = propsDe(e.features?.[0]);
          if (props.estado !== "reclamada") return;
          const paquete = String(props.paquete ?? "");
          const autor = String(props.autor ?? "");
          const nodo = document.createElement("div");
          nodo.className = "font-mono text-[10.5px] leading-relaxed";
          nodo.innerHTML =
            `<b>${autor}</b><br/>${paquete}<br/>` +
            `<span style="opacity:.7">viajará como dependencia de tu índice, no en él</span><br/>` +
            `<button data-reportar style="text-decoration:underline">Reportar</button>`;
          nodo.querySelector("[data-reportar]")?.addEventListener("click", () => {
            void navigator.clipboard.writeText(`desreclamo: ${paquete} (${autor}) — motivo: `);
          });
          new mapboxgl.Popup({ closeButton: true }).setLngLat(e.lngLat).setDOMContent(nodo).addTo(m);
        });

        // --- Polígono a mano: clic añade esquina, doble clic cierra. -------
        m.on("click", (e) => {
          if (herramientaRef.current !== "poligono") return;
          // Cerrar acercándose al primer vértice, además del doble clic que
          // ya funciona: 12px de radio en pantalla, no en metros, porque el
          // gesto tiene que sentirse igual de fácil a cualquier zoom.
          if (puntos.current.length >= 3) {
            const inicio = m.project([puntos.current[0].lng, puntos.current[0].lat]);
            const aqui = m.project(e.lngLat);
            if (Math.hypot(inicio.x - aqui.x, inicio.y - aqui.y) < 12) {
              onPoligonoListoRef.current(puntos.current);
              setHerramienta("mano");
              return;
            }
          }
          puntos.current = [...puntos.current, { lat: e.lngLat.lat, lng: e.lngLat.lng }];
          pintarDibujoEn(m, puntos.current);
        });
        m.on("dblclick", (e) => {
          if (herramientaRef.current !== "poligono") return;
          e.preventDefault();
          if (puntos.current.length >= 3) {
            onPoligonoListoRef.current(puntos.current);
            setHerramienta("mano");
          }
        });

        // Backspace quita solo la última esquina en vez de obligar a borrar
        // el trazo entero por un clic de más.
        m.getContainer().tabIndex = 0;
        m.getContainer().addEventListener("keydown", (e) => {
          if (e.key !== "Backspace" || herramientaRef.current !== "poligono") return;
          if (puntos.current.length === 0) return;
          e.preventDefault();
          puntos.current = puntos.current.slice(0, -1);
          pintarDibujoEn(m, puntos.current);
        });

        // --- Editar: arrastrar, insertar y borrar vértices. ----------------
        m.on("mousedown", "vertices-puntos", (e) => {
          if (herramientaRef.current !== "editar") return;
          const i = Number(propsDe(e.features?.[0]).i);
          arrastrandoVertice.current = i;
          m.dragPan.disable();
        });
        m.on("mousemove", (e) => {
          if (arrastrandoVertice.current === null) return;
          const i = arrastrandoVertice.current;
          const anillo = [...anilloEditando.current];
          anillo[i] = { lat: e.lngLat.lat, lng: e.lngLat.lng };
          anilloEditando.current = anillo;
          (m.getSource("vertices") as mapboxgl.GeoJSONSource)?.setData(verticesGeoJSON(anillo));
          pintarDibujoEn(m, anillo);
        });
        m.on("mouseup", () => {
          if (arrastrandoVertice.current === null) return;
          arrastrandoVertice.current = null;
          m.dragPan.enable();
          onVerticeEditadoRef.current?.(anilloEditando.current);
        });

        // Doble clic sobre el borde inserta un vértice ahí — `nearestPointOnLine`
        // da el índice del segmento donde cae, y el punto nuevo se inserta justo
        // después de ese índice.
        m.on("dblclick", "dibujo-borde", (e) => {
          if (herramientaRef.current !== "editar") return;
          e.preventDefault();
          const anillo = anilloEditando.current;
          if (anillo.length < 3) return;
          const cerrado = [...anillo, anillo[0]].map((p): [number, number] => [p.lng, p.lat]);
          const cercano = nearestPointOnLine(lineString(cerrado), [e.lngLat.lng, e.lngLat.lat]);
          const idx = (cercano.properties.index ?? 0) + 1;
          const nuevo = { lat: e.lngLat.lat, lng: e.lngLat.lng };
          onVerticeEditadoRef.current?.([...anillo.slice(0, idx), nuevo, ...anillo.slice(idx)]);
        });

        // Clic derecho sobre un vértice lo borra, si quedan al menos 3.
        m.on("contextmenu", "vertices-puntos", (e) => {
          if (herramientaRef.current !== "editar") return;
          e.preventDefault();
          const i = Number(propsDe(e.features?.[0]).i);
          const anillo = anilloEditando.current;
          if (anillo.length <= 3) return;
          onVerticeEditadoRef.current?.(anillo.filter((_, j) => j !== i));
        });

        // --- Rectángulo y círculo: arrastrar de un punto a otro. -----------
        // Los dos comparten el gesto (down → move → up); solo cambia qué
        // forma sale del par de puntos. Se apaga `dragPan` mientras se
        // arrastra o mover el ratón para definir la forma también movería
        // el mapa debajo. Con "mano" o "polígono" activos este bloque entero
        // no hace nada: son las únicas dos herramientas que NO capturan el
        // arrastre, así que arrastrar con ellas siempre mueve el mapa, nunca
        // dibuja por accidente.
        const esFormaDeArrastre = () =>
          herramientaRef.current === "rectangulo" || herramientaRef.current === "circulo";
        let origen: Punto | null = null;
        m.on("mousedown", (e) => {
          if (!esFormaDeArrastre()) return;
          origen = { lat: e.lngLat.lat, lng: e.lngLat.lng };
          m.dragPan.disable();
        });
        m.on("mousemove", (e) => {
          if (!origen || !esFormaDeArrastre()) return;
          const actual = { lat: e.lngLat.lat, lng: e.lngLat.lng };
          const pts = herramientaRef.current === "rectangulo"
            ? rectanguloAPuntos(origen, actual)
            : circuloAPuntos(origen, metrosEntre(origen, actual));
          pintarDibujoEn(m, pts);
        });
        m.on("mouseup", (e) => {
          if (!origen || !esFormaDeArrastre()) return;
          m.dragPan.enable();
          const actual = { lat: e.lngLat.lat, lng: e.lngLat.lng };
          const pts = herramientaRef.current === "rectangulo"
            ? rectanguloAPuntos(origen, actual)
            : circuloAPuntos(origen, metrosEntre(origen, actual));
          origen = null;
          // Un arrastre de un solo punto (clic sin mover) no es una forma:
          // clasificarlo tiraría de cientos de teselas alrededor del punto
          // sin que el operador haya decidido nada.
          if (metrosEntre(pts[0], pts[Math.floor(pts.length / 2)]) < 5) {
            pintarDibujoEn(m, []);
            return;
          }
          onPoligonoListoRef.current(pts);
          setHerramienta("mano");
        });
      });
      mapa.current = m;
    });
    return () => { vivo = false; mapa.current?.remove(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Añade la capa de puntos de Mapillary en cuanto hay clave, sin importar si
  // llegó antes o después de que el mapa cargase. Antes esto vivía dentro del
  // efecto de montaje (arriba) y leía `tokenMapillary` de un cierre que se
  // creaba una sola vez al montar: si la clave llegaba después de `load`
  // (lo normal, porque `claveLeer` es una llamada async aparte), la capa
  // nunca se añadía y no había manera de que apareciera un punto verde.
  useEffect(() => {
    const m = mapa.current;
    if (!m || !tokenMapillary) return;
    const anadir = () => {
      if (m.getSource("mly")) return;
      // Por sus teselas vectoriales oficiales: una petición por tesela de
      // pantalla, gratis, y ya vienen cacheadas. No pasa por el backend, así
      // que Rust no tiene que decodificar nada.
      //
      // La URL vive aquí y solo aquí: estas teselas las pide el navegador
      // directamente a Mapillary, nunca el backend, así que una constante en
      // Rust solo sería una segunda copia que se desincroniza.
      m.addSource("mly", {
        type: "vector",
        tiles: [`https://tiles.mapillary.com/maps/vtp/mly1_public/2/{z}/{x}/{y}?access_token=${tokenMapillary}`],
        minzoom: 6,
        maxzoom: 14,
      });
      m.addLayer({
        id: "mly-puntos",
        type: "circle",
        source: "mly",
        "source-layer": "image",
        layout: { visibility: activos?.has("mapillary") ? "visible" : "none" },
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 1.2, 16, 2.6],
          "circle-color": "#4ec9a5",
          "circle-opacity": 0.9,
        },
      });
    };
    if (m.isStyleLoaded()) anadir(); else m.once("load", anadir);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tokenMapillary]);

  useEffect(() => {
    const src = mapa.current?.getSource("teselas") as mapboxgl.GeoJSONSource | undefined;
    if (!src || !clasificacion) return;
    src.setData({
      type: "FeatureCollection",
      features: clasificacion.teselas.map(([qk, e]) => {
        const f = teselaAPoligono(qk);
        f.properties = e.estado === "reclamada"
          ? { estado: e.estado, paquete: e.paquete, autor: e.autor }
          : { estado: e.estado };
        return f;
      }),
    });
  }, [clasificacion]);

  useEffect(() => {
    if (dibujo.length === 0) puntos.current = [];
    anilloEditando.current = herramienta === "editar" && dibujo.length === 1 ? dibujo[0] : [];
    const m = mapa.current;
    if (!m || !m.isStyleLoaded()) return;
    const src = m.getSource("vertices") as mapboxgl.GeoJSONSource | undefined;
    src?.setData(verticesGeoJSON(anilloEditando.current));
    // Entrar en "editar" es la única forma de volver a ver el contorno de un
    // área ya clasificada: fuera de este modo, nada vuelve a tocar la fuente
    // "dibujo" una vez que el trazo se cerró.
    if (herramienta === "editar") pintarDibujoEn(m, anilloEditando.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dibujo, herramienta]);

  useEffect(() => {
    const m = mapa.current;
    if (!m || !m.isStyleLoaded()) return;
    if (m.getLayer("mly-puntos")) {
      m.setLayoutProperty("mly-puntos", "visibility", activos?.has("mapillary") ? "visible" : "none");
    }
    const src = m.getSource("sondeos") as mapboxgl.GeoJSONSource | undefined;
    if (!src) return;
    // Mapillary ya se pinta como puntos y el cenital no se pinta: los dos
    // quedan fuera del sombreado, o taparían a los demás con una capa que no
    // dice nada.
    src.setData({
      type: "FeatureCollection",
      features: (sondeos ?? [])
        .filter((s) => activos?.has(s.fuente) && s.fuente !== "mapillary" && s.fuente !== "mapbox-satelite")
        .map((s) => {
          const f = teselaAPoligono(s.quadkey);
          f.properties = { nivel: s.nivel, color: color(s.fuente) };
          return f;
        }),
    });
  }, [activos, sondeos]);

  function borrarTrazo() {
    puntos.current = [];
    (mapa.current?.getSource("dibujo") as mapboxgl.GeoJSONSource | undefined)?.setData({
      type: "FeatureCollection", features: [],
    });
  }

  function elegirHerramienta(h: Herramienta) {
    // Cambiar ENTRE herramientas de dibujo a mitad de un trazo lo descarta: no
    // hay una forma sensata de seguir un polígono a mano con un rectángulo.
    // Pasar a "mano" no borra nada — es la herramienta para solo mirar
    // alrededor, y perder un trazo a medio hacer por eso sería un castigo.
    if (h !== "mano") borrarTrazo();
    setHerramienta(h);
  }

  // Geocodificador de Mapbox, con la misma clave que el mapa: es el mismo
  // producto, no una cuenta aparte. Con debounce porque cada tecla no merece
  // su propia petición de red.
  function alEscribirBusqueda(q: string) {
    setBusqueda(q);
    if (sondeoBusqueda.current) clearTimeout(sondeoBusqueda.current);
    if (q.trim().length < 3 || !claveMapaRef.current) {
      setSugerencias([]);
      return;
    }
    sondeoBusqueda.current = setTimeout(async () => {
      setBuscando(true);
      try {
        const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(q)}.json` +
          `?access_token=${claveMapaRef.current}&limit=5&language=es`;
        const r = await fetch(url);
        const j: {
          features?: {
            place_name: string; center: [number, number];
            place_type?: string[]; context?: { id: string; text: string }[];
          }[];
        } = await r.json();
        setSugerencias(
          (j.features ?? []).map((f) => ({
            nombre: f.place_name, lng: f.center[0], lat: f.center[1],
            tipo: f.place_type ?? [], contexto: f.context ?? [],
          })),
        );
      } catch {
        setSugerencias([]);
      } finally {
        setBuscando(false);
      }
    }, 350);
  }

  function irA(s: LugarBuscado) {
    setBusqueda(s.nombre);
    setSugerencias([]);
    setLugarSeleccionado(s);
    const m = mapa.current;
    if (!m) return;

    // `flyTo`, no el `easeTo` de `volarA`: un resultado de búsqueda puede
    // estar a medio planeta, y subir de altitud antes de bajar se siente
    // mucho mejor que un paneo plano. `volarA` sigue siendo el vuelo normal
    // para todo lo que ya está cerca (centrar un índice, por ejemplo).
    m.flyTo({ center: [s.lng, s.lat], zoom: 13, duration: 1700, curve: 1.4, easing: EASE_OUT_CUBIC });

    // Un pulso puntual en el destino: dice "aquí" en el momento en que el
    // vuelo llega, sin quedarse parpadeando para siempre.
    const el = document.createElement("div");
    el.className = "lumi-anim";
    el.style.width = "14px";
    el.style.height = "14px";
    el.style.borderRadius = "999px";
    el.style.background = "#85b7eb";
    el.style.animation = "jg-destino-pulso 1.7s ease-out 1";
    const marca = new mapboxgl.Marker({ element: el }).setLngLat([s.lng, s.lat]).addTo(m);
    setTimeout(() => marca.remove(), 1800);

    void api.territorioRecientesAnadir(s.nombre, s.lat, s.lng)
      .then(() => api.territorioRecientesLeer())
      .then(setRecientes);
  }

  // El motivo real, no un mapa en blanco: sin clave no hay teselas que pedir,
  // y quien lo lee tiene que saber exactamente dónde se arregla.
  if (hayClave === false) {
    return (
      <div className="grid h-full w-full place-items-center bg-surface">
        <div className="max-w-[340px] text-center">
          <p className="text-[12px] text-fg">El mapa necesita una clave de Mapbox</p>
          <p className="mt-1.5 text-[11px] leading-relaxed text-muted">
            Sin ella no se pueden pedir las teselas del mapa base, así que no hay dónde dibujar
            el territorio. Se configura en Ajustes, pestaña «Orígenes de red», sección «Mapa base».
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative h-full w-full">
      <div ref={contenedor} className="h-full w-full" />

      {/* z-30, por encima de los paneles informativos (z-20, AvailabilityPanel
          etc.): son controles, no información, y la lista de sugerencias no
          puede quedar tapada por un panel que se abre en el mismo sitio. */}
      {hayClave && (
        <div className="absolute left-3 top-3 z-30 w-[300px]">
          <div className="flex items-center gap-2 rounded-lg border border-white/[.13] bg-[rgba(16,19,25,.82)]
            px-3 py-2 shadow-lg shadow-black/40 backdrop-blur-xl">
            <Icon name="search" size={13} className="shrink-0 text-subtle" />
            <input
              value={busqueda}
              onChange={(e) => alEscribirBusqueda(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && sugerencias[0]) irA(sugerencias[0]); }}
              onFocus={() => setFoco(true)}
              onBlur={() => setFoco(false)}
              placeholder="Buscar un lugar…"
              className="w-full bg-transparent text-[12px] text-fg outline-none placeholder:text-subtle"
            />
            {buscando && <Icon name="spinner" size={12} className="shrink-0 text-subtle" />}
          </div>
          {(() => {
            const mostrarRecientes =
              foco && busqueda.trim().length === 0 && sugerencias.length === 0 && recientes.length > 0;
            // Un reciente no trae tipo/contexto (la API solo guarda
            // nombre/lat/lng) — se completa vacío para que `irA` reciba
            // siempre un `LugarBuscado` completo, sin mezclar los dos tipos.
            const items: LugarBuscado[] = mostrarRecientes
              ? recientes.map((r) => ({ ...r, tipo: [], contexto: [] }))
              : sugerencias;
            if (items.length === 0) return null;
            return (
              <div className="lumi-anim mt-1.5 overflow-hidden rounded-lg border border-white/[.13]
                bg-[rgba(16,19,25,.94)] shadow-lg shadow-black/40 backdrop-blur-xl"
                style={{ animation: "jg-fade-rise 160ms cubic-bezier(.2,.85,.35,1) both" }}>
                {mostrarRecientes && (
                  <p className="px-3 pt-2 text-[9.5px] uppercase tracking-wide text-subtle">Recientes</p>
                )}
                {items.map((s, i) => {
                  const { principal, contexto } = partirNombre(s.nombre);
                  return (
                    <button
                      key={`${s.nombre}-${i}`}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => irA(s)}
                      className="lumi-anim block w-full px-3 py-2 text-left transition-colors duration-150
                        hover:bg-white/[.06]"
                      style={{ animation: `jg-fade-rise 160ms ${i * 25}ms cubic-bezier(.2,.85,.35,1) both` }}
                    >
                      <p className="truncate text-[11.5px] text-fg">{principal}</p>
                      {contexto && <p className="truncate text-[9.5px] text-subtle">{contexto}</p>}
                    </button>
                  );
                })}
              </div>
            );
          })()}
        </div>
      )}

      {lugarSeleccionado && (
        <div className="lumi-anim absolute left-3 top-[76px] z-20 w-[300px] rounded-lg border border-white/[.13]
          bg-[rgba(16,19,25,.82)] p-3 shadow-lg shadow-black/40 backdrop-blur-xl"
          style={{ animation: "jg-fade-rise 200ms cubic-bezier(.2,.85,.35,1) both" }}>
          <div className="flex items-start justify-between gap-2">
            <p className="text-[12px] leading-snug text-fg">{partirNombre(lugarSeleccionado.nombre).principal}</p>
            <button onClick={() => setLugarSeleccionado(null)} className="jg-press shrink-0 text-subtle hover:text-fg">
              <Icon name="x" size={12} />
            </button>
          </div>
          {lugarSeleccionado.tipo.length > 0 && (
            <p className="mt-1 text-[10px] uppercase tracking-wide text-subtle">
              {lugarSeleccionado.tipo.map((t) => NOMBRE_TIPO[t] ?? t).join(", ")}
            </p>
          )}
          {lugarSeleccionado.contexto.length > 0 && (
            <p className="mt-1.5 text-[10.5px] leading-relaxed text-muted">
              {lugarSeleccionado.contexto.map((c) => c.text).join(" · ")}
            </p>
          )}
          <p className="mt-1.5 font-mono text-[9.5px] text-subtle">
            {lugarSeleccionado.lat.toFixed(5)}, {lugarSeleccionado.lng.toFixed(5)}
          </p>
        </div>
      )}

      {/* Siempre visible, con o sin área ya clasificada: es la única manera
          de volver a "mano" para simplemente mirar el mapa, y de arrancar un
          área nueva sin depender de otro botón en otro panel. */}
      {hayClave && (
        <div className="absolute bottom-6 left-1/2 z-30 flex -translate-x-1/2 gap-[3px] rounded-lg
          border border-white/[.13] bg-[rgba(16,19,25,.72)] p-[5px] shadow-lg shadow-black/40 backdrop-blur-xl">
          {HERRAMIENTAS.map((h) => (
            <button
              key={h.id}
              title={h.id === "editar" && dibujo.length > 1
                ? "Editar solo vale con una pieza — combina o rehaz para dejar una sola"
                : h.titulo}
              disabled={h.id === "editar" && dibujo.length !== 1}
              onClick={() => elegirHerramienta(h.id)}
              className={`grid h-7 w-7 place-items-center rounded-[7px] disabled:opacity-30 ${
                herramienta === h.id ? "bg-white/[.09] text-fg" : "text-subtle hover:text-fg"}`}
            >
              <Icon name={h.icon} size={14} />
            </button>
          ))}
          <span className="mx-0.5 w-px bg-white/10" />
          <button
            title="Borrar el trazo actual"
            onClick={borrarTrazo}
            className="grid h-7 w-7 place-items-center rounded-[7px] text-subtle hover:text-fg"
          >
            <Icon name="trash" size={14} />
          </button>
          <span className="mx-0.5 w-px bg-white/10" />
          {([
            { m: "sustituir" as const, etiqueta: "Sustituir" },
            { m: "sumar" as const, etiqueta: "Sumar" },
            { m: "restar" as const, etiqueta: "Restar" },
          ]).map(({ m, etiqueta }) => (
            <button
              key={m}
              title={`Al dibujar una forma nueva sobre un área ya clasificada: ${etiqueta.toLowerCase()}`}
              onClick={() => onCombineModeChange(m)}
              className={`rounded-[7px] px-2 text-[10px] ${
                combineMode === m ? "bg-white/[.09] text-fg" : "text-subtle hover:text-fg"}`}
            >
              {etiqueta}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Vuelo con la misma curva que el cliente, para que el gesto se sienta igual
 *  en las dos aplicaciones. Se expone aparte porque no todo vuelo nace de un
 *  clic del operador (p. ej. centrar tras cargar un índice). */
export function volarA(m: mapboxgl.Map, centro: [number, number], zoom: number) {
  m.easeTo({ center: centro, zoom, duration: 900, easing: EASE_OUT_CUBIC });
}
