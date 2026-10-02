# Darkroom 2 · 9 — Objetos

Parte de Darkroom 2 (ver `2026-09-22-darkroom2-00-indice-design.md`). Depende del spec 3
(infraestructura de herramientas) y del spec 5 (Indexer: galerías) para la galería local.

## Resumen

Objetos identifica muebles y otros artículos visibles en una imagen (decisión del
brainstorming: la misma mecánica que Car ID, pero para objetos en general, con búsqueda
online) y cumple dos funciones a la vez (opción A, decidida): **identificar y valorar** (qué
es, dónde se vende, a qué precio) y **ubicar** (si el producto solo se vende en un mercado
concreto, es una pista de región).

Se registra como `objeto`, admite fuentes de tipo `imagen`.

---

## 1. Detección y recorte

Mismo patrón compartido del spec 3 (§"detección y recorte", el mismo que usa Car ID y
Especies): un detector open-vocabulary local marca cada objeto reconocible con un recuadro
(mueble, electrodoméstico, decoración, ropa colgada, cualquier artículo delimitable), el
investigador elige cuál(es) analizar, y si el detector no marca el objeto de interés (parcial,
en la sombra, fuera de las clases que el detector conoce), recorte manual.

---

## 2. Identificación local

Sobre cada recorte:

1. **Embedding** con SigLIP 2 o DINOv3 (mismo backbone que decida el spec 5 para
   consistencia de galerías entre herramientas).
2. **Descripción por VLM local** (servicio compartido del spec 3): una frase corta,
   estructurada, del tipo `{ categoria: "mueble", subtipo: "aparador", estilo: "escandinavo
   midcentury", material: "madera de teca", color: "marrón claro", marca_visible: null }`. El
   VLM no inventa una marca si no hay ningún logo o etiqueta legible en la imagen — el campo
   queda `null`, nunca una suposición.
3. **Búsqueda en galería local** (spec 5, Indexer): si el operador ha construido una galería
   de productos (a partir de feeds de afiliados/catálogo, la vía legalmente más limpia según
   la investigación — ver spec 5), se busca el objeto por vecino más cercano en Qdrant. Un
   acierto de galería da un producto concreto identificado (marca y modelo del catálogo), no
   solo una descripción genérica.

---

## 3. Búsqueda externa (reverso de imagen)

Si la galería local no encuentra nada con suficiente similitud, o el investigador lo pide
explícitamente, Objetos ofrece una búsqueda por reverso de imagen vía **SerpApi** (`engine:
google_lens`, según la investigación — Bing Visual Search está retirado desde agosto de 2025 y
Yandex no tiene API oficial), como servicio externo del spec 3 (`externos::registro`, id
`serpapi_lens`, adaptador **activo=false**: es una consulta pasiva de reverso de imagen, no
toca ninguna cuenta ni deja rastro accionable en un tercero más allá de la propia consulta a
Google a través de SerpApi).

- Se manda el **recorte**, no la imagen completa del caso, para minimizar lo que sale del
  servidor (spec general: local por defecto, lo externo explícito y acotado a lo necesario).
- La respuesta de SerpApi (`products`, `exact_matches`, `visual_matches`, con precio y stock
  según la investigación) se guarda en `payload`, con la entrada de auditoría (spec 3 §3.2)
  registrando el hash del recorte enviado, no el hash de la imagen original completa —así la
  bitácora refleja exactamente lo que salió del servidor.

---

## 4. El resultado

Un resultado por objeto identificado (recorte), con:

- `titulo`: el nombre de producto si la galería o Lens lo dieron (`"Aparador Ekenäset, IKEA"`),
  o la descripción del VLM si no (`"Aparador escandinavo, madera de teca"`).
- `puntuacion`: similitud de galería, o la puntuación de "exact match" de Lens si viene de ahí;
  `null` si solo hay descripción sin ningún match.
- `resultado.coordenadas = false` (a diferencia de Car ID, un mueble no lleva matrícula ni
  identificador único — no hay "este objeto exacto" salvo que tenga un número de serie
  legible, que se trataría como un campo del VLM, no como una nueva capacidad).
- `resultado.fuente_derivada = true`: si el objeto identificado tiene un mercado propio con
  búsqueda (§5), el resultado puede promoverse a una fuente de tipo `producto` para abrir el
  panel de mercado como una fuente independiente y guardable, siguiendo el mismo patrón
  «Crear fuente a partir de esto» que el resto de Darkroom 2 (spec 2 §3.10).
- `payload`: `{ categoria, subtipo, estilo, material, color, marca_visible, galeria_match,
  lens_match, mercado_pais }`.

---

## 5. Panel de mercado

Igual que el panel de mercado de Car ID (spec 6, no redactado — pero el componente en sí es
compartido, spec 3 §"mercado": anuncios con filtros): filtrable por **proveedor, precio y
zona/país** cuando la búsqueda externa (§3) o la galería devuelven varios anuncios o listados
del mismo producto o de productos muy similares. Este panel no busca "este objeto en concreto
apareció en venta" (a diferencia del cruce por matrícula de Car ID, que es exacto): busca
"dónde se vende esto o algo equivalente", que es información de valoración, no de
localización de un objeto físico específico.

---

## 6. La pista de región

Es la parte nueva que Objetos añade frente a Car ID (decisión A del brainstorming: identificar
y ubicar). Si el producto identificado (por galería o por Lens) **solo se vende en un mercado
concreto** — una cadena de tiendas nacional, una marca que no distribuye fuera de un país o
una región — eso es una pista:

- `motivo`: `"Este modelo de aparador es de una cadena de mobiliario que solo opera en
  Polonia"`, generado a partir de metadatos del producto (país/región de venta que trae el
  catálogo o el propio resultado de Lens en `mercado_pais`), no inventado por el VLM.
- `confianza`: alta si la cadena es de distribución claramente local (una sola web de venta,
  un solo país en los resultados de Lens); baja o **sin pista** si el producto se vende en
  cadenas internacionales (una silla de una marca global no dice nada de la ubicación, igual
  que un gorrión común en Especies no dice nada de la especie).
- `geometria`: el país o región de distribución, como polígono simplificado (mismo formato
  GeoJSON del resto de pistas de región, spec 3 §4.3).

La heurística de "cuántos mercados distintos aparecen en los resultados" decide si se genera
la pista, igual que la heurística `cosmopolita` de Especies decide si NO se genera: menos de
2 países distintos entre todos los resultados de venta → se genera pista; 2 o más → no se
genera (es una distribución demasiado amplia para acotar nada).

---

## 7. Registro en `fuentes.rs`

```rust
Herramienta {
    id: "objeto",
    nombre: "Objetos",
    tipos: &["imagen"],
    resultado: TipoResultado { coordenadas: false, pista_region: true, fuente_derivada: true },
    requisitos: RequisitosHerramienta {
        nivel_minimo: "pro",
        papel: Some("objeto_identificar"),
        externos_opcionales: &["serpapi_lens"],
        admite_auditor: true,
    },
},
```

`registros/niveles/pro.json` gana `"herramientas": { "objeto_identificar": ["siglip2-base"] }`
más el papel de detección compartido con Especies/Car ID
(`"objeto_detectar": ["<detector-open-vocab>"]`, mismo modelo si el spec 5/6 ya lo introdujo —
se reutiliza el papel, no se duplica el modelo).

---

## 8. El auditor en Objetos

Contrasta la descripción del VLM con el match de galería/Lens: si el VLM describe "silla de
oficina de plástico negro" pero la galería devuelve como mejor candidato una silla de comedor
de madera, es una discrepancia clara para `ProbableFalsoPositivo`. También revisa la
plausibilidad de una pista de región antes de mostrarla con alta confianza: un solo resultado
de Lens en un país no es tan fiable como una galería local con procedencia declarada.

---

## 9. Lo que este spec no hace

- No construye la galería de productos (spec 5).
- No compra ni reserva nada: el panel de mercado es de consulta y comparación, no ejecuta
  ninguna acción sobre las webs de terceros.
- No identifica objetos con número de serie único como si fueran un identificador exacto
  (a diferencia de la matrícula de un coche): un mueble sin marca visible no se puede
  individualizar más allá de "este modelo, aproximadamente esta partida de producción".
- No cruza con bases de datos de objetos robados ni ningún registro policial — es
  identificación y valoración de mercado, no verificación de procedencia legal del objeto.

## Verificación

Test de la heurística de generación de pista (menos de 2 países en los resultados de venta →
pista; 2 o más → sin pista) y de que la búsqueda externa (§3) manda el hash del recorte y no
el de la imagen original a la bitácora. Cierre manual: un mueble de una cadena claramente
nacional en la imagen de prueba produce una pista de región dibujable; un objeto genérico
vendido en catálogos internacionales no la produce.
