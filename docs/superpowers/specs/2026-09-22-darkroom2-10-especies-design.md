# Darkroom 2 · 10 — Especies

Parte de Darkroom 2 (ver `2026-09-22-darkroom2-00-indice-design.md`). Depende del spec 3
(infraestructura de herramientas, incluidas las pistas de región).

## Resumen

Especies identifica fauna y flora visible en una imagen (decisión del brainstorming: fauna y
flora en **una sola herramienta**, porque comparten modelo y la vegetación suele delatar más
que la fauna para geolocalizar) y convierte cada identificación en una **pista de región**
cuando el área de distribución de la especie es lo bastante acotada como para decir algo.

Se registra como `especies`, admite fuentes de tipo `imagen`, y es puramente local: no
necesita ningún servicio externo. Es, junto con Verify Image, la herramienta con menor riesgo
de todo Darkroom 2.

---

## 1. Modelos

Según la investigación (`2026-09-22-darkroom2-investigacion-herramientas.md` §4):

| Papel | Modelo | Licencia | Qué hace |
|---|---|---|---|
| `especies_clasificar` | **BioCLIP 2** ([HF](https://huggingface.co/imageomics/bioclip-2)) | MIT | zero-shot en casi todo el árbol de la vida (animal, planta, hongo); también da hábitat |
| `especies_detectar` | **MegaDetector v6**, variante `MDV6-mit-*` ([github](https://github.com/microsoft/megadetector)) | Código MIT, pesos MIT en esa variante | localiza y recorta cada animal/persona/vehículo antes de clasificar |
| `especies_geofencing` | **SpeciesNet** ([github](https://github.com/google/cameratrapai)) | Apache-2.0 | filtra especies improbables por país/región antes de mostrar candidatos |

BioCLIP 2 es el clasificador principal porque cubre fauna **y** flora con el mismo peso — es
lo que hace viable «una sola herramienta» sin duplicar modelos. MegaDetector se usa solo para
recortar antes de clasificar (mismo patrón de detección-y-elección que Car ID y Objetos,
spec 3 §"detección y recorte", aunque aquí solo aplica a fauna: la vegetación se analiza sobre
la imagen completa o un recorte manual, porque no hay un "detector de plantas" equivalente).
SpeciesNet no sustituye a BioCLIP 2: se usa como filtro geográfico posterior, no como
clasificador — su fuerte es el geofencing, no la cobertura de especies.

Todos entran en `registros/modelos/` con su `sha256`, `licencia_url` y, para BioCLIP 2, sin
`entrenado_hasta` (a diferencia de Verify Image, el árbol de la vida no cambia mes a mes; no
aplica la misma caducidad).

---

## 2. Flujo

1. **Detección** (solo fauna): MegaDetector marca cada animal con un recuadro. El
   investigador elige cuál(es) analizar, igual que en Car ID/Objetos (patrón común del spec 3).
   Si no hay nada que detectar (una foto de vegetación, o un animal que MegaDetector no marcó),
   recorte manual o análisis de la imagen completa.
2. **Clasificación** (BioCLIP 2): sobre cada recorte de animal, y sobre la imagen completa
   para vegetación visible (BioCLIP 2 no distingue de antemano "esto es una planta": clasifica
   contra su taxonomía completa y el resultado con mayor puntuación dice si acertó una especie
   animal o vegetal). Salen varios candidatos por recorte, ordenados por similitud.
3. **Filtro geográfico** (SpeciesNet, opcional): si el caso tiene ya alguna coordenada de
   referencia (una hipótesis de Geolocalización confirmada, o un pin), se usa como pista para
   re-ordenar los candidatos de BioCLIP 2 — no para descartarlos, solo para subir los
   plausibles en esa zona. Sin ninguna coordenada de referencia, este paso se omite y los
   candidatos quedan solo por similitud visual.

---

## 3. El resultado

Un resultado por candidato de especie (fauna) o por observación de vegetación, con esta forma
en `resultados` (spec 2):

- `titulo`: `"Pinus canariensis · pino canario"`, con nombre científico primero (es lo estable)
  y el común entre paréntesis o después, siguiendo la convención de campo.
- `puntuacion`: similitud de BioCLIP 2 [0,1].
- `payload`: `{ reino: "planta"|"animal"|"hongo", rango_distribucion: <GeoJSON o descripción>,
  cosmopolita: bool, recorte_bbox: [...] | null }`.
- `resultado.pista_region = true` **solo si** `cosmopolita == false`. Una especie cosmopolita
  (gorrión común, paloma bravía, diente de león) no aporta nada a la ubicación y no genera
  pista — mostrarla como pista sería ruido puro, y el propio ejemplo del brainstorming (el
  gorrión común) es justo el caso a evitar.

`cosmopolita` se decide con una lista de umbral simple: si el área de distribución conocida
(de GBIF o del propio hábitat que da BioCLIP 2) cubre más de un continente entero, se marca
cosmopolita. Es una heurística declarada como tal en el código, no una verdad biológica
absoluta.

---

## 4. La pista de región

Para cada resultado con `pista_region = true`, el worker manda un `MsgHerramienta::PistaRegion`
(spec 3, Task 3) con:

- `motivo`: `"Pinus canariensis (pino canario) es endémico de Canarias; se planta también en
  climas cálidos del Mediterráneo"` — texto generado a partir de una plantilla + el nombre de
  la especie y su distribución, no por un LLM (evita alucinaciones sobre biología, que aquí no
  hace falta arriesgar: los datos de distribución ya están en la propia base de BioCLIP 2/GBIF).
- `confianza`: derivada de la puntuación de similitud de BioCLIP 2 y de cuán acotada esté el
  área de distribución (una especie endémica de una isla da más confianza como pista que una
  especie de una región amplia como "cuenca mediterránea").
- `geometria`: un polígono simplificado del área de distribución (fuente: GBIF occurrence
  density o el rango que ya da BioCLIP 2/el geomodel de iNaturalist, según cuál esté
  disponible como dato local empaquetado — ver §5). Si solo hay una descripción textual de
  rango sin geometría utilizable, la pista se muestra igualmente en el panel de fuentes con su
  motivo, pero **no se dibuja en el mapa** ni participa en la re-ponderación (spec 3 §4.3
  exige geometría para reponderar; una pista sin geometría es informativa y punto).

Confirmar la pista sigue la regla común (spec 3 §4.3): re-pondera las hipótesis de
Geolocalización del caso, nunca automáticamente.

---

## 5. Datos de distribución empaquetados

A diferencia de las demás herramientas, Especies **no necesita una galería en el Indexer**
(spec 5): las áreas de distribución son datos de referencia estables, no un corpus de
imágenes que crece con el tiempo. Se empaquetan como un dataset ligero en
`registros/geo/especies-rangos.json` (mismo patrón que `registros/geo/lado.json` y
`registros/geo/orto-wms.json`, ya existentes), construido una vez a partir de datos abiertos
de GBIF (rangos de ocurrencia agregados, no observaciones individuales con coordenadas
exactas — evita filtrar ubicaciones de observadores). Licencia de GBIF: CC0/CC-BY según el
dataset agregado que se use, a confirmar antes de empaquetar (mismo criterio de licencia
verificada del spec 3).

---

## 6. Registro en `fuentes.rs`

```rust
Herramienta {
    id: "especies",
    nombre: "Especies",
    tipos: &["imagen"],
    resultado: TipoResultado { coordenadas: false, pista_region: true, fuente_derivada: false },
    requisitos: RequisitosHerramienta {
        nivel_minimo: "mini",
        papel: Some("especies_clasificar"),
        externos_opcionales: &[],
        admite_auditor: true,
    },
},
```

`registros/niveles/mini.json`: `"herramientas": { "especies_clasificar": ["bioclip-2"] }`.
Pro y Vision añaden `especies_detectar` (MegaDetector) y `especies_geofencing` (SpeciesNet)
como papeles adicionales — Mini puede funcionar solo con clasificación directa sobre la imagen
completa, sin detección previa, para mantener su objetivo de 8 GB de VRAM.

---

## 7. El auditor en Especies

Útil sobre todo para descartar identificaciones poco plausibles por contexto: si BioCLIP 2 da
alta similitud a una especie de pez en una foto claramente terrestre, o a una especie tropical
en una imagen con nieve visible, el auditor puede marcar `ProbableFalsoPositivo` cruzando la
especie candidata con lo que describe la propia imagen (recibe como contexto la lista de
candidatos y una descripción breve de la escena, generada por el mismo VLM compartido del
spec 3 — no la imagen en bruto). Como en toda herramienta, requiere calibración vigente para
`especies` antes de activarse; sin ella, `Abstencion`.

---

## 8. Interfaz

En el cajón de la fuente, cada resultado es una fila (no una tarjeta única como Verify Image,
porque aquí sí hay varios candidatos por recorte): nombre científico en cursiva + común,
miniatura del recorte si es fauna, puntuación, y si tiene pista de región, una etiqueta
`⚑ pista de región` que al pulsarla salta al panel de pistas y resalta su área en el mapa. Las
especies cosmopolitas se muestran igual (siguen siendo una identificación válida) pero sin esa
etiqueta.

---

## 9. Lo que este spec no hace

- No identifica individuos de una especie (no es reconocimiento de un animal concreto, solo de
  la especie).
- No construye una galería en el Indexer: usa el dataset de rangos empaquetado (§5).
- No cruza con bases de especies protegidas o en peligro para ningún efecto de cumplimiento
  normativo — es una herramienta de identificación, no de conservación.

## Verificación

Test de la heurística `cosmopolita` (una especie con rango en 3+ continentes se marca
cosmopolita, una endémica de un archipiélago no) y de que una pista sin geometría utilizable
no se envía a re-ponderación. Cierre manual: una foto con un pino canario reconocible da una
pista de región dibujable en el mapa; una foto con un gorrión común da una identificación sin
pista.
