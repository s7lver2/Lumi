# Rediseño de los agentes (5c) — diseño

Reescritura completa del subsistema de agentes. Sustituye al diseño original
(`2026-08-13-agentes-5c-design.md`) y a la fusión de fichas
(`2026-09-10-agentes-editor-media-debug-design.md` §1), que quedan históricos.

## Por qué se reescribe y no se parchea

Los agentes producen dos síntomas opuestos a la vez, y cada uno tiene una causa
distinta en el código:

**Los agentes sueltos se abstienen casi siempre.** `Vlm.responder()` puntúa cada
etiqueta con `labels=entrada["input_ids"]` (`workers/lumi_motores.py:147`), es
decir promediando la pérdida sobre toda la secuencia: plantilla de chat, tokens
de imagen —cientos o miles—, pregunta y etiqueta. La etiqueta son dos o cinco
tokens de esos miles, así que `-loss` sale casi idéntico para todas las
candidatas, el softmax queda plano y con ocho etiquetas ninguna se acerca al
umbral de 0.5. Cuando alguna gana, la decide ruido de la cuarta cifra decimal.
Es el mismo defecto que ya se corrigió dentro de `_puntuar_subrespuesta`
enmascarando el prefijo, pero que nunca se propagó a `responder()`.

**Los agentes fusionados contestan con seguridad cosas falsas**, y esto no es un
fallo de implementación sino del diseño. Se genera un JSON compuesto de una sola
tirada y después se puntúa la confianza reinsertando cada candidata *en ese mismo
JSON que el modelo acaba de escribir*. Eso mide cuánto encaja una etiqueta con lo
que el modelo ya dijo, no cuánto la apoya la fotografía: el modelo se
autoconfirma. Y como ningún conjunto cerrado de etiquetas ofrece una salida del
tipo «no se puede determinar», el modelo está obligado a elegir algo aunque la
pregunta no aplique a la imagen. Un agente que pregunta por matrículas en una
foto de montaña tiene que contestar igualmente.

A eso se suma que **la promesa de «agente = fichero, no código» es falsa hoy**:

- `Ocr.responder()` ramifica con `if agente["id"] == "toponimos"`
  (`workers/lumi_motores.py:374` y `:391`).
- Las etiquetas `"hay texto legible"` (`:344`) y `"sin texto"` (`:359`) se
  fabrican en Python y no existen en ningún registro.
- La tabla `ESCRITURAS` (`:62-73`) declara nombres de escritura que deben
  coincidir literalmente con las etiquetas del JSON del agente.
- `Profundidad.responder` devuelve confianzas fijas de 0.7 y 0.6 según la rama de
  un árbol de reglas con umbrales inventados (`:477-483`).
- La penalización que un veredicto aplica al ranking es una constante de Rust,
  `PENALIZACION = 0.1` (`crates/lumi-index/src/agentes.rs:154`), igual para todos.
- El campo `tipo` de la ficha ya no ramifica nada (`agentes.rs:46-49`).

Y el agente de texto es directamente imposible tal como está: PaddleOCR se
construye con `lang="latin"` (`workers/lumi_motores.py:271`), que carga un
reconocedor capaz de emitir únicamente caracteres latinos, mientras
`_responder_idioma` clasifica por rangos Unicode de cirílico, árabe, thai y
demás. Se clasifica entre escrituras que el reconocedor no puede producir. Para
colmo el agente se llama `idioma` pero clasifica *escritura*, y latino cubre
España, Turquía, Vietnam y Polonia por igual, así que su respuesta más probable
no recorta el mapa. Sus confianzas tampoco miden certeza: en topónimos se
devuelve la media de confianza de reconocimiento del OCR (`:342`), que es «qué
seguro estoy de haber leído bien los píxeles»; en idioma, la proporción de
caracteres de la escritura dominante (`:362`), de modo que un único carácter
reconocido da proporción 1.0.

Por último, el panel de calibración no calibra: los overrides se guardan en
`meta` como `agente_override:<id>` (`crates/lumid/src/routes/calibracion.rs:134-219`)
y nadie los lee. Ni la cola, que relee las fichas del disco, ni
`workers/lumi_agentes.py`, que lee `registros/agentes/` directamente.

## Alcance

Entra: el catálogo de agentes, el formato de sus fichas, el motor que los
ejecuta, cómo se obtiene su confianza, cómo reponderan candidatos, su
presentación en el cliente, y un banco de pruebas con verdad conocida.

Sale del proyecto: PaddleOCR y Depth Anything V2 como motores, con sus fichas,
sus dependencias de instalación y el código que los envuelve.

**Fuera de alcance:**

- Señalar regiones de la imagen (*grounding*). Qwen3-VL sabe devolver
  coordenadas, pero unas coordenadas alucinadas en un informe forense son peores
  que ninguna. La evidencia que se muestra es numérica (§4).
- Cruzar topónimos contra un gazetteer. Sigue en `FUTURO.md`.
- Anotar el corpus con fechas de captura (5d). Sin eso, estación y hora solar no
  pueden filtrar nada, y ese es justamente el motivo de que `estacion`
  desaparezca en §1.
- Internacionalizar la interfaz. Los prompts pasan a inglés por rendimiento del
  modelo (§3), no como paso hacia una UI multiidioma. Lo que lee el investigador
  sigue en español.

## 1. Qué agentes sobreviven

Criterio de admisión: **un agente merece existir si su respuesta cambia la lista
de países o regiones plausibles.** Si no la cambia, o es descripción que el
investigador ya ve mirando la foto, o es ruido con barniz de confianza.

**Señales discriminantes (reponderan el ranking).**

| Agente | Por qué sobrevive |
|---|---|
| `lado-conduccion` | Binaria y observable directamente. Alrededor de un tercio del mundo conduce por la izquierda. |
| `escritura` | Cirílico, árabe, han, thai, devanagari, griego o hebreo recortan el mapa de forma drástica. Reemplaza al mal llamado `idioma`. Es elección única: la escritura dominante en la imagen, no todas las presentes. |
| `toponimos` | Un nombre de calle o de comercio legible es casi una geolocalización directa. |
| `matricula` | Banda azul europea, amarillas británicas y neerlandesas, formato americano por estado. |
| `senalizacion` | Convención de Viena frente a MUTCD. Se admite a prueba: es el que más riesgo tiene de no superar el banco (§6). |
| `vegetacion` | Reformulado: deja de medir densidad («vegetación abundante» no vale nada) y pasa a pedir bioma —palmeras, coníferas, sabana, selva—, que sí discrimina. |

**Observaciones (se muestran, no reponderan).** Son agentes normales con
`peso: 0`; no hacen falta un concepto ni un mecanismo aparte.

| Agente | Por qué no repondera |
|---|---|
| `meteorologia` | La nieve excluye el trópico y poco más. Demasiado débil para mover el ranking. |
| `hora-solar` | Sin conocer la fecha, la sombra no da latitud. Vale para que el investigador lea «esto es mediodía». Sustituye a `hora-sombras`. |

**Eliminados.**

| Agente | Motivo |
|---|---|
| `estacion` | Sin fecha de captura anotada no puede filtrar: «verano» depende del hemisferio y de una fecha que no se tiene. Depende de 5d. |
| `clima-aparente` (Köppen) | Inferir zona Köppen de una fotografía no lo hace de forma fiable ni un experto. Es la receta exacta de la respuesta segura y falsa. |
| `escena` | «Urbano, rural, playa, montaña» no recorta geografía, y no le dice al investigador nada que no esté viendo. |
| `dimensiones` | El propio `# ponytail:` admite que la profundidad monocular no da metros. Sin escala métrica no hay señal geográfica, y devuelve confianzas inventadas por rama. |

Con `clima-aparente` desaparece el único consumidor del dataset Köppen, así que
`koppen.bin`, la restricción `clima_koppen` de `lumi_index::geo` y los ficheros
correspondientes de `registros/geo/` se eliminan. Países y lado de conducción se
mantienen.

## 2. La ficha del agente

La ficha declara todo el comportamiento. **El motor no contiene ni un solo `if`
sobre el id de un agente**; si hace falta uno, es que falta un campo en la ficha.

Se separan tres cosas que hoy están confundidas en una sola cadena: el
**identificador** (estable, para base de datos y código), el **verbalizador** (el
texto exacto que se puntúa contra el modelo) y la **etiqueta visible** (lo que lee
el investigador).

```json
{
  "id": "lado-conduccion",
  "nombre": "Lado de conducción",
  "icono": "volante",
  "modo": "eleccion",
  "pregunta": "Looking at the traffic in this photo, vehicles drive on the",
  "umbral": 0.55,
  "peso": 0.4,
  "opciones": [
    {
      "id": "izquierda",
      "verbalizador": " left side of the road.",
      "visible": "Por la izquierda",
      "paises": ["GB", "IE", "JP", "AU", "IN", "ZA", "NZ", "TH", "ID", "MY"]
    },
    {
      "id": "derecha",
      "verbalizador": " right side of the road.",
      "visible": "Por la derecha",
      "paises": ["ES", "FR", "DE", "IT", "US", "BR", "MX", "PL", "NL", "PT"]
    },
    {
      "id": "indeterminado",
      "verbalizador": " side of the road cannot be determined from this image.",
      "visible": "No se puede determinar",
      "paises": []
    }
  ]
}
```

Campos:

- `modo`: `eleccion` o `transcripcion`. Sustituye al `tipo` muerto y es lo único
  que decide el camino de ejecución (§3 y §5).
- `pregunta`: el prompt, en inglés, redactado para que encadene gramaticalmente
  con cada verbalizador.
- `opciones`: solo en `modo: eleccion`. Cada una con `id` estable,
  `verbalizador`, `visible` y `paises`.
- `indeterminado`: **toda ficha de elección debe incluir una opción con este id**.
  No es un caso especial del motor: es una opción más, con su verbalizador, que
  compite en el mismo softmax. Su `paises` siempre está vacío.
- `umbral`: confianza mínima para no abstenerse.
- `peso`: fuerza con la que el veredicto mueve el ranking, en `[0, 0.9]`.
  Sustituye a la constante `PENALIZACION = 0.1`, que era igual para todos. El
  factor que multiplica la similitud de un candidato contradicho por el veredicto
  es `1 − peso × confianza`: un veredicto poco seguro penaliza poco, y el tope de
  0.9 garantiza que ningún candidato baje de una décima de su similitud, de modo
  que **un agente sigue sin poder descartar nada**. Eso hace innecesario el
  `FACTOR_MINIMO` de hoy. `peso: 0` define una observación: factor 1, sin efecto.
- `icono`: nombre que el cliente resuelve contra su set de SVG (§7).

Desaparecen `sub_preguntas`, `motor` (solo queda uno), `tipo`, `restriccion`,
`mapa` y los ids compuestos con punto. Cada señal es su propia ficha,
independiente y medible por separado.

## 3. Ejecución

**Un solo pase de imagen para todos los agentes.** La imagen se codifica una vez
y su caché de atención se reutiliza en cada pregunta y cada opción. Codificar la
foto cuesta del orden de mil o dos mil tokens; una pregunta ronda los quince y un
verbalizador los ocho. Los ocho agentes del catálogo —siete de elección más la
transcripción— cuestan así menos cómputo que las llamadas independientes de hoy,
aun midiendo cada opción dos veces (§3, con y sin imagen). Este es el
sustituto del ahorro que buscaba la fusión, sin su defecto: **la fusión
desaparece**, y con ella el JSON compuesto, los ids con punto y el aplanado de
`lumi_index::agentes`.

**La confianza sale del contraste, no de la verosimilitud.** Cada opción se mide
dos veces, con imagen y sin ella:

```
evidencia(opción) = log P(verbalizador | imagen, pregunta)
                  − log P(verbalizador | pregunta)

confianza = softmax sobre evidencia(todas las opciones del agente)
```

La primera pasada dice cuánto le gusta esa frase al modelo viendo la foto; la
segunda, cuánto le gusta a ciegas. **Solo cuenta la diferencia.** Si el modelo
contesta «por la derecha» con la misma probabilidad mirando la imagen que sin
verla, no está aportando conocimiento, y eso es exactamente lo que hoy produce
respuestas seguras y falsas.

La resta trae además dos correcciones gratis sobre el scoring actual: cancela el
sesgo de longitud, porque el mismo verbalizador se mide con los mismos tokens en
ambas pasadas, y cancela el sesgo de frecuencia, porque que «derecha» sea una
palabra más común que «izquierda» deja de inclinar el resultado.

La verosimilitud de cada verbalizador es la **suma** de las log-probabilidades de
sus propios tokens, nunca una media sobre la secuencia entera. El prefijo no
entra en el cálculo.

**Dos caminos hacia la abstención**, distintos a propósito:

1. Si la imagen no distingue entre opciones, todas las evidencias quedan cerca de
   cero, el softmax sale plano y la confianza no llega al `umbral`.
2. Si la imagen apoya activamente que no se puede saber —una foto sin un solo
   coche—, gana `indeterminado` por mérito propio.

En ambos casos el veredicto se guarda como abstención, conservando en
`etiqueta_real` la opción que había ganado, como ya se hace hoy.

## 4. La evidencia que ve el investigador

Cada veredicto lleva **dos lecturas y no una**: la confianza (cuál de las
opciones gana) y el apoyo visual (cuánto sube la imagen esa respuesta frente a no
verla). Para un uso forense el segundo importa tanto como el primero: «dice *por
la izquierda* con 0,74, pero la imagen apenas lo respalda» es una advertencia que
hoy no existe, y es precisamente la que habría delatado los resultados falsos.

Se muestran los dos, con palabras y no solo con números, y un veredicto con
confianza alta pero apoyo visual bajo se marca visualmente como poco fiable en
lugar de presentarse igual que uno sólido.

No se dibujan cajas sobre la imagen: sin productor de `rasgos` y sin grounding
(fuera de alcance), la evidencia honesta es la numérica que ya se calcula.

## 5. Transcripción

`modo: transcripcion` (hoy solo `toponimos`) va por generación normal y **sin
número de confianza**. Se muestra el texto leído tal cual y no repondera nada.
Cualquier porcentaje ahí sería inventado: no hay conjunto cerrado sobre el que
normalizar, y la media de confianza de reconocimiento que se usaba antes medía
otra cosa.

## 6. Motor y banco de pruebas

**Un único motor.** Qwen3-VL asume también la lectura de texto, y con ello
desaparecen PaddleOCR —con su `paddlepaddle` clavado a la 2.x porque la 3.x
rehízo la API, y con un fallo propio de runtime en CPU documentado en su
`# ponytail:`— y Depth Anything V2. Se eliminan sus fichas de
`registros/motores/` y sus entradas de instalación en `crates/lumid/src/tasks.rs`.

**Modelo por defecto: `Qwen/Qwen3-VL-8B-Instruct` cuantizado a 4 bits.** Ocupa
unos 5,5 GB frente a los ~8 GB del 4B actual en fp16, así que cabe con más margen
en los 12 GB de la RTX 4070 SUPER del box —margen que hace falta ahora que el VLM
también lee carteles y eso obliga a subir la resolución de entrada, que infla los
tokens de imagen. El 8B es además el más usado de la familia con diferencia.

**El id del motor se lee del registro**, no del nombre de directorio fijo
`"qwen3-vl"` que hay hoy en `workers/lumi_motores.py:110`. Probar 4B contra 8B
pasa a ser editar un JSON y correr el banco.

**El banco de pruebas** es parte del rediseño, no trabajo posterior: sin él
«mejorar los agentes» no es una afirmación comprobable, y es la razón de que este
subsistema haya fallado a ciegas hasta ahora. Consta de un directorio de
fotografías con verdad conocida **fuera del repositorio** (pesan, y no todas son
publicables), un `pruebas/agentes/verdad.json` **dentro** del repositorio que las
referencia por nombre, y el comando `python tools/evaluar_agentes.py <carpeta>`,
que ejecuta todos los agentes sobre todas las fotos y reporta por agente:

| Métrica | Qué responde |
|---|---|
| Acierto condicionado | De las veces que contesta, cuántas acierta |
| Cobertura | En qué fracción de fotos se atreve a contestar |
| Calibración | Cuando dice 0,8, ¿acierta el 80 %? |
| Coste | Segundos por foto |

El banco no solo informa: **un agente que no alcance el mínimo no se activa por
defecto**. El mínimo de partida es acierto condicionado ≥ 0,70 con cobertura
≥ 0,20 — un agente que acierte mucho pero conteste una vez de cada veinte no
aporta, y uno que conteste siempre acertando dos de cada tres es peor que
callarse. Son los dos números que la primera medición completa puede revisar, y
el único sitio donde se tocan. El criterio de admisión de §1, aplicado a mano
aquí, pasa a comprobarse con datos. El banco sustituye además al panel de calibración, que se
elimina junto con la mitad muerta de `crates/lumid/src/routes/calibracion.rs`.

## 7. Cliente

- `AgenteIcono.tsx` deja de elegir el dibujo con una cadena de comparaciones
  contra ids de agente; usa el campo `icono` de la ficha contra su set canónico de
  SVG dibujados a mano. Se elimina también la expresión regular que extraía una
  hora del texto de la etiqueta, innecesaria con la hora como opción cerrada.
- Se elimina el mapa `ETIQUETAS_CORTAS` de `AgentPickerPopup.tsx`: el texto sale
  del campo `visible`.
- La rejilla fija 2×3 del selector pasa a ser dinámica: ya no habrá siempre seis
  agentes.
- Se elimina el render de `rasgos` (cajas de OCR y mapa de profundidad) en
  `AgentResultPopup` y en el panel de `ResultsDrawer`, y el tipo `Rasgos`
  desaparece de `lumi-proto` por falta de productor.
- Se elimina `CalibracionView.tsx`.
- `AgentResultPopup` muestra las dos lecturas de §4 y la distribución completa
  sobre las opciones.
- En `routes/export.rs` se retira la inclusión de rasgos como imagen; los
  veredictos siguen exportándose.

Añadir un agente nuevo deja de requerir tocar el cliente.

## 8. Migración

Los análisis existentes se borran, no solo sus veredictos: están producidos por
agentes rotos y arrastran ids en el formato antiguo con punto. La migración vacía
`analyses` y `analysis_agents` en cascada, después de la copia de seguridad de
`lumi.db` que el daemon ya hace por versión.

Ningún código nuevo sabe leer el formato viejo de fichas ni de veredictos: no hay
compatibilidad hacia atrás que mantener.

## 9. Qué no cambia

- Los agentes siguen sin descartar candidatos: solo reponderan, como se decidió
  en el diseño original. Un agente equivocado empeora un orden, nunca borra la
  respuesta correcta.
- Sigue habiendo dos usos: automático dentro de un análisis, y modo Agentes
  manual lanzado por el investigador. La prioridad de calidad es el manual.
- Los agentes se siguen ejecutando en paralelo con la verificación geométrica.
- Las fichas siguen siendo datos en `registros/agentes/`, editables sin
  recompilar. Esta vez de verdad.
- El umbral de inliers que hace que un veredicto no mueva un candidato ya sólido
  se mantiene.
