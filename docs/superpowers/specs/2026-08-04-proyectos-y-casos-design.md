# Subsistema 6 (esqueleto) — Proyectos, casos y mapa

**Fecha:** 2026-08-04
**Estado:** propuesto
**Alcance:** el espacio de trabajo del investigador: dónde viven sus imágenes, cómo se
agrupan, y la pantalla contra la que se enchufarán la cola y el motor.

---

## 1. Contexto

El orden acordado en [`ARCHITECTURE.md` §5](../../../ARCHITECTURE.md) es
`1 → 2 → 6 (esqueleto) → 4 → 5 → 3`. El esqueleto del cliente va tercero, antes que la cola
y que el motor, con un argumento explícito: *"el esqueleto del cliente es el andamio sin el
cual nada más se puede probar"*.

Hoy, un investigador que inicia sesión aterriza en un texto que dice que los proyectos
llegan en el subsistema 6. Esto lo construye.

**Esqueleto significa que no hay inferencia.** El motor es el subsistema 5 y la cola el 4.
Aquí se construye todo lo que los rodea: los proyectos, los casos, las imágenes, el mapa, la
vista de resultado, y la fila de base de datos que la cola vendrá a consumir.

El documento paraguas está en [`ARCHITECTURE.md`](../../../ARCHITECTURE.md), el sistema de
diseño en [`DESIGN.md`](../../../DESIGN.md), y el mockup aprobado en
[`lumi-s6-mockups.html`](lumi-s6-mockups.html). Lo aparcado a futuro está en
[`FUTURO.md`](../../../FUTURO.md).

### De dónde sale la forma

La v1 (`E:/Lumi`, monorepo Next.js) tenía ya la pantalla de trabajo resuelta y validada:
carril de iconos estrecho, mapa 3D inclinado a sangre, y todo lo demás flotando encima en
superficies translúcidas — marcadores numerados, círculos de confianza, lista de candidatos
a la derecha, barra inferior con las coordenadas y el porcentaje grande. Está en
`docs/screenshots/results-clustering.png` de aquel repositorio, y `DESIGN.md` ya declara que
*"el `/setup` y el mapa se conservan prácticamente idénticos"*.

Este subsistema **no rediseña esa pantalla**. La hereda.

### Lo que la v1 no tenía

Proyectos. La v1 era una sola bolsa de búsquedas sobre un índice global. La v2 los
introduce, y con ellos la única decisión estructural de verdad de este documento: **dónde
encajan sin romper una pantalla que ya funciona**.

---

## 2. Decisiones

| # | Decisión | Alternativas descartadas |
|---|---|---|
| 1 | **Jerarquía de tres niveles: proyecto → caso → análisis**, al estilo del arranque de Burp Suite. El proyecto se elige antes de entrar a la app | proyectos planos con las imágenes dentro; casos como etiquetas en vez de contenedores |
| 2 | **Proyectos privados con invitación.** Se crean tuyos; el dueño puede añadir miembros | de quien los crea y de nadie más; una sola bolsa visible para todo el servidor |
| 3 | **Dos roles y nada más**: `owner` y `member` | un tercer rol de solo lectura |
| 4 | **El resultado de un análisis es una ubicación**: coordenada, radio de incertidumbre y confianza | varias candidatas ordenadas, una por verificador (que es lo que hacía la v1) |
| 5 | **`analysis_images` desde el primer día**, aunque hoy siempre tenga una fila | referencia directa a una sola imagen, migrar cuando haga falta |
| 6 | **El servidor hace de proxy de teselas y de estilo.** Ni la clave ni las coordenadas salen del cliente | teselas pedidas por el cliente con la clave entregada al iniciar sesión; paquete de mapas local instalado por el owner |
| 7 | **Proveedor de mapa configurable por el admin** (Mapbox u OpenStreetMap) desde el panel provisional | fijo en el código; solo por CLI; un paso del asistente de aprovisionamiento |
| 8 | **El EXIF se lee, se muestra aparte y el archivo no se toca** | ignorarlo; extraerlo y guardar una copia limpia |
| 9 | **Los análisis se crean y se quedan en `pendiente`**, más un resultado falso disponible solo en desarrollo | botón deshabilitado con su motivo hasta que exista el motor |

### Justificaciones que hay que preservar

**Por qué el proyecto se elige antes de entrar.** Es la jerarquía de Burp, y la razón es la
misma: el aislamiento tiene que ser evidente, no una promesa. Si el proyecto fuera un
desplegable dentro de la app, la pregunta *"¿esta imagen a qué investigación pertenece?"*
tendría que responderse mirando un control pequeño en una esquina. Eligiéndolo antes, la
respuesta es *"a la que abriste"*.

**Por qué no hay `owner_id` en `projects`.** El dueño es una fila de `project_members` con
`role = 'owner'`. Así la consulta "qué proyectos veo" es una sola unión, idéntica para el
dueño y para un invitado, y traspasar la propiedad algún día es actualizar un campo en vez
de migrar una tabla.

**Por qué la clave del mapa no baja al cliente.** Es una credencial del owner. Si viaja al
equipo de cada investigador, cualquiera puede extraerla del tráfico y gastar la cuota ajena.
Es el mismo criterio que el subsistema 2 aplicó a las contraseñas: el admin las gestiona,
nadie las lee. El proxy además reduce la fuga de coordenadas al proveedor: este ve una IP en
vez de una por investigador.

**Por qué el estilo también pasa por el proxy.** Un estilo de Mapbox trae dentro las URLs de
sus fuentes, y esas URLs llevan la clave. Servir el estilo crudo filtraría la clave igual
que no hacer nada.

**Por qué el EXIF se muestra en vez de ignorarse.** Una parte real de las imágenes que
recibe esta herramienta ya lleva las coordenadas dentro. Ocultarlo contradice de frente el
principio de que nada desaparece en silencio. El riesgo de que un EXIF esté falsificado se
cubre etiquetándolo como **declarado** y pintándolo distinto, no escondiéndolo.

**Por qué el archivo original no se toca.** Borrar el EXIF del archivo almacenado protegería
a quien aparece en la foto, pero destruye el original, que en contexto forense es justo lo
que no se debe hacer. Los bytes que subió el investigador se guardan íntegros.

**Por qué los análisis pendientes se crean de verdad.** Son la mejor prueba que le podemos
dejar preparada al subsistema 4: cuando la cola arranque, encontrará trabajo real esperando.
La acumulación la limita `max_daily`, que ya existe.

---

## 3. Modelo de datos

Seis tablas nuevas en el SQLite existente.

```sql
CREATE TABLE projects (
  id         INTEGER PRIMARY KEY,
  name       TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- El dueño es una fila con role='owner'. No hay owner_id en projects.
CREATE TABLE project_members (
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
  role       TEXT    NOT NULL CHECK (role IN ('owner','member')),
  added_at   INTEGER NOT NULL,
  PRIMARY KEY (project_id, user_id)
);

CREATE TABLE cases (
  id         INTEGER PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name       TEXT    NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE images (
  id          INTEGER PRIMARY KEY,
  case_id     INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  uploader_id INTEGER NOT NULL REFERENCES users(id),
  filename    TEXT    NOT NULL,
  bytes       INTEGER NOT NULL,
  sha256      TEXT    NOT NULL,
  width       INTEGER,
  height      INTEGER,
  mime        TEXT    NOT NULL,
  exif_json   TEXT,           -- EXIF completo, tal cual venía
  exif_lat    REAL,           -- extraído para poder pintarlo sin parsear
  exif_lng    REAL,
  created_at  INTEGER NOT NULL
);

CREATE TABLE analyses (
  id                INTEGER PRIMARY KEY,
  case_id           INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  requested_by      INTEGER NOT NULL REFERENCES users(id),
  model             TEXT    NOT NULL,
  state             TEXT    NOT NULL CHECK (state IN
                      ('pendiente','en_curso','hecho','error')),
  error             TEXT,
  result_lat        REAL,
  result_lng        REAL,
  result_radius_m   REAL,
  result_confidence REAL,
  created_at        INTEGER NOT NULL,
  finished_at       INTEGER
);

-- Hoy siempre una fila por análisis. Existe para que el subsistema 4 no
-- tenga que rehacer la cola el día que un análisis agrupe varias tomas.
CREATE TABLE analysis_images (
  analysis_id INTEGER NOT NULL REFERENCES analyses(id) ON DELETE CASCADE,
  image_id    INTEGER NOT NULL REFERENCES images(id)   ON DELETE CASCADE,
  PRIMARY KEY (analysis_id, image_id)
);
```

**El resultado vive en la fila de `analyses`.** Una ubicación, un radio, una confianza. El
día que se pase a varias candidatas por verificador, esos cuatro campos se vacían y nace
`analysis_candidates`; no hay nada más que deshacer.

**Los archivos van fuera de la base de datos**, en `{DATA}/projects/<project_id>/<image_id>`,
con la miniatura al lado como `<image_id>.thumb`. El original se escribe una vez y no se
vuelve a tocar.

**El proveedor de mapa vive en la tabla `meta`** que ya existe (`map_provider`, `map_key`,
`map_style`), igual que `models_dir` y `accept_requests`.

---

## 4. Fronteras con lo que ya existe

**Los límites se preguntan, nunca se leen.** Tres de las seis claves de `limits::KEYS` se
aplican aquí, y son las tres primeras que se aplican en todo el proyecto:
`can_create_projects` gatea `POST /v1/projects`, `max_storage_gb` gatea la subida de
imágenes, y `max_daily` gatea la creación de análisis. Los tres vía `limits::effective`, jamás
consultando la tabla `limits` por su cuenta. Es la condición que
[`ARCHITECTURE.md` §10](../../../ARCHITECTURE.md) dejó escrita: leer la tabla directamente
duplica la precedencia de dos niveles y la desincroniza.

**El almacenamiento se cuenta por quien sube.** `max_storage_gb` ya es un límite por usuario.
En un proyecto compartido, cada imagen pesa en la cuota de quien la subió; cargarla al dueño
del proyecto convertiría invitar a alguien en un riesgo para tu propia cuota.

**`analyses` es el enchufe del subsistema 4.** La tabla con su `state` y su `model` es
literalmente lo que la cola vendrá a consumir. Este subsistema solo escribe `pendiente`.

**El runner de tareas no se toca.** La conversión de miniaturas es lo bastante corta como
para hacerse en la petición de subida; no necesita log persistente ni reanudación.

---

## 5. Autorización

Una sola función, y todo lo demás la llama:

```rust
/// El papel del usuario en el proyecto, o None si no tiene ninguno.
/// Cualquier ruta que toque un caso, una imagen o un análisis resuelve
/// hacia arriba hasta el proyecto y pasa por aquí. La regla vive en un
/// sitio o se desincroniza; es el mismo criterio que `limits::effective`.
pub fn access(s: &Store, user_id: i64, project_id: i64) -> Option<Role>
```

| Acción | `owner` | `member` |
|---|---|---|
| Ver el proyecto, sus casos, imágenes y análisis | sí | sí |
| Crear casos, subir imágenes, lanzar análisis | sí | sí |
| Borrar casos, imágenes y análisis | sí | sí |
| Renombrar o borrar el proyecto | sí | no |
| Añadir o quitar miembros | sí | no |
| Salirse del proyecto | no | sí |

El dueño no puede salirse porque no hay a quién dejarle el proyecto: traspasar la propiedad
está aparcado. Su única salida es borrarlo, y el borrado se lleva por delante casos,
imágenes y análisis en cascada, avisando de cuántos son antes de hacerlo.

Un rol de solo lectura es tentador y se descarta a propósito: sin registro de auditoría,
"solo lectura" promete un control que este subsistema no puede demostrar. Anotado en
[`FUTURO.md`](../../../FUTURO.md).

---

## 6. API

```
GET    /v1/projects                        los que veo: dueño o invitado
POST   /v1/projects                        ← can_create_projects
PATCH  /v1/projects/:id                    ← owner
DELETE /v1/projects/:id                    ← owner
GET    /v1/projects/:id/members
POST   /v1/projects/:id/members            ← owner
DELETE /v1/projects/:id/members/:user_id   ← owner, o uno mismo para salirse

GET    /v1/projects/:id/cases
POST   /v1/projects/:id/cases
PATCH  /v1/cases/:id
DELETE /v1/cases/:id

GET    /v1/cases/:id/images
POST   /v1/cases/:id/images                multipart · ← max_storage_gb
GET    /v1/images/:id                      bytes originales, sin tocar
GET    /v1/images/:id/thumb
DELETE /v1/images/:id

GET    /v1/cases/:id/analyses
POST   /v1/cases/:id/analyses              { image_ids, model } · ← max_daily
                                           → state "pendiente"
GET    /v1/analyses/:id
DELETE /v1/analyses/:id

GET    /v1/map/style                       estilo con las fuentes reescritas al proxy
GET    /v1/map/tiles/:z/:x/:y              proxy + caché en disco
PATCH  /v1/admin/map                       ← admin · { provider, key, style }
```

Las teselas se cachean en `{DATA}/tiles/<provider>/<z>/<x>/<y>`. El caché no caduca en este
subsistema: los mapas base cambian de año en año, y el coste de una tesela obsoleta es
mucho menor que el de pedirla otra vez cada sesión. Vaciarlo es borrar el directorio.

---

## 7. Interfaz

### Selector de proyecto

Aparece al terminar el inicio de sesión, antes del carril de iconos. El mapa está en vista
mundo y desenfocado detrás: la app ya está ahí, solo que aún no tiene proyecto. Sin carril,
porque todavía no hay nada que navegar.

La tarjeta lista los proyectos con su último uso, número de casos, imágenes y tamaño. Abajo,
las dos cuotas reales: proyectos usados sobre el límite y almacenamiento sobre el límite,
cada una diciendo de dónde sale el número.

### Vista de proyecto

Carril de iconos, mapa a sangre, y un cajón de 236 px sobre el mapa con los casos. Cada caso
resuelto pone un marcador numerado en el mapa, así que el nivel de proyecto da algo que la
v1 no daba: **la investigación entera repartida geográficamente**. El cajón lleva abajo la
ocupación del proyecto y el total del usuario.

### Vista de caso

La pantalla de la v1, heredada: tarjeta de resultado centrada arriba con su anillo y su
enlace de acción, tira de miniaturas flotante abajo a la izquierda, lista de análisis a la
derecha con la imagen de consulta arriba, y barra inferior con *Identificado · Coordenadas ·
Radio de búsqueda* y el porcentaje grande a la derecha.

El cajón se colapsa a una ruta de migas (`Costa norte / Playa de Riazor ▾`) y el mapa vuela
al caso. El carril y el mapa son componentes compartidos entre las dos vistas internas: al
entrar en un caso no se monta un mapa nuevo.

### El EXIF en la interfaz

Cuando una imagen trae GPS, aparece en dos sitios y **nunca mezclado con lo inferido**: un
marcador ámbar en el mapa junto al punto inferido, y una tarjeta propia al final de la lista
de la derecha, con borde ámbar y la etiqueta *EXIF declarado*. La tarjeta de resultado
principal añade una línea cuando ambos existen: a qué distancia está uno del otro.

### Configuración del mapa — provisional

Una fila más en el panel de administración provisional del subsistema 2, junto a solicitudes
y usuarios: proveedor (Mapbox u OpenStreetMap), clave, y URL de estilo. La clave se muestra
enmascarada una vez guardada; se puede sustituir, nunca leer. Es una vista provisional
declarada como tal, igual que las del subsistema 2: el panel real es el subsistema 3, y
rotar la clave sin shell en el servidor se resuelve allí.

### El resultado falso, solo en desarrollo

Sin motor, la vista de caso no tiene nada que dibujar. El orbe de debug —que ya existe y ya
está fuera del bundle de producción— gana un comando para rellenar un análisis pendiente con
coordenadas, radio y confianza inventados. Es la única forma de construir el mapa y la
tarjeta de resultado contra algo real en vez de a ciegas. En producción no existe, y hay que
verificarlo igual que se verificó el orbe: buscándolo en el bundle compilado.

### Añadidos sobre la v1

La **franja de telemetría** anclada arriba — es lo único que no flota, porque el producto
exige que el estado del servidor se vea siempre. Los estados bloqueados de los widgets dicen
**el motivo real** en vez de un candado. Y el marcador ámbar del EXIF, que la v1 tenía solo
como widget de metadatos.

---

## 8. Errores

| Situación | Qué se muestra |
|---|---|
| Ningún proveedor de mapa configurado | Lienzo liso con el motivo escrito: nadie ha configurado el proveedor, díselo a tu administrador. Nunca un spinner eterno |
| El proveedor rechaza la clave | El motivo crudo del proveedor dentro de la interfaz, no un código |
| Análisis sin motor | `pendiente`, con "esperando al motor de inferencia" en la tarjeta y marcador apagado en el mapa |
| Cuota de almacenamiento agotada | Cuántos GB faltan **y de dónde sale el límite** (`heredas del global` / `anulado · global 20`) |
| `can_create_projects` en falso | El botón de crear está deshabilitado con el motivo y su origen |
| Modelos auxiliares no instalados | Los widgets de hora, clima y objetos siguen visibles, bloqueados, con el motivo |
| Imagen que no es imagen | Se rechaza antes de escribir nada a disco, diciendo el tipo detectado |
| Servidor caído | El banner de conexión que ya existe |

---

## 9. Fuera de alcance

Inferencia (subsistema 5) y cola (subsistema 4). Colaboración en tiempo real. Registro de
auditoría y rol de solo lectura. Nombres de lugar por geocodificación inversa: no hay nada
que traducir hasta que existan coordenadas, así que llega con el motor. Análisis
multi-imagen en la interfaz — el esquema lo soporta, la pantalla no lo ofrece. Exportar un
caso. Paquete de mapas local para trabajar sin internet. Todo ello en
[`FUTURO.md`](../../../FUTURO.md).

---

## 10. Pruebas

Siguiendo la convención del proyecto —una comprobación ejecutable en las tareas con lógica
no trivial, ninguna en las mecánicas— dos y nada más:

1. **`access`**: que un invitado vea el proyecto y no pueda renombrarlo ni gestionar
   miembros; que quien no es miembro no vea nada; que salirse funcione y quite el acceso.
2. **Conteo de almacenamiento**: que la suma sea por quien sube y no por proyecto, y que se
   compare contra `limits::effective` y no contra la tabla.

---

## 11. Riesgos

**El proxy de teselas pone al servidor en el camino crítico del mapa.** Si el daemon va
lento, el mapa se arrastra. Mitigado por el caché en disco, que hace que la segunda visita a
una zona no salga a internet. Si duele en la práctica, la salida es el paquete de mapas
local, que ya estaba propuesto y descartado por coste.

**Reescribir el estilo de Mapbox es frágil.** Depende del formato del JSON de estilo, que es
de un tercero y puede cambiar. Si la reescritura falla, hay que fallar ruidosamente con el
motivo, nunca servir el estilo crudo: eso filtraría la clave.

**El esquema soporta análisis multi-imagen y la interfaz no.** Es deliberado, pero es
exactamente el tipo de generalidad que se pudre si nadie la ejerce. Merece una nota en el
código de `analysis_images` explicando por qué existe.

**Los proyectos compartidos no dejan rastro de quién miró qué.** Aceptable para el modelo de
amenaza actual —un equipo pequeño en su propio servidor— pero es la razón de que no exista
rol de solo lectura, y hay que revisarlo si alguna vez se usa fuera de ese supuesto.

**El caché de teselas crece sin límite.** No cuenta contra ninguna cuota porque no es de
nadie. En un servidor con disco justo, un investigador paseando por el mapa puede llenarlo.
No se resuelve aquí; queda anotado.
