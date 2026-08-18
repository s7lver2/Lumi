# Créditos, límite semanal y solicitud de más cupo — diseño

## Contexto

Hoy `limits.rs` define dos niveles (global y anulación por usuario) sobre siete
palancas fijas (`models`, `max_concurrent`, `max_daily`, `max_storage_gb`,
`queue_priority`, `can_create_projects`, `background_jobs`), resueltas por
`effective()`. No existe concepto de "créditos" como saldo — lo que el
usuario llama créditos es el tope diario ya existente (`max_daily`). Esta
spec no crea un sistema de saldo nuevo: extiende el tope diario con un tope
semanal opcional, y añade un circuito para pedir más cupo cuando se choca
con cualquiera de los dos, con aviso al administrador.

Las API keys ya heredan el límite de su dueño sin cambios: una clave es una
fila más en `sessions` con `kind = 'api_key'`, y `require_session` la
resuelve al mismo `user_id` que un login normal — `analyses::create()` ya
cuenta contra ese `uid`. Confirmado en el código, no hace falta tocarlo.

## A. Tope semanal

Dos claves nuevas en `limits::KEYS`, con la misma mecánica de dos niveles
que las siete ya existentes:

- `weekly_enabled` (bool) — interruptor on/off, global y anulable por usuario.
- `max_weekly` (i64) — el valor, igual de anulable.

`Limits` (en `lumi-proto::api`) gana esos dos campos con sus defectos
(`weekly_enabled: false`, `max_weekly: 300`). `apply()` en `limits.rs` gana
sus dos brazos de match, igual que los otros seis.

En `analyses::create()` (`crates/lumid/src/routes/analyses.rs`), junto a la
comprobación de `max_daily` ya existente, se añade: si `l.weekly_enabled`,
contar `analyses` de `requested_by = uid` con `created_at > now() - 7*86400`
y compararlo con `l.max_weekly`, mismo `429` que el diario.

## B. Solicitud de más cupo

Tabla nueva `credit_requests`:

```sql
CREATE TABLE IF NOT EXISTS credit_requests (
    id             INTEGER PRIMARY KEY,
    user_id        INTEGER NOT NULL,
    tipo           TEXT NOT NULL,   -- 'diario' | 'semanal'
    valor_actual   INTEGER NOT NULL,
    valor_propuesto INTEGER NOT NULL,
    mensaje        TEXT,
    status         TEXT NOT NULL,   -- 'pending' | 'approved' | 'rejected'
    reason         TEXT,
    created_at     INTEGER NOT NULL,
    resolved_at    INTEGER,
    resolved_by    INTEGER
);
```

Reglas:

- Solo una solicitud `pending` a la vez por `(user_id, tipo)` — la creación
  rechaza con `409` si ya hay una pendiente del mismo tipo, mismo criterio
  que "la primera resolución gana" que ya usa `access_requests`.
- El usuario propone `tipo`, `valor_propuesto` y un `mensaje` opcional;
  `valor_actual` se rellena en el servidor con `limits::effective()` en el
  momento de la solicitud (no lo manda el cliente, para que no pueda mentir
  sobre su punto de partida).
- Al aprobar (`admin`), el endpoint recibe un valor final (puede ser el
  propuesto u otro editado por el admin) y llama a
  `limits::set(user_id, "max_daily"|"max_weekly", valor)`. Al rechazar, solo
  cambia `status`/`reason`.
- Endpoints: `POST /v1/me/credit-requests` (usuario), `GET
  /v1/admin/credit-requests` (admin, todas), `POST
  /v1/admin/credit-requests/{id}/resolve` (admin).

## C. Integración en Solicitudes (no una sección nueva)

`RequestsView.tsx` pasa a listar dos fuentes mezcladas por fecha: `GET
/v1/admin/access-requests` (ya existente) y `GET
/v1/admin/credit-requests` (nueva). Mismo componente, mismo grid de 4
columnas (`1fr_122px_92px_22px`) que ya existe — el tipo se distingue con un
icono circular de 22px inline junto al nombre, mismo tratamiento visual que
ya usa `NotificationsPopover` para "acceso" (escudo, ámbar) vs. lo nuevo
"crédito" (candado, azul `draw`/`draw-fg`). No se añade columna nueva: eso
rompería el grid ya ajustado a mano.

El cuerpo desplegable cambia según el tipo:
- `acceso`: exactamente el que ya existe (Lo que escribió, dispositivo,
  dirección, chips de modelos a conceder).
- `credito`: dos `Dato` (valor actual / valor propuesto) + el mensaje si lo
  hay, y los mismos botones Aprobar/Rechazar (`rounded-lg bg-accent
  text-black` / `rounded-lg border border-white/15 text-fg`).

## D. Aviso al administrador

Canal SSE nuevo, admin-only: `/v1/admin/events`. Mismo patrón que
`/v1/queue/events` (`crates/lumid/src/routes/queue.rs`) pero el filtro es
"la sesión es admin", no "es el dueño del job". Un solo tipo de evento por
ahora: `Cambio::SolicitudCredito { user_id, tipo }`, emitido al crear una
fila en `credit_requests`.

En el cliente, un componente `CreditToast` calcado de `IndexToast`
(`AdminPanel.tsx`): tarjeta flotante 308px, esquina inferior derecha,
descartable con `✕`, mismo `rgba(20,22,26,.97)` + `backdrop-blur-xl`. Se
monta una vez en `AdminPanel.tsx` junto a `ModelToasts`/`IndexToast`, se
suscribe al SSE mientras el admin tiene el panel abierto, y al pulsarlo
navega a la sección Solicitudes (mismo patrón `onIr={setSeccion}` que ya
usan los otros dos toasts).

Si el admin no está conectado, no hay recuperación retroactiva del evento
SSE — lo ve como una fila más al abrir Solicitudes, igual que ya pasa hoy
con `access_requests` pendientes.

## E. Interfaz de usuario — pedir más cupo

Cuando `analyses::create()` devuelve 429 (tope diario o semanal agotado), la
pantalla de trabajo ofrece un botón "Pedir más cupo" que abre un diálogo
modal (mismo patrón que `PromptDialog.tsx`: `rounded-card border
border-white/[.13] bg-[rgba(16,19,25,.92)] backdrop-blur-xl`), con:

- Selector diario/semanal (chips, mismo patrón `border-accent` on / `
  border-border` off que ya usan los modelos concedidos en `RequestsView`).
- El tope actual (solo lectura) y un campo para el valor propuesto.
- Un campo de mensaje opcional.
- Botones Cancelar/Enviar.

Si ya hay una solicitud pendiente del mismo tipo, el botón se deshabilita y
muestra "ya tienes una solicitud pendiente" en vez de abrir el diálogo —
sin necesidad de que el servidor rechace con 409 primero.

## Fuera de alcance

Saldo de créditos independiente del reseteo diario/semanal (el usuario
confirmó que no lo quiere), límites por API key distintos de los de su
dueño (ya comparten los del dueño, sin cambios), y cualquier tercer periodo
(mensual, etc.) — si hace falta se añade como una palanca más siguiendo el
mismo patrón de dos claves (`_enabled` + valor).
