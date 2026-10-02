# Darkroom 2 · 6 — Car ID

Parte de Darkroom 2 (ver `2026-09-22-darkroom2-00-indice-design.md`). Depende del spec 3
(infraestructura de herramientas) y del spec 5 (Indexer: galerías) para la galería de vehículos.

## Resumen

Car ID identifica vehículos visibles en una imagen: marca, modelo, año aproximado, color y
tipo de carrocería. Sobre cada vehículo detectado hace tres cosas más:

1. **Lee la matrícula** que aparezca en la foto (OCR/ALPR) y la muestra como un atributo más
   del vehículo, junto con el país que delata su formato.
2. **Valora el modelo en el mercado**: dónde se vende ese modelo y a qué precio, filtrable por
   zona, proveedor y precio — valoración del *modelo*, no de un coche concreto.
3. **Produce una pista de región** cuando el modelo o el formato de la matrícula acota una zona.

Se registra como `car_id`, admite fuentes de tipo `imagen`.

**Alcance deliberado (decisión del dueño, 2026-09-22).** La matrícula se **lee y se muestra**,
nunca se **consulta** contra ninguna base de datos. Car ID no resuelve una matrícula a un
titular, a un anuncio de venta de *ese coche concreto*, ni a los datos del vehículo en la DGT o
cualquier otro registro. Ese paso, si algún día un investigador lo necesita, es manual y fuera
de Lumi, exactamente igual que el cruce con catastro que Interiores tampoco automatiza (spec 8
§6). El sistema de OSINT que se barajó en rondas anteriores queda **eliminado por completo** de
Darkroom 2 (ver índice §1).

---

## 1. Detección y recorte

Mismo patrón compartido del spec 3 (§"detección y recorte", el que usan Objetos y Especies): un
detector local marca cada vehículo reconocible con un recuadro (coche, furgoneta, moto, camión),
el investigador elige cuál(es) analizar, y si el detector no marca el vehículo de interés
(parcial, en la sombra, un ángulo raro), recorte manual.

Sobre cada recorte de vehículo, además, un segundo paso de detección busca la **zona de la
matrícula** dentro del recuadro del coche, para poder pasarle solo esa región al OCR (§3) en vez
de la foto entera.

---

## 2. Reconocimiento del vehículo

Sobre cada recorte:

1. **Embedding** con el mismo backbone general que decida el spec 5 para consistencia de
   galerías entre herramientas (SigLIP 2 o DINOv3).
2. **Descripción estructurada por VLM local** (servicio compartido del spec 3): `{ tipo:
   "coche", carroceria: "familiar", marca: "Volkswagen" | null, modelo: "Golf" | null, año_aprox:
   "2015-2019" | null, color: "gris antracita" }`. El VLM no inventa una marca ni un modelo si
   no hay logo, forma característica o rótulo suficiente — el campo queda `null`, como en Objetos.
3. **Búsqueda en galería local de vehículos** (spec 5, Indexer): si el operador ha construido
   una galería de vehículos (orígenes decididos en el spec 5: Wikimedia Commons, carpeta local
   del operador, salas de prensa de fabricantes, Openverse, búsqueda de imágenes SERP; Flickr
   descartado), se busca el coche por vecino más cercano en Qdrant. Un acierto de galería da un
   modelo concreto con procedencia declarada, más fiable que la sola inferencia del VLM. Sin
   galería instalada, el reconocimiento se queda en lo que da el VLM, y la matriz de capacidades
   (spec 3 §1.2) lo refleja con el motivo «sin galería de vehículos», igual que Interiores.

---

## 3. Lectura de la matrícula

Sobre la región de matrícula detectada en §1:

- **OCR/ALPR local**: según la investigación (`2026-09-22-darkroom2-investigacion-herramientas.md`
  §2), `fast-alpr` + `fast-plate-ocr` (pesos abiertos, ejecución local, sin red) cubren el caso.
  Papel `matricula_ocr` en el registro de niveles.
- El resultado es **texto**: la cadena leída (`"1234 BCD"`) con su confianza de OCR, más el
  **país/región que delata el formato** de la placa (band azul UE + letras, formato español
  actual; matrícula amarilla británica; etc.), cruzado contra una tabla de formatos empaquetada
  `registros/geo/matriculas-formato.json` (mismo patrón de datos-no-código que
  `registros/geo/lado.json`). El formato lo decide la tabla, no el VLM.
- La matrícula leída se guarda en el `payload` del resultado y se muestra en el cajón de la
  fuente como un atributo del vehículo. **No se lanza ninguna consulta con ella.** No hay botón
  de «buscar titular» ni «buscar este coche en venta»: la cadena está ahí para que el
  investigador la lea, la copie y actúe fuera de Lumi si su marco legal se lo permite.
- Si el investigador quiere tratar la matrícula como una entidad propia (por ejemplo, para
  anotarla o fijarla), puede usar «Crear fuente a partir de esto» (spec 2 §3.10), que crea una
  fuente de tipo `matricula` **de tipo nota/anotación**: una fuente que solo guarda el valor y su
  procedencia (`derivada_de`), sin ninguna herramienta que la consulte automáticamente. Es
  trazabilidad, no una búsqueda.

---

## 4. El resultado

Un resultado por vehículo identificado (recorte), con:

- `titulo`: el modelo si la galería o el VLM lo dieron (`"Volkswagen Golf VII (2015-2019)"`), o la
  descripción genérica si no (`"Coche familiar gris, marca no determinada"`).
- `puntuacion`: similitud de galería, o `null` si solo hay descripción del VLM sin match.
- `resultado.coordenadas = false`: un coche no es un lugar. Car ID identifica y valora; ubicar es
  cosa de la pista de región (§6) o de que el investigador cruce el resultado con otras fuentes.
- `resultado.fuente_derivada = true`: el resultado puede promoverse a una fuente de tipo
  `producto` para abrir el panel de mercado (§5) como fuente independiente y guardable, mismo
  patrón que Objetos.
- `resultado.pista_region = true` cuando §6 la genera.
- `payload`: `{ tipo, carroceria, marca, modelo, año_aprox, color, matricula: { texto, confianza,
  formato_pais } | null, galeria_match, mercado_pais }`.

---

## 5. Panel de mercado

El mismo componente compartido del spec 3 (§"mercado": anuncios con filtros), idéntico al panel
de Objetos: filtrable por **proveedor, precio y zona/país**, poblado a partir de la galería local
(anuncios que el operador haya indexado en el spec 5) o de la descripción del modelo. Muestra
«dónde se vende este modelo y por cuánto», que es información de **valoración del modelo**, no la
localización de un coche físico concreto.

- La distinción es la misma que en Objetos: este panel **no** busca «este coche exacto está a la
  venta». No hay cruce por matrícula (que sería exacto e individualizante, y es justo lo que este
  spec no hace). Busca modelos iguales o equivalentes para dar un rango de precio y de mercado.
- Si el spec 5 no ha traído anuncios a la galería, el panel muestra solo lo que el reconocimiento
  dé del modelo, con el motivo «sin anuncios indexados» — nunca sale a un portal en vivo por su
  cuenta. Cualquier consulta externa (p. ej. reverso de imagen del recorte del coche vía SerpApi,
  el mismo `serpapi_lens` que Objetos) es un servicio externo del spec 3, deshabilitado por
  defecto, y manda solo el recorte, con su entrada en la Actividad del caso.

---

## 6. La pista de región

Dos fuentes posibles de pista, ambas por el mecanismo común (spec 3 §4.3, re-pondera solo al
confirmar):

- **Por formato de matrícula**: si §3 leyó una matrícula y su formato apunta a un país o región
  concreta, es una pista directa y de confianza relativamente alta (el formato de placa es un
  dato estructurado, no una inferencia visual). `motivo`: `"Matrícula con formato español actual
  (banda azul UE + 4 dígitos + 3 letras)"`.
- **Por distribución del modelo**: mismo heurístico que Objetos. Si el modelo identificado solo se
  vende o circula en un mercado concreto (un modelo que un fabricante no exporta, una versión
  regional), es una pista; si es un modelo global, no. La heurística de «cuántos países aparecen
  en los resultados de mercado» decide: menos de 2 países → pista; 2 o más → sin pista.

`geometria`: el país o región, como polígono simplificado (mismo formato GeoJSON del resto de
pistas, spec 3 §4.3). Si una pista no tiene geometría utilizable (solo texto), se muestra en el
panel pero no se dibuja ni participa en la re-ponderación, igual que en Especies.

---

## 7. Registro en `fuentes.rs`

```rust
Herramienta {
    id: "car_id",
    nombre: "Car ID",
    tipos: &["imagen"],
    resultado: TipoResultado { coordenadas: false, pista_region: true, fuente_derivada: true },
    requisitos: RequisitosHerramienta {
        nivel_minimo: "pro",
        papel: Some("car_id"),
        externos_opcionales: &["serpapi_lens"],
        admite_auditor: true,
    },
},
```

`registros/niveles/pro.json` gana
`"herramientas": { "car_id": ["siglip2-base"], "matricula_ocr": ["fast-alpr", "fast-plate-ocr"] }`
más el papel de detección compartido con Objetos/Especies
(`"objeto_detectar": ["<detector-open-vocab>"]`, mismo modelo, no se duplica). El OCR de matrícula
es su propio papel para poder deshabilitarlo por VRAM o por decisión del operador sin perder el
reconocimiento del vehículo: sin `matricula_ocr`, Car ID sigue reconociendo el coche y el campo
`matricula` queda `null` con el motivo en la matriz de capacidades.

---

## 8. El auditor en Car ID

Contrasta el reconocimiento del VLM con el match de galería (igual que Objetos): si el VLM dice
«furgoneta blanca» y la galería devuelve como mejor candidato un deportivo, discrepancia clara
para `ProbableFalsoPositivo`. También revisa la plausibilidad de la lectura de matrícula: una
cadena con confianza de OCR baja o con caracteres imposibles para el formato detectado se marca
`NoConcluyente` en vez de mostrarse como un dato firme. Como en toda herramienta, requiere
calibración vigente para `car_id`; sin ella, `Abstencion`.

---

## 9. Lo que este spec no hace

- **No resuelve la matrícula.** No la consulta contra la DGT, ni contra ningún registro de
  titulares, ni contra portales de venta para encontrar *ese coche concreto*. La lee, muestra el
  texto y el país del formato, y ahí termina. El paso a titular o a un anuncio específico es
  manual y fuera de Lumi.
- No construye la galería de vehículos (spec 5).
- No compra ni reserva nada: el panel de mercado es de consulta y comparación de modelos.
- No individualiza un vehículo por número de bastidor/VIN como identificador exacto: si un VIN
  fuera legible en la foto, sería un campo más del VLM, no una nueva capacidad de cruce.
- No cruza con bases de vehículos robados ni ningún registro policial — es reconocimiento y
  valoración de mercado, no verificación de procedencia legal del vehículo.

## Verificación

Test de la tabla de formatos de matrícula (una placa con formato español produce pista de país
España; una cadena que no encaja en ningún formato conocido produce lectura sin pista de formato)
y de que el reconocimiento del vehículo funciona sin galería instalada (reporta el estado
correcto sin intentar consultar Qdrant). Test de que en ningún camino de código la cadena de
matrícula se usa como parámetro de una consulta externa (revisión de que `matricula.texto` solo
llega a `payload` y a la interfaz, nunca a `externos::enviar`). Cierre manual: una foto de un
coche con matrícula legible produce marca/modelo/color, la cadena de la matrícula, el país de su
formato y (si el modelo es regional) una pista de región dibujable; ninguna acción de la
interfaz lanza una búsqueda con la matrícula.
