# Panel de Administración — Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Arreglar 17 bugs/features del panel de administración del cliente Lumi (`client/src/admin/`), más un ajuste de `lumid`: condición de carrera al actualizar, estado "aplicando" que no se limpia, toast de progreso, descarga de cualquier versión del backend, mensaje de mantenimiento sobrescrito, animaciones faltantes en varias pestañas, iconos de fallback, toggles de activación, transiciones de lista→detalle, menú contextual de usuarios, color desalineado, reposicionamiento de texto explicativo, acceso a ajustes del cliente sin salir del servidor, orden del resumen, y el reinicio de red que se cuelga.

**Architecture:** La mayoría de los cambios viven en `client/src/admin/`. Dos tareas tocan `crates/lumid/src/` (backend del daemon: mensaje de mantenimiento, endpoint de versiones). Una tarea toca `client/src/ui/TitleBar.tsx` y `client/src/App.tsx` para el nuevo acceso a ajustes. No tocar `indexer/` ni `installer/` — otros planes cubren esos árboles en paralelo.

**Tech Stack:** Tauri v2 + React + TypeScript + Tailwind (cliente), Rust + Axum/lo que use `lumid` (backend), SQLite.

## Global Constraints

- No tests unless explicitly requested (proyecto: `CLAUDE.md`).
- Un commit por tarea terminada, mensaje en español, cuerpo explicando el porqué.
- DESIGN.md: dark-theme-only, sin verde ("hecho" es blanco), sin colores azulados no temáticos, mono font para IPs/puertos/timestamps/logs, animaciones `cubic-bezier` exponential ease-out (`ease-expo`/`duration-300`/`duration-[420ms]` ya usados en el proyecto — reutilizar esos valores, no inventar nuevos), respetar `prefers-reduced-motion`.
- Capability matrix del proyecto: cualquier control deshabilitado debe mostrar la razón real, nunca ocultarse sin explicación.
- `ponytail`: la solución más simple que funcione, reutilizar componentes/patrones ya existentes en el propio panel antes de crear nuevos.
- Antes de cada commit: `git status --short` y confirmar que solo se staged los archivos propios de esta tarea (otros agentes en paralelo pueden estar tocando `indexer/`/`installer/`/otras partes de `client/` simultáneamente).

---

### Task 1: Evitar comprobar y actualizar el backend a la vez (#68)

**Root cause confirmado:** `client/src/admin/ActualizacionesView.tsx:70-85` — "Actualizar servidor" solo se deshabilita con `!estado.disponible || aplicando`, y "Comprobar ahora" solo con `comprobando`; cada botón ignora el estado del otro.

**Files:** Modify `client/src/admin/ActualizacionesView.tsx`.

**Steps:**
- [ ] Cambiar la condición `disabled` de ambos botones para que cada uno también tenga en cuenta el estado del otro: `disabled={!estado.disponible || aplicando || comprobando}` en "Actualizar servidor", y `disabled={comprobando || aplicando}` en "Comprobar ahora".
- [ ] Verificar manualmente que no es posible disparar ambas acciones simultáneamente.
- [ ] Commit: `git add client/src/admin/ActualizacionesView.tsx` + `git commit -m "fix: no se puede comprobar y actualizar el backend al mismo tiempo"`.

---

### Task 2: Estado "aplicando" no se resetea al navegar/cancelar (#69)

**Root cause confirmado:** `aplicando` en `ActualizacionesView.tsx` es `useState` local, nunca se resetea a `false` salvo por desmontaje (reinicio real). Si el backend cancela/hace timeout (ver Task 4, #72/#75) mientras el usuario está en otra pestaña, el estado local queda "atascado" en aplicando.

**Files:** Modify `client/src/admin/ActualizacionesView.tsx`.

**Steps:**
- [ ] Confirmar cómo se consulta el estado de actualización del backend (polling a algún endpoint de estado, o solo se infiere localmente). Si ya existe un endpoint que reporta el estado real del backend (aplicando/fallido/completado), engancharlo para que `aplicando` se derive de ese estado remoto en vez de (o además de) un flag local que solo se pone a `true` al iniciar y nunca se reconcilia.
- [ ] Si no existe tal endpoint de estado, como mínimo: al montar el componente (o al volver a la pestaña), volver a comprobar el estado real antes de confiar en el `aplicando` local, y resetearlo si el backend ya no está aplicando nada.
- [ ] Verificar manualmente: iniciar una actualización, navegar a otra pestaña, volver, y confirmar que el estado mostrado refleja la realidad del backend (no queda pegado en "aplicando" si ya terminó o fue cancelado).
- [ ] Commit: `git add client/src/admin/ActualizacionesView.tsx` + `git commit -m "fix: el estado de actualizacion en curso se reconcilia con el backend en vez de quedarse pegado"`.

---

### Task 3: Toast de progreso de actualización fuera de la pestaña (#70)

**Root cause confirmado:** `client/src/admin/AdminEventToast.tsx` (montado una vez en `AdminPanel.tsx`, sobrevive navegación entre pestañas) solo maneja eventos `SolicitudCredito`/`SolicitudAcceso`/`SolicitudVersion`. No hay caso para progreso de actualización.

**Files:**
- Modify: `client/src/admin/AdminEventToast.tsx`
- Modify: `client/src/admin/ActualizacionesView.tsx` (o donde se origine el evento/estado de progreso)

**Steps:**
- [ ] Leer `AdminEventToast.tsx` completo para entender el patrón de "evento admin → toast" ya usado (probablemente un stream SSE o polling compartido a nivel de `AdminPanel`).
- [ ] Añadir un caso nuevo de evento/estado para "actualización en curso" que muestre un toast con el progreso (reutilizar el mismo componente visual de toast, solo añadir el tipo de contenido) cuando el usuario NO esté en la pestaña de Actualizaciones.
- [ ] Cablear el origen del evento: si `ActualizacionesView.tsx` ya sondea el estado de progreso, elevar esa fuente de datos al nivel de `AdminPanel`/el mismo canal que ya usa `AdminEventToast`, en vez de duplicar el polling.
- [ ] Verificar manualmente: iniciar una actualización, cambiar a otra pestaña del panel de administración, confirmar que aparece un toast con el progreso.
- [ ] Commit: `git add client/src/admin/AdminEventToast.tsx client/src/admin/ActualizacionesView.tsx` + `git commit -m "feat: toast de progreso de actualizacion visible fuera de la pestana de actualizaciones"`.

---

### Task 4: Mensaje de mantenimiento no debe sobrescribir el del usuario (#72, #75 — mismo root cause)

**Root cause confirmado:** `crates/lumid/src/actualizacion.rs:164` llama a `mantenimiento::set_mensaje(app, "Actualizando a {version}…")` incondicionalmente, escribiendo sobre la ÚNICA clave de mensaje (`mantenimiento_mensaje`, `crates/lumid/src/mantenimiento.rs:40-41`) que también usa `client/src/admin/SecurityView.tsx:98-106` para el mensaje manual del admin. No hay clave separada para "mensaje de sistema" vs "mensaje del usuario", ni restauración al terminar/cancelar. Además, en timeout/error, `crates/lumid/src/routes/actualizacion.rs:38-41` solo hace `mantenimiento::set_activo(false)` — nunca limpia `mantenimiento_mensaje` — dejando el texto "Actualizando a..." pegado para siempre (esto es el bug #72: el proceso "se queda atascado" mostrando ese mensaje).

**Files:**
- Modify: `crates/lumid/src/mantenimiento.rs` (añadir noción de mensaje-de-sistema vs mensaje-de-usuario)
- Modify: `crates/lumid/src/actualizacion.rs` (línea ~164 y el flujo de error/timeout)
- Modify: `crates/lumid/src/routes/actualizacion.rs` (líneas ~38-41)

**Steps:**
- [ ] Leer `mantenimiento.rs` completo: cómo se guarda/lee `mantenimiento_mensaje` (tabla meta, clave única) y cómo `set_activo`/`set_mensaje` interactúan.
- [ ] Añadir una segunda clave de almacenamiento, p.ej. `mantenimiento_mensaje_sistema` (o un campo separado en la misma fila si el esquema lo permite fácilmente), para el mensaje que pone el flujo de actualización — sin tocar `mantenimiento_mensaje` (el del usuario).
- [ ] En el punto donde el modo mantenimiento decide qué texto mostrar (probablemente donde se sirve el estado de mantenimiento al cliente), dar prioridad: si hay un mensaje de usuario guardado (`mantenimiento_mensaje` no vacío), mostrar ESE; el mensaje de sistema de actualización solo se muestra cuando no hay uno de usuario, o se muestra como un añadido/subtítulo, no como reemplazo — decidir la opción más simple que cumpla "el del usuario siempre tiene prioridad": mostrar el mensaje de usuario si existe, y si no, el de sistema.
- [ ] En `actualizacion.rs`, cambiar la llamada de la línea 164 para escribir en la nueva clave de sistema, no en `mantenimiento_mensaje`.
- [ ] En `routes/actualizacion.rs` (líneas 38-41), al fallar/hacer timeout la actualización, además de `set_activo(false)`, limpiar explícitamente el mensaje de sistema (`mantenimiento_mensaje_sistema = None`), para que no quede "Actualizando a..." pegado (esto resuelve #72 directamente).
- [ ] Verificar manualmente el escenario descrito en el bug: activar mantenimiento manualmente con un mensaje propio, disparar una actualización, confirmar que el mensaje del usuario NO se pierde/sobrescribe; luego provocar (o simular) un timeout de actualización y confirmar que el mensaje de sistema se limpia y no queda atascado.
- [ ] Commit: `git add crates/lumid/src/mantenimiento.rs crates/lumid/src/actualizacion.rs crates/lumid/src/routes/actualizacion.rs` + `git commit -m "fix: mensaje de mantenimiento del usuario ya no se pierde con actualizaciones, y el de sistema se limpia si la actualizacion falla"`.

---

### Task 5: Descargar cualquier versión del backend desde el panel (#71)

**Root cause confirmado:** `ActualizacionesView.tsx` y `crates/lumid/src/actualizacion.rs::aplicar` solo trabajan con `manifiesto.mas_nueva(...)` (la última versión). No hay endpoint/UI para listar todas las versiones publicadas ni apuntar a una arbitraria.

**Files:**
- Modify: `crates/lumid/src/actualizacion.rs` (o `routes/actualizacion.rs`) — nuevo endpoint/función para listar/aplicar una versión concreta.
- Modify: `client/src/admin/ActualizacionesView.tsx` — UI para elegir versión.

**Steps:**
- [ ] Revisar cómo el Indexer ya implementó esto mismo (BUG_BOUNTY #47, ya resuelto): `indexer/src-tauri/src/actualizacion.rs`'s `historial()`/`disparar_a_version()` — es prácticamente el mismo patrón que necesita el admin panel, pero server-side (lumid expone HTTP, no comandos Tauri).
- [ ] En `crates/lumid/src/actualizacion.rs`, añadir una función que liste todas las publicaciones del manifiesto (`Manifiesto::publicaciones` o similar, ya debe existir el tipo — revisar `lumi_proto::actualizacion`), y una función/endpoint para aplicar una versión específica (no solo la más nueva) — reutilizando la lógica interna de `aplicar` pero parametrizada por versión en vez de asumir siempre `mas_nueva()`.
- [ ] Exponer esto como ruta(s) HTTP en `routes/actualizacion.rs` (siguiendo el patrón de auth/admin ya existente en ese router).
- [ ] En `ActualizacionesView.tsx`, añadir una UI para ver el historial de versiones y disparar la instalación de una concreta — mirar cómo `client/src-tauri`'s propio flujo de auto-actualización del CLIENTE ya presenta esto (mencionado en contexto de sesiones previas: `historial_actualizaciones`/`disparar_actualizacion_a_version` en `client/src-tauri/src/main.rs`) como referencia de UX, adaptado a que aquí el objetivo es el backend remoto, no el propio cliente.
- [ ] Verificar manualmente: listar versiones disponibles del backend y disparar la instalación de una que no sea la última.
- [ ] Commit: `git add crates/lumid/src/actualizacion.rs crates/lumid/src/routes/actualizacion.rs client/src/admin/ActualizacionesView.tsx` + `git commit -m "feat: el panel de administracion permite instalar cualquier version publicada del backend, no solo la ultima"`.

---

### Task 6: Animaciones en la vista de tabla de la Cola (#73)

**Root cause confirmado:** `client/src/admin/ColaView.tsx` — `VistaCinta` (líneas ~229-348) tiene animaciones ricas (`jg-fade-rise`, transición `volar()`, scale/opacity al quitar); `VistaTabla` (líneas ~97-147) no tiene ninguna transición/animación.

**Files:** Modify `client/src/admin/ColaView.tsx` (`VistaTabla`).

**Steps:**
- [ ] Leer `VistaCinta` para identificar qué clases/transiciones son razonables de portar a una tabla (entrada de filas nuevas con `jg-fade-rise`, transición de salida al completarse/quitar una fila).
- [ ] Añadir `transition-*`/`animation` a las filas de `VistaTabla` para que aparecer/desaparecer no sea instantáneo — usar los mismos valores de duración/easing que `VistaCinta` para mantener consistencia.
- [ ] Verificar visualmente con trabajo en cola entrando/saliendo en la vista de tabla.
- [ ] Commit: `git add client/src/admin/ColaView.tsx` + `git commit -m "fix: la vista de tabla de la cola ahora tiene las mismas animaciones que la vista de cinta"`.

---

### Task 7: Botón Guardar de API Keys solo aparece al escribir (#74)

**Root cause confirmado:** `client/src/admin/ApiKeysView.tsx:73-101` — tanto la fila de Mapbox como las de proveedores renderizan input y botón "Guardar" siempre, sin gating sobre si hay texto escrito, y sin transición.

**Files:** Modify `client/src/admin/ApiKeysView.tsx`.

**Steps:**
- [ ] Para cada fila (Mapbox y cada proveedor), condicionar el render del botón "Guardar" a que el valor del input correspondiente (`pesosValor`/`mapaValor` u otro por fila) tenga contenido tras `.trim()`.
- [ ] Envolver el botón en una transición de aparición (reutilizar el patrón `grid-template-rows: 0fr → 1fr` con `ease-expo`/`duration-[420ms]` ya usado en `SecurityView.tsx`, o una transición de `width`/`opacity` más simple si el layout es en fila — elegir la que encaje mejor con el layout horizontal de esta vista).
- [ ] Hacer que el input crezca (`flex-1`/`w-full`) para ocupar el espacio que deja el botón cuando no está presente, evitando un salto brusco de layout.
- [ ] Verificar manualmente: campo vacío → sin botón, input ocupa el ancho; escribir algo → botón aparece con animación, input se encoge.
- [ ] Commit: `git add client/src/admin/ApiKeysView.tsx` + `git commit -m "fix: boton guardar de api keys solo aparece al escribir, con animacion, y el input rellena el espacio"`.

---

### Task 8: Icono de fallback cuando falla la carga de estilos de Mapbox (#76)

**Root cause confirmado:** `client/src/admin/MapThemePreview.tsx:22-23` — `if (!res.ok || cancelado || !ref.current) return;` deja el contenedor en blanco para siempre si el fetch del estilo falla (p.ej. sin API key de Mapbox), sin ningún estado de error.

**Files:** Modify `client/src/admin/MapThemePreview.tsx`.

**Steps:**
- [ ] Añadir un estado local `fallo: boolean` (o similar) que se ponga a `true` cuando `!res.ok` (o cualquier excepción del fetch).
- [ ] Cuando `fallo` sea verdadero, renderizar un icono de fallo (usar el vocabulario de iconos SVG dibujados a mano del proyecto — buscar si ya existe un icono de "error"/"no disponible" en `client/src/ui/Icon.tsx`; si no, usar uno simple y coherente con el trazo/viewBox del set existente, según DESIGN.md) en vez de dejar el contenedor vacío.
- [ ] Verificar manualmente: quitar/invalidar temporalmente la API key de Mapbox en el entorno de prueba, confirmar que las casillas de selector de estilo muestran el icono de fallo en vez de quedarse "cargando" para siempre.
- [ ] Commit: `git add client/src/admin/MapThemePreview.tsx` + `git commit -m "fix: los selectores de estilo de mapa muestran un icono de fallo si no cargan, en vez de quedarse en blanco"`.

---

### Task 9: Perfil del servidor requiere activación explícita (#77)

**Root cause confirmado:** `client/src/admin/PolicyRow.tsx` ya tiene el patrón deseado (toggle `active` que revela edición condicionalmente). `client/src/admin/ServerProfileRow.tsx` no tiene ningún toggle — todo es siempre visible/editable.

**Files:**
- Modify: `client/src/admin/ServerProfileRow.tsx`
- Check: el tipo/API de `ServerProfileSettings` (buscar dónde se define, probablemente cerca de `PoliciesSettings`) para añadir un campo `active` análogo.

**Steps:**
- [ ] Leer `PolicyRow.tsx` completo (el patrón de referencia: toggle, estado `active`, revelado condicional del contenido).
- [ ] Añadir un campo `active` (o el nombre que ya use el patrón de `PoliciesSettings`) al tipo de configuración del perfil del servidor, con su correspondiente persistencia (mirar cómo `PoliciesSettings.active` se guarda/lee, en el backend `lumid` si aplica, para replicar el mismo mecanismo).
- [ ] En `ServerProfileRow.tsx`, añadir el toggle al inicio del componente y envolver el contenido de edición (título/descripción/avatar/banner) en el mismo patrón de revelado condicional que usa `PolicyRow.tsx` (incluyendo la animación de Task 10/#78 si ya está disponible — si no, aplicar aquí directamente el patrón `grid-template-rows`).
- [ ] Verificar manualmente: desactivar el perfil del servidor, confirmar que el contenido de edición se oculta; activarlo, confirmar que aparece.
- [ ] Commit: `git add client/src/admin/ServerProfileRow.tsx` (+ el archivo de tipos/API tocado) + `git commit -m "feat: el perfil del servidor ahora requiere activarse explicitamente, igual que las politicas de aceptacion"`.

---

### Task 10: Propagar animaciones de Seguridad al resto del panel de administración (#78)

**Root cause confirmado:** `SecurityView.tsx` usa el patrón `grid-template-rows: 0fr → 1fr` (`transition-[grid-template-rows] duration-[420ms] ease-expo` envolviendo un hijo `overflow-hidden`) para revelar contenido al togglear, y `transition-colors duration-300 ease-expo` / `transition-transform duration-300 ease-expo` en el track/knob del propio toggle. `PolicyRow.tsx` copia el toggle pero su bloque de revelado (`{cfg.active && (...)}`) es un montaje condicional plano, sin la animación de grid-rows.

**Files:**
- Modify: `client/src/admin/PolicyRow.tsx`
- Modify: `client/src/admin/ServerProfileRow.tsx` (si Task 9 se completó primero y dejó el revelado sin animar)
- Grep: otros archivos de `client/src/admin/` con patrón `{condicion && (...)}` tras un toggle, para aplicar el mismo tratamiento donde corresponda (no expandir el alcance a paneles sin toggle-reveal).

**Steps:**
- [ ] Leer `SecurityView.tsx` líneas ~66-92 para copiar exactamente el patrón `grid-template-rows` (clase Tailwind + estilo inline `gridTemplateRows: on ? "1fr" : "0fr"` sobre un contenedor `grid` + hijo `overflow-hidden`).
- [ ] Aplicar este patrón exacto en `PolicyRow.tsx` reemplazando el montaje condicional plano (`{cfg.active && (...)}`, línea ~67) por el wrapper animado.
- [ ] Aplicar el mismo patrón en `ServerProfileRow.tsx` si su revelado condicional (de Task 9) quedó sin animar.
- [ ] Buscar (Grep) otros `{estado && (` inmediatamente después de un toggle en `client/src/admin/*.tsx` y aplicar el mismo patrón donde encaje sin forzarlo en sitios que no son togglereveal.
- [ ] Verificar visualmente que togglear políticas de aceptación (y perfil del servidor) anima la altura del contenido revelado igual que en Seguridad.
- [ ] Commit: `git add client/src/admin/PolicyRow.tsx client/src/admin/ServerProfileRow.tsx` (+ cualquier otro archivo tocado) + `git commit -m "fix: propagar la animacion de revelado de Seguridad (grid-rows) a Politicas y Perfil del servidor"`.

---

### Task 11: Transición al abrir el detalle de un usuario (#79)

**Root cause confirmado:** `client/src/admin/UsersView.tsx` — las filas de la lista animan con `jg-fade-rise`, pero pasar a la vista de detalle es un swap condicional duro (`if (detail) { return <Seccion>...`, línea ~64) sin transición de entrada/salida.

**Files:** Modify `client/src/admin/UsersView.tsx`.

**Steps:**
- [ ] Aplicar `jg-fade-rise` (reutilizar por nombre, ya definida globalmente en el proyecto) al contenedor `<Seccion>` de detalle cuando se monta, igual que se usa en otras vistas de detalle del panel.
- [ ] Si se quiere también una transición de salida de la lista, es aceptable omitirla si complica el código (ponytail) — la entrada animada del detalle ya resuelve la sensación de "tosco" que reporta el bug.
- [ ] Verificar visualmente: hacer click en un usuario y confirmar que el detalle aparece con una transición suave en vez de un salto instantáneo.
- [ ] Commit: `git add client/src/admin/UsersView.tsx` + `git commit -m "fix: transicion suave al abrir el detalle de un usuario"`.

---

### Task 12: Menú contextual en la lista de usuarios (#80)

**Root cause confirmado:** No existe menú contextual en `UsersView.tsx` hoy. El componente reutilizable ya existe: `client/src/ui/ContextMenu.tsx` (`ContextMenu`, `MenuState`, `MenuEntry`, helper `menuAt(e, title, items, set)`), construido para el fix de #5/#11 (posicionamiento correcto vía portal), ya usado en otros sitios del cliente vía `onContextMenu={(e) => menuAt(e, ...)}`.

**Files:** Modify `client/src/admin/UsersView.tsx`.

**Steps:**
- [ ] Leer un uso existente de `menuAt`/`ContextMenu` en el codebase (Grep `menuAt(` en `client/src`) para copiar el patrón exacto de cableado.
- [ ] El bug dice "click izquierdo", pero el componente `ContextMenu` está pensado para `onContextMenu` (click derecho) — el patrón establecido en el resto del cliente usa click derecho para menús contextuales. Usar `onContextMenu` (click derecho) para mantener consistencia con el resto de la app, no `onClick` — si esto contradice lo que el usuario reportó, es una decisión de consistencia de producto razonable (documentarlo en el mensaje del commit).
- [ ] Añadir `onContextMenu={(e) => menuAt(e, nombreDelUsuario, [...], setMenuState)}` a cada fila/tile de usuario en `UsersView.tsx`, con entradas: "Bloquear"/"Desbloquear" (reutilizar `patch(u.id, {blocked: !u.blocked})`, ya usado en el archivo) y "Exigir cambio de contraseña" (`patch(u.id, {must_change_password: true})`, ya usado en el archivo).
- [ ] Verificar manualmente: click derecho sobre un usuario, confirmar que aparece el menú en la posición correcta (no en la esquina) con las acciones funcionando.
- [ ] Commit: `git add client/src/admin/UsersView.tsx` + `git commit -m "feat: menu contextual en la lista de usuarios con bloquear y exigir cambio de contrasena"`.

---

### Task 13: Color azulado del editor de avisos (#81)

**Root cause confirmado:** `client/src/admin/AvisoEditor.tsx:12` — `const COLORES = ["#e8e8e6", "#85b7eb", "#efb968", "#e88f8f"];` — `#85b7eb` es un azul saturado que no encaja con la paleta del proyecto (acento `#f2f3f5`, ámbar para prioridad/campana).

**Files:** Modify `client/src/admin/AvisoEditor.tsx`.

**Steps:**
- [ ] Sustituir `#85b7eb` por un tono coherente con la paleta ya usada en el resto del panel (revisar `DESIGN.md`/`tailwind.config` para los tokens de color disponibles — evitar introducir un hex nuevo si ya existe un token adecuado; si hace falta un color "informativo" distinto del ámbar/blanco/rojo ya presentes, elegir uno de saturación baja consistente con el resto, nunca verde).
- [ ] Verificar visualmente el selector de color del editor de avisos tras el cambio.
- [ ] Commit: `git add client/src/admin/AvisoEditor.tsx` + `git commit -m "fix: quitar el tono azulado del selector de color en el editor de avisos, no encajaba con la estetica"`.

---

### Task 14: Reposicionar y simplificar el texto de modo básico/avanzado en Hardware (#82)

**Root cause confirmado:** `client/src/admin/HardwareView.tsx:73-96` — el toggle Básico/Avanzado y su párrafo explicativo están en la cabecera, antes de las tarjetas de dispositivo.

**Files:** Modify `client/src/admin/HardwareView.tsx`.

**Steps:**
- [ ] Mover el bloque del toggle + texto explicativo de la cabecera (líneas ~73-96) a después de la lista de tarjetas de dispositivo (después de la línea ~200, donde termina `dispositivos.map`).
- [ ] Simplificar el texto: acortarlo a lo esencial (qué activa el modo avanzado), sin perder la información necesaria.
- [ ] Opcional/mejora sugerida por el bug: en vez de (o además de) texto, considerar mostrar los menús de edición de curvas (`HardwareEditor`/`CpuEditor`) en estado bloqueado/deshabilitado cuando el modo básico está activo, para que la diferencia entre modos se perciba visualmente y no solo se lea — evaluar la complejidad; si resulta desproporcionado para este plan, hacer solo el reposicionamiento+simplificación del texto (ponytail: no expandir el alcance si el fix simple ya resuelve el bug reportado).
- [ ] Verificar visualmente el nuevo orden y texto.
- [ ] Commit: `git add client/src/admin/HardwareView.tsx` + `git commit -m "fix: el texto de modo basico/avanzado en Hardware va debajo de las tarjetas y es mas simple"`.

---

### Task 15: Acceder a los ajustes del cliente sin salir del servidor (#83)

**Root cause confirmado:** `client/src/ui/TitleBar.tsx:247` (`UserMenu`) solo ofrece "Perfil y sesiones" y "Administración". Los ajustes del cliente (`client/src/settings/AjustesView.tsx`) solo se montan desde `client/src/entry/EntryScreen.tsx` (pantalla de selección de servidor) — ningún modo de `App.tsx` (`"picker"/"project"/"case"/"admin"`) los alcanza una vez conectado a un servidor.

**Files:**
- Modify: `client/src/ui/TitleBar.tsx` (`UserMenu`)
- Modify: `client/src/App.tsx` (añadir modo/overlay para ajustes)

**Steps:**
- [ ] Leer `App.tsx` para entender el union type `mode` (línea ~35) y cómo se renderiza cada modo, para decidir la forma más simple de superponer los ajustes sin destruir la conexión/estado del servidor actual — la opción más simple (ponytail): un overlay/modal que monta `AjustesView` encima del modo actual, en vez de añadir un modo nuevo al router principal (evita tener que replicar toda la lógica de "volver" del modo anterior).
- [ ] Añadir un item de menú "Ajustes del cliente" (o similar) debajo de "Perfil y sesiones" en `TitleBar.tsx`'s `UserMenu`, que abra ese overlay.
- [ ] Verificar manualmente: conectado a un servidor, abrir el menú de usuario, entrar a "Ajustes del cliente", confirmar que se puede editar y cerrar sin perder la sesión/conexión activa.
- [ ] Commit: `git add client/src/ui/TitleBar.tsx client/src/App.tsx` + `git commit -m "feat: acceso a los ajustes del cliente sin salir del servidor conectado"`.

---

### Task 16: Orden del Resumen — título siempre arriba (#84)

**Root cause confirmado:** `client/src/admin/ResumenView.tsx` líneas ~114-120 — `<PrimerosPasos />` se renderiza antes que `<ResumenHeader />` (que contiene el `<h2>` "Resumen").

**Files:** Modify `client/src/admin/ResumenView.tsx`.

**Steps:**
- [ ] Intercambiar el orden: `<ResumenHeader />` primero, `<PrimerosPasos />` después.
- [ ] Verificar visualmente que el título "Resumen" queda siempre arriba del todo.
- [ ] Commit: `git add client/src/admin/ResumenView.tsx` + `git commit -m "fix: el titulo del resumen siempre queda arriba de la lista de primeros pasos"`.

---

### Task 17: Reiniciar servidor desde Redes no debe colgarse ni dejarte dentro de la sesión (#85)

**Root cause confirmado (dos causas compuestas):**
1. `client/src-tauri/src/main.rs` (`client_for`, líneas ~358-373) usa un timeout de 15s para la petición HTTP de reinicio — si el servidor cierra el socket sin responder, el botón queda "colgado" hasta 15s.
2. `client/src/App.tsx` (líneas ~175-208) trata toda pérdida de conexión igual (genérica: `"reboot"` → `"lost"` tras 20 fallos, kick tras 2 minutos), sin ninguna señal de que un reinicio fue iniciado voluntariamente por el propio admin desde `NetworkView.tsx`'s `reiniciar()` (línea ~32).

**Files:**
- Modify: `client/src/admin/NetworkView.tsx` (`reiniciar()`)
- Modify: `client/src/App.tsx` (manejo de pérdida de conexión)

**Steps:**
- [ ] En `NetworkView.tsx`, al llamar `reiniciar()`, establecer una señal explícita de "reinicio esperado" ANTES de hacer la petición — la forma más simple (ponytail): un flag en algún estado compartido que `App.tsx` ya pueda leer (contexto, store, o un evento simple), o simplemente navegar/desloguear inmediatamente tras recibir una respuesta 2xx de "reinicio aceptado" (no hace falta esperar a que el servidor efectivamente caiga — si el backend aceptó la orden, el cliente ya sabe que va a reiniciar).
- [ ] En `App.tsx`, cuando esa señal de "reinicio esperado" esté activa, saltar directamente al flujo de cierre de sesión/pantalla de entrada en vez de recorrer todo el ciclo `reboot → lost → kick` de 2 minutos pensando que es un problema de conexión.
- [ ] Sobre el timeout de 15s del cliente HTTP: no es necesariamente el bug principal (una vez que el paso anterior evita depender de esperar la caída), pero si tras el fix anterior el botón sigue sintiéndose lento, considerar reducirlo específicamente para esta llamada (no globalmente, para no afectar otras peticiones legítimamente lentas) — evaluar solo si hace falta tras probar el fix principal.
- [ ] Verificar manualmente: pulsar "Reiniciar ahora" en Redes, confirmar que el cliente te saca de la sesión de forma fluida y rápida, sin quedarse colgado ni pasar por el flujo de "conexión perdida".
- [ ] Commit: `git add client/src/admin/NetworkView.tsx client/src/App.tsx` + `git commit -m "fix: reiniciar el servidor desde Redes ya no se cuelga y cierra la sesion de inmediato en vez de tratarlo como conexion perdida"`.

---

## Verificación final

- [ ] `cd client && npx tsc -b && npm run lint` sin errores.
- [ ] `cargo build` limpio en el workspace (crates de `lumid` tocados en Task 4/5).
- [ ] `git status --short` vacío tras todos los commits de este plan.
- [ ] Reportar cualquier desviación del plan al final (especialmente si Task 5 o Task 15 resultaron más grandes de lo previsto — son las dos más abiertas de este plan).
