# Informe forense — tema oscuro editorial

Aprobado por el owner el 2026-09-10, tras brainstorming con maquetas
visuales. Implementación autorizada sin más rondas de revisión.

## Qué cambia

El informe (`crates/lumid/templates/informe.tex.tera`, LaTeX vía
`tectonic`) gana un **interruptor de tema** en `ExportInformeReq`
(`tema: "oscuro" | "claro"`, default `"oscuro"`) y una dirección visual
nueva para el tema oscuro: **editorial**, no el mismo lenguaje de tarjetas
con borde que ya usa la app — números grandes como protagonistas, menos
cajas, más tipografía. El tema `"claro"` existente (commit `22a886d`) se
conserva tal cual para cuando alguien necesite imprimir.

## Paleta del tema oscuro

Tokens reales de `DESIGN.md`, no inventados:

| Uso | Color |
|---|---|
| Fondo de página | `#0e0f11` |
| Fondo de bloque/miniatura | `#202226` |
| Borde | `#26282c` |
| Texto principal | `#e8e8e6` |
| Texto secundario/etiquetas | `#9a9a95` / `#6a6c70` |
| Acento (destello, confianza, barras) | `#378add` / `#85b7eb` |
| Aviso (errores/abstenciones/sin resolver) | `#efb968`, fondo `#efb96812`, borde `#efb96833` |

Sin verde en ningún caso. Mono (`lmodern`'s `\ttfamily` o `inconsolata`, lo
que ya use la plantilla) para sha256, coordenadas, fechas, versión —
igual que en pantalla.

## Portada

- Destello de Lumi (TikZ ya existente, reutilizado tal cual) + "Lumi" +
  "informe forense".
- Nombre del caso.
- **Cuatro números grandes**, mono, en fila: imágenes totales, imágenes
  con hipótesis, imágenes con veredicto de agente, y **"sin resolver"**
  (análisis en error o con abstención) — este último en ámbar, nunca
  fundido en los otros totales. Es un requisito explícito del owner: un
  informe de evidencia no puede esconder que algo no se resolvió dentro
  de una cifra de éxito.
- Gráfico de barras simple (una por modelo: mini/pro/vision/agentes),
  altura proporcional a cuántos análisis de ese modelo hay en el caso.
- Si `sin_resolver > 0`: aviso ámbar con el desglose ("N errores, M
  abstenciones") bajo el gráfico.
- Pie: fecha de generación + versión de Lumi, mono, centrado.

## Cabecera de página (todas menos la portada)

Destello en miniatura (mismo TikZ, tamaño reducido) + nombre del caso en
mono + número de página a la derecha, con una línea fina (`#26282c`)
debajo. Reemplaza la cabecera de solo-texto actual.

## Página por imagen

- Línea superior en mono: número de orden + nombre de fichero
  (`03 — catedral-leon.jpg`).
- Miniatura.
- **Confianza como número grande** (ej. `43%`, mono, en el acento) junto
  a coordenada+radio en mono pequeño al lado — sustituye a como se
  presentaba en el tema claro (más tabular).
- Un bloque por dato, cada uno con su propio icono a mano (mismo patrón
  `viewBox 24x24, stroke currentColor, strokeWidth ~1.8` que ya usan los
  iconos de la app — TikZ, no una fuente de iconos):
  - EXIF (icono de reloj/cámara)
  - Integridad — sha256 del original, mono (si `integridad_sha256` está
    activo)
  - Hipótesis de geolocalización (si `hipotesis_geolocalizacion` activo)
  - Agente, con su etiqueta y motivo (si `veredictos_agentes` activo)
- **Rasgos como imagen**: cuando el veredicto de un agente trae
  `rasgos` reales, el gráfico (recuadro OCR sobre la miniatura, o el PNG
  de profundidad) se embebe **dentro del mismo bloque "Agente"**, debajo
  del texto del veredicto — no como sección aparte. Decisión del
  implementador (no se llegó a cerrar en el brainstorming): mantiene el
  layout de "un bloque por dato" sin añadir un tipo de sección nuevo, y
  el gráfico ya lleva su propio espacio dentro del bloque en vez de una
  línea de texto.
- **Sin dato / error**: cuando una sección no tiene nada real que
  mostrar (agente sin rasgos, EXIF vacío) simplemente no aparece ese
  bloque — nunca un placeholder. Cuando el análisis ENTERO de esa imagen
  terminó en error o abstención, todos sus bloques de resultado se
  sustituyen por un único aviso ámbar (mismo estilo que el de portada)
  con el motivo real (`analysis.error` cuando existe, o el genérico de
  timeout ya usado en el cliente) — nunca se omite la imagen ni se deja
  en blanco.
- Pie de página: número de página, mono, alineado a la derecha.

## Notas y firma

Sin cambios de fondo respecto al diseño anterior (`a2aa11d`) — notas del
investigador y "firmado por" + fecha, ambos ya implementados; solo
heredan la paleta oscura cuando `tema == "oscuro"`.

## Implementación

- `ExportInformeReq` (`lumi-proto`): nuevo campo `tema: String` (default
  `"oscuro"`).
- `crates/lumid/templates/informe.tex.tera`: la plantilla decide sus
  colores (`\definecolor`) según `{{ tema }}` al principio del documento
  — un único punto de rama, no duplicar toda la plantilla en dos
  ficheros. El resto de la estructura (secciones, condicionales de
  `ExportInformeReq`) no cambia entre temas, solo la paleta y el trato
  visual de los números (grandes en oscuro, tabular en claro se puede
  dejar como está si simplifica).
- `client/src/work/ExportDrawer.tsx`: un interruptor más ("Tema oscuro"),
  o un selector de dos opciones si un simple booleano no encaja con el
  patrón de `Interruptor` ya existente — criterio del implementador.
- Iconos nuevos en TikZ (EXIF, integridad, hipótesis, agente): reutilizar
  el mismo path/patrón de trazo que sus equivalentes SVG ya existentes en
  `client/src/ui/Icon.tsx` cuando los haya, igual que se hizo con el
  destello — no inventar iconografía nueva sin mirar primero si ya existe
  una versión SVG del mismo concepto en la app.

## Fuera de alcance

- Gráficos de estadísticas más allá del desglose por modelo (línea de
  tiempo, distribución de confianza, mapa de calor de hipótesis) — se
  propusieron durante el brainstorming pero no se pidieron para esta
  tanda; el owner no señaló que el gráfico de barras se quedara corto.
- Cambiar la estructura del tema claro existente — sigue exactamente
  igual, solo gana el interruptor para elegirlo explícitamente en vez de
  ser el único disponible.
