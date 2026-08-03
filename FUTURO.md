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

El esquema ya lo soporta: `analysis_images` es una tabla intermedia desde el primer día,
aunque hoy siempre tenga una fila. Falta la interfaz —seleccionar varias tomas de la misma
escena y lanzarlas como una unidad— y, sobre todo, decidir qué hace la cola cuando una
unidad compuesta falla a medias. Eso último es del subsistema 4, no de la interfaz.

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
