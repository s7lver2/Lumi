# Editor de imagen pre-subida — rediseño

Fecha: 2026-09-15
Estado: diseño aprobado, pendiente de plan de implementación

## Por qué

`ImageEditorPopup.tsx` (recorte + blur antes de subir una imagen, spec 2026-09-10 §2) funciona
pero el owner lo describe sin rodeos: "se siente muy básico y cutre". Con feedback más
concreto, el problema es el conjunto: la zona de recorte es solo un rectángulo blanco con
puntos diminutos en las esquinas sobre fondo oscurecido (sin rejilla, sin medidas, sin
proporciones), la barra de herramientas son dos botones de texto plano, y al editor le faltan
herramientas que cualquier editor rápido trae de serie (rotar, voltear, zoom, ajuste de tono).
El "Mejorar calidad" (upscaler de IA) tampoco da ninguna pista visual de que está trabajando
más allá de un texto "Mejorando…".

## Alcance

Un solo entregable: `client/src/work/ImageEditorPopup.tsx` y lo que haga falta tocar en el
backend para que el reescalado acepte un objetivo de resolución (`crates/lumid/src/routes/images.rs`,
`crates/lumid/src/queue/mod.rs::correr_upscale`, `workers/lumi_upscale.py`). No cambia nada del
resto del flujo de subida (`UploadPopup`, `MediaDrawer`) ni de la cola de análisis.

---

## 1. Barra de herramientas: fila horizontal arriba

Los dos botones de texto plano de hoy (Recorte / Blur) se sustituyen por una fila de iconos en
la parte de arriba del lienzo: Recorte, Girar/Voltear, Blur, Tono. Cada herramienta activa
muestra su propia barra contextual justo debajo del lienzo — proporciones para Recorte, radio
para Blur, sliders para Tono — en vez de amontonar todos los controles en la barra superior.
Se descartaron el rail vertical (escala peor a un popup que no crece de ancho) y el lienzo a
pantalla completa con herramientas flotantes (exige agrandar mucho el popup para una pieza que
es un paso intermedio, no la app entera).

## 2. Recorte: rejilla, proporciones, medidas y mejor agarre

- **Rejilla de tercios** dibujada sobre la caja de recorte (dos líneas horizontales y dos
  verticales, translúcidas) — ayuda de composición estándar, siempre visible mientras la
  herramienta Recorte está activa.
- **Proporciones predefinidas** en la barra contextual: Libre (la actual, recorte a mano) / 1:1
  / 4:3 / 16:9. Elegir una ajusta la caja actual a esa proporción manteniendo el centro; seguir
  arrastrando una esquina respeta la proporción bloqueada en vez de deformarla.
- **Medidas en vivo**: la barra contextual muestra el tamaño de la caja en píxeles reales del
  lienzo (`840 × 630 px`), actualizado mientras se arrastra.
- **Manejadores más grandes y con mejor respuesta**: los puntos de esquina pasan de 5px a un
  cuadrado de 14px con área de agarre generosa (ya existe una tolerancia de agarre en el código,
  `TAM_ESQUINA`; sube a juego con el tamaño visual nuevo). Al agarrar uno, gana un halo sutil
  (aro blanco translúcido) y crece ligeramente mientras se arrastra, para que se note
  físicamente "cogido". Se añaden manejadores en el punto medio de cada lado (arriba, abajo,
  izquierda, derecha) para reescalar en un solo eje sin mover los otros tres bordes — hoy solo
  existen los cuatro de esquina.

## 3. Rotar y voltear

Dos acciones nuevas en la herramienta "Girar": rotar 90° (en pasos, sentido horario) y voltear
horizontal/vertical. Ambas son transformaciones directas del `<canvas>` (rotar intercambia
ancho/alto y redibuja con `ctx.rotate`; voltear es un `ctx.scale(-1,1)`/`(1,-1)`), cada una
genera su propio snapshot en el historial de deshacer/rehacer que ya existe.

## 4. Zoom sobre el lienzo

Un control de zoom (rueda del ratón sobre el lienzo, o +/- en la barra contextual de cualquier
herramienta) para trabajar a mayor escala que el ajuste automático actual
(`ajustarOverlay`, hoy fijo a un máximo de 620×420 de pantalla). El recorte y el blur siguen
operando en coordenadas reales del lienzo (`puntoCanvas` ya convierte pantalla→canvas por
`escalaRef`); el zoom solo cambia ese factor y añade desplazamiento (`scroll`/paneo) dentro del
contenedor cuando la imagen ampliada no cabe entera.

## 5. Brillo y contraste

Nueva herramienta "Tono" con dos sliders (brillo, contraste), aplicados con
`ctx.filter = "brightness(...) contrast(...)"` sobre una redibujada del canvas — mismo patrón
que ya usa `aplicarBlurEn` con `ctx.filter = blur(...)`. Se confirma con un botón "Aplicar" (like
"Aplicar recorte") que genera el snapshot; los sliders en sí son una vista previa en vivo, no
comprometida hasta confirmar.

## 6. Reescalado: rejilla de proceso + resoluciones objetivo

**Efecto visual durante "Mejorar calidad"**: una rejilla de celdas pequeñas sobre la imagen
(ligeramente desenfocada/desaturada de fondo) donde cada celda late de forma escalonada en
bucle. No es una barra de progreso — el upscaler de hoy es una sola llamada sin progreso
incremental que reportar (`workers/lumi_upscale.py::_procesar`), y este proyecto tiene la
norma de no inventar un ritmo de avance que no existe (ver `fraseDeEspera` en
`AgentResultPopup.tsx`). La rejilla comunica "está trabajando" sin aparentar medir nada.

**Resoluciones objetivo**: tres presets, 1× / 2× / 4×, cada uno mostrando el tamaño resultante
real en píxeles junto al multiplicador. El modelo (Real-ESRGAN, vía
`workers/lumi_upscale.py`/`lumi_motores.py`) reescala siempre a ×4 de forma nativa — no acepta
un factor arbitrario. 1× y 2× se consiguen dejando correr el modelo a su ×4 nativo y
reduciendo el resultado a la mitad o a la cuarta parte respectivamente (Lanczos, mismo filtro
que ya usa `lumi_verify.py` para reescalados), que sigue partiendo del detalle reconstruido por
la IA en vez de una interpolación simple del original. Esto exige:
- `POST /v1/cases/:id/images/upscale` acepta un campo nuevo (`factor: 1 | 2 | 4`) en el
  multipart, junto a la imagen.
- El `Job` de upscale (`lumi_proto::worker`) lleva ese factor hasta el trabajador.
- `lumi_upscale.py::_procesar` reescala el resultado del motor a `factor/4` del tamaño nativo
  cuando `factor < 4`, antes de escribir `ruta_salida`.

## Qué no cambia

- El historial de deshacer/rehacer (pila de snapshots del canvas) sigue igual; cada acción
  nueva (girar, voltear, aplicar tono) genera un snapshot con el mismo mecanismo que ya usan
  recorte y blur.
- El flujo Omitir / Usar esta versión / Mejorar calidad no cambia de posición ni de
  comportamiento, solo el contenido de arriba.
- El límite de historial (`PROFUNDIDAD_HISTORIAL`, 20 pasos) no cambia.
