# Subsistema 5c — Los agentes

**Fecha:** 2026-08-13
**Estado:** aprobado, pendiente de plan
**Ciclo anterior:** `2026-08-13-motor-5b-design.md` (modelos reales y verificadores geométricos)

## 1. Qué resuelve

El 5b dejó el motor con recuperación real y verificadores geométricos compitiendo. Lo que ese
motor no sabe hacer es **leer la foto**. Un cartel en griego, coches por la izquierda, palmeras,
sombras cortas de mediodía: un investigador humano usa todo eso antes de mirar un solo candidato,
y hasta ahora Lumi lo tiraba a la basura.

Los agentes son submodelos que miran la imagen de consulta y dicen algo sobre ella. Unos dan una
**restricción geográfica dura** —el idioma acota países, el lado de conducción acota países, el
clima aparente acota zonas de Köppen— y esos reponderan la lista de candidatos. Otros solo
**describen** —la hora aparente, la estación, las dimensiones del edificio— y se le enseñan al
investigador para que decida él.

## 2. Alcance

**Dentro:**

- El registro de agentes como datos (`registros/agentes/*.json`) y su cargador.
- Los tres motores: un VLM compartido, OCR y profundidad monocular.
- Los tres resolutores geográficos offline: país, lado de conducción, clima de Köppen.
- `lumi_index::agentes::aplicar`: la lógica pura que repondera y descarta, con sus reglas duras.
- El trabajador `workers/lumi_agentes.py` y el lado del daemon (`lumid/src/agentar.rs`).
- El catálogo inicial de doce agentes, y `agentes` en los tres niveles.
- Persistencia (`analysis_agents`, `analysis_hypotheses.motivo_agente`) y panel en el cliente.

**Fuera, y por qué:**

- **Los agentes que exigen corpus anotado.** Un filtro por estación del año necesita saber en qué
  fecha se tomó cada foto de referencia, y `reference_images` guarda `lat/lng/quadkey/fuente` y
  nada más. Anotarla es trabajo del Indexer, cambia el formato `.lumidx` e invalida lo ya sellado.
  «Estación» entra en este ciclo como **descriptivo**; que llegue a filtrar es otro ciclo (5d).
- **Comparar geometría métrica consulta↔candidato.** «Dimensiones del edificio» describe la
  consulta y nada más. Comparar dos reconstrucciones monoculares es un problema distinto.
- **Emparejar topónimos con un gazetteer.** El OCR saca el texto legible y se lo enseña al
  investigador; cruzarlo con una base de nombres de calles es tentador y es otro ciclo. A FUTURO.

## 3. Un agente es un fichero, no código

Misma razón que el registro de modelos del 7a y el de niveles del 5b: **un fichero malo cuesta un
agente, nunca la lista**. `registros/agentes/lado-conduccion.json`:

```json
{
  "id": "lado-conduccion",
  "nombre": "Lado de conducción",
  "motor": "vlm",
  "pregunta": "¿Por qué lado de la calzada circulan los vehículos?",
  "etiquetas": ["izquierda", "derecha", "no visible"],
  "tipo": "filtra",
  "restriccion": "lado_conduccion",
  "umbral_confianza": 0.7
}
```

| Campo | Significa |
|---|---|
| `motor` | `vlm`, `ocr` o `profundidad`. Decide qué proceso lo atiende. |
| `pregunta` | Lo que se le pregunta al VLM. Vacío para `ocr` y `profundidad`, que no preguntan. |
| `etiquetas` | El conjunto cerrado de respuestas válidas. Una respuesta fuera de él es una abstención, no un error: un VLM que se inventa una etiqueta no tumba un análisis. |
| `tipo` | `filtra` o `describe`. |
| `restriccion` | `pais`, `lado_conduccion` o `clima_koppen`. Solo para `filtra`; es cómo se traduce la etiqueta a una comprobación sobre la coordenada del candidato. |
| `umbral_confianza` | Por debajo, el agente **se abstiene**. Dice «sin señal suficiente» y no reordena nada. En una herramienta forense el silencio es mejor que la conjetura. |

`registros/niveles/*.json` gana un campo `agentes`. Mini y Pro lo llevan cerrado; **Vision lo lleva
vacío, y vacío significa «todos los del registro»** — decisión del propietario. Tiene un coste
reconocido: dos servidores con registros distintos dan resultados distintos al mismo caso llamando
a los dos «Vision». Se compensa guardando en cada análisis **qué agentes corrieron de verdad, con
su versión**: el caso no se puede repetir a ciegas en otra máquina, pero el informe dice
exactamente de qué se compuso. Auditable aunque no reproducible.

## 4. Los motores, y sus licencias

Misma regla que el 5b: si la licencia no permite uso comercial, no entra, por buena que sea.

| Motor | Modelo | Licencia | Papel |
|---|---|---|---|
| `vlm` | Qwen3-VL (variante densa, 8B por defecto) | Apache-2.0 | Casi todos los agentes. Se carga **una vez** y contesta N preguntas. |
| `ocr` | PaddleOCR (PP-OCR multilingüe) | Apache-2.0 | Idioma del cartel y topónimos legibles. |
| `profundidad` | Depth Anything V2 **Small** | Apache-2.0 | Dimensiones aparentes. |

**Depth Anything V2 Base, Large y Giant son CC-BY-NC-4.0 y quedan fuera.** Es exactamente el caso
de MASt3R en el 5b: mejor modelo, licencia incompatible con un producto autoalojado que su dueño
puede usar comercialmente. La variante Small es la que hay.

Que casi todo cuelgue de un VLM compartido es lo que hace que «veinte agentes» no sean veinte
descargas. Los dos especializados están donde un VLM pierde de verdad: leer letra pequeña en un
cartel —que es la señal más valiosa de todas— y dar una distancia en metros con la que razonar.

Los pesos siguen la regla del 5b sin excepción: `lumi_pesos.Embebedor` no los carga sin su
`sha256` en el registro y sin un `LICENCIA.txt` al lado. El registro se publica con los `sha256`
vacíos; rellenarlos es trabajo manual del propietario. Un hash inventado sería peor que ninguno.

## 5. El catálogo inicial

Doce agentes. Los cuatro primeros son Mini; los diez primeros, Pro; los doce, Vision hoy.

| # | Agente | Motor | Tipo | Restricción |
|---|---|---|---|---|
| 1 | Idioma del cartel | `ocr` | filtra | `pais` |
| 2 | Lado de conducción | `vlm` | filtra | `lado_conduccion` |
| 3 | Clima aparente | `vlm` | filtra | `clima_koppen` |
| 4 | Hora aparente por las sombras | `vlm` | describe | — |
| 5 | Topónimos legibles | `ocr` | describe | — |
| 6 | Estación del año | `vlm` | describe | — |
| 7 | Tipo de escena | `vlm` | describe | — |
| 8 | Señalización vial | `vlm` | filtra | `pais` |
| 9 | Matrícula | `vlm` | filtra | `pais` |
| 10 | Dimensiones del edificio | `profundidad` | describe | — |
| 11 | Meteorología | `vlm` | describe | — |
| 12 | Vegetación dominante | `vlm` | filtra | `clima_koppen` |

Los tres de `pais` no producen el mismo conjunto: el idioma da los países donde esa escritura es
oficial, la señalización da la familia de convenio (Viena / MUTCD / británica), la matrícula da
formato y color. Se intersecan como conjuntos, no se promedian.

## 6. Los resolutores geográficos

Un agente que filtra necesita responder «¿este candidato cumple?». La respuesta sale de la
**coordenada**, offline, sin tocar el corpus:

- **`pais`** — punto en polígono contra los países de Natural Earth (dominio público, simplificado
  a 1:110m). Es lógica pura y va en `lumi-index`.
- **`lado_conduccion`** — el país anterior contra una tabla ISO-3166 → izquierda/derecha. Una tabla,
  no un modelo.
- **`clima_koppen`** — ráster de Beck et al. 2018 (CC BY 4.0), consulta por celda. Devuelve el grupo
  (`A`, `B`, `C`, `D`, `E`) y el subtipo.

Los tres viven en `crates/lumi-index/src/geo.rs`, con los datos en `registros/geo/`. Son lógica
pura: entran dos flotantes, sale una etiqueta, y por eso llevan pruebas.

## 7. Cómo se aplica, y las dos reglas que no se negocian

`lumi_index::agentes::aplicar(veredictos, candidatos, inliers) -> Vec<Ajuste>` recibe lo que
dijeron los agentes, los candidatos con sus atributos ya resueltos, y los inliers que sacó cada uno
del verificador geométrico. Devuelve, por candidato, su peso nuevo y el motivo si bajó.

**Regla 1: un candidato con ≥25 inliers no lo tumba ningún agente.** Cientos de correspondencias
geométricas confirmadas por RANSAC son mejor prueba que la conjetura de un modelo sobre el idioma
de un cartel. Sobre los candidatos que la geometría **no** confirmó, el agente sí puede descartar:
ahí es la única señal que hay.

**Regla 2: si las restricciones vacían la lista, se devuelve la lista sin filtrar y se dice.** Es
la misma postura que el 5b tomó cuando ningún verificador pasaba el umbral. Un análisis que no
devuelve nada porque un agente se equivocó es peor que uno que devuelve candidatos flojos
avisando de que los agentes no cuadran con ninguno.

Un agente abstenido no cuenta para nada: ni repondera, ni descarta, ni entra en la intersección de
países. Existe en el resultado solo para decir que no vio suficiente.

Los agentes corren **en paralelo** al verificador geométrico, sobre los mismos doce candidatos que
salen de la fusión RRF. Se paga correr agentes sobre candidatos que luego caen; se compra que la
geometría se decida antes de que nadie la contradiga.

## 8. El trabajador

`workers/lumi_agentes.py`, proceso aparte con el mismo protocolo JSON-lines que el resto: carga sus
motores una vez y se queda caliente. `Job` gana `agentes: Vec<String>` (aditivo, `#[serde(default)]`,
como todo lo que ha crecido en este protocolo) y aparece `Msg::Agentes { resultados }`, con
`{ agente, etiqueta, confianza, detalle }` por agente.

Casi todos los agentes miran **solo la imagen de consulta**: el idioma de un cartel no depende de
qué candidato se esté mirando. Por eso el trabajador recibe una imagen y devuelve doce veredictos,
no doce por candidato.

**Si el proceso de agentes muere, tarda de más o no está instalado, el análisis termina sin agentes
y lo dice.** No espera indefinidamente y no falla entero: el 5b ya funciona sin ellos.

## 9. Datos

```sql
CREATE TABLE analysis_agents (
    analysis_id INTEGER NOT NULL,
    agente      TEXT NOT NULL,
    version     TEXT NOT NULL,
    etiqueta    TEXT NOT NULL,   -- 'abstiene' cuando no llegó al umbral
    confianza   REAL NOT NULL,
    tipo        TEXT NOT NULL,   -- 'filtra' | 'describe'
    PRIMARY KEY (analysis_id, agente)
);
```

Es a la vez el panel del cliente y el registro de auditoría de §3. `analysis_hypotheses` gana
`motivo_agente TEXT NULL`: por qué bajó esa hipótesis, o `NULL` si ningún agente la tocó.

## 10. Pantalla

En `ResultsDrawer`, un panel nuevo bajo las hipótesis: **lo que la imagen dice de sí misma**. Texto
y tipografía, no iconos en cajas de color; mono para lo que produce una máquina. Los agentes
abstenidos **aparecen** con su «sin señal suficiente» en lugar de desaparecer — es la matriz de
capacidades otra vez: nada se esconde, todo lleva su causa legible.

Una hipótesis que un agente hundió lo lleva escrito al lado, con la frase entera: *«el cartel está
en griego; este candidato está en Noruega»*. Y si se dio la regla 2, la cabecera del panel lo dice:
los agentes no cuadran con ningún candidato, se muestran sin filtrar.

## 11. Pruebas

Solo `lumi-index`, que es donde vive la lógica pura, y solo lo no mecánico:

- `agentes::aplicar` — la regla del umbral de inliers gana; una abstención no reordena; la lista
  nunca queda vacía; dos restricciones de `pais` se intersecan y no se promedian.
- `geo` — punto en polígono en un país y en el mar; lado de conducción de un par de países;
  grupo de Köppen de una celda conocida.

El resto se verifica compilando y ejecutando, como manda la convención del proyecto.

## 12. Alternativas descartadas

- **Filtrar antes de la verificación geométrica**, para no gastar el verificador en candidatos que
  van a caer. Ahorra el paso caro, y a cambio un agente equivocado mata la respuesta correcta antes
  de que RANSAC pudiera confirmarla con cuatrocientos inliers, sin que el investigador llegue a
  saber que existió.
- **Solo reordenar, nunca descartar.** Lo más conservador, y desperdicia la señal: si el cartel está
  en griego, un candidato noruego que la geometría no confirmó debería poder caerse.
- **Un modelo especializado por agente.** Máxima precisión por tarea, y veinte descargas, veinte
  licencias y varios gigas de VRAM solo en agentes.
- **Todo sobre el VLM, sin especializados.** Instalación mínima, y el idioma —el filtro más valioso—
  sería el más flojo, porque un VLM lee mal un cartel pequeño.
- **Vision con lista cerrada de doce.** Reproducible entre servidores; el propietario prefirió que
  Vision crezca solo al añadir ficheros, asumiendo la asimetría y compensándola con la auditoría.

## 13. Consecuencias en los documentos

- `ARCHITECTURE.md §5`: los agentes dejan de ser «pendiente»; la tabla de niveles pasa a 4 / 10 /
  todos, y se explica qué significa el «todos» de Vision.
- `CLAUDE.md`: el 5 pasa a terminado salvo el 5d; aparecen `registros/agentes/` y `registros/geo/`.
- `PRODUCT.md`: lo que el investigador ve del panel de agentes.
- `FUTURO.md`: el 5d (corpus anotado con fecha → estación y hora que filtren), los topónimos contra
  un gazetteer, y comparar dimensiones consulta↔candidato.
