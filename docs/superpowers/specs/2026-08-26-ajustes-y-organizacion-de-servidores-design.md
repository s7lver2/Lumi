# Ajustes del cliente y organización de servidores — diseño

## Contexto

El cliente hoy no tiene ningún ajuste propio de la app (tema, notificaciones locales,
actualizaciones): lo único parecido es `ProfileView.tsx`, y ese es explícitamente autoservicio de
cuenta, no ajustes. La comprobación manual de actualizaciones (`comprobarActualizacion()`) existe
desde el canal de actualizaciones ([2026-08-26-canal-de-actualizaciones-design.md](2026-08-26-canal-de-actualizaciones-design.md))
pero no tiene ningún sitio en la UI donde vivir aparte del disparo automático y silencioso al
arrancar — es el hueco que quedó anotado como "siguiente sub-proyecto" al cerrar la
[spec de compatibilidad de versión](2026-08-26-compatibilidad-de-version-design.md).

Además, la lista de servidores guardados (`ServerSelect.tsx`) hoy trata la dirección como el dato
principal y la etiqueta que le puso el investigador como secundario — al revés de cómo se piensa
en la práctica ("mi servidor de trabajo", no "192.168.1.40:7717") — y no hay forma de organizarla
ni de reconocerla de un vistazo salvo leyendo la IP.

## Alcance

- Botón de ajustes en la pantalla de entrada, panel con estructura de barra lateral (mismo patrón
  que `admin/Sidebar.tsx`/`ProfileSidebar.tsx`), dos secciones: Actualizaciones y Apariencia.
- Invertir qué dato manda en el selector de servidores: etiqueta primero, dirección segundo.
- Carpetas locales para organizar servidores guardados, asignables por menú contextual.
- Icono por servidor: el avatar que el propio servidor ya publica (`/v1/server-profile/avatar`),
  cacheado localmente — no una subida nueva desde el cliente.

Fuera de alcance (con motivo):

- **Tema claro**: DESIGN.md es explícito, "dark-theme-only (no light mode)" — Apariencia no
  incluye ningún selector de tema.
- **Sincronizar carpetas o el icono cacheado entre dispositivos**: viven en `localStorage`, igual
  que la lista de servidores hoy — organización personal de este cliente, no algo que el
  servidor conozca ni transporte.
- **Ajustes del Indexer**: esta spec es solo del cliente (`client/`); el Indexer no comparte
  `ServerSelect.tsx` ni tiene lista de servidores en absoluto.
- **Notificaciones locales del sistema operativo**: no pedido, no se añade una sección para eso
  todavía — Apariencia y Actualizaciones son las dos secciones concretas de esta spec; añadir más
  se hace cuando haga falta, no por adelantado.

---

## 1. Botón y panel de ajustes

Icono de engranaje en la esquina inferior de `EntryScreen` (la pantalla de login/selector de
servidor), visible con o sin sesión activa — son ajustes de la app, no de la cuenta, así que no
dependen de estar dentro. Abre un panel de página completa, mismo esqueleto que ya reusan
`AdminPanel.tsx`/`ProfileSidebar.tsx` (grid `[206px_1fr]`, marcador deslizante sobre el ítem
activo, "← Volver" arriba), con dos secciones:

**Actualizaciones**: versión instalada (`env!("CARGO_PKG_VERSION")` vía un comando nuevo o
reutilizando lo que ya exponga el store), botón "Comprobar ahora" que llama a
`comprobarActualizacion()` (ya existe, `client/src/lib/actualizaciones.ts`), y pinta el mismo tipo
de resultado que ya pinta `ActualizacionBanner.tsx` (disponible/retirada/error) pero como contenido
de la sección, no como banner. Si hay una versión disponible, un botón para aplicarla ahora mismo
(reusa `dispararActualizacionSilenciosa`).

**Apariencia**: un único control, "Reducir movimiento". Guarda una preferencia en `localStorage`
(`lumi.reducir-movimiento`) y aplica una clase en la raíz del documento que las animaciones `jg-*`
respetan — mismo efecto que ya debería dar `prefers-reduced-motion` del sistema (DESIGN.md lo
exige), pero como preferencia explícita dentro de la app en vez de solo heredada del SO.

## 2. Orden en el selector de servidores

En `ServerSelect.tsx`, tanto en el botón cerrado como en cada fila de la lista abierta, la
etiqueta (`label`) pasa a ser el texto principal (tamaño normal, color `text-fg`) y la dirección
(`addr`) pasa a secundario (monoespaciada, pequeña, `text-subtle`) — se invierte el peso visual
que hoy tienen, sin quitar ningún dato. Un servidor sin etiqueta (label vacío — hoy `AddServerForm`
permite guardarlo así, usa la dirección como label por defecto) sigue mostrando la dirección como
antes, porque en ese caso son el mismo dato.

## 3. Carpetas y avatar cacheado

**Modelo de datos**, en `client/src/lib/session.ts`:

```ts
export interface Server {
  addr: string;
  fingerprint: string;
  label: string;
  folderId?: string;
  /** Caché local del avatar que el servidor publica en
   *  /v1/server-profile/avatar — nunca se sube nada desde el cliente. Se
   *  guarda la primera vez que se conoce (AddServerForm) y se refresca cada
   *  vez que ese servidor se selecciona con éxito. */
  avatarDataUrl?: string;
}

export interface ServerFolder {
  id: string;
  nombre: string;
}
```

`ServerFolder[]` vive en `localStorage` bajo `lumi.server-folders`, con las mismas funciones
`loadServerFolders()`/`saveServerFolders()` que ya sigue el patrón de `loadServers()`.

**Menú contextual**: clic derecho sobre una fila de `ServerSelect.tsx` abre el `ContextMenu` ya
existente (`client/src/ui/ContextMenu.tsx`, sin cambios) con: una entrada por carpeta existente
("Mover a «Trabajo»"), "Nueva carpeta…" (pide el nombre con una entrada de texto inline, no un
modal aparte — mismo peso que el resto de la interacción), y "Quitar de la carpeta" solo si el
servidor ya tiene una asignada.

**Render agrupado**: la lista abierta de `ServerSelect.tsx` pinta primero las carpetas (nombre
como encabezado pequeño, colapsable — recuerda su estado colapsado en `localStorage` igual que
`ProjectPicker` recuerda su vista), con sus servidores debajo indentados; los servidores sin
carpeta van sueltos al final, sin encabezado.

**Avatar por fila**: si `server.avatarDataUrl` existe, se pinta como círculo de 18px a la
izquierda de la etiqueta (donde hoy va el hueco del `check`/espacio en blanco); si no, se queda el
icono genérico actual. Se cachea en dos momentos:
- `AddServerForm.verify()` ya llama a `api.serverProfilePublic()` tras `pairCard` — si
  `has_avatar` es `true`, se pide `/v1/server-profile/avatar`, se convierte a data URL, y se
  guarda junto con el resto de campos al hacer `addServer(...)`.
- Cada vez que `ServerSelect`/`LoginForm` conectan con éxito a un servidor ya guardado
  (`api.reconnect`), se repite la misma comprobación en segundo plano (no bloquea el login) y
  actualiza `avatarDataUrl` si cambió — así un servidor cuyo admin cambia el avatar se refresca
  solo, sin acción del investigador.

## 4. Errores y casos límite

| Situación | Comportamiento |
|---|---|
| Servidor sin avatar publicado (`has_avatar: false`) | Icono genérico de siempre, sin caché |
| Refresco de avatar falla (servidor apagado, sin red) | Se mantiene el `avatarDataUrl` cacheado anterior tal cual — nunca se borra por un fallo puntual |
| Carpeta vacía (se quitó el último servidor) | Sigue existiendo, vacía, hasta que el investigador la borre explícitamente desde el menú contextual (opción "Borrar carpeta", solo si está vacía) |
| Nombre de carpeta repetido | Se permite — son solo una etiqueta de organización personal, no un identificador |

## 5. Qué reemplaza / con qué convive

No reemplaza nada existente. La sección de Actualizaciones de Ajustes convive con
`ActualizacionBanner.tsx` (aviso automático) y con la autoactualización silenciosa ya
construida — esta sección es el camino manual que faltaba, ninguno de los otros dos cambia.
