# Lumi Station — documento general

Documento paraguas del proyecto: qué es, cómo se divide, qué decisiones atraviesan todos
los subsistemas y en qué estado está cada pieza. Los documentos hermanos cubren su parte:

| Documento | Cubre |
|---|---|
| [PRODUCT.md](PRODUCT.md) | Usuarios, tono, principios de producto, anti-referencias |
| [DESIGN.md](DESIGN.md) | Tokens, tipografía, iconografía, movimiento, prohibiciones |
| [README.md](README.md) | Cómo levantarlo y probarlo |
| `docs/superpowers/specs/` | Una spec por subsistema |
| `docs/superpowers/plans/` | Un plan de implementación por subsistema |

---

## 1. Qué es Lumi

Herramienta de **geolocalización de imágenes por inferencia**, de código abierto, para uso
forense y de investigación. Le das una foto y te dice dónde se tomó.

Compite con GeoSpy y Raven, con dos diferencias: es abierta y es **autoalojada** — el
propietario pone sus propias GPUs, nada sale a un servicio de terceros. El objetivo técnico
es llevar modelos como RoMa o LightGlue a una precisión muy por encima de lo que dan por
separado, encadenándolos y haciéndolos competir entre sí.

Al ser una herramienta con la que se toman decisiones que afectan a personas reales, la
cadena de custodia y la honestidad sobre lo que el sistema sabe y no sabe importan tanto
como la precisión.

---

## 2. De la v1 a la v2

La **v1** vive en `E:\Lumi`: monorepo pnpm con Next.js (`apps/web`), un worker
(`apps/worker`) y un servicio de inferencia en Python (`services/inference`). Todo junto,
todo en la misma máquina, acceso por navegador.

La **v2** es una reescritura completa desde cero, no una migración. El cambio de fondo es la
separación en dos mitades:

- **Cliente de escritorio (Tauri)** — sustituye la web de la v1. Es lo que instala cada
  investigador en su equipo.
- **Servidor de inferencia** — donde están las GPUs, los modelos y los datos. Lo despliega
  el propietario en su propia máquina.

### Qué se conserva de la v1

Por decisión explícita del owner, la estética del `/setup` y del mapa se mantiene
**prácticamente idéntica**. En la práctica eso significa:

- Los tokens de color de `apps/web/tailwind.config.ts`, valor por valor.
- El `PlanetBackground` completo: ocho estrellas en posiciones fijas, planeta de 520 px
  girando en 70 s, satélite en órbita de 14 s, y su estado `dead` para servidor degradado.
- El vocabulario del wizard: brandline `✦`, stepper de burbujas, tarjeta de cristal de
  552 px, copy en español con subtítulos en minúscula.
- El patrón de iconos: SVG a mano, `viewBox="0 0 24 24"`, sin librería.

Se probó a "mejorar" el fondo (nebulosa, paralaje, luces de ciudad) y se descartó: rompía la
esencia del original. Está anotado como prohibición en `DESIGN.md`.

---

## 3. Actores y flujos

### Owner

Paga el hardware y tiene shell en el servidor.

```
ejecuta el CLI instalador
  → el CLI deja el daemon corriendo (sin modelos, sin pesos, sin runtime)
  → el CLI imprime una clave de vinculación de un solo uso
  → abre el cliente, pega la clave, crea la cuenta de administrador
  → continúa el aprovisionamiento desde la app
```

### Administrador

Todo desde una sección especial del cliente, solo visible con sesión de admin:

- Crear usuarios y aprobar solicitudes de acceso
- Solicitar cambios de credenciales (nunca leerlas)
- Fijar límites de uso globales y por usuario
- Cambiar permisos
- Instalar modelos y controlar qué usuario usa cuál
- Monitorizar y controlar el hardware
- Enviar notificaciones a los usuarios
- Poner el servidor en mantenimiento

### Investigador

```
abre el cliente
  → introduce la IP del servidor
  → envía un mensaje solicitando acceso al administrador
  → si lo aprueban, se le notifica
  → se le pide crear su cuenta
  → empieza a trabajar creando proyectos
```

Los **proyectos** son entornos de trabajo persistentes, en el espíritu de Burp Suite o
Caido: tus imágenes y tus análisis anteriores quedan ahí, accesibles, agrupados por
investigación.

---

## 4. Los tres modelos

Solo habrá tres, y la diferencia entre ellos no es la arquitectura sino **cuántos modelos
distintos corren dentro**:

| Nombre | Composición | Coste |
|---|---|---|
| **Lumi Mini** | 1 recuperador (CosPlace) + 1 verificador (tiny-RoMa) + 4 agentes | Bajo; corre en un escritorio |
| **Lumi Pro** | 4 recuperadores + 2 verificadores + 10 agentes | Medio |
| **Lumi Vision** | 8 recuperadores + 4 verificadores + **todos los agentes instalados** | Resultados muy superiores, problemas de cómputo reales |

La precisión sale de la competencia entre verificadores, no de un modelo mejor: el árbitro son
los inliers que sobreviven a RANSAC.

Los agentes —idioma del cartel, lado de conducción, clima, sombras, señalización, matrícula— son
ficheros JSON en `registros/agentes/`, no código. Los que dan una restricción geográfica dura
reponderan candidatos comparando su etiqueta contra el país, el lado de la calzada o el grupo de
Köppen que sale de la COORDENADA del candidato, resuelto offline con los datos de `registros/geo/`;
los descriptivos solo se le enseñan al investigador. Dos reglas cierran el asunto: un candidato con
25 inliers o más no lo tumba ningún agente, y si las restricciones vacían la lista se contesta sin
filtrar diciéndolo.

Que Vision corra «todos los agentes instalados» significa que dos servidores con registros
distintos pueden componerse distinto llamándose igual. Se asume, y se compensa: cada análisis
guarda en `analysis_agents` qué agentes corrieron de verdad, así que el informe dice de qué se
compuso aunque no se pueda repetir a ciegas en otra máquina.

La composición exacta está en `registros/niveles/`, que es datos y no código.

---

## 5. Los nueve subsistemas

El proyecto no cabe en una sola spec. Se divide en nueve piezas, cada una con su propio ciclo
spec → plan → implementación, y cada una debe producir software que funcione por sí solo.

| # | Subsistema | Qué cubre | Estado |
|---|---|---|---|
| **1** | **Instalador CLI y vinculación** | Bootstrap del owner, clave de un solo uso, primer contacto cliente↔servidor, cuenta de administrador | **Terminado y aprobado** |
| **2** | **Auth, usuarios y permisos** | Solicitudes de acceso, creación de cuentas, roles, límites por usuario, dispositivos de confianza | **Terminado** |
| **3** | **Panel de administración** | Hardware, monitorización, notificaciones, mantenimiento, gestión de modelos | Pendiente |
| **4** | **Cola y planificador** | Cientos de usuarios, pausa por desconexión, prioridades, multi-GPU y GPU+CPU | **Terminado** |
| **5** | **Motor de inferencia** | Lumi Mini / Pro / Vision, ensemble de verificadores geométricos | **5-0, 5a, 5b y 5c terminados** (instalar un `.lumidx`; consulta → candidatos → hipótesis; modelos reales, ensemble de recuperación y verificadores geométricos compitiendo; los agentes); **5d pendiente** |
| **5c** | **Agentes** | Idioma, sombras, dimensiones, clima, estación. Los que dan restricción geográfica dura filtran; los descriptivos solo se muestran | Terminado |
| **5d** | **Corpus anotado con fecha** | Anotar `reference_images` con la fecha de captura, para que estación y hora puedan filtrar en vez de solo describir | Pendiente |
| **6** | **Cliente y proyectos** | Workspaces tipo Burp/Caido, imágenes, historial, mapa | Esqueleto terminado |
| **7a** | **Lumi Indexer · cimientos** | App Tauri aparte; las tres bases; el paquete de índice troceado; procedencia de imágenes y de trabajo; mapa, territorio y la regla de no indexar dos veces; orígenes locales | Terminado |
| **7b** | **Lumi Indexer · orígenes de red** | Seis adaptadores tras un contrato por tesela (Mapillary, KartaView, Google, Mapbox Satellite, Commons, Flickr); disponibilidad en el mapa; estimar, confirmar y tope de gasto; descarga reanudable con atribución; qué se puede republicar | **Terminado** (la tabla llevaba treinta commits diciendo «con spec» en `master`) |
| **8** | **Catálogo de índices** | Publicar (trocear, cifrar, firmar, subir) e instalar índices desde repositorios etiquetados `lumi-index`; identidad de firma Ed25519 aparte de la cuenta; reclamo por `(quadkey, fuente)` para no indexar dos veces lo que ya publicó otro; grafo de dependencias transitivas al instalar | **Terminado** |
| **9** | **Página web del proyecto** | El sitio público, a partir de mockups que aporta el owner | Sin spec |

**Orden acordado:** `1 → 2 → 6 (esqueleto) → 4 → 7a → 7b → 8 → 5 → 3 → 9`. El razonamiento: el
handshake, la autenticación y el esqueleto del cliente son el andamio sin el cual nada más se
puede probar; la cola va antes que el motor porque el motor es un consumidor de la cola; el
panel de admin va casi al final porque es interfaz sobre cosas que ya deben existir; y la web
describe un producto que conviene tener terminado antes de anunciarlo.

**Por qué el Indexer se adelanta al motor.** El motor geolocaliza recuperando candidatos de
un corpus georreferenciado y verificándolos geométricamente: sin índice no hay candidatos que
verificar, y quien produce el índice es el 7. Se consideró que el 5 fijara el formato y leyera
un índice de juguete construido a mano, y se descartó a propósito: el motor habría pasado su
desarrollo entero contra material de mentira, y la primera vez que viera un índice real sería
después de darlo por terminado. El coste asumido es el simétrico — el Indexer se diseña sin
que su consumidor exista todavía, y Lumi Station sigue sin resolver ni un análisis durante dos
subsistemas más.

### Los tres nuevos, en una frase cada uno

Están anotados aquí para no perderlos, **no diseñados**. Cada uno abre su ciclo
spec → plan cuando le toque, y el owner aportará el detalle entonces.

- **7a/7b · Lumi Indexer.** Aplicación Tauri **independiente** de Lumi Station, no una
  sección suya, y sin cuentas ni servidor: un solo operador sobre su propia máquina.
  Separada porque quien indexa y quien investiga no son la misma persona ni trabajan en el
  mismo equipo. Sus specs están en
  [`specs/2026-08-06-lumi-indexer-7a-design.md`](docs/superpowers/specs/2026-08-06-lumi-indexer-7a-design.md)
  y [`specs/2026-08-07-lumi-indexer-7b-design.md`](docs/superpowers/specs/2026-08-07-lumi-indexer-7b-design.md).
  Del 7b salen dos cosas que tocan fuera: la clasificación de territorio del 7a pasa a
  razonar **por tesela y por origen** —quien instala un paquete no hereda la cobertura no
  redistribuible de quien lo publicó—, y el 8 hereda sin resolver la identidad del
  publicador, porque hoy `atribucion.autor` es una cadena que nadie verifica.
- **8 · Catálogo de índices.** Índices cifrados como los de la v1, con dos cambios de fondo.
  El primero: un índice se puebla con imágenes de **procedencias distintas** y el catálogo
  dice **en qué porcentaje viene de cada una**, por imágenes y por territorio. Es cadena de
  custodia, no estadística de adorno — saber con qué material se construyó lo que te dio la
  respuesta es parte de poder defenderla. El segundo: el formato de publicación pasa a estar
  **troceado por tesela y direccionado por contenido**, con cifrado por fragmento, para que
  se pueda descargar una parte, republicar solo lo que cambió y heredar el trabajo de otro
  de forma comprobable. Implementado según
  [`specs/2026-08-09-lumi-indexer-8-design.md`](docs/superpowers/specs/2026-08-09-lumi-indexer-8-design.md):
  identidad de firma Ed25519 separada de la cuenta (un repositorio transferido no cambia de
  autor), descubrimiento sin servidor por etiqueta de repositorio, reclamo `(quadkey, fuente)`
  que descuenta del coste antes de estimar, y un grafo de dependencias que es también el árbol
  de con quién se hizo cada índice.
- **9 · Página web.** A partir de mockups que aportará el owner; hay que revisarlos y
  detallarlos antes de escribir la spec.

Se decidió **no** escribir un documento paraguas antes de empezar (este documento se escribe
a posteriori). La consecuencia asumida: el protocolo cliente↔servidor y el modelo
criptográfico se definieron dentro del subsistema 1 y los otros cinco los heredan.

---

## 6. Arquitectura técnica

```
crates/lumi-proto      formato de clave, tipos de API, criptografía  ← compartido
crates/lumid           el daemon: TLS, API, runner de tareas, cifrado
crates/lumi-cli        binario `lumi`: install, uninstall, key reissue, status
client/                Tauri v2 + React + Tailwind
  src-tauri/           lado Rust: verificador de huella, puente SSE
  src/                 interfaz
tools/build.py         dev: arranca lumid en 7717 y el cliente
tools/package.py       zip de todo lo no excluido por .gitignore
```

`lumi-proto` es la pieza que justifica elegir Rust para el daemon: formato de clave, huella,
tipos del protocolo y envelope encryption definidos una vez y compilados por daemon, CLI y
cliente. En un producto con handshake criptográfico, un desajuste de serialización silencioso
entre cliente y servidor son días perdidos; aquí directamente no compila.

Los **workers de inferencia son Python** (los modelos lo son, pase lo que pase). La frontera
Rust↔Python es explícita, no añadida.

---

## 7. Decisiones transversales

Estas atraviesan todos los subsistemas. Se tomaron en el subsistema 1 y el resto las hereda.

### Despliegue

**Linux nativo es el camino primario. Docker es un escape con capacidades recortadas.** Las
GPUs están en el servidor, y "servidor con GPUs" en la práctica es Linux. Multi-GPU y GPU+CPU
son un dolor real en Windows y en Docker sin `--gpus all` bien configurado. La v1 soportaba
Windows/WSL/Linux y esa fue parte de la deuda técnica que motivó la reescritura.

### Matriz de capacidades

El servidor publica su inventario y **cada capacidad recortada viaja con un `reason`
legible**. La interfaz nunca esconde una función: la muestra deshabilitada con el motivo
real ("el contenedor solo recibe gpu0; requiere `--gpus all` y acceso directo a
`/dev/nvidia*`"). Un solo origen de verdad, y la columna del motivo nunca está vacía.

Este es un principio de producto, no un detalle del instalador: aplica a cada sitio de la
app donde algo aparezca deshabilitado.

### Tres bases de datos

Decidido por el owner durante el diseño del 7a, y aplica a **los dos lados** — el daemon de
Lumi Station y el Indexer:

| Base | Qué guarda |
|---|---|
| **SQLite** | Todo lo relacional y todo lo que tiene que sobrevivir a un corte de luz |
| **Redis** | Colas y estado caliente: progreso en vivo, contadores en curso |
| **Qdrant** | Los vectores. Una colección por `(modelo, versión)` |

Qdrant no se discute: `pgvector` tiene un tope duro de 2000 dimensiones para HNSW e ivfflat,
MegaLoc son 8448 y Lumi 2 son 12288, y por eso la v1 acabó haciendo escaneo coseno secuencial
sobre la tabla entera.

Redis **sí se discutió y el owner lo confirmó** con el coste enumerado: la cola del
subsistema 4 ya funciona sin ningún servicio externo, su estado durable son tres escrituras
por análisis en SQLite, y el progreso —lo verdaderamente rápido— nunca se persiste. Redis
añade un servicio que instalar, vigilar y explicar en el asistente. La regla que lo mantiene
sano está escrita en el código del 7a y hay que respetarla en los dos lados: **Redis es el
timbre y el estado caliente; SQLite es la verdad.** Si Redis se vacía se pierde la barra de
progreso, nunca el trabajo.

Consecuencia pendiente: migrar la cola del subsistema 4 a Redis y añadir Redis y Qdrant al
aprovisionamiento del servidor. Es trabajo sobre algo ya terminado y probado.

**Redis no publica binarios oficiales para Windows.** En el servidor da igual (Linux nativo
es el camino primario, más abajo). En el Indexer obliga a que también sea Linux primero, y en
Windows a instalarlo dentro de WSL.

### Confianza y transporte

**TLS con certificado autofirmado, y la huella del certificado viaja dentro de la clave de
vinculación.**

```
lumi1_<host:puerto>_<huella>_<secreto>
```

El cliente compara la huella del certificado que recibe contra la que trae la clave. Si no
coinciden, **aborta**: no hay diálogo de "¿confías?", porque ese diálogo es por donde entra
el atacante. Así, el canal fuera de banda por el que el owner te pasa la clave se convierte
en verificación real de identidad del servidor.

- Huella: SHA-256 del DER truncado a 128 bits, base58.
- Secreto: 160 bits, base58. El servidor guarda solo su hash Argon2id.
- Un solo uso, caduca en 24 h, `lumi key reissue` para reemitir.

La misma estructura la reutilizará la invitación de usuarios del subsistema 2, cambiando solo
el rol que otorga.

**Segundo formato, del subsistema 2: la tarjeta de servidor pública.**

```
lumi1s_<host:puerto>_<huella>
```

Es la misma huella, pero sin secreto. No autentica ni se consume: es la información pública
que hace falta para conectar VERIFICADO y pedir acceso sin credenciales todavía. Compartirla
no filtra nada (a diferencia de la clave de vinculación, que sí es un secreto de un solo
uso). Sin ella, un usuario nuevo con solo una IP no podría conectar sin abrir una grieta en
el anclaje TLS, y esa grieta la usaría un MITM para responder "aprobado, crea tu cuenta
aquí". Se emite con `lumi card` y convive con `lumi1_` sin confusión: `PairKey::parse`
rechaza explícitamente una tarjeta con `BadPrefix` en vez de tragársela como clave rota.

### Cifrado

**No hay cifrado extremo a extremo de las imágenes, y no se va a afirmar que lo haya.** El
servidor necesita el píxel en claro para ejecutar los modelos. Cualquiera que venda "E2E" en
una herramienta de visión por servidor está cifrando el transporte y llamándolo otra cosa.

| Dato | Mecanismo | Quién puede leerlo |
|---|---|---|
| Contraseñas | Argon2id, sin reversa | Nadie. El admin solicita cambio, nunca lee |
| Secretos de configuración | XChaCha20-Poly1305 con la maestra | El daemon en ejecución |
| Metadatos de proyecto | Envelope: DEK por proyecto envuelta por la maestra | El daemon, para el dueño y admins |
| Imágenes | En reposo con la DEK; en claro solo en RAM durante inferencia | El daemon durante el trabajo |
| Tránsito | TLS 1.3 con anclaje por huella | — |

**Protege contra:** disco robado, copia de seguridad filtrada, instantánea de VM, otro
proceso del host leyendo `/var/lib/lumi`, administrador curioso.
**No protege contra:** root en el servidor con el daemon corriendo. Es un límite físico, no
una decisión de diseño, y se documenta como tal.

### Clave maestra

Dos modos, elegidos por el owner en el instalador con el coste explicado:

- **Automática** (por defecto): 32 bytes en `systemd-creds`, el servicio arranca solo.
  Protege del disco robado en frío.
- **Sellada**: derivada de una passphrase. Tras reiniciar, el daemon arranca en `LOCKED` y
  espera a que un admin desbloquee desde la app. Protege también contra incautación en
  caliente y contra el proveedor de la VM.

El defecto es la automática porque un servicio forense compartido que se cae en cada
actualización de kernel se acaba desactivando.

En `LOCKED` **la telemetría sigue viva** — no depende de la maestra, y que siga funcionando
demuestra que la máquina está sana y que solo falta desbloquear.

### Runner de tareas

El CLI deja **solo el daemon de control**. El runtime de inferencia, la base de datos y los
modelos los instala el asistente desde la app.

La consecuencia: las instalaciones pesadas (torch, CUDA, ~8 GB) **no son peticiones HTTP
largas**. Corren en el servidor, escriben a un log persistente en disco, y el cliente se
engancha y desengancha por offset (`GET /v1/tasks/:id/log?from=<bytes>`). Cerrar la app no
aborta nada.

Es el mismo primitivo que consumirá la cola del subsistema 4. Se diseñó aquí pensando en eso.

### Estado del servidor

```
UNCLAIMED ──canje──► CLAIMED ──aprovisionado──► READY
                        │                         │
                        └────── PROVISIONING ─────┘

LOCKED        ortogonal: activo tras reiniciar en modo sellado
MAINTENANCE   ortogonal: lo introduce el subsistema 3
```

### Puerto

**7717**, fijo. No configurable por entorno (convención del proyecto: puerto fijo por
proyecto, definido en `tools/build.py`).

---

## 8. Decisiones de interfaz

### Dirección: «Instrumento»

De tres direcciones propuestas, se eligió la que conserva el wizard de la v1 intacto y añade
una **franja de telemetría permanente** que aparece en el instante en que se verifica la
huella y ya no se va.

El argumento no es estético: al dejar el CLI fino, el aprovisionamiento pesado pasa por la
app; sin ver el estado real de la máquina estás mirando una barra de progreso a ciegas. Y esa
franja *es* el componente de monitorización del subsistema 3, construido cuatro subsistemas
antes de necesitarlo. Es colapsable a 28 px, pensando en cuando el mapa ocupe la pantalla.

### Estados anómalos

Cuatro (reiniciando, error, sellado, sin conexión), y **no son un componente nuevo**:
reutilizan la composición del wizard (misma `pane`, misma tarjeta de cristal, misma fila de
botones). Solo desaparece el stepper y se atenúa lo de detrás. Un intento previo con
cabecera propia, footer propio e icono en cajita de color se descartó por romper con todo lo
demás.

Los cuatro **declaran explícitamente qué sobrevivió**: trabajo en curso, cola congelada con
su número, descarga reanudable. Esa es la mitad de la razón de que exista el runner. El de
error muestra el `stderr` crudo dentro de la tarjeta.

### Color de estado

La paleta de la v1 **no tiene verde**. "Completado" es blanco, como el paso `done` del
stepper. El color solo entra cuando significa estado: `draw-fg` en curso, `danger-fg` error,
`warning` sellado/cifrado, `subtle` sin conexión.

---

## 9. Estado actual

**Subsistema 1 terminado y aprobado.** Verificado de punta a punta por el owner con
servidor real en WSL y cliente Tauri nativo en Windows: instalación, vinculación con
anclaje de huella, creación del administrador, runner de tareas con log en vivo,
telemetría, y persistencia de sesión al cerrar y reabrir la app.

### Bugs encontrados durante las pruebas y corregidos

Vale la pena conservarlos: varios eran de diseño, no de tecleo, y sus causas se repetirán
en los subsistemas siguientes.

| Síntoma | Causa real |
|---|---|
| Reconexión fantasma antes de pegar la clave | El sondeo de `/v1/hello` arrancaba al abrir la app, fallaba con "sin servidor vinculado" y a los dos fallos levantaba el overlay |
| «Instalar runtime» no hacía nada | Crear el administrador no deja sesión iniciada; nadie llamaba a `/v1/auth/login`, así que el token era nulo y la petición recibía 401 |
| La telemetría nunca aparecía | Nadie invocaba `start_telemetry` |
| Texto del stepper solapado | `Inter` estaba declarada en Tailwind pero **nunca se cargaba**: caía a la fuente del sistema, más ancha. No era un problema de escala, y por eso ni `zoom` ni `transform: scale()` lo arreglaban |
| El planeta "se quedaba" al cambiar de estado | Los grupos vivo/muerto se montaban y desmontaban con renderizado condicional, sin fundido |
| Cerrar la app perdía todo el progreso | No había persistencia, y la clave de vinculación es de un solo uso: no se podía ni reintentar |
| «Instalando» eterno pese a un FATAL en el log | El SSE del log no corta al terminar el proceso, y nadie sondeaba el estado real de la tarea |
| Estado y log de tareas legibles sin sesión | `GET /v1/tasks/:id` y `.../log` no exigían token, a diferencia del `POST` que sí |

Lecciones que aplican al resto del proyecto: **el estado real vive en el servidor**
(retomar según `hello.state`, no según un paso guardado en el cliente), y **cada ruta nueva
necesita decidir explícitamente su autenticación**, porque el descuido no se nota hasta que
alguien lo busca.

### Límite conocido del entorno de pruebas

En WSL, elegir una ruta bajo `/mnt/...` para el runtime falla al crear el venv: DrvFs no
soporta los enlaces simbólicos que necesita `python3 -m venv`. No es un fallo del código;
hay que usar el filesystem nativo de Linux.

### Subsistema 6: esqueleto terminado, motor y cola pendientes

Proyectos, casos, imágenes y mapa funcionan de punta a punta con la única pieza que
todavía no existe fuera de escena: los análisis nacen y se quedan en `pendiente` porque no
hay cola (subsistema 4) ni motor de inferencia (subsistema 5) que los resuelva. Tampoco hay
geocodificación inversa (el campo "Identificado" de la barra inferior queda vacío a
propósito) ni traspaso de propiedad de un proyecto. El caché de teselas del mapa no tiene
tope de tamaño. El detalle de cada uno de estos aparcamientos vive en `FUTURO.md`.

---

## 10. Deuda y decisiones pendientes

**Base de datos. Revisado dos veces.** En el subsistema 4 se confirmó que SQLite basta para
lo relacional: un análisis son unas tres escrituras (a `en_curso`, el resultado, el cierre), y
con ocho GPUs y trabajos de treinta segundos eso es menos de una escritura por segundo. La
condición sigue viva y hay que respetarla: **el progreso de un trabajo no se persiste nunca**,
se retransmite por el SSE y se olvida.

En el diseño del 7a el owner añadió Redis y Qdrant al lado de SQLite (§7, «Tres bases de
datos»). SQLite no se va: gana dos compañeros con un reparto explícito. Lo que queda como
deuda es la migración de la cola del 4 a Redis y el aprovisionamiento de los dos servicios
nuevos en el servidor.

**Rotación de certificado.** Anclar la huella significa que renovar el certificado invalida
las claves emitidas y obliga a re-vincular. Aceptable con validez de 10 años; hay que
documentarlo en `lumi key reissue`.

**Frontera Rust↔Python: definida en el subsistema 4, y corregida en el 5.** JSON por líneas
sobre las tuberías estándar de un proceso hijo; los tipos viven en `lumi-proto::worker`. Lo que
`ARCHITECTURE.md` decía antes del 5 —«el subsistema 5 sustituye `_cargar` y `_resolver` de
`lumi_worker.py` sin tocar el daemon»— dejó de ser cierto en cuanto una hipótesis tuvo que
decir de qué índice y de qué autor sale: eso vive en SQLite, y el trabajador de Python no tiene
SQLite. El reparto real es **el trabajador solo embebe** (`workers/lumi_geo.py`, que sustituye
a `lumi_worker.py` como trabajador por defecto) **y el daemon recupera, agrupa y atribuye**
(`lumid::recuperar`, sobre `lumi_index::agrupar`). `lumi_worker.py` se queda como referencia
válida de un motor que conteste por su cuenta sin pasar por `Vectores` — sigue siendo legal,
solo que sin alternativas.

**`limits::effective` es la frontera con los subsistemas 4 y 6.** Aquí (subsistema 2) los
límites por usuario se definen, se almacenan en dos niveles (global/anulación) y se exponen.
Este subsistema **no los aplica**: la cola (4) y los proyectos (6) deben llamar siempre a
`limits::effective`, nunca leer la tabla `limits` por su cuenta, o la precedencia de dos
niveles se duplica y se desincroniza.

**Bloquear a un usuario no detiene sus trabajos ya encolados, y ahora se sabe qué hace.** El
planificador nunca elige un trabajo de alguien bloqueado, así que lo pendiente se queda
quieto; lo que ya estuviera corriendo termina. No se borra nada: bloquear puede ser temporal
y destruir su cola sería irreversible.

`POST /v1/access-requests` es la primera ruta escribible sin credenciales de todo el
proyecto. El interruptor `accept_requests` (meta del store, `lumi admin accept-requests
<on|off>`) la cierra por completo cuando un servidor expuesto empieza a recibir ruido.

**Aprovisionamiento por la app.** Es el punto frágil de dejar el CLI fino. Mitigado con el
runner, el log persistente y las descargas reanudables, pero sigue siendo más superficie que
un `apt install`. Si duele en la práctica, la salida es mover el paso de runtime al CLI.

**Dispositivos de confianza.** Se propuso que la clave de vinculación además registrara el
equipo como aprobado. Se aparcó al subsistema 2 por ser política de autenticación, no
bootstrap.

---

## 11. Convenciones

De `workflow/PROJECT-CONVENTIONS.md`, resumidas por lo que más afectan aquí:

- **Monorepo** por defecto. Scripts estándar en Python bajo `tools/`.
- **Puerto fijo** por proyecto, no variable.
- **Un commit por feature terminada**, no commits intermedios.
- **Sin tests** salvo que se pidan. Regla aplicada: una sola comprobación ejecutable en las
  tareas con lógica no trivial (clave, cripto, capacidades), ninguna en las mecánicas.
- **`ponytail` manda en el código**: la solución más simple que funcione. Las
  simplificaciones deliberadas llevan comentario `// ponytail:` nombrando el techo y la
  salida.
- **Diseño**: proponer 2-3 direcciones antes de comprometerse. Filtro anti-slop siempre
  activo (nada de iconos en cajitas de color, gradientes morado-azul, tarjetas apiladas).
