# Página de Cola mejorada — diseño

## Contexto

La página de Cola hoy es literalmente el widget provisional `QueueRow.tsx`
(el mismo que aparece embebido en el Resumen) envuelto en un título distinto
dentro de `AdminPanel.tsx`. El propio comentario del código lo dice:
"PROVISIONAL... el subsistema 3 rehace el panel entero". Solo muestra dos
contadores (pendientes/en curso) y una lista plana de trabajadores. No hay
manera de ver qué pendientes existen uno por uno, por qué alguno no se
reparte, ni de actuar sobre ellos.

## Alcance

- Exponer los pendientes uno por uno, con el motivo por el que uno no se
  reparte cuando aplica.
- Poder cancelar un pendiente como administrador.
- Enlazar al editor de Límites del usuario dueño de un pendiente.
- Dos vistas conmutables sin recargar: **Cinta** (línea de tiempo animada
  por trabajador) y **Tabla** (densa, de diagnóstico).
- Actualización en vivo vía el canal de eventos admin existente, sin sondeo.

Fuera de alcance: prioridad por trabajo individual (hoy solo existe por
usuario, vía `queue_priority` en Límites — no se introduce un concepto
nuevo); reordenar manualmente la cola; historial de trabajos resueltos más
allá de lo que cabe en pantalla (eso ya vive en el detalle de cada caso).

## 1. Backend — datos de `/v1/queue`

`QueueView` (hoy `{ pendientes, en_curso, trabajadores }`) gana un campo:

```rust
pub struct QueueView {
    pub pendientes: u32,
    pub en_curso: u32,
    pub trabajadores: Vec<WorkerView>,
    pub pendientes_detalle: Vec<PendienteView>,
}

pub struct PendienteView {
    pub id: i64,
    pub username: String,
    pub case_id: i64,
    pub case_nombre: String,
    pub nivel: String,
    pub creado_en: i64,
    pub razon: Option<RazonBloqueo>,
}

#[derive(Serialize, Deserialize, Clone, Copy)]
#[serde(rename_all = "snake_case")]
pub enum RazonBloqueo {
    Bloqueado,
    Desconectado,
    LimiteAlcanzado,
}
```

`razon` es `None` cuando el pendiente simplemente espera un hueco libre — no
hay nada que explicar, solo no le ha tocado turno. Se calcula reutilizando
la misma información que ya produce `Queue::duenos()` para repartir (no una
copia): `Dueno.bloqueado` → `Bloqueado`; `!Dueno.conectado &&
!Dueno.segundo_plano` → `Desconectado`; `Dueno.en_curso >=
Dueno.max_concurrent` → `LimiteAlcanzado`. Prioridad de motivo en ese orden
si varios aplican a la vez (bloqueado importa más que desconectado).

`Queue::foto()` (la que sirve `GET /v1/queue`) pasa a construir
`pendientes_detalle` a partir de `candidatos()` (ya trae id/user_id/
modelo/created_at) + `duenos()` (ya trae el estado por usuario) + un JOIN
con `users` (username) y `cases`/`analyses` (case_id, nombre del caso) que
hoy no se piden ahí pero son consultas SQLite triviales, no una carga nueva
de trabajo — `foto()` ya abre `store.conn()` para los contadores actuales.

## 2. Backend — cancelar un pendiente como admin

`DELETE /v1/analyses/:id` ya existe (`routes/analyses.rs::remove`) y ya
rechaza cancelar un análisis `en_curso` con 409. Hoy exige `guard_case`
(ser miembro del proyecto del caso). Se le añade un bypass: si
`require_admin` pasa, se salta `guard_case` — incluida su comprobación de
que el caso exista, sustituida por el `NOT FOUND` que ya lanza la consulta
inicial del propio `remove()` si el id no existe. Incluye una nota rápida
en el comentario de la función explicando este segundo camino de acceso,
igual que el resto del código documenta desviaciones de estilo. Mismo
endpoint, mismo comportamiento para usuarios normales — no se crea un
endpoint nuevo.

## 3. Backend — aviso en vivo

Nueva variante en `EventoAdmin` (el enum ya documentado como "nace pensado
para crecer"):

```rust
pub enum EventoAdmin {
    SolicitudCredito { .. },
    SolicitudAcceso { .. },
    ColaCambio,
}
```

Sin payload — es una señal, no un snapshot; el cliente reacciona
refrescando `GET /v1/queue`. Se emite por `app.admin_eventos` (el mismo
broadcast que ya usan las otras dos variantes) desde los puntos donde la
cola cambia de verdad dentro de `queue/mod.rs`: al repartir un trabajo
(`repartir_ahora`, justo donde ya se llama a `anunciar`), al resolver o
fallar un análisis (`resolver`/`fallar`), y al cambiar el estado `listo` de
un trabajador. El cliente ya recibe este canal sin cableado nuevo: el
bridge de Tauri (`startAdminEvents`) y el `listen<EventoAdmin>("admin-events",
...)` de `AdminEventToast.tsx` son el mismo mecanismo — solo se añade un
caso más al `match`/`in` que ya distingue variantes.

## 4. Frontend — estructura de la página

Nuevo archivo `client/src/admin/ColaView.tsx`, reemplaza el
`<QueueRow token={token} />` envuelto que hoy vive en `AdminPanel.tsx` para
`seccion === "cola"`. `QueueRow.tsx` no se toca — sigue siendo el widget
condensado del Resumen.

`ColaView` pide `/v1/queue` al montar y cada vez que llega `ColaCambio` por
`listen<EventoAdmin>("admin-events", ...)` — sin `setInterval`. Estructura:

- **Franja de estado**: 3 tarjetas (pendientes, en curso, trabajadores
  listos/total), estilo tarjeta ya establecido en el panel (borde sutil,
  fondo con degradado suave, número en mono).
- **Selector de vista** (Cinta / Tabla), mismo patrón visual que otros
  selectores de dos opciones del panel (p. ej. el de "vista" en Usuarios:
  lista/foto/nombre), persistido en `localStorage` bajo
  `lumi.cola.vista`.
- **Vista Cinta**: pool de Pendientes en columna a la izquierda (avatar
  tipo `UserTile`, caso, nivel, badge de `razon` cuando aplica) + carriles
  horizontales por trabajador a la derecha, cada uno con una línea "ahora"
  fija; a la izquierda de esa línea el trabajo activo (borde con pulso +
  barra de actividad indicativa, no un progreso real) y lo resuelto
  reciente atenuándose hasta desvanecer por una máscara de degradado. Un
  pendiente nunca aparece ya "dentro" de un carril — no tiene trabajador
  asignado hasta que el reparto ocurre. Cuando `ColaCambio` revela que un
  pendiente pasó a `en_curso`, su tarjeta anima del pool hacia el carril
  que lo recibió vía una transformación FLIP (mide posición origen/destino
  reales, anima el delta con `cubic-bezier(.22,1,.36,1)` — la curva que ya
  usa `jg-fade-rise` en el resto del panel), no un salto de posición fija.
- **Vista Tabla**: una fila por pendiente — dueño (enlace), caso, nivel,
  tiempo esperando (`ago()` de `lib/time.ts`), badge de motivo o
  "esperando hueco" en texto neutro, botón cancelar. Mismo componente
  `WorkerRow`-like para trabajadores debajo, reutilizando el diseño actual
  de `QueueRow` para esa parte (dispositivo, listo/cargando, trabajo en
  mano) sin cambios de forma.
- **Trabajadores**: en la vista Tabla se listan aparte (como hoy); en la
  vista Cinta viven como cabecera de cada carril.

Cancelar: botón con confirmación inline (mismo patrón `¿seguro?` ya usado
en otras acciones destructivas del panel) que llama a
`DELETE /v1/analyses/:id` y refresca. Enlace del dueño: navega a
`seccion="usuarios"` pasando un nuevo prop opcional
`UsersView({ token, abrirUserId? })` que, si está presente, llama a
`open(abrirUserId)` al montar (mismo `open()` que ya usa el click de una
fila en `UsersView`) — sin mecanismo de routing nuevo, mismo hilo de props
que ya usa `onIr` en el resto del panel.

## 5. Errores y estados vacíos

- Sin pendientes: el pool muestra un estado vacío neutro ("nada esperando
  turno"), sin animación de cinta corriendo en vacío.
- Sin trabajadores lanzados: mensaje ya existente ("ningún trabajador ha
  llegado a lanzarse"), igual que hoy.
- Fallo al cancelar (404/409): mensaje inline en la fila/tarjeta afectada,
  no un toast global — el 409 ("ya se está ejecutando") es un caso real de
  carrera (se reparte justo antes de que el click de cancelar llegue).
- Fallo de `GET /v1/queue`: mismo patrón de error ya usado en `QueueRow`
  (mensaje de texto simple), no una pantalla de error dedicada.

## Fuera de alcance (explícito)

- Prioridad por trabajo individual — no existe el concepto en el esquema;
  se gestiona por usuario desde Límites.
- Reordenar manualmente el pool de pendientes (drag-and-drop) — el reparto
  siempre lo decide el daemon, esta vista es de observación + cancelar, no
  de control manual del orden.
- Historial de trabajos resueltos más allá de lo visible en la cinta/tabla
  — ya existe por caso en el detalle de análisis.
