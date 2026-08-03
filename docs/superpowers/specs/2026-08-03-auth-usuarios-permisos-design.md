# Subsistema 2 — Auth, usuarios y permisos

**Fecha:** 2026-08-03
**Estado:** aprobado
**Alcance:** cómo entra un investigador que no es el owner, y qué puede hacer una vez dentro.

---

## 1. Contexto

El subsistema 1 dejó un servidor instalado con **una** cuenta: la del administrador que
canjeó la clave de vinculación. No hay forma de que entre nadie más.

Este subsistema añade el resto del ciclo de vida de una cuenta: solicitar acceso, ser
aprobado, crearla, iniciar sesión, tener límites, y ser bloqueado o forzado a cambiar
credenciales. También el registro de dispositivos y sesiones que el subsistema 1 aplazó
explícitamente.

Documento paraguas en [`ARCHITECTURE.md`](../../../ARCHITECTURE.md). Mockup aprobado en
[`lumi-s2-mockups.html`](lumi-s2-mockups.html).

### La contradicción que había que resolver

La visión original decía que el investigador *"pone la dirección IP del backend y manda un
mensaje para solicitar acceso"*. Pero el subsistema 1 decidió que **el cliente nunca conecta
sin verificar la huella del certificado**, y que no existe diálogo de "¿confías?" porque ese
diálogo es por donde entra el MITM.

Un usuario nuevo con solo una IP no tiene huella. Hoy, literalmente, no podría ni conectar
para pedir acceso. La decisión 1 de abajo resuelve esto sin abrir ninguna grieta en el
anclaje.

---

## 2. Decisiones

| # | Decisión | Alternativas descartadas |
|---|---|---|
| 1 | **Tarjeta de servidor pública** `lumi1s_<host:puerto>_<huella>`, sin secreto, para que cualquiera pueda conectar verificado y pedir acceso | permitir conexión sin anclar solo para la solicitud; solo invitación del admin |
| 2 | **Ticket de solicitud + sondeo.** El mismo ticket que identifica la solicitud autoriza a crear la cuenta cuando se aprueba | clave de invitación enviada al aprobar; conexión SSE persistente |
| 3 | **Dos niveles de límites**: valores globales del servidor + anulaciones por usuario | roles con nombre (tres niveles); todo por usuario sin globales |
| 4 | **Superficie de admin mínima y provisional** dentro de la app, más una escotilla por CLI | solo CLI; adelantar el panel completo del subsistema 3 |
| 5 | **Registro pasivo de dispositivos.** Audita y permite revocar sesiones; no bloquea el acceso desde un equipo nuevo | sin dispositivos; vinculación obligatoria |
| 6 | **La pantalla de entrada es el inicio de sesión.** Añadir un servidor vive dentro del desplegable de servidores | pantalla que pregunta el rol primero; dos aplicaciones distintas |

### Justificaciones que hay que preservar

**Por qué la tarjeta pública y no una excepción al anclaje.** El ataque interesante no es
robar la solicitud (solo lleva un nombre y un mensaje). Es que el MITM responda *"aprobado,
crea tu cuenta aquí"* y capture las credenciales del investigador mientras retransmite al
servidor real. Una sola grieta en el anclaje la abre también para eso. La huella es el hash
de un certificado público: compartirla no filtra nada, y un solo artefacto sirve para todo
el equipo.

**Por qué el ticket y no una invitación al aprobar.** Con invitación, el admin aprueba *y
además* tiene que acordarse de enviar algo por fuera; si no lo hace, el usuario espera sin
saber por qué. El ticket es el mismo patrón que el `bootstrap_token` del subsistema 1 —una
credencial que autoriza exactamente una acción y muere al usarse— y sobrevive a cerrar la
app, que es justo el bug que costó una tarde en el subsistema 1.

**Por qué dos niveles y no roles.** "Generales y por usuario" son literalmente dos niveles.
Con tres modelos y seis palancas, un rol no sería más que un preajuste con nombre. Si
configurar usuario por usuario llega a doler, **un rol se añade después sin migración**: pasa
a ser una capa más que se consulta entre el global y el usuario.

---

## 3. Artefactos

Dos formatos de clave conviven, con el mismo parseo en `lumi-proto`:

```
lumi1_<host:puerto>_<huella>_<secreto>     vinculación del owner  (subsistema 1)
lumi1s_<host:puerto>_<huella>              tarjeta pública        (este subsistema)
```

- La tarjeta **no caduca y no se consume**: es información pública que el admin publica una
  vez (wiki interno, canal del equipo) y sirve para todo el mundo.
- El cliente distingue el flujo por el prefijo. `lumi1s_` lleva a iniciar sesión o solicitar
  acceso; `lumi1_` lleva al asistente de aprovisionamiento.
- El admin la obtiene desde su propia app (botón de copiar) y por CLI con `lumi card`.

---

## 4. Flujos

### 4.1 Solicitar acceso

```
usuario pega la tarjeta
  → el cliente conecta y verifica la huella          (falla → aborta, sin excepciones)
  → GET /v1/hello dice que ya hay administrador
  → el usuario elige "Solicitar acceso"
  → POST /v1/access-requests {nombre, mensaje}
  → el servidor devuelve un ticket; el cliente lo persiste
  → sondeo cada 30 s con el ticket
```

La solicitud caduca a los **7 días** sin respuesta. El cliente puede cerrarse: la solicitud
vive en el servidor y el ticket está en la sesión persistida.

### 4.2 Aprobación

El admin ve la solicitud con su contexto: nombre, mensaje, **dirección de origen** y un aviso
si viene de fuera del rango privado. Al aprobar elige **qué modelos concede**; el resto de
límites salen de los valores globales.

Aprobar o rechazar es idempotente por solicitud: la primera resolución gana y las siguientes
devuelven `409`.

### 4.3 Crear la cuenta

El siguiente sondeo devuelve `approved`. El cliente muestra el formulario de cuenta y llama a
`POST /v1/accounts` con **el mismo ticket**, que se consume ahí. El usuario tiene **48 h**
desde la aprobación; pasado ese plazo el ticket muere y hay que volver a solicitar.

La notificación llega a la **campana**, no a un diálogo: se enciende sin interrumpir lo que
el usuario esté haciendo.

### 4.4 Rechazo

El admin puede adjuntar un motivo, que el usuario ve tal cual. Un rechazo **no impide volver a
solicitar**; para eso está el bloqueo, que es otra cosa y se aplica a cuentas existentes.

### 4.5 Cambio de credenciales

El admin marca la cuenta. En el siguiente inicio de sesión con éxito, el servidor responde
`must_change_password` y el cliente obliga a elegir una nueva antes de dar la sesión. **Nadie
puede leer ni fijar la contraseña actual**, solo exigir que se cambie.

---

## 5. Límites y permisos

Dos niveles. El valor efectivo de un usuario es su anulación si existe, y si no, el global.

| Palanca | Clave | Tipo | Global por defecto |
|---|---|---|---|
| Modelos permitidos | `models` | lista de `mini` / `pro` / `vision` | `["mini"]` |
| Trabajos concurrentes | `max_concurrent` | entero | `2` |
| Trabajos por día | `max_daily` | entero | `50` |
| Almacenamiento | `max_storage_gb` | entero | `20` |
| Prioridad en cola | `queue_priority` | entero, −5 a +5 | `0` |
| Crear proyectos | `can_create_projects` | booleano | `true` |

**Este subsistema define, almacena y expone los límites; no los aplica.** Quien los aplica es
la cola (subsistema 4) y los proyectos (subsistema 6). La frontera es una única función:

```rust
limits::effective(store, user_id) -> Limits
```

Las administraciones de admin **no tienen límites**: `is_admin` los ignora todos. Un servidor
donde el administrador se autobloquea por un límite mal puesto es un servidor perdido.

Y dos estados que **no** son límites, sino banderas de la cuenta:

- `blocked` — corta el acceso sin borrar nada. Las sesiones abiertas se invalidan al bloquear.
- `must_change_password` — fuerza el cambio en el siguiente inicio de sesión.

---

## 6. Dispositivos y sesiones

Registro **pasivo**. El cliente genera un identificador aleatorio la primera vez y lo
persiste; lo envía al iniciar sesión junto a un nombre editable ("portátil de campo").

- Sirve para **auditar** (quién entró, desde dónde, cuándo) y para **revocar** una sesión
  concreta sin cambiarle la contraseña a nadie.
- **No autentica.** Copiar el fichero del cliente copia la identidad. Exigir dispositivos
  aprobados requeriría un par de claves por dispositivo, y se deja fuera a propósito: su
  coste real no es el código, es el soporte de cada portátil nuevo y cada reinstalación.

Esto queda escrito para que nadie asuma más adelante que el registro ya autenticaba.

---

## 7. Modelo de datos

```sql
CREATE TABLE access_requests (
    id            INTEGER PRIMARY KEY,
    display_name  TEXT NOT NULL,
    message       TEXT NOT NULL,
    ticket_phc    TEXT NOT NULL,          -- Argon2id, nunca el ticket en claro
    source_ip     TEXT NOT NULL,
    status        TEXT NOT NULL,          -- pending|approved|rejected|consumed|expired
    reason        TEXT,                   -- motivo del rechazo, visible para el usuario
    granted_models TEXT,                  -- JSON, elegido al aprobar
    created_at    INTEGER NOT NULL,
    expires_at    INTEGER NOT NULL,       -- +7 d; al aprobar pasa a +48 h
    resolved_at   INTEGER,
    resolved_by   INTEGER REFERENCES users(id)
);

CREATE TABLE devices (
    id          INTEGER PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users(id),
    client_id   TEXT NOT NULL,            -- generado y persistido por el cliente
    name        TEXT NOT NULL,
    os          TEXT,
    first_seen  INTEGER NOT NULL,
    last_seen   INTEGER NOT NULL,
    UNIQUE(user_id, client_id)
);

CREATE TABLE limits (
    id       INTEGER PRIMARY KEY,
    user_id  INTEGER REFERENCES users(id),  -- NULL = valor global
    key      TEXT NOT NULL,
    value    TEXT NOT NULL,                 -- JSON, para admitir listas y booleanos
    UNIQUE(user_id, key)
);
```

Ampliaciones sobre lo que ya existe:

```sql
ALTER TABLE users    ADD COLUMN display_name TEXT;
ALTER TABLE users    ADD COLUMN blocked INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users    ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sessions ADD COLUMN device_id INTEGER REFERENCES devices(id);
ALTER TABLE sessions ADD COLUMN created_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sessions ADD COLUMN last_seen  INTEGER NOT NULL DEFAULT 0;
-- Identificador público de la sesión, distinto del token. El token es un
-- secreto y no puede aparecer en una ruta: las rutas acaban en logs de
-- acceso y trazas de error. Este sirve para listar y revocar.
ALTER TABLE sessions ADD COLUMN public_id TEXT;
CREATE UNIQUE INDEX sessions_public ON sessions(public_id);
```

`UNIQUE(user_id, key)` en `limits` con `user_id` nulo: SQLite trata cada `NULL` como
distinto, así que la restricción **no** protege los globales de duplicarse. Se añade un índice
parcial para eso:

```sql
CREATE UNIQUE INDEX limits_global ON limits(key) WHERE user_id IS NULL;
```

---

## 8. API

Sobre TLS con huella anclada, igual que todo lo demás.

| Ruta | Auth | Descripción |
|---|---|---|
| `POST /v1/access-requests` | ninguna | Crea una solicitud. Devuelve el ticket una sola vez |
| `GET /v1/access-requests/status` | `Authorization: Ticket <t>` | Estado de la solicitud |
| `POST /v1/accounts` | `Authorization: Ticket <t>` | Crea la cuenta y consume el ticket |
| `POST /v1/auth/login` | credenciales | Ya existe. Gana `device` en el cuerpo y `must_change_password` en la respuesta |
| `POST /v1/auth/change-password` | sesión | Cambia la propia contraseña |
| `GET /v1/me/sessions` | sesión | Las sesiones propias, con su dispositivo |
| `DELETE /v1/sessions/:public_id` | sesión propia o admin | Revoca una sesión. Nunca por token: es un secreto |
| `GET /v1/admin/access-requests` | admin | Pendientes y resueltas |
| `POST /v1/admin/access-requests/:id/resolve` | admin | `{approve, reason?, granted_models?}` |
| `GET /v1/admin/users` | admin | Lista con límites efectivos |
| `GET /v1/admin/users/:id` | admin | Detalle: límites, dispositivos, sesiones |
| `PATCH /v1/admin/users/:id` | admin | `blocked`, `must_change_password`, anulaciones de límites |
| `GET /v1/admin/limits` | admin | Valores globales |
| `PATCH /v1/admin/limits` | admin | Cambia valores globales |

**El ticket viaja en cabecera, nunca en la ruta.** Es un secreto, y las rutas acaban en logs
de acceso, historiales de proxy y trazas de error.

### Superficie sin autenticar

`POST /v1/access-requests` es la única ruta escribible sin credenciales de todo el servidor.
Necesita defensas propias:

- **Límite por IP de origen**: 3 solicitudes por hora, 10 al día.
- **Tope global de pendientes**: 100. Superado, se rechazan nuevas con `503` hasta que el
  admin resuelva algunas. Evita que un bucle llene el disco.
- **Tamaños máximos**: nombre 80 caracteres, mensaje 500.
- Un interruptor global **`accept_requests`** para cerrar el grifo del todo, por si un
  servidor queda expuesto y empieza a recibir ruido.

---

## 9. Interfaz

Tokens, iconos y movimiento en [`DESIGN.md`](../../../DESIGN.md). Nueve estados en el mockup.

### Entrada

El inicio de sesión es la pantalla por defecto: es lo que se hace todos los días, frente a
configurar un servidor, que se hace una vez. El campo **Servidor** es un desplegable con los
servidores recordados y, al final de la lista tras un separador, **`+ Configurar un servidor
nuevo`**. Añadir un servidor es una acción sobre esa lista, así que vive dentro de ella.

Debajo del campo, `✓ Servidor verificado`. **Sin jerga criptográfica en toda la interfaz de
usuario**: nada de huellas en base58, `Argon2id` ni explicaciones de prefijos. La garantía se
comunica ("nadie puede leer tu contraseña"), el mecanismo se queda en esta spec.

### Espera

Un radar cuyo barrido da **una vuelta cada 30 segundos**, que es exactamente el intervalo del
sondeo: el movimiento informa en vez de decorar. Cuenta atrás visible hasta la siguiente
comprobación.

### Notificaciones

Campana en la esquina superior derecha con un punto que late al haber algo sin leer. La
aprobación llega ahí, **sin diálogo que interrumpa**. Al abrirla, la notificación lleva a
crear la cuenta.

En este subsistema la campana tiene un solo tipo de aviso (solicitud resuelta). El
subsistema 3 la reutiliza para las notificaciones que el admin envía a los usuarios.

### Administración — provisional

> **Estas vistas son temporales.** Dos pantallas —*Solicitudes* y *Usuarios/Detalle*— con el
> vocabulario existente y **sin navegación ni layout de panel**. El subsistema 3 diseña la
> administración desde cero y puede quedarse las piezas interiores o tirarlas enteras. No
> invertir esfuerzo de diseño aquí.

Dos criterios que sí conviene conservar aunque se rediseñe:

- **Cada límite dice de dónde viene** (`hereda del global` / `anulado · global 50`). Un límite
  sin origen visible es indepurable cuando alguien pregunta por qué solo puede lanzar uno.
- **Bloquear atenúa la fila, no la borra.** En forense, quitar a alguien de la lista borraría
  también el rastro de quién hizo qué.

---

## 10. Errores

| Situación | Comportamiento |
|---|---|
| Huella no coincide al pegar la tarjeta | Aborta. Mismo trato que en el subsistema 1 |
| Tarjeta con formato inválido | Error de parseo, sin conectar |
| Se pega una clave `lumi1_` en vez de `lumi1s_` | Se acepta: lleva al flujo del owner, que es lo que esa clave significa |
| Solicitud a un servidor sin administrador | `409`: el servidor aún no está reclamado, hace falta la clave de vinculación |
| Ticket caducado al sondear | `410` con el motivo; el cliente ofrece volver a solicitar |
| Ticket ya consumido | `409`. La cuenta ya existe: iniciar sesión |
| Nombre de usuario ya ocupado al crear la cuenta | `409`; el ticket **no** se consume, se puede reintentar con otro nombre |
| Cuenta bloqueada al iniciar sesión | `403` con mensaje explícito, distinto de credenciales incorrectas |
| Credenciales incorrectas | `401` con el mismo texto exista o no el usuario |
| Superado el límite de solicitudes por IP | `429` con el tiempo de espera |
| El único admin se bloquea o pierde la contraseña | Escotilla por CLI en el host: `lumi admin reset-password <usuario>` y `lumi admin unblock <usuario>` |

---

## 11. Fuera de alcance

Notificaciones redactadas por el admin (subsistema 3). Panel de administración real
(subsistema 3). **Aplicación** de los límites: aquí se definen y se exponen, los aplican la
cola (4) y los proyectos (6). Vinculación obligatoria de dispositivos. Autenticación federada
(LDAP, SSO). Recuperación de contraseña por correo: no hay correo en el sistema, y la vía es
que un admin marque el cambio.

---

## 12. Riesgos

**La ruta sin autenticar.** `POST /v1/access-requests` es la primera superficie escribible sin
credenciales del proyecto. Las defensas de §8 son el mínimo; si un despliegue queda expuesto a
Internet, el interruptor `accept_requests` es la respuesta.

**El ticket es una credencial en el cliente.** Vive en el almacenamiento local, sin cifrar,
igual que el token de sesión. Quien tenga acceso al equipo del usuario durante la ventana de
48 h puede crear la cuenta en su lugar. Aceptable para la ventana y el modelo de amenaza, pero
conviene no alargar ese plazo sin pensarlo.

**SQLite y los `NULL` de `limits`.** El índice parcial resuelve la unicidad de los globales,
pero es el tipo de detalle que se rompe en una migración descuidada. Merece la comprobación
ejecutable del plan.

**Bloquear no cierra trabajos en curso.** Un usuario bloqueado pierde la sesión, pero sus
trabajos ya encolados siguen. Decidir qué hacer con ellos es del subsistema 4; aquí solo se
deja anotado para que no se olvide.
