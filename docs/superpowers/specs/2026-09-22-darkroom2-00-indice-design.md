# Darkroom 2 — índice

Darkroom 2 convierte el caso Darkroom (que hoy dice «ola») en un banco de trabajo al estilo
de Raven (Graylark, antes GeoSpy): un caso reúne **fuentes**, cada fuente pasa por una
**herramienta**, y los resultados se revisan, se anotan y se ponen en un mapa compartido.

Este documento es el mapa. No especifica nada que no esté en otro spec; dice qué specs hay,
en qué orden se construyen, qué decisiones los atan a todos y qué se dejó fuera a propósito.

Se escribió tras una ronda de preguntas con el dueño el 2026-09-22, sobre la base del spec
`2026-09-19-darkroom-design.md` (fases 0 y 1, ya ejecutadas).

---

## 1. Los specs

| # | Spec | Fichero | Depende de |
|---|---|---|---|
| 1 | Temas | `2026-09-22-darkroom2-01-temas-design.md` | — |
| 2 | Fuentes y espacio Darkroom | `2026-09-22-darkroom2-02-fuentes-espacio-design.md` | 1 |
| 3 | Infraestructura de herramientas | `2026-09-22-darkroom2-03-infraestructura-herramientas-design.md` | 2 |
| 5 | Indexer: galerías | `2026-09-22-darkroom2-05-indexer-galerias-design.md` | 3 |
| 6 | Car ID | `2026-09-22-darkroom2-06-car-id-design.md` | 3, 5 |
| 7 | Verify Image | `2026-09-22-darkroom2-07-verify-image-design.md` | 3 |
| 8 | Interiores | `2026-09-22-darkroom2-08-interiores-design.md` | 3, 5 |
| 9 | Objetos | `2026-09-22-darkroom2-09-objetos-design.md` | 3, 5 |
| 10 | Especies | `2026-09-22-darkroom2-10-especies-design.md` | 3 (5 opcional) |

**El orden de construcción es la columna #.** Se conservan los números originales de cada spec
para no romper referencias cruzadas; el hueco del 4 es donde estaba OSINT, **eliminado por
completo** (decisión del dueño, 2026-09-22 — ver §3). Las herramientas van en el orden que quedó
tras esa eliminación (Car ID → Verify Image → Interiores → Objetos → Especies). Se intercala el
Indexer (5) justo antes de la primera herramienta que necesita una galería, y la infraestructura
(3) va primero porque todas las herramientas usan el auditor, el gestor de VRAM y, algunas, los
servicios externos.

Cada spec es su propio ciclo spec → plan → implementación, y el árbol queda coherente al
terminar cada uno. Si Darkroom 2 se parase después del spec N, lo construido funciona y
nada promete lo que falta.

---

## 2. Decisiones que atan a todos los specs

Tomadas con el dueño. Un spec concreto no las reabre; si una tuviera que cambiar, se cambia
aquí primero.

### El modelo

- **Plano, como Raven.** Una fuente es *entrada + herramienta*: la misma foto analizada con
  dos herramientas son dos fuentes. El archivo se guarda una sola vez (mismo `sha256`).
  No hay encadenamiento automático. La visión del spec de 2026-09-19 (archivos que se
  encadenan por su `source`) queda derogada por esta.
- **Encadenar es una decisión humana.** Un resultado con forma de fuente (una foto, una
  matrícula leída) ofrece «Crear fuente a partir de esto». La fuente nueva guarda de qué
  resultado nació (`derivada_de`). El panel sigue siendo plano; el rastro, no. Ninguna fuente
  derivada dispara una consulta automática: es trazabilidad y anotación, no búsqueda.
- **Caso normal = geolocalizar imágenes, como hoy.** Solo admite fuentes de imagen con la
  herramienta Geolocalización. **Caso Darkroom = todas las herramientas.** El vocabulario de
  «fuente» se aplica a los dos, y a los dos por igual en los datos (spec 2, migración).
- **Cada tipo de fuente llega con su herramienta.** El spec 2 solo trae `imagen`; cada spec
  de herramienta añade los tipos que necesita. Nunca hay un tipo en pantalla que no haga
  nada.

### La revisión

- Cada resultado tiene un estado **Sin revisar · Confirmado · Descartado**, que es del
  investigador y solo existe en Darkroom. Lo descartado se atenúa y baja al final, pero no se
  borra.
- **El auditor IA sugiere, el humano decide.** Un LLM/VLM local revisa los resultados de las
  herramientas que lo usan y da un veredicto con motivo (probable · no concluyente · probable
  falso positivo). Nunca cambia el estado de un resultado. Lo que marca como ruido se atenúa
  y baja, sin desaparecer. Tiene que poder abstenerse, y no se activa sin pasar calibración
  (spec 3), porque el dueño no quiere falsos positivos.
- **Pistas de región.** Interiores, Objetos, Especies y Car ID producen pistas («esta zona,
  por este motivo»). Se muestran siempre, y solo re-ponderan las hipótesis de geolocalización
  del caso cuando el investigador las **confirma**. Cada hipótesis dice por qué se movió.

### La trazabilidad

- **La Actividad del caso es solo-añadir y está encadenada con hashes.** Si alguien toca el
  SQLite a mano, Lumi detecta y muestra desde qué entrada se rompió la cadena.
- **Lumi no pide base legal ni finalidad.** Esa responsabilidad es de cada organización; Lumi
  deja constancia de quién hizo qué, qué se mandó fuera y a quién.

### Salir a internet

- **Local por defecto.** Lo que se puede hacer con modelos en la GPU del servidor se hace
  ahí.
- **Lo externo es explícito.** Cada servicio externo lo habilita el admin uno a uno, con su
  API key. La herramienta dice qué envía y a quién, y cada envío queda en la Actividad del
  caso. Un servicio sin configurar deja la herramienta deshabilitada **con el motivo**, según
  el patrón de la matriz de capacidades.
- **Las matrículas se leen, no se consultan.** Car ID lee la matrícula visible en una foto (OCR)
  y muestra el texto y el país de su formato, pero no la resuelve contra la DGT, registros de
  titulares ni portales de venta de ese coche concreto (spec 6 §9). Cualquier paso a titular o a
  un anuncio específico es manual y fuera de Lumi.

### Niveles y hardware

- **Mini → Pro → Vision sigue siendo la jerarquía**, cada nivel con modelos más caros que el
  anterior. Cada herramienta añade sus papeles al fichero de nivel (`registros/niveles/*.json`).
- **Objetivos de hardware por nivel:** Mini en 8 GB de VRAM y 16 GB de RAM; Pro en 12 GB y
  32 GB; Vision en 24 GB o más, **o** enrutando su LLM a un proveedor externo.
- **Los modelos se cargan por partes.** Un gestor de VRAM con presupuesto carga cada modelo
  cuando se pide y descarga el que lleva más tiempo sin usarse.
- **Enrutado de modelos:** los LLM/VLM pueden ejecutarse en local, en OpenRouter o en
  cualquier endpoint compatible con la API de OpenAI. Se decide **por modelo y por nivel**.
  Enrutar fuera es salir a internet y sigue sus reglas.

### El aspecto

- **Tema Raven para todo el cliente Lumi** (no el Indexer), por defecto para todos, con un
  selector para volver a **Legacy** en Ajustes → Apariencia. **Solo cambia la piel**: la
  estructura y la navegación son las de hoy.
- En el tema Raven **solo se levanta la prohibición del verde**. Las demás prohibiciones de
  DESIGN.md (iconos a mano, nada de cajas de color, nada de pilas de tarjetas) siguen
  valiendo en los dos temas.

---

## 3. Aplazados

Todo lo que se habló y se decidió no construir en Darkroom 2. Cada entrada se refleja en
`FUTURO.md`, en la sección «Darkroom 2».

**Eliminado (no aplazado):** el sistema de OSINT (identificación de personas a partir de email,
teléfono, usuario o nombre agregando datos personales) queda fuera de Darkroom 2 por decisión del
dueño el 2026-09-22. No tiene spec, no ocupa el número 4, y no se retoma en `FUTURO.md`: no es
trabajo pendiente, es alcance descartado. Car ID conserva la lectura de matrícula como atributo,
pero **no** su resolución a titular/anuncio/registro (spec 6 §9), por la misma decisión.

| Aplazado | Por qué | Qué hace falta para retomarlo |
|---|---|---|
| **Armazón con barra de iconos** para los dos temas (navegación tipo Raven: buscar, historial, casos, equipo, seguridad, ayuda) | El dueño eligió solo piel para este ciclo | Rediseñar la navegación de `App.tsx` (modos `picker`/`project`/`case`/`admin`/`profile`) sobre una barra lateral fija; aplica a los dos temas |
| **Tema Raven sin las prohibiciones de DESIGN.md** (logos de marca en cajas de color, iconos de librería, tarjetas apiladas) | Rompería «tema = solo piel»: cada componente se dibujaría de dos formas | Decidir por componente qué se dibuja distinto y aceptar mantener dos variantes |
| **Rutas entre pines** (distancia y tiempo en coche) | Necesita un motor de rutas | Un servicio de rutas (OSRM local o externo habilitado) y una capa de líneas en `MapCanvas` |
| **Filter / Layers** en la barra del caso | Tienen sentido cuando haya varias herramientas | Filtro por herramienta/estado/fecha y capas por tipo de resultado, sobre el modelo de `resultados` |
| **Timeline** | Necesita fechas fiables por fuente | Fecha de captura por fuente (EXIF, fecha del anuncio) con su procedencia |
| **Board / Intel** (árbol de fuentes al estilo Maltego) | Útil cuando haya muchas fuentes encadenadas, no imprescindible ahora | Vista de grafo sobre `sources.derivada_de`; ya está todo en los datos |
| **Galería de generadores de IA** (atribución por vecinos, sin entrenar) | El dueño eligió pesos de terceros para empezar | Tipo de galería `generadores` en el Indexer (spec 5) y una rama de Verify Image que consulte Qdrant |
| **Cabeza de atribución entrenada** | Lumi no entrena modelos hoy | Entrenamiento en el Indexer: GPU, validación, versionado de pesos |
| **Vídeo como fuente** | Raven lo admite; aquí no se pidió | Extracción de fotogramas y una fuente por fotograma o por tramo |

---

## 4. Lo que no cambia

- **El pipeline de geolocalización.** La herramienta Geolocalización de Darkroom es la misma
  cola, los mismos niveles, los mismos modelos y verificadores que el caso normal. Darkroom
  solo añade la capa de revisión encima.
- **El candado del caso** (spec de 2026-09-19, Parte 3): una persona por caso, varias por
  proyecto. Todo lo de este ciclo cuelga del caso y hereda su candado.
- **El Indexer como app independiente de un solo operador.** Gana la capacidad de construir
  galerías (spec 5), pero sigue sin hablar con `lumid`: produce paquetes que Lumi instala.
