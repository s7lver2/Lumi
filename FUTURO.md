# Lumi Station — ideas a futuro

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

### Alternativas cuando el motor duda de verdad

Un análisis devuelve **una** ubicación con su radio y su confianza. La v1 en cambio listaba
siempre todas las candidatas ordenadas por similitud
(`CandidateComparisonCard`, `OtherCandidatesList`), y sesenta y cuatro candidatos «sin
verificar» no ayudan a decidir nada: la lista se vuelve ruido.

La dirección acordada es intermedia y ya está en el spec: el motor **podrá** añadir
alternativas, pero solo cuando genuinamente no pueda discriminar entre dos o tres hipótesis.
No se rellena la lista con lo siguiente mejor puntuado, y un falso positivo evidente no es
una alternativa.

Lo que queda pendiente es construirlo, y es trabajo del subsistema 5: definir qué cuenta
como duda real —un umbral de separación entre hipótesis, no un top-N— y crear
`analysis_candidates` el día que el motor reporte la primera. Hasta entonces los cuatro
campos `result_*` de `analyses` bastan y no hay nada que migrar.

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

`InstallDialog` (Lumi Station) resuelve el grafo y suma el peso, pero lo enseña como una
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

### Sin punto de entrada a instalar dentro de Lumi Station

Esto no se aparcó a propósito: no se pensó. El Task 15 del plan del 8 solo pedía el endpoint
que resuelve el grafo, `InstallDialog` y la comprobación de firma al abrir —nada sobre cómo se
llega hasta ahí—, y el resultado es que `InstallDialog` no está importado desde ningún sitio de
`client/src`. Hoy no hay manera de abrir el diálogo sin escribir código: ni un buscador del
catálogo dentro de Station, ni un campo para pegar la URL de una ficha. El diseño daba por
hecho que la vía de entrada sería un enlace desde la web del subsistema 9 apuntando directo a
una ficha, pero eso deja a Station sin nada mientras esa web no exista. Hace falta decidir
—cuando le toque su ciclo spec → plan— si el punto de entrada vive en Station (una pantalla de
catálogo, aunque sea mínima) o si de verdad se espera al 9.

---

## Transversales

### Panel de administración real

Es el subsistema 3 y está planificado, no aparcado. Se anota aquí solo lo que se le ha ido
prometiendo por el camino: rediseñar desde cero las vistas provisionales de solicitudes y
usuarios del subsistema 2, la fila de configuración del mapa del subsistema 6, las
notificaciones redactadas por el admin, el modo mantenimiento, y una forma de rotar la clave
del proveedor de mapas para un admin que no tenga shell en el servidor.

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
