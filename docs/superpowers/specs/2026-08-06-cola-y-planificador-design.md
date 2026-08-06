# Subsistema 4 — Cola y planificador

**Fecha:** 2026-08-06
**Estado:** propuesto
**Alcance:** lo que convierte un análisis `pendiente` en un resultado. La cola, el
planificador, los trabajadores y la frontera Rust↔Python que el subsistema 5 heredará.

---

## 1. Contexto

El orden acordado en [`ARCHITECTURE.md` §5](../../../ARCHITECTURE.md) es
`1 → 2 → 6 (esqueleto) → 4 → 5 → 3`, y el razonamiento para poner la cola antes que el
motor está escrito allí: *"el motor es un consumidor de la cola"*.

Hoy un investigador sube fotos, elige modelo y lanza un análisis. La fila se crea en
`analyses` con `state = 'pendiente'` y ahí se queda para siempre. `routes/analyses.rs` lo
dice en su primera línea: *"este subsistema los CREA y no los resuelve"*. Esto los resuelve.

Este subsistema **no infiere nada**. Construye todo lo que rodea a la inferencia: el reparto
del trabajo, la vida de los procesos que lo ejecutan, el contrato por el que se hablan, y el
canal por el que el cliente se entera. Lo que hace el subsistema 5 es cambiarle las tripas
al trabajador de referencia.

### Lo que ya está esperando

Cuatro piezas se construyeron en subsistemas anteriores apuntando explícitamente a este:

- **`analyses`** con su `state`, su `model` y su `requested_by`. El spec del 6 la llamó *"el
  enchufe del subsistema 4"*.
- **`analysis_images`**, tabla intermedia desde el primer día *"para que el subsistema 4 no
  tenga que rehacer la cola el día que un análisis agrupe varias tomas"*.
- **`limits::effective`**, con `max_concurrent`, `queue_priority`, `models` y `max_daily`.
  Su documentación dice que *"esta es la ÚNICA función que los subsistemas 4 y 6 deben
  llamar"*.
- **El runner de tareas** (`tasks.rs`), descrito como *"el mismo primitivo que consumirá la
  cola del subsistema 4"*: proceso hijo, log persistente, cliente que se engancha por offset.

Y en el cliente, el dock del subsistema 6 ya dibuja las tres situaciones de un trabajo —en
curso, en cola con su puesto, fallido— **contra datos que hasta hoy nunca cambiaban**.

---

## 2. Decisiones

| # | Decisión | Alternativa descartada |
|---|---|---|
| 1 | **Contrato real y trabajador de referencia en Python** | un trabajador falso en Rust, o solo contabilidad sin ejecutar nada |
| 2 | **Un trabajador persistente por dispositivo**, que mantiene los pesos cargados entre trabajos | un proceso por trabajo; un trabajador por pareja dispositivo-modelo; un único trabajador secuencial |
| 3 | **Procesos hijo con tuberías, JSON por líneas** | un servicio HTTP local por trabajador; un broker externo |
| 4 | **Segundo plano configurable por el administrador**, con los conectados por delante | que el trabajo siempre siga, o que siempre se pause |
| 5 | **Lo que ya corre nunca se cancela ni se mata** | permitir abortar a mitad |
| 6 | **Ningún estado nuevo en `analyses`** | añadir `pausado` y `cancelado` |
| 7 | **La conexión SSE abierta es la señal de presencia** | una ventana heurística sobre `sessions.last_seen` |
| 8 | **SQLite se queda**, y el progreso no se persiste nunca | pool de conexiones; Postgres; sacar la cola fuera |

### Justificaciones que hay que preservar

**Por qué un contrato real y no un simulacro.** `ARCHITECTURE.md` §10 dice que *"la frontera
Rust↔Python hay que definirla antes del subsistema 5"*. Este es el subsistema donde le toca
existir, y la única forma de saber que un contrato aguanta es ejecutarlo. Un trabajador de
referencia que arranca de verdad, carga de verdad y muere de verdad descubre ahora los
problemas que el 5 pagaría más caros: cuánto tarda en estar listo, qué pasa si revienta, qué
ve el operador cuando falla. De regalo, los análisis se resuelven, así que la ruta `/fake`
de desarrollo desaparece.

**Por qué trabajadores persistentes.** Cargar los pesos de un modelo de visión tarda decenas
de segundos. Con un proceso por trabajo ese coste se paga en cada análisis y domina el
tiempo total, con lo que el multi-GPU del enunciado deja de tener sentido: da igual repartir
entre ocho tarjetas si las ocho se pasan la vida cargando. El precio de la decisión es real
y se paga en el §7: hay que construir salud, reinicio y qué pasa con el trabajo en vuelo
cuando un trabajador muere.

**Por qué tuberías y no HTTP.** Un trabajador con puerto abierto es superficie que hay que
autenticar, o cualquiera con shell en la máquina le manda trabajo gratis. Con tuberías no
hay nada que exponer: un trabajador solo puede recibir de su padre, y muere con él, así que
no quedan procesos huérfanos ocupando VRAM tras un reinicio del daemon. Es además el patrón
que el subsistema 1 ya dejó escrito para este momento.

**Por qué ningún estado nuevo.** «Pausado» parece un estado y no lo es: es una propiedad del
*dueño* del trabajo, evaluada en el instante de repartir. Un análisis de alguien
desconectado se queda en `pendiente` y el planificador no lo elige; cuando vuelve, se elige
solo. Modelarlo como estado obligaría a que algo lo escriba y algo lo revierta, y crearía la
posibilidad de quedarse atascado en él. Como filtro no puede atascarse porque no se guarda
en ninguna parte.

La misma observación vale para tres cosas que parecían distintas: **desconectado, bloqueado
y con el cupo lleno son el mismo tipo de cosa** — filtros de una función pura, no estados de
una tabla. Eso es lo que permite que toda la política viva en un sitio testeable.

**Por qué la conexión SSE es la presencia.** `require_session` documenta que **no** actualiza
`last_seen` a propósito: *"sería una escritura en el mutex del store por llamada, para un
dato que solo se mira en una vista de auditoría"*, y termina diciendo que *"el techo es el
día en que haga falta «activo hace 2 min» de verdad"*. Ese día es hoy, y la salida no es
romper aquella decisión sino no necesitarla: el cliente abre un flujo SSE para enterarse de
sus resultados —que hace falta de todos modos— y **ese flujo abierto es exactamente la
señal**. No hay ventana que ajustar ni escritura por petición. La presencia vive en memoria
en `App`; es efímera por naturaleza y tras un reinicio nadie está conectado hasta que vuelve
a llamar, que es el comportamiento correcto.

**Por qué no hace falta reparto justo por turnos.** El enunciado dice "cientos de usuarios",
y la reacción instintiva es un planificador con reparto equitativo. No hace falta:
`max_concurrent` ya es el freno. Alguien con prioridad 5 y cupo 2 ocupa dos sitios y ni uno
más; el resto de la cola avanza por debajo. El límite que ya existe es el antídoto contra la
inanición, y añadir un segundo mecanismo que hace lo mismo peor es complejidad sin causa.

**Por qué SQLite se queda.** `ARCHITECTURE.md` §10 dejó marcado revisarlo aquí. Con
trabajadores persistentes, un análisis son unas tres escrituras: a `en_curso`, el resultado,
y el cierre. Con ocho GPUs y trabajos de treinta segundos eso es menos de una escritura por
segundo, y el mutex ni se entera. Lo que **sí** lo rompería es persistir cada línea de
progreso, así que el progreso no se escribe nunca: se retransmite por el SSE y se olvida. Esa
es la decisión que mantiene SQLite viable y por eso va escrita aquí y no solo en el código.

---

## 3. La frontera Rust↔Python

El contrato es **JSON por líneas sobre las tuberías estándar del proceso hijo**. Los tipos
viven en `lumi-proto` porque son el contrato, no un detalle del daemon.

### Daemon → trabajador

Una línea por trabajo, por `stdin`:

```json
{"tipo":"trabajo","id":42,"modelo":"mini","imagenes":["/var/lib/lumi/projects/3/17"]}
```

### Trabajador → daemon

Por `stdout`, una línea por mensaje:

```json
{"tipo":"listo","dispositivo":"cuda:0","modelo":null}
{"tipo":"listo","dispositivo":"cuda:0","modelo":"mini"}
{"tipo":"progreso","id":42,"fase":"extrayendo","pct":40}
{"tipo":"resultado","id":42,"lat":43.36,"lng":-8.41,"radio_m":1400,"confianza":0.72}
{"tipo":"fallo","id":42,"motivo":"no hay suficientes puntos de referencia"}
```

`stderr` es su log, sin formato y sin contrato, igual que el runner de tareas: se escribe a
`{DATA}/workers/<dispositivo>.log` y se puede leer.

### Las reglas del contrato

**Un trabajo, una respuesta.** El daemon no manda el siguiente hasta que el anterior contestó
con `resultado` o `fallo`. El trabajador no necesita concurrencia propia, y `max_concurrent`
significa algo real en lugar de ser una sugerencia.

**`listo` al arrancar es obligatorio.** Hasta que llega esa línea el trabajador no cuenta
como disponible. Sin ella, "el modelo está cargando" y "la cola está colgada" se ven
exactamente igual, y el operador no tiene forma de distinguirlos. El trabajador declara en
ella en qué dispositivo está y qué modelo tiene cargado, que al arrancar es `null`.

**Un trabajador sirve cualquier modelo, cambiándolo cuando hace falta.** Es la consecuencia
de tener un trabajador por *dispositivo* y no por *modelo*: si el trabajo pide un modelo
distinto del que tiene cargado, descarga y carga el nuevo antes de empezar, y vuelve a
mandar `listo` con el modelo nuevo. La alternativa —un trabajador por cada pareja
dispositivo-modelo— multiplicaría la VRAM ocupada por el número de modelos del catálogo, y
la mayoría estarían siempre ociosos.

El cambio es caro, así que el planificador lo evita cuando puede (§5): entre dos trabajadores
libres prefiere el que ya tiene ese modelo puesto. En el caso normal —un equipo pequeño
usando el mismo modelo— no se cambia nunca.

**Rutas, no bytes.** Las imágenes viajan como rutas absolutas. Empujar decenas de MB por una
tubería en cada trabajo sería trabajo tirado, y el trabajador corre como el mismo usuario en
la misma máquina. Hoy las imágenes están **en claro** en `{DATA}/projects/<proyecto>/<imagen>`:
la maquinaria de cifrado existe (`crypto::seal`/`open`, clave por proyecto) pero `images.rs`
no la usa todavía. **Esta es la regla a revisar el día que se cifren en reposo**, y queda
escrita aquí porque el comentario de `telemetry.rs` sobre la cola y el servidor sellado
sugiere lo contrario.

**`fallo` es un resultado; morirse es una avería.** Que el motor conteste "no puedo situar
esta foto" es información legítima y se guarda como `error` con su motivo — reintentarlo solo
quema GPU. Que el proceso muera, la tubería se rompa o no llegue respuesta es otra cosa, y
ahí el trabajo vuelve a la cola. Esta distinción es la que hoy no existe: todo cae en un
único `error`.

**Al trabajador se le cree el log, no los datos.** Su `stderr` pasa tal cual; cada número que
manda se valida antes de tocar la base de datos (§7).

### El trabajador de referencia

`workers/lumi_worker.py`, fuera de las crates. Lee líneas de `stdin`, escribe líneas a
`stdout`, devuelve una coordenada fija, sabe fallar y sabe morir. El subsistema 5 le cambia
las tripas sin tocar nada del daemon. Es también la documentación ejecutable del contrato:
quien escriba otro trabajador lo lee y sabe qué tiene que cumplir.

---

## 4. Los componentes

Módulo nuevo `crates/lumid/src/queue/`, con una responsabilidad por archivo:

| Archivo | Qué hace | De qué depende |
|---|---|---|
| `mod.rs` | El handle `Queue` que vive en `App`. API: `submit`, `cancel`, `snapshot`, `depth` | del store y del planificador |
| `plan.rs` | Dado el estado, decide qué trabajo va a qué trabajador libre. **Función pura** | de nada |
| `worker.rs` | La vida de un trabajador: arrancar, esperar `listo`, despachar, vigilar, enterrar | de tokio y del protocolo |

El planificador es puro **a propósito**. Toda la política —prioridades, conectado contra
segundo plano, cupos, bloqueos— es donde más fácil es equivocarse y donde más caro sale
depurar contra hardware real. Entra una lista de candidatos y otra de trabajadores; sale una
asignación. Sin base de datos, sin procesos, sin reloj.

### Arranque de los dispositivos

Un trabajador por GPU detectada por NVML, que `App.gpus` ya tiene desde el subsistema 1. Sin
GPUs, uno de CPU — y por eso el entorno de pruebas en WSL funciona sin hardware. El "GPU+CPU"
del enunciado es un interruptor en `meta`, `queue_cpu_worker`, encendido por defecto solo
cuando no hay GPUs: con GPU disponible, un trabajo que cae en CPU tarda tanto que parece roto.

---

## 5. La política del planificador

### Descarta primero

Un trabajo pendiente **no** es candidato si:

- su dueño está bloqueado
- su dueño no está conectado y no tiene `background_jobs`
- su dueño ya tiene `max_concurrent` trabajos en curso
- no hay ningún trabajador vivo

### Ordena después

Los candidatos se ordenan por, en este orden:

1. **conectado antes que segundo plano**
2. **`queue_priority`** descendente (−5 a 5, ya existe en `limits`)
3. **`created_at`** ascendente — a igualdad de todo, el que lleva más esperando

### Y elige trabajador

Cualquier trabajador libre puede con cualquier modelo, pero cambiarlo cuesta cargar pesos.
Así que entre los libres se prefiere **uno que ya tenga ese modelo cargado**; solo si no hay
ninguno se le pide el cambio a otro.

Esto tiene una consecuencia deliberada con varias GPUs y varios modelos en uso: los
dispositivos tienden a **especializarse solos** en el modelo que más les toca, sin que nadie
lo configure. No es un mecanismo aparte, es lo que emerge de preferir el que ya lo tiene.

### Segundo plano, como un límite más

`background_jobs` entra en `limits::KEYS` (pasa de seis claves a siete) y hereda gratis los
dos niveles: valor global del servidor y anulación por usuario. Cero configuración nueva que
inventar, y el panel del subsistema 3 lo pintará con la misma maquinaria que los otros seis.

**Por defecto desactivado.** Con él apagado, perder la conexión o cerrar sesión pausa lo
pendiente de esa persona. Con él encendido, su trabajo sigue avanzando pero siempre por
detrás de quien sí está delante de la pantalla.

**Lo que ya está corriendo termina, en todos los casos.** Ni una desconexión, ni un bloqueo,
ni una cancelación matan un trabajo en vuelo: el cómputo ya gastado no se tira.

### Cancelar ya existe

Cancelar es el `DELETE /v1/analyses/:id` de hoy. El único cambio es que **rechaza con 409 si
el análisis está `en_curso`**. Un análisis pendiente que se cancela se borra: nunca produjo
nada y no hay historia que conservar.

---

## 6. Modelo de datos

Casi nada cambia, y eso es señal de que el esquema del 6 estaba bien pensado.

```sql
-- Única columna nueva. Sin ella, una imagen que revienta al trabajador lo
-- tumba en bucle para siempre, y siempre en la misma GPU.
ALTER TABLE analyses ADD COLUMN requeues INTEGER NOT NULL DEFAULT 0;
```

Entra por el `migrate()` que ya existe en `store.rs`, que es idempotente por construcción.

**Ningún estado nuevo.** Los cuatro de `analyses.state` bastan: `pendiente`, `en_curso`,
`hecho`, `error`. El `CHECK` de la tabla se queda como está, y no hay migración de datos.

**Nada en memoria que haga falta persistir.** La presencia, el progreso y el estado de los
trabajadores viven en `App` y se pierden al reiniciar. Los tres son correctos así: tras un
reinicio nadie está conectado, ningún progreso sigue vigente y no hay trabajador vivo.

---

## 7. Errores

| Qué falla | Qué hace la cola | Qué se ve |
|---|---|---|
| El motor contesta `fallo` | nada — es un resultado | `error` con el motivo del motor |
| El trabajador muere con trabajo en la mano | vuelve a `pendiente`, `requeues += 1` | nada, si al segundo intento sale |
| …y vuelve a morir con el mismo trabajo | lo deja | `error`: «el trabajador murió dos veces con este trabajo» |
| No manda `listo` en 120 s | lo mata y lo relanza, con espera creciente | el modelo aparece como no disponible |
| Ningún trabajador vivo | el trabajo espera en `pendiente` | «no hay ningún trabajador disponible» |
| El trabajador no puede cargar el modelo que se le pide | lo trata como `fallo` de ese trabajo, no como avería | `error`: «no se pudo cargar el modelo *vision*» |
| Línea JSON ilegible | la registra en el log del trabajador y sigue | nada |
| `lat`/`lng` fuera de rango, radio ≤ 0, confianza fuera de 0–1 | rechaza el resultado | `error`: «el motor devolvió una coordenada imposible» |
| Resultado de un `id` que no encargó | lo ignora y lo registra | nada |
| El daemon se reinicia | todo `en_curso` vuelve a `pendiente` | los trabajos siguen solos |

**Los `en_curso` al arrancar son siempre restos de una caída**, porque ningún trabajador
sobrevive al daemon. Volver a ponerlos en `pendiente` en el arranque es una línea, y es lo
que impide que un corte de luz deje trabajos zombis que nadie recogerá jamás.

**Borrar una imagen que está en un análisis `en_curso` se rechaza con 409**, por coherencia
con la regla de no cancelar lo que corre. Hoy se puede, y el resultado aterrizaría sobre un
caso al que le falta la prueba que lo produjo — inaceptable en una herramienta forense.

---

## 8. API

| Ruta | Quién | Qué |
|---|---|---|
| `GET /v1/queue/events` | cualquier sesión | SSE. Cambios de estado y progreso de **sus** análisis. Mientras está abierto, esa persona cuenta como conectada |
| `GET /v1/queue` | administrador | Foto de la cola: profundidad, trabajos por estado, trabajadores y su dispositivo |
| `DELETE /v1/analyses/:id` | dueño del caso | Ya existe. Ahora devuelve 409 si está `en_curso` |
| `DELETE /v1/images/:id` | dueño del caso | Ya existe. Ahora devuelve 409 si la imagen está en un análisis `en_curso` |
| `PATCH /v1/admin/limits` | administrador | Ya existe. Acepta la clave nueva `background_jobs` |

`Sample.queue_depth`, que hoy es un cero con un comentario que dice *"la cola llega en el
subsistema 4"*, pasa a ser el número de pendientes de verdad. `queue_paused` pasa a
significar lo que dice: que la cola no está repartiendo, porque no hay ningún trabajador vivo.

---

## 9. Interfaz

**El cliente casi no se toca, y esa es la recompensa del rediseño del subsistema 6.** El dock
ya dibuja las tres situaciones —en curso con su punto latiendo, en cola con su número de
puesto, fallido con su «!»— contra datos que hasta hoy nunca cambiaban. Ahora se llenan solos.

Lo que se añade:

- El enganche al SSE de `/v1/queue/events`, que actualiza el dock y la tarjeta de resultado
  sin que nadie pregunte. Se abre al iniciar sesión, no al abrir un caso: es también la señal
  de presencia.
- El 409 al cancelar algo que ya corre necesita un mensaje, no un error crudo.

Lo que se quita:

- La ruta `/v1/analyses/:id/fake` y su disparador en la interfaz. Existían porque no había
  motor; con la cola resolviendo análisis de verdad, dejan de tener sentido. Su desaparición
  se verifica igual que la del orbe de depuración: por `grep` sobre el paquete de producción.

---

## 10. Pruebas

Siguiendo la convención del proyecto —una comprobación por pieza con lógica no trivial,
ninguna en las mecánicas—, tres:

1. **El planificador.** Es una función pura, y por eso el único sitio donde la política se
   puede verificar sin GPUs ni procesos: que el bloqueado se salta, que el desconectado se
   salta con `background_jobs` apagado y va detrás del conectado con él encendido, que
   `max_concurrent` corta, que el orden es prioridad y luego llegada, y que entre dos
   trabajadores libres gana el que ya tiene ese modelo cargado.
2. **El protocolo.** Una línea ilegible no mata al trabajador; un resultado con coordenadas
   imposibles no entra en la base de datos.
3. **De punta a punta con el trabajador de referencia.** Lanzarlo de verdad, mandarle un
   trabajo, recibir el resultado. Es la única que demuestra que la frontera existe. Requiere
   `python3` en el entorno; sin él, se salta con un aviso en vez de fallar.

---

## 11. Fuera de alcance

El motor real y la geocodificación inversa son el subsistema 5. El panel de cola para el
administrador es el 3 — aquí solo se publica la foto por API.

Anotados en [`FUTURO.md`](../../../FUTURO.md) con su motivo: trabajadores en otra máquina
(hoy el servidor es una máquina), cifrado de imágenes en reposo (cambiaría la regla de rutas
del §3), y reparto justo por turnos (`max_concurrent` ya cubre la inanición).

### Un pendiente que este subsistema cierra

`FUTURO.md` dejó marcado como decisión de este subsistema *qué hace la cola cuando un
análisis multi-imagen falla a medias.* **No falla a medias.** El análisis es la unidad de
trabajo: sus imágenes van juntas al mismo trabajador en la misma línea y vuelve un resultado
o un fallo, nunca medio. No hay estado intermedio que gestionar, y el protocolo ya lo soporta
porque `imagenes` es una lista desde el primer día. Cuando la interfaz ofrezca seleccionar
varias tomas, la cola no cambia.

---

## 12. Riesgos

**El contrato puede quedarse corto para el motor real.** Es el riesgo asumido al definirlo
aquí y no en el 5. Se mitiga con lo que el `tipo` de cada mensaje permite: añadir un mensaje
nuevo no rompe a nadie que ignore los que no conoce. Lo que sí dolería es cambiar la forma de
`resultado`, y por eso sus campos son exactamente los cuatro que `analyses` ya tiene.

**120 segundos para `listo` puede ser poco.** Un modelo grande en un disco lento puede tardar
más. El número es un punto de partida y va en `meta`, no compilado.

**La presencia por SSE depende de que el cliente mantenga el flujo abierto.** Un proxy que
corte conexiones inactivas haría que alguien delante de la pantalla parezca desconectado. Se
mitiga con un latido periódico en el propio flujo, que es lo que ya hace el SSE del log de
tareas.

**Con una sola GPU y dos modelos en uso, el trabajador puede pasarse la vida cambiando.** Dos
personas alternando `mini` y `vision` sobre un único dispositivo harían que cargar pesos
domine el tiempo total — exactamente lo que la decisión 2 quería evitar. Con varias GPUs no
pasa, porque la preferencia por el que ya lo tiene cargado las especializa solas. La salida
si duele en la práctica es agrupar por modelo antes de repartir, y es un cambio dentro de
`plan.rs` que no toca el contrato.

**Un trabajador puede fugar VRAM entre trabajos.** Es la contrapartida directa de mantenerlo
vivo: un proceso por trabajo no tendría este problema. No se mitiga en este subsistema —
detectarlo y reciclar el trabajador es trabajo del 5, que es quien sabrá cuánta memoria debe
ocupar un modelo sano.
