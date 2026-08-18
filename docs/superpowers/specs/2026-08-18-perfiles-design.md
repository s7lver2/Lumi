# Fotos de perfil, perfil de servidor y popup de bienvenida — diseño

## Contexto

Hoy no existe ninguna foto de perfil: `Avatar.tsx`/`UserTile.tsx` pintan
siempre iniciales sobre un círculo, con un comentario explícito ("cuando
exista un subsistema que las gestione, esta es la pieza que cambia por
dentro"). Tampoco existe ningún "perfil de servidor" — al pegar una tarjeta
de servidor (`lumi1s_...`) en "Añadir servidor" (`AddServerForm.tsx`), lo
único que se ve tras verificarla es una línea "Servidor verificado" +
"¿tiene administrador?".

Esta spec añade tres piezas relacionadas, aprobadas con mockups:

1. Foto de perfil de usuario, autoservicio (cada quien sube la suya).
2. Perfil de servidor (foto, banner, título, descripción enriquecida),
   editable en Customización.
3. Un popup en "Añadir servidor" que muestra ese perfil (banner, foto,
   título, descripción, número de miembros) en vez de la línea simple de
   hoy — y que cae a la línea simple si el servidor no tiene perfil
   configurado.

El wizard del owner (`PairStep.tsx`) no se toca: quien instala el servidor
no necesita que se lo presenten.

## 1. Almacenamiento e imágenes

Mismo pipeline que ya usan las fotos de caso (`crates/lumid/src/routes/images.rs`):
decodificar con el crate `image`, generar un recorte normalizado y guardarlo
en disco. Un archivo por rol, sin versionado — subir uno nuevo sobrescribe:

| Archivo | Contenido |
|---|---|
| `LUMI_DATA/perfil/usuario_<id>.jpg` | Avatar de un usuario, recorte cuadrado 256×256 |
| `LUMI_DATA/perfil/servidor_avatar.jpg` | Avatar del servidor, 256×256 |
| `LUMI_DATA/perfil/servidor_banner.jpg` | Banner del servidor, 1200×360 |

Nada de esto va en SQLite salvo lo mínimo para poder invalidar caché del
lado cliente (`?v=<timestamp>` en la URL):
- Columna `users.avatar_updated_at` (nullable, vía `migrate()`).
- Claves en `meta`: `servidor_avatar_at`, `servidor_banner_at`.

Título y descripción del servidor van en `meta` (mismo patrón que
`politicas.rs`): `servidor_titulo` (texto), `servidor_descripcion`
(documento Tiptap JSON, igual formato que avisos/políticas — decidido con
mockups: es contenido enriquecido, no un textarea plano).

## 2. Endpoints

- `POST /v1/me/avatar` (multipart, cualquier sesión) — sube tu propia foto;
  valida que sea una imagen decodificable (mismo `image::load_from_memory_with_format`
  que ya usa `images.rs`), la recorta a 256×256 y la guarda.
- `DELETE /v1/me/avatar` (cualquier sesión) — borra tu propia foto.
- `GET /v1/users/:id/avatar` — requiere sesión (cualquiera, no solo admin):
  se ve en `UserTile`/`Avatar` en toda la app, incluida gente sin permisos
  de administración. 404 si no hay foto — el cliente ya sabe caer a
  iniciales ante un 404.
- `GET/PATCH /v1/admin/server-profile` (admin) → `{ title: string,
  description: unknown, member_count: i64 }`. `member_count` se calcula
  (`SELECT COUNT(*) FROM users`), nunca se guarda.
- `POST /v1/admin/server-profile/avatar` y `.../banner` (multipart, admin) —
  suben cada imagen; `DELETE` de cada una para quitarla.
- `GET /v1/server-profile` — **público**, igual que `/v1/policies`:
  `{ title, description, member_count, has_avatar: bool, has_banner: bool }`.
- `GET /v1/server-profile/avatar` y `GET /v1/server-profile/banner` —
  **públicos**: se pintan en el popup de "Añadir servidor" antes de que
  quien mira tenga cuenta. 404 si no se ha subido ninguna.

## 3. Interfaz

- **`Avatar.tsx`/`UserTile.tsx`** ganan un prop opcional `userId?: number`:
  con él presente, intentan `<img src="/v1/users/:id/avatar?v=...">` con
  `onError` cayendo a las iniciales de siempre. Un solo componente, dos
  formas de resolverse.
- **`Me`/`LoginRes`** (`lumi-proto::api`) ganan `id: number` — hoy el
  cliente solo guarda `username` en `useServer`; sin el id propio no hay
  forma de pedir la propia foto en `TitleBar.tsx`. `useServer` guarda
  `userId` junto a `username`.
- **Propagación** (aprobada con mockups, alcance "a todos los sitios
  razonables"): `ProfileView.tsx` (subir/quitar/ver), `TitleBar.tsx` (tu
  propia foto), `UsersView.tsx` (lista de admin, ya tiene `u.id`),
  `InviteDrawer.tsx` (ya tiene `user_id`/`id` en sus datos), `ProjectPicker.tsx`
  (el indicador de "trabajando ahora" — requiere que `locked_by` en
  `Project` pase de `string | null` a incluir también el id; ver Task
  correspondiente en el plan). `NotificationsPopover.tsx` queda fuera: sus
  ids no son ids de usuario (son ids de proyecto/solicitud según el tipo de
  item) y forzar esa correspondencia no es mecánico — se anota en
  FUTURO.md.
- **Perfil propio** (`ProfileView.tsx::PerfilPanel`): círculo grande con la
  foto actual (o iniciales) y "Cambiar foto" (`<input type="file">` oculto)
  que sube vía `POST /v1/me/avatar`; "Quitar foto" si ya hay una.
- **Customización**: nuevo bloque "Perfil del servidor" bajo `PolicyRow`,
  con dos subidas de imagen (banner, avatar) y título + `AvisoEditor`
  (Tiptap) para la descripción — mismo patrón de borrador local + "Guardar
  cambios" que `PolicyRow`.
- **Popup de "Añadir servidor"** (`AddServerForm.tsx`): al verificar una
  tarjeta con éxito, si `GET /v1/server-profile` devuelve un `title` no
  vacío, se sustituye la línea "Servidor verificado" por un panel con el
  banner de fondo, la foto circular superpuesta, el título, la descripción
  en modo lectura y "N miembros" — y debajo, los mismos controles de
  siempre (nombre + "Guardar servidor"). Si no hay perfil configurado
  (`title` vacío), se mantiene la línea simple de hoy.

## Fuera de alcance

- Fotos/perfil en `NotificationsPopover.tsx` (ids no mapean a usuario).
- Perfil del owner en el wizard (`PairStep.tsx`).
- Recorte/edición interactiva de la imagen antes de subir (se sube tal
  cual y se recorta centrado en el servidor, sin editor de posición).
- Versionado o historial de fotos anteriores.
