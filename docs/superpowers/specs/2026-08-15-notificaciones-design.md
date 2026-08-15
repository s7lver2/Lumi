# Notificaciones — Design

## Contexto

"Notificaciones" es una de las secciones `pronto` del sidebar del panel de administración
(`Sidebar.tsx`), con un placeholder en `Hueco.tsx`: *"Avisos escritos por el administrador para
quien esté conectado"* (ciclo 3c, `FUTURO.md`/`ARCHITECTURE.md`). Ya existe una campana en
`TitleBar.tsx` (`NotificationsPopover.tsx`) que muestra invitaciones a proyectos y solicitudes de
cuenta pendientes — un inbox de cosas por decidir, no de avisos para leer. Este trabajo construye
la sección real y hace que sus avisos aparezcan en esa misma campana, como un tercer tipo de item
que solo se lee (sin aceptar/rechazar).

El alcance creció durante el brainstorming más allá de "un mensaje de texto plano": el
administrador puede elegir un icono (del set ya existente), marcar la prioridad
(normal/urgente), dirigir el aviso a todos, solo administradores, o personas concretas, escribir
con negrita/cursiva/color/fuente, e insertar emoji. Se documenta todo aquí como una sola pieza
porque, aunque más grande de lo habitual, sigue siendo un único flujo coherente
(componer → publicar → leer → gestionar), no varios subsistemas independientes.

## Modelo de datos

```sql
CREATE TABLE IF NOT EXISTS avisos (
    id           INTEGER PRIMARY KEY,
    contenido    TEXT NOT NULL,   -- documento JSON de Tiptap, no HTML crudo
    icono        TEXT NOT NULL,  -- uno de un set fijo, ver "Icono"
    prioridad    TEXT NOT NULL,  -- 'normal' | 'urgente'
    destino      TEXT NOT NULL,  -- 'todos' | 'admins' | 'personas'
    creado_por   TEXT NOT NULL,  -- username, para mostrar "ines: ..."
    created_at   INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS avisos_usuarios (
    aviso_id  INTEGER NOT NULL,
    user_id   INTEGER NOT NULL,
    PRIMARY KEY (aviso_id, user_id)
);
```

`avisos_usuarios` solo tiene filas cuando `destino = 'personas'`. Id entero simple, sin
`public_id` opaco: no es un secreto que proteger (a diferencia de una clave de API o un token de
sesión), y el propio inbox de invitaciones/solicitudes ya expone ids enteros sin más
(`Invite.project_id`, `AdminRequest.id`).

`contenido` guarda el documento propio de Tiptap (JSON estructurado: párrafos, marcas de
negrita/cursiva/color/fuente), **no HTML**. Esto importa por seguridad: un aviso de un
administrador se renderiza en la pantalla de cualquier otro usuario conectado, así que nunca debe
pasar por `dangerouslySetInnerHTML` con markup arbitrario — Tiptap, tanto al escribir como al leer
en modo `editable:false`, solo conoce los nodos/marcas de su propio esquema, así que no hay
manera de inyectar un `<script>` ni un atributo `on*` aunque quien escriba el aviso quisiera.

## Icono y prioridad

El icono es uno de un set fijo, reutilizando iconos SVG ya dibujados en `Icon.tsx` — sin dibujar
ninguno nuevo: `bell`, `alert`, `wrench`, `boxes`, `cloud`, `shield`, `globe`, `layers`.

Prioridad: dos valores, `normal` (acento azul, el mismo `draw`/`draw-fg` que ya usa el resto de la
app para "informativo") y `urgente` (acento rojo, `danger`/`danger-fg`, igual que un error). Los
avisos urgentes se ordenan siempre primero, sin importar su fecha, tanto en la campana como en la
lista de gestión.

## Destino

- `todos`: cualquier sesión conectada lo ve.
- `admins`: solo cuentas con `is_admin = 1`.
- `personas`: solo los `user_id` listados en `avisos_usuarios`.

Elegido con pestañas (Todos / Administradores / Personas concretas) en el compositor; el modo
"Personas concretas" reutiliza el mismo patrón de buscar-y-añadir que `InviteDrawer.tsx` ya usa
para añadir miembros a un proyecto (`GET /v1/users/search?q=`), con los elegidos como chips
quitables.

## Editor: Tiptap

Se añade como dependencia nueva de `client/`: `@tiptap/react`, `@tiptap/starter-kit`,
`@tiptap/extension-text-style`, `@tiptap/extension-color`, `@tiptap/extension-font-family`. Es una
adición real de peso — más de lo habitual en este proyecto, que evita dependencias nuevas por
norma — pero es la opción que se eligió sobre un marcado ligero hecho a mano, precisamente por
querer un editor de verdad (negrita/cursiva/color/fuente con una barra visual, no sintaxis que
recordar).

- **Barra de formato**: negrita, cursiva, una paleta fija de swatches de color (no un selector de
  color libre — cuatro o cinco tonos ya usados en la app: `fg`, `draw-fg`, `warning-fg`,
  `danger-fg`), y un desplegable de fuente.
- **Fuentes**: limitadas a lo que ya vive local en el proyecto o se pueda vendorizar igual que
  `@fontsource/inter` (ya en `package.json`) — Sans (Inter, la que ya hay), Serif (fuente de
  sistema, sin paquete nuevo: `Georgia, "Times New Roman", serif`), y Mono (el stack
  `ui-monospace` que Tailwind ya define). Nada de fuentes servidas desde una CDN externa: la app
  tiene que poder funcionar sin salida a internet.
- **Emoji**: escribir emoji funciona gratis (es solo texto Unicode); se añade además un botón con
  una rejilla pequeña de emoji comunes hecha a mano (sin librería de picker) que inserta el emoji
  elegido en la posición del cursor.
- **Lectura**: la campana y la lista de gestión montan el mismo editor en modo `editable:false`
  (sin la barra), no un renderizador aparte — un solo camino que entiende el documento.

## Backend

**`GET /v1/admin/security`-style, pero para avisos** — tres rutas nuevas en
`crates/lumid/src/routes/avisos.rs`:

- `POST /v1/admin/avisos` (admin-only): crea un aviso. Cuerpo: `{ contenido, icono, prioridad,
  destino, usuarios: string[] }` (`usuarios` solo se usa si `destino == "personas"`, y son
  *usernames* que el handler resuelve a `user_id` antes de insertar en `avisos_usuarios`).
- `GET /v1/admin/avisos` (admin-only): lista **completa**, sin filtrar por destino — hace falta
  para que el panel de gestión pueda ver y borrar cualquier aviso, esté dirigido a quien esté.
- `DELETE /v1/avisos/:id` (admin-only): borra cualquier aviso. Cualquier administrador puede
  borrar cualquiera, no solo quien lo escribió — mismo criterio que el resto del panel (no hay un
  sistema de permisos granular entre administradores).

**El cambio real de arquitectura — `/v1/telemetry` deja de ser igual para todo el mundo.** Hoy
`routes::telemetry::sse` no mira quién pregunta; con destinatarios concretos, sí tiene que
hacerlo. El handler pasa a leer el bearer token de la conexión (ya se hace así en el propio
`main.rs` para armar la conexión — el proxy de Tauri en `client/src-tauri/src/main.rs` ya manda
`bearer_auth(&token)` a esta misma ruta) y resuelve `(user_id, is_admin)` una vez, al abrir la
conexión SSE (no en cada tick — la sesión no cambia mientras el stream sigue abierto).
`telemetry::sample()` gana un parámetro `visto_por: Option<(i64, bool)>` y filtra los avisos:

```
si visto_por es None → avisos: []  (sesión inválida o token vacío; el resto de la muestra sigue igual)
si no, incluir un aviso si:
    destino == "todos"
    o (destino == "admins" y is_admin)
    o (destino == "personas" y user_id está en avisos_usuarios de ese aviso)
```

El resto de campos de `Sample` (gpus, cpu, ram, cola, mantenimiento) siguen sin filtrar — nunca
dependieron de quién pregunta, y no hay razón para empezar ahora.

`/v1/telemetry` ya está en el núcleo fijo del modo mantenimiento (`mantenimiento::es_nucleo`) —
sigue estándolo, sin cambios ahí.

## Frontend

**`NotificacionesView.tsx`** (nueva, sustituye el `Hueco` de esa sección): el compositor (editor
Tiptap + barra + emoji + icono + prioridad + destino, como en el mockup aprobado) y, debajo, la
lista de gestión alimentada por `GET /v1/admin/avisos` (con recarga tras publicar/borrar — a
diferencia de mantenimiento, esta lista necesita ver avisos dirigidos a otros, que la propia
sesión del admin no recibiría nunca por telemetría si no es su destinataria).

**`NotificationsPopover.tsx`**: su unión `Item` gana `kind: "aviso"`, alimentado por
`useServer(s => s.sample?.avisos ?? [])` — ya filtrado por el propio servidor para esa sesión, sin
petición aparte. Sin fila de acciones (nada que aceptar o rechazar); el editor Tiptap de solo
lectura pinta el `contenido`. El punto de "no leído" sigue siendo el mismo `Set` en memoria de
sesión que ya usan invitaciones/solicitudes — ningún mecanismo de persistencia nuevo.

**Sidebar/Hueco**: `"notificaciones"` sale de `PRONTO` en `AdminPanel.tsx` y de `QUE` en
`Hueco.tsx`; el ícono `bell` que ya tiene en `Sidebar.tsx` se queda igual.

## Fuera de alcance

- Editar un aviso ya publicado (solo crear/borrar).
- Historial de avisos borrados o expirados por tiempo (se decidió borrado manual únicamente, sin
  caducidad automática).
- Cualquier notificación push fuera de la propia app (email, sistema operativo, etc.).
- Un selector de color libre (paleta abierta) — solo la paleta fija de acentos ya usados en la
  app.

## Auto-revisión

- **Cobertura:** icono personalizable (icono fijo de 8 opciones), prioridad (normal/urgente),
  destinatarios concretos (`avisos_usuarios` + destino), emoji (picker + Unicode libre), negrita
  /cursiva/fuente/color (Tiptap + toolbar), animaciones (entrada de item en la campana, ya
  aprobadas en el mockup) — todo cubierto arriba.
- **Sin placeholders:** el esquema, las tres rutas, el filtro de `telemetry::sample()`, y los
  componentes de cliente están descritos con su forma exacta, no "parecido a X".
- **Consistencia:** `destino` usa los mismos tres valores (`todos`/`admins`/`personas`) en el
  esquema SQL, el cuerpo de `POST`, y la lógica de filtro de `sample()`; `prioridad`
  (`normal`/`urgente`) igual en esquema, filtro de orden, y mockup aprobado.
- **Alcance:** una sola pieza (componer → publicar → leer → gestionar), apta para un plan de
  implementación; no se decompone en sub-proyectos porque cada parte (editor, destino, entrega)
  solo tiene sentido junto con las demás — un editor de texto sin ningún sitio donde publicarlo no
  es un incremento útil por sí solo.
