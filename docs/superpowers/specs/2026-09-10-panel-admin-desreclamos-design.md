# Panel de admin para la liberación de teselas

Fecha: 2026-09-10
Estado: diseño aprobado, pendiente de plan de implementación
Continúa: `docs/superpowers/plans/2026-09-01-liberacion-teselas-plan.md` (BUG_BOUNTY #38, fases 1-3
ya hechas) — este spec es la pieza que faltaba: revisar y decidir sobre la cola desde un panel,
en vez de abrir el JSON a mano en GitHub.

## Por qué

Hoy la cola de solicitudes de liberación (`web/releases/liberaciones-pendientes.json`) se revisa
abriendo el fichero en GitHub y se procesa corriendo `firmar_desreclamos fusionar-pendientes` a
ciegas: trae **todo** lo que hay en la cola, sin que nadie haya decidido si cada solicitud es
legítima. Un panel mínimo, con login, resuelve el paso que falta: decidir aprobar o rechazar cada
solicitud, sin tocar la invariante de seguridad ya establecida en el código — **la clave privada
Ed25519 de firma nunca sale de la máquina del operador ni toca ningún servidor**. Aprobar en el
panel no firma nada; solo marca qué debe entrar la próxima vez que el operador firme a mano.

## Alcance

Una sola pantalla en `web/` (`lumi.s7lver.xyz/admin`): login, lista de solicitudes pendientes,
aprobar/rechazar. Nada de navegación, nada de otras secciones de administración — eso queda fuera
a propósito (ver «Fuera de alcance»).

---

## 1. Autenticación

Login con GitHub, no usuario/contraseña propios: reutiliza la identidad que el operador ya tiene,
sin inventar ni guardar una contraseña en ningún sitio.

**Una GitHub OAuth App nueva y separada** de la que ya usa el Indexer. La del Indexer usa el
*flujo de dispositivo* (pensado para apps de escritorio, sin *callback URL*); el navegador necesita
el *flujo estándar de código de autorización* (Authorization Code), que sí necesita una
*callback URL* registrada (`https://lumi.s7lver.xyz/api/admin/callback`). Mezclar las dos
complicaría ambas sin necesidad — son casos de uso distintos aunque el proveedor sea el mismo.

Flujo:

1. `GET /api/admin/login` — redirige a
   `https://github.com/login/oauth/authorize?client_id=...&scope=read:user`. No hace falta ningún
   scope de repositorio: esta app solo necesita saber quién eres, no escribir en tu nombre — quien
   escribe en el repo es siempre el PAT del propio proyecto (`GITHUB_LIBERACIONES_TOKEN`, ya
   existente), nunca la identidad de quien ha iniciado sesión.
2. `GET /api/admin/callback?code=...` — el servidor cambia el código por un token
   (`POST https://github.com/login/oauth/access_token` con `client_id`+`client_secret`, nunca
   expuestos al navegador), y con ese token llama a `GET https://api.github.com/user` para obtener
   el login real.
3. Si ese login está en `ADMIN_GITHUB_LOGINS` (variable de entorno, lista separada por comas — hoy
   una sola cuenta, pero admite añadir más sin tocar código ni volver a desplegar lógica), se firma
   una cookie de sesión: `HttpOnly`, `Secure`, `SameSite=Lax`, valor `base64(payload) + "." +
   HMAC-SHA256(payload, ADMIN_SESSION_SECRET)`, `payload = {login, exp}` con `exp` a 12 horas.
   Sin librería de sesiones — es una firma y una comparación, no hace falta más.
4. Si el login no está en la lista: `403`, página de error explícita ("esta cuenta de GitHub no
   tiene acceso al panel"), sin cookie.

Todas las rutas de datos (`/api/admin/liberaciones*`) comprueban la cookie al entrar: la
decodifican, verifican el HMAC, comprueban `exp`, y comprueban de nuevo que el `login` siga en
`ADMIN_GITHUB_LOGINS` (por si la lista cambió después de emitida la cookie). Cualquier fallo de
estas comprobaciones es `401`, nunca un intento de "arreglarlo" silenciosamente.

**Variables de entorno nuevas en Vercel** (no configurables desde este repo — el operador las
crea a mano en el dashboard, igual que ya existe `GITHUB_LIBERACIONES_TOKEN`):

- `ADMIN_GITHUB_OAUTH_CLIENT_ID` / `ADMIN_GITHUB_OAUTH_CLIENT_SECRET` — de la OAuth App nueva.
- `ADMIN_GITHUB_LOGINS` — logins de GitHub admitidos, separados por comas.
- `ADMIN_SESSION_SECRET` — cadena aleatoria larga, generada una vez (`openssl rand -hex 32` o
  equivalente), solo para firmar la cookie.

## 2. El dato: `estado` en la cola existente

`EntradaPendiente` (hoy en `web/app/api/desreclamos/solicitar/route.ts` y en
`crates/lumi-index/examples/firmar_desreclamos.rs`) gana un campo:

```ts
estado?: "pendiente" | "aprobada" | "rechazada"; // ausente == "pendiente"
```

Ausente se trata como `"pendiente"` — una entrada escrita antes de este cambio (por el endpoint
de solicitud actual, que no conoce este campo) se sigue leyendo bien, sin migración. El endpoint
de solicitud (`POST /api/desreclamos/solicitar`) no cambia: sigue escribiendo entradas sin
`estado`, que es lo mismo que escribir `"pendiente"`.

## 3. Rutas nuevas en `web/`

Todas bajo `web/app/api/admin/`:

- **`GET /login`** — redirige a GitHub. Sin cuerpo.
- **`GET /callback`** — intercambia el código, verifica el login contra `ADMIN_GITHUB_LOGINS`,
  pone la cookie, redirige a `/admin`.
- **`GET /liberaciones`** — requiere cookie válida. Lee
  `web/releases/liberaciones-pendientes.json` (misma API de contenidos de GitHub que ya usa
  `solicitar/route.ts` para leer) y devuelve solo las entradas con `estado` ausente o
  `"pendiente"`.
- **`POST /liberaciones/[paquete]`** — requiere cookie válida. Body `{decision: "aprobada" |
  "rechazada"}`. Lee el JSON, localiza la entrada por `paquete` (404 si no existe o ya no está
  pendiente — evita una doble decisión silenciosa si dos pestañas del panel están abiertas a la
  vez), fija su `estado`, escribe con el PAT del proyecto (`GITHUB_LIBERACIONES_TOKEN`, el mismo
  que ya usa `anadirALaCola`), y devuelve `200`.

`POST /logout` no hace falta como ruta aparte: basta un botón que borre la cookie
client-side (`document.cookie = "..."` con fecha pasada) — no hay estado de servidor que limpiar.

## 4. La pantalla

Una sola página, `web/app/admin/page.tsx`, sin rutas ni pestañas adicionales.

- **Sin sesión**: el destello de Lumi, "Panel de administración", y un botón "Continuar con
  GitHub" que lleva a `/api/admin/login`. Si la cookie expiró o el login no está autorizado, un
  mensaje de una línea encima del botón con el motivo (misma filosofía de la matriz de
  capacidades del resto del producto: nunca un fallo mudo).
- **Con sesión**: una lista, una fila por solicitud pendiente — `paquete`, `cuenta` (quien la
  pidió), `fecha`, número de `quadkeys` — con dos botones por fila, **Aprobar** / **Rechazar**.
  Al pulsar uno, la fila desaparece de la vista (no hay historial visible en esta pantalla: el
  rastro de qué se decidió ya vive en el propio JSON — `estado` — y en el historial de commits de
  GitHub, no hace falta que el panel lo repita).
  - Cola vacía: "No hay solicitudes pendientes." — nunca una tabla en blanco sin explicación.
  - Un botón "Cerrar sesión" en la esquina.

Paleta y tipografía: las mismas de `DESIGN.md` que ya usa el resto de `web/` (fondo `#0e0f11`,
`fg`/`muted`/`border`, mono para `paquete`/`cuenta`/fechas — son datos de máquina). Nada de
componentes ni tokens nuevos: es una lista y dos botones.

## 5. `crates/lumi-index/examples/firmar_desreclamos.rs`

`fusionar_pendientes` cambia una condición: hoy trae *todo* lo que no esté ya en el borrador; pasa
a traer solo lo que además tenga `estado == "aprobada"`. Lo `"rechazada"` y lo sin decidir
(`"pendiente"`/ausente) se ignoran — se quedan en la cola pública hasta que alguien decida en el
panel, no desaparecen ni se procesan por descuido.

`EntradaPendiente` (la struct Rust que ya deserializa este fichero) gana el mismo campo `estado:
Option<String>`, tratando `None` como `"pendiente"` — mismo criterio de compatibilidad que en el
lado TypeScript.

---

## Fuera de alcance

- Cualquier otra sección de administración (catálogo, modelos, estadísticas). Este panel hace una
  cosa.
- Historial de decisiones visible en el panel — vive en el propio JSON y en GitHub.
- Firmar `desreclamos.json` desde la web, de cualquier forma. Es la invariante de seguridad
  central del subsistema entero y no se toca.
- Roles o permisos graduales (solo lector, solo aprobador...). `ADMIN_GITHUB_LOGINS` es una
  lista plana de cuentas con acceso total a esta única pantalla.
- Notificaciones (email, webhook) cuando llega una solicitud nueva o se decide una.
- Rate limiting o protección anti-bot en `/api/admin/*` más allá de la propia cookie — el volumen
  esperado de solicitudes es bajísimo y las rutas de escritura ya exigen sesión válida.
- Registrar la OAuth App en GitHub y crear las variables de entorno en Vercel: son pasos manuales
  del operador, documentados aquí pero no ejecutables desde el repo.

## Verificación

Sin test suite para esto (ninguna se pide). Comprobar a mano:

1. Sin cookie, `/admin` muestra el botón de login y las rutas `GET/POST /api/admin/liberaciones*`
   devuelven `401`.
2. Con una cuenta de GitHub que NO está en `ADMIN_GITHUB_LOGINS`, el callback rechaza con `403` y
   no deja cookie.
3. Con la cuenta correcta, `/admin` lista las solicitudes pendientes reales de
   `liberaciones-pendientes.json`.
4. Aprobar/rechazar una entrada la quita de la vista y dispara un commit real al JSON con el
   `estado` correcto (revisable en GitHub).
5. `firmar_desreclamos fusionar-pendientes` con una entrada `"rechazada"` y otra `"aprobada"` en
   la cola solo incorpora la aprobada al borrador.
6. Una entrada escrita por el endpoint de solicitud actual (sin campo `estado`) se sigue viendo
   como pendiente en el panel.
