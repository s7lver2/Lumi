# Menú de exportar — asistente en pasos con boceto en vivo

Fecha: 2026-09-14
Estado: diseño aprobado, pendiente de plan de implementación

## Por qué

`ExportPopup.tsx` (el popup de configurar el informe en PDF) es hoy una sola pantalla con
ocho interruptores seguidos, un campo de firma, una nota y una lista de imágenes, todo en el
mismo scroll. El owner lo probó y lo calificó sin rodeos: "se ve horrible". No es un problema
de contenido — el contenido está bien pensado — es que todo pesa visualmente igual, no hay
jerarquía, y no hay ninguna pista de cómo va a quedar el informe hasta pulsar "Vista previa"
y esperar a que compile con `tectonic`.

Esta spec no toca el informe en PDF en sí (eso ya se rediseñó en
`2026-09-10-informe-pdf-refinado-design.md`) ni añade impresión directa desde el popup —el
owner confirmó que "Guardar" + abrir el PDF (que ya trae su propio visor/impresión) es
suficiente—. El alcance es solo la interfaz de configuración: `ExportPopup.tsx`.

## Alcance

Un solo entregable: `client/src/work/ExportPopup.tsx` reestructurado como asistente de 3
pasos con un boceto en vivo de la portada. No cambia `ExportInformeOpts`, no cambia
`routes/export.rs`, no cambia la plantilla `.tex.tera`. `PdfPreviewPopup.tsx` (la vista previa
real, compilada) sigue existiendo tal cual, disponible desde el último paso.

---

## 1. Estructura: 3 pasos, no una pantalla

Los interruptores de hoy se reparten en tres pasos, cada uno pensado para caber sin scroll:

| Paso | Contenido |
|---|---|
| 1 · Aspecto | Tema oscuro, Foto a ancho completo (deshabilitada si el tema no es oscuro, con el motivo en su `hint`, igual que hoy) |
| 2 · Contenido | Portada con estadísticas, EXIF por imagen, Hipótesis de geolocalización, Veredictos de agentes, Integridad de archivo, Rasgos como imagen |
| 3 · Firma | Firmado por, Notas del investigador, Imágenes incluidas (checklist con miniaturas, igual que hoy) |

Se navega con "← Atrás" / "Siguiente: <paso> →"; el último paso cambia "Siguiente" por los
botones de siempre, "Vista previa" y "Guardar informe". Ir hacia atrás no pierde nada: todo
vive en el mismo estado `opts` de React que ya existe, los pasos solo deciden qué se pinta.

Se descartó meter todo en una sola pantalla reordenada en tarjetas (arregla la jerarquía pero
no resuelve "no se ve nada hasta compilar") y se descartó un asistente de más de 3 pasos
(exportar es una acción rápida y repetida — cada paso de más es fricción que se paga cada
vez).

## 2. El paso, sin barra de progreso genérica

Nada de barra rellenándose ni de burbujas numeradas (eso ya existe en el wizard de `/setup`
y aquí se leería como una operación larga, cuando exportar no lo es). En su lugar, un
**breadcrumb de tres palabras**: los tres nombres de paso en fila, el activo en `fg` con un
filete de 1.5px debajo, los demás en `subtle`; el ya recorrido en `muted` en vez de `subtle`
para distinguir "hecho" de "pendiente" sin añadir un tercer color. Se puede tocar un paso ya
recorrido para volver a él directamente.

```
Aspecto   Contenido   Firma
          ▔▔▔▔▔▔▔▔▔
```

## 3. Filas de contenido: icono propio, no un interruptor

El interruptor tipo iOS (pista + perilla) desaparece de este popup — el owner lo calificó de
"muy básico". Cada opción del paso 2 pasa a ser una fila completa, clicable en toda su
anchura, con:

- un icono a la izquierda que representa ESE contenido, no un icono genérico de "ajuste" —
  reutilizado del catálogo ya existente en `Icon.tsx`, ninguno nuevo:
  - Portada con estadísticas → `pulse`
  - EXIF por imagen → `image`
  - Hipótesis de geolocalización → `globe`
  - Veredictos de agentes → `users`
  - Integridad de archivo → `shield`
  - Rasgos como imagen → `boxes`
- la etiqueta y el `hint`, como hoy
- un `check` (ya existe en `Icon.tsx`) a la derecha, que solo se pinta con opacidad cuando la
  fila está activa

Estado visual: fila inactiva con icono y texto en `subtle`/`muted`; fila activa con icono,
texto y check en `fg`. Sin pista, sin perilla, sin color de acento — el contraste entre
apagado y encendido es el mismo lenguaje que ya usa el resto de Lumi para "seleccionado"
(ver `ContextMenu`, filas de lista).

Las filas de Aspecto (paso 1) usan el mismo patrón. La deshabilitada ("Foto a ancho
completo" sin tema oscuro) se queda opaca al 40%, igual que hoy — eso no cambia.

## 4. Boceto en vivo, no el PDF real

A la derecha de los pasos 1 y 2 (el 3 no tiene controles visuales que bocetar, ver más
abajo), un panel fijo de proporción A4 (`aspect-ratio: 210/297`) con un boceto aproximado de
la portada: una banda para donde va la foto/gráfico, tres bloques para las estadísticas, y
unas líneas para el resto del texto. Es CSS, no el documento LaTeX real — no se compila nada
mientras se configura. Se actualiza al instante con cada toggle (aparecen/desaparecen los
bloques que correspondan) para dar la sensación de "esto es lo que vas a tener" sin el coste
de una compilación de `tectonic` por cada clic.

El botón "Vista previa" del paso 3 sigue abriendo `PdfPreviewPopup` con el PDF real
compilado — el boceto no lo sustituye, es la pista rápida; la vista previa real sigue siendo
la fuente de verdad antes de guardar.

En el paso 3, en vez del boceto de portada, el mismo panel muestra un boceto del pie de
página (línea de firma + fecha) — refleja lo que se está escribiendo en "Firmado por".

## 5. Qué no cambia

- `ExportInformeOpts` y el payload a `routes/export.rs`: idénticos.
- La lista de imágenes incluidas (checklist con miniaturas): igual que hoy, en el paso 3.
- `PdfPreviewPopup.tsx`: sin cambios.
- El ancho del popup crece de 440px a ~640px para dar sitio a las dos columnas
  (controles + boceto) — sigue con `max-w-[calc(100vw-48px)]` para no desbordar en pantallas
  pequeñas; por debajo de cierto ancho el boceto puede ocultarse y dejar solo los controles
  (a decidir en el plan de implementación, no bloquea el diseño).

## Referencias

Mockups explorados con el acompañante visual de `brainstorming` durante el diseño, sesión de
`.superpowers/brainstorm/1856-1789416500/content/` (no versionados: capturas de la
conversación, no parte del entregable).
