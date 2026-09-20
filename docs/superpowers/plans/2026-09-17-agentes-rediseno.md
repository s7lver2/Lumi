> **DEROGADO** (2026-09-19): el subsistema de agentes descrito aquí se ha
> eliminado por completo. Ver `docs/superpowers/specs/2026-09-19-darkroom-design.md`
> (Parte 1) para el porqué y el plan de borrado.

# Rediseño de los agentes (5c) — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reescribir el subsistema de agentes de Lumi Station (5c) sustituyendo la fusión
JSON-que-se-autoconfirma y la puntuación por media-de-secuencia por evidencia
contrastiva (con imagen / sin imagen) sobre verbalizadores, con un catálogo reducido de
8 agentes (6 discriminantes + 2 observaciones), abstención puntuada como opción cerrada,
un único motor (Qwen3-VL 8B, PaddleOCR y Depth Anything V2 eliminados), y un banco de
pruebas con verdad conocida (`tools/evaluar_agentes.py`).

**Architecture:** Las fichas de `registros/agentes/*.json` pasan de "agentes sueltos +
agentes fusionados con sub_preguntas" a un formato único y plano: `modo: "eleccion" |
"transcripcion"`, `opciones[]` con `verbalizador`/`visible`/`paises`, `umbral` y `peso`.
`workers/lumi_motores.py::Vlm` calcula `evidencia = logP(verbalizador|imagen,pregunta) −
logP(verbalizador|pregunta)` por opción y softmax sobre esas evidencias — nunca sobre la
verosimilitud cruda. `crates/lumi-index/src/agentes.rs::aplicar()` reponderan con
`factor = 1 − peso × confianza` por cada país contradicho, comparando `opcion.paises`
directamente contra `Atributos.pais` (ya no hay `restriccion`/`mapa`/`lado_conduccion`
como concepto Rust — cada ficha lleva sus propios países). El cliente deja de tener
lógica de fusión (`sub_preguntas`, `ETIQUETAS_CORTAS`, cajas OCR, mapa de profundidad) y
resuelve el icono por el campo `icono` de la ficha.

**Tech Stack:** Rust (`crates/lumi-index`, `crates/lumid`, `crates/lumi-proto`), Python
3 + `transformers`/`torch` (`workers/lumi_motores.py`, `workers/lumi_agentes.py`),
TypeScript + React (`client/src`), JSON de datos (`registros/agentes`,
`registros/motores`).

## Global Constraints

- Español para código, comentarios, specs y copy de UI (CLAUDE.md). Los prompts al VLM
  van en **inglés** (spec §3) — es la única excepción, y es deliberada por rendimiento
  del modelo, no un paso hacia UI multiidioma.
- Sin tests nuevos salvo que se pidan explícitamente. Excepción ya vigente:
  `cargo test -p lumi-proto` y los tests que ya existen en `lumi-index` (key, crypto,
  capability matrix, y los de `agentes.rs`/`geo.rs` que este plan reescribe porque las
  fichas de sus fixtures cambian de forma) — se actualizan, no se añaden de más.
- Un commit por tarea terminada (una tarea de este plan = una feature terminada y
  comprobable).
- `ponytail`: la solución más simple que funcione. Cualquier simplificación deliberada
  lleva un comentario `// ponytail:` o `# ponytail:` que nombra el techo y la salida.
- Tema oscuro único, sin verde, iconos SVG dibujados a mano (sin librería de iconos), sin
  cajas con icono de color, sin gradiente morado-azul.
- Puerto fijo 7717 para `lumid`, no configurable por variable de entorno.
- Decisiones de diseño tomadas en este plan que el spec no fija con literalidad de
  código (documentadas aquí para que el ingeniero no las reabra sin motivo):
  - Los países en `opciones[].paises` son **ISO3** (`"ESP"`, `"GBR"`, `"JPN"`...), igual
    que `registros/geo/paises.json`/las fichas viejas y los tests de `geo.rs`. El
    ejemplo del spec (§2) usa ISO2 solo como ilustración compacta; el dataset real del
    proyecto es ISO3, y usar un código que no coincide con el dataset haría que el
    agente nunca reponderara nada — un bug silencioso. Las 6 fichas nuevas de la Tarea 1
    usan ISO3.
  - `lado-conduccion` deja de depender de `TablaLado`/`registros/geo/lado.json`: su
    ficha lleva directamente, en `opciones[].paises`, la lista de países que conducen
    por cada lado (es exactamente el mismo dato que ya vivía en `lado.json`, ahora
    inline en la ficha porque el nuevo formato de opción ya no distingue "restricción"
    de "país"). `TablaLado`/`Koppen`/`Atributos.lado`/`Atributos.koppen` se eliminan de
    `crates/lumi-index/src/geo.rs` en la Tarea 3 porque, comprobado por grep, su único
    consumidor en todo el workspace es `agentes::aplicar` a través de
    `Datos::atributos()` (`crates/lumid/src/queue/mod.rs:845`) — nada más los lee.
    `registros/geo/lado.json` se deja en disco tal cual (el spec no pide borrarlo, solo
    los ficheros de Köppen); simplemente deja de tener lector en Rust.
  - "El panel de calibración se elimina" (spec §6) se interpreta como el editor de
    *prompts de agentes* (4b: `PromptsEditor` en el cliente, `get_agente`/`patch_agente`/
    `agente_efectivo`/`clave_agente`/`AgenteVistaCalibracion`/`PatchAgenteReq` en
    `calibracion.rs`) — es la "mitad muerta" que el propio spec describe ("nadie los
    lee"). Los umbrales de verificación (4a, `UmbralesEditor`/`get_umbral`/
    `patch_umbral`) y el resto de `CalibracionView.tsx` (interruptores de features,
    `RendimientoEditor`) no son del subsistema de agentes y no tienen otro sitio donde
    vivir en el panel admin — se quedan. Si el owner quería literalmente borrar el
    fichero entero, es una decisión de UI que puede pedirse aparte; borrarlo de rebote
    aquí tiraría features no relacionadas (timeouts, persistencia, upscaler).
  - `CLASES` en `workers/lumi_motores.py` pierde `"ocr"` y `"profundidad"` pero conserva
    `"upscalador"` (Real-ESRGAN): no es un motor de agentes (no hay ninguna ficha de
    `registros/agentes/` con `motor: "upscalador"`), vive en el mismo fichero por
    compartir el patrón de carga bajo demanda, y el spec no lo menciona.
  - El banco de pruebas (`tools/evaluar_agentes.py`) es de solo lectura: imprime
    métricas y un veredicto ✓/✗ por agente contra el mínimo (acierto ≥ 0.70, cobertura
    ≥ 0.20), pero no reescribe ninguna ficha. Activar/desactivar un agente que no llega
    al mínimo es un `"activo": false` manual en su JSON — coherente con "las fichas
    siguen siendo datos, editables sin recompilar" (spec §9) y con que el script no
    inventa umbrales nuevos por su cuenta.

---

## Tarea 1 — Fichas nuevas de agentes y registro de motores

Sienta los datos que todo lo demás consume. Sin código Rust/Python tocado todavía: esta
tarea dejará el registro en un formato que el motor viejo NO sabe leer (a propósito —
las tareas 2-6 son las que le enseñan), así que el criterio de "funciona" aquí es que
los JSON sean válidos y consistentes entre sí, comprobado a mano y con `jq`.

**Files:**
- Create: `registros/agentes/lado-conduccion.json`
- Create: `registros/agentes/escritura.json`
- Create: `registros/agentes/toponimos.json`
- Create: `registros/agentes/matricula.json`
- Create: `registros/agentes/senalizacion.json`
- Create: `registros/agentes/vegetacion.json`
- Create: `registros/agentes/meteorologia.json`
- Create: `registros/agentes/hora-solar.json`
- Delete: `registros/agentes/condiciones-ambientales.json`
- Delete: `registros/agentes/dimensiones.json`
- Delete: `registros/agentes/escena.json`
- Delete: `registros/agentes/hora-sombras.json`
- Delete: `registros/agentes/indicios-viales.json`
- Delete: `registros/agentes/texto-en-escena.json`
- Modify: `registros/motores/qwen3-vl.json`
- Delete: `registros/motores/paddleocr.json`
- Delete: `registros/motores/depth-anything-v2-small.json`

**Interfaces:**
- Produces: el formato de ficha que consumen las Tareas 2 (`lumi-index::agentes::Agente`/
  `Opcion`), 5-6 (`workers/lumi_motores.py`/`lumi_agentes.py`) y 9-11 (cliente). Campos
  por ficha: `id`, `nombre`, `icono`, `modo` (`"eleccion"` | `"transcripcion"`),
  `pregunta` (inglés), `umbral` (float, solo en `modo: eleccion`), `peso` (float
  `[0, 0.9]`, `0` = observación), `opciones` (array, vacío/ausente en `transcripcion`)
  con `id`, `verbalizador`, `visible`, `paises` (`string[]`, ISO3, vacío = no repondera
  con esa opción — obligatorio en toda opción `indeterminado`), y `activo` (bool,
  default `true` — ver Constraints, lo toca el banco de pruebas manualmente).

- [ ] **Paso 1: Escribir `registros/agentes/lado-conduccion.json`**

```json
{
  "id": "lado-conduccion",
  "nombre": "Lado de conducción",
  "icono": "volante",
  "modo": "eleccion",
  "pregunta": "Looking at the traffic in this photo, vehicles drive on the",
  "umbral": 0.55,
  "peso": 0.4,
  "activo": true,
  "opciones": [
    {
      "id": "izquierda",
      "verbalizador": " left side of the road.",
      "visible": "Por la izquierda",
      "paises": ["GBR", "IRL", "JPN", "AUS", "IND", "ZAF", "NZL", "THA", "IDN", "MYS", "SGP", "HKG", "PAK", "KEN", "MOZ", "NAM", "BWA", "ZWE", "TZA", "UGA", "ZMB", "MWI", "LSO", "SWZ", "CYP", "MLT", "BRN", "BGD", "LKA", "NPL", "BTN"]
    },
    {
      "id": "derecha",
      "verbalizador": " right side of the road.",
      "visible": "Por la derecha",
      "paises": ["ESP", "FRA", "DEU", "ITA", "US", "USA", "BRA", "MEX", "POL", "NLD", "PRT", "AUT", "BEL", "LUX", "DNK", "SWE", "FIN", "EST", "LVA", "LTU", "CZE", "SVK", "HUN", "SVN", "HRV", "ROU", "BGR", "GRC", "CHE", "NOR", "RUS", "UKR", "TUR", "CHN", "KOR", "CAN", "ARG", "CHL", "COL", "PER", "EGY", "MAR", "DZA", "TUN", "SAU", "ARE"]
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

Nota: `"US"` está duplicado junto a `"USA"` a propósito hasta que la Tarea 3 confirme
qué formato usa `registros/geo/paises.json` real del propietario (no versionado, ver
`registros/geo/LEEME.md`) — el `# ponytail:` de `Datos::cargar` en geo.rs ya asume ISO3
de 3 letras, así que en la práctica solo `"USA"` hará match; se deja `"US"` fuera en el
paso de auditoría final de esta tarea (paso 5) para no dejar basura en el JSON.

- [ ] **Paso 2: Escribir el resto de fichas discriminantes**

`registros/agentes/escritura.json` — sustituye a `idioma` (spec §1: "Reemplaza al mal
llamado `idioma`. Es elección única: la escritura dominante en la imagen, no todas las
presentes"):

```json
{
  "id": "escritura",
  "nombre": "Escritura del texto",
  "icono": "escritura",
  "modo": "eleccion",
  "pregunta": "Looking at any legible text, signs, or writing visible in this photo, the dominant script is",
  "umbral": 0.55,
  "peso": 0.5,
  "activo": true,
  "opciones": [
    { "id": "latino", "verbalizador": " Latin script.", "visible": "Latina", "paises": [] },
    { "id": "cirilico", "verbalizador": " Cyrillic script.", "visible": "Cirílica", "paises": ["RUS", "BLR", "UKR", "BGR", "SRB", "MKD", "MNE", "KAZ", "KGZ", "TJK", "MNG"] },
    { "id": "griego", "verbalizador": " Greek script.", "visible": "Griega", "paises": ["GRC", "CYP"] },
    { "id": "arabe", "verbalizador": " Arabic script.", "visible": "Árabe", "paises": ["MAR", "DZA", "TUN", "LBY", "EGY", "SDN", "SAU", "ARE", "QAT", "KWT", "BHR", "OMN", "YEM", "JOR", "SYR", "IRQ", "LBN", "PSE", "IRN", "AFG", "PAK", "MRT"] },
    { "id": "hebreo", "verbalizador": " Hebrew script.", "visible": "Hebrea", "paises": ["ISR"] },
    { "id": "han", "verbalizador": " Chinese Han script.", "visible": "Han", "paises": ["CHN", "TWN", "HKG", "SGP"] },
    { "id": "devanagari", "verbalizador": " Devanagari script.", "visible": "Devanagari", "paises": ["IND", "NPL"] },
    { "id": "hangul", "verbalizador": " Korean Hangul script.", "visible": "Hangul", "paises": ["KOR", "PRK"] },
    { "id": "tailandes", "verbalizador": " Thai script.", "visible": "Tailandesa", "paises": ["THA"] },
    { "id": "indeterminado", "verbalizador": " cannot be determined from this image.", "visible": "No se puede determinar", "paises": [] }
  ]
}
```

`registros/agentes/matricula.json`:

```json
{
  "id": "matricula",
  "nombre": "Formato de matrícula",
  "icono": "matricula",
  "modo": "eleccion",
  "pregunta": "Looking at the license plates of any vehicles in this photo, their format is",
  "umbral": 0.6,
  "peso": 0.5,
  "activo": true,
  "opciones": [
    { "id": "banda-azul-ue", "verbalizador": " EU style with a blue band on the left.", "visible": "Banda azul UE", "paises": ["ESP", "PRT", "FRA", "ITA", "DEU", "AUT", "BEL", "NLD", "LUX", "IRL", "DNK", "SWE", "FIN", "EST", "LVA", "LTU", "POL", "CZE", "SVK", "HUN", "SVN", "HRV", "ROU", "BGR", "GRC", "CYP", "MLT"] },
    { "id": "amarilla-britanica", "verbalizador": " British or Dutch style, yellow on the rear.", "visible": "Amarilla (GB/NL)", "paises": ["GBR", "NLD"] },
    { "id": "americana", "verbalizador": " North American square format.", "visible": "Cuadrada americana", "paises": ["USA", "CAN", "MEX"] },
    { "id": "indeterminado", "verbalizador": " cannot be determined from this image.", "visible": "No se puede determinar", "paises": [] }
  ]
}
```

`registros/agentes/senalizacion.json`:

```json
{
  "id": "senalizacion",
  "nombre": "Convenio de señalización",
  "icono": "senalizacion",
  "modo": "eleccion",
  "pregunta": "Looking at the shape, color and border style of any traffic signs in this photo, they follow the",
  "umbral": 0.6,
  "peso": 0.4,
  "activo": true,
  "opciones": [
    { "id": "viena", "verbalizador": " Vienna Convention style, used across continental Europe.", "visible": "Convenio de Viena", "paises": ["ESP", "FRA", "DEU", "ITA", "PRT", "AUT", "BEL", "NLD", "LUX", "DNK", "SWE", "FIN", "POL", "CZE", "SVK", "HUN", "SVN", "HRV", "ROU", "BGR", "GRC", "CHE", "NOR", "RUS", "UKR", "TUR"] },
    { "id": "mutcd", "verbalizador": " MUTCD style, used in North America.", "visible": "MUTCD (Norteamérica)", "paises": ["USA", "CAN", "MEX"] },
    { "id": "britanica", "verbalizador": " British style.", "visible": "Británica", "paises": ["GBR", "IRL", "MLT", "CYP", "HKG", "SGP"] },
    { "id": "indeterminado", "verbalizador": " cannot be determined from this image.", "visible": "No se puede determinar", "paises": [] }
  ]
}
```

`registros/agentes/vegetacion.json` (spec §1: "reformulado ... pasa a pedir bioma"):

```json
{
  "id": "vegetacion",
  "nombre": "Bioma por la vegetación",
  "icono": "vegetacion",
  "modo": "eleccion",
  "pregunta": "Looking at the dominant vegetation visible in this photo, it looks like",
  "umbral": 0.55,
  "peso": 0.3,
  "activo": true,
  "opciones": [
    { "id": "palmeras", "verbalizador": " palm trees, tropical or subtropical vegetation.", "visible": "Palmeras", "paises": [] },
    { "id": "coniferas", "verbalizador": " coniferous forest.", "visible": "Coníferas", "paises": [] },
    { "id": "sabana", "verbalizador": " savanna, dry grassland with scattered trees.", "visible": "Sabana", "paises": [] },
    { "id": "selva", "verbalizador": " dense tropical rainforest.", "visible": "Selva", "paises": [] },
    { "id": "sin-vegetacion", "verbalizador": " no significant vegetation, bare or urban ground.", "visible": "Sin vegetación", "paises": [] },
    { "id": "indeterminado", "verbalizador": " cannot be determined from this image.", "visible": "No se puede determinar", "paises": [] }
  ]
}
```

`peso: 0.3` y todas las `paises: []`: hasta que este agente pase el banco de pruebas
(Tarea 13) con un mapeo bioma→países fiable, reponderar con listas vacías no mueve
ningún candidato (ver `aplicar()`, Tarea 2 — una opción sin países nunca contradice). Es
intencional: el agente ya sale del catálogo con su criterio de admisión pendiente de
confirmar con datos, tal como pide el spec ("se admite a prueba" se aplicó a
`senalizacion`; aquí se aplica el mismo criterio a `vegetacion` por prudencia, ya que su
mapa bioma→país es el menos evidente de los seis). El ingeniero que ejecute la Tarea 13
debe rellenar `paises` por opción si el banco confirma que vegetacion sí discrimina, o
dejar el agente con `peso: 0` si no.

- [ ] **Paso 3: Escribir las dos observaciones (`peso: 0`, no reponderan)**

`registros/agentes/meteorologia.json`:

```json
{
  "id": "meteorologia",
  "nombre": "Meteorología aparente",
  "icono": "meteorologia",
  "modo": "eleccion",
  "pregunta": "Looking at the sky and ground conditions in this photo, the weather looks",
  "umbral": 0.5,
  "peso": 0,
  "activo": true,
  "opciones": [
    { "id": "despejado", "verbalizador": " clear and sunny.", "visible": "Despejado", "paises": [] },
    { "id": "nublado", "verbalizador": " overcast or cloudy.", "visible": "Nublado", "paises": [] },
    { "id": "lluvia", "verbalizador": " rainy, with wet surfaces.", "visible": "Lluvia", "paises": [] },
    { "id": "nieve", "verbalizador": " snowy.", "visible": "Nieve", "paises": ["NOR", "SWE", "FIN", "ISL", "CAN", "RUS"] },
    { "id": "niebla", "verbalizador": " foggy or hazy.", "visible": "Niebla", "paises": [] },
    { "id": "indeterminado", "verbalizador": " cannot be determined from this image.", "visible": "No se puede determinar", "paises": [] }
  ]
}
```

`nieve` lleva un `paises` no vacío a propósito (spec §1: "la nieve excluye el trópico y
poco más") pero `peso: 0` hace que nunca repondere de todos modos — es una observación
descriptiva, el campo `paises` se deja documentado por si algún día se decide
reactivarla como discriminante subiendo `peso`, sin tener que rellenar el mapa desde
cero.

`registros/agentes/hora-solar.json` (spec §1: "Sustituye a `hora-sombras`"):

```json
{
  "id": "hora-solar",
  "nombre": "Hora aparente por el sol",
  "icono": "hora-solar",
  "modo": "eleccion",
  "pregunta": "By the length and direction of shadows and the color of the light in this photo, the time of day looks like",
  "umbral": 0.5,
  "peso": 0,
  "activo": true,
  "opciones": [
    { "id": "amanecer", "verbalizador": " sunrise, early morning.", "visible": "Amanecer", "paises": [] },
    { "id": "media-manana", "verbalizador": " mid-morning.", "visible": "Media mañana", "paises": [] },
    { "id": "mediodia", "verbalizador": " midday, with short shadows.", "visible": "Mediodía", "paises": [] },
    { "id": "media-tarde", "verbalizador": " mid-afternoon.", "visible": "Media tarde", "paises": [] },
    { "id": "atardecer", "verbalizador": " sunset, evening.", "visible": "Atardecer", "paises": [] },
    { "id": "noche", "verbalizador": " night time.", "visible": "Noche", "paises": [] },
    { "id": "indeterminado", "verbalizador": " cannot be determined, the sky is overcast or shadows aren't visible.", "visible": "No se puede determinar", "paises": [] }
  ]
}
```

- [ ] **Paso 4: Escribir la ficha de transcripción**

`registros/agentes/toponimos.json` (`modo: transcripcion`, sin `umbral`/`peso`/
`opciones` — spec §5: "sin número de confianza", "no repondera nada"):

```json
{
  "id": "toponimos",
  "nombre": "Topónimos legibles",
  "icono": "toponimos",
  "modo": "transcripcion",
  "pregunta": "Transcribe any readable street names, place names, shop signs or other place-identifying text visible in this photo. Reply with just the text you can read, separated by ' · ' if there are several. Reply with exactly 'nothing legible' if there is no readable place-identifying text.",
  "activo": true
}
```

- [ ] **Paso 5: Borrar las fichas viejas y auditar consistencia**

```bash
cd "E:\Lumi Station\.claude\worktrees\agent-ab7b2bfab383301b1"
rm registros/agentes/condiciones-ambientales.json registros/agentes/dimensiones.json \
   registros/agentes/escena.json registros/agentes/hora-sombras.json \
   registros/agentes/indicios-viales.json registros/agentes/texto-en-escena.json
ls registros/agentes/
# Debe listar exactamente: hora-solar.json lado-conduccion.json matricula.json
# meteorologia.json senalizacion.json toponimos.json vegetacion.json escritura.json
for f in registros/agentes/*.json; do python3 -c "import json,sys; json.load(open(sys.argv[1]))" "$f" || echo "JSON ROTO: $f"; done
```

Revisar a mano `lado-conduccion.json`: quitar el `"US"` duplicado de la lista de
`derecha` (dejar solo `"USA"`), coherente con la nota ISO3 del paso 1.

- [ ] **Paso 6: Actualizar el registro de motores**

`registros/motores/qwen3-vl.json` — cambiar `id`, `nombre` y `hf_repo` de 4B a 8B (spec
§6: *"Modelo por defecto: `Qwen/Qwen3-VL-8B-Instruct` cuantizado a 4 bits"*). El campo
`id` es el que ahora lee `workers/lumi_agentes.py` para saber qué directorio de pesos
cargar (Tarea 6), sustituyendo al literal `"qwen3-vl"` hardcodeado hoy en
`lumi_motores.py:110`:

```bash
python3 - <<'EOF'
import json
p = "registros/motores/qwen3-vl.json"
d = json.load(open(p, encoding="utf-8"))
d["id"] = "qwen3-vl-8b"
d["nombre"] = "Qwen3-VL-8B-Instruct (4-bit)"
d["hf_repo"] = "Qwen/Qwen3-VL-8B-Instruct"
d["cuantizacion"] = "4bit"
json.dump(d, open(p, "w", encoding="utf-8"), indent=2, ensure_ascii=False)
EOF
git diff registros/motores/qwen3-vl.json
```

El campo nuevo `"cuantizacion": "4bit"` lo lee `Vlm.__init__` en la Tarea 5 para decidir
si carga con `BitsAndBytesConfig(load_in_4bit=True)` en vez de `dtype=torch.float16`.

- [ ] **Paso 7: Borrar los registros de motores eliminados**

```bash
rm registros/motores/paddleocr.json registros/motores/depth-anything-v2-small.json
ls registros/motores/
# Debe listar exactamente: qwen3-vl.json real-esrgan.json
```

- [ ] **Paso 8: Commit**

```bash
git add registros/agentes registros/motores
git commit -m "$(cat <<'EOF'
feat(agentes): catálogo nuevo de 8 fichas y motor único qwen3-vl-8b

Reemplaza las 6 fichas viejas (3 fusionadas con sub_preguntas, ids con
punto) por 8 fichas planas: 6 discriminantes (lado-conduccion,
escritura, toponimos, matricula, senalizacion, vegetacion) + 2
observaciones (meteorologia, hora-solar, peso 0). Cada opción lleva su
propio verbalizador y lista de países ISO3 -- ya no hay
restriccion/mapa/sub_preguntas. PaddleOCR y Depth Anything V2 salen
del registro de motores; qwen3-vl pasa de 4B a 8B cuantizado a 4 bits.

Este commit deja el registro en un formato que el motor y el cliente
actuales NO saben leer todavía -- las tareas siguientes les enseñan.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Tarea 2 — `crates/lumi-index/src/agentes.rs`: nuevo `Agente`/`Opcion`/`Veredicto` y `aplicar()`

**Files:**
- Modify: `crates/lumi-index/src/agentes.rs` (reescritura completa)

**Interfaces:**
- Consumes: el formato de ficha de la Tarea 1 (`modo`, `opciones[].paises` ISO3,
  `peso`, `umbral`, `activo`).
- Produces: `pub struct Agente { id, nombre, icono, modo, pregunta, umbral, peso, activo,
  opciones: Vec<Opcion> }`, `pub struct Opcion { id, verbalizador, visible, paises:
  Vec<String> }`, `pub struct Veredicto { agente, etiqueta, confianza: Option<f64>,
  alternativas: Vec<(String, f64)>, apoyo_visual: Option<f64>, respuesta_cruda:
  Option<String> }`, `pub fn aplicar(agentes, veredictos, candidatos: &[(Atributos,
  Option<u32>)]) -> Resultado` — consumido por `crates/lumid/src/queue/mod.rs:845` y por
  la Tarea 3 (`Atributos` se simplifica a `{ pais: Option<String> }` en esa misma tarea;
  esta tarea ya escribe `agentes.rs` asumiendo esa forma, así que **la Tarea 3 debe
  ejecutarse antes de compilar** — están secuenciadas así porque no hay forma de que
  `agentes.rs` compile solo con la mitad del cambio).

- [ ] **Paso 1: Reemplazar el fichero completo**

```rust
//! Un agente mira la foto de consulta y dice algo sobre ella. Este módulo es
//! lo que se hace con lo que dijo.
//!
//! Ningún agente descarta un candidato: todos describen, y punto. Una
//! respuesta que contradice a un candidato le baja la confianza en vez de
//! tumbarlo — nunca cero resultados por culpa de una conjetura:
//!
//! 1. **Un candidato con `UMBRAL_INLIERS` correspondencias o más no lo penaliza
//!    ningún agente.** Cientos de puntos que RANSAC ha confirmado son mejor
//!    prueba que lo que un modelo cree ver en una foto.
//! 2. **Cada agente que contradice multiplica el factor por `1 − peso ×
//!    confianza`**, con `peso` acotado a `[0, 0.9]` (spec 2026-09-17 §2): un
//!    veredicto muy seguro de un agente con mucho peso puede penalizar hasta
//!    un 90%, pero nunca el 100% — nada desaparece del todo por una conjetura.
//!
//! Y una tercera que es de la misma familia: el que no sabe no castiga. Un
//! agente por debajo de su umbral de confianza, una opción sin países que
//! contradecir (`indeterminado`, o cualquier opción con `paises: []`), o un
//! candidato cuyo país no se pudo resolver, no mueven nada.

use crate::arbitro::UMBRAL_INLIERS;
use crate::geo::Atributos;
use serde::{Deserialize, Serialize};

/// La ficha de `registros/agentes/<id>.json`. Sin ningún `if` sobre el `id`
/// en el motor ni aquí: si hace falta uno, es que falta un campo en la ficha
/// (spec 2026-09-17 §2).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Agente {
    pub id: String,
    pub nombre: String,
    /// Nombre que el cliente resuelve contra su set de SVG dibujados a mano
    /// (`AgenteIcono.tsx`).
    pub icono: String,
    /// `"eleccion"` (conjunto cerrado, softmax sobre evidencia contrastiva) o
    /// `"transcripcion"` (generación libre, sin confianza). Es el único campo
    /// que decide el camino de ejecución -- ver `Vlm.responder`/
    /// `Vlm.transcribir` en `workers/lumi_motores.py`.
    pub modo: String,
    /// El prompt, en inglés, redactado para encadenar gramaticalmente con
    /// cada `verbalizador` (modo elección) o para pedir la transcripción
    /// (modo transcripción).
    pub pregunta: String,
    /// Confianza mínima para no abstenerse. Solo tiene sentido en
    /// `modo: eleccion`; se ignora en transcripción.
    #[serde(default)]
    pub umbral: f64,
    /// Fuerza con la que el veredicto mueve el ranking, en `[0, 0.9]`. `0`
    /// define una observación: se muestra pero nunca repondera. Se acota a
    /// 0.9 en `aplicar()`, no aquí, para que una ficha que declare un valor
    /// fuera de rango falle de forma visible en vez de en silencio.
    #[serde(default)]
    pub peso: f64,
    /// El conjunto cerrado de respuestas válidas, solo en `modo: eleccion`.
    /// Toda ficha de elección debe incluir una opción `id: "indeterminado"`
    /// con `paises: []` -- no es un caso especial del motor, es una opción
    /// más que compite en el mismo softmax.
    #[serde(default)]
    pub opciones: Vec<Opcion>,
    /// Si `false`, el agente sigue en el registro (para que el banco de
    /// pruebas lo siga evaluando) pero `GET /v1/agentes` no lo ofrece al
    /// investigador. Lo toca a mano quien corra
    /// `tools/evaluar_agentes.py` -- nunca el propio motor.
    #[serde(default = "activo_por_defecto")]
    pub activo: bool,
}

fn activo_por_defecto() -> bool {
    true
}

/// Una opción dentro de `Agente.opciones`. Separa tres cosas que antes
/// vivían confundidas en una sola cadena: el identificador (estable, para
/// guardar el veredicto), el verbalizador (el texto exacto que se puntúa
/// contra el modelo) y la etiqueta visible (lo que lee el investigador).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Opcion {
    pub id: String,
    /// El texto exacto, en inglés, que se concatena a `Agente.pregunta` para
    /// puntuar esta opción. Empieza con el espacio/puntuación que le
    /// corresponda para encadenar gramaticalmente.
    pub verbalizador: String,
    /// Lo que lee el investigador en español.
    pub visible: String,
    /// Países (ISO3) que cumplen esta opción. Vacío = esta opción nunca
    /// contradice a ningún candidato (el caso de `indeterminado`, y el de
    /// cualquier opción sin mapa de país todavía confirmado por el banco de
    /// pruebas).
    #[serde(default)]
    pub paises: Vec<String>,
}

/// Lo que un agente contestó sobre la foto de consulta.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Veredicto {
    pub agente: String,
    pub etiqueta: String,
    /// `None` en `modo: transcripcion` -- no hay conjunto cerrado sobre el
    /// que normalizar, y cualquier número ahí sería inventado (spec
    /// 2026-09-17 §5). En `modo: eleccion`, la probabilidad softmax de la
    /// opción ganadora.
    #[serde(default)]
    pub confianza: Option<f64>,
    /// La distribución completa sobre las opciones, ordenada. Vacía en modo
    /// transcripción.
    #[serde(default)]
    pub alternativas: Vec<(String, f64)>,
    /// Cuánto sube la imagen la evidencia de la opción ganadora frente a no
    /// verla -- `logP(verbalizador|imagen,pregunta) −
    /// logP(verbalizador|pregunta)` de la opción que ganó, sin normalizar
    /// (spec 2026-09-17 §4: "cuánto la apoya la fotografía" es una lectura
    /// aparte de la confianza, no la misma cifra con otro nombre). `None` en
    /// modo transcripción.
    #[serde(default)]
    pub apoyo_visual: Option<f64>,
    /// El texto/JSON exacto que devolvió el motor antes de interpretarlo,
    /// solo con `modo_calibracion` activo en el momento del análisis.
    #[serde(default)]
    pub respuesta_cruda: Option<String>,
}

/// Suelo/techo del peso declarado en una ficha -- una ficha que declare más
/// de 0.9 no penaliza más que 0.9 de todos modos, así que ni vale la pena
/// que `registro.rs` la rechace: se acota aquí, en el único sitio que lo usa.
const PESO_MAXIMO: f64 = 0.9;

#[derive(Debug, Clone, PartialEq)]
pub struct Ajuste {
    pub factor: f64,
    pub motivo: Option<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Resultado {
    /// Uno por candidato, en el mismo orden en que entraron.
    pub ajustes: Vec<Ajuste>,
}

/// Los motores que hacen falta para que estos agentes puedan correr de
/// verdad. Con un único motor (`vlm`) en el catálogo, esto casi siempre
/// devuelve como mucho un id -- se conserva la deduplicación por si algún
/// día vuelve a haber más de una clase de motor.
pub fn motores_de_agentes(
    ids_agentes: &[String],
    agentes: &[Agente],
    motores: &[crate::registro::Motor],
) -> Vec<String> {
    let clases: std::collections::HashSet<&str> = ids_agentes
        .iter()
        .filter_map(|id| agentes.iter().find(|a| &a.id == id))
        .map(|_| "vlm")
        .collect();
    let mut fuera = Vec::new();
    for clase in clases {
        if let Some(m) = motores.iter().find(|m| m.clase == clase) {
            fuera.push(m.id.clone());
        }
    }
    fuera.sort();
    fuera
}

pub fn aplicar(
    agentes: &[Agente],
    veredictos: &[Veredicto],
    candidatos: &[(Atributos, Option<u32>)],
) -> Resultado {
    let mut ajustes: Vec<Ajuste> = Vec::with_capacity(candidatos.len());

    for (atributos, inliers) in candidatos {
        let mut factor = 1.0_f64;
        let mut motivos: Vec<String> = Vec::new();

        for v in veredictos {
            let Some(a) = agentes.iter().find(|a| a.id == v.agente) else { continue };
            let Some(confianza) = v.confianza else { continue }; // transcripción no repondera
            if a.peso <= 0.0 || confianza < a.umbral {
                continue; // observación, o se abstiene
            }
            let Some(opcion) = a.opciones.iter().find(|o| o.id == v.etiqueta) else { continue };
            if opcion.paises.is_empty() {
                continue; // "indeterminado", o sin mapa de país confirmado: no contradice a nadie
            }
            let Some(pais) = atributos.pais.as_deref() else { continue }; // no sabemos dónde cae: no castiga
            if opcion.paises.iter().any(|p| p == pais) {
                continue; // cumple
            }
            factor *= 1.0 - a.peso.min(PESO_MAXIMO) * confianza;
            motivos.push(format!("{} dice «{}», y este candidato es {pais}", a.nombre, v.etiqueta));
        }

        // Regla 1: la geometría gana. Se comprueba DESPUÉS de recorrer los
        // agentes y no antes, para que el bucle siga siendo el mismo y la
        // excepción esté escrita en un solo sitio.
        let protegido = inliers.is_some_and(|n| n >= UMBRAL_INLIERS);
        if motivos.is_empty() || protegido {
            ajustes.push(Ajuste { factor: 1.0, motivo: None });
        } else {
            ajustes.push(Ajuste { factor, motivo: Some(motivos.join("; ")) });
        }
    }

    Resultado { ajustes }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn opcion(id: &str, paises: &[&str]) -> Opcion {
        Opcion {
            id: id.into(),
            verbalizador: format!(" {id}."),
            visible: id.into(),
            paises: paises.iter().map(|s| s.to_string()).collect(),
        }
    }

    fn escritura() -> Agente {
        Agente {
            id: "escritura".into(),
            nombre: "Escritura del texto".into(),
            icono: "escritura".into(),
            modo: "eleccion".into(),
            pregunta: "…".into(),
            umbral: 0.6,
            peso: 0.5,
            activo: true,
            opciones: vec![
                opcion("griego", &["GRC", "CYP"]),
                opcion("latino", &[]),
                opcion("indeterminado", &[]),
            ],
        }
    }

    fn matricula() -> Agente {
        Agente {
            id: "matricula".into(),
            nombre: "Matrícula".into(),
            icono: "matricula".into(),
            modo: "eleccion".into(),
            pregunta: "…".into(),
            umbral: 0.6,
            peso: 0.5,
            activo: true,
            opciones: vec![opcion("banda-azul-ue", &["GRC", "ESP"]), opcion("indeterminado", &[])],
        }
    }

    fn hora() -> Agente {
        Agente {
            id: "hora-solar".into(),
            nombre: "Hora aparente".into(),
            icono: "hora-solar".into(),
            modo: "eleccion".into(),
            pregunta: "…".into(),
            umbral: 0.5,
            peso: 0.0,
            activo: true,
            opciones: vec![opcion("mediodia", &[])],
        }
    }

    fn en(iso: &str) -> Atributos {
        Atributos { pais: Some(iso.into()) }
    }

    fn dice(agente: &str, etiqueta: &str, confianza: f64) -> Veredicto {
        Veredicto {
            agente: agente.into(),
            etiqueta: etiqueta.into(),
            confianza: Some(confianza),
            alternativas: Vec::new(),
            apoyo_visual: Some(1.0),
            respuesta_cruda: None,
        }
    }

    #[test]
    fn sin_veredictos_no_se_toca_nada() {
        let r = aplicar(&[escritura()], &[], &[(en("NOR"), None), (en("GRC"), None)]);
        assert!(r.ajustes.iter().all(|a| a.factor == 1.0 && a.motivo.is_none()));
    }

    #[test]
    fn el_que_incumple_y_no_tiene_geometria_se_penaliza_segun_peso_y_confianza() {
        let r = aplicar(
            &[escritura()],
            &[dice("escritura", "griego", 0.9)],
            &[(en("GRC"), None), (en("NOR"), None)],
        );
        assert_eq!(r.ajustes[0].factor, 1.0);
        assert!((r.ajustes[1].factor - (1.0 - 0.5 * 0.9)).abs() < 1e-9);
        assert!(r.ajustes[1].motivo.as_deref().unwrap().contains("griego"));
    }

    #[test]
    fn con_inliers_de_sobra_la_geometria_gana_y_el_agente_calla() {
        let r = aplicar(
            &[escritura()],
            &[dice("escritura", "griego", 0.9)],
            &[(en("NOR"), Some(400))],
        );
        assert_eq!(r.ajustes[0].factor, 1.0);
        assert!(r.ajustes[0].motivo.is_none());
    }

    #[test]
    fn justo_en_el_umbral_de_inliers_ya_protege() {
        let r = aplicar(
            &[escritura()],
            &[dice("escritura", "griego", 0.9)],
            &[(en("NOR"), Some(crate::arbitro::UMBRAL_INLIERS))],
        );
        assert_eq!(r.ajustes[0].factor, 1.0);
    }

    #[test]
    fn una_abstencion_no_repondera_nada() {
        let mut a = escritura();
        a.umbral = 0.6;
        let r = aplicar(&[a], &[dice("escritura", "griego", 0.4)], &[(en("NOR"), None)]);
        assert_eq!(r.ajustes[0].factor, 1.0);
        assert!(r.ajustes[0].motivo.is_none());
    }

    #[test]
    fn una_opcion_indeterminado_nunca_penaliza() {
        let r = aplicar(&[escritura()], &[dice("escritura", "indeterminado", 0.9)], &[(en("NOR"), None)]);
        assert_eq!(r.ajustes[0].factor, 1.0);
    }

    #[test]
    fn un_agente_de_peso_cero_nunca_penaliza() {
        let r = aplicar(&[hora()], &[dice("hora-solar", "mediodia", 1.0)], &[(en("NOR"), None)]);
        assert_eq!(r.ajustes[0].factor, 1.0);
    }

    #[test]
    fn una_transcripcion_sin_confianza_no_repondera() {
        let v = Veredicto {
            agente: "toponimos".into(), etiqueta: "Calle Mayor".into(), confianza: None,
            alternativas: Vec::new(), apoyo_visual: None, respuesta_cruda: None,
        };
        let r = aplicar(&[escritura()], &[v], &[(en("NOR"), None)]);
        assert_eq!(r.ajustes[0].factor, 1.0);
    }

    #[test]
    fn dos_contradicciones_independientes_componen_multiplicativamente() {
        let r = aplicar(
            &[escritura(), matricula()],
            &[dice("escritura", "griego", 0.9), dice("matricula", "banda-azul-ue", 0.9)],
            &[(en("GRC"), None), (en("ESP"), None), (en("NOR"), None)],
        );
        assert_eq!(r.ajustes[0].factor, 1.0);
        assert!((r.ajustes[1].factor - (1.0 - 0.5 * 0.9)).abs() < 1e-9);
        let esperado_noruega = (1.0 - 0.5 * 0.9) * (1.0 - 0.5 * 0.9);
        assert!((r.ajustes[2].factor - esperado_noruega).abs() < 1e-9);
    }

    #[test]
    fn el_peso_se_acota_a_09_aunque_la_ficha_declare_mas() {
        let mut a = escritura();
        a.peso = 5.0;
        let r = aplicar(&[a], &[dice("escritura", "griego", 1.0)], &[(en("NOR"), None)]);
        assert!((r.ajustes[0].factor - 0.1).abs() < 1e-9);
    }

    #[test]
    fn no_saber_donde_cae_un_candidato_no_lo_castiga() {
        let sin = Atributos::default();
        let r = aplicar(&[escritura()], &[dice("escritura", "griego", 0.9)], &[(sin, None)]);
        assert_eq!(r.ajustes[0].factor, 1.0);
    }

    #[test]
    fn una_etiqueta_que_no_esta_entre_las_opciones_no_hace_nada() {
        let r = aplicar(&[escritura()], &[dice("escritura", "klingon", 0.99)], &[(en("NOR"), None)]);
        assert_eq!(r.ajustes[0].factor, 1.0);
    }

    fn motor(id: &str, clase: &str) -> crate::registro::Motor {
        crate::registro::Motor {
            id: id.into(), nombre: id.into(), clase: clase.into(), licencia: "Apache-2.0".into(),
            fichero_url: String::new(), licencia_url: String::new(), licencia_texto: String::new(),
            puerta: None, gestion_propia: false, hf_repo: String::new(),
        }
    }

    #[test]
    fn dos_agentes_comparten_una_sola_instalacion_de_motor() {
        let a1 = Agente { id: "a1".into(), ..escritura() };
        let a2 = Agente { id: "a2".into(), ..escritura() };
        let necesarios = motores_de_agentes(
            &["a1".into(), "a2".into()], &[a1, a2], &[motor("qwen3-vl-8b", "vlm")],
        );
        assert_eq!(necesarios, vec!["qwen3-vl-8b".to_string()]);
    }

    #[test]
    fn un_agente_sin_motor_registrado_no_pide_nada_que_no_exista() {
        let necesarios = motores_de_agentes(&["escritura".into()], &[escritura()], &[]);
        assert!(necesarios.is_empty());
    }
}
```

- [ ] **Paso 2: Compilar solo este crate para ver los errores que faltan por resolver en la Tarea 3**

```bash
cargo check -p lumi-index 2>&1 | head -60
```

Esperado: errores en `geo.rs` (`Atributos` todavía tiene `lado`/`koppen`) y en
`registro.rs` (`cargar_agentes` sigue filtrando por `restriccion`/`mapa`, campos que ya
no existen). Son exactamente los que arregla la Tarea 3 — no se compila limpio hasta
terminarla. No hacer commit todavía.

---

## Tarea 3 — `crates/lumi-index/src/geo.rs`: simplificar `Atributos` a solo país, y `registro.rs`

**Files:**
- Modify: `crates/lumi-index/src/geo.rs`
- Modify: `crates/lumi-index/src/registro.rs:176-187` (comentario + `cargar_agentes`)

**Interfaces:**
- Consumes: nada nuevo de tareas anteriores.
- Produces: `pub struct Atributos { pub pais: Option<String> }` (consumida por la Tarea
  2, ya escrita asumiendo esta forma) y `pub fn cargar_agentes(dir: &Path) ->
  Vec<crate::agentes::Agente>` sin el filtro de `restriccion`/`mapa` a medias (ya no
  existen esos campos).

- [ ] **Paso 1: Reemplazar `crates/lumi-index/src/geo.rs` completo**

Elimina `Pais`... no, `Pais`/`Paises`/`dentro`/`sobre_arista`/`RecursoGeo`/
`cargar_recursos` se conservan tal cual (país sigue siendo el único atributo). Se
eliminan `TablaLado`, `Koppen`, y `Atributos` pierde `lado`/`koppen`:

```rust
//! El resolutor que convierte una coordenada en el país donde cae — lo único
//! que un agente puede comparar hoy (spec 2026-09-17 §1: cada agente
//! discriminante lleva su propia lista de países por opción, ya no hay un
//! concepto separado de "lado de conducción" o "clima" a nivel de Rust).
//!
//! Es OFFLINE a propósito. Un filtro geográfico que dependiera de una API
//! externa convertiría cada análisis en una petición de red que se puede caer,
//! se puede cobrar y deja rastro de qué está investigando el usuario.
//!
//! `paises.json` NO se publica con el repositorio: lo pone el propietario
//! siguiendo `registros/geo/LEEME.md`. Sin él, `Atributos.pais` es `None` y
//! todo agente se abstiene de reponderar — la misma postura que el `sha256`
//! vacío del registro de modelos: mejor no saber que fingir que se sabe.

use std::path::Path;

use serde::{Deserialize, Serialize};

/// Un país con sus anillos exteriores. Los agujeros (enclaves) NO se modelan:
///
/// ponytail: un enclave mal atribuido mueve un candidato de país en un puñado
/// de casos y el coste de modelar agujeros es arrastrar polígonos con huecos
/// por todo el módulo. La salida, si algún día importa, es añadir
/// `agujeros: Vec<Vec<(f64, f64)>>` a `Pais` y restarlos en `iso_de`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Pais {
    pub iso: String,
    /// Cada anillo es una lista de `(lng, lat)` — el orden de GeoJSON, no el
    /// de una coordenada hablada. Se respeta para que convertir el dataset sea
    /// copiar y no reordenar.
    pub anillos: Vec<Vec<(f64, f64)>>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct Paises {
    pub paises: Vec<Pais>,
}

impl Paises {
    pub fn iso_de(&self, lat: f64, lng: f64) -> Option<String> {
        self.paises
            .iter()
            .find(|p| p.anillos.iter().any(|a| dentro(a, lat, lng)))
            .map(|p| p.iso.clone())
    }
}

/// Trazado de rayos hacia el este. El `<=` de un extremo y el `<` del otro es
/// lo que evita contar dos veces un vértice; el caso del punto exactamente
/// sobre una arista se resuelve antes, a mano, porque una frontera es
/// justamente donde caen las coordenadas interesantes.
pub fn dentro(anillo: &[(f64, f64)], lat: f64, lng: f64) -> bool {
    if anillo.len() < 3 {
        return false;
    }
    let mut dentro = false;
    let mut j = anillo.len() - 1;
    for i in 0..anillo.len() {
        let (xi, yi) = anillo[i];
        let (xj, yj) = anillo[j];
        if sobre_arista(lng, lat, xi, yi, xj, yj) {
            return true;
        }
        if (yi > lat) != (yj > lat) && lng < (xj - xi) * (lat - yi) / (yj - yi) + xi {
            dentro = !dentro;
        }
        j = i;
    }
    dentro
}

fn sobre_arista(x: f64, y: f64, xi: f64, yi: f64, xj: f64, yj: f64) -> bool {
    let cruz = (x - xi) * (yj - yi) - (y - yi) * (xj - xi);
    if cruz.abs() > 1e-9 {
        return false;
    }
    x >= xi.min(xj) - 1e-9 && x <= xi.max(xj) + 1e-9 && y >= yi.min(yj) - 1e-9 && y <= yi.max(yj) + 1e-9
}

/// Lo que se sabe de una coordenada. `None` es un estado legítimo y
/// frecuente — un candidato en alta mar, un servidor sin `paises.json`
/// puesto — y el que no sabe no castiga a nadie (`agentes::aplicar`).
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Atributos {
    pub pais: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RecursoGeo {
    pub id: String,
    pub nombre: String,
    pub licencia: String,
    #[serde(default)]
    pub fichero_url: String,
    #[serde(default)]
    pub licencia_url: String,
    #[serde(default)]
    pub licencia_texto: String,
    #[serde(default)]
    pub puerta: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct RegistroGeo {
    recursos: Vec<RecursoGeo>,
}

pub fn cargar_recursos(dir: &Path) -> Vec<RecursoGeo> {
    std::fs::read(dir.join("registro.json"))
        .ok()
        .and_then(|b| serde_json::from_slice::<RegistroGeo>(&b).ok())
        .map(|r| r.recursos)
        .unwrap_or_default()
}

/// El único dataset que se carga al arrancar el daemon. `lado.json` sigue en
/// disco (spec 2026-09-17: no se pide borrarlo, a diferencia de los ficheros
/// de Köppen) pero ya no tiene lector aquí -- cada ficha de
/// `registros/agentes/lado-conduccion.json` lleva ahora, inline, la lista de
/// países que conduce por cada lado, así que un `TablaLado` intermedio dejó
/// de tener consumidor (comprobado por grep en todo el workspace: el único
/// era `agentes::aplicar`, a través de este `Datos`).
#[derive(Debug, Clone, Default)]
pub struct Datos {
    pub paises: Option<Paises>,
}

impl Datos {
    pub fn cargar(dir: &Path) -> Datos {
        let paises = std::fs::read(dir.join("paises.json"))
            .ok()
            .and_then(|b| serde_json::from_slice::<Paises>(&b).ok());
        if paises.is_none() {
            log::warn!("sin paises.json: los agentes que acotan por país se abstendrán");
        }
        Datos { paises }
    }

    pub fn atributos(&self, lat: f64, lng: f64) -> Atributos {
        Atributos { pais: self.paises.as_ref().and_then(|p| p.iso_de(lat, lng)) }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Un cuadrado de 10×10 grados centrado en el origen. No es ningún país
    /// real a propósito: lo que se prueba es el algoritmo, no el dataset.
    fn cuadrado() -> Paises {
        Paises {
            paises: vec![Pais {
                iso: "XXX".into(),
                anillos: vec![vec![(-5.0, -5.0), (5.0, -5.0), (5.0, 5.0), (-5.0, 5.0)]],
            }],
        }
    }

    #[test]
    fn un_punto_dentro_del_anillo_da_su_pais() {
        assert_eq!(cuadrado().iso_de(1.0, 1.0).as_deref(), Some("XXX"));
    }

    #[test]
    fn un_punto_fuera_no_da_ninguno() {
        assert!(cuadrado().iso_de(40.0, 40.0).is_none());
    }

    #[test]
    fn el_borde_cuenta_como_dentro() {
        assert_eq!(cuadrado().iso_de(0.0, -5.0).as_deref(), Some("XXX"));
    }

    #[test]
    fn sin_datos_en_disco_no_se_sabe_nada_y_no_se_rompe() {
        let d = Datos::cargar(std::path::Path::new("/no/existe/de/ninguna/manera"));
        let a = d.atributos(43.36, -8.41);
        assert!(a.pais.is_none());
    }
}
```

- [ ] **Paso 2: Actualizar `crates/lumi-index/src/registro.rs`**

El filtro de líneas 176-187 (leído en la investigación previa) descarta agentes con
`restriccion`/`mapa` a medias — ese par de campos ya no existe en `Agente`. Sustituir
por una validación equivalente sobre la forma nueva: un agente `modo: "eleccion"` sin
`opciones`, o con `id`/`icono`/`modo` vacíos, se descarta (mismo criterio "mejor
abstenerse a callar de mentira" aplicado a los campos que sí existen ahora):

```rust
/// Los agentes. Mismo trato que los demás registros: un fichero malo cuesta un
/// agente, nunca la lista. Se descarta el que declare `modo: "eleccion"` sin
/// ninguna opción -- un agente de elección sin opciones no puede puntuar
/// nada, así que es peor que no estar: mejor abstenerse a callar de mentira.
pub fn cargar_agentes(dir: &Path) -> Vec<crate::agentes::Agente> {
    leer_dir::<crate::agentes::Agente>(dir)
        .into_iter()
        .filter(|a| {
            !a.id.is_empty() && !a.icono.is_empty() && (a.modo != "eleccion" || !a.opciones.is_empty())
        })
        .collect()
}
```

Buscar el bloque exacto con:

```bash
grep -n "pub fn cargar_agentes" -A 6 crates/lumi-index/src/registro.rs
```

y reemplazarlo (incluyendo el comentario de arriba) por el bloque de arriba.

- [ ] **Paso 3: Compilar y correr los tests de `lumi-index`**

```bash
cargo test -p lumi-index 2>&1 | tail -80
```

Esperado: compila limpio (la Tarea 2 ya asumía esta forma de `Atributos`) y todos los
tests de `geo.rs`/`agentes.rs`/`registro.rs` pasan. Si `registro.rs` tiene un test
llamado algo como `agente_a_medias_se_descarta` que construye un JSON con
`restriccion`/`mapa`, localizarlo con `grep -n "restriccion\|mapa" crates/lumi-index/src/registro.rs`
y reescribirlo contra la forma nueva (`modo`/`opciones`) siguiendo el mismo patrón que
los demás tests de esa función.

- [ ] **Paso 4: Commit**

```bash
git add crates/lumi-index/src/agentes.rs crates/lumi-index/src/geo.rs crates/lumi-index/src/registro.rs
git commit -m "$(cat <<'EOF'
feat(lumi-index): reescribe agentes.rs contra el nuevo formato de ficha

Agente/Opcion sustituyen a Agente/SubPregunta: modo (eleccion|
transcripcion) reemplaza a tipo/restriccion/mapa/sub_preguntas, y cada
Opcion lleva sus propios países -- ya no hay una restricción con
nombre que resolver contra Atributos. aplicar() reponderan con
factor = 1 - peso*confianza por cada contradicción, sustituyendo a la
constante PENALIZACION=0.1/FACTOR_MINIMO. aplanar() desaparece (no
hay fusión que aplanar). Veredicto.confianza pasa a Option<f64> (None
en modo transcripción, spec §5: sin número inventado) y gana
apoyo_visual (spec §4: segunda lectura, no la misma cifra que la
confianza).

geo.rs pierde Koppen/TablaLado -- su único consumidor en todo el
workspace era agentes::aplicar, y las fichas nuevas ya no necesitan un
atributo "lado" intermedio (cada opción de lado-conduccion lista sus
países directamente). Atributos se reduce a { pais: Option<String> }.
koppen.bin y clima_koppen desaparecen (spec §1: sin agente que los
consuma, sale el único usuario del dataset Köppen).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Tarea 4 — Borrar el dataset Köppen de `registros/geo/`

**Files:**
- Modify: `registros/geo/registro.json` (quitar la entrada de `koppen`, si existe)
- Modify: `registros/geo/LEEME.md` (quitar instrucciones de `koppen.bin`)

**Interfaces:**
- Consumes: nada (`geo.rs` de la Tarea 3 ya no lee `koppen.bin`, así que esta tarea es
  limpieza de datos/documentación, no afecta compilación).

- [ ] **Paso 1: Revisar y editar `registros/geo/registro.json`**

```bash
cat registros/geo/registro.json
```

Si trae una entrada con `"id": "koppen"` dentro de `"recursos"`, quitarla del array
(dejando la de `paises` intacta). Si el fichero real (visto en la investigación previa)
no trae `fichero_url` para koppen porque nunca se rellenó, puede que la entrada exista
solo como placeholder — se quita igual, ya no hay código que la lea.

- [ ] **Paso 2: Editar `registros/geo/LEEME.md`**

```bash
grep -n -i koppen registros/geo/LEEME.md
```

Quitar cualquier párrafo/instrucción sobre cómo obtener o convertir `koppen.bin` (dataset
de Beck et al., 0.5° de resolución, 720×360 bytes). Dejar intactas las instrucciones de
`paises.json` y `lado.json`.

- [ ] **Paso 3: Commit**

```bash
git add registros/geo/registro.json registros/geo/LEEME.md
git commit -m "$(cat <<'EOF'
docs(geo): retira las instrucciones y la entrada de koppen.bin

Sin ningún agente que dependa de clima_koppen (Tarea 3), koppen.bin
deja de tener lector -- se retira su entrada del registro de recursos
geo y las instrucciones de LEEME.md para obtenerlo.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Tarea 5 — `crates/lumi-proto/src/worker.rs`: contrato `Msg::Agente` sin `rasgos`, `confianza` opcional, `apoyo_visual` nuevo

**Files:**
- Modify: `crates/lumi-proto/src/worker.rs`

**Interfaces:**
- Produces: `Msg::Agente { id, agente, etiqueta, confianza: Option<f64>, detalle: String,
  alternativas: Vec<(String, f64)>, apoyo_visual: Option<f64>, respuesta_cruda:
  Option<String> }` — sin `rasgos`. Consumido por la Tarea 6
  (`workers/lumi_agentes.py::escribir`) y la Tarea 7 (`crates/lumid`, que traduce este
  mensaje a `agentes::Veredicto` y a la fila de `analysis_agents`).

- [ ] **Paso 1: Quitar `CajaOcr` y `Rasgos`**

Localizar el bloque exacto:

```bash
grep -n "struct CajaOcr" -B 4 crates/lumi-proto/src/worker.rs
grep -n "enum Rasgos" -A 8 crates/lumi-proto/src/worker.rs
```

Borrar ambos structs/enum completos (el comentario que los precede incluido) — desde el
comentario de `CajaOcr` (*"Un recuadro OCR..."*) hasta el cierre de `Rasgos` (línea
`Profundidad { png_base64: String },` seguida de `}`).

- [ ] **Paso 2: Editar el campo `rasgos` y `confianza` dentro de `Msg::Agente`**

Buscar:

```bash
grep -n "Agente {" -A 30 crates/lumi-proto/src/worker.rs | head -40
```

El bloque actual (según la investigación previa) es de esta forma — reemplazar
`confianza: f64` por `confianza: Option<f64>`, borrar el campo `rasgos: Option<Rasgos>`
(con su comentario) y añadir `apoyo_visual: Option<f64>` justo después de
`alternativas`:

```rust
    Agente {
        id: i64,
        agente: String,
        etiqueta: String,
        /// `None` en modo transcripción -- no hay conjunto cerrado sobre el
        /// que normalizar (spec 2026-09-17 §5). En modo elección, la
        /// probabilidad softmax de la opción ganadora.
        #[serde(default)]
        confianza: Option<f64>,
        /// Texto libre para el investigador: el texto transcrito en modo
        /// transcripción, o vacío en modo elección.
        #[serde(default)]
        detalle: String,
        /// La distribución completa, cuando el motor la calcula de verdad.
        /// Vacía en modo transcripción.
        #[serde(default)]
        alternativas: Vec<(String, f64)>,
        /// Cuánto sube la imagen la evidencia de la opción ganadora frente a
        /// no verla -- spec 2026-09-17 §4, la segunda lectura del veredicto,
        /// no la misma cifra que `confianza`. `None` en modo transcripción.
        #[serde(default)]
        apoyo_visual: Option<f64>,
        /// Ver `lumi_index::agentes::Veredicto::respuesta_cruda`. `None`
        /// salvo que `modo_calibracion` estuviera activo en el momento del
        /// análisis.
        #[serde(default)]
        respuesta_cruda: Option<String>,
    },
```

(Conservar `confianza` NO está acotada aquí sigue siendo cierto, y se compara contra el
`umbral` del agente en `lumi_index::agentes::aplicar` — mantener esa nota si existía en
el comentario original de `confianza`, adaptada a `Option<f64>`.)

- [ ] **Paso 3: Actualizar los tests del propio fichero**

Localizar:

```bash
grep -n "fn.*agente\|Msg::Agente" crates/lumi-proto/src/worker.rs
```

Los dos tests vistos en la investigación (uno con JSON mínimo, otro con
`rasgos:{"tipo":"ocr",...}`) hay que reescribirlos:

```rust
    #[test]
    fn agente_minimo_deserializa() {
        let ag: Msg = serde_json::from_str(
            r#"{"tipo":"agente","id":3,"agente":"escritura","etiqueta":"griego","confianza":0.9}"#,
        )
        .unwrap();
        assert_eq!(
            ag,
            Msg::Agente {
                id: 3,
                agente: "escritura".into(),
                etiqueta: "griego".into(),
                confianza: Some(0.9),
                detalle: String::new(),
                alternativas: Vec::new(),
                apoyo_visual: None,
                respuesta_cruda: None,
            }
        );
    }

    #[test]
    fn agente_completo_deserializa() {
        let ag_completo: Msg = serde_json::from_str(
            r#"{"tipo":"agente","id":4,"agente":"escritura","etiqueta":"latino","confianza":0.8,
                "alternativas":[["latino",0.8],["cirilico",0.2]],"apoyo_visual":2.3}"#,
        )
        .unwrap();
        assert_eq!(
            ag_completo,
            Msg::Agente {
                id: 4,
                agente: "escritura".into(),
                etiqueta: "latino".into(),
                confianza: Some(0.8),
                detalle: String::new(),
                alternativas: vec![("latino".into(), 0.8), ("cirilico".into(), 0.2)],
                apoyo_visual: Some(2.3),
                respuesta_cruda: None,
            }
        );
    }

    #[test]
    fn agente_en_modo_transcripcion_no_trae_confianza() {
        let ag: Msg = serde_json::from_str(
            r#"{"tipo":"agente","id":5,"agente":"toponimos","etiqueta":"Calle Mayor","detalle":"Calle Mayor"}"#,
        )
        .unwrap();
        assert_eq!(
            ag,
            Msg::Agente {
                id: 5,
                agente: "toponimos".into(),
                etiqueta: "Calle Mayor".into(),
                confianza: None,
                detalle: "Calle Mayor".into(),
                alternativas: Vec::new(),
                apoyo_visual: None,
                respuesta_cruda: None,
            }
        );
    }
```

Reemplazar los tests viejos por estos tres (buscar sus nombres exactos con
`grep -n "#\[test\]" crates/lumi-proto/src/worker.rs` cerca de las líneas 326-369 vistas
en la investigación, y sustituir ese bloque).

- [ ] **Paso 4: Compilar y correr los tests**

```bash
cargo test -p lumi-proto 2>&1 | tail -40
```

Esperado: falla en cualquier otro crate que todavía construya `Msg::Agente { rasgos:
... }` o `confianza: <f64 literal>` sin `Some(...)` — son exactamente los sitios que
arregla la Tarea 7 (`crates/lumid`). No hacer commit de esos otros crates todavía; sí
comitear `lumi-proto` solo si compila y sus propios tests pasan de forma aislada:

```bash
cargo check -p lumi-proto
```

- [ ] **Paso 5: Commit**

```bash
git add crates/lumi-proto/src/worker.rs
git commit -m "$(cat <<'EOF'
feat(lumi-proto): Msg::Agente sin rasgos, confianza opcional, apoyo_visual

rasgos/Rasgos/CajaOcr desaparecen del contrato -- sin OCR ni
profundidad como motores de agentes, no queda productor (spec
2026-09-17 §7). confianza pasa a Option<f64>: None en modo
transcripción, donde cualquier número sería inventado (spec §5).
apoyo_visual es la segunda lectura del veredicto que pide el spec §4:
cuánto sube la imagen la evidencia de la opción ganadora frente a no
verla, una cifra distinta de la confianza y no la misma con otro
nombre.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Tarea 6 — `workers/lumi_motores.py`: `Vlm` contrastivo + `transcribir`, fuera `Ocr`/`Profundidad`

**Files:**
- Modify: `workers/lumi_motores.py` (reescritura casi completa)

**Interfaces:**
- Consumes: la ficha nueva (Tarea 1: `modo`, `opciones[].verbalizador`, `pregunta`), el
  campo `cuantizacion` de `registros/motores/qwen3-vl.json` (Tarea 1 paso 6).
- Produces: `Vlm.__init__(self, pesos_dir, dispositivo, motor_id)` (el directorio de
  pesos ya no es el literal `"qwen3-vl"`, lo pasa quien construye el motor — Tarea 7),
  `Vlm.responder(self, agente, ruta_imagen) -> (etiqueta_id_o_None, confianza,
  alternativas, apoyo_visual)`, `Vlm.transcribir(self, agente, ruta_imagen) -> str`,
  `CLASES = {"vlm": Vlm, "upscalador": Upscalador}`, `cargar_motor(clase, motor_id,
  pesos_dir, dispositivo)` (gana el parámetro `motor_id`).

- [ ] **Paso 1: Reescribir el fichero completo**

```python
#!/usr/bin/env python3
"""Los motores que atienden a los agentes.

Un único VLM (Qwen3-VL) contesta las preguntas de elección cerrada Y las de
transcripción libre -- desde el rediseño de 2026-09-17, PaddleOCR y Depth
Anything V2 salen del catálogo (spec 2026-09-17 §6): el propio VLM lee texto
igual de bien y la "forma del espacio" nunca dio una señal geográfica real
sin escala métrica conocida.

Licencias, todas comprobadas antes de entrar y todas permisivas por decision
de producto (ver la spec del 5b: si no permite uso comercial, no entra):

  - Qwen3-VL          Apache-2.0
  - Real-ESRGAN       BSD-3-Clause (no es un motor de agentes, ver Upscalador)

La comprobacion de LICENCIA.txt es la de `lumi_pesos`, sin excepcion. Qwen3-VL
es un repositorio ENTERO de HuggingFace, no un fichero sha256'd a mano (se
instala con huggingface_hub.snapshot_download, ver workers/lumi_bajar.py) --
la integridad de cada fichero la verifica el propio hub, no un sha256 propio
de este proyecto.
"""
import base64
import io
import os

from lumi_pesos import _licencia


def _directorio(pesos_dir, nombre):
    d = os.path.join(pesos_dir, nombre)
    _licencia(d)
    return d


class Vlm(object):
    """Qwen3-VL. Dos modos, decididos por `agente["modo"]` -- nunca por el id
    del agente, ver spec 2026-09-17 §2 ("el motor no contiene ni un solo `if`
    sobre el id de un agente"):

    - `"eleccion"`: la confianza sale de contrastar, por cada opción, la
      verosimilitud de su verbalizador CON la imagen frente a SIN ella --
      spec §3. Un modelo que dice "por la derecha" con la misma probabilidad
      mirando la foto que a ciegas no está aportando conocimiento, y eso es
      justo lo que antes producía respuestas seguras y falsas (puntuar solo
      con la imagen, sin la resta).
    - `"transcripcion"`: generación normal, sin número de confianza -- no hay
      conjunto cerrado sobre el que normalizar (spec §5).
    """

    def __init__(self, pesos_dir, dispositivo, motor_id, cuantizacion=None):
        import torch
        from transformers import AutoModelForImageTextToText, AutoProcessor

        d = _directorio(pesos_dir, motor_id)
        self.dispositivo = dispositivo
        self.proc = AutoProcessor.from_pretrained(d)
        kwargs = dict(low_cpu_mem_usage=True, device_map=dispositivo)
        if cuantizacion == "4bit" and dispositivo != "cpu":
            from transformers import BitsAndBytesConfig
            # 4 bits es lo que hace caber el 8B (spec 2026-09-17 §6: ~5.5GB
            # frente a los ~8GB del 4B en fp16) en los 12GB de una RTX 4070
            # SUPER con margen -- margen que hace falta porque leer carteles
            # obliga a subir la resolución de imagen de entrada, que infla
            # los tokens de imagen por pase.
            kwargs["quantization_config"] = BitsAndBytesConfig(
                load_in_4bit=True, bnb_4bit_compute_dtype=torch.float16)
        else:
            kwargs["dtype"] = torch.float16 if dispositivo != "cpu" else torch.float32
        self.red = AutoModelForImageTextToText.from_pretrained(d, **kwargs)
        self.red.eval()

    def _plantilla(self, pregunta, con_imagen):
        contenido = [{"type": "text", "text": pregunta}]
        if con_imagen:
            contenido.insert(0, {"type": "image"})
        mensajes = [{"role": "user", "content": contenido}]
        return self.proc.apply_chat_template(mensajes, add_generation_prompt=True)

    def _log_verosimilitud(self, texto_prompt, verbalizador, img):
        """Suma (NO media) de log-verosimilitud de los tokens del propio
        `verbalizador` bajo `texto_prompt` -- spec 2026-09-17 §3: "nunca una
        media sobre la secuencia entera". Se enmascara el prefijo con `-100`
        (que la pérdida de HF ignora) para que ni la plantilla de chat ni los
        tokens de imagen ni la pregunta entren en la cuenta -- es el mismo
        arreglo que ya funcionaba en `_puntuar_subrespuesta` del diseño
        anterior, aquí generalizado al camino normal. `img` es `None` para la
        pasada sin imagen."""
        import torch

        if img is not None:
            entrada_prefijo = self.proc(text=[texto_prompt], images=[img], return_tensors="pt")
            entrada = self.proc(text=[texto_prompt + verbalizador], images=[img], return_tensors="pt")
        else:
            entrada_prefijo = self.proc(text=[texto_prompt], return_tensors="pt")
            entrada = self.proc(text=[texto_prompt + verbalizador], return_tensors="pt")
        n_prefijo = entrada_prefijo["input_ids"].shape[1]
        n_verbalizador = entrada["input_ids"].shape[1] - n_prefijo
        if n_verbalizador <= 0:
            return 0.0
        entrada = {k: v.to(self.dispositivo) for k, v in entrada.items()}
        labels = entrada["input_ids"].clone()
        labels[:, :n_prefijo] = -100
        with torch.no_grad():
            salida = self.red(**entrada, labels=labels)
        # `loss` de HF es la MEDIA de log-verosimilitud negativa sobre los
        # tokens no enmascarados -- se multiplica de vuelta por su cuenta
        # para obtener la SUMA, que es lo que pide el spec.
        return -float(salida.loss) * n_verbalizador

    def responder(self, agente, ruta_imagen):
        """Modo `eleccion`. Devuelve `(etiqueta_id, confianza, alternativas,
        apoyo_visual)`, o `(None, 0.0, [], None)` si la ficha no trae
        opciones. `apoyo_visual` es la evidencia (con imagen − sin imagen) de
        la opción GANADORA, sin normalizar -- spec §4, la segunda lectura del
        veredicto."""
        import torch
        from PIL import Image

        opciones = agente.get("opciones") or []
        if not opciones:
            return (None, 0.0, [], None)
        img = Image.open(ruta_imagen).convert("RGB")
        pregunta = agente["pregunta"]
        texto_con_imagen = self._plantilla(pregunta, con_imagen=True)
        texto_sin_imagen = self._plantilla(pregunta, con_imagen=False)

        evidencias = []
        for opcion in opciones:
            verbalizador = opcion["verbalizador"]
            con_img = self._log_verosimilitud(texto_con_imagen, verbalizador, img)
            sin_img = self._log_verosimilitud(texto_sin_imagen, verbalizador, None)
            evidencias.append(con_img - sin_img)

        t = torch.tensor(evidencias)
        probs = torch.softmax(t, dim=0).tolist()
        i = max(range(len(probs)), key=lambda k: probs[k])
        alternativas = sorted(
            ((opciones[k]["id"], probs[k]) for k in range(len(opciones))), key=lambda par: -par[1])
        return (opciones[i]["id"], probs[i], alternativas, evidencias[i])

    def transcribir(self, agente, ruta_imagen):
        """Modo `transcripcion`. Generación normal, sin puntuar nada --
        devuelve el texto tal cual, o cadena vacía si el modelo no generó
        nada legible."""
        from PIL import Image

        img = Image.open(ruta_imagen).convert("RGB")
        texto = self._plantilla(agente["pregunta"], con_imagen=True)
        entrada = self.proc(text=[texto], images=[img], return_tensors="pt")
        entrada = {k: v.to(self.dispositivo) for k, v in entrada.items()}
        salida = self.red.generate(**entrada, max_new_tokens=120, do_sample=False)
        generado = self.proc.batch_decode(
            salida[:, entrada["input_ids"].shape[1]:], skip_special_tokens=True)[0].strip()
        return generado


class Upscalador(object):
    """Real-ESRGAN (o equivalente, ver `registros/motores/real-esrgan.json`):
    entra una imagen, sale una versión de mayor resolución generada por un
    modelo real. No es un motor de agentes -- ninguna ficha de
    `registros/agentes/` lo usa -- vive aquí por compartir el mismo patrón de
    carga bajo demanda que `Vlm` (`workers/lumi_upscale.py::_motor`), sujeto
    al mismo desalojo por inactividad/presión.

    ponytail: sin acceso de red para bajar un peso real en este entorno, el
    `fichero_url`/`sha256` de `real-esrgan.json` se han dejado vacíos a
    propósito -- `_directorio()` hace que instanciar esta clase falle con un
    motivo legible ("sin LICENCIA.txt") hasta que alguien rellene esos campos
    y baje el peso de verdad."""

    def __init__(self, pesos_dir, dispositivo, motor_id):
        d = _directorio(pesos_dir, motor_id)
        self.dispositivo = dispositivo
        self.dir = d
        import glob
        pesos = glob.glob(os.path.join(d, "*.pth")) + glob.glob(os.path.join(d, "*.safetensors"))
        if not pesos:
            raise RuntimeError(
                "sin peso instalado para real-esrgan -- rellena fichero_url/sha256 en "
                "registros/motores/real-esrgan.json y descárgalo antes de activar upscaler_activo")
        self._ruta_peso = pesos[0]

    def procesar(self, ruta_entrada, ruta_salida):
        raise RuntimeError("real-esrgan sin peso real instalado -- ver docstring de Upscalador")


CLASES = {"vlm": Vlm, "upscalador": Upscalador}


def cargar_motor(clase, motor_id, pesos_dir, dispositivo, cuantizacion=None):
    if clase not in CLASES:
        raise ValueError("no hay motor «%s»" % clase)
    if clase == "vlm":
        return Vlm(pesos_dir, dispositivo, motor_id, cuantizacion=cuantizacion)
    return CLASES[clase](pesos_dir, dispositivo, motor_id)
```

`base64`/`io` quedan importados sin usar en este fichero tras quitar
`Profundidad._mapa_de_calor` — quitar esos dos imports si ningún otro sitio del fichero
los usa (comprobar con `grep -n "base64\.\|io\." workers/lumi_motores.py` tras el
reemplazo; si no aparecen, borrar las dos líneas `import base64`/`import io` del
principio).

- [ ] **Paso 2: Comprobación de sintaxis (sin GPU, solo parseo)**

```bash
python3 -m py_compile workers/lumi_motores.py && echo OK
```

- [ ] **Paso 3: Commit**

```bash
git add workers/lumi_motores.py
git commit -m "$(cat <<'EOF'
feat(workers): Vlm contrastivo, transcribir(), fuera Ocr/Profundidad

Vlm.responder() puntúa cada opción por
logP(verbalizador|imagen,pregunta) - logP(verbalizador|pregunta), suma
sobre los tokens del propio verbalizador (nunca media), y hace softmax
sobre esa evidencia contrastiva -- no sobre la verosimilitud cruda
(spec 2026-09-17 §3). Vlm.transcribir() es generación normal sin
puntuar nada, para modo: transcripcion (spec §5). Ocr/Profundidad
desaparecen (PaddleOCR y Depth Anything V2 salen del catálogo, spec
§6); Upscalador se mantiene, no es un motor de agentes. cargar_motor
gana motor_id: ya no hay un directorio de pesos hardcodeado
("qwen3-vl") -- lo decide el registro (registros/motores/*.json).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Tarea 7 — `workers/lumi_agentes.py`: sin fusión, motor leído del registro

**Files:**
- Modify: `workers/lumi_agentes.py`

**Interfaces:**
- Consumes: `Vlm.responder`/`Vlm.transcribir` (Tarea 6), fichas planas (Tarea 1).
- Produces: el mismo contrato de líneas JSON por stdout que ya consumen la Tarea 8
  (`crates/lumid`), ahora sin `sub_preguntas`/ids con punto, con `confianza` que puede
  faltar (`None`/omitida) en modo transcripción y `apoyo_visual` nuevo.

- [ ] **Paso 1: Reemplazar el fichero completo**

```python
#!/usr/bin/env python3
"""El trabajador de agentes: una foto entra, un veredicto por agente sale.

Mismo contrato que el resto -- JSON por lineas sobre stdin/stdout, stderr es
el log y no tiene contrato. La orden trae los IDS de los agentes y no sus
fichas: el registro lo lee este proceso, igual que `lumi_pesos` lee el de
modelos. Asi la pregunta de un agente se corrige editando un JSON y nadie
recompila nada.

Ocho fichas en el registro desde el rediseño de 2026-09-17 (antes seis,
tres de ellas fusionadas con sub_preguntas) -- ahora cada ficha es un
agente independiente, sin fusión ni ids compuestos: un veredicto por
agente pedido, siempre. `lumi_index::agentes` ya no tiene ninguna función
`aplanar` que consumir."""
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from lumi_motores import cargar_motor

REGISTRO = os.environ.get("LUMI_REGISTRO_AGENTES", "registros/agentes")
REGISTRO_MOTORES = os.environ.get("LUMI_REGISTRO_MOTORES", "registros/motores")
PESOS = os.environ.get("LUMI_PESOS", "pesos")
#: Segura por defecto -- activa salvo que se ponga explicitamente a "0", igual
#: criterio que ya usa el proyecto para otros flags. Se lee una sola vez al
#: arrancar el proceso, no en cada orden.
LIMPIEZA_PRESION = os.environ.get("LUMI_LIMPIEZA_PRESION", "1") != "0"


def escribir(msg):
    sys.stdout.write(json.dumps(msg, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def registro():
    fuera = {}
    if not os.path.isdir(REGISTRO):
        return fuera
    for nombre in sorted(os.listdir(REGISTRO)):
        if not nombre.endswith(".json"):
            continue
        try:
            with open(os.path.join(REGISTRO, nombre), encoding="utf-8") as f:
                d = json.load(f)
            fuera[d["id"]] = d
        except Exception as e:
            # Un fichero malo cuesta un agente, nunca la lista.
            print("agente descartado, %s: %s" % (nombre, e), file=sys.stderr)
    return fuera


def _registro_motores():
    """`{clase: (motor_id, cuantizacion_o_None)}` -- el primer motor de cada
    clase que aparezca en orden alfabético de fichero, igual criterio de
    desempate que ya usa `lumi_index::agentes::motores_de_agentes` en Rust
    (hoy siempre hay como mucho uno por clase, así que el desempate no
    importa en la práctica)."""
    fuera = {}
    if not os.path.isdir(REGISTRO_MOTORES):
        return fuera
    for nombre in sorted(os.listdir(REGISTRO_MOTORES)):
        if not nombre.endswith(".json"):
            continue
        try:
            with open(os.path.join(REGISTRO_MOTORES, nombre), encoding="utf-8") as f:
                d = json.load(f)
            fuera.setdefault(d["clase"], (d["id"], d.get("cuantizacion")))
        except Exception as e:
            print("motor descartado, %s: %s" % (nombre, e), file=sys.stderr)
    return fuera


def dispositivo():
    explicito = os.environ.get("LUMI_DEVICE")
    if explicito:
        return explicito
    try:
        import torch
        if torch.cuda.is_available():
            return "cuda"
    except Exception:
        pass
    return "cpu"


# Los motores se cargan una sola vez y solo los que hagan falta. Vive a nivel
# de modulo para que sobreviva entre iteraciones del bucle de `sys.stdin`.
_motores = {}
_ultimo_uso = {}


def _motor(clase, disp):
    if clase not in _motores:
        import lumi_pesos
        for m in lumi_pesos.quizas_purgar_por_presion(_motores, _ultimo_uso, LIMPIEZA_PRESION):
            print("motor %s desalojado por presion de memoria" % m, file=sys.stderr)
        entrada = _registro_motores().get(clase)
        if entrada is None:
            print("motor %s fuera: sin entrada en el registro de motores" % clase, file=sys.stderr)
            _motores[clase] = None
        else:
            motor_id, cuantizacion = entrada
            try:
                _motores[clase] = cargar_motor(clase, motor_id, PESOS, disp, cuantizacion=cuantizacion)
            except Exception as e:
                print("motor %s fuera: %s" % (clase, e), file=sys.stderr)
                _motores[clase] = None
    if _motores[clase] is not None:
        _ultimo_uso[clase] = time.time()
    return _motores[clase]


def _procesar(orden, disp):
    if _motores:
        import lumi_pesos
        for m in lumi_pesos.purgar_inactivos(_motores, _ultimo_uso):
            print("motor %s desalojado por inactividad" % m, file=sys.stderr)

    id_analisis = orden["id"]
    consulta = orden["consulta"]
    fichas = registro()
    pedidos = [fichas[i] for i in orden.get("agentes", []) if i in fichas]
    calibracion_activo = os.environ.get("LUMI_MODO_CALIBRACION") == "1"

    for a in pedidos:
        # Único motor hoy (vlm), pero la clave sigue siendo "clase de motor"
        # y no "id de agente" -- si algún día vuelve a haber más de una
        # clase, esto no cambia.
        motor = _motor("vlm", disp)
        if motor is None:
            continue
        try:
            if a.get("modo") == "transcripcion":
                texto = motor.transcribir(a, consulta)
                if not texto:
                    continue
                escribir({
                    "tipo": "agente", "id": id_analisis, "agente": a["id"],
                    "etiqueta": texto[:400], "detalle": texto[:400],
                    "alternativas": [], "apoyo_visual": None,
                    "respuesta_cruda": None,
                })
                continue
            etiqueta_id, confianza, alternativas, apoyo_visual = motor.responder(a, consulta)
        except Exception as e:
            print("agente %s fallo: %s" % (a["id"], e), file=sys.stderr)
            continue
        if not etiqueta_id:
            continue
        escribir({
            "tipo": "agente", "id": id_analisis, "agente": a["id"],
            "etiqueta": etiqueta_id, "confianza": float(confianza), "detalle": "",
            "alternativas": [[e, float(p)] for e, p in (alternativas or [])],
            "apoyo_visual": float(apoyo_visual) if apoyo_visual is not None else None,
            "respuesta_cruda": json.dumps(alternativas) if calibracion_activo else None,
        })


def main():
    import lumi_pesos
    lumi_pesos._limitar_hilos()
    disp = dispositivo()
    escribir({"tipo": "listo", "dispositivo": disp, "modelo": None})

    for linea in sys.stdin:
        linea = linea.strip()
        if not linea:
            continue
        try:
            orden = json.loads(linea)
        except ValueError:
            print("linea ilegible, se ignora: %s" % linea[:120], file=sys.stderr)
            continue
        try:
            _procesar(orden, disp)
        except Exception as e:
            print("orden fallo: %s" % e, file=sys.stderr)
        escribir({"tipo": "fin", "id": orden.get("id", 0)})


if __name__ == "__main__":
    main()
```

Nota sobre `respuesta_cruda`: en el diseño viejo era el JSON compuesto que devolvía la
generación fusionada. Sin fusión, no hay un "crudo" de generación en modo elección (no
se genera texto, se puntúan verbalizadores) — se usa como sustituto honesto la propia
lista de `alternativas` serializada, que es justo lo que un calibrador querría inspeccionar
(la distribución completa que llevó a la decisión). En modo transcripción no hay
`respuesta_cruda` (el texto ya se ve entero en `detalle`).

- [ ] **Paso 2: Comprobación de sintaxis**

```bash
python3 -m py_compile workers/lumi_agentes.py && echo OK
```

- [ ] **Paso 3: Commit**

```bash
git add workers/lumi_agentes.py
git commit -m "$(cat <<'EOF'
feat(workers): lumi_agentes.py sin fusión ni sub_preguntas

Un veredicto por agente pedido, siempre -- sin ids compuestos con
punto ni reparto de un JSON fusionado. El motor se resuelve leyendo
registros/motores/*.json por clase (ya no hay un directorio de pesos
hardcodeado). modo: transcripcion escribe un veredicto sin confianza
(spec 2026-09-17 §5); modo: eleccion añade apoyo_visual al mensaje.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Tarea 8 — `crates/lumid`: adaptar rutas, cola y almacenamiento al nuevo contrato

Esta es la tarea de integración Rust más grande: todo lo que traduce `Msg::Agente` (ya
cambiado en la Tarea 5) hacia SQLite y hacia el cliente. Se investiga primero (los
ficheros exactos no se leyeron línea a línea en la fase de research de este plan) y
luego se corrige guiado por los errores de compilación, que son exhaustivos por
construcción: **nada de esto compila hasta terminar la tarea**, así que `cargo build`
es el checklist real.

**Files:**
- Modify: `crates/lumid/src/store.rs` (schema `analysis_agents`, columna `confianza`
  nullable, columna `rasgos` eliminada, columna `apoyo_visual` nueva, columna `tipo`
  eliminada si nada más la necesita)
- Modify: `crates/lumid/src/queue/mod.rs` (donde se construye `agentes::Veredicto` desde
  `Msg::Agente` y se llama a `agentes::aplicar`)
- Modify: cualquier ruta que serialice `analysis_agents` hacia el cliente (JSON con
  forma `DichoDeAgente`, buscar con grep)
- Modify: `crates/lumid/src/routes/agentes.rs` (`AgenteVista` sin `sub_preguntas`, con
  `icono`/`modo`, filtrado por `activo`)
- Modify: `crates/lumid/src/routes/calibracion.rs` (quitar 4b: `get_agente`,
  `patch_agente`, `agente_efectivo`, `clave_agente`, `AgenteVistaCalibracion`,
  `PatchAgenteReq`; conservar 4a intacto)
- Modify: `crates/lumid/src/routes/export.rs` (quitar `rasgos_graficos_de` y su uso)
- Modify: `crates/lumid/src/tasks.rs` (quitar la instalación de PaddleOCR)
- Modify: la migración de `analyses`/`analysis_agents` (vaciar ambas tablas una vez, ver
  Paso 6)

**Interfaces:**
- Consumes: `Msg::Agente` (Tarea 5), `agentes::Agente`/`Veredicto`/`aplicar` (Tarea 2).
- Produces: el JSON que consume la Tarea 11 (`DichoDeAgente` en `client/src/lib/api.ts`):
  mismos nombres de campo que ya usa el cliente hoy MENOS `rasgos`, con `confianza:
  number | null` y `apoyo_visual: number | null` añadido.

- [ ] **Paso 1: Localizar todos los sitios que tocar**

```bash
grep -rn "Msg::Agente\|analysis_agents\|agentes::Veredicto\|rasgos" crates/lumid/src \
  --include="*.rs" | grep -v "^crates/lumid/src/routes/calibracion.rs\|^crates/lumid/src/routes/agentes.rs"
```

Anotar cada fichero que aparezca. Basado en la investigación ya hecha, como mínimo
aparecerán `store.rs` (el `CREATE TABLE analysis_agents` visto: columnas `analysis_id,
agente, nombre, etiqueta, confianza, tipo, detalle, etiqueta_real` + `alternativas`/
`rasgos`/`respuesta_cruda` añadidas por `ALTER TABLE`), `queue/mod.rs` (el punto que ya
se vio en la Tarea 2/3, línea ~845, `geo.atributos(c.lat, c.lng)`, y el bucle que debe
recibir `Msg::Agente` y guardar `analysis_agents`), y probablemente un `routes/analyses.rs`
o similar que arme la respuesta JSON de un análisis (`DichoDeAgente`).

- [ ] **Paso 2: `store.rs` — columnas de `analysis_agents`**

Buscar el bloque:

```bash
grep -n "CREATE TABLE IF NOT EXISTS analysis_agents" -A 12 crates/lumid/src/store.rs
grep -n "ALTER TABLE analysis_agents" crates/lumid/src/store.rs
```

La tabla base (vista en la investigación) es:

```sql
CREATE TABLE IF NOT EXISTS analysis_agents (
    analysis_id INTEGER NOT NULL,
    agente      TEXT NOT NULL,
    nombre      TEXT NOT NULL,
    etiqueta    TEXT NOT NULL,
    confianza   REAL NOT NULL,
    tipo        TEXT NOT NULL,
    detalle     TEXT NOT NULL DEFAULT '',
    etiqueta_real TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (analysis_id, agente)
);
```

con `alternativas`/`rasgos`/`respuesta_cruda` añadidas después vía `ALTER TABLE ... ADD
COLUMN` idempotente (el patrón que documenta el comentario de línea 423-426 de ese
fichero: *"no hay tabla de versiones ni motor de migraciones... hasta que haga falta
transformar datos y no solo añadir columnas"*). Este cambio SÍ transforma datos
(`confianza` pasa a poder ser nula, `rasgos` se retira, `tipo` se retira si nada más lo
usa) — seguir el mismo patrón de columnas nuevas vía `ALTER TABLE`, y dejar
`confianza`/`tipo` como columnas muertas que ya no se escriben (SQLite no tiene `DROP
COLUMN` barato en versiones viejas; borrarlas de verdad es más riesgo que beneficio para
una tabla que además esta tarea vacía por completo en el Paso 6). Añadir:

```sql
ALTER TABLE analysis_agents ADD COLUMN apoyo_visual REAL;
```

junto a las demás `ALTER TABLE ... ADD COLUMN` ya existentes (mismo bloque, mismo
patrón de `let _ = conn.execute(...)` ignorando el error de "columna ya existe").
Cambiar el `INSERT`/función de guardado (buscar con
`grep -n "fn guardar_agentes\|INSERT INTO analysis_agents" crates/lumid/src/store.rs`)
para:
- Aceptar `confianza: Option<f64>` en vez de `f64` (columna `confianza` pasa a
  aceptar NULL: quitar `NOT NULL` de esa columna en el `CREATE TABLE` — solo afecta a
  bases de datos nuevas, las existentes se vacían en el Paso 6 así que no hace falta
  migrar filas viejas).
- Escribir `apoyo_visual` en el `INSERT`.
- Dejar de escribir `rasgos` (columna que ya no se lee ni se llena; puede quedar en el
  schema sin usarse, o borrarse del `INSERT` sin más — no hace falta un `ALTER TABLE ...
  DROP COLUMN` para esto).
- Dejar de escribir `tipo` con un valor real (si la función lo recibía como parámetro,
  quitar el parámetro; si la columna se queda en el schema por compatibilidad SQLite,
  escribir `""` fijo para no romper el `NOT NULL` existente).

- [ ] **Paso 3: `queue/mod.rs` — traducir `Msg::Agente` a `Veredicto` y guardar**

```bash
grep -n "Msg::Agente" crates/lumid/src/queue/mod.rs
```

En el sitio donde se hace *match* sobre `Msg::Agente { .. }` (el bucle que procesa la
salida del trabajador), construir:

```rust
let veredicto = lumi_index::agentes::Veredicto {
    agente: agente.clone(),
    etiqueta: etiqueta.clone(),
    confianza,       // ya Option<f64> desde Msg::Agente (Tarea 5)
    alternativas: alternativas.clone(),
    apoyo_visual,    // ya Option<f64> desde Msg::Agente (Tarea 5)
    respuesta_cruda: respuesta_cruda.clone(),
};
```

y pasar esa lista de veredictos a `agentes::aplicar(&agentes_registro, &veredictos,
&candidatos)` (la llamada que ya existe cerca de la línea 845, `geo.atributos(c.lat,
c.lng)` — solo cambia porque `Atributos` perdió `lado`/`koppen`, no la forma de la
llamada). Guardar el veredicto en la base con `store.guardar_agentes(...)` (o el nombre
real de la función, confirmado en el Paso 2) pasando `confianza`/`apoyo_visual` tal
cual, sin inventar `0.0` cuando son `None`.

`etiqueta_real` (columna que sigue existiendo, spec §3: *"se guarda como abstención,
conservando en `etiqueta_real` la opción que había ganado"*): se sigue rellenando igual
que hoy — la etiqueta ganadora del softmax, tanto si `confianza >= umbral` como si no
(el motor Python ya solo escribe un veredicto cuando hay etiqueta ganadora; quien decide
"abstiene" es esta capa Rust comparando `confianza` contra `agente.umbral`, igual que
antes comparaba contra `umbral_confianza`). Buscar dónde se hace esa comparación hoy
(`grep -n "umbral_confianza\|\"abstiene\"" crates/lumid/src/queue/mod.rs`) y actualizar
el nombre del campo a `umbral` (el de la Tarea 2).

- [ ] **Paso 4: `routes/agentes.rs` — `AgenteVista` sin fusión, con `icono`/`modo`, filtrada por `activo`**

Reemplazar el fichero completo:

```rust
//! Lista de agentes para la pantalla 1 del modo Agentes: quién existe en el
//! registro y si su motor ya está instalado en este servidor. Cualquier
//! sesión válida puede leerla.

use crate::routes::auth::{bearer, require_session};
use crate::App;
use axum::extract::State;
use axum::{http::HeaderMap, http::StatusCode, Json};

type Fail = (StatusCode, String);

#[derive(serde::Serialize)]
pub struct AgenteVista {
    pub id: String,
    pub nombre: String,
    pub icono: String,
    pub modo: String,
    /// `false` cuando el motor que este agente necesita no tiene sus pesos
    /// instalados en este servidor — la tarjeta se enseña bloqueada, no se
    /// retira de la lista.
    pub instalado: bool,
    /// El nombre del motor que hace falta descargar. `None` cuando
    /// `instalado` es `true`.
    pub requiere: Option<String>,
}

pub async fn listar(
    State(app): State<App>,
    headers: HeaderMap,
) -> Result<Json<Vec<AgenteVista>>, Fail> {
    require_session(&app, &bearer(&headers)).map_err(|c| (c, "sesión inválida".to_string()))?;

    let agentes = app.queue.agentes.lock().unwrap().clone();
    let motores = app.queue.motores.lock().unwrap().clone();
    let instalados = crate::routes::models::instalados_dir(&app);

    let fuera = agentes
        .into_iter()
        // Un agente que el banco de pruebas marcó "activo": false sigue en
        // el registro (se sigue evaluando) pero no se le ofrece al
        // investigador -- ver tools/evaluar_agentes.py.
        .filter(|a| a.activo)
        .map(|a| {
            let necesarios = lumi_index::agentes::motores_de_agentes(
                std::slice::from_ref(&a.id), std::slice::from_ref(&a), &motores,
            );
            let motor = motores.iter().find(|m| m.clase == "vlm");
            let instalado = necesarios.iter().all(|id| instalados.contains(id));
            AgenteVista {
                id: a.id,
                nombre: a.nombre,
                icono: a.icono,
                modo: a.modo,
                instalado,
                requiere: if instalado { None } else { motor.map(|m| m.nombre.clone()) },
            }
        })
        .collect();
    Ok(Json(fuera))
}
```

- [ ] **Paso 5: `routes/calibracion.rs` — quitar el editor de prompts (4b)**

Borrar del fichero: la sección completa desde el comentario `// --- 4b: prompts de
agentes editables` hasta el final (funciones `clave_agente`, `AgenteVistaCalibracion`,
`agente_efectivo`, `get_agente`, `PatchAgenteReq`, `patch_agente`). Conservar intacto
todo lo de 4a (`clave_umbral`, `VerificadorVista`, `listar_verificadores`, `UmbralVista`,
`PatchUmbralReq`, `get_umbral`, `patch_umbral`) y el doc-comment del módulo, editando la
frase *"4a (umbrales de verificación) y 4b (prompts de agentes) comparten el mismo
mecanismo"* para que solo hable de 4a:

```rust
//! Las herramientas de debug de calibración (spec 2026-09-10 §4a), detrás de
//! `modo_calibracion` (`routes::features`): con el interruptor apagado, cada
//! ruta de aquí contesta 403 con el mismo motivo, tanto para leer como para
//! escribir.
//!
//! Umbrales de verificación: un override en `Store` (clave meta), con
//! fallback al JSON del registro. El override es por-servidor, nunca se
//! escribe de vuelta al fichero ni se propaga a otra instalación (ver el
//! comentario de `verificar::construir_afinados`, que es quien de verdad LEE
//! el override de umbrales en el camino caliente).
//!
//! El editor de prompts de agentes (4b) que vivía aquí se retira en el
//! rediseño de 2026-09-17: nadie leía el override que guardaba (ni la cola,
//! que relee las fichas del disco, ni `workers/lumi_agentes.py`, que lee
//! `registros/agentes/` directamente) -- calibrar un agente ahora es editar
//! su JSON en el registro y reiniciar `lumid`, spec §9 ("las fichas siguen
//! siendo datos... esta vez de verdad").
```

Buscar en `crates/lumid/src/main.rs` (o donde se registren las rutas axum) las entradas
`get_agente`/`patch_agente` de `routes::calibracion` (`grep -rn "routes::calibracion::get_agente\|routes::calibracion::patch_agente" crates/lumid/src`)
y quitar esas dos líneas de la tabla de rutas, dejando las de umbrales intactas.

- [ ] **Paso 6: `routes/export.rs` — quitar `rasgos_graficos`**

```bash
grep -n "rasgos_graficos\|RasgoImgCtx" crates/lumid/src/routes/export.rs
```

Quitar: el campo `rasgos_graficos: Vec<RasgoImgCtx>` del contexto de plantilla y su
comentario, la función `rasgos_graficos_de()` completa, el struct `RasgoImgCtx` si vive
en este mismo fichero (si vive en otro, quitar su definición allí también), y la llamada
`rasgos_graficos: rasgos_graficos_de(...)` del ensamblado final — sustituir esa línea
simplemente quitándola del literal de struct (si el campo desaparece del contexto de
plantilla, la plantilla Tera/Handlebars que lo consuma también pierde esa variable:
`grep -rn "rasgos_graficos" crates/lumid/templates 2>/dev/null` o el directorio de
plantillas real, y quitar el bloque `{% if rasgos_graficos %}...{% endif %}`
correspondiente si existe). Los veredictos siguen exportándose tal cual (spec §7: "los
veredictos siguen exportándose").

- [ ] **Paso 7: `tasks.rs` — quitar la instalación de PaddleOCR**

```bash
grep -n "paddleocr\|paddle" crates/lumid/src/tasks.rs
```

Quitar el bloque `TaskKind` completo que instala `paddleocr==2.9.1`/`paddlepaddle==2.6.2`
y fuerza la descarga de sus pesos (visto en la investigación: líneas ~150-200, el script
`sh` con los tres `if`/`else` de "ya instalado"/instalar/descargar pesos, y su llamada con
`crate::assets::ruta("registros/motores/paddleocr.json")`). Revisar el comentario de
líneas ~59-65 (*"para el motor de agentes vlm/profundidad... paddleocr para su motor
ocr"*) y quitar la mención a `paddleocr`/`profundidad` si ya no aplica (solo queda
`transformers` para vlm). Depth Anything V2 no tenía entrada dedicada (confirmado en la
investigación: solo necesitaba `transformers`, ya cubierto), así que no hay nada que
quitar por ese lado en este fichero.

- [ ] **Paso 8: `cargo build` iterativo**

```bash
cargo build -p lumid 2>&1 | head -100
```

Corregir cada error de tipo/campo que aparezca (son mecánicos: `confianza: f64` donde
ahora hace falta `Option<f64>`, `rasgos: ...` en un literal de struct que ya no tiene ese
campo, `restriccion`/`mapa`/`tipo`/`sub_preguntas` en algún sitio que la Tarea 2/6 no
tocaron). Repetir hasta que compile limpio. Si aparece algún fichero no anticipado por
este plan (posible: un `routes/analyses.rs` que arma `DichoDeAgente` JSON con forma
explícita), aplicar el mismo criterio que el resto de esta tarea: quitar `rasgos`, hacer
`confianza` opcional, añadir `apoyo_visual`, quitar `sub_preguntas` si existe.

- [ ] **Paso 9: `cargo test -p lumid` (los tests que ya existan, sin añadir nuevos) y `cargo test -p lumi-index`**

```bash
cargo test -p lumid -p lumi-index 2>&1 | tail -100
```

- [ ] **Paso 10: Commit**

```bash
git add crates/lumid crates/lumi-index
git commit -m "$(cat <<'EOF'
feat(lumid): integra el contrato nuevo de agentes en cola/rutas/export

analysis_agents gana apoyo_visual y confianza nullable (sin
transformar filas viejas -- la Tarea de migración las vacía aparte).
routes/agentes.rs pierde sub_preguntas y filtra por activo; el editor
de prompts de calibración (4b) se retira porque nadie leía sus
overrides (4a, umbrales, se conserva intacto). export.rs deja de
incluir rasgos como imagen -- sin OCR ni profundidad no hay qué
dibujar. tasks.rs deja de instalar PaddleOCR.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Tarea 9 — Migración: vaciar `analyses`/`analysis_agents`

**Files:**
- Modify: el módulo de arranque/migraciones de `crates/lumid` (buscar dónde viven las
  demás `ALTER TABLE ... ADD COLUMN` idempotentes de `store.rs`, o el `actualizacion.rs`
  visto en la investigación si el vaciado debe ir ligado a una versión concreta)

**Interfaces:**
- Consumes: nada nuevo.
- Produces: un `lumi.db` con `analyses`/`analysis_agents` vacías tras el primer arranque
  de la versión que incluye este cambio, después de la copia de seguridad que ya hace el
  daemon por versión (`crates/lumid/src/actualizacion.rs::aplicar`, paso 4, visto en la
  investigación — `VACUUM INTO` con nombre `lumi.db.bak-<version>-<timestamp>`).

- [ ] **Paso 1: Añadir el vaciado al arranque, una sola vez, guardado por bandera en `meta`**

Localizar dónde se aplican las `ALTER TABLE` idempotentes hoy:

```bash
grep -n "ALTER TABLE analysis_agents\|ALTER TABLE analyses" crates/lumid/src/store.rs
```

Justo después de la última `ALTER TABLE` de ese bloque, añadir (mismo patrón de
`let _ = conn.execute(...)` que el resto, pero guardado tras una bandera para que no se
repita en cada arranque):

```rust
// Migración de un solo uso (spec 2026-09-17 §8): los análisis de agentes
// existentes están producidos por el diseño roto (confianza plana, ids con
// punto de la fusión) y no hay forma de reinterpretarlos con el formato
// nuevo -- se vacían tras la copia de seguridad que `actualizacion::aplicar`
// ya hace por versión. Guardado en `meta` para que no se repita en cada
// arranque: un servidor que ya pasó por aquí una vez no debe perder
// análisis nuevos en el siguiente reinicio.
if conn.query_row(
    "SELECT value FROM meta WHERE key = 'migracion_agentes_2026_09_17'", [], |r| r.get::<_, String>(0),
).is_err() {
    conn.execute("DELETE FROM analysis_agents", []).ok();
    conn.execute(
        "DELETE FROM analyses WHERE id IN (SELECT DISTINCT analysis_id FROM analysis_agents) OR model = 'agentes'",
        [],
    ).ok();
    conn.execute(
        "INSERT OR REPLACE INTO meta (key, value) VALUES ('migracion_agentes_2026_09_17', '1')", [],
    ).ok();
    log::info!("migración 2026-09-17: análisis de agentes vaciados (diseño anterior, sin veredicto reinterpretable)");
}
```

Nota: el `DELETE FROM analyses WHERE ... OR model = 'agentes'` cubre tanto los análisis
que ya tuvieran filas en `analysis_agents` como los que estuvieran `pendiente`/`en_curso`
en el momento del corte (sin filas de veredicto todavía, pero igual de irrecuperables
porque el trabajador que los procese ya hablará el protocolo nuevo). Confirmar el nombre
real de la columna `model` en `analyses` con
`grep -n "CREATE TABLE IF NOT EXISTS analyses" -A 15 crates/lumid/src/store.rs` antes de
pegar este bloque — la investigación previa ya la vio como `model` (línea 142-155 del
fichero), así que debería coincidir tal cual.

- [ ] **Paso 2: Compilar y comprobar en una base de pruebas**

```bash
cargo build -p lumid
# Prueba manual rápida: arrancar lumid contra una copia de lumi.db con
# análisis viejos (si existe una a mano en el entorno de desarrollo) y
# comprobar en el log la línea "migración 2026-09-17" una sola vez, no en
# arranques siguientes.
```

- [ ] **Paso 3: Commit**

```bash
git add crates/lumid/src/store.rs
git commit -m "$(cat <<'EOF'
feat(lumid): vacía analyses/analysis_agents una vez (rediseño agentes)

Los análisis existentes están producidos por agentes rotos y arrastran
ids en formato antiguo (con punto, de la fusión) -- spec 2026-09-17
§8: sin compatibilidad hacia atrás que mantener, se vacían tras la
copia de seguridad de lumi.db que el daemon ya hace por versión.
Guardado en meta para que la migración corra una sola vez.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Tarea 10 — `client/src/lib/api.ts`: tipos nuevos

**Files:**
- Modify: `client/src/lib/api.ts`

**Interfaces:**
- Produces: `AgenteVista { id, nombre, icono, modo, instalado, requiere }`,
  `DichoDeAgente` sin `rasgos`/`tipo`, con `confianza: number | null` y
  `apoyo_visual: number | null`. Consumido por las Tareas 11-13.

- [ ] **Paso 1: Quitar `CajaOcr`/`Rasgos`, editar `DichoDeAgente` y `AgenteVista`**

Localizar el bloque exacto (visto en la investigación, líneas ~385-411 y ~443-455):

```bash
grep -n "export interface CajaOcr\|export type Rasgos\|export interface DichoDeAgente\|export interface AgenteVista" client/src/lib/api.ts
```

Reemplazar desde `export interface CajaOcr` hasta el cierre de `DichoDeAgente` por:

```ts
/** Un veredicto de agente tal como se guardó. `etiqueta` vale `"abstiene"`
 *  cuando el agente corrió y no vio señal suficiente. */
export interface DichoDeAgente {
  agente: string; nombre: string; etiqueta: string;
  /** `null` en modo transcripción -- no hay conjunto cerrado sobre el que
   *  normalizar (spec 2026-09-17 §5), nunca un número inventado. */
  confianza: number | null;
  detalle: string;
  /** La etiqueta que el motor realmente eligió, aunque no llegara al umbral
   *  y `etiqueta` valga `"abstiene"` -- para mostrar "lo más parecido".
   *  Igual a `etiqueta` cuando no se abstiene; vacía en análisis viejos. */
  etiqueta_real: string;
  /** La distribución completa, ordenada, cuando el motor la calcula de
   *  verdad. Vacía en modo transcripción. */
  alternativas: [string, number][];
  /** Cuánto sube la imagen la evidencia de la opción ganadora frente a no
   *  verla (spec 2026-09-17 §4) -- una lectura aparte de `confianza`, no la
   *  misma cifra con otro nombre. `null` en modo transcripción. */
  apoyo_visual: number | null;
  /** El texto/JSON exacto que devolvió el motor, solo con `modo_calibracion`
   *  activo en el momento del análisis. */
  respuesta_cruda: string | null;
}
```

Y el bloque de `AgenteVista` (visto en la investigación, líneas ~443-455) por:

```ts
/** Un agente del registro, con su estado de instalación en ESTE servidor —
 *  ver `GET /v1/agentes` (`crates/lumid/src/routes/agentes.rs`). */
export interface AgenteVista {
  id: string; nombre: string;
  /** Nombre a resolver contra el set de SVG dibujados a mano de
   *  `AgenteIcono.tsx`. */
  icono: string;
  modo: "eleccion" | "transcripcion";
  instalado: boolean;
  /** El nombre del motor que hace falta descargar. `null` cuando
   *  `instalado` es `true`. */
  requiere: string | null;
}
```

- [ ] **Paso 2: Compilar TypeScript**

```bash
cd client && npx tsc -b --noEmit 2>&1 | head -120
```

Esperado: errores en `AgenteIcono.tsx`, `AgentPickerPopup.tsx`, `AgentResultPopup.tsx`
(usan `Rasgos`/`sub_preguntas`/`.pregunta`/`.etiquetas` que ya no existen). Son
exactamente los que arreglan las Tareas 11-13. No hacer commit de esos ficheros
todavía; sí de `api.ts` si el resto del árbol permite ver que el tipo en sí está bien
formado (`tsc` seguirá listando errores en otros ficheros, es esperado).

- [ ] **Paso 3: Commit**

```bash
cd "E:\Lumi Station\.claude\worktrees\agent-ab7b2bfab383301b1"
git add client/src/lib/api.ts
git commit -m "$(cat <<'EOF'
feat(client): tipos AgenteVista/DichoDeAgente para el rediseño de agentes

AgenteVista pierde motor/pregunta/etiquetas/umbral_confianza/
sub_preguntas y gana icono/modo (spec 2026-09-17 §7: el picker ya no
necesita el prompt ni el conjunto de etiquetas, solo qué dibujar y si
es de elección o transcripción). DichoDeAgente.confianza pasa a
number|null (null en modo transcripción) y gana apoyo_visual; Rasgos/
CajaOcr desaparecen -- sin OCR ni profundidad no queda productor.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Tarea 11 — `client/src/work/AgenteIcono.tsx`: iconos por el campo `icono`, no por id

**Files:**
- Modify: `client/src/work/AgenteIcono.tsx` (reescritura completa)

**Interfaces:**
- Consumes: el prop `icono` en vez de resolver por `agente` (id). Firma nueva:
  `AgenteIcono({ icono, etiqueta, apagado, size }: { icono: string; etiqueta?: string;
  apagado: boolean; size?: number })`. **Rompe** la firma vieja (`agente: string` en vez
  de `icono: string`) a propósito — las Tareas 12-13 actualizan sus tres call-sites.

- [ ] **Paso 1: Reemplazar el fichero completo**

```tsx
import { Icon } from "../ui/Icon";

/** Icono propio por agente — no una plantilla repetida con el icono
 *  cambiado (DESIGN.md prohíbe rejillas de tarjetas idénticas). Compartido
 *  entre el popup de resultado y el selector del modo Agentes.
 *
 *  Se resuelve por el campo `icono` de la ficha (`registros/agentes/*.json`),
 *  nunca por el `id` del agente -- añadir un agente nuevo no debería tocar
 *  este fichero salvo que quiera un dibujo que no exista todavía (spec
 *  2026-09-17 §7).
 *
 *  `hora-solar` es el único cuyo dibujo depende del dato real: la aguja rota
 *  al ángulo estimado a partir de la hora que dice `etiqueta` ("mediodia" →
 *  12h). El resto son formas fijas, sin dato detrás. */
export function AgenteIcono({ icono, etiqueta, apagado, size = 26 }: {
  icono: string; etiqueta?: string; apagado: boolean; size?: number;
}) {
  const color = apagado ? "#6a6c70" : "#e8e8e6";

  if (icono === "hora-solar") {
    const HORAS: Record<string, number> = {
      amanecer: 7, "media-manana": 10, mediodia: 12, "media-tarde": 15, atardecer: 18, noche: 22,
    };
    const hora = etiqueta && etiqueta in HORAS ? HORAS[etiqueta] : 12;
    const grados = (hora - 12) * 15;
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.7}
        strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
        <circle cx="12" cy="12" r="8.5" />
        <line x1="12" y1="12" x2="12" y2="6" transform={`rotate(${grados} 12 12)`}
          style={{ transition: "transform 1.1s cubic-bezier(.16,1,.3,1)" }} />
        <circle cx="12" cy="12" r=".6" fill={color} stroke="none" />
      </svg>
    );
  }
  if (icono === "volante") {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.7}
        strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
        <circle cx="12" cy="12" r="8" />
        <circle cx="12" cy="12" r="2" />
        <path d="M12 6v4M8.5 15.5 10.5 13M15.5 15.5 13.5 13" />
      </svg>
    );
  }
  if (icono === "escritura") {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.7}
        strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
        <path d="M4 19V8l4-4h8l4 4v11" />
        <path d="M8 19v-6h8v6M9 9h6" />
      </svg>
    );
  }
  if (icono === "meteorologia") {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.7}
        strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
        <path d="M6 14a4 4 0 0 1 .8-7.9 5.5 5.5 0 0 1 10.6 1.4A3.5 3.5 0 0 1 17 14z" />
        <path d="M8 18v2M12 18.5v2M16 18v2" />
      </svg>
    );
  }
  if (icono === "vegetacion") {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.7}
        strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
        <path d="M12 3 8 9h2.5L7 15h4v6h2v-6h4l-3.5-6H16z" />
      </svg>
    );
  }
  if (icono === "matricula") {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.7}
        strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
        <rect x="3" y="8" width="18" height="8" rx="1.5" />
        <path d="M6.5 12h3M12 12h5.5" />
      </svg>
    );
  }
  if (icono === "senalizacion") {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.7}
        strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
        <path d="M12 4 21 20H3Z" />
        <path d="M12 10v3.5" />
        <circle cx="12" cy="16.3" r=".55" fill={color} stroke="none" />
      </svg>
    );
  }
  if (icono === "toponimos") {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.7}
        strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
        <circle cx="10" cy="10" r="6.5" />
        <path d="M7.3 8.3h5.4M7.3 11.3h3.4" />
        <path d="M14.8 14.8 20 20" />
      </svg>
    );
  }
  // Icono futuro sin dibujo propio todavía: bocadillo genérico, nunca un
  // hueco en blanco.
  return <Icon name="bocadillo" size={size} className={apagado ? "text-subtle" : "text-fg"} />;
}
```

- [ ] **Paso 2: Comprobar (aislado) que compila el fichero**

```bash
cd client && npx tsc -b --noEmit 2>&1 | grep AgenteIcono
```

Esperado: sin errores propios de este fichero (los de sus call-sites, en
`AgentPickerPopup.tsx`/`AgentResultPopup.tsx`, se resuelven en las Tareas 12-13).

- [ ] **Paso 3: Commit**

```bash
git add client/src/work/AgenteIcono.tsx
git commit -m "$(cat <<'EOF'
feat(client): AgenteIcono resuelve por el campo icono, no por id

Sustituye la cadena de comparaciones contra ids de agente (spec
2026-09-17 §7) -- ocho dibujos para las ocho fichas del catálogo
nuevo, sin el caso especial de agente fusionado ("<fusionado>.<sub>")
que ya no existe. Añadir un agente nuevo con un icono ya dibujado deja
de tocar este fichero.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Tarea 12 — `client/src/work/AgentPickerPopup.tsx`: sin fusión, rejilla dinámica

**Files:**
- Modify: `client/src/work/AgentPickerPopup.tsx`

**Interfaces:**
- Produces: `etiquetaCortaDe` se retira (era solo para sub-preguntas de agentes
  fusionados, que ya no existen) — la Tarea 13 deja de importarlo.

- [ ] **Paso 1: Quitar `ETIQUETAS_CORTAS`/`etiquetaCortaDe` y simplificar `RejillaAgentes`**

Reemplazar desde el comentario `/** Etiqueta corta para una sub-pregunta...` hasta el
cierre de `etiquetaCortaDe` (líneas 127-145 de la versión leída) por nada — se borra el
bloque entero.

Reemplazar la función `RejillaAgentes` completa (líneas 159-218 de la versión leída)
por:

```tsx
function RejillaAgentes({ agentes, seleccionados, onAlternar, isAdmin, onIrAModelos }: {
  agentes: AgenteVista[] | null;
  seleccionados: Set<string>;
  onAlternar: (id: string) => void;
  isAdmin: boolean;
  onIrAModelos: () => void;
}) {
  if (!agentes) {
    return <p className="mt-5 text-[12px] text-muted">Cargando el registro…</p>;
  }
  if (agentes.length === 0) {
    return <p className="mt-5 text-[12px] text-muted">Este servidor no trae ningún agente.</p>;
  }
  return (
    <div className="mt-4 grid max-h-[380px] grid-cols-2 gap-2 overflow-y-auto pr-0.5">
      {agentes.map((a) => {
        const on = seleccionados.has(a.id);
        return (
          <div key={a.id}
            onClick={() => a.instalado && onAlternar(a.id)}
            className={`flex gap-2.5 rounded-xl border p-3 transition-colors duration-300 ease-expo
              ${a.instalado ? "jg-press cursor-pointer" : "cursor-default hover:border-white/20"}
              ${on ? "border-fg bg-white/[.06]" : "border-border bg-panel"}`}>
            <div className="shrink-0 pt-0.5">
              <AgenteIcono icono={a.icono} apagado={!a.instalado} size={18} />
            </div>
            <div className="min-w-0 flex-1">
              <div className={`text-[12.5px] font-medium ${a.instalado ? "text-fg" : "text-muted"}`}>{a.nombre}</div>
              <p className={`mt-0.5 text-[10.5px] ${a.instalado ? "text-muted" : "text-subtle"}`}>
                {a.modo === "transcripcion" ? "Lee texto de la imagen" : "Pregunta cerrada a la imagen"}
              </p>
              {!a.instalado && (
                <div className="mt-1.5 flex items-center gap-2">
                  <span className="font-mono text-[9.5px] text-subtle">requiere {a.requiere ?? "un motor"}</span>
                  {isAdmin && (
                    <button onClick={(e) => { e.stopPropagation(); onIrAModelos(); }}
                      className="jg-press rounded-md border border-white/15 px-1.5 py-0.5 text-[9.5px] text-fg
                        hover:border-fg">
                      Descargar
                    </button>
                  )}
                </div>
              )}
            </div>
            {on && <Icon name="check" size={12} className="shrink-0 self-start text-fg" />}
          </div>
        );
      })}
    </div>
  );
}
```

(La rejilla ya era `grid-cols-2` con scroll dinámico, no una 2×3 fija — el spec §7 lo
describe como si hubiera que cambiarla, pero la investigación de este mismo plan
confirmó que ya era dinámica; este paso no toca el layout, solo el contenido de cada
tarjeta.)

- [ ] **Paso 2: Comprobar compilación aislada**

```bash
cd client && npx tsc -b --noEmit 2>&1 | grep AgentPickerPopup
```

- [ ] **Paso 3: Commit**

```bash
git add client/src/work/AgentPickerPopup.tsx
git commit -m "$(cat <<'EOF'
feat(client): AgentPickerPopup sin fusión ni etiquetas cortas

ETIQUETAS_CORTAS/etiquetaCortaDe desaparecen -- eran solo para las
sub-preguntas de un agente fusionado, que ya no existe (spec
2026-09-17 §7). Cada tarjeta enseña si es una pregunta cerrada o una
transcripción, en vez de repetir el prompt en inglés.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Tarea 13 — `client/src/work/AgentResultPopup.tsx`: sin rasgos ni fusión, apoyo visual y confianza opcional

**Files:**
- Modify: `client/src/work/AgentResultPopup.tsx`

**Interfaces:**
- Consumes: `DichoDeAgente` (Tarea 10), `AgenteIcono({ icono, ... })` (Tarea 11).
- Produces: sin `PantallaResultadoFusionado`/`rasgosVisibles`/toggle de rasgos — todo
  análisis de agente es de un único veredicto ahora (`analysis.agentes` siempre tiene
  como mucho una entrada por análisis, salvo el caso ya existente de selección múltiple
  entre agentes DISTINTOS, que sigue igual vía `PantallaGrupo`).

- [ ] **Paso 1: Quitar el estado y el toggle de rasgos del componente raíz**

En `AgentResultPopup` (la función exportada), quitar la línea
`const [rasgosVisibles, setRasgosVisibles] = useState(true);` y, en el JSX que renderiza
`PantallaResultado`, quitar las props `rasgosVisibles`/`onToggleRasgos`:

```tsx
              {unico ? (
                <PantallaResultado image={image} analysis={unico}
                  agentePedido={unico.agente} motor={agenteActual?.motor ?? null}
                  elapsedS={elapsedS} />
              ) : (
```

(`motor` aquí pasa a ser un string fijo `"qwen3-vl-8b"` conceptualmente, pero el tipo se
deja como estaba —`agenteActual?.motor`— y como `AgenteVista` ya no trae `motor` desde
la Tarea 10, cambiar esa expresión a un literal fijo, ver Paso 2.)

- [ ] **Paso 2: `AgenteVista` perdió `motor` — arreglar los dos sitios que lo leían**

```bash
grep -n "agenteActual?.motor\|\.motor\b" client/src/work/AgentResultPopup.tsx
```

`AgenteVista.motor` ya no existe (Tarea 10). Sustituir `agenteActual?.motor ?? null` por
el literal `"qwen3-vl-8b"` en ambos sitios donde se pasaba `motor={...}` a
`PantallaResultado`, y quitar el prop `motor` de `PantallaResultado`/
`PantallaResultadoFusionado` si se prefiere simplificar — más simple todavía (ponytail):
dejar el prop `motor: string` en las firmas tal cual, pasando siempre el literal
`"qwen3-vl-8b"` desde el único call-site. No hace falta leerlo de ningún sitio dinámico
porque solo hay un motor de agentes en todo el catálogo (spec §6).

- [ ] **Paso 3: Reescribir `PantallaResultado` sin rasgos, con `confianza`/`apoyo_visual` opcionales**

Reemplazar la función completa (líneas 235-414 de la versión leída) por:

```tsx
function PantallaResultado({ image, analysis, agentePedido, motor, elapsedS }: {
  image: Image;
  analysis: Analysis;
  agentePedido: string | null;
  motor: string;
  elapsedS: number | null;
}) {
  if (analysis.state === "pendiente" || analysis.state === "en_curso") {
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-center"
        style={{ animation: "jg-fade-rise 300ms cubic-bezier(.16,1,.3,1) both" }}>
        <span className="relative grid h-9 w-9 place-items-center">
          <span className="absolute inset-0 rounded-full bg-white/[.08]"
            style={{ animation: "jg-alert-pulse 1.6s ease-in-out infinite" }} />
          <Icon name="spinner" size={19} className="relative text-muted" />
        </span>
        <p key={fraseDeEspera(elapsedS)} className="text-[12px] text-muted"
          style={{ animation: "jg-fade-rise 240ms ease-expo both" }}>
          {fraseDeEspera(elapsedS)}
        </p>
      </div>
    );
  }
  if (analysis.state === "error" || analysis.agentes.length === 0) {
    return (
      <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-border bg-panel p-4"
        style={{ animation: "jg-fade-rise 260ms ease-expo both" }}>
        <Icon name="alert" size={15} className="mt-px shrink-0 text-warning-fg" />
        <p className="text-[12px] leading-relaxed text-muted">
          {analysis.error ?? "El agente no contestó a tiempo."}
        </p>
      </div>
    );
  }

  const dicho = analysis.agentes.find((d) => d.agente === agentePedido) ?? analysis.agentes[0];
  const esTranscripcion = dicho.confianza === null;

  if (esTranscripcion) {
    return (
      <div className="mt-4 grid grid-cols-[1.4fr_1fr] gap-0 overflow-hidden rounded-xl border border-border bg-panel"
        style={{ animation: "jg-fade-rise 280ms cubic-bezier(.16,1,.3,1) both" }}>
        <div className="relative aspect-[3/2] bg-elevated">
          <img src={lumiUrl(`/v1/images/${image.id}/thumb`)} alt="" className="h-full w-full object-cover" />
        </div>
        <div className="flex flex-col gap-4 p-6">
          <div className="flex items-center gap-2.5 rounded-lg bg-white/[.03] p-2"
            style={{ animation: "jg-fade-rise 280ms ease-expo both 40ms" }}>
            <img src={lumiUrl(`/v1/images/${image.id}/thumb`)} alt=""
              className="h-9 w-11 shrink-0 rounded object-cover" />
            <div className="min-w-0">
              <div className="truncate font-mono text-[10.5px] text-fg">{image.filename}</div>
              <div className="mt-0.5 font-mono text-[9px] text-subtle">motor · {motor}</div>
            </div>
          </div>
          <div style={{ animation: "jg-fade-rise 280ms ease-expo both 90ms" }}>
            <WidgetAgente agenteId={dicho.agente} dicho={dicho} />
          </div>
        </div>
      </div>
    );
  }

  const abstiene = dicho.etiqueta === "abstiene";
  const mejorEtiqueta = abstiene ? (dicho.etiqueta_real || dicho.etiqueta) : dicho.etiqueta;
  const filas: [string, number][] = dicho.alternativas.length > 0
    ? dicho.alternativas
    : [[mejorEtiqueta, dicho.confianza ?? 0]];
  const maxPeso = Math.max(...filas.map(([, p]) => p), 1e-9);

  return (
    <div className="mt-4 grid grid-cols-[1.4fr_1fr] gap-0 overflow-hidden rounded-xl border border-border bg-panel"
      style={{ animation: "jg-fade-rise 280ms cubic-bezier(.16,1,.3,1) both" }}>
      <div className="relative aspect-[3/2] bg-elevated">
        <img src={lumiUrl(`/v1/images/${image.id}/thumb`)} alt=""
          className="h-full w-full object-cover" />
      </div>

      <div className="flex flex-col gap-4 p-6">
        <div className="flex items-center gap-2.5 rounded-lg bg-white/[.03] p-2"
          style={{ animation: "jg-fade-rise 280ms ease-expo both 40ms" }}>
          <img src={lumiUrl(`/v1/images/${image.id}/thumb`)} alt=""
            className="h-9 w-11 shrink-0 rounded object-cover" />
          <div className="min-w-0">
            <div className="truncate font-mono text-[10.5px] text-fg">{image.filename}</div>
            <div className="mt-0.5 font-mono text-[9px] text-subtle">motor · {motor}</div>
          </div>
        </div>

        {abstiene ? (
          <>
            <div className="flex items-start gap-2.5 rounded-xl border border-border bg-black/[.1] p-3.5"
              style={{ animation: "jg-fade-rise 280ms ease-expo both 90ms" }}>
              <Icon name="alert" size={14} className="mt-px shrink-0 text-warning-fg" />
              <p className="text-[12px] leading-relaxed text-muted">
                No se pudo determinar <b className="text-warning-fg">{dicho.nombre.toLowerCase()}</b> con
                suficiente confianza.
              </p>
            </div>
            {mejorEtiqueta && (
              <FilasDeConfianza filas={filas} maxPeso={maxPeso} titulo="Lo más cercano" colorGanador="bg-warning-fg" />
            )}
          </>
        ) : (
          <>
            <div style={{ animation: "jg-fade-rise 280ms ease-expo both 90ms" }}>
              <WidgetAgente agenteId={dicho.agente} dicho={dicho} />
            </div>
            <FilasDeConfianza filas={filas} maxPeso={maxPeso}
              titulo={dicho.alternativas.length > 0 ? "Hipótesis" : ""} colorGanador="bg-fg" />
            {dicho.apoyo_visual !== null && <ApoyoVisual valor={dicho.apoyo_visual} />}
            <div className="mt-auto flex items-center gap-1.5 border-t border-border pt-3"
              style={{ animation: "jg-fade-rise 280ms ease-expo both 220ms" }}>
              <Icon name="check" size={12} className="text-fg" />
              <span className="text-[10.5px] text-fg">verificado por {motor}</span>
            </div>
            {dicho.respuesta_cruda && <VerCrudo texto={dicho.respuesta_cruda} />}
          </>
        )}
      </div>
    </div>
  );
}

/** Las filas de confianza por opción -- sustituye al bloque `filas.map(...)`
 *  que antes se repetía dos veces (abstención/no abstención) casi idéntico. */
function FilasDeConfianza({ filas, maxPeso, titulo, colorGanador }: {
  filas: [string, number][]; maxPeso: number; titulo: string; colorGanador: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      {titulo && <p className="text-[9px] uppercase tracking-[.08em] text-subtle">{titulo}</p>}
      {filas.map(([etq, p], i) => (
        <div key={etq} className="flex flex-col gap-1"
          style={{ animation: `jg-fade-rise 280ms ease-expo both ${140 + i * 45}ms` }}>
          <div className="flex items-baseline justify-between gap-2">
            <span className={`text-[12.5px] ${i === 0 ? "font-medium text-fg" : "text-muted"}`}>{etq}</span>
            <span className="font-mono text-[10.5px] text-subtle">{Math.round(p * 100)}%</span>
          </div>
          <div className="h-[3px] overflow-hidden rounded-full bg-elevated">
            <div className={`h-full rounded-full transition-[width] duration-500 ease-expo ${i === 0 ? colorGanador : "bg-subtle"}`}
              style={{ width: `${Math.max(6, (p / maxPeso) * 100)}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

/** La segunda lectura del veredicto (spec 2026-09-17 §4): cuánto sube la
 *  imagen la evidencia de la respuesta ganadora frente a no verla. Un
 *  apoyo bajo con confianza alta se marca como poco fiable -- es
 *  precisamente la advertencia que el diseño anterior no podía dar. */
function ApoyoVisual({ valor }: { valor: number }) {
  const bajo = valor < 1.0;
  return (
    <div className={`flex items-center gap-2 rounded-lg border px-2.5 py-2 text-[10.5px]
      ${bajo ? "border-warning-fg/40 bg-warning-fg/[.06] text-warning-fg" : "border-border bg-black/[.1] text-muted"}`}>
      <Icon name={bajo ? "alert" : "check"} size={11} className="shrink-0" />
      <span>
        {bajo
          ? "La imagen apenas respalda esta respuesta frente a no verla."
          : "La imagen respalda claramente esta respuesta."}
        <span className="ml-1.5 font-mono text-[9.5px] opacity-70">apoyo {valor.toFixed(2)}</span>
      </span>
    </div>
  );
}
```

- [ ] **Paso 4: Quitar `PantallaResultadoFusionado` y su uso**

Localizar y borrar la función `PantallaResultadoFusionado` completa (líneas 439-507 de
la versión leída) y, dentro de `PantallaResultado` (que ya se reescribió en el Paso 3
sin esa rama), confirmar que no queda ninguna llamada a `subRespuestas`/
`agentePedido.startsWith`. Quitar también el import de `etiquetaCortaDe` de
`AgentPickerPopup` en la cabecera del fichero si ya no se usa en ningún otro sitio
(`grep -n "etiquetaCortaDe" client/src/work/AgentResultPopup.tsx`).

- [ ] **Paso 5: Arreglar `PantallaGrupo` y `WidgetAgente`**

`PantallaGrupo` (líneas 157-202 de la versión leída) usa `AgenteIcono agente={...}` y
`Math.round(d.confianza * 100)` — cambiar a `AgenteIcono icono={reg?.icono ?? "bocadillo"}`
y a `d.confianza !== null ? Math.round(d.confianza * 100) : null` (mostrando `"texto"` en
vez de un porcentaje cuando es `null`):

```tsx
                    <div key={d.agente} className="flex items-center justify-between gap-2 pl-[26px]">
                      <span className={`truncate text-[11.5px] ${abstiene ? "text-subtle italic" : "text-fg"}`}>
                        {abstiene
                          ? (mejorEtiqueta ? `¿${mejorEtiqueta}? (sin confianza suficiente)` : "sin suficiente confianza")
                          : (d.detalle || d.etiqueta)}
                      </span>
                      <span className="shrink-0 font-mono text-[10px] text-subtle">
                        {d.confianza !== null ? `${Math.round(d.confianza * 100)}%` : "texto"}
                      </span>
                    </div>
```

y en la cabecera de `PantallaGrupo`, `<AgenteIcono agente={a.agente ?? ""} .../>` pasa a
`<AgenteIcono icono={reg?.icono ?? "bocadillo"} apagado={corriendo || fallo} size={18} />`.

`WidgetAgente` (líneas 208-223) usa `<AgenteIcono agente={agenteId} etiqueta={dicho.etiqueta} .../>`
y necesita el `icono` de la ficha, no el id — cambiar su firma para recibir `icono`
directamente en vez de derivarlo dentro:

```tsx
function WidgetAgente({ icono, dicho }: { icono: string; dicho: DichoDeAgente }) {
  const detalleLargo = dicho.agente === "toponimos" && dicho.detalle.length > 0;
  return (
    <div className="flex items-center gap-3 rounded-md border border-border bg-black/[.15] p-3">
      <AgenteIcono icono={icono} etiqueta={dicho.etiqueta} apagado={false} size={24} />
      <div className="min-w-0 flex-1">
        <div className="text-[9px] uppercase tracking-[.06em] text-subtle">
          {detalleLargo ? "texto detectado" : "respuesta"}
        </div>
        <div className={`mt-0.5 text-fg ${detalleLargo ? "font-mono text-[11px] leading-relaxed" : "text-[14px]"}`}>
          {detalleLargo ? dicho.detalle : dicho.etiqueta}
        </div>
      </div>
    </div>
  );
}
```

y sus dos call-sites (dentro de `PantallaResultado`, Paso 3) pasan a
`<WidgetAgente icono={agentesRegistro?/* ver nota */} dicho={dicho} />` — como
`PantallaResultado` no recibe hoy la lista de agentes del registro, la forma más simple
(ponytail) es que `AgentResultPopup` (el componente raíz) le pase el `icono` ya
resuelto: añadir un prop `icono: string` a `PantallaResultado` (junto a `motor`) con
valor `agenteActual?.icono ?? "bocadillo"`, y usar ese prop en las dos llamadas a
`WidgetAgente` del Paso 3 en vez de recalcularlo.

- [ ] **Paso 6: Compilar TypeScript del proyecto entero**

```bash
cd client && npx tsc -b --noEmit 2>&1 | head -100
```

Corregir cualquier resto (tipos de `filas`, props que falten) hasta que compile limpio.

- [ ] **Paso 7: Commit**

```bash
cd "E:\Lumi Station\.claude\worktrees\agent-ab7b2bfab383301b1"
git add client/src/work/AgentResultPopup.tsx
git commit -m "$(cat <<'EOF'
feat(client): AgentResultPopup sin rasgos ni fusión, apoyo visual

Se retira el toggle de rasgos (cajas OCR / mapa de profundidad) y
PantallaResultadoFusionado -- ningún agente fusiona ya sub-preguntas.
modo: transcripcion muestra el texto sin barra de confianza (spec
2026-09-17 §5). ApoyoVisual muestra la segunda lectura del veredicto
(spec §4): un veredicto con confianza alta pero apoyo visual bajo se
marca como poco fiable en vez de presentarse igual que uno sólido.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Tarea 14 — `client/src/admin/CalibracionView.tsx`: quitar `PromptsEditor`

**Files:**
- Modify: `client/src/admin/CalibracionView.tsx`

**Interfaces:**
- Consumes: nada nuevo (el endpoint `GET /v1/admin/agentes/:id` que consumía ya no
  existe desde la Tarea 8, paso 5).

- [ ] **Paso 1: Quitar la sección "Prompts de agentes" y la función `PromptsEditor`**

En el JSX de `CalibracionView` (dentro del bloque `flags.modo_calibracion ? (...)`),
quitar la línea `<PromptsEditor token={token} />`. Borrar la función `PromptsEditor`
completa (líneas 290-395 de la versión leída). Quitar el import de `AgenteVista` de la
cabecera si ya no se usa en ningún otro sitio del fichero
(`grep -n "AgenteVista" client/src/admin/CalibracionView.tsx`).

- [ ] **Paso 2: Ajustar la nota de "respuesta cruda"**

El bloque *"Respuesta cruda del modelo"* (líneas 85-92 de la versión leída) describía el
comportamiento de un "agente VLM fusionado" — actualizar el texto para que no mencione
fusión:

```tsx
          <div className="rounded-xl border border-border bg-panel p-3.5">
            <p className="text-[11.5px] text-fg">Respuesta cruda del modelo</p>
            <p className="mt-1 text-[10.5px] leading-relaxed text-muted">
              Con este modo activo, cada veredicto nuevo de un agente en modo elección
              guarda la distribución completa que calculó el motor antes de decidir. Se
              enseña en el propio popup de resultado del agente, en una sección
              colapsada "Ver crudo" bajo el card.
            </p>
          </div>
```

- [ ] **Paso 3: Compilar**

```bash
cd client && npx tsc -b --noEmit 2>&1 | grep CalibracionView
```

- [ ] **Paso 4: Commit**

```bash
cd "E:\Lumi Station\.claude\worktrees\agent-ab7b2bfab383301b1"
git add client/src/admin/CalibracionView.tsx
git commit -m "$(cat <<'EOF'
feat(client): retira PromptsEditor de CalibracionView

Sin backend que lo respalde (Tarea 8: get_agente/patch_agente se
retiraron, nadie leía los overrides que guardaban). Los umbrales de
verificación (4a) y el resto del panel de calibración se conservan.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Tarea 15 — `tools/evaluar_agentes.py`: banco de pruebas con verdad conocida

**Files:**
- Create: `tools/evaluar_agentes.py`
- Create: `pruebas/agentes/verdad.json` (esqueleto vacío, con el formato documentado —
  las fotos reales las pone el propietario fuera del repositorio, spec §6)
- Create: `pruebas/agentes/LEEME.md`

**Interfaces:**
- Consumes: `registros/agentes/*.json` (Tarea 1), `workers/lumi_motores.py::Vlm`/
  `workers/lumi_agentes.py::_registro_motores` (Tareas 6-7).
- Produces: `python tools/evaluar_agentes.py <carpeta>` — imprime una tabla con acierto
  condicionado, cobertura, calibración y coste por agente, y un veredicto ✓/✗ contra el
  mínimo (0.70 acierto, 0.20 cobertura).

- [ ] **Paso 1: Escribir `pruebas/agentes/LEEME.md`**

```markdown
# Banco de pruebas de agentes

`verdad.json` referencia, por nombre de fichero, fotos con verdad conocida que
NO viven en este repositorio (pesan, y no todas son publicables). Coloca las
fotos en un directorio aparte (p. ej. `E:\lumi-pruebas-agentes\`) y corre:

```bash
python tools/evaluar_agentes.py E:\lumi-pruebas-agentes
```

## Formato de `verdad.json`

```json
{
  "fotos": [
    {
      "fichero": "atenas-01.jpg",
      "pais": "GRC",
      "verdad": { "escritura": "griego", "lado-conduccion": "derecha" }
    }
  ]
}
```

- `fichero`: nombre exacto dentro del directorio pasado al script (no una ruta).
- `pais`: ISO3 del lugar real -- se usa para saber si la opción que ganó un
  agente de elección era la correcta según su propio mapa `paises` (spec §6:
  "acierto condicionado" es "de las veces que contesta, cuántas acierta").
- `verdad`: opcional por agente, la etiqueta correcta esperada cuando se
  conoce con certeza (más estricto que solo comprobar el país -- útil para
  `escritura`/`lado-conduccion`, donde la etiqueta correcta es inequívoca).
  Un agente sin entrada en `verdad` para esa foto se evalúa solo por país.

## Los dos números que decide

Un agente entra activo por defecto si acierto condicionado ≥ 0.70 con
cobertura ≥ 0.20 (spec 2026-09-17 §6). Si el banco dice que no llega, edita
su ficha en `registros/agentes/<id>.json` y pon `"activo": false` a mano --
el script nunca escribe en el registro.
```

- [ ] **Paso 2: Escribir el esqueleto de `pruebas/agentes/verdad.json`**

```json
{
  "fotos": []
}
```

- [ ] **Paso 3: Escribir `tools/evaluar_agentes.py`**

```python
#!/usr/bin/env python3
"""Banco de pruebas de agentes con verdad conocida (spec 2026-09-17 §6).

Uso: python tools/evaluar_agentes.py <carpeta-de-fotos>

Corre todos los agentes activos del registro sobre todas las fotos de
`pruebas/agentes/verdad.json` que existan de verdad en <carpeta-de-fotos>, y
reporta por agente: acierto condicionado, cobertura, calibración y coste.
Es de solo lectura -- nunca reescribe una ficha. Un agente por debajo del
mínimo (acierto >= 0.70 con cobertura >= 0.20) se marca con una advertencia;
apagarlo es un "activo": false manual en su JSON.
"""
import json
import os
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "workers"))

ACIERTO_MINIMO = 0.70
COBERTURA_MINIMA = 0.20


def _registro_agentes():
    dir_ = os.path.join(ROOT, "registros", "agentes")
    fuera = []
    for nombre in sorted(os.listdir(dir_)):
        if not nombre.endswith(".json"):
            continue
        with open(os.path.join(dir_, nombre), encoding="utf-8") as f:
            a = json.load(f)
        if a.get("activo", True):
            fuera.append(a)
    return fuera


def _registro_motor_vlm():
    dir_ = os.path.join(ROOT, "registros", "motores")
    for nombre in sorted(os.listdir(dir_)):
        if not nombre.endswith(".json"):
            continue
        with open(os.path.join(dir_, nombre), encoding="utf-8") as f:
            m = json.load(f)
        if m.get("clase") == "vlm":
            return m
    return None


def _verdad():
    p = os.path.join(ROOT, "pruebas", "agentes", "verdad.json")
    with open(p, encoding="utf-8") as f:
        return json.load(f).get("fotos", [])


def _opcion_correcta_por_pais(agente, pais):
    """La opción (si hay exactamente una) cuyo `paises` incluye `pais` --
    `None` si ninguna o más de una coinciden (un país cubierto por varias
    opciones no da una verdad inequívoca por sí solo, y se salta esa foto
    para ese agente en vez de arriesgar un falso acierto/fallo)."""
    candidatas = [o["id"] for o in agente.get("opciones", []) if pais in o.get("paises", [])]
    return candidatas[0] if len(candidatas) == 1 else None


def evaluar(carpeta):
    from lumi_motores import Vlm

    agentes = _registro_agentes()
    motor_info = _registro_motor_vlm()
    if motor_info is None:
        print("sin motor vlm en el registro -- nada que evaluar", file=sys.stderr)
        return 1
    fotos = [f for f in _verdad() if os.path.isfile(os.path.join(carpeta, f["fichero"]))]
    if not fotos:
        print("ninguna foto de verdad.json existe en %s" % carpeta, file=sys.stderr)
        return 1

    dispositivo = "cuda" if _hay_cuda() else "cpu"
    motor = Vlm(os.path.join(ROOT, "pesos"), dispositivo, motor_info["id"],
                cuantizacion=motor_info.get("cuantizacion"))

    filas = []
    for a in agentes:
        if a.get("modo") != "eleccion":
            print("%-16s  transcripción, sin métrica de acierto (spec §5)" % a["id"])
            continue
        contesta = 0
        acierta = 0
        suma_confianza_cuando_acierta = 0.0
        suma_confianza_cuando_falla = 0.0
        t0 = time.time()
        for foto in fotos:
            ruta = os.path.join(carpeta, foto["fichero"])
            etiqueta_id, confianza, _, _ = motor.responder(a, ruta)
            if etiqueta_id is None or confianza < a.get("umbral", 0.5) or etiqueta_id == "indeterminado":
                continue
            contesta += 1
            esperado = foto.get("verdad", {}).get(a["id"]) or _opcion_correcta_por_pais(a, foto.get("pais", ""))
            if esperado is None:
                continue
            if etiqueta_id == esperado:
                acierta += 1
                suma_confianza_cuando_acierta += confianza
            else:
                suma_confianza_cuando_falla += confianza
        coste = (time.time() - t0) / len(fotos)
        cobertura = contesta / len(fotos)
        acierto = acierta / contesta if contesta else 0.0
        calibracion = (suma_confianza_cuando_acierta / acierta) if acierta else None
        ok = acierto >= ACIERTO_MINIMO and cobertura >= COBERTURA_MINIMA
        filas.append((a["id"], acierto, cobertura, calibracion, coste, ok))

    print("\n%-16s  %8s  %10s  %11s  %8s  %s" % ("agente", "acierto", "cobertura", "calibración", "s/foto", "veredicto"))
    for id_, acierto, cobertura, calibracion, coste, ok in filas:
        cal = "%.2f" % calibracion if calibracion is not None else "n/d"
        marca = "✓ activo" if ok else "✗ por debajo del mínimo"
        print("%-16s  %7.0f%%  %9.0f%%  %11s  %7.1fs  %s" % (id_, acierto * 100, cobertura * 100, cal, coste, marca))
    return 0


def _hay_cuda():
    try:
        import torch
        return torch.cuda.is_available()
    except Exception:
        return False


def main():
    if len(sys.argv) != 2:
        print(__doc__, file=sys.stderr)
        sys.exit(2)
    sys.exit(evaluar(sys.argv[1]))


if __name__ == "__main__":
    main()
```

- [ ] **Paso 4: Comprobación de sintaxis y ejecución sin fotos (camino vacío)**

```bash
python3 -m py_compile tools/evaluar_agentes.py && echo OK
python3 tools/evaluar_agentes.py ./no-existe ; echo "código de salida: $?"
```

Esperado: mensaje "ninguna foto de verdad.json existe en ./no-existe" por stderr y
código de salida 1 (el `verdad.json` del repo está vacío a propósito — sin GPU ni fotos
reales en este entorno, la comprobación real con pesos cargados la hace el propietario
cuando tenga su carpeta de pruebas puesta).

- [ ] **Paso 5: Commit**

```bash
git add tools/evaluar_agentes.py pruebas/agentes/verdad.json pruebas/agentes/LEEME.md
git commit -m "$(cat <<'EOF'
feat(tools): banco de pruebas de agentes con verdad conocida

python tools/evaluar_agentes.py <carpeta> corre todos los agentes
activos del registro sobre las fotos que pruebas/agentes/verdad.json
referencia (fuera del repositorio, spec 2026-09-17 §6) y reporta
acierto condicionado, cobertura, calibración y coste por agente, con
un veredicto contra el mínimo (acierto >= 0.70, cobertura >= 0.20). De
solo lectura: activar/desactivar un agente es un "activo": false
manual en su ficha, el script nunca la reescribe.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Tarea 16 — Verificación final del árbol completo

No añade código nuevo: es el checkpoint que confirma que todas las tareas anteriores
encajan entre sí antes de pasar a revisión de rama.

**Files:** ninguno (solo comandos de verificación).

- [ ] **Paso 1: Rust — build y tests completos**

```bash
cd "E:\Lumi Station\.claude\worktrees\agent-ab7b2bfab383301b1"
cargo build 2>&1 | tail -60
cargo test -p lumi-proto -p lumi-index -p lumid 2>&1 | tail -100
```

Esperado: build limpio, todos los tests existentes en verde (sin tests nuevos fuera de
los que ya reescribieron las Tareas 2, 3 y 5).

- [ ] **Paso 2: Cliente — typecheck y lint de los dos proyectos que tocó este plan**

```bash
cd client && npx tsc -b --noEmit && npm run lint
```

(El plan no tocó `indexer/` — no hace falta repetir el checkeo ahí.)

- [ ] **Paso 3: Python — sintaxis de los tres ficheros reescritos/creados**

```bash
cd "E:\Lumi Station\.claude\worktrees\agent-ab7b2bfab383301b1"
python3 -m py_compile workers/lumi_motores.py workers/lumi_agentes.py tools/evaluar_agentes.py && echo OK
```

- [ ] **Paso 4: Auditoría de que no queda vocabulario del diseño viejo**

```bash
grep -rn "sub_preguntas\|PENALIZACION\|FACTOR_MINIMO\|CONFIANZA_FUSIONADO\|responder_fusionado\|clima_koppen\|koppen\.bin\|aplanar(" \
  crates workers client/src registros --include="*.rs" --include="*.py" --include="*.tsx" --include="*.ts" --include="*.json" \
  2>/dev/null
```

Esperado: sin resultados (o solo comentarios históricos explícitos que citen el diseño
anterior a propósito, como los de este mismo plan y los mensajes de commit — revisar
cada resultado a mano si aparece alguno).

- [ ] **Paso 5: No hay commit en esta tarea** — es puramente de verificación. Si algún
  paso falla, corregir en el fichero correspondiente y comitear el arreglo como parte de
  la tarea original a la que pertenece (no como una tarea nueva "fix de la 16").
