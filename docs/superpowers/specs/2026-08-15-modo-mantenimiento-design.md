# Modo mantenimiento — Design

## Contexto

`ARCHITECTURE.md` menciona `MAINTENANCE` como un estado ortogonal del servidor "introducido por
el subsistema 3c", sin diseño concreto. `FUTURO.md` (bajo "Panel de administración real") lo lista
entre las cosas prometidas para el subsistema 3. Hoy no existe ni en el backend ni en el cliente:
el sidebar tiene una entrada "Mantenimiento" marcada `pronto` que no lleva a ningún sitio
(`Sidebar.tsx`, `AdminPanel.tsx`, `Hueco.tsx`).

Esta entrada de sidebar se elimina como parte de este trabajo: el modo mantenimiento no es una
pantalla propia, es un control más dentro de "Seguridad" — mismo sitio que Zero Trust, con el
mismo patrón visual de interruptor-que-despliega-más-interruptores ya construido para
"Autoservicio de IP".

## Qué resuelve

Un administrador necesita poder sacar el servidor de circulación (mantenimiento de hardware,
actualización del motor de inferencia, etc.) sin desconectar el proceso — la telemetría y su
propia sesión siguen vivas — y sin que eso signifique "todo o nada": debe poder decidir qué sigue
funcionando mientras dura.

## Modelo

**Por defecto, activar el modo bloquea toda la API salvo un núcleo mínimo, y el administrador
reactiva explícitamente lo que necesite seguir funcionando.** Fail-closed: cualquier ruta que este
diseño no clasifique explícitamente queda bloqueada, no permitida — más seguro que lo contrario
cuando lo que se está protegiendo es "casi todo el servidor".

### Núcleo siempre alcanzable (no personalizable)

Estas rutas nunca se bloquean, tenga o no permiso su llamante, porque sin ellas ni un
administrador podría revertir el modo o el propio banner no podría mostrarse:

- `/v1/hello` — descubrimiento, no autenticado, necesario antes de cualquier login.
- `/v1/auth/me`, `/v1/me/sessions`, `/v1/sessions/:id`, `/v1/auth/change-password` — para que
  quien ya tiene sesión sepa quién es, vea sus sesiones, o cierre la suya.
- `/v1/admin/security` (y sus sub-rutas de listas) — para que el propio admin pueda apagar el
  modo. Ya exige `require_admin`, así que no hace falta protegerlo aparte.

`/v1/auth/login` **no** entra en este núcleo ni en el gateo genérico — ver "Login" más abajo.

### Servicios personalizables (`maintenance_services`)

Una lista de ids, vacía por defecto (= todo bloqueado). El administrador añade los que quiere
mantener vivos. Cada id agrupa varios prefijos de ruta:

| id | rutas |
|---|---|
| `modelos` | `/v1/admin/models*` |
| `indices` | `/v1/indices*` |
| `mapa` | `/v1/map*` (Customización) |
| `cola` | `/v1/queue*`, `/v1/tasks*` |
| `proyectos` | `/v1/projects*`, `/v1/images*`, `/v1/cases*`, `/v1/me/invites`, `/v1/invites*`, `/v1/me/usage` |
| `personas` | `/v1/access-requests*`, `/v1/accounts`, `/v1/admin/access-requests*`, `/v1/admin/users*`, `/v1/users/search` |
| `claves` | `/v1/me/api-keys`, `/v1/admin/api-keys`, `/v1/api-keys*` |

Un administrador autenticado (`is_admin`) atraviesa el gateo sin mirar esta lista — el modo
mantenimiento restringe a los demás, nunca a quien puede apagarlo.

### Login

El login es el único caso donde el gateo genérico (que solo ve la ruta, no el resultado de
verificar credenciales) no sirve: para saber si hay que dejar pasar a alguien hace falta primero
comprobar su contraseña y si es admin. Por eso vive **dentro** de `routes::auth::login`, no en el
middleware:

- `maintenance_block_login = false` (por defecto): el login funciona igual que siempre,
  mantenimiento o no.
- `maintenance_block_login = true`: tras verificar la contraseña, si la cuenta no es admin, se
  responde `503` en vez de emitir el token. **Un administrador siempre puede iniciar sesión**,
  tenga o no activado este interruptor — perder el acceso propio en mitad de un mantenimiento no
  tiene vuelta atrás salvo tocar la base de datos a mano, y eso es peor que la alternativa.

## Esquema y tipos

Se extiende lo que Zero Trust ya usa — mismo endpoint, mismo patrón de `meta` — en vez de crear
una tabla o ruta nueva:

**`lumi-proto/src/api.rs`**, ampliando lo existente:

```rust
pub struct SecuritySettings {
    pub zero_trust: bool,
    pub self_service_ip: bool,
    pub allowlist: Vec<String>,
    pub denylist: Vec<String>,
    pub maintenance: bool,
    pub maintenance_message: String,
    pub maintenance_block_login: bool,
    pub maintenance_services: Vec<String>,
}

pub struct PatchSecurityReq {
    pub zero_trust: Option<bool>,
    pub self_service_ip: Option<bool>,
    pub maintenance: Option<bool>,
    pub maintenance_message: Option<String>,
    pub maintenance_block_login: Option<bool>,
    pub maintenance_services: Option<Vec<String>>,
}
```

Nuevas claves de `meta` (mismo mecanismo que `zero_trust`/`self_service_ip`, sin tabla nueva):
`maintenance` (`"0"`/`"1"`), `maintenance_message` (texto), `maintenance_block_login`
(`"0"`/`"1"`), `maintenance_services` (JSON de `Vec<String>`).

## Backend

**Nuevo módulo `crates/lumid/src/mantenimiento.rs`**, calcado de `zero_trust.rs`: funciones puras
sobre datos ya leídos, más el middleware que las junta.

```rust
pub fn activo(app: &App) -> bool
pub fn mensaje(app: &App) -> String                 // "" si no se ha puesto ninguno
pub fn bloquea_login(app: &App) -> bool
pub fn servicios_habilitados(app: &App) -> Vec<String>
pub fn set_activo(app: &App, on: bool) -> anyhow::Result<()>
pub fn set_mensaje(app: &App, msg: &str) -> anyhow::Result<()>
pub fn set_bloquea_login(app: &App, on: bool) -> anyhow::Result<()>
pub fn set_servicios(app: &App, ids: &[String]) -> anyhow::Result<()>

/// None = ruta del núcleo, siempre alcanzable. Some(id) = pertenece a un
/// servicio personalizable.
pub fn servicio_de_ruta(path: &str) -> Option<&'static str>

pub async fn mantenimiento_gate(/* mismos extractors que zero_trust_gate */) -> Response
```

`mantenimiento_gate` en `main.rs`, como capa adicional junto a `zero_trust_gate` (el orden entre
ambas no importa — cada una decide de forma independiente y cualquiera puede cortar la petición
antes de llegar al handler):

```
si !activo(app) → pasar
si path es del núcleo → pasar
si quien llama es admin (token válido con is_admin) → pasar
según servicio_de_ruta(path):
    Some(id) si id ∈ servicios_habilitados(app) → pasar
    en cualquier otro caso → 503, cuerpo = mensaje(app) o "Servidor en mantenimiento."
```

`routes::security::get_security`/`patch_security` (ya existentes desde el trabajo de Zero Trust)
se amplían para leer/escribir los cuatro campos nuevos, exactamente como ya hacen con
`zero_trust`/`self_service_ip`.

## Frontend

**`SecurityView.tsx`**: una segunda tarjeta, debajo de la de Zero Trust, con el mismo componente
de despliegue (`grid-template-rows: 0fr → 1fr`) ya construido para "Autoservicio de IP":

- Fila superior: interruptor "Modo mantenimiento".
- Al desplegarse: un `<textarea>` para el mensaje, la fila "Bloquear login de usuarios", y una
  rejilla de 2 columnas con un interruptor por servicio (`modelos`, `indices`, `mapa` con label
  "Customización", `cola`, `proyectos` con label "Proyectos y casos", `personas`, `claves` con
  label "API Keys") — todos apagados por defecto.
- Una nota fija: "Todo lo demás queda en 503 con el mensaje de arriba. Nada se bloquea en
  silencio." — mismo criterio de la matriz de capacidades del proyecto (ningún recorte oculto).

**Banner para toda la app** (`client/src/ui/MantenimientoBanner.tsx`, montado por `App.tsx` junto
a `TitleBar`, no solo por `AdminPanel.tsx`): revisión posterior al primer corte — un usuario
normal bloqueado por el modo también tiene que enterarse de por qué, no solo el administrador que
lo activó. Visible en cualquier `mode` (wizard, picker, proyecto, caso, admin, perfil) en cuanto
hay sesión. Fondo con rayas diagonales en tono aviso que se deslizan despacio — la lectura visual
es "cinta de obra en movimiento", consistente con que el modo sigue activo. El mensaje configurado
se muestra dentro; si el admin no escribió ninguno, cae a un texto genérico ("Servidor en
mantenimiento."). El mockup aprobado vive en el historial de la conversación de brainstorming (no
se conserva como archivo versionado — `.superpowers/` está en `.gitignore`).

El transporte es la muestra de telemetría ya existente (`Sample`, por SSE cada segundo,
reemitida como evento `"telemetry"` de Tauri) en vez de una petición aparte a
`/v1/admin/security` — esa ruta exige ser administrador, así que un usuario normal no podría
leerla, y la telemetría ya llega a toda sesión abierta sin depender de nada más (mismo criterio
que "la telemetría sigue viva en `LOCKED`"). `Sample` gana `maintenance: bool` y
`maintenance_message: String`; `/v1/telemetry` entra en el núcleo fijo del gateo (bloquearla
apagaría el propio aviso). Esto también resuelve gratis la actualización en tiempo real: la tira
aparece/desaparece con la siguiente muestra (≤1s), sin refrescar ni renavegar.

**Eliminación de la entrada de sidebar**: `Sidebar.tsx` pierde `"mantenimiento"` del tipo
`Seccion` y de `GRUPOS`; `AdminPanel.tsx` pierde `"mantenimiento"` de `PRONTO`; `Hueco.tsx` no
necesita cambios si ya no se le pasa esa sección (verificar si queda algún otro `pronto` que lo
siga usando — `notificaciones` y `hardware` siguen ahí).

## Fuera de alcance

- Banner o degradación visible para usuarios no-administradores.
- Mantenimiento programado (activarlo/desactivarlo en una fecha futura) — hoy es un interruptor
  manual, nada de cron.
- Persistir un historial de ventanas de mantenimiento pasadas.

## Auto-revisión

- **Cobertura:** las cinco preguntas respondidas durante el brainstorming (bloqueo total salvo
  admin como comportamiento base, granularidad por servicio HTTP, núcleo fijo más amplio que solo
  login, login bloqueable pero nunca para admins, mensaje personalizable) están todas reflejadas
  arriba.
- **Sin placeholders:** cada pieza de esquema, función y regla de gateo está completamente
  especificada; no hay "TBD" ni "similar a Zero Trust" sin más — se cita explícitamente qué se
  reutiliza y por qué.
- **Consistencia interna:** los nombres de servicio (`modelos`, `indices`, `mapa`, `cola`,
  `proyectos`, `personas`, `claves`) son los mismos en la tabla de rutas, el tipo `Vec<String>` de
  `maintenance_services`, y los labels de la rejilla del frontend.
- **Alcance:** una sola pieza coherente (backend + su única pantalla), apta para un plan de
  implementación sin partirla más.
