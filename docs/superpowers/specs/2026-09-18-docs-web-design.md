# Documentación técnica en la web (`/docs`)

Mockups: [`2026-09-18-docs-web-mockups.html`](2026-09-18-docs-web-mockups.html) — cinco pantallas
(portada, página de «Cómo funciona», página de tecnología, buscador, móvil) con los tokens reales
de DESIGN.md. Los recuentos de páginas que aparecen dibujados en la portada del mockup se pusieron
a ojo; los buenos son los de §5, contados sobre `registros/`.

## Por qué

Hoy la explicación de cómo funciona Lumi vive repartida entre `ARCHITECTURE.md` (547 líneas,
densas, escritas para quien ya trabaja en el repo), sesenta specs de diseño en
`docs/superpowers/specs/` y comentarios dentro del código. Nada de eso es legible para alguien que
llega de fuera, y no hay ni una línea publicada sobre cómo desplegar el daemon o compilar el
proyecto a mano. La web (`web/`, subsistema 9) tiene landing, páginas por nivel, mapa de cobertura
y el instalador, pero no documentación.

Falta además algo que ninguna de esas fuentes da: **explicar las tecnologías implicadas**. El
proyecto monta RoMa, SALAD, DINOv2, Qwen3-VL, Qdrant y una docena más, y hoy el único sitio donde
se dice qué hace cada una es el propio `registros/` —que es un catálogo de datos, no una
explicación— y la nota suelta dentro de algún JSON.

## Alcance

Se construye el chasis de `/docs` y se escriben **dos ramas completas**: «Cómo funciona» y «Las
tecnologías». Las otras tres ramas existen en el árbol de navegación con sus páginas nombradas y
marcadas como pendientes.

Treinta y una páginas de contenido no caben en un solo plan de implementación, así que la entrega
va en **dos fases**, cada una con su propio plan:

- **Fase 1 — el chasis.** Ruta, layout, árbol, sistema de página, los cuatro grupos de detalle,
  buscador, los cinco esquemas del núcleo, y las páginas suficientes para estrenarlos de verdad:
  «el viaje de una foto», «recuperación: los candidatos», «verificación: la geometría», «agentes:
  lo que se ve en la foto», «el veredicto y su confianza» y «RoMa».
- **Fase 2 — el contenido.** Las páginas restantes de las dos ramas, los cinco esquemas de segunda
  tanda y la mudanza de `ARCHITECTURE.md`.

Este spec describe las dos fases porque las decisiones de estructura sólo tienen sentido vistas
enteras. El plan de implementación que sigue cubre la fase 1.

### Fuera de alcance

- Las ramas «Empezar», «Indexar territorio» y «El repo por dentro». Existen en el árbol, marcadas
  como pendientes. Un hueco declarado es una promesa; un hueco oculto es una omisión.
- Traducción a otro idioma. El sitio es en castellano, como el resto del repo.
- Versionar la documentación por versión de producto. Hay una sola: la de la rama actual.
- Comentarios, analítica o buscador con servicio externo.
- Generar referencia de API automáticamente desde el código. Es otro proyecto.

---

## 1 · Chasis y navegación

`/docs` es un subsitio con su propio marco, no una página más de la landing. La landing es scroll
cinematográfico —`IndicadorSecciones` flotando, `TransicionPagina` animando la entrada, `Pie`
largo—; nada de eso sirve para leer documentación.

- `web/app/docs/layout.tsx` monta el marco propio.
- `IndicadorSecciones` deja de renderizarse bajo `/docs`. Hoy está en el layout raíz sin
  condición: pasa a comprobar la ruta.
- `Nav` gana una entrada «Docs» entre «Indexado» y «Sobre mí». El resto del `Nav` y el `Pie` no
  cambian.

**Tres columnas:** árbol de secciones (250 px, izquierda) · contenido (640 px, centrado) · índice
de la página (210 px, derecha, con resaltado del encabezado en pantalla). El ancho de lectura es
640 y no los 720 de las páginas de nivel: con texto largo y continuado, 720 se pasa de línea
cómoda.

**En móvil** (< 900 px) el árbol pasa a un desplegable bajo una barra de ruta y el índice derecho
desaparece.

**Rutas.** `/docs` es una portada corta que presenta las cinco ramas —no un índice de cuarenta
enlaces—, y cada página vive en `/docs/<rama>/<pagina>`. Las cinco ramas, en este orden:

| Rama | Ruta | Estado |
|---|---|---|
| Cómo funciona | `/docs/como-funciona/…` | se escribe entera |
| Las tecnologías | `/docs/tecnologias/…` | se escribe entera |
| Empezar | `/docs/empezar/…` | pendiente |
| Indexar territorio | `/docs/indexar/…` | pendiente |
| El repo por dentro | `/docs/repo/…` | pendiente |

---

## 2 · El sistema de página

### Sustrato

Cada página es un `app/docs/<rama>/<pagina>/page.mdx`. Next 15 renderiza `page.mdx` de forma nativa
con `@next/mdx`, así que la ruta es la carpeta: no hace falta ruta dinámica ni compilar en
petición, y todo sale estático. Una carpeta de contenido aparte obligaría a escribir un
`[...ruta]` y un compilador propio para no ganar nada.

Sigue siendo un fichero de texto versionado: se edita con un editor, se busca con `grep`, se lee en
el diff.

Dependencia nueva: `@next/mdx` (y sus `@mdx-js/*`). Ninguna más.

### El árbol

Vive en `web/lib/arbolDocs.ts`, escrito a mano. **No se deduce de las carpetas**: el orden
alfabético pondría «emparejar» después de «actualizar», y la documentación tiene un orden de
lectura que no es el del abecedario. Ese fichero declara, por rama: título, glifo, y la lista
ordenada de páginas con su título, su ruta y si está pendiente.

Es también la fuente del anterior/siguiente del pie y del orden del buscador.

### Forma de una página

Toda página se abre igual:

1. Migaja (rama, y para tecnologías también el tipo).
2. Título.
3. **Una sola frase** que dice qué es esto en lenguaje llano, sin jerga. Obligatoria.
4. El esquema, si la página tiene uno.
5. La profundidad.

Esa es la respuesta a «fácil de entender pero técnico»: no se escribe un texto intermedio que no
sirva a nadie, se escribe el fácil arriba y el denso debajo. Los números exactos, los nombres de
fichero y las decisiones de implementación van en bloques `<Detalle>` plegados, **titulados por lo
que contienen** («los números exactos», «qué hace esto en el código», «por qué no se descarga
solo»), para que quien lee por encima no tropiece con ellos y quien busca precisión sepa dónde
mirar. Tipográficos: sin cajas de color ni iconos decorativos.

La frase de apertura no es sólo estilo — es el dato que alimenta las previsualizaciones al pasar
el ratón (§3 D) y el buscador. Una página sin frase es un fallo de build.

### Componentes de contenido

Cada uno con una sola razón de existir, en `web/components/docs/`:

| Componente | Qué hace |
|---|---|
| `<Detalle titulo>` | Bloque plegable con la parte densa. |
| `<Tec id>` | Enlace a una página de tecnología tomando el nombre del registro. Un id inexistente rompe el build. |
| `<Dato de campo>` | Imprime un valor leído de `registros/`, no tecleado. |
| `<Codigo anotaciones>` | Bloque de código en mono con botón de copiar y anotaciones numeradas. |
| `<Ficha id>` | La tabla de procedencia de una tecnología, generada del registro. |
| `<Esquema>` | Contenedor común de los esquemas: etiqueta, marco, y respeto a `prefers-reduced-motion`. |

### Buscador

Índice JSON generado en el build a partir de los `.mdx` —título, rama, ruta, encabezados, frase de
apertura y primer párrafo de cada sección—, y filtro en cliente sobre él. Se abre con `⌘K` / `Ctrl+K`
y desde la caja del árbol. Resultados agrupados por rama. Sin servicio externo.

**Un solo artefacto alimenta tres cosas**: el buscador, las previsualizaciones al pasar el ratón y
el anterior/siguiente del pie. Nada se escribe dos veces y una página nueva aparece en las tres a
la vez.

Mecánica concreta: `web/scripts/indice-docs.mjs` recorre `app/docs/**/page.mdx` y escribe
`web/lib/indiceDocs.json`. Se engancha como `predev` y `prebuild` en `web/package.json`, y el
fichero generado va a `.gitignore` — es derivado, no fuente. El mismo script hace las tres
validaciones que el spec da por hechas y **falla el build** si alguna no se cumple: toda página
tiene frase de apertura, todo `<Tec id>` apunta a una tecnología existente, y toda ruta del árbol
tiene su `.mdx` salvo las marcadas como pendientes.

Ese script es también el único punto que lee fuera de `web/`: `registros/` vive en la raíz del
repo, así que el generador copia a `web/lib/` los campos que las fichas y los `<Dato>` necesitan.
En tiempo de ejecución nada sale de `web/`.

---

## 3 · Los cuatro grupos de detalle

Lo que hace que unas docs parezcan profesionales casi nunca es más adorno: es prueba.

### A · Procedencia y frescura

- **Pie de procedencia** en cada página: los ficheros del repo contra los que está escrita
  (`crates/lumid/src/recuperar.rs`, `registros/verificadores/roma.json`), en mono, enlazados a
  GitHub.
- **Fecha real**: el último commit que tocó ese `.mdx`, leído de git en el build. No escrita a mano.
- **Símbolos enlazados**: `lumi_index::agrupar` en el texto enlaza **al fichero, no a una línea**.
  Un número de línea en la documentación queda mal al primer commit y nadie se entera.
- **Cifras vivas**: los valores que aparecen en la prosa —las dimensiones de un modelo, su licencia,
  qué niveles lo usan— se declaran con `<Dato>` y se leen de `registros/**/*.json`. Cambiar el valor
  en el registro lo cambia en la documentación. **Sólo del registro**: extraer constantes de fuentes
  Rust o Python en tiempo de build sería un analizador propio a cambio de poco, así que para esos
  valores (el puerto 7717, `limit=200`) la garantía es el aviso de página envejecida de abajo, no
  `<Dato>`.
- **Aviso de página envejecida**: si un fichero citado en el pie de procedencia tiene un commit
  posterior a la última modificación del `.mdx`, el build lo anota y la página lo muestra: «el
  código que describe esta página ha cambiado desde la última revisión». No falla el build —una
  documentación que no se puede publicar por estar un día desfasada no se publica nunca—, pero se
  delata sola.

### B · Oficio de lectura

- **«Leer en profundidad»**: un único control arriba a la derecha que abre o cierra todos los
  `<Detalle>` de la página a la vez. Dos lecturas del mismo texto, no un texto intermedio.
- **Permalink** al pasar sobre cada encabezado.
- **Anotaciones numeradas** sobre líneas concretas de los bloques de código, explicadas debajo.
- **Anterior / siguiente** al pie, con los títulos reales del árbol, para que una rama se lea de
  principio a fin como un libro.

### C · Firma visual

- **Un glifo de trazo por rama** —cinco, dibujados a mano siguiendo el patrón de iconos de
  DESIGN.md (`viewBox="0 0 24 24"`, `fill="none"`, `stroke="currentColor"`)—: pequeño junto al
  nombre de la rama en el árbol, y grande y muy tenue tras la cabecera de su portada.
- **Micro-tipografía castellana** en todo el contenido: comillas latinas, rayas de inciso,
  numerales tabulares en tablas y cifras.

### D · Referencias con previsualización

Cualquier enlace interno —`<Tec>`, una referencia a otra página, una mención a una etapa del
viaje— muestra al pasar el ratón una tarjeta con el título, la rama y la **frase de apertura** de
la página referida; en tecnologías, además, el tipo y si está activa o es alternativa. Al pulsar,
navega.

Retardo de 350 ms para que no salte al cruzar el cursor. En táctil no hay hover: el enlace navega
y ya. Los datos salen de `indiceDocs.json`, así que no hay petición en tiempo de ejecución.

---

## 4 · Los esquemas

**Regla que acota el gasto: un esquema por idea que no se puede explicar en un párrafo.** No uno
por página. Si un dibujo repite lo que dice el texto de al lado, sobra.

Cada esquema es su propio fichero en `web/components/docs/esquemas/`, componente de cliente sobre
una página que sigue siendo estática.

**Condiciones comunes:**

- Con `prefers-reduced-motion: reduce` la animación no arranca y el esquema se renderiza en su
  estado final.
- **Ningún esquema transmite información sólo con movimiento.** Congelado, tiene que seguir
  leyéndose entero. El pulso del viaje dice «esto fluye»; no dice ningún dato.
- Los que muestran cifras las leen del registro, no las llevan escritas.

### Los cinco del núcleo (fase 1)

| Esquema | Qué idea carga | Interacción |
|---|---|---|
| **El viaje de una foto** | Las cinco etapas y que ninguna adivina | El pulso las recorre; cada etapa se abre al pulsarla. Hace de esquema y de índice de la rama. |
| **El espacio de vectores** | Que «parecido de píxeles» y «parecido de lugar» no son lo mismo | Señalas tu foto y se encienden sus vecinos; un conmutador cambia entre los dos espacios. |
| **Emparejamiento denso vs. por puntos** | Qué es una correspondencia y qué es un umbral | Deslizador de umbral; las descartadas quedan en punteado tenue, no desaparecen. Reutilizado en RoMa y en LightGlue + ALIKED. |
| **Un agente por dentro** | Pregunta, verbalizadores y confianza por softmax | Cambiar la imagen de ejemplo cambia las barras. |
| **Cómo se forma la confianza final** | Que un agente **no descarta, sólo penaliza** | Mover el peso de un agente reordena las hipótesis; ninguna llega nunca a cero. |

### Los cinco de segunda tanda (fase 2)

Grafo HNSW con el camino de descenso dibujándose y contador de vectores visitados · rejilla de
teselas z14 con `quadkey` al pasar por encima · los tres niveles como tres configuraciones del
mismo carril (uno, varios en cadena, varios compitiendo) · la cola con un worker por dispositivo y
el orden de planificación · la clave de emparejado descomponiéndose en sus cuatro partes con el
cotejo de huella que aborta si no cuadra.

### Las páginas de tecnología no llevan esquema propio

Veintidós páginas no son veintidós esquemas. Comparten tres piezas parametrizadas por el registro:

- **El emparejamiento**, para los seis verificadores.
- **El espacio de vectores**, para los siete de recuperación.
- **Miniatura del viaje con su etapa encendida**, para todas — baratísima, y le da ancla visual a
  cada página sin dibujar nada nuevo.

Las que no encajan en ninguna (Tauri, SQLite y Redis) se quedan con la ficha y el texto.

---

## 5 · Contenido

### «Cómo funciona» — nueve páginas, en orden de lectura

1. De qué va todo esto
2. El viaje de una foto
3. El índice y la cobertura
4. Recuperación: los candidatos
5. Verificación: la geometría
6. Agentes: lo que se ve en la foto
7. El veredicto y su confianza
8. La cola y el reparto de GPU
9. Confianza y transporte

### «Las tecnologías» — veintidós páginas

Una de «cómo leer estas páginas», más:

- **Verificadores (6):** RoMa · RoMa v2 · tiny-RoMa · EfficientLoFTR · LightGlue + ALIKED (con
  `aliked-n16` dentro) · DINOv2 (backbone, aparte porque lo comparten varios).
- **Recuperación (7):** SALAD · AnyLoc · EigenPlaces · CosPlace · DINO-Mix · CliqueMining · los
  modelos propios (`lumi-2` y `lumi-preview` en una).
- **Motores (4):** Qwen3-VL · Depth-Anything v2 · PaddleOCR · Real-ESRGAN.
- **Infraestructura (4):** Qdrant y HNSW · SQLite y Redis · Tauri · Ed25519 y el emparejado.

Cada una es corta por diseño —una pantalla: frase, ficha del registro, dos o tres párrafos, el
esquema compartido que le toque, y «dónde se usa en Lumi»—. La longitud del trabajo está en el
catálogo, no en cada entrada.

Las que están en el registro pero no se usan hoy (`tiny-roma`, `efficient-loftr`, `cosplace`) se
publican igual, marcadas como **alternativa no activa**: es información, no ruido.

### La ficha de tecnología

Se genera del registro, no se escribe a mano, y cita el fichero del que sale. Campos: tipo,
licencia, fichero de pesos, huella SHA-256, ficheros adicionales si los hay, y estado (activo en
qué niveles, o alternativa no activa). Que cite su origen no es decorativo: es lo que hace
comprobable que esa huella no la tecleó nadie.

---

## 6 · La mudanza de `ARCHITECTURE.md`

`ARCHITECTURE.md` pierde la prosa larga —el recorrido del motor, el desglose de almacenamiento, el
detalle de confianza y transporte— y conserva lo que es índice y no explicación: el mapa del
workspace, la tabla de estado de subsistemas y las convenciones.

Donde había una sección queda **una línea que apunta al `.mdx` por ruta de fichero**, no por URL:

```
Recuperación y candidatos → app/docs/como-funciona/recuperacion/page.mdx
```

Esto importa: CLAUDE.md manda leer `ARCHITECTURE.md` antes de nada para cualquier cosa
transversal, y un agente trabajando en este repo tiene que poder seguir el hilo con `cat`, sin
abrir un navegador. Por eso el contenido vive en ficheros de texto del repo y no en una base de
datos ni en JSX.

`CLAUDE.md` se actualiza en el mismo commit para decir dónde vive ahora la explicación profunda.

Esta mudanza es de la **fase 2**: hasta que las páginas existan, `ARCHITECTURE.md` no se toca.

---

## 7 · Lo que no cambia

- El `Nav` (salvo una entrada más), el `Pie`, la landing y las páginas de nivel.
- Los tokens de DESIGN.md. Tema oscuro único, sin verde, mono para todo dato de máquina, iconos
  SVG a mano. `/docs` no introduce ningún token nuevo.
- El resto de `web/`: `/install`, `/api/versiones`, el catálogo y el panel de admin.
- `registros/` sigue siendo la fuente de los datos de modelos y motores. `/docs` lo lee; no lo
  duplica ni lo sustituye.
