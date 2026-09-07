# Página de Lumi Mini (`/meetmini`) — diseño

## Contexto

`web/app/meetmini/page.tsx`, `meetpro/` y `meetvision/` son hoy tres llamadas al mismo
placeholder (`web/components/Esqueleto.tsx`): un título, una línea de texto y la frase "esta
página todavía no tiene contenido". Esta spec cubre **solo la de Mini**, y dentro de ella solo
sus dos primeras secciones: el hero y la secuencia de scroll que le sigue. El resto del cuerpo
de la página (specs del nivel, comparación con Pro/Vision, CTA de instalación) queda fuera y se
trata aparte.

El "2" que vertebra el hero es el número de **generación de modelos**, no la versión del
producto ni el número de modelos que corre el nivel. Esa segunda generación tiene el nombre en
clave **Lumen**, que es interno: el producto se sigue llamando Lumi. Aparece en la página solo
como detalle/curiosidad, en letra pequeña, nunca en el titular.

## Alcance

- **Hero**: el "2" en ASCII a alta densidad como fondo, con "Lumi Mini" delante.
- **Secuencia**: al hacer scroll, una unidad de servidor es comprimida por una mano robótica
  hasta convertirse en un Mac mini — la lectura es "este modelo cabe en hardware pequeño".
- **Pipeline de render**: cómo se produce esa secuencia (offline, no WebGL en vivo) y cómo se
  integra en el sitio.
- **Créditos**: los tres modelos 3D son CC-BY-4.0 y obligan a acreditar autor.

Fuera de alcance: el resto del cuerpo de `/meetmini`, y las páginas de Pro y Vision (que
heredarán lo que aquí funcione, pero no se tocan ahora).

## 1. Hero: el "2" ASCII

Pantalla completa, estático. El fondo es el glifo "2" convertido a arte ASCII por densidad: se
rasteriza el glifo a alta resolución, se muestrea celda a celda y cada celda elige un carácter
de la rampa `" .:-=+*#%@"` según su brillo medio. El resultado tiene borde suave y grosor de
trazo variable — se lee como generado por una máquina, que es exactamente el registro del resto
del sitio (mono para todo dato de máquina, `DESIGN.md` § Tipografía).

**Se genera una sola vez y se commitea como texto.** No hay paso de build ni generación en
cliente: el glifo no va a cambiar nunca, así que montar un generador sería construir maquinaria
para un asset que se produce una vez (`ponytail`). El método queda documentado aquí para poder
regenerarlo si algún día cambia la tipografía:

> Rasterizar "2" en un lienzo de 200×260 con la tipografía en negrita a 220px, muestrear en una
> rejilla de 90 columnas (las filas salen de `columnas × (alto/ancho) × 0.5`, donde `0.5` es la
> relación ancho/alto de una celda de texto mono), y mapear el brillo medio de cada celda contra
> la rampa de 10 caracteres.

Resolución elegida: **90 columnas**. La versión de 140 tiene la curva más suave, pero a tamaño
de hero obliga a un `font-size` tan pequeño que el carácter deja de leerse como carácter — y el
punto entero del recurso es que se vea que son caracteres.

Va detrás del titular, atenuado, para que "Lumi Mini" se lea limpio encima. Sin `aria`: es
decoración, y un lector de pantalla leyendo 3.000 caracteres de rampa ASCII es hostil.

## 2. Secuencia: servidor → pinza → Mac mini

Tres beats, encadenados por scroll:

1. Una **unidad individual de servidor rack-mount**, centrada. (El modelo de origen es un
   armario completo con muchas unidades, tornillos y cables; se extrae una sola unidad — un
   armario entero apretado por una mano no se lee como creíble.)
2. Una **mano robótica** entra en cuadro y lo aprieta con dos dedos. El servidor se comprime.
3. Lo que queda en la mano es un **Mac mini**.

### Estética de la escena

La escena renderizada usa la paleta del sitio, no la de los modelos originales:

- Fondo `#0e0f11` (`bg`), el mismo de la página, para que el vídeo funda con ella sin borde.
- Metales en grises fríos neutros. Nada cálido ni saturado.
- Las texturas emisivas que trae el brazo (`LowerArm_emissive`, `UpperArm_emissive`) se retintan
  a **blanco `#e8e8e6`** (`fg`): sin color, igual que el trazo de los iconos. Se descartaron el
  azul `draw` y el ámbar `warning` por arrastrar significado del sistema ("en curso", "sellado")
  que aquí no aplica.
- **Nada de verde**, en ningún elemento de la escena (`DESIGN.md` § Color).
- Luz dramática pero de un solo tono. El degradado de sombreado propio de una superficie 3D es
  inherente al medio y no cuenta como "gradiente decorativo" de los que prohíbe `DESIGN.md`;
  no se añade ningún degradado de color por encima.

### Pipeline de render (offline)

La escena se monta con Three.js **como herramienta, no como parte del sitio**. Vive en
`tools/escena-mini/` y no la toca el build de `web/`:

1. Composición: cargar los tres glTF, extraer la unidad de servidor, encuadrar cámara, montar
   luces e iluminación según la paleta de arriba.
2. Animación: keyframes propios sobre los huesos del pulgar y el índice del rig
   (`Bone.*`, 27 canales disponibles). La animación "Movement" que trae el modelo es un demo
   genérico del autor y no sirve tal cual.
3. Captura: reproducir la línea de tiempo en pasos fijos y guardar un fotograma por paso, en
   headless.
4. Conversión de los fotogramas a WebP.

El número de fotogramas se fija probando: el objetivo es que scrubear a velocidad de lectura no
enseñe saltos. El orden de magnitud esperado es 90–150.

### Integración en la web

**Secuencia de imágenes sobre `<canvas>`, no vídeo.** El scrub por `video.currentTime` es
irregular entre navegadores (el salto entre keyframes se nota, y encodearlo con keyframes densos
para arreglarlo infla el fichero hasta pesar lo mismo que la secuencia). Con una secuencia de
imágenes el fotograma es exacto por construcción, y desaparece todo el ruido de códecs,
`autoplay` y `playsInline`.

La sección se fija mientras dura la secuencia, y el progreso de scroll dentro de esa sección
mapea directamente al índice de fotograma. Los fotogramas se precargan antes de permitir el
scrub; mientras cargan se muestra el primero.

Los fotogramas se commitean en `web/public/`, como pidió el propietario. Presupuesto: la
secuencia entera no debe pasar de **~6 MB**; si se pasa, se baja resolución o número de
fotogramas antes que subir el presupuesto.

### Degradación

- `prefers-reduced-motion`: no se fija la sección ni se scrubea. Se muestra el fotograma final
  (el Mac mini en la mano) como imagen estática y el texto que la acompaña.
- Móvil / conexión lenta: misma imagen estática final, sin descargar la secuencia. El chiste
  visual se sostiene en el fotograma final; lo que se pierde es el desarrollo, no el remate.
- Sin JavaScript: idem, imagen estática.

## Assets y licencias

Los tres modelos son **CC-BY-4.0, uso comercial permitido, atribución obligatoria**:

| Modelo | Autor | Fuente |
|---|---|---|
| Apple Mac Mini M1 | DatSketch | sketchfab.com/3d-models/apple-mac-mini-m1-79f1f864089d423fb06d220fe2085c71 |
| Robotic Prosthetic Arm | Daz (Darren.Hogan) | sketchfab.com/3d-models/robotic-prosthetic-arm-43b482c8526f45709b56434924dc4d3c |
| Server Racking System | wpanayides | sketchfab.com/3d-models/server-racking-system-6fe2cacf836b4aed96c650b286db5486 |

El crédito va en un pie de créditos de la propia página, visible sin interacción. Es el mismo
criterio que ya se aplica a la atribución de Köppen (`registros/geo/LEEME.md`): la licencia
obliga a que el usuario la vea, así que no vale esconderla.

Los `.gltf` de origen no se commitean en `web/` — son insumo del render, no del sitio. Viven
junto a la herramienta, en `tools/escena-mini/modelos/`, con su `license.txt` intacto al lado.

## Riesgos

- **Captura headless**: el paso 3 del pipeline depende de poder renderizar WebGL sin pantalla.
  Si el entorno no lo permite, la alternativa es capturar desde un navegador real conducido por
  script, más lento pero equivalente. No cambia el diseño, solo el tiempo de producción.
- **Presupuesto de peso**: si a 90 fotogramas la secuencia no cabe en ~6 MB con calidad
  aceptable, se recorta el recorrido de la animación (menos fotogramas, más elipsis) antes que
  degradar la imagen hasta que se vea sucia.

## Decisiones tomadas

| Decisión | Por qué |
|---|---|
| Render offline, no WebGL en vivo | Rendimiento predecible; el sitio no carga un runtime 3D para una sola sección |
| Secuencia de imágenes, no `<video>` | El scrub por `currentTime` es irregular entre navegadores |
| Mano robótica, no mano humana con guante | Registro de "máquina precisa", coherente con que Lumi es un sistema automatizado |
| Una unidad de rack, no el armario entero | Un armario completo apretado por una mano no se lee como creíble |
| Emisivo en blanco `fg` | Azul y ámbar arrastran significado del sistema que aquí no aplica |
| ASCII generado una vez y commiteado | El glifo no cambia; un generador sería maquinaria para un asset único |
| 90 columnas y no 140 | A 140 el carácter deja de leerse como carácter, que es el punto del recurso |

Esta página abre una **excepción explícita** a `DESIGN.md`: es el único sitio del proyecto con
3D fotorrealista. Se aprobó a sabiendas, tras plantear la alternativa esquemática (solo trazo,
coherente con los iconos) y descartarla. Queda anotado para que no se lea como deriva accidental
y para que Pro y Vision decidan a conciencia si la heredan.
