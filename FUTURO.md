# Lumi — ideas a futuro

Lo que se propuso, se entendió, y se decidió **no** construir todavía. No es una lista de
deseos: cada entrada dice por qué se aparcó y qué habría que hacer para retomarla. Si algo
aquí deja de tener sentido, se borra en vez de dejarlo pudriéndose.

Las decisiones vivas están en [`ARCHITECTURE.md`](ARCHITECTURE.md); la deuda técnica
consciente, en su §10. Esto es lo otro: funcionalidad aplazada.

---

## Proyectos y casos (subsistema 6)

### Colaboración en tiempo real

Dos investigadores en el mismo caso viendo los cambios del otro sin recargar. Aparcado a
propósito al decidir que los proyectos son compartibles: **compartir el acceso no es
compartir la sesión**. Hoy dos personas en el mismo proyecto se pisan sin enterarse.

Para retomarlo hace falta un canal de eventos por proyecto —el runner de tareas ya tiene el
primitivo de SSE por offset— y decidir qué pasa cuando dos personas editan el mismo caso a
la vez. No es trabajo de interfaz: es un modelo de concurrencia.

### Rol de solo lectura

Se descartó un tercer rol junto a `owner` y `member` por una razón concreta: **sin registro
de auditoría, "solo lectura" promete un control que no se puede demostrar**. Quien abre un
caso ajeno no deja rastro, así que la diferencia entre mirar y no mirar no es verificable.

Depende del registro de auditoría de abajo. Con él, es trivial.

### Registro de auditoría

Quién abrió qué caso, quién descargó qué imagen, quién invitó a quién. En una herramienta
forense esto acaba siendo obligatorio, no opcional: la cadena de custodia se documenta o no
existe.

No se hizo en el 6 porque el modelo de amenaza actual es un equipo pequeño en su propio
servidor. Hay que revisarlo el día que se use fuera de ese supuesto.

### Análisis multi-imagen en la interfaz

El esquema y el protocolo ya lo soportan: `analysis_images` es una tabla intermedia desde el
primer día y el campo `imagenes` del contrato con el trabajador es una lista. Falta la
interfaz — seleccionar varias tomas de la misma escena y lanzarlas como una unidad.

La duda que quedaba aquí, qué hace la cola cuando una unidad compuesta falla a medias, la
resolvió el subsistema 4: **no falla a medias**. El análisis es la unidad de trabajo, sus
imágenes van juntas al mismo trabajador en la misma línea y vuelve un resultado o un fallo.
Cuando la interfaz lo ofrezca, la cola no cambia.

### Geocodificación inversa

La barra inferior tiene un campo *Identificado* que quiere un nombre de lugar, no unas
coordenadas. No se construyó en el 6 porque sin motor no hay coordenadas que traducir.
Llega con el subsistema 5. El proxy de mapas ya tiene la clave del proveedor, así que la
consulta puede salir por el mismo sitio y con las mismas garantías.

### Exportar un caso

Llevarse un caso fuera: sus imágenes, sus análisis y sus coordenadas en un paquete que otra
persona pueda abrir o archivar. Es la contrapartida natural de que los proyectos sean
compartimentos estancos. Pendiente de decidir el formato y si la exportación debe quedar
registrada.

### Paquete de mapas local

Servir teselas desde el propio servidor, sin salir a internet, instaladas por el owner desde
el asistente igual que el runtime. Cero fuga de coordenadas y funciona desconectado.
Se descartó por coste —gigabytes y un paso más de aprovisionamiento— a favor del proxy con
caché. Es la salida si el proxy resulta lento en la práctica.

### Caducidad y tope del caché de teselas

El caché de `{DATA}/tiles` crece sin límite y no cuenta contra ninguna cuota, porque no es de
nadie. En un servidor con disco justo, alguien paseando por el mapa puede llenarlo. Falta un
tope configurable y una política de desalojo.

---

## Indexer (subsistema 7a)

### Imágenes retenidas para evaluación ciega

La v1 tenía `index_holdout_images`: imágenes apartadas del corpus, sin vector, que existen
solo para consultarlas contra el índice y ver si lo encuentra. Vivían en una tabla separada a
propósito, porque una fila retenida dentro de `indexed_images` sería recuperable justo por la
búsqueda que existe para evaluar a ciegas.

No está en el 7a porque quien las usa para medirse es el motor, el subsistema 5. Lo que el 7a
sí debe dejar hecho es apartarlas al ingerir; medir con ellas es del 5.

### Reducción de dimensión aprendida

Por encima de la cuantización int8 y binaria, una proyección aprendida o un truncado
matryoshka reduciría más. La v1 tenía la matriz de proyección de Cicada para esto. Se aparca
porque la cuantización ya da el grueso del ahorro —de 49 KB por vector a 1.5 KB— y una
proyección añade un artefacto versionado que hay que distribuir y verificar.

### Ajuste fino del modelo sobre un territorio

Que un índice viaje con pesos ajustados al material de su zona. El formato del paquete se
diseñó para que quepan sin romper los índices ya publicados, pero el bucle de entrenamiento,
el conjunto de validación y las métricas no están en el 7a: allí «entrenar un índice»
significa poblarlo, no tocar pesos.

### Recaptura por tesela

Resuelto por la spec de versiones de índice (2026-08-10): `liberar_tesela` borra imágenes y
vectores de una quadkey para un índice `abierto` y deja la maquinaria de descarga que ya existe
tratarla como si nunca se hubiera bajado. Sigue sin haber un "motivo anotado" por liberación —no
lo pedía esa spec— ni recaptura de una imagen suelta dentro de la tesela: la unidad es la tesela
entera, igual que la descarga.

### Comprobación de espacio libre antes de mudar la carpeta de datos

Ajustes → Almacenamiento copia primero y borra el origen solo si la copia entera se verificó
tamaño a tamaño — si el disco se llena a mitad, el origen sigue intacto y el error se ve tal
cual, así que no hacía falta un chequeo previo para que fuera seguro. Sigue faltando: avisar
*antes* de empezar cuánto espacio libre hay en el destino frente a lo que se va a copiar, para no
descubrir el problema ya a mitad de una migración de decenas de GB.

### Mover Qdrant/Redis cuando corren en WSL

La misma pantalla solo mueve la carpeta de Windows (imágenes, índice, paquetes, pesos, clave
maestra) — Qdrant y Redis, cuando el operador los levantó "en WSL" (la vía real en Windows, ya
que Redis no tiene binario nativo), viven dentro del disco de la propia distro de WSL, en
`$HOME/.lumi-indexer` allí dentro, sin relación con la carpeta que esta pantalla mueve. Reubicarlos
significaría una operación aparte contra WSL desde el lado de Windows — se dejó fuera a propósito
por ser un pedido urgente centrado en las imágenes, que es lo que de verdad llena el disco.

### Versiones de índice: agrupar v1/v2/v3 bajo una tarjeta con selector

`indice_crear` para una versión nueva (`viene_de` no nulo) inserta una fila normal en
`indices`/`fichas_remotas`, así que hoy cada versión publicada aparece en el catálogo como una
tarjeta suelta, con su `numero_version` visible junto al resto de metadatos. Agruparlas bajo una
sola tarjeta con un selector de versión —lo que un catálogo de paquetes normal ofrece— se aparcó
a propósito al escribir esa spec: exige decidir qué tarjeta enseña qué versión por defecto y cómo
se buscan versiones antiguas, y ninguna de las dos cosas bloqueaba tener versionado de verdad.

### Versiones de índice: re-descarga por imagen individual

La misma spec fijó la unidad de borrado/recuperación en la tesela entera, reutilizando
`descargas`, en vez de una re-descarga por imagen: ninguno de los seis adaptadores de origen
expone hoy "bájame esta imagen por su id", solo "bájame esta tesela", y construirlo para ganar
precisión que nadie pidió no se justificaba.

---

## Indexer · orígenes de red (subsistema 7b)

### Ortofotos públicas nacionales para el cenital

PNOA en España, NAIP en EEUU y sus equivalentes por país vía WMS/WMTS: gratis, 0,25-0,5 m/px
—mejor resolución que Mapbox— y **licencia abierta, así que las imágenes sí viajarían dentro
del paquete publicable**. Eso es lo que las hace interesantes: el cenital de Mapbox no se
puede republicar, y por eso el 7b no lo publica ni siquiera como vector.

Se descartó porque no es un proveedor sino un mosaico por país, cada uno con su servidor, su
proyección y sus rarezas. Habría que empezar por uno, y fuera de él el Indexer se quedaría
sin cenital — peor que tener uno global aunque no se pueda republicar.

Es la salida el día que la restricción de redistribución de Mapbox duela de verdad. Retomarlo
es escribir un adaptador más contra el mismo `OrigenDeRed`, más la decisión de cómo se elige
el servicio según dónde caiga la tesela.

### Clasificador de escena para las fotos sueltas

Por encima del filtro por reglas, un modelo pequeño que mire la foto y diga si es exterior y
a escala de calle. Dejaría bastante más limpia la revisión manual.

Se aparcó porque añade un modelo que instalar, versionar y anotar en el manifiesto, gasta GPU
en fotos que se van a tirar, y un clasificador que se equivoca tira material bueno sin que
nadie lo vea — mientras que la revisión por excepción sí lo enseña. Se replantea si el ruido
que pasa las reglas resulta insoportable en la práctica.

---

## Catálogo de índices (subsistema 8)

### El árbol de dependencias dibujado

`InstallDialog` (Lumi) resuelve el grafo y suma el peso, pero lo enseña como una
lista, no como un árbol con sus conectores. El grafo (`lumi_index::grafo::resolver`) ya trae
la profundidad de cada nodo; falta solo el dibujo. Se aparcó porque la lista ya deja decidir
—peso total, cobertura, quién falta— y un árbol visual es una mejora de lectura, no de
información.

### Perfiles ricos de publicador

`ProfileDialog` hoy es estadística que sale de sumar las fichas conocidas: publicaciones,
teselas cubiertas. Lo que falta es lo que no se puede calcular sin un servidor: reputación,
avales de otros operadores, historial de desreclamos por baja calidad. Es contenido del
subsistema 9, no de este.

### El criterio de calidad para desreclamar

`catalogo::refrescar_desreclamos` ya trae la lista y la aplica —solo puede quitar reclamos,
nunca añadirlos—, pero **qué cuenta como motivo válido para desreclamar** (calidad, DMCA,
abuso) lo decide la web del subsistema 9, que todavía no existe. Hasta entonces la lista
vive vacía y todo reclamo válido se mantiene.

### Panel administrativo del catálogo, en la web

Hoy el catálogo remoto se navega desde dentro del Indexer (`territory.rs`/`publicar.rs`): un
operador ve qué hay publicado y reclama territorio, pero no hay ninguna superficie de control
fuera de esas dos apps de escritorio. La idea a futuro es que la web del subsistema 9 sea
además **el buscador desde el que cualquiera descarga índices publicados** — no solo un
escaparate — y que traiga su propio panel administrativo (aparte del de Lumi, que es
por-servidor): moderar publicaciones, aplicar el criterio de desreclamo de arriba, y en
general todo lo que hoy no tiene dueño porque no hay ningún sitio central que lo posea. Depende
de que exista la web; no tiene sentido diseñarlo en detalle antes de eso.

---

## Motor de inferencia (subsistema 5)

El 5 se partió en tres (ver la spec `2026-08-10-motor-inferencia-design.md` §1): 5-0, 5a, 5b
y 5c están terminados (modelos reales, ensemble de recuperación, verificadores geométricos en
competencia, y los agentes). Esto es lo que queda aparcado a propósito para después.

### Elegir el corpus por caso

Hoy un análisis busca contra **todo lo instalado** para su modelo, sin pantalla de selección.
Se aplazó porque exige saber qué hay instalado y añade una pantalla antes de poder analizar. Si
aparece la necesidad real de «para este caso solo material verificado», se replantea entonces.

### Instalar solo un área

Se instala el índice entero, sin recorte geográfico. El troceado por geografía del 8 sigue
ganándose el sueldo (permite reanudar por trozos), pero elegir *qué* trozos exigiría una
pantalla de mapa completa en Station, hoy inexistente, para resolver un problema de disco que
nadie ha tenido todavía.

---

## Transversales

### Panel de administración real

Es el subsistema 3 y está planificado, no aparcado. Se anota aquí solo lo que se le ha ido
prometiendo por el camino: rediseñar desde cero las vistas provisionales de solicitudes y
usuarios del subsistema 2, la fila de configuración del mapa del subsistema 6.

### Hardware: control de ventilador de CPU (PWM de placa base)

Fuera de alcance de la entrega de CPU (que cubrió temperatura por núcleo y PL1/PL2 Intel/PPT
AMD): el control de ventilador de CPU depende de `fancontrol`/`lm-sensors` y es un mecanismo
por placa base, no por CPU — un proyecto aparte con su propia detección de hardware.

### Hardware: comprobación de firmware de ventilador antes de escribir

El control de curva de ventilador se intenta siempre que `nvidia-settings` responde
(`hardware_curvas` en `On`), pero algunas tarjetas de diseño de referencia o blower rechazan
la escritura a nivel de firmware aunque el software la permita. Hoy ese rechazo se propaga tal
cual venga de `nvidia-settings`; sería mejor detectarlo por adelantado y anunciarlo en la
capacidad en vez de que el usuario lo descubra al intentar aplicar un cambio.

### mTLS o secreto de dispositivo por clave

La comprobación de clase de dispositivo de una clave de API es hoy heurística (cabeceras
User-Agent/Sec-CH-UA), no criptográfica — un cliente que las falsee la pasa igual. Certificados
por dispositivo (mTLS) o un secreto de dispositivo emparejado a la clave son alternativas más
fuertes, aparcadas hasta que la heurística demuestre que no basta: las dos exigen un paso de
aprovisionamiento por dispositivo que hoy no se ha pedido.

### Editar perfil desde Perfil y sesiones

La pantalla nace solo con claves de API y sesiones activas. Editar nombre/avatar, o cambiar la
contraseña desde ahí en vez del flujo forzado actual (`ChangePasswordForm.tsx`), es su extensión
natural cuando haga falta.

### Recuperación de contraseña

No hay correo en el sistema, así que hoy la única vía es que un admin marque el cambio o que
el owner use la escotilla por CLI. Si alguna vez hay correo, esto se replantea.

### Autenticación federada

LDAP o SSO. Fuera de alcance desde el subsistema 2. Solo tiene sentido si Lumi se despliega
dentro de una organización que ya tiene identidad centralizada.

### Trabajadores en otra máquina

Hoy los trabajadores son procesos hijo del daemon y mueren con él, que es lo que evita
puertos abiertos y procesos huérfanos con la VRAM ocupada. El día que haya varias máquinas de
inferencia, esto se convierte en un servicio con autenticación entre daemon y trabajador, o en
un broker de verdad. No antes: sería infraestructura que instalar, vigilar y explicar en el
asistente para un servidor que es una sola máquina.

### Cifrado de imágenes en reposo

La maquinaria existe desde el subsistema 1 (`crypto::seal`/`open`, clave por proyecto) pero
`images.rs` no la usa: las imágenes están en claro en `{DATA}/projects/<proyecto>/<imagen>`. El
día que se cifren hay que revisar la regla del subsistema 4 de mandar **rutas y no bytes** a
los trabajadores, porque un trabajador no tendrá la clave.

### Reparto justo por turnos en la cola

El planificador ordena por prioridad y llegada, y confía en `max_concurrent` como antídoto
contra la inanición: quien tiene prioridad alta ocupa su cupo y ni un sitio más. Si con
cientos de usuarios reales eso resulta insuficiente, la salida es un reparto por turnos entre
usuarios, y cabe entero dentro de `queue/plan.rs` sin tocar el contrato ni la cola.

### Rediseño de `lumi-cli`: autenticación de verdad y uso remoto (EN CIMIENTOS, pausado)

`lumi admin reset-password/unblock/accept-requests` tocaba el SQLite directamente —
"tener shell en la máquina ya es prueba de propiedad", pero sin sesión, sin rol
comprobado y sin ningún rastro de quién lo usó. Se empezó a rediseñar para que esas tres
acciones pasen a ser peticiones autenticadas contra las rutas que `lumid` ya expone para
el panel web (mismo login que el cliente), lo que de paso permite correr `lumi admin`
desde otra máquina (p. ej. el `lumi.exe` de Windows contra un `lumid` en WSL) — y se
mantiene aparte una escotilla de verdad (`lumi rescue ...`) que solo funciona con `lumid`
parado y deja rastro en `rescate.log`.

**Lo que ya existe y compila:**
- `crates/lumid/src/routes/admin.rs`: rutas nuevas `POST /v1/admin/users/:id/reset-password`
  y `PATCH /v1/admin/access-requests` (antes solo tenía `GET`), ambas autenticadas con
  `require_admin` como el resto del panel.
- `crates/lumi-proto/src/api.rs`: `ResetPasswordRes`, `PatchAcceptRequestsReq`.
- `crates/lumi-cli/src/red.rs`: cliente HTTPS con la huella anclada (mismo patrón que
  `PinnedVerifier` del cliente de escritorio), resolución de servidor (local por defecto,
  `--card` para uno remoto), login con caché de sesión de 15 min en `~/.lumi/session`.
- `crates/lumi-cli/src/admin.rs`: reescrito para hablar por red en vez de tocar el SQLite.
- `crates/lumi-cli/src/rescate.rs`: la escotilla aparte (exige `lumid` parado, confirmación
  reescribiendo el nombre de usuario, registro en `/var/lib/lumi/rescate.log`).
- `main.rs`: `lumi admin --card <tarjeta> ...` ya no pide `sudo` (solo habla por HTTPS);
  `lumi rescue ...` sigue pidiéndolo.

**Lo que falta, y por qué se paró aquí:** nada de esto se ha probado de verdad contra un
`lumid` real (ni el flujo de login, ni el caso remoto con `--card`, ni la escotilla). El
asistente de `lumi install` y los mensajes de error/salida del CLI —las otras dos quejas
del pedido original— tampoco se tocaron. Se aparcó a mitad para priorizar el oneliner de
instalación (ver la entrada siguiente). Antes de dar esto por terminado hace falta:
probarlo en un servidor de verdad, decidir si `card()` (que sigue siendo lectura local,
sin red) necesita también moverse, y revisar si `Cmd::Rescue` debería compartir más
código con `Cmd::Admin` en vez de duplicar el `match` de acciones en `main.rs`.

### Instalador en Python para el oneliner (nuevo, sin probar en un servidor real)

`lumi install` (Rust) nunca se publicaba como binario — `release_flow.py` solo construía
`cliente`/`indexer`/`lumid`/`installer`, nunca `lumi-cli` — así que el oneliner de
`/install` llevaba tiempo roto (404 al pedir `releases/latest/download/lumi`). En vez de
arreglar el pipeline de release para publicar también ese binario, se decidió reescribir
el instalador en Python puro: **el propio script de texto es el artefacto**, sin ningún
binario compilado que publicar ni versionar aparte.

La pieza delicada era la clave de vinculación (Argon2id) — no reimplementada en Python,
sino delegada de vuelta a `lumid`: `POST /v1/bootstrap/pair-key` (nueva ruta,
`crates/lumid/src/routes/bootstrap.rs`) se autoemite la clave usando su propio código Rust
ya probado, y solo responde si la petición viene de localhost y el servidor está
genuinamente virgen (sin usuarios, sin clave ya emitida). El script sí reimplementa la
verificación Ed25519 del manifiesto de versiones (referencia pura Python, sin
dependencias) — **probada a mano contra el manifiesto real firmado del proyecto**: acepta
el original, rechaza una copia manipulada de un solo bit.

- `web/app/install-py/route.ts`: el instalador entero, servido como texto plano.
- `web/app/install/route.ts`: envoltorio de una línea que descarga ese script y lo
  ejecuta como root, reenganchando stdin a `/dev/tty` para que el asistente interactivo
  funcione a pesar de llegar por un pipe.

**Lo que falta:** no se ha ejecutado ni una vez contra un servidor real — solo se
validó offline (sintaxis, la firma Ed25519 contra datos reales, la búsqueda de
publicaciones/artefactos en el manifiesto). Además, **la publicación v2.0.24 es anterior
a que `registros/`+`workers/` empezaran a viajar como un segundo artefacto de lumid
(plataforma "assets", añadido en el mismo cambio que hizo que la auto-actualización de
`lumid` resincronizara esos dos directorios)** — hasta que se publique una versión nueva
con ese artefacto, instalar "latest" hoy mismo dejaría `lumid` sin ningún registro (el
script avisa y sigue en vez de fallar, pero el servidor quedaría inservible igual). Hace
falta un release nuevo antes de que este instalador funcione de punta a punta.

### Cambio de modelo en bucle con una sola GPU

Con un único dispositivo y dos personas alternando modelos, cargar pesos puede dominar el
tiempo total. Con varias GPUs no pasa, porque preferir al que ya tiene el modelo cargado las
especializa solas. La salida, si duele, es agrupar los candidatos por modelo antes de
repartir: un cambio dentro de `plan.rs`.

### Lo que el subsistema 8 deja a propósito para el 9

- **El árbol dibujado.** `InstallDialog` pinta el grafo con sangría y conectores de texto; el
  árbol como pieza gráfica —el «hecho con la colaboración de» que se enseña fuera de la
  aplicación— es de la web.
- **Los perfiles ricos.** `catalogo::perfil` sale de las fichas y no de ningún servicio:
  publicaciones, teselas y poco más. Biografía, avatares y estadísticas de verdad necesitan un
  sitio donde vivir, y ese sitio es el 9.
- **El criterio de calidad para desreclamar.** El Indexer solo manda paquete y motivo escrito
  por el operador; qué cuenta como baja calidad lo decide el 9. La asimetría es deliberada: la
  web puede QUITAR reclamos, nunca añadirlos, y por eso el producto sigue funcionando entero
  si la web no responde.

## Motor de inferencia (subsistema 5b)

### «Built with DINOv3»

**Mostrar «Built with DINOv3»** en la sección de modelos de la web (subsistema 9). Entra con RoMa
v2 y no es opcional. La otra obligación de esa licencia —entregar el acuerdo junto con los pesos—
ya la cumple `lumi_pesos._licencia`, que se niega a cargar unos pesos sin su `LICENCIA.txt` al lado.
Con el 5c hay dos atribuciones más que enseñar en esa misma sección: **Natural Earth** (dominio
público, sin obligación, pero se cita) y **Beck et al. 2018** para el mapa de Köppen, que es
CC BY 4.0 y **sí obliga**.

### AnyLoc con PCA a 4096 dims

**AnyLoc con PCA a 4096 dims.** Pone él solo 49 152 de las 93 440 dimensiones de Vision. Reducirlo
conservaría casi todo su recall, pero obliga a fijar la matriz PCA como parte del modelo, y eso es
otra pieza que puede desincronizarse entre Indexer y Station sin que nada falle al compilar. Se
revisa si el tamaño molesta con corpus grandes.

### Corpus anotado con fecha (subsistema 5d)

`reference_images` guarda `lat/lng/quadkey/fuente` y nada más, así que **estación** y **hora
aparente** no tienen con qué contradecir a un candidato: para pesar una contradicción haría falta
saber en qué fecha se tomó cada foto de referencia. Anotarla es trabajo del Indexer, cambia el
formato `.lumidx` e invalida lo ya sellado, así que va en su propio ciclo.

### Topónimos contra un gazetteer

El agente `toponimos` saca el texto legible y se lo enseña al investigador. Cruzarlo con una base
de nombres de calles convertiría un cartel legible en la restricción geográfica más fuerte de
todas, y también en la más fácil de equivocar: hay diez mil calles Mayor.

### El metro que la profundidad monocular no da

El agente `dimensiones` se llama «forma del espacio» porque sin una referencia de escala conocida
en la escena, Depth Anything no da metros. La salida, si algún día hacen falta, es detectar un
objeto de tamaño conocido —una puerta, un coche, un peldaño— y escalar con él.

### Gestión de versiones de un mismo modelo

El 3a instala un modelo con la versión que diga su registro, y punto — que convivan dos versiones
de un mismo recuperador (MegaLoc v1 y v2, por ejemplo) es un problema de Qdrant, que ya versiona
colecciones por `(modelo, versión)`, y de las capas de índice del subsistema 8, que ya versionan
por índice. Ninguno de los dos lados tiene hoy una pantalla que compare o migre entre versiones
del mismo modelo; se aparca hasta que haya un caso real, no antes.

### QUIC/HTTP-3 de extremo a extremo

Hoy el listener QUIC de `lumid` sirve solo `/v1/hello` (ver `crates/lumid/src/quic.rs`) porque
`reqwest` (cliente del lado `client/src-tauri`) no tiene soporte HTTP/3 estable. Cuando lo tenga,
ampliar el listener ruta a ruta y hacer que el cliente intente QUIC primero con fallback a
TCP+TLS.

### Proxies TLS-terminating

La configuración de red (`docs/superpowers/specs/2026-08-18-config-red-design.md`) asume un
proxy/port-forward transparente a nivel TCP. Un proxy que descifra y vuelve a cifrar rompe el
anclaje de huella de certificado — no está soportado ni se detecta activamente.

- **Fotos de perfil en `NotificationsPopover.tsx`**: sus `Item.id` no son ids
  de usuario (son id de proyecto para invitaciones, id de solicitud para
  accesos) — mapearlos a un `userId` real no es mecánico como en el resto de
  sitios (ver `docs/superpowers/specs/2026-08-18-perfiles-design.md`).
  Pendiente si se decide que merece la pena.
- **Edición/recorte interactivo de avatar y banner antes de subir**: hoy se
  recorta centrado en el servidor (`resize_to_fill`), sin posibilidad de
  ajustar el encuadre desde el cliente.
