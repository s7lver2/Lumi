# Panel de agentes — diseño

Aprobado por el owner el 2026-09-09. Implementación autorizada sin más rondas de
revisión; se revisa al terminar, sobre la versión desplegada.

## Qué es

Un modo nuevo, "Agentes", en el selector de modelo (`ModelPicker`). En vez de
geolocalizar, el investigador elige UN agente del registro (`registros/agentes/`)
y le hace su pregunta cerrada a esa imagen — sin recuperación, sin verificación
geométrica. El resultado es una fila de análisis más, como mini/pro/vision.

## Frontend

### Entrada

`UploadPopup`/`ModelPicker` gana una 4ª tarjeta, "Agentes", junto a mini/pro/
vision. Elegirla no encola directamente: navega a un `mode` nuevo del router de
`App.tsx` (`"agentes"`, junto a `entry|wizard|admin|profile|picker|project|case`),
pantalla completa — no cajón lateral, por decisión explícita del owner.

### Pantalla 1 — elegir agente

Rejilla de tarjetas, una por agente del registro (`GET` ya existente o uno
nuevo que liste `registros/agentes/*.json` con su estado de modelo). Cada
tarjeta: icono propio (SVG a mano, patrón de `DESIGN.md`), nombre, la pregunta
tal cual, las etiquetas posibles como `tag-pill`.

Selección única (no multi-select — corrección explícita del owner a mitad de
brainstorming). Un agente cuyo motor (`vlm`/`ocr`/`profundidad`) no tiene el
modelo correspondiente descargado en este servidor se muestra en estado
`locked`: icono y texto atenuados, sin ser seleccionable, con
`requiere <modelo> · <tamaño>` en mono y un botón "Descargar" que dispara el
mismo flujo que ya existe en la pantalla de Modelos (3a) para ese modelo
concreto. Esto es solo para agentes cuyo motor falta — no reintroduce el
bloqueo de nivel entero que ya existe para mini/pro/vision.

Botón "Lanzar agente" al fondo, deshabilitado hasta que hay selección.

### Pantalla 2 — resultado (misma pantalla, cambia el contenido)

Mismo layout de dos columnas que `ResultsDrawer`/`AgentesVisual.tsx` (la
sección de marketing en `web/`), aplicado a un análisis real:

- **Columna foto** (izquierda): la imagen de consulta con los rasgos reales
  superpuestos en recuadro punteado + etiqueta flotante, y un interruptor
  "rasgos" en la esquina para mostrarlos/ocultarlos. Ver "Rasgos" abajo para
  qué agentes los tienen.
- **Columna info** (derecha): cabecera miniatura+fichero+motor, el widget
  único del agente (ver "Widget único"), la lista de hipótesis rankeada con
  barra (ver "Distribución de confianza"), insignia "verificado por
  `<motor>`" al pie.
- **Abstención**: cuando la confianza de la etiqueta ganadora no alcanza
  `umbral_confianza` del agente, la columna info entera se sustituye por un
  único aviso ("no se pudo determinar `<pregunta abreviada>` con suficiente
  confianza") — sin lista, sin widget, sin insignia.

### Distribución de confianza — sin inventar nada

Hoy `Vlm.responder()` y la rama no-topónimos de `Ocr.responder()`
(`workers/lumi_motores.py`) YA calculan una distribución completa sobre el
conjunto cerrado de etiquetas del agente (softmax de log-verosimilitud en el
VLM; proporción de caracteres por escritura en el OCR) y solo devuelven la
ganadora. La ampliación es exponer esa distribución completa en vez de
colapsarla:

- `Vlm.responder` y `Ocr.responder` (rama etiquetas) devuelven además
  `alternativas: list[(etiqueta, prob)]`, ordenada, ya normalizada.
- `Ocr.responder` (rama `toponimos`, texto libre) y `Profundidad.responder`
  (árbol de reglas con confianza fija por rama) **no** tienen un conjunto de
  probabilidades genuino que exponer — siguen devolviendo solo la etiqueta
  ganadora. El panel de resultado, para estos, muestra una única fila (la
  ganadora) en vez de una lista — nunca se rellena con pesos inventados.
- El cliente distingue los dos casos por la presencia o ausencia de
  `alternativas` en la respuesta, no por el nombre del motor (un motor podría
  ganar esta capacidad más adelante sin tocar el cliente).

### Rasgos — solo donde existen de verdad

- **OCR** (agentes `idioma`, `senalizacion`, `toponimos`): los recuadros por
  línea que `PaddleOCR` ya calcula y hoy se descartan
  (`Ocr._lineas`/`responder`) pasan a devolverse como parte del veredicto.
- **Profundidad** (agente `dimensiones`/similar): el mapa de profundidad que
  `Depth Anything` ya calcula y hoy se reduce a medias de franjas
  (`Profundidad.responder`) se devuelve también como una imagen (PNG,
  paleta de un solo canal reescalada 0-255) para pintarla como mapa de calor.
- **VLM**: sin rasgos. No existe ninguna señal real de "en qué se fijó" que
  extraer de Qwen3-VL con la técnica actual (puntuar etiquetas, no
  interpretabilidad de atención) — se decidió explícitamente NO fabricar
  mapas de atención falsos. El interruptor de rasgos no aparece para agentes
  de motor `vlm`.

### Widget único por agente

Un hueco fijo en la columna info cuyo contenido depende del agente — mismo
patrón que `AgentesVisual.tsx` (placa de vehículo, texto detectado, línea de
hora del día, mapa mundo). Se implementa por agente, reutilizando esos
mismos componentes donde el dato ya es real (texto OCR crudo, hora
estimada); para agentes nuevos sin pieza única evidente, el hueco muestra
solo la etiqueta ganadora en grande — no es obligatorio inventar una pieza
distinta para los doce desde el primer día.

## Backend

### Ruta de análisis

- `AnalysisReq` gana `agente: Option<String>`, solo relleno cuando
  `model == "agentes"`.
- Nivel nuevo `registros/modelos/agentes.json` (o el fichero equivalente de
  nivel): `recuperacion: []`, `geometricos: []`, agentes vacíos (la lista la
  decide la petición, no el nivel) — existe solo para que `limits.models` lo
  trate como una opción habilitable/deshabilitable igual que `vision`.
- `queue/mod.rs`: una fila con `model == "agentes"` NO pasa por
  `lumi_geo.py` ni por verificación geométrica — va directa a
  `agentar::preguntar` con el único agente pedido. `guardar_resultado`
  guarda la fila sin lat/lng/radio (quedan `NULL`, como ya ocurre cuando no
  aplican).
- Estado de "modelo descargado" por agente, para la pantalla 1: se deriva
  del motor del agente (`vlm`→`qwen3-vl`, `ocr`→`paddleocr`,
  `profundidad`→`depth-anything-v2-small`) contra el estado ya existente de
  modelos instalados — no es un campo nuevo en el registro de agentes, es
  una consulta cruzada en la ruta que lista agentes.

### Protocolo Python↔Rust

- `lumi_proto::worker::Msg::Agente` gana dos campos opcionales
  (`#[serde(default)]`, compatibles con mensajes antiguos):
  - `alternativas: Vec<(String, f64)>` — vacío si el motor no la calcula.
  - `rasgos: Option<Rasgos>` — enum/estructura con la variante OCR
    (recuadros normalizados 0-1 + etiqueta) o profundidad (PNG en base64),
    `None` si no aplica.
- `lumi_index::agentes::Veredicto` y `DichoDeAgente` (API pública) llevan los
  mismos dos campos.
- `workers/lumi_motores.py`: `Vlm.responder` y `Ocr.responder` calculan y
  devuelven `alternativas`; `Ocr._lineas` deja de descartar las cajas
  (`entrada[0]`, ya las trae PaddleOCR) y `Ocr.responder` las adjunta;
  `Profundidad.responder` construye el PNG de calor a partir del mismo
  `mapa` que ya calcula, sin repetir la inferencia.
- `workers/lumi_agentes.py` (`_procesar`) pasa esos campos nuevos al
  `escribir(...)` tal cual, sin lógica propia.

## Fuera de alcance (explícito)

- Multi-selección de agentes en un mismo lanzamiento (descartado por el
  owner a mitad de brainstorming).
- Cualquier "mapa de atención" o rasgo VLM no derivado de un dato real.
- Rediseñar `Profundidad` para que dé una distribución genuina — sigue
  siendo un árbol de reglas; solo se le añade la imagen de calor.
- Iconografía y widget único definitivos para los doce agentes — se
  implementan con un criterio razonable por agente durante esta misma
  tanda, pero no son objeto de aprobación pieza por pieza.
