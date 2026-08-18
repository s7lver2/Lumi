# Políticas de aceptación al crear cuenta — diseño

## Contexto

Hoy la única cuenta que nace de verdad tras una solicitud de acceso aprobada
se crea en `ResolvedScreen.tsx` (`POST /v1/accounts`, `crates/lumid/src/routes/access.rs::create_account`),
sin ningún paso intermedio de aceptación. El wizard del owner (primer admin,
`AdminStep.tsx` + `/v1/admin`) es un flujo aparte y no lo toca esta spec —
quien instala el servidor no necesita aceptar sus propias políticas.

Esta spec añade un interruptor de admin: si está activo, un documento de
texto (mismo editor Tiptap que ya usan los avisos, `AvisoEditor.tsx`) se
muestra a quien está creando su cuenta, con una casilla de aceptación que
bloquea el botón "Crear cuenta" hasta marcarla.

**Decisiones ya tomadas:**
- Un único documento con una sola casilla, no varias políticas separadas.
- Sin versionado: editar el texto después no invalida lo ya aceptado.
- Vive en Customización (`CustomizacionView.tsx`), no en Seguridad.

## 1. Almacenamiento

Tres escalares en la tabla `meta` (mismo patrón que `mantenimiento.rs`/`red.rs`):

| Clave | Significado | Por defecto |
|---|---|---|
| `politicas_activas` | Si el gate está activo | `"0"` |
| `politicas_titulo` | Título mostrado (p.ej. "Términos de uso") | `""` |
| `politicas_contenido` | Documento Tiptap JSON, igual formato que `avisos.contenido` | doc vacío |

Nueva columna, añadida a la lista de `migrate()` en `crates/lumid/src/store.rs`:
`("users", "accepted_policies_at", "INTEGER")` — nullable, epoch de cuándo se
aceptó. Es evidencia/auditoría, no control de acceso: no hay nada que la lea
para decidir permisos, solo para que un admin pueda comprobar cuándo aceptó
alguien si hace falta.

## 2. Endpoints

- `GET/PATCH /v1/admin/policies` (admin) → `{ active: bool, title: string, content: unknown }`.
  Mismo `require_admin` que el resto de rutas de admin.
- `GET /v1/policies` — **sin autenticación**, igual que `/v1/hello`: quien
  todavía no tiene cuenta necesita poder leer el documento antes de crear
  una. Devuelve `{ active, title, content }` siempre; si `active` es falso,
  el cliente simplemente no muestra nada.

## 3. Admin: Customización

Nuevo bloque en `client/src/admin/CustomizacionView.tsx`, debajo del
`MapRow` existente: un interruptor "Activar políticas de aceptación", un
campo de título, y el `AvisoEditor` en modo editable cuando está activo —
mismo componente que ya escribe los avisos, así que no hay una barra de
formato nueva que mantener.

## 4. Creación de cuenta

`ResolvedScreen.tsx`, antes del formulario de usuario/contraseña: si
`GET /v1/policies` devuelve `active: true`, se muestra el documento en modo
lectura (`AvisoEditor editable={false}`) seguido de una casilla "He leído y
acepto «título»". El botón "Crear cuenta" se deshabilita mientras la casilla
no esté marcada (además de las condiciones que ya tiene: contraseña ≥ 12,
usuario no vacío).

`AccountReq` (`lumi-proto::api`) gana `accepted_policies: bool` (default
`false` si el cliente no lo manda, vía `#[serde(default)]`). El servidor,
en `create_account`, si `politicas_activas` es verdadero y
`req.accepted_policies` no es `true`, responde `400 Bad Request` con
"hay que aceptar las políticas para crear la cuenta" — igual de explícito
que el resto de validaciones de ese mismo handler. Si se acepta, la fila de
`users` se inserta con `accepted_policies_at = now()`; si el gate está
desactivado, se inserta `NULL`.

## Fuera de alcance

- Versionado de políticas y re-aceptación forzada tras editar el texto.
- Aplicar el gate al wizard del owner.
- Varias políticas independientes con casillas separadas.
